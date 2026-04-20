"""今日复盘 AI brief 生成器.

设计原则: AI 只生成"判断"（tagline / regime / 题材逻辑 / 龙头点评），
所有数字、涨停数、板高度、龙头股代码 100% 从 DailySnapshot 派生,
LLM 编不了数字, 出错时也能优雅降级.

派生 vs LLM 字段对照:
- key_metrics:           派生 (overview + 前一交易日对比)
- main_lines.name/cnt:   派生 (themes.top + ladder)
- main_lines.leader_*:   派生 (题材 ∩ ladder, 取最高板)
- main_lines.ai_reason:  LLM
- main_lines.status:     LLM
- leaders.*:             派生 + LLM (ai_grade / ai_summary)
- tomorrow_plan:         派生候选池 + LLM 给 trigger/risk
- similar_days:          规则版三维欧氏距离
- tagline / regime:      LLM
"""

from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime
from typing import Any

from openai import AsyncOpenAI
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.ai.cross_context import NO_FLUFF_RULES, build_cross_context_block
from app.ai.llm_service import _get_client
from app.config import get_settings
from app.models.snapshot import DailySnapshot

logger = logging.getLogger(__name__)


def _fmt_amount(yuan: float) -> str:
    if yuan >= 1e12:
        return f"{yuan / 1e12:.2f} 万亿"
    if yuan >= 1e8:
        return f"{yuan / 1e8:.0f} 亿"
    if yuan >= 1e4:
        return f"{yuan / 1e4:.0f} 万"
    return f"{yuan:.0f}"


def _trend(curr: float, prev: float | None, *, higher_is_red: bool = True) -> str:
    if prev is None or prev == 0:
        return "flat"
    if curr > prev:
        return "up" if higher_is_red else "down"
    if curr < prev:
        return "down" if higher_is_red else "up"
    return "flat"


def _delta_str(curr: float, prev: float | None, fmt: str) -> str:
    if prev is None:
        return "—"
    diff = curr - prev
    if abs(diff) < 1e-9:
        return "持平"
    sign = "+" if diff > 0 else ""
    return sign + (fmt % diff)


def _infer_change_pct(stock_code: str) -> float:
    """主板 10%, 科创/创业 20%, 北交所 30%."""
    if stock_code.startswith(("688", "689", "300", "301")):
        return 20.0
    if stock_code.startswith(("8", "920", "430")):
        return 30.0
    return 10.0


def _load_snapshots(trade_date: date) -> dict[str, dict | None]:
    """同步加载当日所有相关 snapshot."""
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    out: dict[str, dict | None] = {"overview": None, "ladder": None, "themes": None, "theme_cons": None}
    try:
        with Session(engine) as session:
            for stype in out:
                row = session.execute(
                    select(DailySnapshot)
                    .where(
                        DailySnapshot.trade_date == trade_date,
                        DailySnapshot.snapshot_type == stype,
                    )
                    .order_by(DailySnapshot.id.desc())
                    .limit(1)
                ).scalar_one_or_none()
                if row and row.data:
                    out[stype] = row.data
    finally:
        engine.dispose()
    return out


def _load_prev_overview(trade_date: date) -> dict | None:
    """加载前一交易日 overview, 用于计算 delta."""
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            row = session.execute(
                select(DailySnapshot)
                .where(
                    DailySnapshot.snapshot_type == "overview",
                    DailySnapshot.trade_date < trade_date,
                )
                .order_by(DailySnapshot.trade_date.desc())
                .limit(1)
            ).scalar_one_or_none()
            return row.data if row else None
    finally:
        engine.dispose()


def _latest_trade_date_with_data() -> date | None:
    """数据库里最近一个有 overview 的交易日."""
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            row = session.execute(
                select(DailySnapshot.trade_date)
                .where(DailySnapshot.snapshot_type == "overview")
                .order_by(DailySnapshot.trade_date.desc())
                .limit(1)
            ).scalar_one_or_none()
            return row
    finally:
        engine.dispose()


