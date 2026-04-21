"""新闻 brief headline SSE 流 — 给 NewsAiCard 的打字机效果用.

只 stream headline (≤45 字), 不替换完整 news_brief 缓存.
"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from datetime import date

from app.ai.cross_context import NO_FLUFF_RULES, build_cross_context_block
from app.ai.llm_service import _get_client
from app.ai.news_brief import _aggregate_main_threads, _bucket_news, _stat_news
from app.news.ingest import fetch_recent_news

logger = logging.getLogger(__name__)


def _build_prompt(stats: dict, threads: list[dict], cross_ctx: str) -> tuple[str, str]:
    system = (
        "你是 A 股资讯首席, 用 1 句 ≤40 字 tagline 概括今天的资讯面.\n"
        "要求: 必须包含 (1) 新闻总数 或 重磅数 (2) 1 个具体主线题材 + 利好/利空倾向, "
        "禁止 '资讯活跃 / 热点轮动 / 多点开花' 之类的套话.\n"
        "输出格式: 严格只输出 1 句中文 tagline, 不要 JSON, 不要 markdown, "
        "不要前缀, 不要解释."
        + NO_FLUFF_RULES
    )
    threads_brief = "; ".join(
        f"{t['name']}({t['count']}条/{t['sentiment']})" for t in (threads or [])[:3]
    )
    user = (
        f"今日数据: 共 {stats.get('total', 0)} 条, "
        f"重磅 {stats.get('important', 0)}, "
        f"利好 {stats.get('bullish', 0)} / 利空 {stats.get('bearish', 0)}.\n"
        f"主线候选: {threads_brief or '无显著主线'}\n"
        f"{cross_ctx}\n"
        "现在请直接输出 1 句 tagline:"
    )
    return system, user


def _fallback(stats: dict, threads: list[dict]) -> str:
    if not stats.get("total"):
        return "今日暂无新闻入库, 等待下一轮采集"
    parts = [f"共 {stats['total']} 条要闻"]
    if stats.get("important"):
        parts.append(f"{stats['important']} 条重磅")
    if threads:
        parts.append(f"主线 {threads[0]['name']}")
    return ", ".join(parts)[:45]


async def stream_news_headline(
    trade_date: date,
    model_id: str = "deepseek-v3",
    hours: int = 24,
) -> AsyncGenerator[str, None]:
    items = fetch_recent_news(hours=hours, limit=120)
    stats = _stat_news(items)
    buckets = _bucket_news(items)
    threads = _aggregate_main_threads(buckets["main"], top_k=3)

    cross_ctx = ""
    try:
        cross_ctx = build_cross_context_block(
            trade_date, model_id, include_sentiment=True, include_theme=True,
        )
    except Exception:
        pass

    if not items:
        fb = _fallback(stats, threads)
        yield f"data: {json.dumps({'token': fb}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'done': True, 'full_text': fb}, ensure_ascii=False)}\n\n"
        return

    system, user = _build_prompt(stats, threads, cross_ctx)
    client = _get_client()
    collected: list[str] = []
    try:
        resp = await client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            stream=True,
            max_tokens=120,
            temperature=0.4,
        )
        async for chunk in resp:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                tok = delta.content
                collected.append(tok)
                yield f"data: {json.dumps({'token': tok}, ensure_ascii=False)}\n\n"
        full_text = "".join(collected).strip().strip('"').strip()
        if not full_text:
            full_text = _fallback(stats, threads)
        yield f"data: {json.dumps({'done': True, 'full_text': full_text}, ensure_ascii=False)}\n\n"
    except Exception as e:
        logger.warning("news_stream LLM error: %s", e)
        fb = _fallback(stats, threads)
        yield f"data: {json.dumps({'error': str(e), 'fallback': fb}, ensure_ascii=False)}\n\n"
