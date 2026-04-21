"""个人化新闻速报 (Phase 4 个性化).

围绕用户自选股, 拉最近 N 小时的相关新闻, 用三段加权 ranker
打分, 输出 top-k + 统计概览, 给 MyDigestFloating 浮窗使用.

设计取舍 (按 user rule: 能省则省):
- 不调用 LLM: 全部依赖已经离线打好标的 NewsSummary + ranker 评分
- 走同步 SQLAlchemy + create_engine, 复用 fetch_news_for_codes (不会污染 async session)
- 命中自选 + 重要 + 24h 内的优先, 半衰期短一点, 让"今天"的更前置
- top_k 默认 6 条, 单条只返前端必要字段, 减网络体积
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from app.news.ingest import fetch_news_for_codes
from app.news.ranker import rank_news

logger = logging.getLogger(__name__)


def build_personal_news_digest(
    watch_codes: list[str],
    *,
    hours: int = 24,
    top_k: int = 6,
    half_life_h: float = 4.0,
) -> dict[str, Any]:
    """根据自选股代码集生成个人新闻速报 (无 LLM, 纯排序).

    返回结构:
    {
        "generated_at": iso,
        "hours": 24,
        "watch_count": 12,
        "stats": {
            "total": 42, "important": 7,
            "bullish": 18, "bearish": 9, "neutral": 15,
            "watch_hits": 12,
        },
        "items": [
            {id, title, source, sentiment, importance, pub_time,
             rel_codes, themes, watch_codes_hit, _score},
            ...
        ],
    }
    """
    now = datetime.now()
    base = {
        "generated_at": now.isoformat(timespec="seconds"),
        "hours": hours,
        "watch_count": len(watch_codes),
        "stats": {
            "total": 0, "important": 0,
            "bullish": 0, "bearish": 0, "neutral": 0,
            "watch_hits": 0,
        },
        "items": [],
    }
    if not watch_codes:
        return base

    try:
        rows = fetch_news_for_codes(watch_codes, hours=hours, limit=120)
    except Exception as exc:
        logger.warning("[personal-digest] fetch_news_for_codes err=%s", exc)
        rows = []

    if not rows:
        return base

    watch_set = set(watch_codes)

    # 统计 (基于全量, 不只 top_k)
    stats = base["stats"]
    stats["total"] = len(rows)
    for r in rows:
        if int(r.get("importance") or 0) >= 3:
            stats["important"] += 1
        s = r.get("sentiment")
        if s == "bullish":
            stats["bullish"] += 1
        elif s == "bearish":
            stats["bearish"] += 1
        elif s == "neutral":
            stats["neutral"] += 1
        codes = set(r.get("rel_codes") or [])
        if codes & watch_set:
            stats["watch_hits"] += 1

    ranked = rank_news(
        rows,
        watch_codes=watch_codes,
        weights={
            # 个人化场景: relevance 与 importance 权重再升
            "imp": 0.30, "time": 0.30, "rel": 0.28, "sent": 0.08, "src": 0.04,
        },
        half_life_h=half_life_h,
        top_k=top_k,
        attach_score=True,
        now=now,
    )

    items: list[dict[str, Any]] = []
    for r in ranked:
        codes = list(r.get("rel_codes") or [])
        hit = [c for c in codes if c in watch_set]
        items.append({
            "id": r.get("id"),
            "title": (r.get("title") or "")[:100],
            "source": r.get("source"),
            "sentiment": r.get("sentiment"),
            "importance": int(r.get("importance") or 0),
            "pub_time": r.get("pub_time"),
            "rel_codes": codes[:6],
            "themes": list(r.get("themes") or [])[:4],
            "watch_codes_hit": hit,
            "score": r.get("_score"),
        })

    base["items"] = items
    return base
