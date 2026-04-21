"""add capital dimension tables (capital_flow, north_hold, etf_flow, announcement, holder_snapshot, holder_identity_registry) + seed identity registry

Revision ID: a4f7d20e6b91
Revises: e2c4a93f5a17
Create Date: 2026-04-21 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a4f7d20e6b91"
down_revision: Union[str, Sequence[str], None] = "e2c4a93f5a17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "capital_flow_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("scope_key", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("trade_date", "scope", "scope_key", name="uq_capital_flow"),
    )
    op.create_index("ix_capital_flow_daily_trade_date", "capital_flow_daily", ["trade_date"])
    op.create_index("ix_cf_date_scope", "capital_flow_daily", ["trade_date", "scope"])
    op.create_index("ix_cf_stock_date", "capital_flow_daily", ["scope_key", "trade_date"])

    op.create_table(
        "north_hold_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("stock_code", sa.String(length=10), nullable=False),
        sa.Column("stock_name", sa.String(length=50), nullable=True),
        sa.Column("hold_shares", sa.Float(), nullable=True),
        sa.Column("hold_amount", sa.Float(), nullable=True),
        sa.Column("hold_pct", sa.Float(), nullable=True),
        sa.Column("chg_shares", sa.Float(), nullable=True),
        sa.Column("chg_amount", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("trade_date", "stock_code", name="uq_north_hold"),
    )
    op.create_index("ix_north_hold_daily_trade_date", "north_hold_daily", ["trade_date"])
    op.create_index("ix_nh_stock_date", "north_hold_daily", ["stock_code", "trade_date"])

    op.create_table(
        "etf_flow_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("etf_code", sa.String(length=10), nullable=False),
        sa.Column("etf_name", sa.String(length=80), nullable=True),
        sa.Column("category", sa.String(length=24), nullable=False, server_default="other"),
        sa.Column("shares", sa.Float(), nullable=True),
        sa.Column("shares_change", sa.Float(), nullable=True),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("nav", sa.Float(), nullable=True),
        sa.Column("premium_rate", sa.Float(), nullable=True),
        sa.Column("inflow_estimate", sa.Float(), nullable=True),
        sa.Column("close", sa.Float(), nullable=True),
        sa.Column("change_pct", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("trade_date", "etf_code", name="uq_etf_flow"),
    )
    op.create_index("ix_etf_flow_daily_trade_date", "etf_flow_daily", ["trade_date"])
    op.create_index("ix_etf_date_code", "etf_flow_daily", ["trade_date", "etf_code"])
    op.create_index("ix_etf_category_date", "etf_flow_daily", ["category", "trade_date"])

    op.create_table(
        "announcement_event",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("stock_code", sa.String(length=10), nullable=False),
        sa.Column("stock_name", sa.String(length=50), nullable=True),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("actor", sa.String(length=120), nullable=True),
        sa.Column("actor_type", sa.String(length=20), nullable=False, server_default="unknown"),
        sa.Column("scale", sa.Float(), nullable=True),
        sa.Column("shares", sa.Float(), nullable=True),
        sa.Column("progress", sa.String(length=20), nullable=True),
        sa.Column("detail", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String(length=20)), nullable=True),
        sa.Column("source_url", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_announcement_event_trade_date", "announcement_event", ["trade_date"])
    op.create_index("ix_ae_date_type", "announcement_event", ["trade_date", "event_type"])
    op.create_index("ix_ae_stock_date", "announcement_event", ["stock_code", "trade_date"])
    op.create_index("ix_ae_actor", "announcement_event", ["actor_type", "trade_date"])

    op.create_table(
        "holder_snapshot_quarterly",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("stock_code", sa.String(length=10), nullable=False),
        sa.Column("stock_name", sa.String(length=50), nullable=True),
        sa.Column("holder_name", sa.String(length=200), nullable=False),
        sa.Column("canonical_name", sa.String(length=80), nullable=True),
        sa.Column("holder_type", sa.String(length=20), nullable=False, server_default="other"),
        sa.Column("fund_company", sa.String(length=80), nullable=True),
        sa.Column("is_free_float", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("rank", sa.Integer(), nullable=True),
        sa.Column("shares", sa.Float(), nullable=True),
        sa.Column("shares_pct", sa.Float(), nullable=True),
        sa.Column("change_shares", sa.Float(), nullable=True),
        sa.Column("change_pct", sa.Float(), nullable=True),
        sa.Column("change_type", sa.String(length=12), nullable=True),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "stock_code", "report_date", "holder_name", "is_free_float",
            name="uq_holder_snapshot",
        ),
    )
    op.create_index(
        "ix_holder_snapshot_quarterly_report_date", "holder_snapshot_quarterly", ["report_date"]
    )
    op.create_index(
        "ix_hs_stock_report", "holder_snapshot_quarterly", ["stock_code", "report_date"]
    )
    op.create_index(
        "ix_hs_canonical", "holder_snapshot_quarterly", ["canonical_name", "report_date"]
    )
    op.create_index(
        "ix_hs_type", "holder_snapshot_quarterly", ["holder_type", "report_date"]
    )
    op.create_index(
        "ix_hs_change", "holder_snapshot_quarterly", ["report_date", "change_type"]
    )

    op.create_table(
        "holder_identity_registry",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("canonical_name", sa.String(length=80), nullable=False),
        sa.Column("holder_type", sa.String(length=20), nullable=False),
        sa.Column("fund_company", sa.String(length=80), nullable=True),
        sa.Column("aliases", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("canonical_name", name="uq_holder_canonical"),
    )
    op.create_index("ix_hir_type", "holder_identity_registry", ["holder_type"])

    # ===== seed: 主力身份注册表 =====
    from app.services.holder_registry_seed import SEED_DATA
    import json

    bind = op.get_bind()
    for canonical, htype, fund_co, aliases, weight, note in SEED_DATA:
        bind.execute(
            sa.text(
                """
                INSERT INTO holder_identity_registry
                    (canonical_name, holder_type, fund_company, aliases, weight, is_active, note)
                VALUES (:cn, :ht, :fc, CAST(:al AS JSONB), :w, TRUE, :note)
                ON CONFLICT (canonical_name) DO NOTHING
                """
            ),
            {
                "cn": canonical,
                "ht": htype,
                "fc": fund_co,
                "al": json.dumps(aliases, ensure_ascii=False),
                "w": weight,
                "note": note or None,
            },
        )


def downgrade() -> None:
    op.drop_index("ix_hir_type", table_name="holder_identity_registry")
    op.drop_table("holder_identity_registry")

    op.drop_index("ix_hs_change", table_name="holder_snapshot_quarterly")
    op.drop_index("ix_hs_type", table_name="holder_snapshot_quarterly")
    op.drop_index("ix_hs_canonical", table_name="holder_snapshot_quarterly")
    op.drop_index("ix_hs_stock_report", table_name="holder_snapshot_quarterly")
    op.drop_index("ix_holder_snapshot_quarterly_report_date", table_name="holder_snapshot_quarterly")
    op.drop_table("holder_snapshot_quarterly")

    op.drop_index("ix_ae_actor", table_name="announcement_event")
    op.drop_index("ix_ae_stock_date", table_name="announcement_event")
    op.drop_index("ix_ae_date_type", table_name="announcement_event")
    op.drop_index("ix_announcement_event_trade_date", table_name="announcement_event")
    op.drop_table("announcement_event")

    op.drop_index("ix_etf_category_date", table_name="etf_flow_daily")
    op.drop_index("ix_etf_date_code", table_name="etf_flow_daily")
    op.drop_index("ix_etf_flow_daily_trade_date", table_name="etf_flow_daily")
    op.drop_table("etf_flow_daily")

    op.drop_index("ix_nh_stock_date", table_name="north_hold_daily")
    op.drop_index("ix_north_hold_daily_trade_date", table_name="north_hold_daily")
    op.drop_table("north_hold_daily")

    op.drop_index("ix_cf_stock_date", table_name="capital_flow_daily")
    op.drop_index("ix_cf_date_scope", table_name="capital_flow_daily")
    op.drop_index("ix_capital_flow_daily_trade_date", table_name="capital_flow_daily")
    op.drop_table("capital_flow_daily")
