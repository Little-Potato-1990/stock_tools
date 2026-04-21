"""新闻 AI 全局总结 (Phase 2 核心).

输入: 最近 24h 入库的新闻 (按 importance desc + pub_time desc, 取 top 80)
输出:
{
    "trade_date": "2026-04-21",
    "generated_at": "...",
    "model": "deepseek-v3",
    "stats": {"total": 120, "important": 18, "bullish": 35, "bearish": 12, "neutral": 73, "watch": 6},
    "headline": "≤45 字一句话总结",
    "main_threads": [          # ≤4 条主线
        {
            "name": "AI 算力",
            "summary": "20 字内主线判断",
            "themes": ["AI", "算力", "芯片"],
            "stock_codes": ["688256", "300474"],
            "news_ids": [12, 35, 88],   # 引用证据
            "sentiment": "bullish",
            "importance": 5,
        }
    ],
    "policy": [...],              # 政策类
    "shock": [...],               # 突发利空 / 黑天鹅
    "earnings": [...],            # 业绩 / 公告
    "watchlist_alerts": [...],    # 命中用户自选股的高重要新闻
    "tomorrow_brief": "≤80 字明日重点 + 关注主线/标的",
}

设计原则:
- 数字 (total/bullish/...) 100% 派生, LLM 不参与统计
- 主线 / 政策 / 突发 / 业绩 分桶: 先按 tags 规则归类, 再让 LLM 写 summary
- news_ids 用于前端反向跳转 (点 main_thread → 高亮原新闻列表)
- 跨 brief: 软读 sentiment_brief / theme_brief 作为参考
"""
from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any

from app.ai.brief_generator import _call_llm, _latest_trade_date_with_data
from app.ai.cross_context import NO_FLUFF_RULES, build_cross_context_block
from app.news.ingest import fetch_recent_news

logger = logging.getLogger(__name__)


# 政策 / 突发 / 业绩 分桶关键词
_POLICY_KW = ("政策", "新规", "出台", "国务院", "央行", "降准", "降息", "财政", "印发", "试点", "通知", "意见", "证监会")
_SHOCK_KW = ("突发", "黑天鹅", "立案", "暴跌", "闪崩", "停牌", "退市", "诉讼", "处罚", "调查", "事故", "停产")
_EARN_KW = ("业绩", "预告", "年报", "中报", "季报", "营收", "净利润", "亏损", "扭亏", "公告", "中标", "并购", "重组", "增持", "回购")


def _bucket_news(items: list[dict]) -> dict[str, list[dict]]:
    """按 (主线 / 政策 / 突发 / 业绩) 把新闻分桶."""
    main: list[dict] = []
    policy: list[dict] = []
    shock: list[dict] = []
    earnings: list[dict] = []
    for n in items:
        title = n.get("title", "")
        tags = n.get("tags") or []
        text = title + (n.get("content") or "")
        # 政策优先
        if any(kw in text for kw in _POLICY_KW) or "政策" in tags:
            policy.append(n)
            continue
        if any(kw in text for kw in _SHOCK_KW) or n.get("sentiment") == "bearish" and (n.get("importance") or 0) >= 4:
            shock.append(n)
            continue
        if any(kw in text for kw in _EARN_KW) or n.get("source", "").endswith("anns") or "公告" in tags:
            earnings.append(n)
            continue
        main.append(n)
    return {"main": main, "policy": policy, "shock": shock, "earnings": earnings}


def _aggregate_main_threads(main_news: list[dict], top_k: int = 4) -> list[dict]:
    """按 themes 聚类: 同 theme 出现次数最多 = 主线."""
    theme_groups: dict[str, list[dict]] = {}
    for n in main_news:
        for t in (n.get("themes") or []):
            theme_groups.setdefault(t, []).append(n)
    # 排序: 出现次数 desc, 重要级 desc, 时间 desc
    ranked = sorted(
        theme_groups.items(),
        key=lambda kv: (
            -len(kv[1]),
            -max((nn.get("importance") or 0) for nn in kv[1]),
        ),
    )[: top_k * 2]  # 多取 2x, 让 LLM 选

    threads: list[dict] = []
    used_news_ids: set[int] = set()
    for theme, nlist in ranked:
        # 跳过已被前面 thread 全部覆盖的小 theme
        new_ids = [nn.get("id") for nn in nlist if nn.get("id") not in used_news_ids]
        if not new_ids:
            continue
        all_codes: list[str] = []
        sentiments: Counter = Counter()
        max_imp = 0
        related_themes: Counter = Counter()
        for nn in nlist:
            for c in nn.get("rel_codes") or []:
                if c not in all_codes:
                    all_codes.append(c)
            sentiments[nn.get("sentiment") or "neutral"] += 1
            max_imp = max(max_imp, int(nn.get("importance") or 0))
            for t in nn.get("themes") or []:
                related_themes[t] += 1
        sent = sentiments.most_common(1)[0][0] if sentiments else "neutral"
        used_news_ids.update(nn.get("id") for nn in nlist)
        threads.append({
            "name": theme,
            "themes": [t for t, _ in related_themes.most_common(4)],
            "stock_codes": all_codes[:8],
            "news_ids": [nn.get("id") for nn in nlist[:6]],
            "sentiment": sent,
            "importance": max_imp,
            "count": len(nlist),
        })
        if len(threads) >= top_k:
            break
    return threads


