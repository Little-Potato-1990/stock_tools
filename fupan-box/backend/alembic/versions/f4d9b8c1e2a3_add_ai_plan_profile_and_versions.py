"""add ai plan profile and versions

Revision ID: f4d9b8c1e2a3
Revises: a6b5729fa4c9
Create Date: 2026-05-06 16:16:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f4d9b8c1e2a3"
down_revision: Union[str, Sequence[str], None] = "a6b5729fa4c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_trading_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("profile_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True, server_default=sa.text("'{}'::jsonb")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(op.f("ix_user_trading_profiles_user_id"), "user_trading_profiles", ["user_id"], unique=True)
    op.create_index("ix_user_trading_profiles_user", "user_trading_profiles", ["user_id"], unique=False)

    op.create_table(
        "user_plan_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("plan_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="ai_draft"),
        sa.Column("model", sa.String(length=60), nullable=True),
        sa.Column("content_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True, server_default=sa.text("'{}'::jsonb")),
        sa.Column("profile_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True, server_default=sa.text("'{}'::jsonb")),
        sa.Column("source_version_id", sa.Integer(), nullable=True),
        sa.Column("review_trade_date", sa.Date(), nullable=True),
        sa.Column("user_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["source_version_id"], ["user_plan_versions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_plan_versions_user_id"), "user_plan_versions", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_plan_versions_plan_date"), "user_plan_versions", ["plan_date"], unique=False)
    op.create_index(op.f("ix_user_plan_versions_status"), "user_plan_versions", ["status"], unique=False)
    op.create_index("ix_user_plan_versions_user_date", "user_plan_versions", ["user_id", "plan_date"], unique=False)
    op.create_index("ix_user_plan_versions_user_status", "user_plan_versions", ["user_id", "status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_plan_versions_user_status", table_name="user_plan_versions")
    op.drop_index("ix_user_plan_versions_user_date", table_name="user_plan_versions")
    op.drop_index(op.f("ix_user_plan_versions_status"), table_name="user_plan_versions")
    op.drop_index(op.f("ix_user_plan_versions_plan_date"), table_name="user_plan_versions")
    op.drop_index(op.f("ix_user_plan_versions_user_id"), table_name="user_plan_versions")
    op.drop_table("user_plan_versions")

    op.drop_index("ix_user_trading_profiles_user", table_name="user_trading_profiles")
    op.drop_index(op.f("ix_user_trading_profiles_user_id"), table_name="user_trading_profiles")
    op.drop_table("user_trading_profiles")