def _derive_key_metrics(curr: dict, prev: dict | None) -> list[dict]:
    g = lambda k, default=0: curr.get(k, default)  # noqa: E731
    pg = lambda k: (prev or {}).get(k)  # noqa: E731

    metrics = [
        {
            "label": "涨停数",
            "value": str(g("limit_up_count")),
            "delta": _delta_str(g("limit_up_count"), pg("limit_up_count"), "%d"),
            "trend": _trend(g("limit_up_count"), pg("limit_up_count"), higher_is_red=True),
            "anchor": "limit_up_count",
        },
        {
            "label": "炸板率",
            "value": f"{g('broken_rate') * 100:.1f}%",
            "delta": _delta_str(g("broken_rate") * 100, (pg("broken_rate") or 0) * 100 if pg("broken_rate") is not None else None, "%.1fpct"),
            "trend": _trend(g("broken_rate"), pg("broken_rate"), higher_is_red=False),
            "anchor": "broken_rate",
        },
        {
            "label": "最高板",
            "value": str(g("max_height")),
            "delta": _delta_str(g("max_height"), pg("max_height"), "%d"),
            "trend": _trend(g("max_height"), pg("max_height"), higher_is_red=True),
            "anchor": "max_height",
        },
        {
            "label": "成交额",
            "value": _fmt_amount(g("total_amount")),
            "delta": _delta_str(g("total_amount") / 1e8, (pg("total_amount") or 0) / 1e8 if pg("total_amount") is not None else None, "%.0f亿"),
            "trend": _trend(g("total_amount"), pg("total_amount"), higher_is_red=True),
            "anchor": "total_amount",
        },
        {
            "label": "赚钱效应",
            "value": f"{g('yesterday_lu_up_rate') * 100:.0f}%",
            "delta": _delta_str(g("yesterday_lu_up_rate") * 100, (pg("yesterday_lu_up_rate") or 0) * 100 if pg("yesterday_lu_up_rate") is not None else None, "%.0fpct"),
            "trend": _trend(g("yesterday_lu_up_rate"), pg("yesterday_lu_up_rate"), higher_is_red=True),
            "anchor": "yesterday_lu_up_rate",
        },
    ]
    return metrics


def _flatten_ladder_stocks(ladder: dict | None) -> list[dict]:
    """ladder.levels[].stocks[] flatten, 每只票补 board_level 字段."""
    if not ladder:
        return []
    out: list[dict] = []
    for level in ladder.get("levels", []):
        bl = level.get("board_level", 1)
        for s in level.get("stocks", []):
            out.append({**s, "board_level": bl})
    return out


def _derive_main_lines(themes: dict | None, ladder: dict | None, top_n: int = 3) -> list[dict]:
    """题材 top N + 在涨停板里找该题材的最高板票作为龙头."""
    if not themes:
        return []
    all_lu = _flatten_ladder_stocks(ladder)
    out: list[dict] = []
    for i, t in enumerate(themes.get("top", [])[:top_n]):
        name = t.get("name", "")
        if not name:
            continue
        leader_code = ""
        leader_name = ""
        leader_pct = 0.0
        candidates = [s for s in all_lu if name in (s.get("theme_names") or [])]
        if candidates:
            candidates.sort(key=lambda s: (s.get("board_level", 1), s.get("limit_order_amount", 0)), reverse=True)
            top = candidates[0]
            leader_code = top.get("stock_code", "")
            leader_name = top.get("stock_name", "")
            leader_pct = _infer_change_pct(leader_code)
        out.append({
            "rank": i + 1,
            "name": name,
            "change_pct": float(t.get("change_pct", 0)),
            "limit_up_count": int(t.get("z_t_num", 0)),
            "ai_reason": "",
            "leader_code": leader_code,
            "leader_name": leader_name or "—",
            "leader_pct": leader_pct,
            "status": "rising",
        })
    return out


def _derive_annotations(stock: dict) -> list[dict]:
    """从 ladder.stocks 字段衍生时间轴注解 (无需分时数据).

    可用字段:
      - first_limit_time: 首次封板时间 "HH:MM:SS"
      - open_count: 全日开板/炸板次数
      - is_one_word: 是否一字板
    """
    out: list[dict] = []
    flt = stock.get("first_limit_time") or ""
    is_one_word = bool(stock.get("is_one_word"))
    open_count = int(stock.get("open_count", 0) or 0)

    if is_one_word:
        out.append({"time": "09:25", "label": "竞价一字封板", "level": "positive"})
    elif flt and len(flt) >= 5:
        out.append({"time": flt[:5], "label": "首次封板", "level": "info"})

    if open_count >= 1 and not is_one_word:
        if open_count >= 3:
            tag_time = "11:30"
            level = "warning"
        elif open_count >= 2:
            tag_time = "13:00"
            level = "warning"
        else:
            tag_time = "14:00"
            level = "info"
        out.append({"time": tag_time, "label": f"全日炸板 {open_count} 次", "level": level})

    if not is_one_word and flt:
        out.append({"time": "15:00", "label": "收盘封板", "level": "info"})

    return out


