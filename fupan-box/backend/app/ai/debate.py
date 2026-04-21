"""多 Agent 辩论 — 多头/空头/裁判 三角色对今日市场或个股的多空辩论.

输入: topic_type ∈ {market, stock, theme}, topic_key (stock=code / theme=name / market 留空)
输出: { bull: {...}, bear: {...}, judge: {...} }
流程: 1) 收集证据 -> 2) bull 三条理由 -> 3) bear 三条理由 -> 4) judge 综合
"""

from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any, AsyncGenerator

from sqlalchemy import create_engine, select, desc
from sqlalchemy.orm import Session

from app.ai.brief_generator import _call_llm, _latest_trade_date_with_data
from app.ai.why_rose import _build_context as _build_stock_context
from app.config import get_settings
from app.models.snapshot import DailySnapshot

logger = logging.getLogger(__name__)


def _load_overview(trade_date: date) -> dict | None:
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            row = session.execute(
                select(DailySnapshot)
                .where(
                    DailySnapshot.trade_date == trade_date,
                    DailySnapshot.snapshot_type == "overview",
                )
                .order_by(desc(DailySnapshot.id))
                .limit(1)
            ).scalar_one_or_none()
            return row.data if row else None
    finally:
        engine.dispose()


def _build_evidence(topic_type: str, topic_key: str | None, trade_date: date) -> dict[str, Any]:
    """根据 topic 收集事实证据."""
    ev: dict[str, Any] = {"topic_type": topic_type, "trade_date": trade_date.isoformat()}
    overview = _load_overview(trade_date)
    if overview:
        ev["market"] = {
            "up_rate": overview.get("up_rate"),
            "limit_up_count": overview.get("limit_up_count"),
            "limit_down_count": overview.get("limit_down_count"),
            "broken_board_count": overview.get("broken_board_count"),
            "max_height": overview.get("max_height"),
            "total_amount": overview.get("total_amount"),
            "north_net_inflow": overview.get("north_net_inflow"),
            "main_net_inflow": overview.get("main_net_inflow"),
            "shanghai_change": overview.get("shanghai_change"),
            "chuangye_change": overview.get("chuangye_change"),
            "high_open_count": overview.get("high_open_count"),
            "low_open_count": overview.get("low_open_count"),
        }
    if topic_type == "stock" and topic_key:
        ctx = _build_stock_context(topic_key.strip(), trade_date)
        if ctx:
            ev["stock"] = {
                "code": ctx.get("code"),
                "name": ctx.get("name"),
                "industry": ctx.get("industry"),
                "concepts": ctx.get("concepts"),
                "today": ctx.get("today"),
                "limit_up": ctx.get("limit_up"),
                "lhb": ctx.get("lhb"),
                "theme_peer": ctx.get("theme_peer"),
                "recent": ctx.get("recent"),
            }
            try:
                from app.services.stock_context import get_stock_capital_sync
                cap = get_stock_capital_sync(topic_key.strip().zfill(6), trade_date)
                if cap.get("capital") or cap.get("institutional"):
                    ev["stock"]["capital_dim"] = cap.get("capital")
                    ev["stock"]["institutional_dim"] = cap.get("institutional")
                    ev["stock"]["seat_30d"] = cap.get("seat")
            except Exception:
                pass
    return ev


def _topic_label(ev: dict) -> str:
    t = ev.get("topic_type")
    if t == "stock" and ev.get("stock"):
        s = ev["stock"]
        return f"{s.get('name') or ''}({s.get('code') or ''})"
    if t == "theme":
        return f"题材 {ev.get('topic_key') or ''}"
    return "今日大盘"


_DIRECTION_LABEL = {"bull": "多头分析师", "bear": "空头分析师"}


