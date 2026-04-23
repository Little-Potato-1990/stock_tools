"""backfill_index_board_full.py — Phase 1.15

按 trade_date 调 fetch_concept_board_daily / fetch_industry_board_daily,
持久化为 DailySnapshot(snapshot_type='themes' / 'industries').

Tushare dc_index 一般 5+ 年历史；早年部分概念可能没有。
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import delete, text
from sqlalchemy.orm import Session

from app.models.snapshot import DailySnapshot
from app.pipeline.tushare_adapter import TushareAdapter
from scripts._backfill_common import (
    RateLimiter,
    db_engine,
    iter_trade_dates,
    log_step,
    parse_args,
    setup_logging,
)


logger = setup_logging("backfill_index_board_full")


def existing_snapshot_dates(types: list[str]) -> set[date]:
    eng = db_engine()
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT DISTINCT trade_date FROM daily_snapshots "
                "WHERE snapshot_type = ANY(:t)"
            ),
            {"t": types},
        ).fetchall()
    return {r[0] for r in rows if r[0]}


def main() -> int:
    args = parse_args(default_start="20180101")
    start = date(*map(int, [args.start[:4], args.start[4:6], args.start[6:8]]))
    end = date(*map(int, [args.end[:4], args.end[4:6], args.end[6:8]]))

    logger.info(
        f"backfill_index_board_full {start} → {end} resume={args.resume} reverse={args.reverse}"
    )
    skip_set: set[date] = set()
    if args.resume:
        skip_set = existing_snapshot_dates(["themes", "industries"])
        logger.info(f"resume: skipping {len(skip_set)} dates with themes+industries")

    adapter = TushareAdapter()
    limiter = RateLimiter(args.rate)
    eng = db_engine()
    n_days = 0
    with Session(eng) as s:
        for td in iter_trade_dates(start, end, descending=args.reverse):
            if td in skip_set:
                continue
            if args.limit_days and n_days >= args.limit_days:
                break
            limiter.wait()
            try:
                concepts = adapter.fetch_concept_board_daily(td) or []
            except Exception as e:
                logger.error(f"{td}: concept failed: {e}")
                concepts = []
            limiter.wait()
            try:
                inds = adapter.fetch_industry_board_daily(td) or []
            except Exception as e:
                logger.error(f"{td}: industry failed: {e}")
                inds = []
            if not concepts and not inds:
                logger.warning(f"{td}: empty")
                log_step(td, "backfill_index_board", "empty", 0)
                n_days += 1
                continue

            try:
                if concepts:
                    top_t = sorted(
                        concepts, key=lambda x: x["change_pct"], reverse=True
                    )[:50]
                    bot_t = sorted(concepts, key=lambda x: x["change_pct"])[:20]
                    s.execute(
                        delete(DailySnapshot).where(
                            DailySnapshot.trade_date == td,
                            DailySnapshot.snapshot_type == "themes",
                        )
                    )
                    s.add(
                        DailySnapshot(
                            trade_date=td,
                            snapshot_type="themes",
                            data={
                                "total_count": len(concepts),
                                "top": top_t,
                                "bottom": bot_t,
                            },
                        )
                    )
                if inds:
                    top_i = sorted(inds, key=lambda x: x["change_pct"], reverse=True)[
                        :50
                    ]
                    bot_i = sorted(inds, key=lambda x: x["change_pct"])[:20]
                    s.execute(
                        delete(DailySnapshot).where(
                            DailySnapshot.trade_date == td,
                            DailySnapshot.snapshot_type == "industries",
                        )
                    )
                    s.add(
                        DailySnapshot(
                            trade_date=td,
                            snapshot_type="industries",
                            data={
                                "total_count": len(inds),
                                "top": top_i,
                                "bottom": bot_i,
                            },
                        )
                    )
                s.commit()
            except Exception as e:
                s.rollback()
                logger.error(f"{td}: persist failed: {e}")
                log_step(td, "backfill_index_board", "failed", 0, str(e))
                continue

            n_days += 1
            log_step(
                td,
                "backfill_index_board",
                "success",
                len(concepts) + len(inds),
            )
            if n_days % 50 == 0:
                logger.info(
                    f"progress: {n_days} days ({td} concepts={len(concepts)} inds={len(inds)})"
                )
            else:
                logger.info(f"{td}: concepts={len(concepts)} inds={len(inds)}")

    logger.info(f"DONE. days={n_days}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
