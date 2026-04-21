"""AI brief 预热业务逻辑 — service 层.

API (`/api/ai/prewarm/{job}`) 与 Celery task (`app.tasks.prewarm`) 共用本模块,
避免 API 反向 import task 内部私有协程.

排期 (celery beat 调度本服务函数, 通过 `app.tasks.prewarm` sync 包装):
    15:40  prewarm_market_briefs    大盘 4 类 brief (market / ladder / sentiment / theme)
    15:45  prewarm_why_rose         当日涨停 + 跌幅 top 30 → why_rose
    15:50  prewarm_debate           market debate × 1 + top 10 题材 debate

设计原则:
    - 复用 generate_xxx 函数, 直接调 LLM 然后写 PG cache
    - 失败容忍: 单个失败不影响其他, 累计统计
    - source='prewarm' 标记, 便于 stats 区分
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date as date_type
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ai.brief_cache import pg_get, pg_set
from app.ai.brief_generator import generate_brief, _latest_trade_date_with_data
from app.ai.capital_brief import generate_capital_brief
from app.ai.institutional_brief import generate_institutional_brief
from app.ai.ladder_brief import generate_ladder_brief
from app.ai.lhb_brief import generate_lhb_brief
from app.ai.long_term_brief import generate_long_term_brief
from app.ai.multi_perspective import generate_multi_perspective
from app.ai.news_brief import generate_news_brief
from app.ai.sentiment_brief import generate_sentiment_brief
from app.ai.swing_brief import generate_swing_brief
from app.ai.theme_brief import generate_theme_brief
from app.ai.why_rose import generate_why_rose
from app.ai.debate import run_debate
from app.models.market import LimitUpRecord
from app.models.snapshot import DailySnapshot
from app.services.universe_resolver import resolve_prewarm_universe

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "deepseek-v3"
PG_TTL_H = 24.0


def _td_str(td: date_type | None) -> str:
    return td.isoformat() if td else "auto"


def resolve_trade_date(td: date_type | None) -> date_type | None:
    if td:
        return td
    try:
        return _latest_trade_date_with_data() or date_type.today()
    except Exception:
        return date_type.today()


async def _gen_and_cache(
    key: str,
    coro_factory,
    *,
    action: str,
    model: str,
    trade_date: date_type | None,
    skip_if_exists: bool = True,
) -> dict[str, Any]:
    if skip_if_exists:
        cached = await asyncio.to_thread(pg_get, key)
        if cached is not None:
            return {"key": key, "status": "skipped_cached"}
    try:
        result = await coro_factory()
        if not isinstance(result, dict):
            return {"key": key, "status": "skipped_non_dict"}
        await asyncio.to_thread(
            pg_set, key, result,
            action=action, model=model, trade_date=trade_date,
            ttl_hours=PG_TTL_H, source="prewarm",
        )
        return {"key": key, "status": "ok"}
    except Exception as e:
        logger.warning(f"prewarm {key} failed: {e}")
        return {"key": key, "status": "error", "error": str(e)[:120]}


async def prewarm_news_brief(
    trade_date: date_type | None, model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """新闻 brief 预热. 用 watch_codes=None (公共版本); 用户私有版本走 ondemand."""
    td = resolve_trade_date(trade_date)
    td_s = _td_str(td)
    # 公共 cache_key: watch_hash="_", hours=24
    key = f"news_brief:{td_s}:24:_:{model}"
    return await _gen_and_cache(
        key,
        lambda: generate_news_brief(td, model, hours=24, watch_codes=None),
        action="news_brief", model=model, trade_date=td,
        skip_if_exists=False,  # 新闻刷新频次高, 直接覆盖
    )


async def prewarm_market_briefs(
    trade_date: date_type | None, model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    td = resolve_trade_date(trade_date)
    td_s = _td_str(td)
    tasks = [
        _gen_and_cache(
            f"market_brief:{td_s}:{model}",
            lambda: generate_brief(td, model),
            action="market_brief", model=model, trade_date=td,
        ),
        _gen_and_cache(
            f"ladder_brief:{td_s}:{model}",
            lambda: generate_ladder_brief(td, model),
            action="ladder_brief", model=model, trade_date=td,
        ),
        _gen_and_cache(
            f"sentiment_brief:{td_s}:{model}",
            lambda: generate_sentiment_brief(td, model),
            action="sentiment_brief", model=model, trade_date=td,
        ),
        _gen_and_cache(
            f"theme_brief:{td_s}:{model}",
            lambda: generate_theme_brief(td, model),
            action="theme_brief", model=model, trade_date=td,
        ),
        _gen_and_cache(
            f"capital_brief:{td_s}:{model}",
            lambda: generate_capital_brief(td, model),
            action="capital_brief", model=model, trade_date=td,
        ),
    ]
    results = await asyncio.gather(*tasks, return_exceptions=False)
    return {"trade_date": td_s, "results": results}


async def prewarm_institutional_brief(
    trade_date: date_type | None, model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """主力身份 brief 预热: 季报变化慢, 缓存 7 天."""
    td = resolve_trade_date(trade_date)
    td_s = _td_str(td)
    key = f"institutional_brief:{td_s}:{model}"
    return await _gen_and_cache(
        key,
        lambda: generate_institutional_brief(td, None, model),
        action="institutional_brief", model=model, trade_date=td,
    )


def _pick_why_rose_targets(trade_date: date_type, max_per_dir: int = 30) -> list[str]:
    """legacy 兼容入口 — 现统一走 universe_resolver. max_per_dir 已无意义, 仅保留签名."""
    return sorted(resolve_prewarm_universe(trade_date))


async def prewarm_why_rose(
    trade_date: date_type | None,
    model: str = DEFAULT_MODEL,
    max_per_dir: int = 30,
    concurrency: int = 4,
) -> dict[str, Any]:
    td = resolve_trade_date(trade_date)
    if not td:
        return {"status": "no_trade_date"}
    codes = sorted(resolve_prewarm_universe(td))
    if not codes:
        return {"trade_date": td.isoformat(), "targets": 0, "results": []}

    sem = asyncio.Semaphore(concurrency)

    async def _one(code: str):
        async with sem:
            return await _gen_and_cache(
                f"why_rose:{code}:{td.isoformat()}:{model}",
                lambda: generate_why_rose(code, td, model),
                action="why_rose", model=model, trade_date=td,
            )

    results = await asyncio.gather(*[_one(c) for c in codes], return_exceptions=False)
    summary = {"ok": 0, "skipped_cached": 0, "error": 0}
    for r in results:
        st = r.get("status", "error")
        summary[st if st in summary else "error"] = summary.get(st, 0) + 1
    return {
        "trade_date": td.isoformat(),
        "targets": len(codes),
        "summary": summary,
        "first_5": results[:5],
    }


def _pick_debate_themes(trade_date: date_type, top_n: int = 10) -> list[str]:
    """从 theme_brief snapshot 拿热门题材, 没有就 fallback 用涨停统计."""
    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    themes: list[str] = []
    try:
        with Session(eng) as s:
            snap = s.execute(
                select(DailySnapshot).where(
                    DailySnapshot.snapshot_type == "themes",
                    DailySnapshot.trade_date == trade_date,
                )
            ).scalar_one_or_none()
            if snap and snap.data:
                # runner.py 写入键为 top/bottom (按 change_pct desc)
                rows = snap.data.get("top") or snap.data.get("themes") or snap.data.get("ranking") or []
                if isinstance(rows, list):
                    for r in rows[:top_n]:
                        name = r.get("name") if isinstance(r, dict) else None
                        if name:
                            themes.append(name)
            if not themes:
                lu_rows = s.execute(
                    select(LimitUpRecord).where(LimitUpRecord.trade_date == trade_date)
                ).scalars().all()
                from collections import Counter
                cnt: Counter = Counter()
                for r in lu_rows:
                    for t in (r.theme_names or []):
                        cnt[t] += 1
                themes = [t for t, _ in cnt.most_common(top_n)]
    finally:
        eng.dispose()
    return themes


async def prewarm_debate(
    trade_date: date_type | None,
    model: str = DEFAULT_MODEL,
    top_n_themes: int = 10,
    concurrency: int = 3,
    include_stocks: bool = True,
    stock_concurrency: int = 2,
) -> dict[str, Any]:
    """大盘 debate × 1 + top_n_themes 题材 debate + universe 个股 debate (可选).

    - 个股 debate token 较多, 单独 stock_concurrency 控速.
    - PG TTL 24h, 重复跑命中 skipped_cached.
    """
    td = resolve_trade_date(trade_date)
    if not td:
        return {"status": "no_trade_date"}
    td_s = td.isoformat()

    sem = asyncio.Semaphore(concurrency)

    async def _market():
        async with sem:
            return await _gen_and_cache(
                f"debate:market:_:{td_s}:{model}",
                lambda: run_debate("market", None, td, model),
                action="debate", model=model, trade_date=td,
            )

    themes = _pick_debate_themes(td, top_n_themes)

    async def _theme(name: str):
        async with sem:
            return await _gen_and_cache(
                f"debate:theme:{name}:{td_s}:{model}",
                lambda: run_debate("theme", name, td, model),
                action="debate", model=model, trade_date=td,
            )

    market_res = await _market()
    theme_results = await asyncio.gather(*[_theme(t) for t in themes])

    stock_results: list[dict] = []
    if include_stocks:
        codes = sorted(resolve_prewarm_universe(td))
        stock_sem = asyncio.Semaphore(stock_concurrency)

        async def _stock(code: str):
            async with stock_sem:
                return await _gen_and_cache(
                    f"debate:stock:{code}:{td_s}:{model}",
                    lambda: run_debate("stock", code, td, model),
                    action="debate", model=model, trade_date=td,
                )

        stock_results = await asyncio.gather(*[_stock(c) for c in codes])

    summary = {"ok": 0, "skipped_cached": 0, "error": 0}
    for r in [market_res, *theme_results, *stock_results]:
        st = r.get("status", "error")
        summary[st if st in summary else "error"] = summary.get(st, 0) + 1
    return {
        "trade_date": td_s,
        "themes": themes,
        "stock_targets": len(stock_results),
        "summary": summary,
        "market": market_res,
    }


# ============================================================
# Phase 2 中长视角预热
# ============================================================

# 不同视角缓存分级 (与 plan 对齐)
PG_TTL_H_SHORT = 24.0
PG_TTL_H_SWING = 24.0
PG_TTL_H_LONG = 24.0 * 7  # 7 天


def _pick_multi_perspective_targets(
    trade_date: date_type, max_n: int = 50,
) -> list[str]:
    """legacy 入口 — 现统一走 universe_resolver. max_n 仅兜底截断."""
    codes = sorted(resolve_prewarm_universe(trade_date))
    if max_n and len(codes) > max_n * 40:  # 仅极端情况下软截断
        return codes[: max_n * 40]
    return codes


def _pick_long_term_targets(trade_date: date_type, max_n: int = 50) -> list[str]:
    """legacy 入口 — 现统一走 universe_resolver."""
    codes = sorted(resolve_prewarm_universe(trade_date))
    if max_n and len(codes) > max_n * 40:
        return codes[: max_n * 40]
    return codes


async def prewarm_multi_perspective(
    trade_date: date_type | None,
    model: str = DEFAULT_MODEL,
    max_n: int = 50,
    concurrency: int = 4,
) -> dict[str, Any]:
    td = resolve_trade_date(trade_date)
    if not td:
        return {"status": "no_trade_date"}
    codes = sorted(resolve_prewarm_universe(td))
    if not codes:
        return {"trade_date": td.isoformat(), "targets": 0, "results": []}

    sem = asyncio.Semaphore(concurrency)

    async def _one(code: str):
        async with sem:
            key = f"multi_perspective:{code}:{td.isoformat()}:{model}"
            cached = await asyncio.to_thread(pg_get, key)
            if cached is not None:
                return {"key": key, "status": "skipped_cached"}
            try:
                result = await generate_multi_perspective(code, td, model)
                await asyncio.to_thread(
                    pg_set, key, result,
                    action="multi_perspective", model=model, trade_date=td,
                    ttl_hours=PG_TTL_H_SHORT, source="prewarm",
                )
                return {"key": key, "status": "ok"}
            except Exception as e:
                logger.warning(f"prewarm multi_perspective {code} fail: {e}")
                return {"key": key, "status": "error", "error": str(e)[:120]}

    results = await asyncio.gather(*[_one(c) for c in codes])
    summary = {"ok": 0, "skipped_cached": 0, "error": 0}
    for r in results:
        st = r.get("status", "error")
        summary[st if st in summary else "error"] = summary.get(st, 0) + 1
    return {"trade_date": td.isoformat(), "targets": len(codes), "summary": summary}


async def prewarm_swing_brief(
    trade_date: date_type | None,
    model: str = DEFAULT_MODEL,
    max_n: int = 50,
    concurrency: int = 3,
) -> dict[str, Any]:
    td = resolve_trade_date(trade_date)
    if not td:
        return {"status": "no_trade_date"}
    codes = sorted(resolve_prewarm_universe(td))
    if not codes:
        return {"trade_date": td.isoformat(), "targets": 0, "results": []}

    sem = asyncio.Semaphore(concurrency)

    async def _one(code: str):
        async with sem:
            return await _gen_and_cache(
                f"swing_brief:{code}:{td.isoformat()}:{model}",
                lambda: generate_swing_brief(code, td, model),
                action="swing_brief", model=model, trade_date=td,
            )

    results = await asyncio.gather(*[_one(c) for c in codes])
    summary = {"ok": 0, "skipped_cached": 0, "error": 0}
    for r in results:
        st = r.get("status", "error")
        summary[st if st in summary else "error"] = summary.get(st, 0) + 1
    return {"trade_date": td.isoformat(), "targets": len(codes), "summary": summary}


async def prewarm_long_term_brief(
    trade_date: date_type | None,
    model: str = DEFAULT_MODEL,
    max_n: int = 50,
    concurrency: int = 2,
) -> dict[str, Any]:
    td = resolve_trade_date(trade_date)
    if not td:
        return {"status": "no_trade_date"}
    codes = sorted(resolve_prewarm_universe(td))
    if not codes:
        return {"trade_date": td.isoformat(), "targets": 0, "results": []}

    sem = asyncio.Semaphore(concurrency)

    async def _one(code: str):
        async with sem:
            key = f"long_term_brief:{code}:{td.isoformat()}:{model}"
            cached = await asyncio.to_thread(pg_get, key)
            if cached is not None:
                return {"key": key, "status": "skipped_cached"}
            try:
                result = await generate_long_term_brief(code, td, model)
                await asyncio.to_thread(
                    pg_set, key, result,
                    action="long_term_brief", model=model, trade_date=td,
                    ttl_hours=PG_TTL_H_LONG, source="prewarm",
                )
                return {"key": key, "status": "ok"}
            except Exception as e:
                logger.warning(f"prewarm long_term_brief {code} fail: {e}")
                return {"key": key, "status": "error", "error": str(e)[:120]}

    results = await asyncio.gather(*[_one(c) for c in codes])
    summary = {"ok": 0, "skipped_cached": 0, "error": 0}
    for r in results:
        st = r.get("status", "error")
        summary[st if st in summary else "error"] = summary.get(st, 0) + 1
    return {"trade_date": td.isoformat(), "targets": len(codes), "summary": summary}


# ============================================================
# 新增: LHB brief 预热
# ============================================================

async def prewarm_lhb_brief(
    trade_date: date_type | None, model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """龙虎榜 AI 拆解 brief 预热. 每天一次, 和其他大盘 brief 并列."""
    td = resolve_trade_date(trade_date)
    if not td:
        return {"status": "no_trade_date"}
    td_s = _td_str(td)
    key = f"lhb_brief:{td_s}:{model}"
    return await _gen_and_cache(
        key,
        lambda: generate_lhb_brief(td, model),
        action="lhb_brief", model=model, trade_date=td,
    )


# ============================================================
# 新增: 个股 7 维 context 预热 (落 PG, 24h TTL)
# ============================================================

_CONTEXT_TTL_H = 24.0


async def _generate_stock_context_for_cache(code: str, td: date_type) -> dict:
    """独立的 async engine + AsyncSession 拉 context, 不复用 FastAPI request scope."""
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.services.stock_context import get_stock_context

    settings = get_settings()
    eng = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        maker = async_sessionmaker(eng, expire_on_commit=False)
        async with maker() as session:
            ctx = await get_stock_context(session, code, trade_date=td)
            return ctx if isinstance(ctx, dict) else {"code": code, "raw": ctx}
    finally:
        await eng.dispose()


async def prewarm_stock_context(
    trade_date: date_type | None,
    model: str = DEFAULT_MODEL,  # 保留签名一致, context 本身不涉及 LLM
    concurrency: int = 8,
) -> dict[str, Any]:
    """对预热白名单跑一遍 stock_context, 结果 dump 到 brief_cache PG 24h.

    cache_key 形如 `stock_context:600519:2026-04-21`, 不含 model (与 LLM 无关).
    API 读取时需用同一 key 规则.
    """
    td = resolve_trade_date(trade_date)
    if not td:
        return {"status": "no_trade_date"}
    codes = sorted(resolve_prewarm_universe(td))
    if not codes:
        return {"trade_date": td.isoformat(), "targets": 0, "results": []}

    sem = asyncio.Semaphore(concurrency)

    async def _one(code: str):
        async with sem:
            key = f"stock_context:{code}:{td.isoformat()}"
            try:
                ctx = await _generate_stock_context_for_cache(code, td)
                await asyncio.to_thread(
                    pg_set, key, ctx,
                    action="stock_context", model=None, trade_date=td,
                    ttl_hours=_CONTEXT_TTL_H, source="prewarm",
                )
                return {"key": key, "status": "ok"}
            except Exception as e:
                logger.warning(f"prewarm stock_context {code} fail: {e}")
                return {"key": key, "status": "error", "error": str(e)[:120]}

    results = await asyncio.gather(*[_one(c) for c in codes])
    summary = {"ok": 0, "error": 0}
    for r in results:
        st = r.get("status", "error")
        summary[st if st in summary else "error"] = summary.get(st, 0) + 1
    return {
        "trade_date": td.isoformat(),
        "targets": len(codes),
        "summary": summary,
    }
