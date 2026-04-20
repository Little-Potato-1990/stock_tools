"""我的交易复盘 — 模式诊断 + AI 综合点评.

模式诊断 (纯统计, 不调 LLM):
    - 胜率 / 平均盈亏 / 期望
    - 追高比例 (intraday_chg_at_buy > 5%)
    - 平均持仓时长
    - 最赚票 / 最亏票
    - 操作模式标签 (短线快进快出 / 隔夜守候 / 追高型 / 埋伏型)

AI 综合 (LLM):
    - 优势 / 短板 / 改进建议 (3 条)
"""

from __future__ import annotations

import json
import logging
import statistics
from typing import Any, Iterable

from app.ai.brief_generator import _call_llm

logger = logging.getLogger(__name__)


def diagnose_pattern(trades: Iterable[Any], days: int = 30) -> dict[str, Any]:
    trades = list(trades)
    n = len(trades)
    if n == 0:
        return {
            "days": days,
            "trade_count": 0,
            "win_count": 0,
            "win_rate": 0.0,
            "total_pnl": 0.0,
            "avg_pnl_pct": 0.0,
            "expectation": 0.0,
            "max_win": None,
            "max_loss": None,
            "chase_rate": 0.0,
            "avg_holding_min": None,
            "median_holding_min": None,
            "mode_label": "无数据",
            "mode_desc": "请先录入至少一笔交易记录",
        }

    pnl_pcts = [t.pnl_pct for t in trades]
    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    win_rate = round(len(wins) / n, 3)
    total_pnl = round(sum(t.pnl for t in trades), 2)
    avg_pnl_pct = round(statistics.mean(pnl_pcts), 2)

    avg_win_pct = round(statistics.mean([t.pnl_pct for t in wins]), 2) if wins else 0.0
    avg_loss_pct = round(statistics.mean([t.pnl_pct for t in losses]), 2) if losses else 0.0
    expectation = round(win_rate * avg_win_pct + (1 - win_rate) * avg_loss_pct, 2)

    max_win_t = max(trades, key=lambda t: t.pnl_pct)
    max_loss_t = min(trades, key=lambda t: t.pnl_pct)

    chase_trades = [t for t in trades if (t.intraday_chg_at_buy or -99) > 5.0]
    chase_rate = round(len(chase_trades) / n, 3)

    holding_vals = [t.holding_minutes for t in trades if t.holding_minutes is not None and t.holding_minutes > 0]
    avg_hold = round(statistics.mean(holding_vals), 1) if holding_vals else None
    med_hold = round(statistics.median(holding_vals), 1) if holding_vals else None

    if avg_hold is None:
        mode_label = "未填持仓时长"
        mode_desc = "建议下次交易记录持仓时长以诊断短线/隔夜倾向"
    elif avg_hold < 60:
        mode_label = "极短线"
        mode_desc = f"平均持仓 {avg_hold:.0f} 分钟, 偏好分时打板/T+0 高抛"
    elif avg_hold < 240:
        mode_label = "日内短线"
        mode_desc = f"平均持仓 {avg_hold:.0f} 分钟, 当日完成进出"
    else:
        mode_label = "隔夜短线"
        mode_desc = f"平均持仓 {avg_hold/240:.1f} 天, 倾向隔夜博弈"

    if chase_rate > 0.4:
        mode_label = "追高型 · " + mode_label
        mode_desc += f"; 追高比例高达 {chase_rate*100:.0f}%, 注意分歧风险"
    elif chase_rate < 0.1 and avg_hold is not None:
        mode_label = "埋伏型 · " + mode_label
        mode_desc += f"; 介入位置普遍低位 (追高 {chase_rate*100:.0f}%)"

    return {
        "days": days,
        "trade_count": n,
        "win_count": len(wins),
        "win_rate": win_rate,
        "total_pnl": total_pnl,
        "avg_pnl_pct": avg_pnl_pct,
        "avg_win_pct": avg_win_pct,
        "avg_loss_pct": avg_loss_pct,
        "expectation": expectation,
        "max_win": {
            "code": max_win_t.code,
            "name": max_win_t.name,
            "pnl_pct": round(max_win_t.pnl_pct, 2),
            "trade_date": max_win_t.trade_date.isoformat(),
        },
        "max_loss": {
            "code": max_loss_t.code,
            "name": max_loss_t.name,
            "pnl_pct": round(max_loss_t.pnl_pct, 2),
            "trade_date": max_loss_t.trade_date.isoformat(),
        },
        "chase_rate": chase_rate,
        "chase_count": len(chase_trades),
        "avg_holding_min": avg_hold,
        "median_holding_min": med_hold,
        "mode_label": mode_label,
        "mode_desc": mode_desc,
    }


