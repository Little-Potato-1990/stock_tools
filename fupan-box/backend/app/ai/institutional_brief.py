"""主力身份动向 brief——季报 + 公告事件流(汇金/社保/险资/QFII).

不同于 capital_brief 是日频, 这个是事件 + 季报驱动:
- 事件: 增持 / 减持 / 回购 / 举牌 (用 announcement_event 近 30 天)
- 季报: 主力新进 / 加仓 / 减仓 (用 holder_snapshot_quarterly 最新报告期)

输出:
{
  "report_date": "...", "trade_date": "...",
  "headline": "≤40字 谁在动",
  "stance": "国家队进场|险资增持|公募抱团|资金分散|外资流出",
  "highlights": {
    "national_team": {"adds": [...], "cuts": [...]},
    "social_insurance": {...},
    "events_recent": [{"date","stock_code","event","actor"}, ...]
  },
  "signals": [...],
  "playbook": [...],
  "evidence": [...]
}
"""
from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session

from app.ai.brief_generator import _call_llm, _latest_trade_date_with_data
from app.ai.cross_context import NO_FLUFF_RULES
from app.config import get_settings
from app.models.holder import HolderSnapshotQuarterly
from app.models.capital import AnnouncementEvent

logger = logging.getLogger(__name__)


def _load_snapshot(report_date: date | None, trade_date: date) -> dict:
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    out: dict = {"trade_date": trade_date.isoformat()}
    try:
        with Session(engine) as s:
            if not report_date:
                rd = s.execute(
                    select(func.max(HolderSnapshotQuarterly.report_date))
                ).scalar_one_or_none()
            else:
                rd = report_date
            out["report_date"] = rd.isoformat() if rd else None

            highlights: dict = {}
            if rd:
                for ht, key in [("sovereign", "national_team"), ("social", "social"),
                                ("insurance", "insurance"), ("qfii", "qfii"), ("fund", "fund")]:
                    rows = s.execute(
                        select(HolderSnapshotQuarterly).where(
                            HolderSnapshotQuarterly.report_date == rd,
                            HolderSnapshotQuarterly.holder_type == ht,
                            HolderSnapshotQuarterly.canonical_name.is_not(None),
                        )
                    ).scalars().all()
                    adds = sorted(
                        [r for r in rows if r.change_type in ("new", "add")],
                        key=lambda r: (r.change_shares or 0), reverse=True,
                    )[:8]
                    cuts = sorted(
                        [r for r in rows if r.change_type in ("cut", "exit")],
                        key=lambda r: (r.change_shares or 0),
                    )[:5]
                    highlights[key] = {
                        "stock_count": len({r.stock_code for r in rows}),
                        "adds": [
                            {
                                "code": r.stock_code, "name": r.stock_name,
                                "actor": r.canonical_name, "change_type": r.change_type,
                                "shares_pct": r.shares_pct,
                            }
                            for r in adds
                        ],
                        "cuts": [
                            {
                                "code": r.stock_code, "name": r.stock_name,
                                "actor": r.canonical_name, "change_type": r.change_type,
                                "shares_pct": r.shares_pct,
                            }
                            for r in cuts
                        ],
                    }
            out["highlights"] = highlights

            start = trade_date - timedelta(days=30)
            events = s.execute(
                select(AnnouncementEvent).where(
                    AnnouncementEvent.trade_date.between(start, trade_date),
                ).order_by(AnnouncementEvent.trade_date.desc()).limit(60)
            ).scalars().all()
            out["events_recent"] = [
                {
                    "date": e.trade_date.isoformat(),
                    "code": e.stock_code,
                    "name": e.stock_name,
                    "type": e.event_type,
                    "actor": e.actor,
                    "actor_type": e.actor_type,
                    "scale": e.scale,
                }
                for e in events
            ]
            out["event_summary"] = dict(Counter(e.event_type for e in events))

        return out
    finally:
        engine.dispose()


