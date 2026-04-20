"""5 张 AI 卡片的 headline streaming.

设计:
- 不重新跑完整 brief, 只 stream 一句 tagline / headline
- struct 用各模块现成的 _load / _summarize 函数, 同步加载 (毫秒级)
- prompt 用极简版: 强制 ≤ 30 字, 不带 JSON, 直接吐自然语言
- 输出 SSE: data: {"token": "..."} / data: {"done": true, "full_text": "..."} / data: {"error": "..."}
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from datetime import date

from app.ai.cross_context import NO_FLUFF_RULES, build_cross_context_block
from app.ai.llm_service import _get_client

logger = logging.getLogger(__name__)


# ----------------------------- struct 加载 -----------------------------


def _load_struct_for(kind: str, trade_date: date) -> dict | None:
    """根据 kind 调对应模块的 struct loader, 失败返回 None."""
    try:
        if kind == "today":
            from app.ai.brief_generator import _load_prev_overview, _load_snapshots

            snapshots = _load_snapshots(trade_date)
            overview = snapshots.get("overview") or {}
            prev_overview = _load_prev_overview(trade_date) or {}
            return {
                "kind": "today",
                "overview": overview,
                "prev_overview": prev_overview,
                "themes_top": (snapshots.get("themes") or {}).get("top", [])[:5],
                "ladder_height": (snapshots.get("ladder") or {}).get("max_height"),
            }
        if kind == "sentiment":
            from app.ai.sentiment_brief import _heuristic_phase, _load_sentiment_series

            series = _load_sentiment_series(trade_date)
            phase, phase_label = _heuristic_phase(series)
            latest = series[-1] if series else {}
            return {
                "kind": "sentiment",
                "struct": {
                    "phase": phase,
                    "phase_label": phase_label,
                    "latest_day": latest,
                    "recent_series": series[-5:],
                },
            }
        if kind == "theme":
            from app.ai.theme_brief import (
                _aggregate_themes,
                _derive_pools,
                _load_ladder_series,
                _load_themes_series,
            )

            themes = _load_themes_series(trade_date)
            ladder = _load_ladder_series(trade_date)
            agg = _aggregate_themes(themes, ladder)
            pools = _derive_pools(agg)
            return {"kind": "theme", "struct": {"agg": agg, "pools": pools}}
        if kind == "ladder":
            from app.ai.brief_generator import _load_snapshots
            from app.ai.ladder_brief import _summarize_ladder_struct

            snapshots = _load_snapshots(trade_date)
            return {
                "kind": "ladder",
                "struct": _summarize_ladder_struct(snapshots.get("ladder")),
            }
        if kind == "lhb":
            from app.ai.lhb_brief import _load_lhb_snapshot, _summarize_lhb_struct

            lhb = _load_lhb_snapshot(trade_date)
            return {"kind": "lhb", "struct": _summarize_lhb_struct(lhb)}
    except Exception as e:
        logger.warning("brief_stream load_struct(%s) failed: %s", kind, e)
        return None
    return None


# ----------------------------- prompt 构造 -----------------------------


_TAGLINE_RULE = (
    "输出格式: 严格只输出 1 句中文 tagline, ≤ 30 字, 不要 JSON, 不要 markdown, "
    "不要 prefix, 不要 quote, 不要解释."
)


def _build_prompt(kind: str, payload: dict, cross_ctx: str = "") -> tuple[str, str]:
    """根据 kind 构造 (system, user). 输出强制只是一句 tagline."""
    if kind == "today":
        overview = payload.get("overview", {})
        prev = payload.get("prev_overview", {})
        themes_top = payload.get("themes_top", [])
        height = payload.get("ladder_height")
        system = (
            "你是 A 股资深首席策略, 用 1 句 ≤30 字 tagline 概括今天的盘面定调.\n"
            "要求: 必须包含 (1) 涨跌停力量对比 或 炸板率 (2) 主线题材或最高板, "
            "禁止使用「市场情绪较好/分化加剧/谨慎乐观」这类套话.\n"
            f"{_TAGLINE_RULE}\n\n{NO_FLUFF_RULES}"
        )
        theme_brief = ", ".join(
            f"{t.get('name')}({t.get('lu', 0)}只)" for t in (themes_top or [])[:3]
        )
        user = (
            f"今日数据:\n"
            f"- 涨停 {overview.get('limit_up_count', 0)} / 跌停 {overview.get('limit_down_count', 0)}\n"
            f"- 炸板率 {overview.get('broken_rate', 0) * 100:.0f}%\n"
            f"- 昨涨停今涨率 {overview.get('yesterday_lu_up_rate', 0) * 100:.0f}%\n"
            f"- 最高板 {height}\n"
            f"- 主线题材 top3: {theme_brief or '无'}\n"
            f"- 昨日涨停 {prev.get('limit_up_count', '-')}\n"
            f"{cross_ctx}\n现在请直接输出 1 句 tagline:"
        )
        return system, user

    if kind == "sentiment":
        struct = payload.get("struct", {})
        system = (
            "你是 A 股情绪研判员, 用 1 句 ≤30 字 tagline 给出今日情绪定调.\n"
            "要求: 必须基于 phase / heat_change / 炸板率 / 昨涨停今涨率, 禁止「情绪较好/有所改善」这类套话.\n"
            f"{_TAGLINE_RULE}\n\n{NO_FLUFF_RULES}"
        )
        user = (
            f"情绪结构 JSON:\n{json.dumps(struct, ensure_ascii=False)[:1500]}\n\n"
            f"{cross_ctx}\n请直接输出 1 句 tagline:"
        )
        return system, user

    if kind == "theme":
        struct = payload.get("struct", {})
        system = (
            "你是 A 股主线挖掘师, 用 1 句 ≤30 字 tagline 概括今日主线.\n"
            "要求: 至少点名 1 个具体主线题材 + 1 个判断 (新主线/退潮/中军接力 之类), "
            "禁止「热点轮动/题材活跃」这类套话.\n"
            f"{_TAGLINE_RULE}\n\n{NO_FLUFF_RULES}"
        )
        user = (
            f"题材结构 JSON:\n{json.dumps(struct, ensure_ascii=False)[:1500]}\n\n"
            f"{cross_ctx}\n请直接输出 1 句 tagline:"
        )
        return system, user

    if kind == "ladder":
        struct = payload.get("struct", {})
        system = (
            "你是 A 股龙头跟踪员, 用 1 句 ≤30 字 tagline 概括今日连板梯队.\n"
            "要求: 必须出现最高板代表 (XX 最高 N 板) 或者 (晋级率 / 断板比例), "
            "禁止「连板表现一般/分化明显」这类套话.\n"
            f"{_TAGLINE_RULE}\n\n{NO_FLUFF_RULES}"
        )
        user = (
            f"连板结构 JSON:\n{json.dumps(struct, ensure_ascii=False)[:1500]}\n\n"
            f"{cross_ctx}\n请直接输出 1 句 tagline:"
        )
        return system, user

    if kind == "lhb":
        struct = payload.get("struct", {})
        system = (
            "你是 A 股龙虎榜分析师, 用 1 句 ≤30 字 tagline 概括今日龙虎榜.\n"
            "要求: 必须包含 净买入金额 或 上榜数 或 关键席位/游资名, "
            "禁止「资金分歧/游资活跃」这类套话.\n"
            f"{_TAGLINE_RULE}\n\n{NO_FLUFF_RULES}"
        )
        user = (
            f"龙虎榜结构 JSON:\n{json.dumps(struct, ensure_ascii=False)[:1500]}\n\n"
            f"{cross_ctx}\n请直接输出 1 句 tagline:"
        )
        return system, user

    raise ValueError(f"unknown kind: {kind}")


# ----------------------------- streaming 主入口 -----------------------------


# 给前端做 fallback: 后端 stream 失败时, 起码先回吐一段普通 headline (有的话用 cache).
def _fallback_headline(kind: str, payload: dict | None) -> str:
    if not payload:
        return f"{kind} 数据加载失败"
    if kind == "today":
        ov = payload.get("overview", {})
        return f"涨停 {ov.get('limit_up_count', 0)} 跌停 {ov.get('limit_down_count', 0)}, 炸板 {ov.get('broken_rate', 0) * 100:.0f}%"
    if kind == "sentiment":
        s = payload.get("struct", {})
        latest = s.get("latest_day") or {}
        return f"涨停 {latest.get('limit_up_count', 0)}, 炸板 {latest.get('broken_rate', 0) * 100:.0f}%"
    if kind == "theme":
        s = payload.get("struct", {})
        leading = (s.get("pools", {}).get("leading") or [])[:1]
        if leading:
            t = leading[0]
            lu_trend = t.get("lu_trend") or []
            lu_today = lu_trend[-1] if lu_trend else 0
            return f"主线 {t.get('name')} {lu_today} 只涨停"
        top10 = s.get("agg", {}).get("today_top10") or []
        if top10:
            return f"主线 {top10[0]} 居前"
    if kind == "ladder":
        s = payload.get("struct", {})
        return f"今日最高 {s.get('max_height', 0)} 板"
    if kind == "lhb":
        s = payload.get("struct", {})
        return f"上榜 {s.get('stock_count', 0)} 只, 净买入 {s.get('total_net', 0) / 1e8:+.1f} 亿"
    return ""


async def stream_headline(
    kind: str,
    trade_date: date,
    model_id: str = "deepseek-v3",
) -> AsyncGenerator[str, None]:
    """Yield SSE-formatted lines for the given brief kind."""
    if kind not in {"today", "sentiment", "theme", "ladder", "lhb"}:
        yield f"data: {json.dumps({'error': f'unknown kind: {kind}'}, ensure_ascii=False)}\n\n"
        return

    # 1. 加载 struct (同步, 毫秒级)
    payload = _load_struct_for(kind, trade_date)
    if not payload:
        fb = _fallback_headline(kind, None)
        yield f"data: {json.dumps({'error': 'no data', 'fallback': fb}, ensure_ascii=False)}\n\n"
        return

    # 2. 算 cross context (软读, 失败不阻塞)
    cross_ctx = ""
    try:
        if kind == "theme":
            cross_ctx = build_cross_context_block(trade_date, model_id, include_sentiment=True)
        elif kind == "ladder":
            cross_ctx = build_cross_context_block(
                trade_date, model_id, include_sentiment=True, include_theme=True
            )
        elif kind == "lhb":
            cross_ctx = build_cross_context_block(
                trade_date, model_id, include_theme=True, include_ladder=True
            )
        elif kind == "today":
            cross_ctx = build_cross_context_block(
                trade_date,
                model_id,
                include_sentiment=True,
                include_theme=True,
                include_ladder=True,
            )
    except Exception as e:
        logger.debug("cross_ctx skipped: %s", e)

    # 3. 构 prompt
    try:
        system, user = _build_prompt(kind, payload, cross_ctx)
    except Exception as e:
        logger.warning("brief_stream build_prompt failed: %s", e)
        fb = _fallback_headline(kind, payload)
        yield f"data: {json.dumps({'token': fb}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'done': True, 'full_text': fb, 'fallback': True}, ensure_ascii=False)}\n\n"
        return

    # 4. stream LLM
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
            full_text = _fallback_headline(kind, payload)
        yield f"data: {json.dumps({'done': True, 'full_text': full_text}, ensure_ascii=False)}\n\n"
    except Exception as e:
        logger.warning("brief_stream LLM error kind=%s: %s", kind, e)
        fb = _fallback_headline(kind, payload)
        yield f"data: {json.dumps({'error': str(e), 'fallback': fb}, ensure_ascii=False)}\n\n"
