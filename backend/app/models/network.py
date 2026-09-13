"""
SQLAlchemy models for the Ripple backend.
Uses GeoAlchemy2 for PostGIS geometries.
"""

import uuid
from datetime import datetime, timezone

from geoalchemy2 import Geometry
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, validates

from app.db.postgres import Base

UTC = getattr(datetime, "UTC", timezone.utc)  # noqa: UP017


class Network(Base):
    __tablename__ = "networks"
    __table_args__ = (UniqueConstraint("name", name="uq_network_name"),)

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    nodes = relationship("Node", back_populates="network", cascade="all, delete-orphan")
    edges = relationship("Edge", back_populates="network", cascade="all, delete-orphan")
    scenarios = relationship("Scenario", back_populates="network")


class Node(Base):
    __tablename__ = "nodes"
    __table_args__ = (
        CheckConstraint("lat >= -90 AND lat <= 90", name="ck_node_latitude"),
        CheckConstraint("lng >= -180 AND lng <= 180", name="ck_node_longitude"),
        CheckConstraint("capacity > 0", name="ck_node_capacity_positive"),
        CheckConstraint("current_load >= 0", name="ck_node_load_nonnegative"),
        CheckConstraint("failure_threshold > 0", name="ck_node_threshold_positive"),
        CheckConstraint("population_served >= 0", name="ck_node_population_nonnegative"),
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    network_id = Column(
        PG_UUID(as_uuid=True), ForeignKey("networks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String, nullable=False)
    display_name_value = Column(String, nullable=True)
    name_source = Column(String, nullable=False, default="synthetic")
    data_quality = Column(String, nullable=False, default="estimated")
    node_type = Column(
        Enum(
            "power_substation",
            "water_station",
            "hospital",
            "road_junction",
            "telecom_tower",
            name="node_type_enum",
        ),
        nullable=False,
    )
    # PostGIS geometry (Point, SRID 4326 for WGS84)
    geom = Column(Geometry("POINT", srid=4326), nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)

    capacity = Column(Float, nullable=False, default=100.0)
    current_load = Column(Float, nullable=False, default=0.0)
    failure_threshold = Column(Float, nullable=False, default=1.0)
    population_served = Column(Integer, nullable=False, default=0)
    population_zone_id = Column(String, nullable=True)
    status = Column(
        Enum("operational", "degraded", "failed", name="node_status_enum"),
        default="operational",
        nullable=False,
    )
    is_synthetic = Column(Boolean, nullable=False, default=True, server_default="true")
    data_source = Column(String, nullable=False, default="synthetic", server_default="synthetic")
    display_name = Column(String, nullable=False)
    name_source = Column(String, nullable=False, default="synthetic", server_default="synthetic")
    data_quality = Column(String, nullable=False, default="verified", server_default="verified")

    @validates("name")
    def sync_display_name_from_name(self, key, value):
        if not getattr(self, "display_name", None):
            self.display_name = value
        return value

    @validates("display_name")
    def validate_display_name(self, key, value):
        if not value and getattr(self, "name", None):
            return self.name
        return value

    network = relationship("Network", back_populates="nodes")
    # Relationships for edges where this node is source/target
    edges_out = relationship("Edge", foreign_keys="Edge.source_id", back_populates="source")
    edges_in = relationship("Edge", foreign_keys="Edge.target_id", back_populates="target")


class Edge(Base):
    __tablename__ = "infra_edges"
    __table_args__ = (
        CheckConstraint("source_id <> target_id", name="ck_edge_distinct_endpoints"),
        CheckConstraint("weight >= 0", name="ck_edge_weight_nonnegative"),
        CheckConstraint("capacity > 0", name="ck_edge_capacity_positive"),
        UniqueConstraint("network_id", "source_id", "target_id", "edge_type", name="uq_network_edge"),
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    network_id = Column(
        PG_UUID(as_uuid=True), ForeignKey("networks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_id = Column(PG_UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    target_id = Column(PG_UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    
    edge_type = Column(
        Enum("power_supply", "water_supply", "road_link", "depends_on", name="edge_type_enum"),
        nullable=False,
    )
    weight = Column(Float, nullable=False, default=1.0)
    capacity = Column(Float, nullable=False, default=100.0)
    is_bidirectional = Column(Boolean, nullable=False, default=False)

    network = relationship("Network", back_populates="edges")
    source = relationship("Node", foreign_keys=[source_id], back_populates="edges_out")
    target = relationship("Node", foreign_keys=[target_id], back_populates="edges_in")


class Scenario(Base):
    __tablename__ = "scenarios"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    network_id = Column(
        PG_UUID(as_uuid=True), ForeignKey("networks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    
    # JSON list of dicts: {"type": "add_edge", "source": "uuid", "target": "uuid", ...}
    modifications = Column(JSON, nullable=False, default=list)
    # JSON list of initial failed node UUID strings
    initial_failures = Column(JSON, nullable=False, default=list)
    
    cached_result_id = Column(PG_UUID(as_uuid=True), ForeignKey("simulation_results.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    network = relationship("Network", back_populates="scenarios")
    result = relationship("SimulationResult", foreign_keys=[cached_result_id])


class SimulationResult(Base):
    __tablename__ = "simulation_results"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    network_id = Column(
        PG_UUID(as_uuid=True), ForeignKey("networks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status = Column(
        Enum("pending", "running", "completed", "failed", name="sim_status_enum"),
        nullable=False,
        default="pending",
    )
    # JSON list of initial failed node UUID strings
    initial_failures = Column(JSON, nullable=False, default=list)
    
    # JSON list of dicts: [{"wave": 0, "failed_node_ids": ["uuid"]}, ...]
    waves = Column(JSON, nullable=False, default=list)
    
    total_failed = Column(Integer, nullable=False, default=0)
    population_affected_estimate = Column(Integer, nullable=False, default=0)
    study_area_population_cap = Column(Integer, nullable=False, default=65000, server_default="65000")
    is_population_capped = Column(Boolean, nullable=False, default=False, server_default="false")
    has_unresolved_overlap = Column(Boolean, nullable=False, default=False, server_default="false")
    global_efficiency_before = Column(Float, nullable=True)
    global_efficiency_after = Column(Float, nullable=True)
    
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False, index=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