def _stat_news(items: list[dict]) -> dict[str, int]:
    s = Counter()
    s["total"] = len(items)
    for n in items:
        if (n.get("importance") or 0) >= 4:
            s["important"] += 1
        sent = n.get("sentiment") or "neutral"
        s[sent] += 1
    return dict(s)


def _build_prompt(
    trade_date: str,
    stats: dict,
    threads: list[dict],
    buckets: dict[str, list[dict]],
    cross_ctx: str,
) -> tuple[str, str]:
    system = (
        "你是 A 股资讯首席策略, 任务: 给出今日新闻的全局判断 + 各主线的 20 字内总结. "
        "你只能基于给定的新闻列表, 严禁编造代码 / 公司 / 数字. "
        "不许写「整体来看」「值得关注」「保持谨慎」这类套话."
        + NO_FLUFF_RULES
    )

    def _brief_news(n: list[dict], limit: int = 8) -> list[dict]:
        return [
            {
                "id": x.get("id"),
                "title": (x.get("title") or "")[:80],
                "src": x.get("source"),
                "imp": x.get("importance"),
                "sent": x.get("sentiment"),
            }
            for x in n[:limit]
        ]

    payload = {
        "stats": stats,
        "main_threads_seed": [
            {
                "name": t["name"],
                "themes": t["themes"],
                "stock_codes": t["stock_codes"],
                "news_ids": t["news_ids"],
                "count": t["count"],
            }
            for t in threads
        ],
        "policy_top": _brief_news(buckets.get("policy", []), 6),
        "shock_top": _brief_news(buckets.get("shock", []), 6),
        "earnings_top": _brief_news(buckets.get("earnings", []), 8),
    }

    user = (
        f"今日 {trade_date}, 新闻全局结构如下 (你只能引用 main_threads_seed / policy_top / shock_top / earnings_top 里出现的 id):\n\n"
        f"```json\n{json.dumps(payload, ensure_ascii=False, default=str)[:6000]}\n```\n"
        f"{cross_ctx}\n"
        "请输出 JSON, schema:\n"
        "```json\n"
        "{\n"
        '  "headline": "≤45 字一句话, 必须出现 1 个具体主线 + 1 个数字 (如新闻数/主线只数)",\n'
        '  "main_threads": [\n'
        '    {\n'
        '      "name": "<主线名, 必须来自 seed>",\n'
        '      "summary": "≤30 字, 必须解释这条主线今天为什么有动静 + 利好/利空",\n'
        '      "stock_codes": ["≤4 个具体代码, 必须来自 seed.stock_codes"],\n'
        '      "news_ids": ["≤4 个 id, 必须来自 seed.news_ids"],\n'
        '      "sentiment": "bullish|neutral|bearish"\n'
        '    }\n'
        "  ],\n"
        '  "policy": [{"summary": "≤30字 政策解读", "news_ids": [..]}],\n'
        '  "shock": [{"summary": "≤30字 风险解读", "news_ids": [..]}],\n'
        '  "earnings": [{"summary": "≤30字 业绩/公告解读", "news_ids": [..]}],\n'
        '  "tomorrow_brief": "≤80字 明日盯点, 必须点名 1-2 个具体题材或代码"\n'
        "}\n```\n"
        "注意:\n"
        "- main_threads ≤ 4 条, 政策/突发/业绩各 ≤ 2 条\n"
        "- 没有相应内容的桶可以返回空数组 []\n"
        "- 不要返回 markdown fence"
    )
    return system, user


def _heuristic_brief(
    stats: dict, threads: list[dict], buckets: dict[str, list[dict]], trade_date: str
) -> dict[str, Any]:
    headline_parts: list[str] = []
    if stats["total"]:
        headline_parts.append(f"共抓 {stats['total']} 条要闻")
    if stats.get("important", 0):
        headline_parts.append(f"{stats['important']} 条重磅")
    if threads:
        headline_parts.append(f"主线: {threads[0]['name']}")
    headline = ", ".join(headline_parts) or f"{trade_date} 暂无显著资讯"

    main_threads_out = []
    for t in threads:
        main_threads_out.append({
            "name": t["name"],
            "summary": f"{t['count']} 条相关 / 倾向 {t['sentiment']}",
            "stock_codes": t["stock_codes"][:4],
            "news_ids": t["news_ids"][:4],
            "sentiment": t["sentiment"],
        })

    def _bucket_summary(items: list[dict], label: str) -> list[dict]:
        if not items:
            return []
        n0 = items[0]
        return [{
            "summary": f"{label}: {n0.get('title', '')[:25]}",
            "news_ids": [n.get("id") for n in items[:4] if n.get("id") is not None],
        }]

    return {
        "headline": headline[:45],
        "main_threads": main_threads_out,
        "policy": _bucket_summary(buckets.get("policy") or [], "政策"),
        "shock": _bucket_summary(buckets.get("shock") or [], "风险"),
        "earnings": _bucket_summary(buckets.get("earnings") or [], "业绩"),
        "tomorrow_brief": (
            f"明日继续看 {threads[0]['name']} 主线" if threads else "明日盯主线轮动"
        )[:80],
    }


