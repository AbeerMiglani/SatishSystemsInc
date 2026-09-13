"""add additive Ripple display and population metadata

Revision ID: c4f2a7d9e1b1
Revises: bbb3dbb1490c
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "c4f2a7d9e1b1"
down_revision: str | None = "bbb3dbb1490c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("nodes", sa.Column("display_name_value", sa.String(), nullable=True))
    op.add_column("nodes", sa.Column("name_source", sa.String(), nullable=False, server_default="synthetic"))
    op.add_column("nodes", sa.Column("data_quality", sa.String(), nullable=False, server_default="estimated"))
    op.add_column("nodes", sa.Column("population_zone_id", sa.String(), nullable=True))
    op.add_column("simulation_results", sa.Column("population_total", sa.Integer(), nullable=False, server_default="65000"))
    op.add_column("simulation_results", sa.Column("population_affected_percentage", sa.Float(), nullable=False, server_default="0"))
    op.add_column("simulation_results", sa.Column("population_overlap_unresolved", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("simulation_results", sa.Column("population_estimate_is_capped", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("simulation_results", sa.Column("population_impact_method", sa.String(), nullable=False, server_default="legacy_node_exposure"))


def downgrade() -> None:
    op.drop_column("simulation_results", "population_impact_method")
    op.drop_column("simulation_results", "population_estimate_is_capped")
    op.drop_column("simulation_results", "population_overlap_unresolved")
    op.drop_column("simulation_results", "population_affected_percentage")
    op.drop_column("simulation_results", "population_total")
    op.drop_column("nodes", "data_quality")
    op.drop_column("nodes", "population_zone_id")
    op.drop_column("nodes", "name_source")
    op.drop_column("nodes", "display_name_value")
