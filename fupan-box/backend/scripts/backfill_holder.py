"""回填季报股东快照(holder_snapshot_quarterly) + 主力身份匹配.

用法:
    .venv/bin/python scripts/backfill_holder.py                              # 最新可用季度全市场
    .venv/bin/python scripts/backfill_holder.py 2025-12-31                   # 指定季度
    .venv/bin/python scripts/backfill_holder.py 2025-12-31 --limit 50        # 抽样 50 只(开发)
    .venv/bin/python scripts/backfill_holder.py 2025-12-31 600519,000001     # 指定股票
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.pipeline.quarterly_runner import run_quarterly_pipeline


def main():
    args = sys.argv[1:]
    rd = None
    codes = None
    limit = None

    if args and args[0] != "--limit":
        try:
            rd = date.fromisoformat(args[0])
            args = args[1:]
        except ValueError:
            pass

    while args:
        cur = args.pop(0)
        if cur == "--limit":
            limit = int(args.pop(0))
        elif "," in cur:
            codes = [c.strip() for c in cur.split(",") if c.strip()]
        elif len(cur) == 6 and cur.isdigit():
            codes = [cur]

    print(f"[backfill_holder] report_date={rd} codes={codes} limit={limit}")
    run_quarterly_pipeline(report_date=rd, stock_codes=codes, limit=limit)
    print("[backfill_holder] done")


if __name__ == "__main__":
    main()
