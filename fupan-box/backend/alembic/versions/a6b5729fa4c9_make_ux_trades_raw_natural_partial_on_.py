"""make ux_trades_raw_natural partial on null contract_no

Revision ID: a6b5729fa4c9
Revises: c4670b78fdf6
Create Date: 2026-04-24 16:54:07.958150

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a6b5729fa4c9'
down_revision: Union[str, Sequence[str], None] = 'c4670b78fdf6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """让 ux_trades_raw_natural 改为 partial: 仅在 contract_no 为空时生效.

    原索引无条件对 (user_id, date, time, code, side, price, qty) 唯一,
    导致同花顺手机版同时间真实拆单 (如 100/100/400 同 15:00:00 无 contract_no)
    被误判为重复. 修复后:
      - 有 contract_no 的行靠 ux_trades_raw_contract 去重
      - 无 contract_no 的行靠 ux_trades_raw_natural 去重 (含 OCR 注入的 dup-idx)
    """
    op.execute("DROP INDEX IF EXISTS ux_trades_raw_natural")
    op.execute(
        "CREATE UNIQUE INDEX ux_trades_raw_natural "
        "ON user_trades_raw (user_id, trade_date, COALESCE(trade_time, ''), stock_code, side, price, qty) "
        "WHERE contract_no IS NULL OR contract_no = ''"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_trades_raw_natural")
    op.execute(
        "CREATE UNIQUE INDEX ux_trades_raw_natural "
        "ON user_trades_raw (user_id, trade_date, COALESCE(trade_time, ''), stock_code, side, price, qty)"
    )
