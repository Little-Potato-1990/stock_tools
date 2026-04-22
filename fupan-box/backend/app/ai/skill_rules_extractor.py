"""把投资体系自由文本抽成可执行的 derived_rules JSON。

严格因子白名单——LLM 只能用 ALLOWED_FACTORS 里的字段，碰到清单外的诉求
（如 MACD 金叉、缠论中枢、机构席位）一律放进 unsupported_mentions，
绝不编造字段，避免误导用户。
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any

from openai import AsyncOpenAI

from app.config import get_settings

logger = logging.getLogger(__name__)


# === v1 因子白名单 ===
# filters: 硬过滤，全部下推到 SQL；不满足直接排除
# scorers: 软评分，加权求总分用于排序
ALLOWED_FILTER_FACTORS: dict[str, dict[str, str]] = {
    # 估值类
    "pe_ttm_max":            {"type": "number", "desc": "PE-TTM 上限", "src": "stock_valuation_daily"},
    "pe_ttm_min":            {"type": "number", "desc": "PE-TTM 下限", "src": "stock_valuation_daily"},
    "pb_max":                {"type": "number", "desc": "PB 上限",     "src": "stock_valuation_daily"},
    "pb_min":                {"type": "number", "desc": "PB 下限",     "src": "stock_valuation_daily"},
    "pe_ttm_pct_5y_max":     {"type": "number", "desc": "PE 5年分位上限(0-100)", "src": "stock_valuation_daily"},
    "pe_ttm_pct_5y_min":     {"type": "number", "desc": "PE 5年分位下限(0-100)", "src": "stock_valuation_daily"},
    "dividend_yield_min":    {"type": "number", "desc": "股息率下限(%)", "src": "stock_valuation_daily"},
    # 财务类（取最新一期季报）
    "roe_latest_min":        {"type": "number", "desc": "最新单季 ROE 下限(%)", "src": "stock_fundamentals_quarterly"},
    "roe_3y_avg_min":        {"type": "number", "desc": "近3年 ROE 均值下限(%)", "src": "stock_fundamentals_quarterly"},
    "net_profit_yoy_min":    {"type": "number", "desc": "净利润同比增速下限(%)", "src": "stock_fundamentals_quarterly"},
    "revenue_yoy_min":       {"type": "number", "desc": "营收同比增速下限(%)", "src": "stock_fundamentals_quarterly"},
    # 规模类
    "market_cap_yi_min":     {"type": "number", "desc": "总市值下限(亿元)", "src": "stock_valuation_daily"},
    "market_cap_yi_max":     {"type": "number", "desc": "总市值上限(亿元)", "src": "stock_valuation_daily"},
    # 分类
    "industry_in":           {"type": "list[str]", "desc": "只看这些行业",  "src": "industry_stocks"},
    "industry_not_in":       {"type": "list[str]", "desc": "排除这些行业",  "src": "industry_stocks"},
    "theme_in":              {"type": "list[str]", "desc": "只看这些题材",  "src": "theme_stocks"},
    "theme_not_in":          {"type": "list[str]", "desc": "排除这些题材",  "src": "theme_stocks"},
    "exclude_st":            {"type": "bool",      "desc": "排除 ST/退市股", "src": "stocks"},
    # 状态
    "exclude_limit_up_today":          {"type": "bool", "desc": "排除当日涨停",  "src": "daily_quotes"},
    "exclude_recent_continuous_limit_up": {"type": "bool", "desc": "排除近期连板", "src": "limit_up_records"},
    # 技术（现算）
    "above_ma60":            {"type": "bool",   "desc": "收盘价站上 60 日均线", "src": "daily_quotes"},
    "ma_bull_arrangement":   {"type": "bool",   "desc": "均线多头排列(MA20>MA60>MA250)", "src": "daily_quotes"},
    "break_n_day_high":      {"type": "number", "desc": "近 N 日新高(填 N)", "src": "daily_quotes"},
    "pullback_to_ma20":      {"type": "bool",   "desc": "回踩 MA20",      "src": "daily_quotes"},
    "recent_n_day_pct_min":  {"type": "object", "desc": '{"n":20,"min":-5}', "src": "daily_quotes"},
    "recent_n_day_pct_max":  {"type": "object", "desc": '{"n":20,"max":30}', "src": "daily_quotes"},
}

ALLOWED_SCORER_FACTORS: dict[str, str] = {
    "low_pe_in_industry":     "行业内 PE 越低越加分",
    "low_pb_in_industry":     "行业内 PB 越低越加分",
    "low_pe_pct_5y":          "PE 5年分位越低越加分",
    "high_dividend_yield":    "股息率越高越加分",
    "high_roe":               "ROE 越高越加分",
    "rising_revenue_3y":      "近3年营收持续增长加分",
    "rising_profit_3y":       "近3年净利润持续增长加分",
    "high_market_cap":        "大市值加分（蓝筹偏好）",
    "low_market_cap":         "小市值加分（小盘偏好）",
    "ma_bull_arrangement":    "均线多头排列加分",
    "above_ma60":             "站上 60 日线加分",
    "near_ma20_pullback":     "回踩 MA20 形态加分",
    "recent_breakout":        "近 60 日突破新高加分",
}


_SYSTEM_PROMPT_TEMPLATE = """你是一个体系规则抽取器。用户写了一段投资体系自由文本，
请你把它翻译成可执行的 derived_rules JSON 供量化筛选器使用。

