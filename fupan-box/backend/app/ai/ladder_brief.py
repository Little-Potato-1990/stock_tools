"""连板天梯 AI 拆解卡片.

设计原则: 跟 brief_generator 一致 —— 数字派生、判断 LLM。

输入: ladder snapshot (按板高度分层, 含每只票的 board_level / first_limit_time / open_count / theme_names)
输出:
{
  "trade_date": "...",
  "generated_at": "...",
  "model": "...",
  "headline": "高度断在 5 板, 主线集中光模块",
  "structure": [{"label": "高度",  "text": "..."}, ...],   # 3 条结构观察
  "key_stocks": [{"code": "...", "name": "...", "board": N, "tag": "...", "note": "..."}]
}
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any

from app.ai.brief_generator import (
    _call_llm,
    _flatten_ladder_stocks,
    _latest_trade_date_with_data,
    _load_snapshots,
)
from app.ai.cross_context import NO_FLUFF_RULES, build_cross_context_block

logger = logging.getLogger(__name__)


def _summarize_ladder_struct(ladder: dict | None) -> dict[str, Any]:
    """派生板梯结构指标 (无 LLM)."""
    stocks = _flatten_ladder_stocks(ladder)
    if not stocks:
        return {
            "by_level": {},
            "level_counts": {},
            "levels_present": [],
            "missing_levels": [],
            "max_board": 0,
            "total": 0,
            "themes": [],
        }

    by_level: dict[int, list[dict]] = {}
    for s in stocks:
        lvl = int(s.get("board_level", 1) or 1)
        by_level.setdefault(lvl, []).append(s)

    max_board = max(by_level.keys())
    levels_present = sorted(by_level.keys())
    gap = []
    for i in range(max_board, 0, -1):
        if i not in by_level:
            gap.append(i)

    theme_count: dict[str, int] = {}
    for s in stocks:
        for t in s.get("theme_names") or []:
            if t:
                theme_count[t] = theme_count.get(t, 0) + 1
    top_themes = sorted(theme_count.items(), key=lambda x: x[1], reverse=True)[:5]

    return {
        "by_level": {lvl: [{
            "code": s.get("stock_code", ""),
            "name": s.get("stock_name", ""),
            "limit_order_amount": s.get("limit_order_amount", 0),
            "first_limit_time": s.get("first_limit_time", ""),
            "open_count": s.get("open_count", 0),
            "is_one_word": bool(s.get("is_one_word")),
            "theme_names": s.get("theme_names") or [],
        } for s in items[:5]] for lvl, items in by_level.items()},
        "level_counts": {lvl: len(items) for lvl, items in by_level.items()},
        "levels_present": levels_present,
        "missing_levels": gap,
        "max_board": max_board,
        "total": len(stocks),
        "themes": [{"name": n, "count": c} for n, c in top_themes],
    }


def _derive_key_stock_pool(struct: dict[str, Any]) -> list[dict[str, Any]]:
    """从结构里挑 5-7 只候选, 后续让 LLM 选 3-5 只重点跟踪."""
    pool: list[dict[str, Any]] = []
    by_level = struct.get("by_level", {})

    sorted_levels = sorted(by_level.keys(), reverse=True)
    for lvl in sorted_levels[:3]:
        for s in by_level[lvl][:2]:
            pool.append({
                "code": s["code"],
                "name": s["name"],
                "board": lvl,
                "themes": s.get("theme_names", []),
                "first_limit_time": s.get("first_limit_time", ""),
                "open_count": s.get("open_count", 0),
                "is_one_word": s.get("is_one_word", False),
            })

    return pool[:7]


def _build_prompt(
    trade_date: str,
    struct: dict[str, Any],
    pool: list[dict],
    cross_ctx: str = "",
) -> tuple[str, str]:
    system = (
        "你是 A 股短线复盘助手, 专门做连板梯队结构拆解。"
        "请基于给定数据, 用中文输出 JSON。"
        "**严格要求**: stock_code/stock_name 必须从给定数据中选, 不得编造。"
        "判断要直接、精炼、口语化, 不要套话。"
        "tag 应与上游主线/情绪呼应: 主线题材里的最高板 = '主线龙头', "
        "非主线但板高 = '高度龙头', 题材新冒头 = '超预期', 板高且无连板梯队衔接 = '空间股'。"
        + NO_FLUFF_RULES
    )

    user = (
        f"今日 {trade_date} 板梯结构数据如下:\n\n"
        f"```json\n{json.dumps({'struct': struct, 'pool': pool}, ensure_ascii=False)[:3500]}\n```\n"
        f"{cross_ctx}"
        "\n请输出 JSON, 严格按以下 schema:\n"
        "```json\n"
        "{\n"
        '  "headline": "一句话概括今日梯队 (≤40 字, 突出高度/主线/情绪)",\n'
        '  "structure": [\n'
        '    {"label": "高度", "text": "对最高板/断层/独苗的判断 (≤30 字)"},\n'
        '    {"label": "主线", "text": "对核心题材集中度的判断 (≤30 字)"},\n'
        '    {"label": "情绪", "text": "对首板含金量/炸板/承接的判断 (≤30 字)"}\n'
        "  ],\n"
        '  "key_stocks": [\n'
        '    {"code": "(必须从 pool 中选)", "name": "(对应名称)", "board": (板数), "tag": "高度龙头|主线龙头|超预期|空间股 之一", "note": "1 句点评 ≤40 字"}\n'
        "  ],\n"
        '  "evidence": [\n'
        '    "1-3 条 ≤30 字 关键数字证据, 必须引用 struct 里的真实数字",\n'
        '    "示例: \'最高 5 板独苗, 4 板 2 只, 3 板缺位\'",\n'
        '    "示例: \'光模块 4 只入梯, 占总数 30%\'"\n'
        "  ]\n"
        "}\n```\n"
        "key_stocks 输出 3-5 只。注意 code 必须严格在 pool 中。不要返回 markdown fence。"
    )
    return system, user


def _heuristic_brief(struct: dict[str, Any], pool: list[dict]) -> dict[str, Any]:
    max_b = struct.get("max_board", 0)
    total = struct.get("total", 0)
    missing = struct.get("missing_levels") or []
    themes = struct.get("themes") or []
    top_theme = themes[0]["name"] if themes else "无主线"

    headline = f"今日最高 {max_b} 板, 共 {total} 只涨停"
    if top_theme != "无主线":
        headline += f", 主线 {top_theme}"

    structure = [
        {"label": "高度", "text": (
            f"最高 {max_b} 板, 缺 {','.join(map(str, missing[:3]))} 板" if missing
            else f"最高 {max_b} 板, 阶梯衔接完整"
        )},
        {"label": "主线", "text": (
            f"{top_theme} {themes[0]['count']} 只领跑" if themes else "题材分散"
        )},
        {"label": "情绪", "text": f"涨停总数 {total} 只"},
    ]
    key_stocks = [{
        "code": s["code"],
        "name": s["name"],
        "board": s["board"],
        "tag": "高度龙头" if s["board"] == max_b else "梯队跟随",
        "note": "暂无 LLM 点评",
    } for s in pool[:3]]

    evidence: list[str] = [f"最高 {max_b} 板, 涨停总数 {total} 只"]
    if missing:
        evidence.append(f"缺位: {','.join(map(str, missing[:3]))} 板")
    if themes:
        evidence.append(f"主线 {top_theme} {themes[0]['count']} 只入梯")

    return {"headline": headline, "structure": structure, "key_stocks": key_stocks, "evidence": evidence}


def _merge_llm(base_struct: dict[str, Any], pool: list[dict], llm_out: dict | None) -> dict[str, Any]:
    if not llm_out:
        return _heuristic_brief(base_struct, pool)

    pool_codes = {p["code"] for p in pool}
    pool_map = {p["code"]: p for p in pool}

    headline = (llm_out.get("headline") or "").strip()
    if not headline or len(headline) > 60:
        headline = _heuristic_brief(base_struct, pool)["headline"]

    structure_raw = llm_out.get("structure") or []
    structure = []
    for item in structure_raw[:3]:
        label = (item.get("label") or "").strip() or "-"
        text = (item.get("text") or "").strip()
        if text:
            structure.append({"label": label, "text": text[:60]})
    if len(structure) < 3:
        for s in _heuristic_brief(base_struct, pool)["structure"][len(structure):]:
            structure.append(s)

    key_raw = llm_out.get("key_stocks") or []
    key_stocks: list[dict[str, Any]] = []
    for item in key_raw:
        code = str(item.get("code") or "").strip()
        if code not in pool_codes:
            continue
        p = pool_map[code]
        key_stocks.append({
            "code": code,
            "name": item.get("name") or p["name"],
            "board": p["board"],
            "tag": (item.get("tag") or "梯队跟随").strip()[:6],
            "note": (item.get("note") or "").strip()[:60] or "暂无点评",
        })
        if len(key_stocks) >= 5:
            break
    if not key_stocks:
        key_stocks = _heuristic_brief(base_struct, pool)["key_stocks"]

    evidence: list[str] = []
    for raw in (llm_out.get("evidence") or [])[:3]:
        s = (str(raw) if not isinstance(raw, str) else raw).strip()[:40]
        if s:
            evidence.append(s)
    if not evidence:
        evidence = _heuristic_brief(base_struct, pool).get("evidence", [])

    return {"headline": headline, "structure": structure, "key_stocks": key_stocks, "evidence": evidence}


async def generate_ladder_brief(
    trade_date: date | None,
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()

    snaps = _load_snapshots(trade_date)
    ladder = snaps.get("ladder")

    base: dict[str, Any] = {
        "trade_date": trade_date.isoformat(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "model": model_id,
        "headline": "",
        "structure": [],
        "key_stocks": [],
        "evidence": [],
    }

    if not ladder:
        base["headline"] = f"{trade_date.isoformat()} 暂无连板数据"
        return base

    struct = _summarize_ladder_struct(ladder)
    pool = _derive_key_stock_pool(struct)

    if struct["total"] == 0:
        base["headline"] = f"{trade_date.isoformat()} 涨停板数据尚未生成 (盘后 17:30 后更新)"
        base["structure"] = [
            {"label": "高度", "text": "数据待更新"},
            {"label": "主线", "text": "数据待更新"},
            {"label": "情绪", "text": "数据待更新"},
        ]
        return base

    llm_struct = {
        "max_board": struct["max_board"],
        "total": struct["total"],
        "level_counts": struct["level_counts"],
        "missing_levels": struct["missing_levels"],
        "themes": struct["themes"],
    }

    cross_ctx = build_cross_context_block(
        trade_date, model_id, include_sentiment=True, include_theme=True
    )
    system, user = _build_prompt(trade_date.isoformat(), llm_struct, pool, cross_ctx)
    llm_out = await _call_llm(system, user, model_id)
    merged = _merge_llm(struct, pool, llm_out)
    base.update(merged)
    return base
