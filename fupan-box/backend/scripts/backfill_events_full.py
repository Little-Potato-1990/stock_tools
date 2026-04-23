"""backfill_events_full.py — Phase 1.19

按 trade_date 调 _step_collect_announce 把公司事件 (announcement_event) 入库。
封装在共享框架里，支持 --resume / --reverse / --rate / --limit-days。
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session

from app.pipeline.runner import _step_collect_announce, get_adapter
from scripts._backfill_common import (
    RateLimiter,
    db_engine,
    iter_trade_dates,
    parse_args,
    setup_logging,
)


logger = setup_logging("backfill_events_full")


def main() -> int:
    args = parse_args(default_start="20100101")
    start = date(*map(int, [args.start[:4], args.start[4:6], args.start[6:8]]))
    end = date(*map(int, [args.end[:4], args.end[4:6], args.end[6:8]]))

    logger.info(
        f"backfill_events_full {start} → {end} reverse={args.reverse}"
    )

    adapter = get_adapter()
    limiter = RateLimiter(args.rate)
    eng = db_engine()
    n = 0
    with Session(eng) as s:
        for td in iter_trade_dates(start, end, descending=args.reverse):
            if args.limit_days and n >= args.limit_days:
                break
            limiter.wait()
            try:
                _step_collect_announce(s, adapter, td)
                s.commit()
            except Exception as e:
                s.rollback()
                logger.error(f"{td}: {e}")
                continue
            n += 1
            if n % 50 == 0:
                logger.info(f"progress: {n} days ({td})")
    logger.info(f"DONE. days={n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
