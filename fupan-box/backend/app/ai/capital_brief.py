"""资金面 AI brief——日频维度: 大盘 / 北向 / 主力 / ETF.

输出:
{
  "trade_date": "...",
  "generated_at": "...",
  "model": "...",
  "headline": "≤40字今日资金一句话",
  "stance": "净流入主导|净流出主导|分化|防御",
  "signals": [{"label":"北向","text":"..."}, {"label":"主力","text":"..."}, {"label":"国家队","text":"..."}],
  "playbook": [{"label":"方向","action":"..."}, {"label":"仓位","action":"..."}],
  "evidence": [...],
  "highlights": {
    "concept_top": [...],
    "industry_top": [...],
    "etf_team": {...}
  }
}
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any

from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session

from app.ai.brief_generator import _call_llm, _latest_trade_date_with_data
from app.ai.cross_context import NO_FLUFF_RULES
from app.config import get_settings
from app.models.capital import CapitalFlowDaily, EtfFlowDaily

logger = logging.getLogger(__name__)


def _load_capital_snapshot(trade_date: date) -> dict:
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    out: dict = {"trade_date": trade_date.isoformat()}
    try:
        with Session(engine) as s:
            mkt = s.execute(
                select(CapitalFlowDaily).where(
                    CapitalFlowDaily.scope == "market",
                    CapitalFlowDaily.trade_date == trade_date,
                )
            ).scalar_one_or_none()
            out["market"] = mkt.data if mkt else None

            nh = s.execute(
                select(CapitalFlowDaily).where(
                    CapitalFlowDaily.scope == "north",
                    CapitalFlowDaily.trade_date == trade_date,
                )
            ).scalar_one_or_none()
            out["north"] = nh.data if nh else None

            for scope, key in [("concept", "concepts"), ("industry", "industries")]:
                rows = s.execute(
                    select(CapitalFlowDaily).where(
                        CapitalFlowDaily.scope == scope,
                        CapitalFlowDaily.trade_date == trade_date,
                    )
                ).scalars().all()
                items = sorted(
                    [{"name": x.scope_key, **(x.data or {})} for x in rows],
                    key=lambda d: d.get("main_inflow", 0) or 0,
                    reverse=True,
                )
                out[f"{key}_top"] = items[:5]
                out[f"{key}_bottom"] = items[-5:][::-1]

            etfs = s.execute(
                select(EtfFlowDaily).where(
                    EtfFlowDaily.trade_date == trade_date,
                    EtfFlowDaily.category == "national_team_broad",
                )
            ).scalars().all()
            out["etf_team"] = {
                "total_inflow": round(sum((x.inflow_estimate or 0) for x in etfs), 0),
                "etf_count": len(etfs),
                "items": [
                    {
                        "code": x.etf_code,
                        "name": x.etf_name,
                        "shares_change": x.shares_change,
                        "inflow_estimate": x.inflow_estimate,
                    }
                    for x in etfs
                    if (x.inflow_estimate or 0) != 0
                ][:5],
            }
        return out
    finally:
        engine.dispose()


def _heuristic_brief(snapshot: dict) -> dict[str, Any]:
    market = snapshot.get("market") or {}
    north = snapshot.get("north") or {}
    main_yi = (market.get("主力净流入-净额") or 0) / 1e8 if market else 0
    north_yi = (north.get("net_inflow") or 0) / 1e8 if north else 0
    etf_team = snapshot.get("etf_team") or {}
    etf_yi = (etf_team.get("total_inflow") or 0) / 1e8

    if main_yi > 100 and north_yi > 30:
        stance = "净流入主导"
    elif main_yi < -100 or north_yi < -30:
        stance = "净流出主导"
    elif etf_yi > 20:
        stance = "防御"
    else:
        stance = "分化"

    headline = f"主力{main_yi:+.0f}亿 北向{north_yi:+.0f}亿 国家队ETF{etf_yi:+.0f}亿"
    signals = [
        {"label": "主力", "text": f"主力净{main_yi:+.1f}亿"},
        {"label": "北向", "text": f"北向净{north_yi:+.1f}亿"},
        {"label": "国家队", "text": f"宽基ETF净申购约{etf_yi:+.1f}亿"},
    ]

    play_map = {
        "净流入主导": [
            {"label": "方向", "action": "顺势加多, 选龙头主线"},
            {"label": "仓位", "action": "可加至 7-8 成"},
        ],
        "净流出主导": [
            {"label": "方向", "action": "防御为主, 不追高"},
            {"label": "仓位", "action": "降至 3-4 成"},
        ],
        "防御": [
            {"label": "方向", "action": "看红利+宽基ETF, 配少量科技"},
            {"label": "仓位", "action": "维持 5 成观望"},
        ],
        "分化": [
            {"label": "方向", "action": "只做主力流入TOP3行业的中军"},
            {"label": "仓位", "action": "维持 5-6 成"},
        ],
    }

    concepts = snapshot.get("concepts_top") or []
    inds = snapshot.get("industries_top") or []
    evidence = []
    if concepts:
        n = concepts[0]
        evidence.append(f"概念主流: {n['name']} 主力{(n.get('main_inflow', 0) or 0)/1e8:+.1f}亿")
    if inds:
        n = inds[0]
        evidence.append(f"行业主流: {n['name']} 主力{(n.get('main_inflow', 0) or 0)/1e8:+.1f}亿")
    evidence.append(f"国家队ETF净申购: {etf_yi:+.1f}亿")

    return {
        "headline": headline,
        "stance": stance,
        "signals": signals,
        "playbook": play_map.get(stance, play_map["分化"]),
        "evidence": evidence,
    }


def _build_prompt(trade_date: str, snapshot: dict, hint: dict) -> tuple[str, str]:
    system = (
        "你是 A 股资金面分析师, 输出 JSON。"
        "重点回答: 今日是谁在买/卖, 国家队是否出手, 该往哪个方向跟。"
        + NO_FLUFF_RULES
    )
    user = (
        f"今日 {trade_date} 资金快照:\n```json\n{json.dumps(snapshot, ensure_ascii=False)[:3500]}\n```\n\n"
        f"规则版预判: stance={hint['stance']}\n\n"
        "请输出 JSON, 严格按 schema:\n"
        "```json\n"
        "{\n"
        '  "headline": "≤40字 今日资金一句话, 必须含三个数字(主力/北向/国家队)",\n'
        '  "stance": "净流入主导|净流出主导|分化|防御",\n'
        '  "signals": [{"label":"主力","text":"..."}, {"label":"北向","text":"..."}, {"label":"国家队","text":"..."}],\n'
        '  "playbook": [{"label":"方向","action":"..."}, {"label":"仓位","action":"..."}],\n'
        '  "evidence": ["3条 30字内 关键数字证据, 必须引用snapshot里的真实板块名+数字"]\n'
        "}\n```\n不要 markdown fence。"
    )
    return system, user


def _merge(snapshot: dict, hint: dict, llm_out: dict | None) -> dict[str, Any]:
    if not llm_out:
        return hint
    valid_stance = {"净流入主导", "净流出主导", "分化", "防御"}
    out = dict(hint)
    if (h := (llm_out.get("headline") or "").strip()):
        out["headline"] = h[:60]
    if (s := llm_out.get("stance")) in valid_stance:
        out["stance"] = s
    sigs = []
    for it in (llm_out.get("signals") or [])[:3]:
        l = (it.get("label") or "").strip()[:8]
        t = (it.get("text") or "").strip()[:50]
        if l and t:
            sigs.append({"label": l, "text": t})
    if len(sigs) >= 3:
        out["signals"] = sigs
    play = []
    for it in (llm_out.get("playbook") or [])[:3]:
        l = (it.get("label") or "").strip()[:8]
        a = (it.get("action") or "").strip()[:50]
        if l and a:
            play.append({"label": l, "action": a})
    if play:
        out["playbook"] = play
    ev = [str(e).strip()[:60] for e in (llm_out.get("evidence") or [])[:3] if e]
    if ev:
        out["evidence"] = ev
    return out


async def generate_capital_brief(
    trade_date: date | None = None, model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()
    snapshot = _load_capital_snapshot(trade_date)

    base: dict[str, Any] = {
        "trade_date": trade_date.isoformat(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "model": model_id,
        "headline": "",
        "stance": "分化",
        "signals": [],
        "playbook": [],
        "evidence": [],
        "highlights": {
            "concept_top": snapshot.get("concepts_top", []),
            "industry_top": snapshot.get("industries_top", []),
            "etf_team": snapshot.get("etf_team", {}),
        },
    }
    if not snapshot.get("market") and not snapshot.get("north"):
        base["headline"] = f"{trade_date.isoformat()} 暂无资金数据"
        return base

    hint = _heuristic_brief(snapshot)
    system, user = _build_prompt(trade_date.isoformat(), snapshot, hint)
    llm_out = await _call_llm(system, user, model_id)
    merged = _merge(snapshot, hint, llm_out)
    base.update(merged)
    return base
