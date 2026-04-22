"""add user_skills + skill_scan_runs + user_settings.active_skill_ref

Revision ID: d3a91f8c4e02
Revises: c6f8a4b71d29
Create Date: 2026-04-22 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d3a91f8c4e02"
down_revision: Union[str, Sequence[str], None] = "c6f8a4b71d29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("active_skill_ref", sa.String(length=80), nullable=True),
    )

    op.create_table(
        "user_skills",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(length=60), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("icon", sa.String(length=20), nullable=True),
        sa.Column("body_markdown", sa.Text(), nullable=False),
        sa.Column(
            "completeness_warnings",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "derived_rules",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "rules_user_edited",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("rules_extracted_at", sa.DateTime(), nullable=True),
        sa.Column(
            "is_archived",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "slug", name="uq_user_skill_slug"),
    )
    op.create_index("ix_user_skills_user", "user_skills", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_skills_user_id"), "user_skills", ["user_id"], unique=False)

    op.create_table(
        "skill_scan_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("skill_ref", sa.String(length=80), nullable=False),
        sa.Column("skill_name_snapshot", sa.String(length=80), nullable=False),
        sa.Column("universe", sa.String(length=60), nullable=False),
        sa.Column("top_n", sa.Integer(), nullable=False, server_default=sa.text("30")),
        sa.Column(
            "rules_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "candidates",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("pre_filter_count", sa.Integer(), nullable=True),
        sa.Column("final_count", sa.Integer(), nullable=True),
        sa.Column("cost_estimate_yuan", sa.Float(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="running"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_skill_scan_runs_user_id"), "skill_scan_runs", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_skill_scan_runs_created_at"), "skill_scan_runs", ["created_at"], unique=False
    )
    op.create_index(
        "ix_skill_scan_user_created", "skill_scan_runs", ["user_id", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_skill_scan_user_created", table_name="skill_scan_runs")
    op.drop_index(op.f("ix_skill_scan_runs_created_at"), table_name="skill_scan_runs")
    op.drop_index(op.f("ix_skill_scan_runs_user_id"), table_name="skill_scan_runs")
    op.drop_table("skill_scan_runs")

    op.drop_index(op.f("ix_user_skills_user_id"), table_name="user_skills")
    op.drop_index("ix_user_skills_user", table_name="user_skills")
    op.drop_table("user_skills")

    op.drop_column("user_settings", "active_skill_ref")
