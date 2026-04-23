"""add status / delist_date / board to stocks + pg_trgm + indexes

Revision ID: a8c1d4e5f6b7
Revises: f1a2b3c4d5e6
Create Date: 2026-04-23 18:00:00.000000

为 plan §2/§3 服务：
- stocks.status: listed_active / st / star_st / suspended / delisted
- stocks.delist_date: 退市日期
- stocks.board: 主板 / 创业板 / 科创板 / 北交所
- 复合索引: (status), (status, delist_date), (board, status)
- pg_trgm 扩展 + stocks.name 模糊搜索 GIN 索引
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8c1d4e5f6b7"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.add_column(
        "stocks",
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="listed_active",
        ),
    )
    op.add_column(
        "stocks",
        sa.Column("delist_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "stocks",
        sa.Column("board", sa.String(length=16), nullable=True),
    )

    op.create_index("ix_stocks_status", "stocks", ["status"])
    op.create_index(
        "ix_stocks_status_delist", "stocks", ["status", "delist_date"]
    )
    op.create_index("ix_stocks_board_status", "stocks", ["board", "status"])

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_stocks_name_trgm "
        "ON stocks USING gin (name gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_stocks_code_trgm "
        "ON stocks USING gin (code gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_stocks_code_trgm")
    op.execute("DROP INDEX IF EXISTS ix_stocks_name_trgm")
    op.drop_index("ix_stocks_board_status", table_name="stocks")
    op.drop_index("ix_stocks_status_delist", table_name="stocks")
    op.drop_index("ix_stocks_status", table_name="stocks")
    op.drop_column("stocks", "board")
    op.drop_column("stocks", "delist_date")
    op.drop_column("stocks", "status")
