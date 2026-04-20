"""大盘情绪 AI 旁白.

基于近 N 天 sentiment 序列, 派生当前情绪阶段, 让 LLM 给一句话判断 + 信号 + 对策。

输出:
{
  "trade_date": "...",
  "generated_at": "...",
  "model": "...",
  "phase": "rising|peak|diverge|fading|repair",
  "phase_label": "主升期",
  "judgment": "一句话判断 (≤40 字)",
  "signals": [{"label": "...", "text": "..."}],
  "playbook": [{"label": "...", "action": "..."}],
  "trend_5d": [{"date": "...", "lu": N, "broken_rate": F, "yesterday_lu_up_rate": F}, ...]
}
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.ai.brief_generator import _call_llm, _latest_trade_date_with_data
from app.ai.cross_context import NO_FLUFF_RULES
from app.config import get_settings
from app.models.market import MarketSentiment

logger = logging.getLogger(__name__)


def _load_sentiment_series(trade_date: date, days: int = 7) -> list[dict]:
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            rows = session.execute(
                select(MarketSentiment)
                .where(MarketSentiment.trade_date <= trade_date)
                .order_by(MarketSentiment.trade_date.desc())
                .limit(days)
            ).scalars().all()
            out = []
            for r in reversed(rows):
                out.append({
                    "date": r.trade_date.isoformat(),
                    "lu": int(r.limit_up_count or 0),
                    "ld": int(r.limit_down_count or 0),
                    "broken_rate": round(float(r.broken_rate or 0), 3),
                    "max_height": int(r.max_height or 0),
                    "yesterday_lu_up_rate": round(
                        float(r.yesterday_lu_up_rate) if r.yesterday_lu_up_rate is not None else 0.5,
                        3,
                    ),
                    "up_count": int(r.up_count or 0),
                    "down_count": int(r.down_count or 0),
                })
            return out
    finally:
        engine.dispose()


def _heuristic_phase(series: list[dict]) -> tuple[str, str]:
    """规则版情绪阶段识别 (作为 fallback + LLM 提示)."""
    if not series:
        return "fading", "数据不足"
    today = series[-1]
    lu = today["lu"]
    bk = today["broken_rate"]
    yest_up = today["yesterday_lu_up_rate"]

    if len(series) >= 2:
        prev = series[-2]
        lu_chg = lu - prev["lu"]
    else:
        lu_chg = 0

    if yest_up >= 0.6 and bk < 0.4 and lu >= 50:
        return "peak", "高潮期"
    if yest_up >= 0.55 and lu_chg > 5:
        return "rising", "主升期"
    if bk > 0.55 and yest_up < 0.45:
        return "diverge", "分歧期"
    if yest_up < 0.35 and bk > 0.5:
        return "fading", "退潮期"
    if yest_up >= 0.5 and lu < 40 and bk < 0.45:
        return "repair", "修复期"
    return "diverge", "分歧期"


def _build_prompt(trade_date: str, series: list[dict], phase: str, phase_label: str) -> tuple[str, str]:
    system = (
        "你是 A 股短线情绪分析师。"
        "基于给定的近 N 日大盘情绪序列, 用中文输出 JSON。"
        "判断要直接、精炼, 避免空话套话, 突出可操作性。"
        + NO_FLUFF_RULES
    )
    user = (
        f"今日 {trade_date}, 情绪序列(从早到晚)如下:\n\n"
        f"```json\n{json.dumps(series, ensure_ascii=False)}\n```\n\n"
        f"规则版预判: 当前阶段 = `{phase}` ({phase_label})。如有不同意见请覆盖。\n\n"
        "请输出 JSON, 严格按以下 schema:\n"
        "```json\n"
        "{\n"
        '  "phase": "rising|peak|diverge|fading|repair 之一",\n'
        '  "phase_label": "主升期|高潮期|分歧期|退潮期|修复期",\n'
        '  "judgment": "一句话当前判断 ≤40 字, 必须基于序列里的具体数字",\n'
        '  "signals": [\n'
        '    {"label": "涨停", "text": "30 字以内, 引用具体数字"},\n'
        '    {"label": "炸板", "text": "..."},\n'
        '    {"label": "赚钱效应", "text": "..."}\n'
        "  ],\n"
        '  "playbook": [\n'
        '    {"label": "仓位", "action": "≤30 字, 直接给数字或方向"},\n'
        '    {"label": "选股", "action": "..."},\n'
        '    {"label": "止损", "action": "..."}\n'
        "  ],\n"
        '  "evidence": [\n'
        '    "1-3 条 ≤30 字 关键数字证据, 必须引用 series 里的真实数字",\n'
        '    "示例: \'昨日涨停今日上涨率 72%, 显著高于近5日均值 55%\'",\n'
        '    "示例: \'今日炸板率 28%, 较昨日下降 12pp\'"\n'
        "  ]\n"
        "}\n```\n"
        "字段含义:\n"
        "- yesterday_lu_up_rate: 昨日涨停今日上涨率 (>0.55 强, <0.4 弱)\n"
        "- broken_rate: 炸板率 (<0.4 强, >0.55 分歧)\n"
        "- lu: 当日涨停数, max_height: 最高板数\n"
        "不要返回 markdown fence。"
    )
    return system, user


def _heuristic_brief(series: list[dict], phase: str, phase_label: str) -> dict[str, Any]:
    if not series:
        return {
            "phase": phase, "phase_label": phase_label,
            "judgment": "暂无数据",
            "signals": [], "playbook": [],
        }
    today = series[-1]
    sigs = [
        {"label": "涨停", "text": f"今日涨停 {today['lu']} 只 (跌停 {today['ld']})"},
        {"label": "炸板", "text": f"炸板率 {today['broken_rate'] * 100:.0f}%"},
        {"label": "赚钱效应", "text": f"昨日涨停今日上涨率 {today['yesterday_lu_up_rate'] * 100:.0f}%"},
    ]
    play_map = {
        "rising": [
            {"label": "仓位", "action": "可加至 7-8 成"},
            {"label": "选股", "action": "首板/二板进攻"},
            {"label": "止损", "action": "破板即出"},
        ],
        "peak": [
            {"label": "仓位", "action": "保持 6 成, 不加"},
            {"label": "选股", "action": "高度龙头不追"},
            {"label": "止损", "action": "炸板减半"},
        ],
        "diverge": [
            {"label": "仓位", "action": "降至 5 成"},
            {"label": "选股", "action": "只做中军和补涨"},
            {"label": "止损", "action": "破位出局"},
        ],
        "fading": [
            {"label": "仓位", "action": "降至 3 成"},
            {"label": "选股", "action": "只看修复, 不参与新题材"},
            {"label": "止损", "action": "T+1 不犹豫"},
        ],
        "repair": [
            {"label": "仓位", "action": "试探 4-5 成"},
            {"label": "选股", "action": "底部首板"},
            {"label": "止损", "action": "破开盘价出"},
        ],
    }
    play = play_map.get(phase, play_map["diverge"])
    evidence: list[str] = [
        f"涨停 {today['lu']} (跌停 {today['ld']}), 最高 {today['max_height']} 板",
        f"炸板率 {today['broken_rate'] * 100:.0f}%, 昨涨停今涨率 {today['yesterday_lu_up_rate'] * 100:.0f}%",
    ]
    if len(series) >= 2:
        prev = series[-2]
        d_lu = today["lu"] - prev["lu"]
        evidence.append(f"涨停数较昨日 {d_lu:+d}, 炸板率 {(today['broken_rate'] - prev['broken_rate']) * 100:+.0f}pp")
    return {
        "phase": phase, "phase_label": phase_label,
        "judgment": f"今日 {today['lu']} 只涨停, 炸板率 {today['broken_rate'] * 100:.0f}%, {phase_label}",
        "signals": sigs, "playbook": play, "evidence": evidence,
    }


def _merge_llm(series: list[dict], phase: str, phase_label: str, llm_out: dict | None) -> dict[str, Any]:
    if not llm_out:
        return _heuristic_brief(series, phase, phase_label)

    valid_phases = {"rising", "peak", "diverge", "fading", "repair"}
    out_phase = llm_out.get("phase") or phase
    if out_phase not in valid_phases:
        out_phase = phase
    out_label = llm_out.get("phase_label") or phase_label
    judgment = (llm_out.get("judgment") or "").strip()[:60]
    if not judgment:
        judgment = _heuristic_brief(series, out_phase, out_label)["judgment"]

    signals = []
    for it in (llm_out.get("signals") or [])[:3]:
        label = (it.get("label") or "").strip()[:8]
        text = (it.get("text") or "").strip()[:50]
        if label and text:
            signals.append({"label": label, "text": text})
    if len(signals) < 3:
        signals = _heuristic_brief(series, out_phase, out_label)["signals"]

    playbook = []
    for it in (llm_out.get("playbook") or [])[:3]:
        label = (it.get("label") or "").strip()[:8]
        action = (it.get("action") or "").strip()[:50]
        if label and action:
            playbook.append({"label": label, "action": action})
    if len(playbook) < 3:
        playbook = _heuristic_brief(series, out_phase, out_label)["playbook"]

    evidence: list[str] = []
    for raw in (llm_out.get("evidence") or [])[:3]:
        s = (str(raw) if not isinstance(raw, str) else raw).strip()[:40]
        if s:
            evidence.append(s)
    if not evidence:
        evidence = _heuristic_brief(series, out_phase, out_label).get("evidence", [])

    return {
        "phase": out_phase, "phase_label": out_label,
        "judgment": judgment, "signals": signals, "playbook": playbook,
        "evidence": evidence,
    }


async def generate_sentiment_brief(
    trade_date: date | None,
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()

    series = _load_sentiment_series(trade_date, days=7)
    base: dict[str, Any] = {
        "trade_date": trade_date.isoformat(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "model": model_id,
        "phase": "diverge",
        "phase_label": "分歧期",
        "judgment": "",
        "signals": [],
        "playbook": [],
        "evidence": [],
        "trend_5d": series[-5:] if series else [],
    }

    if not series:
        base["judgment"] = f"{trade_date.isoformat()} 暂无情绪数据"
        return base

    phase, phase_label = _heuristic_phase(series)
    system, user = _build_prompt(trade_date.isoformat(), series, phase, phase_label)
    llm_out = await _call_llm(system, user, model_id)
    merged = _merge_llm(series, phase, phase_label, llm_out)
    base.update(merged)
    return base
