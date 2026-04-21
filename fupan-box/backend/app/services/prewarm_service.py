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

from sqlalchemy import create_engine, select, desc
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ai.brief_cache import pg_get, pg_set
from app.ai.brief_generator import generate_brief, _latest_trade_date_with_data
from app.ai.capital_brief import generate_capital_brief
from app.ai.institutional_brief import generate_institutional_brief
from app.ai.ladder_brief import generate_ladder_brief
from app.ai.news_brief import generate_news_brief
from app.ai.sentiment_brief import generate_sentiment_brief
from app.ai.theme_brief import generate_theme_brief
from app.ai.why_rose import generate_why_rose
from app.ai.debate import run_debate
from app.models.market import LimitUpRecord
from app.models.stock import DailyQuote
from app.models.snapshot import DailySnapshot

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
    """挑选当日预热目标:
    - 全部涨停股
    - 跌幅 top N (重点关注闪崩股)
    - 涨幅前 N 但未涨停 (强势股次日预期)
    """
    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    codes: set[str] = set()
    try:
        with Session(eng) as s:
            lu_rows = s.execute(
                select(LimitUpRecord.stock_code).where(LimitUpRecord.trade_date == trade_date)
            ).scalars().all()
            codes.update(c for c in lu_rows if c)

            top_gain = s.execute(
                select(DailyQuote.stock_code)
                .where(
                    DailyQuote.trade_date == trade_date,
                    DailyQuote.change_pct.isnot(None),
                )
                .order_by(desc(DailyQuote.change_pct))
                .limit(max_per_dir)
            ).scalars().all()
            codes.update(top_gain)

            top_loss = s.execute(
                select(DailyQuote.stock_code)
                .where(
                    DailyQuote.trade_date == trade_date,
                    DailyQuote.change_pct.isnot(None),
                )
                .order_by(DailyQuote.change_pct)
                .limit(max_per_dir)
            ).scalars().all()
            codes.update(top_loss)
    finally:
        eng.dispose()
    return sorted(codes)


async def prewarm_why_rose(
    trade_date: date_type | None,
    model: str = DEFAULT_MODEL,
    max_per_dir: int = 30,
    concurrency: int = 4,
) -> dict[str, Any]:
    td = resolve_trade_date(trade_date)
    if not td:
        return {"status": "no_trade_date"}
    codes = _pick_why_rose_targets(td, max_per_dir)
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
                rows = snap.data.get("themes") or snap.data.get("ranking") or []
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
) -> dict[str, Any]:
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
    summary = {"ok": 0, "skipped_cached": 0, "error": 0}
    for r in [market_res, *theme_results]:
        st = r.get("status", "error")
        summary[st if st in summary else "error"] = summary.get(st, 0) + 1
    return {
        "trade_date": td_s,
        "themes": themes,
        "summary": summary,
        "market": market_res,
    }
