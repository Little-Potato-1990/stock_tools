"""AI 今日复盘 brief.

数字 100% 从 DailySnapshot 派生, LLM 只生成 tagline / regime / 题材逻辑 / 龙头点评.
按 (trade_date, model_id) 缓存 1 小时, 重复请求不重跑 LLM, 也避免并发触发多次.

参数:
    trade_date: 不传则取数据库最新有 overview 的日期
    model: LLM 模型 id, 默认 deepseek-v3
    refresh: =1 强制重新生成 (跳过缓存)
"""

from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.brief_generator import generate_brief
from app.ai.debate import run_debate, stream_debate
from app.ai.ladder_brief import generate_ladder_brief
from app.ai.lhb_brief import generate_lhb_brief
from app.ai.prediction_tracker import get_stats, snapshot_predictions, verify_pending
from app.ai.sentiment_brief import generate_sentiment_brief
from app.ai.theme_brief import generate_theme_brief
from app.ai.why_rose import generate_why_rose
from app.ai.brief_cache import cached_brief, invalidate_pg, cache_stats
from app.api._cache import invalidate
from app.api.auth import get_current_user
from app.api.quota import check_and_log_quota
from app.database import get_db
from app.models.user import User

router = APIRouter()

BRIEF_TTL = 3600.0
PG_TTL_H = 24.0  # PostgreSQL 持久缓存 TTL


async def _generate_brief_with_track(trade_date, model):
    brief = await generate_brief(trade_date, model)
    try:
        snapshot_predictions(brief)
    except Exception:
        pass
    return brief


def _resolve_td(td: date | None) -> date:
    """统一 trade_date resolve, 让 cache_key 永远落在具体日期, 才能跨预热/ondemand 共享."""
    if td:
        return td
    from app.ai.brief_generator import _latest_trade_date_with_data
    try:
        return _latest_trade_date_with_data() or date.today()
    except Exception:
        return date.today()


@router.get("/brief")
async def get_ai_brief(
    trade_date: date = Query(None),
    model: str = Query("deepseek-v3"),
    refresh: int = Query(0),
):
    td = _resolve_td(trade_date)
    key = f"market_brief:{td.isoformat()}:{model}"
    if refresh:
        invalidate("ai_brief")
        invalidate_pg(key)
    return await cached_brief(
        key, _generate_brief_with_track, td, model,
        action="market_brief", model=model, trade_date=td,
        pg_ttl_h=PG_TTL_H, refresh=bool(refresh),
    )


@router.get("/ladder-brief")
async def get_ladder_brief(
    trade_date: date = Query(None),
    model: str = Query("deepseek-v3"),
    refresh: int = Query(0),
):
    td = _resolve_td(trade_date)
    key = f"ladder_brief:{td.isoformat()}:{model}"
    if refresh:
        invalidate("ladder_brief")
        invalidate_pg(key)
    return await cached_brief(
        key, generate_ladder_brief, td, model,
        action="ladder_brief", model=model, trade_date=td,
        pg_ttl_h=PG_TTL_H, refresh=bool(refresh),
    )


@router.get("/sentiment-brief")
async def get_sentiment_brief(
    trade_date: date = Query(None),
    model: str = Query("deepseek-v3"),
    refresh: int = Query(0),
):
    td = _resolve_td(trade_date)
    key = f"sentiment_brief:{td.isoformat()}:{model}"
    if refresh:
        invalidate("sentiment_brief")
        invalidate_pg(key)
    return await cached_brief(
        key, generate_sentiment_brief, td, model,
        action="sentiment_brief", model=model, trade_date=td,
        pg_ttl_h=PG_TTL_H, refresh=bool(refresh),
    )


@router.get("/theme-brief")
async def get_theme_brief(
    trade_date: date = Query(None),
    model: str = Query("deepseek-v3"),
    refresh: int = Query(0),
):
    td = _resolve_td(trade_date)
    key = f"theme_brief:{td.isoformat()}:{model}"
    if refresh:
        invalidate("theme_brief")
        invalidate_pg(key)
    return await cached_brief(
        key, generate_theme_brief, td, model,
        action="theme_brief", model=model, trade_date=td,
        pg_ttl_h=PG_TTL_H, refresh=bool(refresh),
    )


@router.get("/lhb-brief")
async def get_lhb_brief(
    trade_date: date = Query(None),
    model: str = Query("deepseek-v3"),
    refresh: int = Query(0),
):
    """龙虎榜 AI 拆解 (P1): 资金方向 / 接力线 / 警示 + 核心席位/个股."""
    td = _resolve_td(trade_date)
    key = f"lhb_brief:{td.isoformat()}:{model}"
    if refresh:
        invalidate("lhb_brief")
        invalidate_pg(key)
    return await cached_brief(
        key, generate_lhb_brief, td, model,
        action="lhb_brief", model=model, trade_date=td,
        pg_ttl_h=PG_TTL_H, refresh=bool(refresh),
    )