【硬性约束】
1. **只能用下面的字段**，**不在清单里的字段一律忽略**，并把用户提到但你做不到的诉求记入 unsupported_mentions。
2. 数值要给具体数字，不要写"较高""较低"。如果用户没给具体数值，按常识取一个合理默认（例如"低估值"→ pe_ttm_max=25）。
3. 如果用户没说排除 ST，默认 exclude_st=true。
4. 如果用户没说选股范围，scan_universe_default 给 "hs300"；明说全市场则给 "all"。
5. top_n_suggested 默认 30。

【可用 filters（硬过滤）】
{filters_section}

【可用 scorers（软评分，weight 取 1-3 整数）】
{scorers_section}

【输出格式】严格 JSON，不要 markdown 代码块：
{{
  "filters": {{ "field": value, ... }},
  "scorers": [ {{ "factor": "xxx", "weight": 2 }}, ... ],
  "scan_universe_default": "hs300" | "all" | "industry:xxx" | "theme:xxx" | "watchlist",
  "top_n_suggested": 30,
  "unsupported_mentions": ["MACD金叉", "..."]
}}

如果用户体系完全无法翻译成任何可执行规则（例如纯哲学），返回：
{{"filters": {{}}, "scorers": [], "scan_universe_default": "hs300", "top_n_suggested": 30, "unsupported_mentions": ["体系过于抽象，无可执行规则"]}}
"""


def _build_system_prompt() -> str:
    filters_lines = "\n".join(
        f"- {k} ({v['type']}): {v['desc']}"
        for k, v in ALLOWED_FILTER_FACTORS.items()
    )
    scorers_lines = "\n".join(f"- {k}: {desc}" for k, desc in ALLOWED_SCORER_FACTORS.items())
    return _SYSTEM_PROMPT_TEMPLATE.format(
        filters_section=filters_lines, scorers_section=scorers_lines
    )


def _client() -> AsyncOpenAI:
    s = get_settings()
    return AsyncOpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url)


def _safe_parse_json(text: str) -> dict | None:
    if not text:
        return None
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(json)?\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    try:
        return json.loads(text)
    except Exception as e:
        logger.warning("rules extract: bad json: %s ; text head=%s", e, text[:200])
        return None


def _sanitize_filters(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in raw.items():
        if k not in ALLOWED_FILTER_FACTORS:
            continue
        spec = ALLOWED_FILTER_FACTORS[k]
        t = spec["type"]
        if t == "number":
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                continue
        elif t == "bool":
            if isinstance(v, bool):
                out[k] = v
            elif isinstance(v, (int, float)):
                out[k] = bool(v)
            elif isinstance(v, str):
                out[k] = v.strip().lower() in ("1", "true", "yes", "y", "是")
        elif t == "list[str]":
            if isinstance(v, list):
                out[k] = [str(x).strip() for x in v if str(x).strip()]
            elif isinstance(v, str):
                out[k] = [s.strip() for s in v.split(",") if s.strip()]
        elif t == "object":
            if isinstance(v, dict):
                out[k] = v
    return out


def _sanitize_scorers(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        f = (item.get("factor") or "").strip()
        if f not in ALLOWED_SCORER_FACTORS or f in seen:
            continue
        seen.add(f)
        try:
            w = int(item.get("weight", 1))
        except (TypeError, ValueError):
            w = 1
        w = max(1, min(3, w))
        out.append({"factor": f, "weight": w})
    return out


def _sanitize_universe(raw: Any) -> str:
    if not isinstance(raw, str):
        return "hs300"
    raw = raw.strip()
    if raw in ("all", "hs300", "watchlist"):
        return raw
    if raw.startswith("industry:") or raw.startswith("theme:"):
        return raw
    return "hs300"


def _sanitize_unsupported(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out = []
    seen: set[str] = set()
    for item in raw:
        s = str(item).strip()
        if s and s not in seen:
            seen.add(s)
            out.append(s[:50])
        if len(out) >= 20:
            break
    return out


def _build_empty_rules(reason: str = "") -> dict[str, Any]:
    return {
        "filters": {},
        "scorers": [],
        "scan_universe_default": "hs300",
        "top_n_suggested": 30,
        "unsupported_mentions": [reason] if reason else [],
        "extracted_at": datetime.utcnow().isoformat() + "Z",
    }


async def extract_derived_rules(body_markdown: str, model: str | None = None) -> dict[str, Any]:
    """从体系正文抽取 derived_rules。失败时返回空规则壳。"""
    body = (body_markdown or "").strip()
    if not body:
        return _build_empty_rules("正文为空")

    if len(body) > 4000:
        body = body[:4000] + "\n... (已截断)"

    s = get_settings()
    model_id = model or s.openai_model or "gpt-4o-mini"
    client = _client()

    try:
        resp = await client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": _build_system_prompt()},
                {"role": "user", "content": f"投资体系正文:\n{body}"},
            ],
            temperature=0.1,
            max_tokens=1500,
        )
        text = resp.choices[0].message.content if resp.choices else ""
    except Exception as e:
        logger.warning("extract_derived_rules LLM call failed: %s", e)
        return _build_empty_rules(f"LLM 调用失败: {e}")

    raw = _safe_parse_json(text or "")
    if not raw:
        return _build_empty_rules("LLM 输出非 JSON")

    rules = {
        "filters": _sanitize_filters(raw.get("filters")),
        "scorers": _sanitize_scorers(raw.get("scorers")),
        "scan_universe_default": _sanitize_universe(raw.get("scan_universe_default")),
        "top_n_suggested": max(5, min(100, int(raw.get("top_n_suggested") or 30))),
        "unsupported_mentions": _sanitize_unsupported(raw.get("unsupported_mentions")),
        "extracted_at": datetime.utcnow().isoformat() + "Z",
    }

    if rules["filters"].get("exclude_st") is None:
        rules["filters"]["exclude_st"] = True

    return rules


def get_factor_catalog() -> dict[str, Any]:
    """暴露给前端：因子白名单，用于"派生规则可视化校对"面板。"""
    return {
        "filters": {
            k: {**v} for k, v in ALLOWED_FILTER_FACTORS.items()
        },
        "scorers": dict(ALLOWED_SCORER_FACTORS),
    }
