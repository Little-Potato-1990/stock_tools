"""为什么涨/跌 — 单股 AI 综合解读.

数据综合: 今日 K + 涨停信息 + 同板表现 + 龙虎榜 + 近 5 日 K
LLM 输出: 真实驱动 / 卡位 / 高度 / 明日策略 / verdict
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import create_engine, select, desc
from sqlalchemy.orm import Session

from app.ai.brief_generator import _call_llm, _latest_trade_date_with_data
from app.config import get_settings
from app.models.market import LimitUpRecord
from app.models.snapshot import DailySnapshot
from app.models.stock import DailyQuote, Stock

logger = logging.getLogger(__name__)


def _load_today_quote(session: Session, code: str, trade_date: date) -> DailyQuote | None:
    return session.execute(
        select(DailyQuote).where(
            DailyQuote.stock_code == code,
            DailyQuote.trade_date == trade_date,
        )
    ).scalar_one_or_none()


def _load_recent_quotes(session: Session, code: str, trade_date: date, days: int = 10) -> list[DailyQuote]:
    rows = session.execute(
        select(DailyQuote)
        .where(DailyQuote.stock_code == code, DailyQuote.trade_date <= trade_date)
        .order_by(desc(DailyQuote.trade_date))
        .limit(days)
    ).scalars().all()
    return list(reversed(rows))


def _load_today_lu(session: Session, code: str, trade_date: date) -> LimitUpRecord | None:
    return session.execute(
        select(LimitUpRecord).where(
            LimitUpRecord.stock_code == code,
            LimitUpRecord.trade_date == trade_date,
        )
    ).scalar_one_or_none()


def _load_lu_history(session: Session, code: str, trade_date: date, days: int = 20) -> list[LimitUpRecord]:
    start = trade_date - timedelta(days=days)
    rows = session.execute(
        select(LimitUpRecord)
        .where(
            LimitUpRecord.stock_code == code,
            LimitUpRecord.trade_date <= trade_date,
            LimitUpRecord.trade_date >= start,
        )
        .order_by(desc(LimitUpRecord.trade_date))
    ).scalars().all()
    return list(rows)


def _load_stock_meta(session: Session, code: str) -> Stock | None:
    return session.execute(
        select(Stock).where(Stock.code == code)
    ).scalar_one_or_none()


def _theme_peers_today(session: Session, theme: str, trade_date: date, exclude_code: str) -> dict[str, Any]:
    lu_rows = session.execute(
        select(LimitUpRecord).where(LimitUpRecord.trade_date == trade_date)
    ).scalars().all()

    same_theme = [
        r for r in lu_rows
        if r.theme_names and theme in r.theme_names and r.stock_code != exclude_code
    ]
    broken = [r for r in same_theme if r.open_count and r.open_count > 0]

    quotes_today = session.execute(
        select(DailyQuote).where(DailyQuote.trade_date == trade_date)
    ).scalars().all()
    code_to_quote = {q.stock_code: q for q in quotes_today}

    stock_metas = {s.code: s for s in session.execute(select(Stock)).scalars().all()}

    peers_brief = []
    for r in same_theme[:6]:
        q = code_to_quote.get(r.stock_code)
        meta = stock_metas.get(r.stock_code)
        peers_brief.append({
            "code": r.stock_code,
            "name": meta.name if meta else r.stock_code,
            "board": r.continuous_days,
            "first_limit_time": str(r.first_limit_time) if r.first_limit_time else None,
            "broken": (r.open_count or 0) > 0,
            "open_count": r.open_count or 0,
            "change_pct": float(q.change_pct) if q and q.change_pct else None,
        })

    return {
        "lu_count": len(same_theme),
        "broken_count": len(broken),
        "broken_rate": round(len(broken) / len(same_theme), 2) if same_theme else 0.0,
        "peers": peers_brief,
    }


def _load_lhb(session: Session, code: str, trade_date: date) -> dict[str, Any] | None:
    snap = session.execute(
        select(DailySnapshot).where(
            DailySnapshot.snapshot_type == "lhb",
            DailySnapshot.trade_date == trade_date,
        )
    ).scalar_one_or_none()
    if not snap or not snap.data:
        return None
    insts_by_code = (snap.data or {}).get("insts_by_code") or {}
    arr = insts_by_code.get(code)
    if not arr:
        return None
    inst_buy = sum(i.get("net_buy", 0) for i in arr if i.get("is_inst"))
    hot_money = [i for i in arr if not i.get("is_inst")]
    hot_buy = sum(i.get("net_buy", 0) for i in hot_money)
    top_seats = sorted(arr, key=lambda x: abs(x.get("net_buy", 0)), reverse=True)[:5]
    return {
        "inst_net_buy_wan": round(inst_buy / 1e4, 0),
        "hot_money_net_buy_wan": round(hot_buy / 1e4, 0),
        "top_seats": [
            {
                "name": s.get("exalter", ""),
                "side": s.get("side", ""),
                "net_buy_wan": round(s.get("net_buy", 0) / 1e4, 0),
                "is_inst": bool(s.get("is_inst")),
            }
            for s in top_seats
        ],
    }


def _build_context(code: str, trade_date: date) -> dict[str, Any] | None:
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            meta = _load_stock_meta(session, code)
            today_quote = _load_today_quote(session, code, trade_date)
            if not today_quote:
                return None

            recent = _load_recent_quotes(session, code, trade_date, days=10)
            lu_today = _load_today_lu(session, code, trade_date)
            lu_history = _load_lu_history(session, code, trade_date, days=20)

            recent_brief = [
                {
                    "date": q.trade_date.isoformat(),
                    "open": float(q.open) if q.open else 0,
                    "close": float(q.close) if q.close else 0,
                    "high": float(q.high) if q.high else 0,
                    "low": float(q.low) if q.low else 0,
                    "change_pct": float(q.change_pct) if q.change_pct else 0,
                    "amount_yi": round(float(q.amount or 0) / 1e8, 2),
                    "turnover_rate": float(q.turnover_rate) if q.turnover_rate else None,
                    "is_lu": bool(q.is_limit_up),
                    "is_ld": bool(q.is_limit_down),
                }
                for q in recent
            ]

            lu_brief = None
            primary_theme = None
            if lu_today:
                themes = lu_today.theme_names or []
                primary_theme = themes[0] if themes else None
                lu_brief = {
                    "continuous_days": lu_today.continuous_days,
                    "first_limit_time": str(lu_today.first_limit_time) if lu_today.first_limit_time else None,
                    "last_limit_time": str(lu_today.last_limit_time) if lu_today.last_limit_time else None,
                    "open_count": lu_today.open_count or 0,
                    "limit_order_amount_yi": round(float(lu_today.limit_order_amount or 0) / 1e8, 2),
                    "is_one_word": bool(lu_today.is_one_word),
                    "is_t_board": bool(lu_today.is_t_board),
                    "limit_reason": lu_today.limit_reason,
                    "themes": themes,
                    "industry": lu_today.industry,
                }

            lu_history_brief = [
                {
                    "date": r.trade_date.isoformat(),
                    "board": r.continuous_days,
                    "broken": (r.open_count or 0) > 0,
                }
                for r in lu_history
            ]

            peers = _theme_peers_today(session, primary_theme, trade_date, code) if primary_theme else None
            lhb = _load_lhb(session, code, trade_date)

            return {
                "code": code,
                "name": meta.name if meta else (lu_today.stock_name if lu_today else code),
                "industry": (meta.industry if meta else None) or (lu_today.industry if lu_today else None),
                "trade_date": trade_date.isoformat(),
                "today_quote": {
                    "open": float(today_quote.open) if today_quote.open else 0,
                    "close": float(today_quote.close) if today_quote.close else 0,
                    "high": float(today_quote.high) if today_quote.high else 0,
                    "low": float(today_quote.low) if today_quote.low else 0,
                    "change_pct": float(today_quote.change_pct) if today_quote.change_pct else 0,
                    "amount_yi": round(float(today_quote.amount or 0) / 1e8, 2),
                    "turnover_rate": float(today_quote.turnover_rate) if today_quote.turnover_rate else None,
                    "amplitude": float(today_quote.amplitude) if today_quote.amplitude else None,
                    "is_lu": bool(today_quote.is_limit_up),
                    "is_ld": bool(today_quote.is_limit_down),
                },
                "recent_10d": recent_brief,
                "lu_today": lu_brief,
                "lu_history_20d": lu_history_brief,
                "primary_theme": primary_theme,
                "theme_peers": peers,
                "lhb": lhb,
            }
    finally:
        engine.dispose()


def _heuristic_brief(ctx: dict[str, Any]) -> dict[str, Any]:
    code = ctx["code"]
    name = ctx["name"]
    chg = ctx["today_quote"]["change_pct"]
    direction = "rose" if chg >= 0 else "fell"
    headline = f"{name} 今日{'+' if chg >= 0 else ''}{chg:.2f}%"

    drivers = []
    if ctx.get("lu_today"):
        lu = ctx["lu_today"]
        drivers.append({"label": "涨停原因", "text": (lu.get("limit_reason") or "")[:80] or "无明确催化"})
        if lu.get("themes"):
            drivers.append({"label": "题材", "text": "、".join(lu["themes"][:3])})
    if ctx.get("theme_peers"):
        p = ctx["theme_peers"]
        drivers.append({
            "label": "同板",
            "text": f"同题材今日 {p['lu_count']} 涨停, 炸板率 {p['broken_rate']*100:.0f}%",
        })

    position = {"label": "卡位", "text": "数据不足以判断卡位"}
    if ctx.get("lu_today"):
        lu = ctx["lu_today"]
        board = lu["continuous_days"]
        first = lu.get("first_limit_time") or "未知"
        broken = lu.get("open_count") or 0
        position = {
            "label": "卡位",
            "text": f"{board} 板, 首次封板 {first}{', 全日炸板 ' + str(broken) + ' 次' if broken else ''}",
        }

    height = {"label": "高度", "text": "无连板信息"}
    if ctx.get("lu_today"):
        board = ctx["lu_today"]["continuous_days"]
        if board >= 5:
            height = {"label": "高度", "text": f"{board} 板高位, 注意分歧风险"}
        elif board >= 3:
            height = {"label": "高度", "text": f"{board} 板中位, 关注次日承接"}
        elif board == 2:
            height = {"label": "高度", "text": "2 板初期, 看明日是否打开空间"}
        else:
            height = {"label": "高度", "text": "首板, 看明日量能"}

    tomorrow = {"label": "明日策略", "text": "等待 LLM 给出执行建议"}

    verdict = "B"
    if ctx.get("lu_today"):
        board = ctx["lu_today"]["continuous_days"]
        broken = ctx["lu_today"].get("open_count") or 0
        if board >= 5 and broken == 0:
            verdict = "A"
        elif board >= 3 and broken <= 1:
            verdict = "B"
        else:
            verdict = "C"

    verdict_label_map = {"S": "罕见龙头", "A": "典型龙头", "B": "标准龙头", "C": "偏弱"}

    return {
        "code": code,
        "name": name,
        "trade_date": ctx["trade_date"],
        "direction": direction,
        "headline": headline,
        "drivers": drivers,
        "position": position,
        "height": height,
        "tomorrow": tomorrow,
        "verdict": verdict,
        "verdict_label": verdict_label_map[verdict],
    }


def _build_prompt(ctx: dict[str, Any]) -> tuple[str, str]:
    chg = ctx["today_quote"]["change_pct"]
    direction = "上涨" if chg >= 0 else "下跌"
    system = (
        f"你是 A 股超短线复盘专家。下面是 {ctx['name']}({ctx['code']}) 今日({ctx['trade_date']}) {direction} {chg:.2f}% 的全部数据。"
        "你的任务是输出一份精炼的「为什么涨/跌」单股解读, 严格按照 JSON schema 返回, 不要 markdown fence。"
        "**禁止**: 编造数据、虚构催化、给出具体买卖价位。"
        "**风格**: 直接、专业, 只用中文。"
    )

    user = (
        f"```json\n{json.dumps(ctx, ensure_ascii=False)[:6000]}\n```\n\n"
        "请输出 JSON, schema 如下:\n"
        "```json\n"
        "{\n"
        '  "headline": "<=30字 一句话总结今日表现",\n'
        '  "drivers": [\n'
        '    {"label": "<=4字 (如题材催化/资金共识/同板带动)", "text": "<=50字 真实驱动逻辑, 必须基于给定数据"}\n'
        "  ],\n"
        '  "position": {"label": "卡位", "text": "<=60字 当前卡位评估 (封板时间/炸板/封单/同板地位)"},\n'
        '  "height": {"label": "高度", "text": "<=60字 高度评估 (历史同结构/分歧风险/突破空间)"},\n'
        '  "tomorrow": {"label": "明日策略", "text": "<=60字 明日盘口具体观察点 (高开/低开各自对策, 不给具体价格)"},\n'
        '  "verdict": "S|A|B|C",\n'
        '  "verdict_label": "罕见龙头|典型龙头|标准龙头|偏弱"\n'
        "}\n```\n"
        "drivers 输出 2-3 条, 每条 label 不同。"
        "verdict 标准: S=罕见龙头(题材主升+高度+人气三全), A=典型龙头(主线+高度), "
        "B=标准跟风(中规中矩), C=偏弱(高位炸板/边缘题材/无量)。"
    )
    return system, user


def _merge_llm(ctx: dict[str, Any], llm_out: dict | None) -> dict[str, Any]:
    base = _heuristic_brief(ctx)
    if not llm_out:
        return base

    headline = (llm_out.get("headline") or "").strip()[:50]
    if headline:
        base["headline"] = headline

    drivers_raw = llm_out.get("drivers") or []
    drivers_clean = []
    for d in drivers_raw[:3]:
        if not isinstance(d, dict):
            continue
        label = (d.get("label") or "").strip()[:8]
        text = (d.get("text") or "").strip()[:80]
        if label and text:
            drivers_clean.append({"label": label, "text": text})
    if drivers_clean:
        base["drivers"] = drivers_clean

    for key in ("position", "height", "tomorrow"):
        v = llm_out.get(key)
        if isinstance(v, dict):
            label = (v.get("label") or "").strip()[:8]
            text = (v.get("text") or "").strip()[:100]
            if text:
                base[key] = {"label": label or base[key]["label"], "text": text}

    valid_verdict = {"S", "A", "B", "C"}
    if llm_out.get("verdict") in valid_verdict:
        base["verdict"] = llm_out["verdict"]
        label_map = {"S": "罕见龙头", "A": "典型龙头", "B": "标准龙头", "C": "偏弱"}
        base["verdict_label"] = (llm_out.get("verdict_label") or label_map[base["verdict"]])[:8]

    return base


async def generate_why_rose(
    code: str,
    trade_date: date | None = None,
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()

    code = code.strip()
    if not code:
        raise ValueError("code is required")

    ctx = _build_context(code, trade_date)
    if not ctx:
        return {
            "code": code,
            "trade_date": trade_date.isoformat(),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "model": model_id,
            "headline": f"{code} 暂无 {trade_date.isoformat()} 行情",
            "direction": "unknown",
            "drivers": [],
            "position": {"label": "卡位", "text": "无数据"},
            "height": {"label": "高度", "text": "无数据"},
            "tomorrow": {"label": "明日策略", "text": "无数据"},
            "verdict": "C",
            "verdict_label": "偏弱",
        }

    system, user = _build_prompt(ctx)
    llm_out = await _call_llm(system, user, model_id)
    merged = _merge_llm(ctx, llm_out)
    merged["generated_at"] = datetime.now().isoformat(timespec="seconds")
    merged["model"] = model_id
    return merged
