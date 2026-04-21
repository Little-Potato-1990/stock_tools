"""回填公告事件流(announcement_event).

用法:
    .venv/bin/python scripts/backfill_announce.py
    .venv/bin/python scripts/backfill_announce.py 2026-04-01 2026-04-21
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
from app.pipeline.runner import get_adapter, _step_collect_announce


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
        days = _date_range(end - timedelta(days=14), end)

    eng = create_engine(get_settings().database_url_sync)
    Base.metadata.create_all(eng)
    adapter = get_adapter()

    with Session(eng) as session:
        for d in days:
            print(f"[backfill_announce] {d}")
            _step_collect_announce(session, adapter, d)
    print("[backfill_announce] done")


if __name__ == "__main__":
    main()
