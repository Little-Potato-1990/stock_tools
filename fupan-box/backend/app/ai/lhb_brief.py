"""龙虎榜 AI 拆解卡片 (P1 新增).

设计原则: 跟 ladder_brief 一致 —— 数字派生、判断 LLM, 失败兜底用 heuristic.

输入: lhb snapshot (当日上榜股 + 营业部明细)
输出:
{
  "trade_date": "...",
  "generated_at": "...",
  "model": "...",
  "headline": "游资接力光模块, 机构集中撤离白酒 ...",
  "structure": [
    {"label": "方向",  "text": "..."},     # 资金净流向
    {"label": "接力",  "text": "..."},     # 游资追逐线
    {"label": "警示",  "text": "..."},     # 出货/对手盘
  ],
  "key_offices": [{"name": "...", "is_inst": bool, "tag": "...", "net_buy": float, "note": "..."}],
  "key_stocks":  [{"code": "...", "name": "...", "net_amount": float, "tag": "...", "note": "..."}],
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
from app.ai.cross_context import NO_FLUFF_RULES, build_cross_context_block
from app.config import get_settings
from app.models.snapshot import DailySnapshot

logger = logging.getLogger(__name__)


def _load_lhb_snapshot(trade_date: date) -> dict | None:
    """单独加载 lhb snapshot (brief_generator._load_snapshots 不含 lhb 类型)."""
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            row = session.execute(
                select(DailySnapshot)
                .where(
                    DailySnapshot.trade_date == trade_date,
                    DailySnapshot.snapshot_type == "lhb",
                )
                .order_by(DailySnapshot.id.desc())
                .limit(1)
            ).scalar_one_or_none()
            return row.data if row and row.data else None
    finally:
        engine.dispose()


def _summarize_lhb_struct(lhb: dict | None) -> dict[str, Any]:
    """派生龙虎榜结构指标 (无 LLM)."""
    if not lhb:
        return {
            "stock_count": 0,
            "inst_count": 0,
            "total_net": 0.0,
            "top_stocks": [],
            "top_offices": [],
            "direction": "无数据",
        }

    stocks_raw = lhb.get("stocks") or []
    insts_by_code: dict[str, list[dict]] = lhb.get("insts_by_code") or {}

    total_net = sum(float(s.get("net_amount", 0) or 0) for s in stocks_raw)

    # 1) 按净买入绝对值排序, 取 top 8
    sorted_stocks = sorted(
        stocks_raw,
        key=lambda s: abs(float(s.get("net_amount", 0) or 0)),
        reverse=True,
    )
    top_stocks: list[dict[str, Any]] = []
    for s in sorted_stocks[:8]:
        code = str(s.get("stock_code") or "")
        if not code:
            continue
        top_stocks.append({
            "code": code,
            "name": str(s.get("stock_name") or ""),
            "pct_change": float(s.get("pct_change", 0) or 0),
            "net_amount": float(s.get("net_amount", 0) or 0),
            "amount_rate": float(s.get("amount_rate", 0) or 0),
            "reason": (str(s.get("reason") or ""))[:30],
        })

    # 2) 聚合营业部 (跨股, 累计 net_buy + 出现次数), 取 top 8
    office_agg: dict[str, dict[str, Any]] = {}
    for code, arr in insts_by_code.items():
        if not isinstance(arr, list):
            continue
        for inst in arr:
            name = str(inst.get("exalter") or "").strip()
            if not name:
                continue
            agg = office_agg.setdefault(
                name,
                {"name": name, "is_inst": bool(inst.get("is_inst")), "net_buy": 0.0, "appearance": 0, "stocks": set()},
            )
            agg["net_buy"] += float(inst.get("net_buy", 0) or 0)
            agg["appearance"] += 1
            agg["stocks"].add(code)

    sorted_offices = sorted(
        office_agg.values(),
        key=lambda x: abs(x["net_buy"]),
        reverse=True,
    )
    top_offices: list[dict[str, Any]] = []
    for o in sorted_offices[:8]:
        top_offices.append({
            "name": o["name"],
            "is_inst": o["is_inst"],
            "net_buy": round(o["net_buy"], 2),
            "appearance": o["appearance"],
            "stock_count": len(o["stocks"]),
        })

    direction = (
        "整体净流入" if total_net > 5e8
        else "整体净流出" if total_net < -5e8
        else "多空僵持"
    )

    return {
        "stock_count": int(lhb.get("stock_count") or len(stocks_raw)),
        "inst_count": int(lhb.get("inst_count") or 0),
        "total_net": round(total_net, 2),
        "top_stocks": top_stocks,
        "top_offices": top_offices,
        "direction": direction,
    }


def _build_prompt(
    trade_date: str,
    struct: dict[str, Any],
    cross_ctx: str = "",
) -> tuple[str, str]:
    system = (
        "你是 A 股短线复盘助手, 专门做龙虎榜资金面拆解。"
        "请基于给定数据, 用中文输出 JSON。"
        "**严格要求**: name/code 必须从给定数据中选, 不得编造。"
        "判断要直接、口语化、有信息量, 不要套话。"
        "若上游主线/核心龙头已知, 'tag' 与 'note' 必须呼应: "
        "买入主线龙头的游资 = '游资接力', 出货主线/高度龙头的机构 = '机构出货', "
        "封单远不足 / 跟风票 = '资金分歧 / 高位接力风险'。"
        + NO_FLUFF_RULES
    )

    user = (
        f"今日 {trade_date} 龙虎榜数据如下:\n\n"
        f"```json\n{json.dumps(struct, ensure_ascii=False)[:3500]}\n```\n"
        f"{cross_ctx}"
        "\n请输出 JSON, 严格按以下 schema:\n"
        "```json\n"
        "{\n"
        '  "headline": "一句话定调今日游资 / 机构动向 (≤40 字)",\n'
        '  "structure": [\n'
        '    {"label": "方向", "text": "资金净流向判断 + 是否分歧 (≤30 字)"},\n'
        '    {"label": "接力", "text": "游资集中追逐的题材 / 个股 (≤30 字)"},\n'
        '    {"label": "警示", "text": "对手盘 / 机构出货 / 高位接力风险 (≤30 字)"}\n'
        "  ],\n"
        '  "key_offices": [\n'
        '    {"name": "(必须从 top_offices 选)", "tag": "知名游资|机构|一线席位|游资接力 之一", "note": "1 句点评 ≤30 字"}\n'
        "  ],\n"
        '  "key_stocks": [\n'
        '    {"code": "(必须从 top_stocks 选)", "tag": "游资抢筹|机构出货|对手盘激烈|资金分歧 之一", "note": "1 句点评 ≤30 字"}\n'
        "  ],\n"
        '  "evidence": [\n'
        '    "1-3 条 ≤30 字 关键数字证据, 必须引用 struct 里的真实数字",\n'
        '    "示例: \'top_stocks 净买 +3.2 亿, 全部主线光模块\'",\n'
        '    "示例: \'章盟主席位净买 1.8 亿, 同时上 3 票\'"\n'
        "  ]\n"
        "}\n```\n"
        "key_offices 输出 3-4 条; key_stocks 输出 2-3 条。"
        "name/code 必须严格在数据中。不要返回 markdown fence。"
    )
    return system, user


def _heuristic_brief(struct: dict[str, Any]) -> dict[str, Any]:
    direction = struct.get("direction", "无数据")
    total_net = float(struct.get("total_net", 0))
    sc = struct.get("stock_count", 0)
    top_stocks = struct.get("top_stocks") or []
    top_offices = struct.get("top_offices") or []

    headline = f"今日上榜 {sc} 只 · {direction}"
    if abs(total_net) > 1e8:
        headline += f" {total_net / 1e8:+.1f}亿"

    structure = [
        {"label": "方向", "text": (
            f"净买入 {total_net / 1e8:+.1f} 亿, {direction}"
            if abs(total_net) > 1e7 else "上榜资金多空僵持"
        )},
        {"label": "接力", "text": (
            f"领涨 {top_stocks[0]['name']} {top_stocks[0]['pct_change']:+.1f}%"
            if top_stocks else "无明显领涨"
        )},
        {"label": "警示", "text": "建议人工核对席位真实意图"},
    ]
    key_offices = [{
        "name": o["name"],
        "is_inst": o.get("is_inst", False),
        "tag": "机构" if o.get("is_inst") else "游资",
        "net_buy": o["net_buy"],
        "note": "暂无 LLM 点评",
    } for o in top_offices[:3]]
    key_stocks = [{
        "code": s["code"],
        "name": s["name"],
        "net_amount": s["net_amount"],
        "tag": "资金分歧",
        "note": "暂无 LLM 点评",
    } for s in top_stocks[:3]]

    evidence: list[str] = [f"上榜 {sc} 只, 净买入 {total_net / 1e8:+.1f} 亿"]
    if top_stocks:
        s0 = top_stocks[0]
        evidence.append(f"领涨 {s0['name']} {s0['pct_change']:+.1f}%, 净 {s0['net_amount'] / 1e8:+.2f}亿")
    if top_offices:
        o0 = top_offices[0]
        kind = "机构" if o0.get("is_inst") else "游资"
        evidence.append(f"{kind}首席 {o0['name'][:8]} 净 {o0['net_buy'] / 1e8:+.2f}亿")
    return {
        "headline": headline,
        "structure": structure,
        "key_offices": key_offices,
        "key_stocks": key_stocks,
        "evidence": evidence,
    }


def _merge_llm(struct: dict[str, Any], llm_out: dict | None) -> dict[str, Any]:
    if not llm_out:
        return _heuristic_brief(struct)

    top_offices = struct.get("top_offices") or []
    top_stocks = struct.get("top_stocks") or []
    office_map = {o["name"]: o for o in top_offices}
    stock_map = {s["code"]: s for s in top_stocks}

    fallback = _heuristic_brief(struct)

    headline = (llm_out.get("headline") or "").strip()
    if not headline or len(headline) > 60:
        headline = fallback["headline"]

    structure_raw = llm_out.get("structure") or []
    structure = []
    for item in structure_raw[:3]:
        label = (item.get("label") or "").strip() or "-"
        text = (item.get("text") or "").strip()
        if text:
            structure.append({"label": label, "text": text[:60]})
    if len(structure) < 3:
        for s in fallback["structure"][len(structure):]:
            structure.append(s)

    key_offices: list[dict[str, Any]] = []
    for item in llm_out.get("key_offices") or []:
        name = (item.get("name") or "").strip()
        if name not in office_map:
            continue
        o = office_map[name]
        key_offices.append({
            "name": name,
            "is_inst": o.get("is_inst", False),
            "tag": (item.get("tag") or "游资").strip()[:6],
            "net_buy": o["net_buy"],
            "note": (item.get("note") or "").strip()[:60] or "暂无点评",
        })
        if len(key_offices) >= 4:
            break
    if not key_offices:
        key_offices = fallback["key_offices"]

    key_stocks: list[dict[str, Any]] = []
    for item in llm_out.get("key_stocks") or []:
        code = str(item.get("code") or "").strip()
        if code not in stock_map:
            continue
        s = stock_map[code]
        key_stocks.append({
            "code": code,
            "name": s["name"],
            "net_amount": s["net_amount"],
            "tag": (item.get("tag") or "资金分歧").strip()[:6],
            "note": (item.get("note") or "").strip()[:60] or "暂无点评",
        })
        if len(key_stocks) >= 3:
            break
    if not key_stocks:
        key_stocks = fallback["key_stocks"]

    evidence: list[str] = []
    for raw in (llm_out.get("evidence") or [])[:3]:
        s = (str(raw) if not isinstance(raw, str) else raw).strip()[:40]
        if s:
            evidence.append(s)
    if not evidence:
        evidence = fallback.get("evidence", [])

    return {
        "headline": headline,
        "structure": structure,
        "key_offices": key_offices,
        "key_stocks": key_stocks,
        "evidence": evidence,
    }


async def generate_lhb_brief(
    trade_date: date | None,
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()

    lhb = _load_lhb_snapshot(trade_date)

    base: dict[str, Any] = {
        "trade_date": trade_date.isoformat(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "model": model_id,
        "headline": "",
        "structure": [],
        "key_offices": [],
        "key_stocks": [],
        "evidence": [],
    }

    if not lhb:
        base["headline"] = f"{trade_date.isoformat()} 暂无龙虎榜数据"
        return base

    struct = _summarize_lhb_struct(lhb)

    if struct.get("stock_count", 0) == 0:
        base["headline"] = f"{trade_date.isoformat()} 当日无个股上榜"
        return base

    cross_ctx = build_cross_context_block(
        trade_date, model_id, include_theme=True, include_ladder=True
    )

    # P3 资金画像注入: 给上榜 top 5 个股补充主力/北向/机构股东标签
    try:
        from app.services.stock_context import get_stock_capital_sync
        top_codes = [s.get("code") for s in (struct.get("top_stocks") or [])[:5] if s.get("code")]
        cap_lines = ["", "【上榜个股资金画像 (Top 5)】"]
        for c in top_codes:
            cap = get_stock_capital_sync(c, trade_date)
            parts = [c]
            cap_d = cap.get("capital") or {}
            main = cap_d.get("main") or {}
            if main.get("today_main_inflow") is not None:
                parts.append(f"主力{main['today_main_inflow']/1e8:+.2f}亿")
            if main.get("net_5d") is not None:
                parts.append(f"5日{main['net_5d']/1e8:+.2f}亿")
            north = cap_d.get("north") or {}
            if north.get("chg_amount_5d") is not None:
                parts.append(f"北向5日{north['chg_amount_5d']/1e8:+.2f}亿")
            inst = cap.get("institutional") or {}
            tags = []
            if inst.get("has_national_team"): tags.append("国家队")
            if inst.get("has_social"): tags.append("社保")
            if inst.get("has_insurance"): tags.append("险资")
            if inst.get("has_qfii"): tags.append("QFII")
            if tags: parts.append("|".join(tags))
            if len(parts) > 1:
                cap_lines.append("- " + " ".join(parts))
        if len(cap_lines) > 2:
            cross_ctx = (cross_ctx or "") + "\n".join(cap_lines) + "\n"
    except Exception:
        pass

    system, user = _build_prompt(trade_date.isoformat(), struct, cross_ctx)
    llm_out = await _call_llm(system, user, model_id)
    merged = _merge_llm(struct, llm_out)
    base.update(merged)
    return base
