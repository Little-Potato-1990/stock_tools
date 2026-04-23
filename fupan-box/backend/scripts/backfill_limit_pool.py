"""backfill_limit_pool.py — Phase 1.5

按 trade_date 调 pro.limit_list_d，拆出涨停 / 跌停明细，upsert 到 limit_up_records /
limit_down_records 表。

复用 TushareAdapter.fetch_limit_up / fetch_limit_down 的全部解析逻辑（KPL 拼接、
一字板判定、连板数解析等）。
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models.market import LimitDownRecord, LimitUpRecord
from app.pipeline.tushare_adapter import TushareAdapter
from scripts._backfill_common import (
    RateLimiter,
    db_engine,
    existing_dates,
    iter_trade_dates,
    log_step,
    parse_args,
    setup_logging,
)


logger = setup_logging("backfill_limit_pool")


def write_one_day(s: Session, td: date, lus: list, lds: list[str]) -> int:
    s.execute(delete(LimitUpRecord).where(LimitUpRecord.trade_date == td))
    for r in lus:
        s.add(
            LimitUpRecord(
                stock_code=r.stock_code,
                stock_name=r.stock_name,
                trade_date=td,
                continuous_days=r.continuous_days,
                first_limit_time=r.first_limit_time,
                last_limit_time=r.last_limit_time,
                open_count=r.open_count,
                limit_order_amount=r.limit_order_amount,
                is_one_word=r.is_one_word,
                is_t_board=r.is_t_board,
                limit_reason=r.limit_reason,
                theme_names=r.theme_names,
                industry=r.industry,
            )
        )
    s.execute(delete(LimitDownRecord).where(LimitDownRecord.trade_date == td))
    for code in lds:
        s.add(LimitDownRecord(stock_code=code, trade_date=td))
    s.commit()
    return len(lus) + len(lds)


def main() -> int:
    args = parse_args(default_start="20050101")
    start = date(*map(int, [args.start[:4], args.start[4:6], args.start[6:8]]))
    end = date(*map(int, [args.end[:4], args.end[4:6], args.end[6:8]]))

    logger.info(
        f"backfill_limit_pool {start} → {end} resume={args.resume} reverse={args.reverse}"
    )

    skip_set: set[date] = set()
    if args.resume:
        skip_set = existing_dates("limit_up_records") | existing_dates(
            "limit_down_records"
        )
        logger.info(f"resume: skipping {len(skip_set)} dates")

    adapter = TushareAdapter()
    limiter = RateLimiter(args.rate)
    eng = db_engine()

    n_days = 0
    total_rows = 0
    with Session(eng) as s:
        for td in iter_trade_dates(start, end, descending=args.reverse):
            if td in skip_set:
                continue
            if args.limit_days and n_days >= args.limit_days:
                break
            limiter.wait()
            try:
                lus = adapter.fetch_limit_up(td)
            except Exception as e:
                logger.error(f"{td}: limit_up fetch failed: {e}")
                lus = []
            limiter.wait()
            try:
                lds = adapter.fetch_limit_down(td)
            except Exception as e:
                logger.error(f"{td}: limit_down fetch failed: {e}")
                lds = []
            if not lus and not lds:
                logger.warning(f"{td}: no limit data")
                log_step(td, "backfill_limit_pool", "empty", 0)
                n_days += 1
                continue
            try:
                n = write_one_day(s, td, lus, lds)
            except Exception as e:
                s.rollback()
                logger.error(f"{td}: write failed: {e}")
                log_step(td, "backfill_limit_pool", "failed", 0, str(e))
                continue
            total_rows += n
            n_days += 1
            log_step(td, "backfill_limit_pool", "success", n)
            if n_days % 50 == 0:
                logger.info(f"progress: {n_days} days, {total_rows} rows ({td})")
            else:
                logger.info(f"{td}: lu={len(lus)} ld={len(lds)}")

    logger.info(f"DONE. days={n_days}, rows={total_rows}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