def _merge_llm(
    base: dict, llm_out: dict | None, valid_ids: set[int],
) -> dict:
    if not llm_out:
        return base
    out = {**base}
    if llm_out.get("headline"):
        out["headline"] = str(llm_out["headline"]).strip()[:45]
    if llm_out.get("tomorrow_brief"):
        out["tomorrow_brief"] = str(llm_out["tomorrow_brief"]).strip()[:120]

    def _clean_news_ids(arr) -> list[int]:
        if not isinstance(arr, list):
            return []
        out_ids: list[int] = []
        for x in arr:
            try:
                v = int(x)
            except Exception:
                continue
            if v in valid_ids and v not in out_ids:
                out_ids.append(v)
        return out_ids[:6]

    if isinstance(llm_out.get("main_threads"), list):
        threads_out: list[dict] = []
        for t in llm_out["main_threads"][:4]:
            if not isinstance(t, dict):
                continue
            name = (t.get("name") or "").strip()[:20]
            summary = (t.get("summary") or "").strip()[:60]
            if not name or not summary:
                continue
            sent = t.get("sentiment") if t.get("sentiment") in ("bullish", "neutral", "bearish") else "neutral"
            codes = [str(c).strip() for c in (t.get("stock_codes") or [])[:4] if isinstance(c, str)]
            threads_out.append({
                "name": name,
                "summary": summary,
                "stock_codes": codes,
                "news_ids": _clean_news_ids(t.get("news_ids") or []),
                "sentiment": sent,
            })
        if threads_out:
            out["main_threads"] = threads_out

    for bucket in ("policy", "shock", "earnings"):
        arr = llm_out.get(bucket)
        if not isinstance(arr, list):
            continue
        bucket_out: list[dict] = []
        for it in arr[:3]:
            if not isinstance(it, dict):
                continue
            summary = (it.get("summary") or "").strip()[:60]
            if not summary:
                continue
            bucket_out.append({
                "summary": summary,
                "news_ids": _clean_news_ids(it.get("news_ids") or []),
            })
        if bucket_out:
            out[bucket] = bucket_out
    return out


# ----------------------------- 主入口 -----------------------------


async def generate_news_brief(
    trade_date: date | None = None,
    model_id: str = "deepseek-v3",
    *,
    hours: int = 24,
    watch_codes: list[str] | None = None,
) -> dict[str, Any]:
    """全局新闻总结. trade_date 仅用于 cache_key & cross_context."""
    td = trade_date or _latest_trade_date_with_data() or date.today()

    items = fetch_recent_news(hours=hours, limit=120, min_importance=None)
    stats = _stat_news(items)
    buckets = _bucket_news(items)
    threads = _aggregate_main_threads(buckets["main"], top_k=4)

    valid_ids: set[int] = {int(n.get("id")) for n in items if n.get("id") is not None}

    cross_ctx = ""
    try:
        cross_ctx = build_cross_context_block(
            td, model_id,
            include_sentiment=True, include_theme=True,
        )
    except Exception:
        pass

    base = _heuristic_brief(stats, threads, buckets, td.isoformat())
    base.update({
        "trade_date": td.isoformat(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "model": model_id,
        "stats": stats,
    })

    # 自选股命中告警
    if watch_codes:
        watch_set = set(watch_codes)
        alerts = []
        for n in items:
            hit = [c for c in (n.get("rel_codes") or []) if c in watch_set]
            if hit and (n.get("importance") or 0) >= 3:
                alerts.append({
                    "news_id": n.get("id"),
                    "title": n.get("title"),
                    "codes": hit,
                    "importance": n.get("importance"),
                    "sentiment": n.get("sentiment"),
                    "pub_time": n.get("pub_time"),
                })
        base["watchlist_alerts"] = alerts[:6]
        base["stats"]["watch"] = len(alerts)
    else:
        base["watchlist_alerts"] = []
        base["stats"].setdefault("watch", 0)

    if not items:
        base["headline"] = f"{td.isoformat()} 暂无新闻入库 — 等待下一轮采集"
        return base

    # 调 LLM
    system, user = _build_prompt(
        td.isoformat(), stats, threads, buckets, cross_ctx,
    )
    llm_out = await _call_llm(system, user, model_id)
    merged = _merge_llm(base, llm_out, valid_ids)
    return merged
