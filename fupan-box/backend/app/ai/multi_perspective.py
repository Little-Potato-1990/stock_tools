"""单次 LLM 调用同时出短/波/长三段 brief —— 给 StockDetailDrawer 顶部 PerspectiveBriefBar 用.

为什么不直接用 generate_why_rose + generate_swing_brief + generate_long_term_brief 拼?
答: 三次 LLM 调用 cost 太高, 且每段只需要 1 句 headline 给用户做导航,
不需要每段的完整 evidence. 这里专做"3 段一句话定调", 节省 60% token.

输出:
{
  "code": "...", "name": "...", "trade_date": "...",
  "generated_at": "...", "model": "...",
  "short_term": {"headline": "≤25字", "stance": "看多|看空|观望", "evidence": "≤30字"},
  "swing":      {"headline": "≤25字", "stance": "看多|震荡|看空", "evidence": "≤30字"},
  "long_term":  {"headline": "≤25字", "stance": "看好|中性|谨慎", "evidence": "≤30字"}
}

PG TTL: 24 小时 (Drawer 顶部条不需要分钟级新鲜).
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any

from app.ai.brief_generator import _call_llm, _latest_trade_date_with_data
from app.ai.cross_context import NO_FLUFF_RULES
from app.ai.active_skill import ActiveSkill, render_skill_system_block
from app.ai.long_term_brief import _load_long_term_context, _heuristic_brief as _long_hint
from app.ai.swing_brief import _load_swing_context, _heuristic as _swing_hint
from app.services.stock_context import get_stock_capital_sync

logger = logging.getLogger(__name__)


def _compress_for_short(cap_ctx: dict) -> dict:
    """压缩 stock_capital_sync 上下文给短线段使用."""
    if not cap_ctx:
        return {}
    out = {}
    cap = cap_ctx.get("capital") or {}
    if cap:
        out["main_today_yi"] = cap.get("main_inflow_today_yi")
        out["main_5d_yi"] = cap.get("main_inflow_5d_yi")
        out["north_today_yi"] = cap.get("north_change_today_yi")
    seat = cap_ctx.get("seat") or {}
    if seat:
        out["lhb_30d_count"] = seat.get("lhb_count_30d")
        out["famous_seat_30d"] = seat.get("famous_seat_count_30d")
    inst = cap_ctx.get("institutional") or {}
    if inst:
        out["holders_summary"] = inst.get("summary")
    return out


def _compress_for_swing(swing_ctx: dict) -> dict:
    if not swing_ctx:
        return {}
    out = {
        "today": swing_ctx.get("today"),
        "trend": swing_ctx.get("trend"),
        "lu_30d_count": swing_ctx.get("lu_30d_count"),
    }
    return out


def _compress_for_long(long_ctx: dict) -> dict:
    if not long_ctx:
        return {}
    out = {
        "valuation": long_ctx.get("valuation"),
        "consensus_latest": long_ctx.get("consensus_latest"),
        "roe_avg_5y": long_ctx.get("roe_avg_5y"),
    }
    funds = long_ctx.get("fundamentals_recent_8q") or []
    if funds:
        out["fundamentals_recent_2q"] = funds[-2:]
    return out


def _build_combined_prompt(
    code: str, name: str, trade_date: str,
    short_ctx: dict, swing_ctx: dict, long_ctx: dict,
    short_hint: str, swing_hint: str, long_hint: str,
    active_skill: ActiveSkill | None = None,
) -> tuple[str, str]:
    system = (
        f"你是 A 股多视角分析师, 给 {name}({code}) 同时给出短线/波段/长线三段一句话定调。"
        "三段必须独立成立 (短线讲今日盘面+资金, 波段讲5-20日趋势, 长线讲5年财务+估值+预期)。"
        "**禁止**: 三段重复同一个角度 / 编造数字 / 套话。"
        + NO_FLUFF_RULES
    )
    system += render_skill_system_block(active_skill)
    payload = {
        "short_ctx": short_ctx,
        "swing_ctx": swing_ctx,
        "long_ctx": long_ctx,
    }
    user = (
        f"日期: {trade_date}\n"
        f"压缩快照:\n```json\n{json.dumps(payload, ensure_ascii=False, default=str)[:4500]}\n```\n\n"
        f"规则版预判:\n"
        f"- short: {short_hint}\n"
        f"- swing: {swing_hint}\n"
        f"- long:  {long_hint}\n\n"
        "请输出 JSON, schema:\n"
        "```json\n"
        "{\n"
        '  "short_term": {"headline":"≤25字 今日盘面+资金","stance":"看多|看空|观望","evidence":"≤30字 一句证据"},\n'
        '  "swing":      {"headline":"≤25字 5-20日趋势","stance":"看多|震荡|看空","evidence":"≤30字 一句证据"},\n'
        '  "long_term":  {"headline":"≤25字 5年财务+估值","stance":"看好|中性|谨慎","evidence":"≤30字 一句证据"}\n'
        "}\n```\n不要 markdown fence。"
    )
    return system, user


def _heuristic_short(cap_ctx: dict, name: str) -> dict:
    cap = (cap_ctx or {}).get("capital") or {}
    main_today = cap.get("main_inflow_today_yi") or 0
    if main_today > 0.5:
        stance = "看多"
    elif main_today < -0.5:
        stance = "看空"
    else:
        stance = "观望"
    return {
        "headline": f"{name} 主力今日{main_today:+.1f}亿"[:30],
        "stance": stance,
        "evidence": f"主力净{main_today:+.1f}亿",
    }


def _heuristic_swing(swing_ctx: dict, name: str) -> dict:
    if not swing_ctx:
        return {"headline": f"{name} 波段数据不足", "stance": "震荡", "evidence": "无数据"}
    h = _swing_hint(swing_ctx)
    return {
        "headline": h["headline"][:30],
        "stance": h["stance"] if h["stance"] in {"看多", "震荡", "看空"} else "震荡",
        "evidence": (h.get("evidence") or [""])[0][:30] if h.get("evidence") else "无证据",
    }


def _heuristic_long(long_ctx: dict, name: str) -> dict:
    if not long_ctx:
        return {"headline": f"{name} 长线数据不足", "stance": "中性", "evidence": "无数据"}
    h = _long_hint(long_ctx)
    return {
        "headline": h["headline"][:30],
        "stance": h["stance"] if h["stance"] in {"看好", "中性", "谨慎"} else "中性",
        "evidence": (h.get("evidence") or [""])[0][:30] if h.get("evidence") else "无证据",
    }


def _validate_segment(seg: Any, valid_stances: set[str], fallback: dict) -> dict:
    if not isinstance(seg, dict):
        return fallback
    headline = (seg.get("headline") or "").strip()[:35]
    stance = seg.get("stance")
    evidence = (seg.get("evidence") or "").strip()[:40]
    if not headline:
        headline = fallback["headline"]
    if stance not in valid_stances:
        stance = fallback["stance"]
    if not evidence:
        evidence = fallback["evidence"]
    return {"headline": headline, "stance": stance, "evidence": evidence}


async def generate_multi_perspective(
    code: str,
    trade_date: date | None = None,
    model_id: str = "deepseek-v3",
    active_skill: ActiveSkill | None = None,
) -> dict[str, Any]:
    """三视角一句话 brief 主入口."""
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()
    code = str(code).strip().zfill(6)

    cap_ctx = {}
    try:
        cap_ctx = get_stock_capital_sync(code, trade_date) or {}
    except Exception as e:
        logger.warning(f"multi_perspective short ctx {code} fail: {e}")
    name = (cap_ctx.get("name") or code)

    swing_ctx = _load_swing_context(code, trade_date)
    long_ctx = _load_long_term_context(code, trade_date)
    if swing_ctx and swing_ctx.get("name"):
        name = swing_ctx["name"]
    elif long_ctx and long_ctx.get("name"):
        name = long_ctx["name"]

    short_fb = _heuristic_short(cap_ctx, name)
    swing_fb = _heuristic_swing(swing_ctx, name)
    long_fb = _heuristic_long(long_ctx, name)

    base = {
        "code": code,
        "name": name,
        "trade_date": trade_date.isoformat(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "model": model_id,
        "short_term": short_fb,
        "swing": swing_fb,
        "long_term": long_fb,
    }

    if not (cap_ctx or swing_ctx or long_ctx):
        return base

    short_compact = _compress_for_short(cap_ctx)
    swing_compact = _compress_for_swing(swing_ctx or {})
    long_compact = _compress_for_long(long_ctx or {})

    system, user = _build_combined_prompt(
        code, name, trade_date.isoformat(),
        short_compact, swing_compact, long_compact,
        f"{short_fb['stance']} | {short_fb['headline']}",
        f"{swing_fb['stance']} | {swing_fb['headline']}",
        f"{long_fb['stance']} | {long_fb['headline']}",
        active_skill=active_skill,
    )
    llm_out = await _call_llm(system, user, model_id)
    if not isinstance(llm_out, dict):
        return base

    base["short_term"] = _validate_segment(
        llm_out.get("short_term"), {"看多", "看空", "观望"}, short_fb,
    )
    base["swing"] = _validate_segment(
        llm_out.get("swing"), {"看多", "震荡", "看空"}, swing_fb,
    )
    base["long_term"] = _validate_segment(
        llm_out.get("long_term"), {"看好", "中性", "谨慎"}, long_fb,
    )
    return base
