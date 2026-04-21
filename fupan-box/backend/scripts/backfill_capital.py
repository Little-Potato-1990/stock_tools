"""回填日频资金数据(capital_flow_daily / north_hold_daily / etf_flow_daily).

用法:
    cd backend
    .venv/bin/python scripts/backfill_capital.py
    .venv/bin/python scripts/backfill_capital.py 2026-04-01 2026-04-21

注意: akshare 的资金接口大多只返回当日, 历史回填依赖各接口实际能力.
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base
from app.pipeline.runner import (
    get_adapter,
    _step_collect_capital,
    _step_collect_north_hold,
    _step_collect_etf,
)


def _date_range(start, end):
    out, cur = [], start
    while cur <= end:
        if cur.weekday() < 5:
            out.append(cur)
        cur += timedelta(days=1)
    return out


def main():
    args = sys.argv[1:]
    if len(args) >= 2:
        start = date.fromisoformat(args[0])
        end = date.fromisoformat(args[1])
        days = _date_range(start, end)
    elif len(args) == 1:
        days = [date.fromisoformat(args[0])]
    else:
        end = date.today()
        days = _date_range(end - timedelta(days=7), end)

    if not days:
        print("[backfill_capital] no trading day in range")
        return

    eng = create_engine(get_settings().database_url_sync)
    Base.metadata.create_all(eng)
    adapter = get_adapter()

    with Session(eng) as session:
        for d in days:
            print(f"[backfill_capital] {d}")
            _step_collect_capital(session, adapter, d)
            _step_collect_north_hold(session, adapter, d)
            _step_collect_etf(session, adapter, d)
    print("[backfill_capital] done")


if __name__ == "__main__":
    main()
