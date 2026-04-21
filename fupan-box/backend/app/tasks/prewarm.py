"""AI brief 预热 — Celery task 薄壳.

实际逻辑全在 `app.services.prewarm_service`. 本文件只做:
- celery beat 调度入口 (sync 包装)
- 命名空间 `app.tasks.prewarm.prewarm_xxx` 兼容历史 beat schedule

排期 (celery beat):
    15:40  prewarm_market_briefs
    15:45  prewarm_why_rose
    15:50  prewarm_debate
"""
from __future__ import annotations

from datetime import date as date_type

from app.tasks.celery_app import celery
from app.ai.brief_cache import sync_run_async
from app.services.prewarm_service import (
    DEFAULT_MODEL,
    prewarm_institutional_brief as _institutional_async,
    prewarm_market_briefs as _market_briefs_async,
    prewarm_news_brief as _news_brief_async,
    prewarm_why_rose as _why_rose_async,
    prewarm_debate as _debate_async,
    prewarm_multi_perspective as _multi_perspective_async,
    prewarm_swing_brief as _swing_brief_async,
    prewarm_long_term_brief as _long_term_brief_async,
    prewarm_lhb_brief as _lhb_brief_async,
    prewarm_stock_context as _stock_context_async,
)


@celery.task(name="app.tasks.prewarm.prewarm_market_briefs")
def prewarm_market_briefs(trade_date_str: str | None = None, model: str = DEFAULT_MODEL):
    td = date_type.fromisoformat(trade_date_str) if trade_date_str else None
    return sync_run_async(_market_briefs_async(td, model))


@celery.task(name="app.tasks.prewarm.prewarm_why_rose")
def prewarm_why_rose(
    trade_date_str: str | None = None,
    model: str = DEFAULT_MODEL,
    max_per_dir: int = 30,
    concurrency: int = 4,
):
    td = date_type.fromisoformat(trade_date_str) if trade_date_str else None
    return sync_run_async(_why_rose_async(td, model, max_per_dir, concurrency))


@celery.task(name="app.tasks.prewarm.prewarm_debate")
def prewarm_debate(
    trade_date_str: str | None = None,
    model: str = DEFAULT_MODEL,
    top_n_themes: int = 10,
    concurrency: int = 3,
):
    td = date_type.fromisoformat(trade_date_str) if trade_date_str else None
    return sync_run_async(_debate_async(td, model, top_n_themes, concurrency))


@celery.task(name="app.tasks.prewarm.prewarm_news_brief")
def prewarm_news_brief(trade_date_str: str | None = None, model: str = DEFAULT_MODEL):
    td = date_type.fromisoformat(trade_date_str) if trade_date_str else None
    return sync_run_async(_news_brief_async(td, model))


@celery.task(name="app.tasks.prewarm.prewarm_institutional_brief")
def prewarm_institutional_brief(trade_date_str: str | None = None, model: str = DEFAULT_MODEL):
    td = date_type.fromisoformat(trade_date_str) if trade_date_str else None
    return sync_run_async(_institutional_async(td, model))


@celery.task(name="app.tasks.prewarm.prewarm_multi_perspective")
def prewarm_multi_perspective(
    trade_date_str: str | None = None,
    model: str = DEFAULT_MODEL,
    max_n: int = 50,
    concurrency: int = 4,
):
    td = date_type.fromisoformat(trade_date_str) if trade_date_str else None
    return sync_run_async(_multi_perspective_async(td, model, max_n, concurrency))


@celery.task(name="app.tasks.prewarm.prewarm_swing_brief")
def prewarm_swing_brief(
    trade_date_str: str | None = None,
    model: str = DEFAULT_MODEL,
    max_n: int = 50,
    concurrency: int = 3,
):
    td = date_type.fromisoformat(trade_date_str) if trade_date_str else None
    return sync_run_async(_swing_brief_async(td, model, max_n, concurrency))


@celery.task(name="app.tasks.prewarm.prewarm_long_term_brief")
def prewarm_long_term_brief(
    trade_date_str: str | None = None,
    model: str = DEFAULT_MODEL,
    max_n: int = 50,
    concurrency: int = 2,
):
    td = date_type.fromisoformat(trade_date_str) if trade_date_str else None
    return sync_run_async(_long_term_brief_async(td, model, max_n, concurrency))


@celery.task(name="app.tasks.prewarm.prewarm_lhb_brief")
def prewarm_lhb_brief(trade_date_str: str | None = None, model: str = DEFAULT_MODEL):
    td = date_type.fromisoformat(trade_date_str) if trade_date_str else None
    return sync_run_async(_lhb_brief_async(td, model))


@celery.task(name="app.tasks.prewarm.prewarm_stock_context")
def prewarm_stock_context(
    trade_date_str: str | None = None,
    model: str = DEFAULT_MODEL,
    concurrency: int = 8,
):
    td = date_type.fromisoformat(trade_date_str) if trade_date_str else None
    return sync_run_async(_stock_context_async(td, model, concurrency))


@celery.task(name="app.tasks.prewarm.prewarm_all")
def prewarm_all(trade_date_str: str | None = None, model: str = DEFAULT_MODEL):
    """串行跑完所有: 用于手动触发 / 失败重跑."""
    out = {}
    out["market_briefs"] = prewarm_market_briefs(trade_date_str, model)
    out["news_brief"] = prewarm_news_brief(trade_date_str, model)
    out["institutional_brief"] = prewarm_institutional_brief(trade_date_str, model)
    out["lhb_brief"] = prewarm_lhb_brief(trade_date_str, model)
    out["stock_context"] = prewarm_stock_context(trade_date_str, model)
    out["why_rose"] = prewarm_why_rose(trade_date_str, model)
    out["debate"] = prewarm_debate(trade_date_str, model)
    out["multi_perspective"] = prewarm_multi_perspective(trade_date_str, model)
    out["swing_brief"] = prewarm_swing_brief(trade_date_str, model)
    out["long_term_brief"] = prewarm_long_term_brief(trade_date_str, model)
    return out