@router.get("/why-rose")
async def get_why_rose(
    code: str = Query(..., description="股票代码 (6 位)"),
    trade_date: date = Query(None),
    model: str = Query("deepseek-v3"),
    refresh: int = Query(0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """单股 AI 综合解读: 真实驱动 / 卡位 / 高度 / 明日策略 / verdict."""
    td = _resolve_td(trade_date)
    key = f"why_rose:{code}:{td.isoformat()}:{model}"
    if refresh:
        invalidate("why_rose")
        invalidate_pg(key)
    # 仅在真正调 LLM 时扣 quota — 命中缓存不扣
    from app.ai.brief_cache import pg_get
    import asyncio as _asyncio
    pg_hit = await _asyncio.to_thread(pg_get, key) if not refresh else None
    if pg_hit is None:
        await check_and_log_quota(db, user, action="why_rose", model=model)
    return await cached_brief(
        key, generate_why_rose, code, td, model,
        action="why_rose", model=model, trade_date=td,
        pg_ttl_h=PG_TTL_H, refresh=bool(refresh),
    )


@router.get("/debate")
async def get_debate(
    topic_type: str = Query("market", pattern="^(market|stock|theme)$"),
    topic_key: str | None = Query(None, description="stock 时填 6 位代码; theme 时填题材名"),
    trade_date: date = Query(None),
    model: str = Query("deepseek-v3"),
    refresh: int = Query(0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """多 Agent 辩论 (一次性, 含缓存): 多头/空头/裁判 三方观点 + 最终结论."""
    td = _resolve_td(trade_date)
    key = f"debate:{topic_type}:{topic_key or '_'}:{td.isoformat()}:{model}"
    if refresh:
        invalidate("debate")
        invalidate_pg(key)
    from app.ai.brief_cache import pg_get
    import asyncio as _asyncio
    pg_hit = await _asyncio.to_thread(pg_get, key) if not refresh else None
    if pg_hit is None:
        await check_and_log_quota(db, user, action="debate", model=model)
    return await cached_brief(
        key, run_debate, topic_type, topic_key, td, model,
        action="debate", model=model, trade_date=td,
        pg_ttl_h=PG_TTL_H, refresh=bool(refresh),
    )


@router.get("/cache/stats")
async def get_cache_stats():
    """AI 缓存命中率 / 预热占比, 便于监控."""
    return cache_stats()


@router.delete("/cache")
async def clear_cache(prefix: str | None = Query(None, description="cache_key 前缀, 不传清全部")):
    """主动失效 PG 缓存. e.g. prefix='why_rose:600519'."""
    n = invalidate_pg(prefix)
    invalidate(prefix.split(":")[0] if prefix else None)
    return {"deleted_pg_rows": n, "prefix": prefix}


@router.get("/debate/stream")
async def get_debate_stream(
    topic_type: str = Query("market", pattern="^(market|stock|theme)$"),
    topic_key: str | None = Query(None),
    trade_date: date = Query(None),
    model: str = Query("deepseek-v3"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """多 Agent 辩论 SSE 流式: stage=evidence/bull/bear/judge/done, 每段自带 data."""
    await check_and_log_quota(db, user, action="debate", model=model)
    return StreamingResponse(
        stream_debate(topic_type, topic_key, trade_date, model),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/track/stats")
async def get_track_stats(days: int = Query(30, ge=7, le=180)):
    """AI 预测命中率看板 — 最近 N 天聚合 + 50 条最新明细."""
    return get_stats(days=days)


@router.post("/track/verify")
async def trigger_track_verify(horizon: int = Query(3, ge=1, le=10)):
    """手动触发 T+N 校验 (扫描 verified_at IS NULL 的预测)."""
    return verify_pending(horizon=horizon)


@router.post("/prewarm/{job}")
async def trigger_prewarm(
    job: str,
    trade_date: date = Query(None),
    model: str = Query("deepseek-v3"),
    max_per_dir: int = Query(30),
    top_n_themes: int = Query(10),
    concurrency: int = Query(4),
):
    """手动触发预热. job ∈ {market_briefs, why_rose, debate, all}."""
    from app.tasks.prewarm import (
        _prewarm_market_briefs_async,
        _prewarm_why_rose_async,
        _prewarm_debate_async,
    )
    td = trade_date
    if job == "market_briefs":
        return await _prewarm_market_briefs_async(td, model)
    if job == "why_rose":
        return await _prewarm_why_rose_async(td, model, max_per_dir, concurrency)
    if job == "debate":
        return await _prewarm_debate_async(td, model, top_n_themes, max(2, concurrency))
    if job == "all":
        return {
            "market_briefs": await _prewarm_market_briefs_async(td, model),
            "why_rose": await _prewarm_why_rose_async(td, model, max_per_dir, concurrency),
            "debate": await _prewarm_debate_async(td, model, top_n_themes, max(2, concurrency)),
        }
    return {"error": f"unknown job: {job}"}
