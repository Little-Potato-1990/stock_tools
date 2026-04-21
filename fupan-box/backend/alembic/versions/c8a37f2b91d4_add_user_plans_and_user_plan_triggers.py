"""add user_plans + user_plan_triggers

Revision ID: c8a37f2b91d4
Revises: 72093d36dca9
Create Date: 2026-04-21 06:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c8a37f2b91d4"
down_revision: Union[str, Sequence[str], None] = "72093d36dca9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_plans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=10), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=True),
        sa.Column("direction", sa.String(length=10), nullable=False, server_default="buy"),
        sa.Column(
            "trigger_conditions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "position_plan",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("stop_loss_pct", sa.Float(), nullable=True),
        sa.Column("take_profit_pct", sa.Float(), nullable=True),
        sa.Column(
            "invalid_conditions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("first_triggered_at", sa.DateTime(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_plans_user_id"), "user_plans", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_plans_status"), "user_plans", ["status"], unique=False)
    op.create_index("ix_user_plans_user_status", "user_plans", ["user_id", "status"], unique=False)
    op.create_index("ix_user_plans_code", "user_plans", ["code"], unique=False)

    op.create_table(
        "user_plan_triggers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column(
            "triggered_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("condition_idx", sa.Integer(), nullable=False),
        sa.Column("condition_kind", sa.String(length=20), nullable=True),
        sa.Column("condition_type", sa.String(length=30), nullable=True),
        sa.Column("condition_label", sa.String(length=100), nullable=True),
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("change_pct", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["plan_id"], ["user_plans.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_user_plan_triggers_plan_id"), "user_plan_triggers", ["plan_id"], unique=False
    )
    op.create_index(
        op.f("ix_user_plan_triggers_user_id"), "user_plan_triggers", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_user_plan_triggers_trade_date"),
        "user_plan_triggers",
        ["trade_date"],
        unique=False,
    )
    op.create_index(
        "ix_user_plan_triggers_plan", "user_plan_triggers", ["plan_id"], unique=False
    )
    op.create_index(
        "ix_user_plan_triggers_user_date",
        "user_plan_triggers",
        ["user_id", "trade_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_plan_triggers_user_date", table_name="user_plan_triggers")
    op.drop_index("ix_user_plan_triggers_plan", table_name="user_plan_triggers")
    op.drop_index(op.f("ix_user_plan_triggers_trade_date"), table_name="user_plan_triggers")
    op.drop_index(op.f("ix_user_plan_triggers_user_id"), table_name="user_plan_triggers")
    op.drop_index(op.f("ix_user_plan_triggers_plan_id"), table_name="user_plan_triggers")
    op.drop_table("user_plan_triggers")
    op.drop_index("ix_user_plans_code", table_name="user_plans")
    op.drop_index("ix_user_plans_user_status", table_name="user_plans")
    op.drop_index(op.f("ix_user_plans_status"), table_name="user_plans")
    op.drop_index(op.f("ix_user_plans_user_id"), table_name="user_plans")
    op.drop_table("user_plans")
