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

import logging
from datetime import date, datetime
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.ai.brief_generator import _latest_trade_date_with_data
from app.config import get_settings
from app.models.capital import CapitalFlowDaily, EtfFlowDaily

logger = logging.getLogger(__name__)


def _pick_top_by_sign(
    items: list[dict] | None,
    *,
    positive: bool,
    top_n: int = 3,
) -> list[dict]:
    rows = []
    for it in (items or []):
        v = float(it.get("main_inflow", 0) or 0)
        if positive and v > 0:
            rows.append(it)
        if (not positive) and v < 0:
            rows.append(it)
    return rows[:top_n]


def _sum_main_inflow(items: list[dict]) -> float:
    return float(sum(float(it.get("main_inflow", 0) or 0) for it in items))


def _build_flow_facts(snapshot: dict) -> dict[str, Any]:
    concepts_top = _pick_top_by_sign(snapshot.get("concepts_top"), positive=True, top_n=3)
    concepts_bottom = _pick_top_by_sign(snapshot.get("concepts_bottom"), positive=False, top_n=3)
    industries_top = _pick_top_by_sign(snapshot.get("industries_top"), positive=True, top_n=3)
    industries_bottom = _pick_top_by_sign(snapshot.get("industries_bottom"), positive=False, top_n=3)

    market = snapshot.get("market") or {}
    north = snapshot.get("north") or {}
    etf_team = snapshot.get("etf_team") or {}

    return {
        "main_net_inflow": float(market.get("主力净流入-净额", 0) or 0),
        "north_net_inflow": float(north.get("net_inflow", 0) or 0),
        "etf_team_inflow": float(etf_team.get("total_inflow", 0) or 0),
        "concept_inflow_top3": {
            "names": [str(x.get("name", "")).strip() for x in concepts_top if x.get("name")],
            "total_inflow": _sum_main_inflow(concepts_top),
        },
        "concept_outflow_top3": {
            "names": [str(x.get("name", "")).strip() for x in concepts_bottom if x.get("name")],
            "total_inflow": _sum_main_inflow(concepts_bottom),
        },
        "industry_inflow_top3": {
            "names": [str(x.get("name", "")).strip() for x in industries_top if x.get("name")],
            "total_inflow": _sum_main_inflow(industries_top),
        },
        "industry_outflow_top3": {
            "names": [str(x.get("name", "")).strip() for x in industries_bottom if x.get("name")],
            "total_inflow": _sum_main_inflow(industries_bottom),
        },
    }


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


async def generate_capital_brief(
    trade_date: date | None = None, model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()
    snapshot = _load_capital_snapshot(trade_date)

    base: dict[str, Any] = {
        "trade_date": trade_date.isoformat(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        # 资金卡彻底去 LLM 化: 固定为规则计算版本标识.
        "model": "calc-v1",
        "headline": "",
        "stance": "分化",
        "signals": [],
        "playbook": [],
        "evidence": [],
        "highlights": {
            "concept_top": snapshot.get("concepts_top", []),
            "concept_bottom": snapshot.get("concepts_bottom", []),
            "industry_top": snapshot.get("industries_top", []),
            "industry_bottom": snapshot.get("industries_bottom", []),
            "etf_team": snapshot.get("etf_team", {}),
        },
        "flow_facts": _build_flow_facts(snapshot),
    }
    if not snapshot.get("market") and not snapshot.get("north"):
        base["headline"] = f"{trade_date.isoformat()} 暂无资金数据"
        return base

    del model_id  # keep function signature backward-compatible with API
    base.update(_heuristic_brief(snapshot))
    return base
