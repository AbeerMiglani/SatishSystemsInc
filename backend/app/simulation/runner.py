from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

try:
    from datetime import UTC
except ImportError:
    UTC = timezone.utc

import networkx as nx
from celery import shared_task
from sqlalchemy.orm import Session

from app.config import settings
from app.db.postgres import SessionLocal
from app.db.redis import get_redis_client
from app.models.network import Edge, Node, Scenario, SimulationResult
from app.simulation.cascade import run_cascade
from app.simulation.population import calculate_population_impact

logger = logging.getLogger(__name__)


def apply_scenario_modifications(
    G: nx.DiGraph,
    modifications: list[dict],
) -> nx.DiGraph:
    """
    Applies polymorphic scenario modifications (add_edge and upgrade_node)
    to a copy of the in-memory graph.
    """
    G_mod = G.copy()
    for mod in modifications:
        mod_type = mod.get("type")
        if mod_type == "add_edge":
            src = str(mod["source"])
            tgt = str(mod["target"])
            if src not in G_mod or tgt not in G_mod or src == tgt:
                raise ValueError("scenario references invalid graph endpoints")
            weight = float(mod.get("weight", 1.0))
            capacity = float(mod.get("capacity", 100.0))
            edge_type = mod.get("edge_type", "power_supply")
            is_bi = bool(mod.get("is_bidirectional", False))

            G_mod.add_edge(src, tgt, weight=weight, capacity=capacity, edge_type=edge_type)
            if is_bi:
                G_mod.add_edge(tgt, src, weight=weight, capacity=capacity, edge_type=edge_type)

        elif mod_type == "upgrade_node":
            nid = str(mod["node_id"])
            if nid not in G_mod:
                raise ValueError(f"scenario upgrade references unknown node {nid}")

            if mod.get("capacity") is not None:
                G_mod.nodes[nid]["capacity"] = float(mod["capacity"])
            elif mod.get("capacity_multiplier") is not None:
                G_mod.nodes[nid]["capacity"] *= float(mod["capacity_multiplier"])
            elif mod.get("capacity_add") is not None:
                G_mod.nodes[nid]["capacity"] += float(mod["capacity_add"])

            if mod.get("failure_threshold") is not None:
                G_mod.nodes[nid]["failure_threshold"] = float(mod["failure_threshold"])
            elif mod.get("failure_threshold_add") is not None:
                G_mod.nodes[nid]["failure_threshold"] += float(mod["failure_threshold_add"])

        else:
            raise ValueError(f"unsupported scenario modification type: {mod_type}")

    return G_mod


@shared_task(bind=True)
def run_simulation_task(
    self, 
    simulation_id: str, 
    network_id: str, 
    initial_failures: list[str],
    scenario_id: str | None = None
):
    """
    Background Celery task to run the cascade simulation.
    If scenario_id is provided, applies network modifications first.
    Publishes wave events to Redis for WebSocket streaming.
    """
    db: Session = SessionLocal()
    try:
        sim = db.query(SimulationResult).filter(SimulationResult.id == simulation_id).first()
        if not sim:
            return
        
        sim.status = "running"
        db.commit()
        
        # 1. Fetch network topology
        nodes = db.query(Node).filter(Node.network_id == network_id).all()
        edges = db.query(Edge).filter(Edge.network_id == network_id).all()
        
        # 2. Build in-memory NetworkX DiGraph
        G = nx.DiGraph()
        for n in nodes:
            G.add_node(
                str(n.id), 
                capacity=n.capacity, 
                current_load=n.current_load, 
                failure_threshold=n.failure_threshold,
                population_served=n.population_served,
                status=n.status,
            )
            
        for e in edges:
            src = str(e.source_id)
            tgt = str(e.target_id)
            G.add_edge(src, tgt, weight=e.weight, capacity=e.capacity, edge_type=e.edge_type)
            if e.is_bidirectional:
                G.add_edge(tgt, src, weight=e.weight, capacity=e.capacity, edge_type=e.edge_type)
                
        # 3. Apply Scenario Modifications if present
        scenario = None
        if scenario_id:
            scenario = db.query(Scenario).filter(Scenario.id == scenario_id).first()
            if not scenario or str(scenario.network_id) != network_id:
                raise ValueError("scenario does not belong to the simulation network")
            if scenario.modifications:
                G = apply_scenario_modifications(G, scenario.modifications)
                            
        # Callback to publish waves to Redis
        def on_wave(wave_data):
            # Publish to Redis channel specific to this simulation
            get_redis_client().publish(f"sim_{simulation_id}", json.dumps(wave_data))

        # 4. Run cascade engine
        waves, eff_before, eff_after, pop_affected, stabilized = run_cascade(
            G,
            initial_failures,
            max_waves=settings.max_cascade_waves,
            on_wave_completed=on_wave
        )
        
        # 5. Calculate population impact with municipal cap and overlap detection
        all_failed_ids = set(initial_failures)
        for w in waves:
            all_failed_ids.update(w.get("failed_node_ids", []))
        pop_impact = calculate_population_impact(all_failed_ids, G)

        # 6. Save results to Postgres
        total_failed = sum(len(w['failed_node_ids']) for w in waves)
        
        sim.waves = waves
        sim.total_failed = total_failed
        sim.population_affected_estimate = pop_impact["population_affected_estimate"]
        # Persist the uncapped total too: when both a baseline and an
        # intervention saturate the study-area cap, the capped figure is
        # identical for each and a real improvement would be invisible.
        sim.raw_population_affected = pop_impact["raw_population_affected"]
        sim.study_area_population_cap = pop_impact["study_area_population_cap"]
        sim.is_population_capped = pop_impact["is_population_capped"]
        sim.has_unresolved_overlap = pop_impact["has_unresolved_overlap"]
        sim.cascade_stabilized = stabilized
        sim.global_efficiency_before = eff_before
        sim.global_efficiency_after = eff_after
        sim.status = "completed"
        sim.completed_at = datetime.now(UTC)
        
        # If part of a scenario, link the result back to the scenario
        if scenario_id and scenario:
            scenario.cached_result_id = sim.id
            
        db.commit()
        
        # Publish completion event
        get_redis_client().publish(f"sim_{simulation_id}", json.dumps({"status": "completed"}))
        
    except Exception:
        logger.exception("simulation %s failed", simulation_id)
        # A failure in the final db.commit() above leaves the session's
        # transaction in a state SQLAlchemy requires rolling back before any
        # further query — without this, the recovery query below raises
        # PendingRollbackError and the run is left stuck at status="running"
        # instead of being marked "failed". Matches the pattern already used
        # in app.services.ingestion's own except-then-rollback path.
        db.rollback()
        sim = db.query(SimulationResult).filter(SimulationResult.id == simulation_id).first()
        if sim:
            sim.status = "failed"
            sim.error_message = "Simulation execution failed. Consult server logs with the simulation ID."
            db.commit()
        get_redis_client().publish(f"sim_{simulation_id}", json.dumps({"status": "failed"}))
        raise
    finally:
        db.close()
