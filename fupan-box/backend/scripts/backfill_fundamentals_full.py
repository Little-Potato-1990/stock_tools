"""backfill_fundamentals_full.py — Phase 1.9

调用 app.pipeline.midlong_runner.run_fundamentals_pipeline(history_years=N) 把
全 A 股票的 fina_indicator + income + cashflow 拉入 stock_fundamentals_quarterly.

默认 history_years=20（覆盖披露起以来全部）。可分批跑（--batch-size），降低单进程
长时间风险。

幂等：底层用 ON CONFLICT DO UPDATE。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.pipeline.midlong_runner import run_fundamentals_pipeline
from app.models.stock import Stock
from scripts._backfill_common import db_engine, setup_logging


logger = setup_logging("backfill_fundamentals_full")


def all_codes(include_delisted: bool = True) -> list[str]:
    eng = db_engine()
    with Session(eng) as s:
        q = select(Stock.code)
        if not include_delisted:
            q = q.where(Stock.status != "delisted")
        return [c for (c,) in s.execute(q).all() if c]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--history-years", type=int, default=20)
    p.add_argument("--batch-size", type=int, default=500)
    p.add_argument("--start-batch", type=int, default=0)
    p.add_argument(
        "--exclude-delisted",
        action="store_true",
        help="跳过退市股（默认包含）",
    )
    args = p.parse_args()

    codes = all_codes(include_delisted=not args.exclude_delisted)
    logger.info(f"total stocks: {len(codes)}; batch={args.batch_size} from {args.start_batch}")

    n_batches = (len(codes) + args.batch_size - 1) // args.batch_size
    for b in range(args.start_batch, n_batches):
        chunk = codes[b * args.batch_size : (b + 1) * args.batch_size]
        logger.info(f"=== batch {b+1}/{n_batches} ({len(chunk)} stocks) ===")
        try:
            run_fundamentals_pipeline(
                stock_codes=chunk, history_years=args.history_years
            )
        except Exception as e:
            logger.error(f"batch {b+1} failed: {e}")
    logger.info("DONE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
