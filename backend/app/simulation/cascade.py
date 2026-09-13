from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

import networkx as nx

logger = logging.getLogger(__name__)

#: Default wave guardrail. The engine stays free of application configuration
#: so it can be driven standalone (tests, diagnosis, stress runs) without a
#: database or settings object; callers that have settings inject their own
#: bound via ``max_waves`` -- see ``app.simulation.runner``.
DEFAULT_MAX_WAVES = 50


def calculate_global_efficiency(G: nx.DiGraph, N_baseline: int | None = None) -> float:
    """
    Calculates the global efficiency of the graph.
    Formula: E = (1 / (N*(N-1))) * sum(1 / d(i,j)) for all i != j
    """
    N = N_baseline if N_baseline is not None else len(G)
    
    if N < 2:
        return 0.0

    denom = N * (N - 1)
    g_eff = 0.0
    
    # We always do manual calculation to ensure we normalize by N_baseline
    # because nx.global_efficiency normalizes by len(G), which inflates scores
    # for small surviving subgraphs.
    for source, lengths in nx.all_pairs_shortest_path_length(G):
        for target, distance in lengths.items():
            if source != target and distance > 0:
                g_eff += 1.0 / distance
                
    return g_eff / denom


def run_cascade(
    G_baseline: nx.DiGraph,
    initial_failures: list[str],
    max_waves: int = DEFAULT_MAX_WAVES,
    on_wave_completed: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[list[dict[str, Any]], float, float, int, bool]:
    """
    Runs the Motter-Lai uniform load redistribution cascade algorithm in-memory.

    Returns ``(waves, efficiency_before, efficiency_after, population_affected,
    stabilized)``.

    ``stabilized`` is False when the cascade was still producing new failures at
    ``max_waves`` and was therefore truncated. A truncated cascade is a valid
    bounded result and is returned normally: the guardrail bounds the work, it
    does not invalidate the analysis. Callers are expected to surface the flag
    so a truncated run is never presented as a settled one.
    """
    unknown_initial_failures = set(initial_failures) - set(G_baseline.nodes)
    if unknown_initial_failures:
        raise ValueError("initial_failures contains nodes outside the simulation graph")

    # NEVER mutate the Neo4j baseline or the provided baseline graph.
    G = G_baseline.copy()
    
    eff_before = calculate_global_efficiency(G)
    
    waves = []
    failed_in_wave = set(initial_failures)
    all_failed = set(initial_failures)
    
    current_wave_idx = 0
    
    while failed_in_wave and current_wave_idx < max_waves:
        # Record this wave
        wave_data = {
            "wave": current_wave_idx,
            "failed_node_ids": sorted(failed_in_wave)
        }
        waves.append(wave_data)
        
        # Publish real-time event if callback provided
        if on_wave_completed:
            on_wave_completed(wave_data)
        
        # 1. Redistribute load for nodes that failed IN THIS WAVE
        for u in failed_in_wave:
            if u not in G:
                continue
                
            load_to_distribute = G.nodes[u].get('current_load', 0.0)
            
            # Transfer only through surviving outgoing links. Link capacity is
            # a hard upper bound; when no capacity is modelled (legacy tests),
            # retain the previous uniform redistribution behaviour.
            surviving_links = sorted(
                [
                    (v, G.get_edge_data(u, v) or {})
                    for v in G.successors(u)
                    if v not in all_failed
                ],
                key=lambda x: x[0]
            )

            if surviving_links and load_to_distribute > 0:
                declared_capacities = [edge.get("capacity") for _, edge in surviving_links]
                if any(capacity is not None for capacity in declared_capacities):
                    capacities = [max(0.0, float(edge.get("capacity", 0.0))) for _, edge in surviving_links]
                    total_capacity = sum(capacities)
                    if total_capacity > 0:
                        for (neighbor, _), link_capacity in zip(surviving_links, capacities):
                            transferred_load = min(
                                link_capacity,
                                load_to_distribute * (link_capacity / total_capacity),
                            )
                            G.nodes[neighbor]["current_load"] += transferred_load
                else:
                    delta = load_to_distribute / len(surviving_links)
                    for neighbor, _ in surviving_links:
                        G.nodes[neighbor]["current_load"] += delta
        
        # 2. Remove newly failed nodes from the graph topology
        for u in failed_in_wave:
            if u in G:
                G.remove_node(u)
                
        # 3. Determine new failures for the NEXT wave
        failed_in_wave = set()
        for node, data in G.nodes(data=True):
            threshold = data.get('capacity', 100.0) * data.get('failure_threshold', 1.0)
            if data.get('current_load', 0.0) > threshold:
                failed_in_wave.add(node)
                all_failed.add(node)
                
        current_wave_idx += 1
        
    # Nodes still failing at the guardrail mean the cascade had not settled.
    # Report the bounded result rather than discarding the whole simulation.
    stabilized = not failed_in_wave
    if not stabilized:
        logger.warning(
            "cascade truncated at max_waves=%s with %d node(s) still failing; "
            "returning bounded result",
            max_waves,
            len(failed_in_wave),
        )

    eff_after = calculate_global_efficiency(G, N_baseline=len(G_baseline))
    
    # Calculate total population affected (disclaimer: double counts overlapping populations)
    pop_affected = 0
    for f in all_failed:
        if f in G_baseline.nodes:
            pop_affected += G_baseline.nodes[f].get('population_served', 0)
            
    return waves, eff_before, eff_after, pop_affected, stabilized
