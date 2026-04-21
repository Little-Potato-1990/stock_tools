"""新闻聚合 Celery task — Phase 1.

排期 (celery beat):
    24x5 每 30 分钟跑一次 ingest, 拉 12 小时窗口
    盘中 9:00-15:00 每 5 分钟跑一次 (高频热点窗口)
    每日 17:00 跑一次 LLM 打标补漏 (扫 ai_tagged_at IS NULL 的近 24h 新闻)

设计:
- ingest_news_task: 默认快路径, 拉新 + 同步打标; 失败静默
- tag_news_backfill_task: 慢路径, 只跑打标 (用于补漏 / 大模型升级后回刷)
"""
from __future__ import annotations

import logging

from app.ai.brief_cache import sync_run_async
from app.config import get_settings
from app.news.embed import embed_pending
from app.news.ingest import _llm_tag_recent, ingest_once
from app.tasks.celery_app import celery

logger = logging.getLogger(__name__)


@celery.task(name="app.tasks.news_ingest.ingest_news_task")
def ingest_news_task(window_hours: float | None = None, do_tag: bool | None = None):
    s = get_settings()
    wh = window_hours if window_hours is not None else s.news_ingest_window_hours
    dt = do_tag if do_tag is not None else s.news_ingest_do_tag
    try:
        out = sync_run_async(ingest_once(window_hours=wh, do_tag=dt, tag_model=s.news_tag_model))
        logger.info("[news.ingest_task] %s", out)
        return out
    except Exception as e:
        logger.exception("[news.ingest_task] failed: %s", e)
        return {"error": str(e)[:200]}


@celery.task(name="app.tasks.news_ingest.tag_news_backfill_task")
def tag_news_backfill_task(hours: int = 48, model: str | None = None):
    s = get_settings()
    m = model or s.news_tag_model
    try:
        n = sync_run_async(_llm_tag_recent(hours=hours, model=m))
        logger.info("[news.tag_backfill] tagged=%d", n)
        return {"tagged": n}
    except Exception as e:
        logger.exception("[news.tag_backfill] failed: %s", e)
        return {"error": str(e)[:200]}


@celery.task(name="app.tasks.news_ingest.embed_news_task")
def embed_news_task(limit: int | None = None):
    """把 news_summaries.embedding_status='pending' 的行批量向量化.

    单轮上限 = settings.news_embedding_per_run (默认 200), 防止失控成本.
    在 beat 里以 5 分钟一次跑, 通常每轮 30-100 条; 落 ivfflat 索引供 RAG 检索.
    """
    try:
        out = embed_pending(limit=limit)
        logger.info("[news.embed_task] %s", out)
        return out
    except Exception as e:
        logger.exception("[news.embed_task] failed: %s", e)
        return {"error": str(e)[:200]}
