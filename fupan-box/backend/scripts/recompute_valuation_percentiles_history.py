"""recompute_valuation_percentiles_history.py — Phase 1.5

按月遍历，调用 midlong_runner.recompute_valuation_percentiles 重算每月最后一个
交易日的 5y/3y PE/PB 分位（窗口函数 percent_rank()，纯 SQL）。

适合在 backfill_daily_basic 跑完至少 5 年数据后，按月批量回填分位字段。
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.models.valuation import StockValuationDaily
from app.pipeline.midlong_runner import recompute_valuation_percentiles
from scripts._backfill_common import db_engine, setup_logging


logger = setup_logging("recompute_valuation_percentiles_history")


def month_ends(start: date, end: date) -> list[date]:
    """返回 [start, end] 区间每个月最后一天（自然日）。"""
    out: list[date] = []
    y, m = start.year, start.month
    while True:
        if m == 12:
            ny, nm = y + 1, 1
        else:
            ny, nm = y, m + 1
        last = date(ny, nm, 1)
        # last day of (y, m) = (ny, nm, 1) - 1 day
        from datetime import timedelta

        last = last - timedelta(days=1)
        if last > end:
            break
        if last >= start:
            out.append(last)
        if (y, m) >= (end.year, end.month):
            break
        y, m = ny, nm
    return out


def nearest_trade_date(s: Session, target: date) -> date | None:
    row = s.execute(
        select(func.max(StockValuationDaily.trade_date)).where(
            StockValuationDaily.trade_date <= target
        )
    ).scalar_one_or_none()
    return row


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--start", default="20100101")
    p.add_argument("--end", default=date.today().strftime("%Y%m%d"))
    p.add_argument("--reverse", action="store_true")
    args = p.parse_args()

    start = date(*map(int, [args.start[:4], args.start[4:6], args.start[6:8]]))
    end = date(*map(int, [args.end[:4], args.end[4:6], args.end[6:8]]))
    months = month_ends(start, end)
    if args.reverse:
        months = list(reversed(months))
    logger.info(f"month-ends to recompute: {len(months)} ({months[0]} → {months[-1]})")

    eng = db_engine()
    n = 0
    with Session(eng) as s:
        for m in months:
            td = nearest_trade_date(s, m)
            if not td:
                logger.warning(f"no valuation data ≤ {m}, skip")
                continue
            try:
                recompute_valuation_percentiles(td)
                n += 1
                logger.info(f"{m} (≤ trade_date={td}): ok")
            except Exception as e:
                logger.error(f"{m}: {e}")
    logger.info(f"DONE. recomputed {n} month-ends")
    return 0


if __name__ == "__main__":
    sys.exit(main())