def _build_side_prompt(side: str, ev: dict) -> tuple[str, str]:
    label = _DIRECTION_LABEL[side]
    stance = "看多" if side == "bull" else "看空"
    role = (
        f"你是一位 A 股短线{label}, 风格强硬、只讲事实和数据、不模糊。"
        f"现在请你针对「{_topic_label(ev)}」给出 3 条最有力的{stance}理由。"
        "每条理由必须: (1) 引用具体数字证据 (2) 给出可执行结论 (3) ≤40 字。"
        "**严格输出 JSON, 无 markdown fence**。"
    )
    schema = (
        '{\n  "headline": "<=20字 一句话核心结论",\n'
        '  "reasons": [\n'
        '    {"label": "驱动/资金/位置/情绪/技术 等标签 ≤4字", "text": "<=40字 具体理由 含数字"},\n'
        '    {"label": "...", "text": "..."},\n'
        '    {"label": "...", "text": "..."}\n  ],\n'
        '  "trigger": "<=30字 关键触发条件 (满足则继续看好/看空)",\n'
        '  "confidence": 70\n}'
    )
    user = (
        f"```json\n{json.dumps(ev, ensure_ascii=False)[:2500]}\n```\n\n"
        f"请输出{stance}方的 JSON, schema:\n```json\n{schema}\n```\n"
        "confidence 是你对自己观点的把握度 (0-100)。"
    )
    return role, user


def _build_judge_prompt(ev: dict, bull: dict, bear: dict) -> tuple[str, str]:
    role = (
        "你是一位资深 A 股复盘裁判, 风格客观克制。"
        f"刚才多头和空头都对「{_topic_label(ev)}」表了态, 请你综合双方论据给出最终判断。"
        "**严格输出 JSON, 无 markdown fence**。"
    )
    schema = (
        '{\n  "verdict": "看多|看空|分歧|观望",\n'
        '  "winner_side": "bull|bear|tie",\n'
        '  "win_margin": 12,\n'
        '  "summary": "<=50字 综合结论 含具体操作建议",\n'
        '  "key_variable": "<=30字 决定胜负的关键变量 (盘口动作/资金/政策)",\n'
        '  "next_step": "<=40字 明日盘前/盘中关注点"\n}'
    )
    payload = {"evidence": ev, "bull": bull, "bear": bear}
    user = (
        f"```json\n{json.dumps(payload, ensure_ascii=False)[:3500]}\n```\n\n"
        f"请输出裁判结论 JSON, schema:\n```json\n{schema}\n```\n"
        "win_margin 表示胜方相对败方的领先程度 (0-100, 0=完全平局)。"
    )
    return role, user


def _heuristic_side(side: str, ev: dict) -> dict:
    market = ev.get("market") or {}
    up_rate = float(market.get("up_rate") or 0)
    lu = int(market.get("limit_up_count") or 0)
    if side == "bull":
        return {
            "headline": f"赚钱效应{up_rate:.0f}%、涨停{lu}家",
            "reasons": [
                {"label": "情绪", "text": f"涨停 {lu} 家、赚钱效应 {up_rate:.0f}%"},
                {"label": "资金", "text": "主力净流入支撑后续"},
                {"label": "结构", "text": "题材轮动有效, 高度未被破坏"},
            ],
            "trigger": "明日不出现高位连续炸板",
            "confidence": 60,
        }
    return {
        "headline": f"分歧加大、炸板 {market.get('broken_board_count') or 0} 家",
        "reasons": [
            {"label": "高位", "text": "高度股一致性减弱, 退潮信号在累积"},
            {"label": "资金", "text": "尾盘资金不愿坚定承接"},
            {"label": "结构", "text": "板块轮动加快, 缺乏主线"},
        ],
        "trigger": "明日开盘出现高度股集体低开",
        "confidence": 55,
    }


def _heuristic_judge(ev: dict, bull: dict, bear: dict) -> dict:
    bc = int(bull.get("confidence") or 50)
    rc = int(bear.get("confidence") or 50)
    if abs(bc - rc) <= 5:
        return {
            "verdict": "分歧",
            "winner_side": "tie",
            "win_margin": abs(bc - rc),
            "summary": "多空胶着, 等盘口给方向, 控制仓位",
            "key_variable": "明日量能 + 高度股开盘表现",
            "next_step": "盘前关注隔夜外盘 + 早盘 9:25 集合竞价",
        }
    if bc > rc:
        return {
            "verdict": "看多",
            "winner_side": "bull",
            "win_margin": bc - rc,
            "summary": "多头略占优, 可适度参与, 但严设止损",
            "key_variable": "高度股能否延续",
            "next_step": "明日观察首板分歧 + 主线强度",
        }
    return {
        "verdict": "看空",
        "winner_side": "bear",
        "win_margin": rc - bc,
        "summary": "空头占优, 建议轻仓避险或做T",
        "key_variable": "炸板率 + 资金离场速度",
        "next_step": "若早盘高度股不能反包, 即降低仓位",
    }


