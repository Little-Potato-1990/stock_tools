"""backfill_daily_basic.py — Phase 1.3

按 trade_date 调 pro.daily_basic 全字段（PE/PE_TTM/PB/PS/总市值/流通市值/总股本…），
upsert 到 stock_valuation_daily 表。

复用 app.pipeline.tushare_pro_adapter.TusharePioAdapter.fetch_daily_basic_full +
midlong_runner.run_valuation_pipeline 的 upsert SQL 逻辑。
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.valuation import StockValuationDaily
from app.pipeline.tushare_pro_adapter import TusharePioAdapter
from scripts._backfill_common import (
    RateLimiter,
    db_engine,
    existing_dates,
    iter_trade_dates,
    log_step,
    parse_args,
    setup_logging,
)


logger = setup_logging("backfill_daily_basic")


def upsert(rows: list[dict]) -> int:
    if not rows:
        return 0
    eng = db_engine()
    with eng.begin() as conn:
        for chunk_start in range(0, len(rows), 1000):
            chunk = rows[chunk_start : chunk_start + 1000]
            stmt = pg_insert(StockValuationDaily.__table__).values(chunk)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_valuation_daily",
                set_={
                    c.name: stmt.excluded[c.name]
                    for c in StockValuationDaily.__table__.columns
                    if c.name
                    not in (
                        "id",
                        "created_at",
                        "stock_code",
                        "trade_date",
                        "pe_pct_5y",
                        "pb_pct_5y",
                        "pe_pct_3y",
                        "pb_pct_3y",
                    )
                },
            )
            conn.execute(stmt)
    return len(rows)


def main() -> int:
    args = parse_args(default_start="20000101")
    start = date(*map(int, [args.start[:4], args.start[4:6], args.start[6:8]]))
    end = date(*map(int, [args.end[:4], args.end[4:6], args.end[6:8]]))

    logger.info(
        f"backfill_daily_basic {start} → {end} resume={args.resume} reverse={args.reverse}"
    )

    skip_set: set[date] = set()
    if args.resume:
        skip_set = existing_dates("stock_valuation_daily")
        logger.info(f"resume: skipping {len(skip_set)} dates already in stock_valuation_daily")

    adapter = TusharePioAdapter()
    limiter = RateLimiter(args.rate)

    n_days = 0
    total_rows = 0
    for td in iter_trade_dates(start, end, descending=args.reverse):
        if td in skip_set:
            continue
        if args.limit_days and n_days >= args.limit_days:
            break
        limiter.wait()
        try:
            rows = adapter.fetch_daily_basic_full(td)
        except Exception as e:
            logger.error(f"{td}: fetch failed: {e}")
            log_step(td, "backfill_daily_basic", "failed", 0, str(e))
            continue
        if not rows:
            logger.warning(f"{td}: no data")
            log_step(td, "backfill_daily_basic", "empty", 0)
            n_days += 1
            continue
        try:
            inserted = upsert(rows)
        except Exception as e:
            logger.error(f"{td}: upsert failed: {e}")
            log_step(td, "backfill_daily_basic", "failed", 0, str(e))
            continue
        total_rows += inserted
        n_days += 1
        log_step(td, "backfill_daily_basic", "success", inserted)
        if n_days % 20 == 0:
            logger.info(f"progress: {n_days} days, {total_rows} rows ({td})")
        else:
            logger.info(f"{td}: +{inserted}")

    logger.info(f"DONE. days={n_days}, rows={total_rows}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
