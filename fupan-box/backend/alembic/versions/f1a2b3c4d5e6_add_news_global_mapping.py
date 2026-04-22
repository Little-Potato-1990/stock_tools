"""add news_summaries.global_mapping JSONB column

Revision ID: f1a2b3c4d5e6
Revises: d3a91f8c4e02
Create Date: 2026-04-22 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "d3a91f8c4e02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "news_summaries",
        sa.Column("global_mapping", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("news_summaries", "global_mapping")
