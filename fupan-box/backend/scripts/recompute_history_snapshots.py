"""recompute_history_snapshots.py — Phase 1.5

按 trade_date 循环跑 _step_compute + _step_aggregate，让历史的
overview/ladder/themes/industries/sentiment/ladder_summary 全部依据已落库的
daily_quotes + limit_up/down + LHB 数据重算一遍。

注意：
- 这一步**不依赖 Tushare**（除了 _step_aggregate 内部可能调 fetch_concept/industry_board，
  本脚本通过 --skip-aggregate-board 避免）。
- 必须在 backfill_daily_quotes + backfill_limit_pool 跑完目标日期范围后再跑。
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session

from app.pipeline.runner import _step_aggregate, _step_compute, get_adapter
from scripts._backfill_common import (
    db_engine,
    iter_trade_dates,
    setup_logging,
)


logger = setup_logging("recompute_history_snapshots")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--start", default="20100101")
    p.add_argument("--end", default=date.today().strftime("%Y%m%d"))
    p.add_argument("--reverse", action="store_true")
    p.add_argument(
        "--limit-days", type=int, default=0, help="0=不限制"
    )
    args = p.parse_args()

    start = date(*map(int, [args.start[:4], args.start[4:6], args.start[6:8]]))
    end = date(*map(int, [args.end[:4], args.end[4:6], args.end[6:8]]))
    logger.info(f"recompute_history_snapshots {start} → {end}")

    adapter = get_adapter()
    eng = db_engine()
    n = 0
    with Session(eng) as s:
        for td in iter_trade_dates(start, end, descending=args.reverse):
            if args.limit_days and n >= args.limit_days:
                break
            try:
                _step_compute(s, td)
                _step_aggregate(s, adapter, td)
                s.commit()
            except Exception as e:
                s.rollback()
                logger.error(f"{td}: {e}")
                continue
            n += 1
            if n % 50 == 0:
                logger.info(f"progress: {n} days ({td})")
            else:
                logger.info(f"{td}: ok")
    logger.info(f"DONE. days={n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
