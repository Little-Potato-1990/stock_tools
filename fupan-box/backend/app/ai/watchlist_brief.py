"""自选股 AI 一句话定调 — P3-D Watchlist 覆盖.

设计:
- 输入: 用户的 stock codes (≤30) + trade_date
- 派生: 每只今日涨跌幅 / 涨停状态 / 题材 / 龙虎榜 / 是否在主线
- LLM: 1 句 ≤ 30 字 整体定调 + 每只 ≤ 20 字 点评 + 1 个明天关键关注点
- 不按 user_id 缓存, 按 (codes_hash, trade_date) 缓存
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import date
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.ai.brief_generator import _call_llm, _latest_trade_date_with_data
from app.ai.cross_context import NO_FLUFF_RULES, build_cross_context_block
from app.ai.active_skill import ActiveSkill, render_skill_system_block
from app.config import get_settings
from app.models.market import LimitUpRecord
from app.models.stock import DailyQuote, Stock

logger = logging.getLogger(__name__)


def codes_hash(codes: list[str]) -> str:
    sorted_codes = sorted({(c or "").strip() for c in codes if c})
    if not sorted_codes:
        return "empty"
    raw = ",".join(sorted_codes)
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:12]


def _engine():
    return create_engine(get_settings().database_url_sync)


def _load_codes_struct(codes: list[str], trade_date: date) -> dict[str, Any]:
    codes = sorted({(c or "").strip() for c in codes if c})
    if not codes:
        return {"trade_date": str(trade_date), "stocks": [], "summary": {}}

    engine = _engine()
    out: list[dict[str, Any]] = []
    try:
        with Session(engine) as s:
            quotes = {
                q.stock_code: q
                for q in s.execute(
                    select(DailyQuote).where(
                        DailyQuote.stock_code.in_(codes),
                        DailyQuote.trade_date == trade_date,
                    )
                ).scalars().all()
            }
            lus = {
                r.stock_code: r
                for r in s.execute(
                    select(LimitUpRecord).where(
                        LimitUpRecord.stock_code.in_(codes),
                        LimitUpRecord.trade_date == trade_date,
                    )
                ).scalars().all()
            }
            stocks_meta = {
                m.code: m
                for m in s.execute(
                    select(Stock).where(Stock.code.in_(codes))
                ).scalars().all()
            }

            for code in codes:
                q = quotes.get(code)
                lu = lus.get(code)
                meta = stocks_meta.get(code)
                if not q and not meta:
                    out.append({
                        "code": code,
                        "name": code,
                        "found": False,
                    })
                    continue
                rec = {
                    "code": code,
                    "name": (meta.name if meta else code),
                    "industry": (meta.industry if meta else None),
                    "is_st": (meta.is_st if meta else False),
                    "found": q is not None,
                    "change_pct": float(q.change_pct) if q and q.change_pct is not None else None,
                    "turnover_rate": float(q.turnover_rate) if q and q.turnover_rate is not None else None,
                    "amount": float(q.amount) if q and q.amount is not None else None,
                    "is_limit_up": bool(q.is_limit_up) if q else False,
                    "is_limit_down": bool(q.is_limit_down) if q else False,
                }
                if lu:
                    rec["lu_continuous_days"] = lu.continuous_days
                    rec["lu_themes"] = lu.theme_names or []
                    rec["lu_reason"] = (lu.limit_reason or "")[:30]
                    rec["lu_open_count"] = lu.open_count
                    rec["lu_one_word"] = bool(lu.is_one_word)
                out.append(rec)
    finally:
        engine.dispose()

    valid = [r for r in out if r.get("found")]
    chgs = [r["change_pct"] for r in valid if r.get("change_pct") is not None]
    summary = {
        "total": len(out),
        "found": len(valid),
        "missing": len(out) - len(valid),
        "limit_up": sum(1 for r in valid if r.get("is_limit_up")),
        "limit_down": sum(1 for r in valid if r.get("is_limit_down")),
        "avg_change_pct": round(sum(chgs) / len(chgs), 2) if chgs else None,
        "winners": sorted(
            [r for r in valid if r.get("change_pct") is not None],
            key=lambda r: r["change_pct"],
            reverse=True,
        )[:3],
        "losers": sorted(
            [r for r in valid if r.get("change_pct") is not None],
            key=lambda r: r["change_pct"],
        )[:3],
    }

    return {
        "trade_date": str(trade_date),
        "stocks": out,
        "summary": summary,
    }


def _build_prompt(
    struct: dict[str, Any], cross_ctx: str, active_skill: ActiveSkill | None = None
) -> tuple[str, str]:
    system = (
        "你是用户的私人盯盘助手. 用户给你他自选股的当日行情, 你给一份「今日 watchlist 定调」.\n"
        "格式要求:\n"
        "- headline: 1 句 ≤ 30 字, 必须出现胜负比 / 涨停只数 / 主线占比 之一, 禁止套话\n"
        "- per_stock 最多 6 条, 优先涨停 + 大涨 + 大跌\n"
        "- focus 1 个明天最值得盯的代码 + 理由 ≤ 30 字\n"
        f"\n{NO_FLUFF_RULES}"
    )
    system += render_skill_system_block(active_skill)
    user = (
        f"自选股结构:\n```json\n{json.dumps(struct, ensure_ascii=False)[:3500]}\n```\n\n"
        f"{cross_ctx}\n"
        "请输出 JSON, schema:\n"
        "```json\n"
        "{\n"
        '  "headline": "1 句 ≤ 30 字 总定调",\n'
        '  "per_stock": [\n'
        '    {"code": "(必须从 stocks 选)", "tag": "涨停 / 大涨 / 大跌 / 跌停 / 主线 / 退潮 / 平稳 之一", "note": "≤ 20 字 点评"}\n'
        '  ],\n'
        '  "focus": {"code": "(必须从 stocks 选)", "reason": "≤ 30 字 明天关注理由"},\n'
        '  "evidence": ["1-3 条 ≤ 30 字 关键数字, 必须引用 struct 里的真实数字"]\n'
        "}\n```\n"
        "**tag 必须严格按 change_pct 阈值**: "
        "≥+9.8% 涨停 / ≥+5% 大涨 / ≤-9.8% 跌停 / ≤-5% 大跌 / -5%~+5% 之间一律标 平稳, "
        "禁止把微涨微跌标成大涨大跌。如该票在 themes/cross_context 里属当日主线, 可改标 主线; "
        "如属退潮分支可标 退潮。"
    )
    return system, user


def _heuristic_brief(struct: dict[str, Any]) -> dict[str, Any]:
    summary = struct.get("summary", {})
    stocks = struct.get("stocks", [])

    if summary.get("found", 0) == 0:
        return {
            "headline": "自选股今日无行情数据",
            "per_stock": [],
            "focus": {"code": "", "reason": "添加自选股后再查看"},
            "evidence": ["暂无可用数据"],
        }

    lu = summary.get("limit_up", 0)
    ld = summary.get("limit_down", 0)
    avg = summary.get("avg_change_pct", 0) or 0
    if lu > 0:
        headline = f"自选 {summary['found']} 票今日 {lu} 涨停, 平均 {avg:+.1f}%"
    elif ld > 0:
        headline = f"自选 {ld} 票跌停, 整体 {avg:+.1f}%, 注意控仓"
    else:
        headline = f"自选 {summary['found']} 票平均 {avg:+.1f}%, 无极端走势"

    per_stock: list[dict[str, str]] = []
    for r in (summary.get("winners") or [])[:3]:
        tag = "涨停" if r.get("is_limit_up") else "大涨"
        per_stock.append({
            "code": r["code"],
            "tag": tag,
            "note": f"{r['name']} {r['change_pct']:+.1f}% · {r.get('industry') or '其他'}",
        })
    for r in (summary.get("losers") or [])[:2]:
        if r.get("change_pct") is None or r["change_pct"] >= -2:
            continue
        per_stock.append({
            "code": r["code"],
            "tag": "大跌",
            "note": f"{r['name']} {r['change_pct']:+.1f}% · 注意止损",
        })

    focus_pick = next(
        (r for r in stocks if r.get("is_limit_up") and r.get("lu_continuous_days", 0) >= 2),
        None,
    ) or (summary.get("winners") or [None])[0]
    if focus_pick:
        focus = {
            "code": focus_pick["code"],
            "reason": f"{focus_pick['name']} 今日 {focus_pick.get('change_pct', 0):+.1f}%, 跟踪明日强弱",
        }
    else:
        focus = {"code": "", "reason": "无明显标的, 等待主线明朗"}

    return {
        "headline": headline,
        "per_stock": per_stock,
        "focus": focus,
        "evidence": [
            f"涨停 {lu} / 跌停 {ld} / 共 {summary['found']} 只",
            f"平均涨跌 {avg:+.2f}%",
        ],
    }


_KEEP_LLM_TAGS = {"主线", "退潮"}


def _enforce_tag(llm_tag: str, change_pct: float | None, is_lu: bool, is_ld: bool) -> str:
    """硬阈值校正: LLM 给的 tag 与真实 change_pct 不符时, 直接按数字覆盖.

    主线/退潮 是基于 cross_context 的语义判断, 数字阈值无法覆盖, 保留 LLM 选择.
    """
    if is_lu:
        return "涨停"
    if is_ld:
        return "跌停"
    if change_pct is None:
        return llm_tag.strip()[:8] or "平稳"
    if llm_tag in _KEEP_LLM_TAGS:
        return llm_tag
    if change_pct >= 9.8:
        return "涨停"
    if change_pct >= 5:
        return "大涨"
    if change_pct <= -9.8:
        return "跌停"
    if change_pct <= -5:
        return "大跌"
    return "平稳"


def _merge_llm(base: dict[str, Any], llm_out: dict | None, struct: dict[str, Any]) -> dict[str, Any]:
    if not llm_out:
        return base
    h = (llm_out.get("headline") or "").strip()
    if h:
        base["headline"] = h[:60]

    stocks_by_code = {r["code"]: r for r in struct.get("stocks", [])}
    valid_codes = set(stocks_by_code.keys())

    raw_per = llm_out.get("per_stock") or []
    cleaned: list[dict[str, str]] = []
    for it in raw_per[:6]:
        if not isinstance(it, dict):
            continue
        code = (it.get("code") or "").strip()
        if code not in valid_codes:
            continue
        rec = stocks_by_code[code]
        tag = _enforce_tag(
            (it.get("tag") or "").strip(),
            rec.get("change_pct"),
            bool(rec.get("is_limit_up")),
            bool(rec.get("is_limit_down")),
        )
        cleaned.append({
            "code": code,
            "tag": tag,
            "note": (it.get("note") or "").strip()[:40],
        })
    if cleaned:
        base["per_stock"] = cleaned

    f = llm_out.get("focus") or {}
    if isinstance(f, dict):
        fc = (f.get("code") or "").strip()
        fr = (f.get("reason") or "").strip()[:50]
        if fc and fc in valid_codes and fr:
            base["focus"] = {"code": fc, "reason": fr}

    ev = llm_out.get("evidence") or []
    cleaned_ev: list[str] = []
    for raw in ev[:3]:
        s = (str(raw) if not isinstance(raw, str) else raw).strip()[:40]
        if s:
            cleaned_ev.append(s)
    if cleaned_ev:
        base["evidence"] = cleaned_ev

    return base


async def generate_watchlist_brief(
    codes: list[str],
    trade_date: date | None = None,
    model_id: str = "deepseek-v3",
    active_skill: ActiveSkill | None = None,
) -> dict[str, Any]:
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()

    struct = _load_codes_struct(codes, trade_date)
    base = _heuristic_brief(struct)

    cross_ctx = ""
    try:
        cross_ctx = build_cross_context_block(
            trade_date,
            model_id,
            include_sentiment=True,
            include_theme=True,
        )
    except Exception as e:
        logger.debug("watchlist_brief cross_ctx skipped: %s", e)

    if struct.get("summary", {}).get("found", 0) > 0:
        system, user = _build_prompt(struct, cross_ctx, active_skill=active_skill)
        llm_out = await _call_llm(system, user, model_id)
        base = _merge_llm(base, llm_out, struct)

    return {
        "trade_date": str(trade_date),
        "model": model_id,
        "stocks_count": struct.get("summary", {}).get("total", 0),
        "found": struct.get("summary", {}).get("found", 0),
        **base,
    }
