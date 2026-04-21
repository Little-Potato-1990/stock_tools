"""add impact_horizon to news_summaries (Phase 2 multi-perspective)

Revision ID: c6f8a4b71d29
Revises: b5e91d3c2a08
Create Date: 2026-04-21 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c6f8a4b71d29"
down_revision: Union[str, Sequence[str], None] = "b5e91d3c2a08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "news_summaries",
        sa.Column("impact_horizon", sa.String(length=8), nullable=True),
    )
    op.create_index(
        "ix_news_summaries_impact_horizon",
        "news_summaries",
        ["impact_horizon"],
    )


def downgrade() -> None:
    op.drop_index("ix_news_summaries_impact_horizon", table_name="news_summaries")
    op.drop_column("news_summaries", "impact_horizon")
