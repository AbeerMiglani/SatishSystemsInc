from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import UUID4, BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.config import settings
from app.db.postgres import get_db
from app.models.network import Network, Node, Scenario, SimulationResult
from app.security import enforce_rate_limit, require_operator, require_viewer
from app.services.recommendations import MitigationRecommendation, get_recommendations
from app.simulation.runner import run_simulation_task

router = APIRouter(
    prefix="/simulations",
    tags=["Simulations"],
    dependencies=[Depends(require_viewer), Depends(enforce_rate_limit)],
)
logger = logging.getLogger(__name__)


class SimulationCreate(BaseModel):
    network_id: UUID4
    initial_failures: list[UUID4] = Field(min_length=1, max_length=settings.max_initial_failures)
    scenario_id: UUID4 | None = None

    @field_validator("initial_failures")
    @classmethod
    def initial_failures_must_be_unique(cls, values: list[UUID4]) -> list[UUID4]:
        if len(set(values)) != len(values):
            raise ValueError("initial_failures must not contain duplicates")
        return values


class WaveSchema(BaseModel):
    wave: int
    failed_node_ids: list[UUID4]


class SimulationResponse(BaseModel):
    id: UUID4
    network_id: UUID4
    status: str
    initial_failures: list[UUID4]
    waves: list[WaveSchema]
    total_failed: int
    population_affected_estimate: int
    global_efficiency_before: float | None = None
    global_efficiency_after: float | None = None
    error_message: str | None = None
    created_at: datetime
    completed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


@router.post("", response_model=SimulationResponse)
def create_simulation(
    req: SimulationCreate,
    db: Session = Depends(get_db),
    _operator=Depends(require_operator),
):
    """Trigger a new cascading failure simulation."""
    net = db.query(Network).filter(Network.id == req.network_id).first()
    if not net:
        raise HTTPException(status_code=404, detail="Network not found")

    requested_ids = {str(node_id) for node_id in req.initial_failures}
    known_ids = {
        str(node_id)
        for (node_id,) in db.query(Node.id).filter(Node.network_id == req.network_id).all()
    }
    if requested_ids - known_ids:
        raise HTTPException(status_code=422, detail="initial_failures contains nodes outside this network")

    if req.scenario_id:
        scenario = (
            db.query(Scenario)
            .filter(Scenario.id == req.scenario_id, Scenario.network_id == req.network_id)
            .first()
        )
        if not scenario:
            raise HTTPException(status_code=404, detail="Scenario not found for this network")
        
    sim = SimulationResult(
        network_id=req.network_id,
        initial_failures=[str(uid) for uid in req.initial_failures],
        status="pending"
    )
    db.add(sim)
    db.commit()
    db.refresh(sim)
    
    # Dispatch after the durable row exists. A dispatch failure is recorded so
    # callers never poll a permanently pending job.
    try:
        run_simulation_task.delay(
            simulation_id=str(sim.id),
            network_id=str(req.network_id),
            initial_failures=[str(uid) for uid in req.initial_failures],
            scenario_id=str(req.scenario_id) if req.scenario_id else None,
        )
    except Exception:
        logger.exception("failed to dispatch simulation %s", sim.id)
        sim.status = "failed"
        sim.error_message = "Simulation dispatch failed"
        db.commit()
        raise HTTPException(status_code=503, detail="Simulation queue unavailable")
    
    return sim


@router.get("/{sim_id}", response_model=SimulationResponse)
def get_simulation(sim_id: uuid.UUID, db: Session = Depends(get_db)):
    """Fetch the status and results of a simulation."""
    sim = db.query(SimulationResult).filter(SimulationResult.id == sim_id).first()
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return sim


@router.get(
    "/{sim_id}/recommendations",
    response_model=list[MitigationRecommendation],
    summary="Get Deterministic Mitigation Recommendations",
    description=(
        "Returns a deterministically ranked list of mitigation interventions for a completed simulation. "
        "Each candidate is re-simulated in memory against the Motter-Lai cascade model to verify genuine failure "
        "reduction, population protection, and efficiency gain. Every recommendation includes a ready-to-post "
        "scenario_payload for 1-click execution in the UI."
    ),
)
def get_simulation_recommendations(
    sim_id: uuid.UUID,
    limit: int = Query(default=10, ge=1, le=50, description="Max recommendations to return"),
    db: Session = Depends(get_db),
):
    """Fetch mitigation recommendations for a completed simulation."""
    sim = db.query(SimulationResult).filter(SimulationResult.id == sim_id).first()
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")

    if sim.status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Simulation status is '{sim.status}'. Recommendations are only available for completed simulations.",
        )

    return get_recommendations(simulation=sim, db=db, limit=limit)