def _heuristic_brief(snapshot: dict) -> dict:
    hl = snapshot.get("highlights") or {}
    nt = (hl.get("national_team") or {}).get("adds") or []
    ins = (hl.get("insurance") or {}).get("adds") or []
    soc = (hl.get("social") or {}).get("adds") or []
    fund = (hl.get("fund") or {}).get("adds") or []
    qfii = (hl.get("qfii") or {}).get("adds") or []
    es = snapshot.get("event_summary") or {}

    if len(nt) >= 5:
        stance = "国家队进场"
    elif len(ins) + len(soc) >= 8:
        stance = "险资社保增持"
    elif len(fund) >= 10:
        stance = "公募抱团"
    elif es.get("decrease", 0) > es.get("increase", 0) and (qfii and len(qfii) < 2):
        stance = "外资流出"
    else:
        stance = "资金分散"

    headline_parts = []
    if nt:
        headline_parts.append(f"国家队加仓{len(nt)}股")
    if ins:
        headline_parts.append(f"险资进{len(ins)}股")
    if soc:
        headline_parts.append(f"社保进{len(soc)}股")
    if fund:
        headline_parts.append(f"公募加仓{len(fund)}股")
    headline = " · ".join(headline_parts[:3]) or "本期主力身份变动有限"

    signals = []
    for key, label in [("national_team", "国家队"), ("insurance", "险资"),
                       ("social", "社保"), ("fund", "公募"), ("qfii", "QFII")]:
        item = hl.get(key) or {}
        adds = item.get("adds") or []
        if not adds:
            continue
        top_names = ", ".join(a.get("name") or a.get("code", "") for a in adds[:3])
        signals.append({"label": label, "text": f"加仓{len(adds)}股, 含{top_names}"})

    play_map = {
        "国家队进场": [
            {"label": "方向", "action": "顺势布局国家队增持的宽基/银行/保险"},
            {"label": "仓位", "action": "可加至 6-7 成"},
        ],
        "险资社保增持": [
            {"label": "方向", "action": "重点跟随高股息+龙头"},
            {"label": "仓位", "action": "维持 5-6 成, 中长线"},
        ],
        "公募抱团": [
            {"label": "方向", "action": "跟随白马, 但需注意拥挤度"},
            {"label": "仓位", "action": "6 成偏成长"},
        ],
        "外资流出": [
            {"label": "方向", "action": "防御为主, 避开北向重仓"},
            {"label": "仓位", "action": "降至 4 成"},
        ],
        "资金分散": [
            {"label": "方向", "action": "选个股看主力身份, 不依赖集体趋势"},
            {"label": "仓位", "action": "5 成"},
        ],
    }
    evidence = []
    for key, label in [("national_team", "国家队"), ("insurance", "险资"),
                       ("social", "社保"), ("fund", "公募")]:
        item = hl.get(key) or {}
        adds = item.get("adds") or []
        cuts = item.get("cuts") or []
        if adds or cuts:
            evidence.append(f"{label}: 加{len(adds)}股 / 减{len(cuts)}股")
    if es:
        evidence.append("近30天公告: " + ", ".join(f"{k}{v}起" for k, v in es.items()))

    return {
        "headline": headline[:60],
        "stance": stance,
        "signals": signals[:4],
        "playbook": play_map.get(stance, play_map["资金分散"]),
        "evidence": evidence[:4],
    }


def _build_prompt(snapshot: dict, hint: dict) -> tuple[str, str]:
    system = (
        "你是 A 股主力身份分析师。"
        "数据是季报 + 近30天公告事件, 重点回答: 谁在加仓, 跟谁的逻辑能赚钱, 该往哪个方向走。"
        + NO_FLUFF_RULES
    )
    payload = {
        "report_date": snapshot.get("report_date"),
        "trade_date": snapshot.get("trade_date"),
        "highlights": snapshot.get("highlights"),
        "events_recent": snapshot.get("events_recent", [])[:25],
        "event_summary": snapshot.get("event_summary"),
    }
    user = (
        f"主力身份快照:\n```json\n{json.dumps(payload, ensure_ascii=False)[:4500]}\n```\n\n"
        f"规则版预判: stance={hint['stance']}\n\n"
        "请输出 JSON, 严格按 schema:\n"
        "```json\n"
        "{\n"
        '  "headline": "≤40字 本期主力身份动向一句话",\n'
        '  "stance": "国家队进场|险资社保增持|公募抱团|外资流出|资金分散",\n'
        '  "signals": [{"label":"国家队","text":"30字内"}, ...],\n'
        '  "playbook": [{"label":"方向","action":"..."}, {"label":"仓位","action":"..."}],\n'
        '  "evidence": ["3-4条 30字内 引用snapshot真实股票名/数字"]\n'
        "}\n```\n不要 markdown fence。"
    )
    return system, user


def _merge(hint: dict, llm_out: dict | None) -> dict:
    if not llm_out:
        return hint
    valid_stance = {"国家队进场", "险资社保增持", "公募抱团", "外资流出", "资金分散"}
    out = dict(hint)
    if (h := (llm_out.get("headline") or "").strip()):
        out["headline"] = h[:60]
    if (s := llm_out.get("stance")) in valid_stance:
        out["stance"] = s
    sigs = []
    for it in (llm_out.get("signals") or [])[:5]:
        l = (it.get("label") or "").strip()[:8]
        t = (it.get("text") or "").strip()[:60]
        if l and t:
            sigs.append({"label": l, "text": t})
    if sigs:
        out["signals"] = sigs
    play = []
    for it in (llm_out.get("playbook") or [])[:3]:
        l = (it.get("label") or "").strip()[:8]
        a = (it.get("action") or "").strip()[:60]
        if l and a:
            play.append({"label": l, "action": a})
    if play:
        out["playbook"] = play
    ev = [str(e).strip()[:80] for e in (llm_out.get("evidence") or [])[:5] if e]
    if ev:
        out["evidence"] = ev
    return out


async def generate_institutional_brief(
    trade_date: date | None = None,
    report_date: date | None = None,
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()
    snapshot = _load_snapshot(report_date, trade_date)

    base: dict[str, Any] = {
        "trade_date": trade_date.isoformat(),
        "report_date": snapshot.get("report_date"),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "model": model_id,
        "headline": "",
        "stance": "资金分散",
        "signals": [],
        "playbook": [],
        "evidence": [],
        "highlights": snapshot.get("highlights") or {},
        "events_recent": snapshot.get("events_recent", [])[:15],
        "event_summary": snapshot.get("event_summary") or {},
    }
    if not snapshot.get("highlights") and not snapshot.get("events_recent"):
        base["headline"] = "暂无主力身份数据(需先回填季报+公告)"
        return base

    hint = _heuristic_brief(snapshot)
    system, user = _build_prompt(snapshot, hint)
    llm_out = await _call_llm(system, user, model_id)
    merged = _merge(hint, llm_out)
    base.update(merged)
    return base
