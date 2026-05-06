"""add user plan feedback table

Revision ID: 9b7e2c4d1f30
Revises: f4d9b8c1e2a3
Create Date: 2026-05-06 16:27:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "9b7e2c4d1f30"
down_revision: Union[str, Sequence[str], None] = "f4d9b8c1e2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_plan_feedback",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("plan_date", sa.Date(), nullable=False),
        sa.Column("plan_version_id", sa.Integer(), nullable=True),
        sa.Column("planned_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hit_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("miss_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unexpected_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("net_pnl", sa.Float(), nullable=False, server_default="0"),
        sa.Column(
            "feedback_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["plan_version_id"], ["user_plan_versions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "plan_date", name="uq_user_plan_feedback_user_date"),
    )
    op.create_index(op.f("ix_user_plan_feedback_user_id"), "user_plan_feedback", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_plan_feedback_plan_date"), "user_plan_feedback", ["plan_date"], unique=False)
    op.create_index("ix_user_plan_feedback_user_date", "user_plan_feedback", ["user_id", "plan_date"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_plan_feedback_user_date", table_name="user_plan_feedback")
    op.drop_index(op.f("ix_user_plan_feedback_plan_date"), table_name="user_plan_feedback")
    op.drop_index(op.f("ix_user_plan_feedback_user_id"), table_name="user_plan_feedback")
    op.drop_table("user_plan_feedback")
