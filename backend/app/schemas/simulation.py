from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import UUID4, BaseModel, ConfigDict, Field


class PopulationImpactResult(BaseModel):
    raw_population_affected: int
    population_affected_estimate: int
    study_area_population_cap: int = 65000
    is_population_capped: bool = False
    has_unresolved_overlap: bool = False


class WaveSchema(BaseModel):
    wave: int
    failed_node_ids: list[UUID4]


class SimulationCreate(BaseModel):
    network_id: UUID4
    initial_failures: list[UUID4]
    scenario_id: Optional[UUID4] = None


class SimulationResponse(BaseModel):
    id: UUID4
    network_id: UUID4
    status: str
    initial_failures: list[UUID4]
    waves: list[Any] = Field(default_factory=list)
    total_failed: int = 0
    population_affected_estimate: int = 0
    study_area_population_cap: int = 65000
    is_population_capped: bool = False
    has_unresolved_overlap: bool = False
    global_efficiency_before: Optional[float] = None
    global_efficiency_after: Optional[float] = None
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class SimulationResult(SimulationResponse):
    """Schema representation of a completed simulation result."""
    pass
