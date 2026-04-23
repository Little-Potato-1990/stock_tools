"""backfill_holders_full.py — Phase 1.11

按报告期循环调用 run_quarterly_pipeline，把全 A 的十大/流通十大股东历史快照入库
holder_snapshot_quarterly。

报告期：默认从 2010-03-31 一路跑到最新已披露季度（每年 4 个：3/31, 6/30, 9/30, 12/31）。
每季度内部 run_quarterly_pipeline 自己跑全市场。
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.pipeline.quarterly_runner import _latest_report_date, run_quarterly_pipeline
from scripts._backfill_common import setup_logging


logger = setup_logging("backfill_holders_full")


def quarter_dates(start_year: int, end_quarter: date) -> list[date]:
    out: list[date] = []
    for y in range(start_year, end_quarter.year + 1):
        for m, d in [(3, 31), (6, 30), (9, 30), (12, 31)]:
            rd = date(y, m, d)
            if rd > end_quarter:
                break
            out.append(rd)
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--start-year", type=int, default=2010)
    p.add_argument("--reverse", action="store_true", help="新→旧")
    args = p.parse_args()

    quarters = quarter_dates(args.start_year, _latest_report_date())
    if args.reverse:
        quarters = list(reversed(quarters))
    logger.info(f"backfill_holders_full quarters: {quarters[0]} → {quarters[-1]} (n={len(quarters)})")

    for rd in quarters:
        logger.info(f"=== quarter {rd} ===")
        try:
            run_quarterly_pipeline(report_date=rd)
        except Exception as e:
            logger.error(f"quarter {rd} failed: {e}")
    logger.info("DONE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