def _derive_leaders(ladder: dict | None, max_n: int = 4) -> list[dict]:
    """从 ladder 取板位最高的若干股, 按 board_level desc, limit_order_amount desc."""
    stocks = _flatten_ladder_stocks(ladder)
    if not stocks:
        return []
    stocks.sort(key=lambda s: (s.get("board_level", 1), s.get("limit_order_amount", 0)), reverse=True)
    out: list[dict] = []
    for s in stocks[:max_n]:
        code = s.get("stock_code", "")
        out.append({
            "code": code,
            "name": s.get("stock_name", ""),
            "board": int(s.get("board_level", 1)),
            "change_pct": _infer_change_pct(code),
            "ai_grade": "B",
            "ai_summary": "",
            "annotations": _derive_annotations(s),
        })
    return out


# 26 维市场指纹: (字段, 归一化分母, 友好名)
_FINGERPRINT_SPEC: list[tuple[str, float, str]] = [
    ("up_rate",                  1.0,    "上涨家数占比"),
    ("sh_up_rate",               1.0,    "上证上涨占比"),
    ("sz_up_rate",               1.0,    "深证上涨占比"),
    ("gem_up_rate",              1.0,    "创业板上涨占比"),
    ("up_count",                 5000.0, "上涨家数"),
    ("down_count",               5000.0, "下跌家数"),
    ("limit_up_count",           100.0,  "涨停家数"),
    ("limit_down_count",         50.0,   "跌停家数"),
    ("one_word_count",           20.0,   "一字板数"),
    ("max_height",               10.0,   "最高连板"),
    ("broken_rate",              1.0,    "炸板率"),
    ("broken_limit_count",       60.0,   "炸板个数"),
    ("open_high_count",          3000.0, "高开家数"),
    ("open_low_count",           50.0,   "低开次新数"),
    ("open_limit_up_count",      20.0,   "高开停开家数"),
    ("open_limit_down_count",    10.0,   "低开跌停家数"),
    ("yesterday_lu_up_rate",     1.0,    "昨涨停今表现"),
    ("yesterday_weak_up_rate",   1.0,    "弱转强占比"),
    ("yesterday_panic_up_rate",  1.0,    "恐慌反包占比"),
    ("main_lu_change_avg",       0.10,   "主板涨停今日均涨"),
    ("main_lu_open_avg",         0.10,   "主板涨停均开盘"),
    ("main_lu_body_avg",         0.10,   "主板涨停实体"),
    ("gem_lu_change_avg",        0.10,   "创板涨停均涨"),
    ("gem_lu_open_avg",          0.10,   "创板涨停均开盘"),
    ("gem_lu_body_avg",          0.10,   "创板涨停实体"),
    ("total_amount",             5e12,   "两市成交额"),
]


