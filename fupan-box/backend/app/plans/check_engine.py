"""计划触发条件求值器.

把"判断 plan 是否触发"做成无副作用的纯函数, 方便 celery task 调用 + 单元测试.

外部调用入口:
    evaluate_plan(plan, prev_quote, cur_quote) -> list[Hit]
        prev_quote 可能为 None (无窗口数据), 需要 prev 才能判断的条件 (limit_up_break) 自动跳过.

支持的 condition.type:
    price_above       {value}     cur.price >= value (且 prev.price < value 时才视为新触发, prev=None 视作直接命中)
    price_below       {value}     cur.price <= value
    change_pct_above  {value}     cur.change_pct >= value
    change_pct_below  {value}     cur.change_pct <= value (value 通常为负数)
    limit_up          {}          cur.change_pct >= 9.7
    limit_up_break    {}          prev.change_pct >= 9.7 且 cur.change_pct < 9.5
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class Hit:
    """一次条件命中."""

    condition_idx: int
    condition_kind: str  # "trigger" | "invalid"
    condition_type: str
    label: str | None
    price: float | None
    change_pct: float | None


_LIMIT_UP_PCT = 9.7
_LIMIT_UP_RECOVER_PCT = 9.5


def _safe_float(v: Any) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _match_one(
    cond: dict[str, Any],
    prev: dict[str, Any] | None,
    cur: dict[str, Any],
) -> bool:
    """单个 condition 的命中判定. 不抛异常 — 字段有缺/类型不对就视为未命中."""
    ctype = (cond.get("type") or "").strip()
    if not ctype:
        return False
    cur_price = _safe_float(cur.get("price"))
    cur_chg = _safe_float(cur.get("change_pct"))
    prev_price = _safe_float(prev.get("price")) if prev else None
    prev_chg = _safe_float(prev.get("change_pct")) if prev else None
    val = _safe_float(cond.get("value"))

    if ctype == "price_above":
        if cur_price is None or val is None:
            return False
        if prev_price is None:
            return cur_price >= val
        # 边沿触发: 之前低于阈值, 现在到达 — 避免持续刷屏
        return prev_price < val <= cur_price

    if ctype == "price_below":
        if cur_price is None or val is None:
            return False
        if prev_price is None:
            return cur_price <= val
        return prev_price > val >= cur_price

    if ctype == "change_pct_above":
        if cur_chg is None or val is None:
            return False
        if prev_chg is None:
            return cur_chg >= val
        return prev_chg < val <= cur_chg

    if ctype == "change_pct_below":
        if cur_chg is None or val is None:
            return False
        if prev_chg is None:
            return cur_chg <= val
        return prev_chg > val >= cur_chg

    if ctype == "limit_up":
        if cur_chg is None:
            return False
        if prev_chg is None:
            return cur_chg >= _LIMIT_UP_PCT
        return prev_chg < _LIMIT_UP_PCT <= cur_chg

    if ctype == "limit_up_break":
        # 必须有 prev 才能判定打开
        if cur_chg is None or prev_chg is None:
            return False
        return prev_chg >= _LIMIT_UP_PCT and cur_chg < _LIMIT_UP_RECOVER_PCT

    return False


def _scan_list(
    conds: list[dict[str, Any]] | None,
    kind: str,
    prev: dict[str, Any] | None,
    cur: dict[str, Any],
) -> list[Hit]:
    out: list[Hit] = []
    if not conds:
        return out
    for idx, c in enumerate(conds):
        if not isinstance(c, dict):
            continue
        try:
            if _match_one(c, prev, cur):
                out.append(
                    Hit(
                        condition_idx=idx,
                        condition_kind=kind,
                        condition_type=str(c.get("type") or ""),
                        label=str(c.get("label") or "") or None,
                        price=_safe_float(cur.get("price")),
                        change_pct=_safe_float(cur.get("change_pct")),
                    )
                )
        except Exception:
            # 单条 condition 解析异常不影响其他
            continue
    return out


def evaluate_plan(
    trigger_conditions: list[dict[str, Any]] | None,
    invalid_conditions: list[dict[str, Any]] | None,
    prev_quote: dict[str, Any] | None,
    cur_quote: dict[str, Any] | None,
) -> list[Hit]:
    """对单个 plan 求值, 返回所有命中 (trigger + invalid).

    cur_quote 缺失则直接返回空列表.
    """
    if not cur_quote:
        return []
    hits: list[Hit] = []
    hits.extend(_scan_list(trigger_conditions, "trigger", prev_quote, cur_quote))
    hits.extend(_scan_list(invalid_conditions, "invalid", prev_quote, cur_quote))
    return hits
