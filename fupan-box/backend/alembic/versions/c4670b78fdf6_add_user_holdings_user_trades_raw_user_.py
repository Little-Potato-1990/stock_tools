"""add user_holdings + user_trades_raw + user_import_jobs

Revision ID: c4670b78fdf6
Revises: a8c1d4e5f6b7
Create Date: 2026-04-24 15:52:50.966234

新增三张表，支持「同花顺截图导入持仓 + 交易流水」：
  - user_holdings    : 用户当前持仓快照（rich 版字段，FIFO 反推 first_buy_date / holding_days）
  - user_trades_raw  : 单边交易流水原始记录（OCR/PDF/邮件解析后入库）
  - user_import_jobs : 一次上传的导入作业，给前端做进度展示和重试
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c4670b78fdf6"
down_revision: Union[str, Sequence[str], None] = "a8c1d4e5f6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_holdings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("stock_code", sa.String(length=10), nullable=False),
        sa.Column("stock_name", sa.String(length=50), nullable=True),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("available_qty", sa.Integer(), nullable=True),
        sa.Column("avg_cost", sa.Float(), nullable=True),
        sa.Column("market_price", sa.Float(), nullable=True),
        sa.Column("market_value", sa.Float(), nullable=True),
        sa.Column("pnl", sa.Float(), nullable=True),
        sa.Column("pnl_pct", sa.Float(), nullable=True),
        sa.Column("first_buy_date", sa.Date(), nullable=True),
        sa.Column("holding_days", sa.Integer(), nullable=True),
        sa.Column("account_label", sa.String(length=50), nullable=False, server_default="default"),
        sa.Column("user_tag", sa.String(length=50), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="screenshot"),
        sa.Column("last_sync_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "stock_code", "account_label", name="uq_user_holdings"),
    )
    op.create_index("ix_user_holdings_user", "user_holdings", ["user_id"], unique=False)

    op.create_table(
        "user_trades_raw",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("trade_time", sa.String(length=10), nullable=True),
        sa.Column("stock_code", sa.String(length=10), nullable=False),
        sa.Column("stock_name", sa.String(length=50), nullable=True),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("fee", sa.Float(), nullable=False, server_default="0"),
        sa.Column("stamp_tax", sa.Float(), nullable=False, server_default="0"),
        sa.Column("transfer_fee", sa.Float(), nullable=False, server_default="0"),
        sa.Column("contract_no", sa.String(length=50), nullable=True),
        sa.Column("account_label", sa.String(length=50), nullable=False, server_default="default"),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="screenshot"),
        sa.Column("matched_trade_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["matched_trade_id"], ["user_trades.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_trades_raw_user_date", "user_trades_raw", ["user_id", "trade_date"], unique=False)
    op.create_index("ix_user_trades_raw_user_code", "user_trades_raw", ["user_id", "stock_code"], unique=False)
    # 部分唯一索引: 有 contract_no 时按合同号去重
    op.execute(
        "CREATE UNIQUE INDEX ux_trades_raw_contract "
        "ON user_trades_raw (user_id, contract_no) "
        "WHERE contract_no IS NOT NULL AND contract_no <> ''"
    )
    # 兜底自然去重: 同用户同时刻同代码同方向同价同量, 极少撞
    op.execute(
        "CREATE UNIQUE INDEX ux_trades_raw_natural "
        "ON user_trades_raw (user_id, trade_date, COALESCE(trade_time, ''), stock_code, side, price, qty)"
    )

    op.create_table(
        "user_import_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="screenshot"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("file_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("parsed_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_user_import_jobs_user_created",
        "user_import_jobs",
        ["user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_import_jobs_user_created", table_name="user_import_jobs")
    op.drop_table("user_import_jobs")

    op.execute("DROP INDEX IF EXISTS ux_trades_raw_natural")
    op.execute("DROP INDEX IF EXISTS ux_trades_raw_contract")
    op.drop_index("ix_user_trades_raw_user_code", table_name="user_trades_raw")
    op.drop_index("ix_user_trades_raw_user_date", table_name="user_trades_raw")
    op.drop_table("user_trades_raw")

    op.drop_index("ix_user_holdings_user", table_name="user_holdings")
    op.drop_table("user_holdings")
