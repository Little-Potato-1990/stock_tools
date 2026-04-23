"""backfill_capital_full.py — Phase 1.13 + Phase 1.17

按 trade_date 循环，调用 runner._step_collect_capital / _step_collect_north_hold /
_step_collect_etf 把日频资金 + 北向 + ETF 数据回填到对应表。

支持选择性跳过某一类（避免对某接口的反复无效请求）：
  --skip-capital --skip-north --skip-etf
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session

from app.pipeline.runner import (
    _step_collect_capital,
    _step_collect_etf,
    _step_collect_north_hold,
    get_adapter,
)
from scripts._backfill_common import (
    RateLimiter,
    db_engine,
    iter_trade_dates,
    setup_logging,
)


logger = setup_logging("backfill_capital_full")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--start", default="20141117", help="北向自 2014-11-17")
    p.add_argument("--end", default=date.today().strftime("%Y%m%d"))
    p.add_argument("--rate", type=int, default=60)
    p.add_argument("--reverse", action="store_true")
    p.add_argument("--skip-capital", action="store_true")
    p.add_argument("--skip-north", action="store_true")
    p.add_argument("--skip-etf", action="store_true")
    args = p.parse_args()

    start = date(*map(int, [args.start[:4], args.start[4:6], args.start[6:8]]))
    end = date(*map(int, [args.end[:4], args.end[4:6], args.end[6:8]]))
    logger.info(f"backfill_capital_full {start} → {end}")

    adapter = get_adapter()
    limiter = RateLimiter(args.rate)
    eng = db_engine()
    n = 0
    with Session(eng) as s:
        for td in iter_trade_dates(start, end, descending=args.reverse):
            limiter.wait()
            try:
                if not args.skip_capital:
                    _step_collect_capital(s, adapter, td)
                if not args.skip_north:
                    _step_collect_north_hold(s, adapter, td)
                if not args.skip_etf:
                    _step_collect_etf(s, adapter, td)
                n += 1
                if n % 50 == 0:
                    logger.info(f"progress: {n} days ({td})")
            except Exception as e:
                logger.error(f"{td}: {e}")
    logger.info(f"DONE. days={n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