def _heuristic_review(pattern: dict[str, Any]) -> dict[str, Any]:
    n = pattern["trade_count"]
    wr = pattern["win_rate"]
    exp = pattern["expectation"]

    strengths = []
    weaknesses = []
    suggestions = []

    if wr >= 0.6:
        strengths.append({"label": "胜率", "text": f"胜率 {wr*100:.0f}% 高于平均, 选股节奏稳"})
    elif wr < 0.4:
        weaknesses.append({"label": "胜率", "text": f"胜率仅 {wr*100:.0f}%, 选股准度有待提升"})

    if exp > 1.0:
        strengths.append({"label": "期望", "text": f"单笔期望收益 +{exp:.1f}%, 盈亏比健康"})
    elif exp < 0:
        weaknesses.append({"label": "期望", "text": f"单笔期望 {exp:.1f}%, 盈亏比倒挂"})

    if pattern.get("chase_rate", 0) > 0.4:
        weaknesses.append({"label": "追高", "text": f"追高比例 {pattern['chase_rate']*100:.0f}%, 介入位置普遍偏高"})
        suggestions.append({"label": "降追高", "text": "首板/次新可在分时回踩 5 日均线后再介入"})

    if pattern.get("max_loss") and pattern["max_loss"]["pnl_pct"] < -10:
        weaknesses.append({
            "label": "止损",
            "text": f"最大单笔亏损 {pattern['max_loss']['pnl_pct']:.1f}% ({pattern['max_loss']['name']}), 缺纪律",
        })
        suggestions.append({"label": "硬止损", "text": "给每笔单设 -7% 硬止损, 跌破立刻清仓"})

    if not suggestions:
        suggestions.append({"label": "复盘", "text": f"继续保持当前节奏 ({n} 笔统计)"})

    return {
        "mode_label": pattern["mode_label"],
        "summary": pattern["mode_desc"],
        "strengths": strengths or [{"label": "中性", "text": "数据不足以给出明确优势"}],
        "weaknesses": weaknesses or [{"label": "中性", "text": "暂无明显短板"}],
        "suggestions": suggestions,
    }


def _build_prompt(trades: list, pattern: dict[str, Any]) -> tuple[str, str]:
    trades_brief = [
        {
            "date": t.trade_date.isoformat(),
            "name": t.name,
            "code": t.code,
            "buy": t.buy_price,
            "sell": t.sell_price,
            "qty": t.qty,
            "pnl_pct": round(t.pnl_pct, 2),
            "intraday_chg_at_buy": t.intraday_chg_at_buy,
            "holding_min": t.holding_minutes,
            "reason": (t.reason or "")[:60],
        }
        for t in trades[:30]
    ]
    system = (
        "你是 A 股资深超短线导师, 现在要给一位散户用户做交易复盘点评。"
        "**禁止**: 编造数据、给具体买卖价位、空话套话。"
        "**风格**: 直接、犀利、给可执行建议, 中文输出。"
        "严格按 JSON schema 返回, 不要 markdown fence。"
    )
    user = (
        f"该用户最近 {pattern['days']} 天 {pattern['trade_count']} 笔交易统计:\n"
        f"```json\n{json.dumps(pattern, ensure_ascii=False)}\n```\n\n"
        f"前 30 笔明细 (含介入逻辑/持仓时长/介入时刻当日涨幅):\n"
        f"```json\n{json.dumps(trades_brief, ensure_ascii=False)[:5000]}\n```\n\n"
        "请输出 JSON, schema:\n"
        "```json\n"
        "{\n"
        '  "mode_label": "<=12字 操作模式标签",\n'
        '  "summary": "<=80字 一段话总结操作风格 + 最显眼的问题",\n'
        '  "strengths": [{"label": "<=4字", "text": "<=50字"}],\n'
        '  "weaknesses": [{"label": "<=4字", "text": "<=50字"}],\n'
        '  "suggestions": [{"label": "<=4字", "text": "<=60字 必须是可执行动作"}]\n'
        "}\n```\n"
        "strengths/weaknesses/suggestions 各 2-3 条, 每条 label 不同。"
    )
    return system, user


def _merge_llm(pattern: dict[str, Any], llm_out: dict | None) -> dict[str, Any]:
    base = _heuristic_review(pattern)
    if not llm_out:
        return base

    if (mode := (llm_out.get("mode_label") or "").strip()):
        base["mode_label"] = mode[:20]
    if (s := (llm_out.get("summary") or "").strip()):
        base["summary"] = s[:120]

    for key in ("strengths", "weaknesses", "suggestions"):
        items_raw = llm_out.get(key) or []
        clean: list[dict[str, str]] = []
        for it in items_raw[:3]:
            if not isinstance(it, dict):
                continue
            label = (it.get("label") or "").strip()[:8]
            text = (it.get("text") or "").strip()[:80]
            if label and text:
                clean.append({"label": label, "text": text})
        if clean:
            base[key] = clean

    return base


async def generate_ai_review(
    trades: list,
    pattern: dict[str, Any],
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    if pattern["trade_count"] == 0:
        return {
            "mode_label": "无数据",
            "summary": "请先录入至少 3 笔交易再让 AI 复盘",
            "strengths": [],
            "weaknesses": [],
            "suggestions": [],
            "model": model_id,
        }

    system, user = _build_prompt(trades, pattern)
    llm_out = await _call_llm(system, user, model_id)
    merged = _merge_llm(pattern, llm_out)
    merged["model"] = model_id
    return merged