def _build_fingerprint(overview: dict) -> list[float]:
    vec: list[float] = []
    for key, denom, _ in _FINGERPRINT_SPEC:
        try:
            v = float(overview.get(key, 0) or 0)
        except Exception:
            v = 0.0
        if denom > 0:
            v = v / denom
        v = max(-3.0, min(3.0, v))
        vec.append(v)
    return vec


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _euclid(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return float("inf")
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def _delta_features(curr: dict, then: dict, top: int = 3) -> list[dict]:
    diffs = []
    for key, _, label in _FINGERPRINT_SPEC:
        try:
            a = float(curr.get(key, 0) or 0)
            b = float(then.get(key, 0) or 0)
        except Exception:
            continue
        diff = a - b
        diffs.append({"name": label, "today": round(a, 4), "then": round(b, 4), "delta": round(diff, 4), "abs": abs(diff)})
    diffs.sort(key=lambda x: -x["abs"])
    out = []
    for d in diffs[:top]:
        d.pop("abs", None)
        out.append(d)
    return out


def _find_similar_days(curr_overview: dict, trade_date: date, top_k: int = 3) -> list[dict]:
    """26 维市场指纹 + cosine 相似日匹配 + 归一化欧氏混合.

    similarity = 0.7 * cosine + 0.3 * (1 - 归一化欧氏);
    next_3d 用"次日赚钱效应相对 50% 中线的偏离"作为后续走势代理.
    """
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            rows = session.execute(
                select(DailySnapshot)
                .where(
                    DailySnapshot.snapshot_type == "overview",
                    DailySnapshot.trade_date < trade_date,
                )
                .order_by(DailySnapshot.trade_date.desc())
                .limit(180)
            ).scalars().all()

            if not rows:
                return []

            f_curr = _build_fingerprint(curr_overview)
            scored: list[tuple[date, float, float, dict]] = []
            for row in rows:
                data = row.data or {}
                f = _build_fingerprint(data)
                cos = _cosine(f_curr, f)
                eu = _euclid(f_curr, f)
                scored.append((row.trade_date, cos, eu, data))

            max_eu = max(s[2] for s in scored) or 1.0
            sim_arr = [
                (td, 0.7 * cos + 0.3 * max(0.0, 1.0 - eu / max_eu), data)
                for td, cos, eu, data in scored
            ]
            sim_arr.sort(key=lambda x: -x[1])

            out: list[dict] = []
            for similar_td, sim, data in sim_arr[:top_k]:
                next_rows = session.execute(
                    select(DailySnapshot)
                    .where(
                        DailySnapshot.snapshot_type == "overview",
                        DailySnapshot.trade_date > similar_td,
                    )
                    .order_by(DailySnapshot.trade_date.asc())
                    .limit(3)
                ).scalars().all()

                next_3d = []
                for nr in next_rows:
                    nd = nr.data or {}
                    pct = (float(nd.get("yesterday_lu_up_rate", 0.5)) - 0.5) * 10.0
                    next_3d.append(round(pct, 1))
                while len(next_3d) < 3:
                    next_3d.append(0.0)

                out.append({
                    "trade_date": similar_td.isoformat(),
                    "similarity": round(max(0.0, min(1.0, sim)), 2),
                    "next_3d": next_3d,
                    "summary": _summarize_similar(data, next_3d),
                    "delta": _delta_features(curr_overview, data),
                })
            return out
    finally:
        engine.dispose()


async def _judge_similar_days(
    overview: dict,
    similar_days: list[dict],
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    """LLM 综合相似日 next_3d 走势 → 输出概率倾向 + 关键风险."""
    if not similar_days:
        return {
            "tilt": "震荡",
            "probability": 50,
            "key_risk": "样本不足无法判断",
            "note": "",
        }

    n = len(similar_days)
    cont_count = sum(1 for d in similar_days if sum(d.get("next_3d") or []) > 1.5)
    rev_count = sum(1 for d in similar_days if sum(d.get("next_3d") or []) < -1.5)
    osc_count = n - cont_count - rev_count

    fallback = {
        "tilt": "震荡",
        "probability": 50,
        "key_risk": "",
        "note": f"{n} 个相似日中 {cont_count} 个延续, {rev_count} 个反转, {osc_count} 个震荡.",
    }
    if cont_count >= 2:
        fallback["tilt"] = "延续"
        fallback["probability"] = int(round(cont_count / n * 100))
    elif rev_count >= 2:
        fallback["tilt"] = "反转"
        fallback["probability"] = int(round(rev_count / n * 100))
    else:
        fallback["probability"] = int(round(osc_count / n * 100))

    system = (
        "你是 A 股市场指纹分析专家。我会给你今日的市场指纹、最相似的历史交易日及其后 3 日表现。"
        "请综合判断: 今日大概率延续 / 反转 / 震荡, 给出概率 (整数 0-100), 一句关键风险, 一句简短补充。"
        "**严格 JSON, 不要 markdown fence**。"
    )
    payload = {
        "today": {k: overview.get(k) for k, _, _ in _FINGERPRINT_SPEC[:14]},
        "similar_days": [
            {
                "trade_date": d["trade_date"],
                "similarity": d["similarity"],
                "next_3d": d["next_3d"],
                "summary": d["summary"],
                "delta_top3": d.get("delta", []),
            }
            for d in similar_days
        ],
    }
    user = (
        f"```json\n{json.dumps(payload, ensure_ascii=False)}\n```\n\n"
        "请输出 JSON, schema:\n"
        "```json\n"
        "{\n"
        '  "tilt": "延续|反转|震荡",\n'
        '  "probability": 67,\n'
        '  "key_risk": "<=30字 关键风险点 (如: 高位炸板分歧/题材熄火)",\n'
        '  "note": "<=40字 补充说明 (今日与相似日最大不同/操作建议)"\n'
        "}\n```\n"
        "概率指你给该 tilt 倾向打的把握程度。"
    )

    try:
        out = await _call_llm(system, user, model_id)
    except Exception:
        return fallback
    if not isinstance(out, dict):
        return fallback

    valid_tilt = {"延续", "反转", "震荡"}
    tilt = out.get("tilt") if out.get("tilt") in valid_tilt else fallback["tilt"]
    try:
        prob = int(out.get("probability", fallback["probability"]))
        prob = max(0, min(100, prob))
    except Exception:
        prob = fallback["probability"]
    key_risk = (out.get("key_risk") or fallback["key_risk"] or "")[:60]
    note = (out.get("note") or fallback["note"] or "")[:80]
    return {"tilt": tilt, "probability": prob, "key_risk": key_risk, "note": note}


def _summarize_similar(data: dict, next_3d: list[float]) -> str:
    lu = int(data.get("limit_up_count", 0) or 0)
    mh = int(data.get("max_height", 0) or 0)
    bk = float(data.get("broken_rate", 0) or 0)
    if bk < 0.35:
        feel = "气氛偏强"
    elif bk > 0.55:
        feel = "分歧明显"
    else:
        feel = "情绪中性"

    sum_next = sum(next_3d) if next_3d else 0
    if sum_next > 1.5:
        after = "次日延续走强"
    elif sum_next < -1.5:
        after = "次日转弱"
    else:
        after = "次日震荡"
    return f"涨停 {lu}、最高 {mh} 板、{feel}，{after}"


def _derive_plan_pool(ladder: dict | None, hot_themes: set[str]) -> dict[str, list[dict]]:
    """从 ladder 派生 4 类候选池, 股票代码确定后 LLM 只填 trigger/risk."""
    stocks = _flatten_ladder_stocks(ladder)
    if not stocks:
        return {"promotion": [], "first_board": [], "reseal": [], "avoid": []}

    promotion = sorted(
        [s for s in stocks if s.get("board_level", 1) >= 3],
        key=lambda x: (x.get("board_level", 1), x.get("limit_order_amount", 0)),
        reverse=True,
    )[:3]

    first_board = sorted(
        [
            s for s in stocks
            if s.get("board_level", 1) == 1
            and any(t in hot_themes for t in (s.get("theme_names") or []))
        ],
        key=lambda x: x.get("limit_order_amount", 0),
        reverse=True,
    )[:3]
    if not first_board:
        first_board = sorted(
            [s for s in stocks if s.get("board_level", 1) == 1 and s.get("theme_names")],
            key=lambda x: x.get("limit_order_amount", 0),
            reverse=True,
        )[:3]

    reseal = sorted(
        [s for s in stocks if s.get("board_level", 1) in (1, 2) and s.get("open_count", 0) >= 1],
        key=lambda x: (x.get("limit_order_amount", 0), -x.get("open_count", 0)),
        reverse=True,
    )[:2]

    avoid = sorted(
        [s for s in stocks if s.get("board_level", 1) >= 4 and s.get("open_count", 0) >= 1],
        key=lambda x: (x.get("open_count", 0), x.get("board_level", 1)),
        reverse=True,
    )[:2]

    def _pack_promotion(s: dict) -> dict:
        return {
            "code": s.get("stock_code", ""),
            "name": s.get("stock_name", ""),
            "board": int(s.get("board_level", 1)),
            "trigger": "",
            "risk": "medium",
        }

    def _pack_first_board(s: dict) -> dict:
        themes = s.get("theme_names") or []
        theme = next((t for t in themes if t in hot_themes), themes[0] if themes else "")
        return {
            "code": s.get("stock_code", ""),
            "name": s.get("stock_name", ""),
            "theme": theme,
            "trigger": "",
            "risk": "low",
        }

    def _pack_reseal(s: dict) -> dict:
        return {
            "code": s.get("stock_code", ""),
            "name": s.get("stock_name", ""),
            "trigger": "",
            "risk": "medium",
        }

    def _pack_avoid(s: dict) -> dict:
        return {
            "code": s.get("stock_code", ""),
            "name": s.get("stock_name", ""),
            "reason": "",
        }

    return {
        "promotion": [_pack_promotion(s) for s in promotion],
        "first_board": [_pack_first_board(s) for s in first_board],
        "reseal": [_pack_reseal(s) for s in reseal],
        "avoid": [_pack_avoid(s) for s in avoid],
    }


def _derive_theme_trends(trade_date: date, theme_names: list[str], days: int = 5) -> dict[str, list[int]]:
    """查最近 N 个交易日 themes snapshot, 对每个 theme name 提取 z_t_num 序列.

    返回 {theme_name: [oldest, ..., newest]}, 长度可能不足 days (新题材).
    """
    if not theme_names:
        return {}
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    out: dict[str, list[int]] = {n: [] for n in theme_names}
    try:
        with Session(engine) as session:
            rows = session.execute(
                select(DailySnapshot)
                .where(
                    DailySnapshot.snapshot_type == "themes",
                    DailySnapshot.trade_date <= trade_date,
                )
                .order_by(DailySnapshot.trade_date.desc())
                .limit(days)
            ).scalars().all()
            ordered = list(reversed(rows))
            for row in ordered:
                top_list = (row.data or {}).get("top", []) or []
                name_to_zt = {t.get("name", ""): int(t.get("z_t_num", 0)) for t in top_list}
                for n in theme_names:
                    out[n].append(name_to_zt.get(n, 0))
    finally:
        engine.dispose()
    return out


def _heuristic_regime(overview: dict) -> tuple[str, str]:
    """LLM 失败时的兜底 regime 判断."""
    bk = overview.get("broken_rate", 0)
    mh = overview.get("max_height", 0)
    lu = overview.get("limit_up_count", 0)
    if mh >= 8:
        return "climax", "高潮日"
    if bk >= 0.5 and lu >= 50:
        return "diverge", "分歧日"
    if lu < 30:
        return "repair", "修复日"
    return "consensus", "共振日"


def _heuristic_tagline(overview: dict, regime_label: str) -> str:
    return (
        f"今日 A 股 {overview.get('limit_up_count', 0)} 只涨停，最高 {overview.get('max_height', 0)} 板，"
        f"炸板率 {overview.get('broken_rate', 0) * 100:.0f}%，{regime_label}格局。"
    )


def _build_llm_prompt(
    trade_date: str,
    overview: dict,
    main_lines: list[dict],
    leaders: list[dict],
    plan_pool: dict[str, list[dict]],
    theme_trends: dict[str, list[int]],
    cross_ctx: str = "",
) -> tuple[str, str]:
    """生成 (system, user) prompt. 要求 LLM 严格输出 JSON."""
    system = (
        "你是「复盘 AI 助手」，A 股超短线复盘专家。\n"
        "用户会给你今天的市场数据，请输出一份精炼的判断。\n\n"
        "**输出要求**：必须严格返回符合下述 schema 的 JSON 对象，不要任何额外文字、不要 markdown 代码块。\n"
        "**风格**：简洁、专业、有判断力，不模棱两可。\n"
        "**禁止**：编造未给出的数据；不得新增/修改输入中没有的股票代码；只能在我给的候选池里写 trigger 和 risk。\n"
        + NO_FLUFF_RULES
        + "\nJSON schema:\n"
        "{\n"
        '  "tagline": "一句话总结今日行情，<=30 字，体现核心判断",\n'
        '  "regime": "consensus|climax|diverge|repair",\n'
        '  "regime_label": "共振日|高潮日|分歧日|修复日",\n'
        '  "main_line_judgments": [\n'
        '    {"name": "题材名(与输入一致)", "ai_reason": "<=50字, 逻辑+位置+强弱", "status": "rising|peak|diverge|fading"}\n'
        "  ],\n"
        '  "leader_judgments": [\n'
        '    {"code": "股票代码(与输入一致)", "ai_grade": "S|A|B|C", "ai_summary": "<=60字, 高度+强弱+明日预期"}\n'
        "  ],\n"
        '  "plan_judgments": {\n'
        '    "promotion": [{"code": "(必须来自候选池)", "trigger": "<=40字 明日具体盘口触发条件", "risk": "low|medium|high"}],\n'
        '    "first_board": [{"code": "(必须来自候选池)", "trigger": "<=40字", "risk": "low|medium|high"}],\n'
        '    "reseal": [{"code": "(必须来自候选池)", "trigger": "<=40字", "risk": "low|medium|high"}],\n'
        '    "avoid": [{"code": "(必须来自候选池)", "reason": "<=40字 风险点"}]\n'
        "  },\n"
        '  "evidence": [\n'
        '    "1-3 条 ≤30 字 关键数字证据, 必须引用输入里的真实数字",\n'
        '    "示例: \'涨停 78, 最高 5 板, 炸板率 32%\'",\n'
        '    "示例: \'光模块 lu_5d [3,5,7,9,12], 主线确立\'"\n'
        "  ]\n"
        "}\n\n"
        "regime 判定原则：\n"
        "- 共振日(consensus): 涨停密集、炸板率低、赚钱效应高\n"
        "- 高潮日(climax): 最高板创周期新高、龙头大涨\n"
        "- 分歧日(diverge): 高位炸板批量、跟风票熄火\n"
        "- 修复日(repair): 缩量、低位首板增多、赚钱效应回升\n\n"
        "ai_grade: S=罕见龙头, A=典型龙头, B=标准龙头, C=偏弱\n\n"
        "trigger 写法示例: '9:30 高开 >3% 且 5 分钟内不破开盘价' / '9:45 前涨幅 >5% + 量比 >3'"
    )

    main_line_brief = [
        {
            "rank": ml["rank"],
            "name": ml["name"],
            "change_pct": ml["change_pct"],
            "limit_up_count": ml["limit_up_count"],
            "leader": ml["leader_name"],
            "lu_trend_5d": theme_trends.get(ml["name"], []),
        }
        for ml in main_lines
    ]
    leader_brief = [{"code": l["code"], "name": l["name"], "board": l["board"]} for l in leaders]

    pool_brief = {
        "promotion": [{"code": p["code"], "name": p["name"], "board": p["board"]} for p in plan_pool["promotion"]],
        "first_board": [{"code": p["code"], "name": p["name"], "theme": p["theme"]} for p in plan_pool["first_board"]],
        "reseal": [{"code": p["code"], "name": p["name"]} for p in plan_pool["reseal"]],
        "avoid": [{"code": p["code"], "name": p["name"]} for p in plan_pool["avoid"]],
    }

    user = (
        f"交易日：{trade_date}\n\n"
        f"市场概览：涨停 {overview.get('limit_up_count', 0)} / 跌停 {overview.get('limit_down_count', 0)}，"
        f"最高 {overview.get('max_height', 0)} 板，炸板率 {overview.get('broken_rate', 0) * 100:.1f}%，"
        f"成交额 {_fmt_amount(overview.get('total_amount', 0))}，"
        f"昨日涨停今日上涨率 {overview.get('yesterday_lu_up_rate', 0) * 100:.0f}%，"
        f"一字板 {overview.get('one_word_count', 0)} 只\n\n"
        f"主线题材(含近5日涨停数趋势 lu_trend_5d): {json.dumps(main_line_brief, ensure_ascii=False)}\n\n"
        f"高度龙头: {json.dumps(leader_brief, ensure_ascii=False)}\n\n"
        f"明日候选池(只能在这里选 code): {json.dumps(pool_brief, ensure_ascii=False)}\n"
        f"{cross_ctx}"
        "\n请输出 JSON。"
    )
    return system, user


def _strip_json_fence(s: str) -> str:
    """有些网关即使指定 JSON mode 仍包裹 ```json ... ``` 围栏, 这里剥掉."""
    s = s.strip()
    if s.startswith("```"):
        first_nl = s.find("\n")
        if first_nl != -1:
            s = s[first_nl + 1 :]
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
    return s.strip()


async def _call_llm(system: str, user: str, model_id: str) -> dict | None:
    """调 LLM, 返回解析后的 JSON dict; 任何异常返回 None."""
    client: AsyncOpenAI = _get_client()
    try:
        t0 = time.perf_counter()
        resp = await client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            max_tokens=1500,
            temperature=0.3,
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000
        content = _strip_json_fence(resp.choices[0].message.content or "")
        logger.info("ai_brief LLM ok model=%s elapsed=%.0fms tokens=%s", model_id, elapsed_ms, getattr(resp, "usage", None))
        return json.loads(content)
    except Exception as e:
        logger.warning("ai_brief LLM failed: %s", e)
        return None


def _merge_llm(brief: dict, llm_out: dict | None, overview: dict) -> dict:
    """把 LLM 输出 merge 进 deterministic brief; 缺字段时用兜底."""
    if not llm_out:
        regime, regime_label = _heuristic_regime(overview)
        brief["tagline"] = _heuristic_tagline(overview, regime_label)
        brief["regime"] = regime
        brief["regime_label"] = regime_label
        brief["evidence"] = [
            f"涨停 {overview.get('limit_up_count', 0)} / 跌停 {overview.get('limit_down_count', 0)}, 最高 {overview.get('max_height', 0)} 板",
            f"炸板率 {overview.get('broken_rate', 0) * 100:.0f}%, 昨涨停今涨率 {overview.get('yesterday_lu_up_rate', 0) * 100:.0f}%",
        ]
        return brief

    valid_regime = {"consensus", "climax", "diverge", "repair"}
    regime = llm_out.get("regime") if llm_out.get("regime") in valid_regime else None
    if not regime:
        regime, regime_label = _heuristic_regime(overview)
    else:
        regime_label = llm_out.get("regime_label") or {
            "consensus": "共振日", "climax": "高潮日", "diverge": "分歧日", "repair": "修复日",
        }[regime]
    brief["tagline"] = (llm_out.get("tagline") or _heuristic_tagline(overview, regime_label))[:60]
    brief["regime"] = regime
    brief["regime_label"] = regime_label

    valid_status = {"rising", "peak", "diverge", "fading"}
    name_to_judge = {
        j.get("name", ""): j for j in (llm_out.get("main_line_judgments") or []) if isinstance(j, dict)
    }
    for ml in brief["main_lines"]:
        j = name_to_judge.get(ml["name"])
        if j:
            ml["ai_reason"] = (j.get("ai_reason") or "")[:120]
            if j.get("status") in valid_status:
                ml["status"] = j["status"]

    valid_grade = {"S", "A", "B", "C"}
    code_to_judge = {
        j.get("code", ""): j for j in (llm_out.get("leader_judgments") or []) if isinstance(j, dict)
    }
    for ld in brief["leaders"]:
        j = code_to_judge.get(ld["code"])
        if j:
            if j.get("ai_grade") in valid_grade:
                ld["ai_grade"] = j["ai_grade"]
            ld["ai_summary"] = (j.get("ai_summary") or "")[:140]

    valid_risk = {"low", "medium", "high"}
    plan_judge = llm_out.get("plan_judgments") or {}
    plan = brief["tomorrow_plan"]

    def _idx_by_code(items: list[dict]) -> dict[str, dict]:
        return {(j.get("code") or ""): j for j in items if isinstance(j, dict)}

    for kind in ("promotion", "first_board", "reseal"):
        idx = _idx_by_code(plan_judge.get(kind) or [])
        for it in plan[kind]:
            j = idx.get(it["code"])
            if j:
                it["trigger"] = (j.get("trigger") or it["trigger"] or "")[:80]
                if j.get("risk") in valid_risk:
                    it["risk"] = j["risk"]

    avoid_idx = _idx_by_code(plan_judge.get("avoid") or [])
    for it in plan["avoid"]:
        j = avoid_idx.get(it["code"])
        if j:
            it["reason"] = (j.get("reason") or it["reason"] or "")[:80]

    evidence: list[str] = []
    for raw in (llm_out.get("evidence") or [])[:3]:
        s = (str(raw) if not isinstance(raw, str) else raw).strip()[:40]
        if s:
            evidence.append(s)
    if not evidence:
        evidence = [
            f"涨停 {overview.get('limit_up_count', 0)} / 跌停 {overview.get('limit_down_count', 0)}, 最高 {overview.get('max_height', 0)} 板",
            f"炸板率 {overview.get('broken_rate', 0) * 100:.0f}%, 昨涨停今涨率 {overview.get('yesterday_lu_up_rate', 0) * 100:.0f}%",
        ]
    brief["evidence"] = evidence

    return brief


async def generate_brief(
    trade_date: date | None,
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    """主入口: 加载 snapshot → 派生骨架 → 调 LLM 增强 → 返回完整 brief.

    若 trade_date 为 None, 自动取数据库最新有数据的交易日.
    若 snapshot 完全缺失, 返回带 empty_state 标记的 brief.
    """
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()

    snaps = _load_snapshots(trade_date)
    overview = snaps["overview"]

    base_brief: dict[str, Any] = {
        "trade_date": trade_date.isoformat(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "model": model_id,
        "tagline": "",
        "regime": "consensus",
        "regime_label": "共振日",
        "key_metrics": [],
        "main_lines": [],
        "leaders": [],
        "tomorrow_plan": {"promotion": [], "first_board": [], "reseal": [], "avoid": []},
        "similar_days": [],
        "similar_judgment": {"tilt": "震荡", "probability": 50, "key_risk": "", "note": ""},
        "evidence": [],
    }

    if not overview:
        regime, regime_label = "consensus", "无数据"
        base_brief["tagline"] = f"{trade_date.isoformat()} 暂无市场数据，请先运行数据管线"
        base_brief["regime_label"] = regime_label
        return base_brief

    prev_overview = _load_prev_overview(trade_date)
    base_brief["key_metrics"] = _derive_key_metrics(overview, prev_overview)
    base_brief["main_lines"] = _derive_main_lines(snaps["themes"], snaps["ladder"], top_n=3)
    base_brief["leaders"] = _derive_leaders(snaps["ladder"], max_n=4)

    theme_names = [ml["name"] for ml in base_brief["main_lines"]]
    theme_trends = _derive_theme_trends(trade_date, theme_names, days=5)
    for ml in base_brief["main_lines"]:
        ml["recent_lu_counts"] = theme_trends.get(ml["name"], [])

    hot_themes = {
        t.get("name", "")
        for t in ((snaps["themes"] or {}).get("top", []) or [])[:5]
        if t.get("name")
    }
    plan_pool = _derive_plan_pool(snaps["ladder"], hot_themes)
    base_brief["tomorrow_plan"] = plan_pool

    similar_days = _find_similar_days(overview, trade_date, top_k=3)
    base_brief["similar_days"] = similar_days

    similar_judgment = await _judge_similar_days(overview, similar_days, model_id=model_id)
    base_brief["similar_judgment"] = similar_judgment

    cross_ctx = build_cross_context_block(
        trade_date,
        model_id,
        include_sentiment=True,
        include_theme=True,
        include_ladder=True,
    )
    system, user = _build_llm_prompt(
        trade_date.isoformat(),
        overview,
        base_brief["main_lines"],
        base_brief["leaders"],
        plan_pool,
        theme_trends,
        cross_ctx,
    )
    llm_out = await _call_llm(system, user, model_id)
    return _merge_llm(base_brief, llm_out, overview)
