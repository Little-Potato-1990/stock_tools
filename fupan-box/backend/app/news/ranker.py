"""新闻三段加权智能排序.

打分公式:
    score = w_imp * importance_norm
          + w_time * time_decay
          + w_rel * relevance
          + w_sent * sentiment_strength
          + w_src * source_authority

- importance_norm  : importance / 5  (0..1)
- time_decay       : exp(-Δt_hours / half_life_hours)  (0..1)
- relevance        : 命中用户自选(强匹配) > 命中热门题材(中匹配) > 0
- sentiment_strength: 1 if bullish/bearish else 0.4 (中性偏低)
- source_authority : 不同源给不同权重 (cls/wallstreetcn 高, RSS 低)

提供:
    rank_news(items, *, watch_codes, hot_themes, weights, half_life_h, top_k)
        -> list[(item, score, breakdown)]

调用方:
    /api/market/news?sort=smart  → 智能排序
    news_brief / theme_brief 选 evidence 时也可调用
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

# ---------- 默认权重 ----------

DEFAULT_WEIGHTS: dict[str, float] = {
    "imp": 0.32,    # 重要性
    "time": 0.28,   # 时效衰减
    "rel": 0.22,    # 用户/热门题材关联
    "sent": 0.10,   # 情绪偏向 (强情绪 > 中性)
    "src": 0.08,    # 源权威度
}

DEFAULT_HALF_LIFE_HOURS: float = 6.0  # 6 小时半衰期 — 8h 后 ~0.4, 24h 后 ~0.06

# 源权威度 (0..1) - 数值越大代表越权威/越偏一手
SOURCE_AUTHORITY: dict[str, float] = {
    "cls": 1.00,             # 财联社
    "tushare_eastmoney": 0.92,
    "tushare_sina": 0.88,
    "tushare_wallstreet": 0.95,
    "tushare_10jqka": 0.85,
    "wallstreetcn": 0.92,
    "yicai": 0.85,
    "sina_finance": 0.78,
    "global": 0.95,          # akshare 实时财经快讯
    "cctv": 0.90,            # 央视新闻联播财经板块
    "notice": 0.78,          # 公司公告
    "sina_zhibo": 0.82,
    "36kr": 0.65,
    "xueqiu": 0.55,
    "default": 0.60,
}


@dataclass
class ScoreBreakdown:
    imp: float
    time: float
    rel: float
    sent: float
    src: float
    total: float

    def as_dict(self) -> dict[str, float]:
        return {
            "imp": round(self.imp, 4),
            "time": round(self.time, 4),
            "rel": round(self.rel, 4),
            "sent": round(self.sent, 4),
            "src": round(self.src, 4),
            "total": round(self.total, 4),
        }


# ---------- 单项打分 ----------

def _imp_norm(item: dict) -> float:
    imp = int(item.get("importance") or 0)
    return max(0.0, min(1.0, imp / 5.0))


def _time_decay(item: dict, *, now: datetime, half_life_h: float) -> float:
    pub_raw = item.get("pub_time")
    if not pub_raw:
        return 0.2  # 无时间给一个温和默认值
    try:
        if isinstance(pub_raw, str):
            pub = datetime.fromisoformat(pub_raw.replace("Z", "+00:00"))
            if pub.tzinfo is not None:
                pub = pub.replace(tzinfo=None)
        elif isinstance(pub_raw, datetime):
            pub = pub_raw if pub_raw.tzinfo is None else pub_raw.replace(tzinfo=None)
        else:
            return 0.2
    except (ValueError, TypeError):
        return 0.2
    delta_h = max(0.0, (now - pub).total_seconds() / 3600.0)
    return math.exp(-delta_h / max(0.1, half_life_h))


def _relevance(
    item: dict,
    *,
    watch_codes: set[str] | None,
    hot_themes: set[str] | None,
    user_themes: set[str] | None = None,
) -> float:
    rel_codes = set(item.get("rel_codes") or [])
    themes = set(item.get("themes") or [])
    score = 0.0
    if watch_codes and (rel_codes & watch_codes):
        # 命中自选: 强匹配
        score = max(score, 1.0)
    if user_themes and (themes & user_themes):
        score = max(score, 0.85)
    if hot_themes and (themes & hot_themes):
        score = max(score, 0.65)
    if not score and rel_codes:
        # 至少关联了某些个股 (但不在自选), 给底分
        score = 0.20
    return score


def _sentiment_strength(item: dict) -> float:
    s = item.get("sentiment")
    if s in ("bullish", "bearish"):
        return 1.0
    if s == "neutral":
        return 0.40
    return 0.30  # 未打标


def _source_authority(item: dict) -> float:
    src = (item.get("source") or "").lower().strip()
    if not src:
        return SOURCE_AUTHORITY["default"]
    if src in SOURCE_AUTHORITY:
        return SOURCE_AUTHORITY[src]
    # 模糊匹配前缀
    for prefix, val in SOURCE_AUTHORITY.items():
        if prefix != "default" and src.startswith(prefix):
            return val
    return SOURCE_AUTHORITY["default"]


# ---------- 主入口 ----------

def score_one(
    item: dict,
    *,
    now: datetime,
    weights: dict[str, float],
    half_life_h: float,
    watch_codes: set[str] | None,
    hot_themes: set[str] | None,
    user_themes: set[str] | None = None,
) -> ScoreBreakdown:
    imp = _imp_norm(item)
    tdec = _time_decay(item, now=now, half_life_h=half_life_h)
    rel = _relevance(item, watch_codes=watch_codes, hot_themes=hot_themes, user_themes=user_themes)
    sent = _sentiment_strength(item)
    src = _source_authority(item)

    total = (
        weights.get("imp", 0) * imp
        + weights.get("time", 0) * tdec
        + weights.get("rel", 0) * rel
        + weights.get("sent", 0) * sent
        + weights.get("src", 0) * src
    )
    # 自选命中给一个加成 (避免低重要性的自选新闻被淹没)
    if watch_codes and rel >= 1.0:
        total += 0.08
    return ScoreBreakdown(imp=imp, time=tdec, rel=rel, sent=sent, src=src, total=total)


def rank_news(
    items: Iterable[dict],
    *,
    watch_codes: Iterable[str] | None = None,
    hot_themes: Iterable[str] | None = None,
    user_themes: Iterable[str] | None = None,
    weights: dict[str, float] | None = None,
    half_life_h: float = DEFAULT_HALF_LIFE_HOURS,
    top_k: int | None = None,
    now: datetime | None = None,
    attach_score: bool = False,
) -> list[dict]:
    """对新闻列表三段加权排序, 返回按 score 降序的 list.

    - attach_score=True 时, 每条新闻附 `_score` (float) + `_score_breakdown` (dict)
    - 不修改原 item; 返回浅拷贝
    """
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    wc = set(watch_codes or [])
    ht = set(hot_themes or [])
    ut = set(user_themes or [])
    n = now or datetime.now()

    scored: list[tuple[float, dict, ScoreBreakdown]] = []
    for it in items:
        bd = score_one(
            it, now=n, weights=w, half_life_h=half_life_h,
            watch_codes=wc, hot_themes=ht, user_themes=ut,
        )
        scored.append((bd.total, it, bd))

    scored.sort(key=lambda x: x[0], reverse=True)
    out: list[dict] = []
    for total, it, bd in scored:
        if attach_score:
            new_it = dict(it)
            new_it["_score"] = round(total, 4)
            new_it["_score_breakdown"] = bd.as_dict()
            out.append(new_it)
        else:
            out.append(it)
        if top_k is not None and len(out) >= top_k:
            break
    return out


def pick_evidence(
    items: Iterable[dict],
    *,
    watch_codes: Iterable[str] | None = None,
    hot_themes: Iterable[str] | None = None,
    top_k: int = 5,
    half_life_h: float = 12.0,  # evidence 用更长半衰期 (>12h 仍可作 evidence)
) -> list[dict]:
    """给 brief 选 evidence 用 — 默认 top_k=5, 半衰期更长."""
    return rank_news(
        items,
        watch_codes=watch_codes,
        hot_themes=hot_themes,
        weights={
            # evidence 时弱化时间, 强化 relevance + importance
            "imp": 0.40, "time": 0.18, "rel": 0.28, "sent": 0.08, "src": 0.06,
        },
        half_life_h=half_life_h,
        top_k=top_k,
    )