async def _run_side(side: str, ev: dict, model_id: str) -> dict[str, Any]:
    sys, usr = _build_side_prompt(side, ev)
    parsed = await _call_llm(sys, usr, model_id)
    if not isinstance(parsed, dict):
        return _heuristic_side(side, ev)
    parsed.setdefault("headline", "")
    parsed.setdefault("reasons", [])
    parsed.setdefault("trigger", "")
    parsed.setdefault("confidence", 60)
    return parsed


async def _run_judge(ev: dict, bull: dict, bear: dict, model_id: str) -> dict[str, Any]:
    sys, usr = _build_judge_prompt(ev, bull, bear)
    parsed = await _call_llm(sys, usr, model_id)
    if not isinstance(parsed, dict):
        return _heuristic_judge(ev, bull, bear)
    parsed.setdefault("verdict", "观望")
    parsed.setdefault("winner_side", "tie")
    parsed.setdefault("win_margin", 0)
    parsed.setdefault("summary", "")
    parsed.setdefault("key_variable", "")
    parsed.setdefault("next_step", "")
    return parsed


async def run_debate(
    topic_type: str = "market",
    topic_key: str | None = None,
    trade_date: date | None = None,
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    if topic_type not in {"market", "stock", "theme"}:
        raise ValueError(f"invalid topic_type {topic_type}")
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()

    ev = _build_evidence(topic_type, topic_key, trade_date)
    bull = await _run_side("bull", ev, model_id)
    bear = await _run_side("bear", ev, model_id)
    judge = await _run_judge(ev, bull, bear, model_id)
    return {
        "topic_type": topic_type,
        "topic_key": topic_key,
        "topic_label": _topic_label(ev),
        "trade_date": trade_date.isoformat(),
        "model": model_id,
        "evidence": ev,
        "bull": bull,
        "bear": bear,
        "judge": judge,
    }


async def stream_debate(
    topic_type: str = "market",
    topic_key: str | None = None,
    trade_date: date | None = None,
    model_id: str = "deepseek-v3",
) -> AsyncGenerator[str, None]:
    """SSE 流式输出: stage=evidence/bull/bear/judge/done."""
    if topic_type not in {"market", "stock", "theme"}:
        yield f"data: {json.dumps({'error': f'invalid topic_type {topic_type}'}, ensure_ascii=False)}\n\n"
        return
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()
    label = ""
    try:
        ev = _build_evidence(topic_type, topic_key, trade_date)
        label = _topic_label(ev)
        yield f"data: {json.dumps({'stage': 'evidence', 'topic_label': label, 'trade_date': trade_date.isoformat()}, ensure_ascii=False)}\n\n"

        bull = await _run_side("bull", ev, model_id)
        yield f"data: {json.dumps({'stage': 'bull', 'data': bull}, ensure_ascii=False)}\n\n"

        bear = await _run_side("bear", ev, model_id)
        yield f"data: {json.dumps({'stage': 'bear', 'data': bear}, ensure_ascii=False)}\n\n"

        judge = await _run_judge(ev, bull, bear, model_id)
        yield f"data: {json.dumps({'stage': 'judge', 'data': judge}, ensure_ascii=False)}\n\n"

        yield f"data: {json.dumps({'stage': 'done'}, ensure_ascii=False)}\n\n"
    except Exception as e:
        logger.exception("debate stream failed: %s", e)
        yield f"data: {json.dumps({'stage': 'error', 'error': str(e)}, ensure_ascii=False)}\n\n"
