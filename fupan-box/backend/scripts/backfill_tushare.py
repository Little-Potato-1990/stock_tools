"""走完整 pipeline 的历史回填脚本（推荐 tushare 数据源使用）。

与旧版 backfill_history.py 的区别：
- 直接调用 run_daily_pipeline，所以会写入完整的 4 类快照
  (overview / ladder / themes / industries)，前端"热点题材"等模块
  历史数据全部可用。
- 自动跳过非交易日（依赖 adapter.is_trading_day）。
- 失败的日期会打印错误并继续，不会中断整批。

用法:
    DATA_SOURCE=tushare python -m scripts.backfill_tushare --days 30
    DATA_SOURCE=tushare python -m scripts.backfill_tushare --days 30 --force
    DATA_SOURCE=tushare python -m scripts.backfill_tushare --start 20260301 --end 20260417
"""

from __future__ import annotations

import argparse
import sys
import traceback
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base
from app.models.snapshot import DailySnapshot
from app.pipeline.runner import get_adapter, run_daily_pipeline


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y%m%d").date()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30,
                        help="从今天往回数多少个自然日（与 --start/--end 二选一）")
    parser.add_argument("--start", type=str, default=None, help="起始日期 YYYYMMDD")
    parser.add_argument("--end", type=str, default=None, help="结束日期 YYYYMMDD")
    parser.add_argument("--force", action="store_true",
                        help="覆盖已存在的日期（默认跳过 overview 快照已存在的日期）")
    parser.add_argument("--max-failures", type=int, default=10,
                        help="累计失败次数超过该值则中断（避免 token 失效时狂跑）")
    args = parser.parse_args()

    settings = get_settings()
    if settings.data_source != "tushare":
        print(f"warn: DATA_SOURCE={settings.data_source}, 推荐使用 tushare")

    engine = create_engine(settings.database_url_sync)
    Base.metadata.create_all(engine)
    adapter = get_adapter()

    if args.start and args.end:
        start = _parse_date(args.start)
        end = _parse_date(args.end)
        if start > end:
            start, end = end, start
        candidates = []
        cur = start
        while cur <= end:
            candidates.append(cur)
            cur += timedelta(days=1)
    else:
        end = date.today()
        candidates = [end - timedelta(days=i) for i in range(1, args.days + 1)]
        candidates.sort()

    targets = [d for d in candidates if adapter.is_trading_day(d)]
    if not targets:
        print("no trading days in range")
        return

    with Session(engine) as session:
        existing = set(
            session.execute(
                select(DailySnapshot.trade_date).where(
                    DailySnapshot.snapshot_type == "overview"
                )
            ).scalars().all()
        )

    print(f"Source : {settings.data_source}")
    print(f"Range  : {targets[0]} → {targets[-1]} ({len(targets)} trading days)")
    print(f"Existing overview rows: {len(existing)}")

    done = skipped = failed = 0
    failures: list[tuple[date, str]] = []
    for d in targets:
        if d in existing and not args.force:
            skipped += 1
            print(f"[{d}] skip (exists)")
            continue
        try:
            print(f"[{d}] running pipeline ... ", end="", flush=True)
            run_daily_pipeline(d)
            done += 1
            print("ok")
        except Exception as e:
            failed += 1
            failures.append((d, f"{type(e).__name__}: {e}"))
            print(f"FAIL {type(e).__name__}: {e}")
            if failed >= args.max_failures:
                print(f"\nabort: failures reached --max-failures={args.max_failures}")
                break

    print(f"\nDone. ok={done} skipped={skipped} failed={failed}")
    if failures:
        print("Failures:")
        for d, msg in failures:
            print(f"  {d}: {msg}")


if __name__ == "__main__":
    main()
