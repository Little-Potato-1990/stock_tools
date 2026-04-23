"""与行情/排行榜相关的 Celery 任务."""

from __future__ import annotations

from sqlalchemy import create_engine, text

from app.config import get_settings
from app.tasks.celery_app import celery


@celery.task(name="app.tasks.market.refresh_warm_views")
def refresh_warm_views():
    """盘中定时刷新 Phase 1.5 物化视图（存储过程 `refresh_warm_views`）."""
    settings = get_settings()
    engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
    with engine.begin() as conn:
        conn.execute(text("CALL refresh_warm_views();"))
    return "ok"
