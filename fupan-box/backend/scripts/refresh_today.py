"""手动 / cron 触发: 重跑当日 pipeline + 重建 4 类 AI brief.

替代未启动的 celery beat. 用法:
    cd backend
    .venv/bin/python scripts/refresh_today.py            # 跑今天
    .venv/bin/python scripts/refresh_today.py 2026-04-21 # 跑指定日

设计:
- 删除当日 ladder_brief/theme_brief/sentiment_brief/market_brief 缓存, 强制重建
- 重跑 pipeline (会拉 tushare 最新数据并 upsert)
- 调 prewarm_market_briefs 重生成 4 类 brief
"""
from __future__ import annotations

import asyncio
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, delete

from app.config import get_settings
from app.models.ai_cache import AIBriefCache
from app.pipeline.runner import run_daily_pipeline
from app.services.prewarm_service import prewarm_market_briefs


def _purge_cache_for(td: date) -> int:
    eng = create_engine(get_settings().database_url_sync)
    targets = [
        f"market_brief:{td.isoformat()}:deepseek-v3",
        f"sentiment_brief:{td.isoformat()}:deepseek-v3",
        f"ladder_brief:{td.isoformat()}:deepseek-v3",
        f"theme_brief:{td.isoformat()}:deepseek-v3",
    ]
    with eng.connect() as conn:
        res = conn.execute(
            delete(AIBriefCache).where(AIBriefCache.cache_key.in_(targets))
        )
        conn.commit()
        return res.rowcount or 0


def main() -> None:
    td = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else date.today()
    print(f"[refresh_today] target={td}")

    print("[refresh_today] step 1/3 rerun pipeline ...")
    run_daily_pipeline(td)
    print("[refresh_today] step 1/3 done")

    print("[refresh_today] step 2/3 purge stale brief cache ...")
    n = _purge_cache_for(td)
    print(f"[refresh_today] purged {n} cache rows")

    print("[refresh_today] step 3/3 regenerate market briefs ...")
    res = asyncio.run(prewarm_market_briefs(td))
    for r in res.get("results", []):
        print(f"  - {r.get('key')}: {r.get('status')} {r.get('error', '')}")
    print("[refresh_today] all done")


if __name__ == "__main__":
    main()
