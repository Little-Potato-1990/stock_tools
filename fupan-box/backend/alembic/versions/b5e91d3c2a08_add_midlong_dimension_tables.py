"""add midlong dimension tables (fundamentals, forecast, valuation, consensus)

Revision ID: b5e91d3c2a08
Revises: a4f7d20e6b91
Create Date: 2026-04-21 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b5e91d3c2a08"
down_revision: Union[str, Sequence[str], None] = "a4f7d20e6b91"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "stock_fundamentals_quarterly",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("stock_code", sa.String(length=10), nullable=False),
        sa.Column("revenue", sa.Float(), nullable=True),
        sa.Column("revenue_yoy", sa.Float(), nullable=True),
        sa.Column("net_profit", sa.Float(), nullable=True),
        sa.Column("net_profit_yoy", sa.Float(), nullable=True),
        sa.Column("gross_margin", sa.Float(), nullable=True),
        sa.Column("net_margin", sa.Float(), nullable=True),
        sa.Column("roe", sa.Float(), nullable=True),
        sa.Column("roa", sa.Float(), nullable=True),
        sa.Column("debt_ratio", sa.Float(), nullable=True),
        sa.Column("current_ratio", sa.Float(), nullable=True),
        sa.Column("cash_flow_op", sa.Float(), nullable=True),
        sa.Column("cash_flow_op_to_revenue", sa.Float(), nullable=True),
        sa.Column("eps", sa.Float(), nullable=True),
        sa.Column("bps", sa.Float(), nullable=True),
        sa.Column("ann_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stock_code", "report_date", name="uq_fund_quarterly"),
    )
    op.create_index("ix_stock_fundamentals_quarterly_report_date", "stock_fundamentals_quarterly", ["report_date"])
    op.create_index("ix_fund_stock_date", "stock_fundamentals_quarterly", ["stock_code", "report_date"])
    op.create_index("ix_fund_date_roe", "stock_fundamentals_quarterly", ["report_date", "roe"])

    op.create_table(
        "stock_forecast_event",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ann_date", sa.Date(), nullable=False),
        sa.Column("stock_code", sa.String(length=10), nullable=False),
        sa.Column("period", sa.String(length=8), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("nature", sa.String(length=16), nullable=True),
        sa.Column("change_pct_low", sa.Float(), nullable=True),
        sa.Column("change_pct_high", sa.Float(), nullable=True),
        sa.Column("net_profit_low", sa.Float(), nullable=True),
        sa.Column("net_profit_high", sa.Float(), nullable=True),
        sa.Column("last_period_net_profit", sa.Float(), nullable=True),
        sa.Column("summary", sa.String(length=500), nullable=True),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stock_code", "period", "type", "ann_date", name="uq_forecast_event"),
    )
    op.create_index("ix_stock_forecast_event_ann_date", "stock_forecast_event", ["ann_date"])
    op.create_index("ix_fc_stock_period", "stock_forecast_event", ["stock_code", "period"])
    op.create_index("ix_fc_ann", "stock_forecast_event", ["ann_date"])

    op.create_table(
        "stock_valuation_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("stock_code", sa.String(length=10), nullable=False),
        sa.Column("pe", sa.Float(), nullable=True),
        sa.Column("pe_ttm", sa.Float(), nullable=True),
        sa.Column("pb", sa.Float(), nullable=True),
        sa.Column("ps", sa.Float(), nullable=True),
        sa.Column("ps_ttm", sa.Float(), nullable=True),
        sa.Column("dv_ratio", sa.Float(), nullable=True),
        sa.Column("dv_ttm", sa.Float(), nullable=True),
        sa.Column("total_share", sa.Float(), nullable=True),
        sa.Column("float_share", sa.Float(), nullable=True),
        sa.Column("free_share", sa.Float(), nullable=True),
        sa.Column("total_mv", sa.Float(), nullable=True),
        sa.Column("circ_mv", sa.Float(), nullable=True),
        sa.Column("pe_pct_5y", sa.Float(), nullable=True),
        sa.Column("pb_pct_5y", sa.Float(), nullable=True),
        sa.Column("pe_pct_3y", sa.Float(), nullable=True),
        sa.Column("pb_pct_3y", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("trade_date", "stock_code", name="uq_valuation_daily"),
    )
    op.create_index("ix_stock_valuation_daily_trade_date", "stock_valuation_daily", ["trade_date"])
    op.create_index("ix_val_stock_date", "stock_valuation_daily", ["stock_code", "trade_date"])
    op.create_index("ix_val_date_pe", "stock_valuation_daily", ["trade_date", "pe_ttm"])
    op.create_index("ix_val_date_pb_pct", "stock_valuation_daily", ["trade_date", "pb_pct_5y"])

    op.create_table(
        "analyst_consensus_weekly",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("week_end", sa.Date(), nullable=False),
        sa.Column("stock_code", sa.String(length=10), nullable=False),
        sa.Column("target_price_avg", sa.Float(), nullable=True),
        sa.Column("target_price_median", sa.Float(), nullable=True),
        sa.Column("target_price_min", sa.Float(), nullable=True),
        sa.Column("target_price_max", sa.Float(), nullable=True),
        sa.Column("target_price_chg_4w_pct", sa.Float(), nullable=True),
        sa.Column("eps_fy1", sa.Float(), nullable=True),
        sa.Column("eps_fy2", sa.Float(), nullable=True),
        sa.Column("eps_fy3", sa.Float(), nullable=True),
        sa.Column("eps_fy1_chg_4w_pct", sa.Float(), nullable=True),
        sa.Column("rating_buy", sa.Integer(), nullable=True),
        sa.Column("rating_outperform", sa.Integer(), nullable=True),
        sa.Column("rating_hold", sa.Integer(), nullable=True),
        sa.Column("rating_underperform", sa.Integer(), nullable=True),
        sa.Column("rating_sell", sa.Integer(), nullable=True),
        sa.Column("report_count", sa.Integer(), nullable=True),
        sa.Column("institution_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("week_end", "stock_code", name="uq_consensus_weekly"),
    )
    op.create_index("ix_analyst_consensus_weekly_week_end", "analyst_consensus_weekly", ["week_end"])
    op.create_index("ix_consensus_stock_week", "analyst_consensus_weekly", ["stock_code", "week_end"])
    op.create_index("ix_consensus_week_chg", "analyst_consensus_weekly", ["week_end", "target_price_chg_4w_pct"])


def downgrade() -> None:
    op.drop_index("ix_consensus_week_chg", table_name="analyst_consensus_weekly")
    op.drop_index("ix_consensus_stock_week", table_name="analyst_consensus_weekly")
    op.drop_index("ix_analyst_consensus_weekly_week_end", table_name="analyst_consensus_weekly")
    op.drop_table("analyst_consensus_weekly")

    op.drop_index("ix_val_date_pb_pct", table_name="stock_valuation_daily")
    op.drop_index("ix_val_date_pe", table_name="stock_valuation_daily")
    op.drop_index("ix_val_stock_date", table_name="stock_valuation_daily")
    op.drop_index("ix_stock_valuation_daily_trade_date", table_name="stock_valuation_daily")
    op.drop_table("stock_valuation_daily")

    op.drop_index("ix_fc_ann", table_name="stock_forecast_event")
    op.drop_index("ix_fc_stock_period", table_name="stock_forecast_event")
    op.drop_index("ix_stock_forecast_event_ann_date", table_name="stock_forecast_event")
    op.drop_table("stock_forecast_event")

    op.drop_index("ix_fund_date_roe", table_name="stock_fundamentals_quarterly")
    op.drop_index("ix_fund_stock_date", table_name="stock_fundamentals_quarterly")
    op.drop_index("ix_stock_fundamentals_quarterly_report_date", table_name="stock_fundamentals_quarterly")
    op.drop_table("stock_fundamentals_quarterly")
