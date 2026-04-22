"""体系完整性检查（completeness lint）。

用 cheap model 单次扫一遍用户写的体系自由文本，输出「哪些关键点没说清」
的 warning chip 列表。**不阻塞保存**，仅作为编辑器侧的提示。
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from openai import AsyncOpenAI

from app.config import get_settings

logger = logging.getLogger(__name__)


# 关键点清单——LLM 严格按这些 key 判断
_CHECK_KEYS: list[dict[str, str]] = [
    {"key": "core_thesis", "label": "核心理念", "desc": "整体投资哲学/赚什么钱"},
    {"key": "horizon", "label": "持仓周期", "desc": "短线/波段/长线，大致几天~几年"},
    {"key": "universe", "label": "选股范围", "desc": "大盘/小盘/行业/市值区间等"},
    {"key": "buy_signal", "label": "买入信号", "desc": "什么情况下出手"},
    {"key": "sell_signal", "label": "卖出/止盈", "desc": "什么情况下卖"},
    {"key": "stop_loss", "label": "止损规则", "desc": "止损线或止损条件"},
    {"key": "position", "label": "仓位与风控", "desc": "单股仓位/总仓位/分批等"},
    {"key": "avoid", "label": "必避场景", "desc": "什么情况坚决不碰"},
]


_SYSTEM_PROMPT = (
    "你是一个体系审稿助手。用户提交了一段投资体系（自由文本），"
    "请你逐条检查关键点是否说清楚。\n"
    "你只负责判断「是否说清」，不评价好坏，不提建议。\n"
    "**输出严格 JSON**，schema:\n"
    '  {"warnings": [{"key": "stop_loss", "msg": "未明说止损规则"}, ...]}\n'
    "- key 只能取自下方清单。\n"
    "- 同一 key 最多出现一次。\n"
    "- 已经说清楚的 key 不出现。\n"
    "- msg 中文，不超过 25 字，直接说「未明说 X」或「X 不够具体」。\n"
    "- 如果全说清了，返回 {\"warnings\": []}。\n"
    "- 不要输出 JSON 之外任何字符（不要 markdown 代码块）。"
)


def _client() -> AsyncOpenAI:
    s = get_settings()
    return AsyncOpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url)


def _build_user_prompt(body_markdown: str) -> str:
    keys_section = "\n".join(
        f"- {c['key']}: {c['label']} - {c['desc']}" for c in _CHECK_KEYS
    )
    body = (body_markdown or "").strip()
    if len(body) > 4000:
        body = body[:4000] + "\n... (已截断)"
    return (
        "关键点清单:\n"
        f"{keys_section}\n\n"
        "投资体系正文:\n"
        f"```markdown\n{body}\n```"
    )


def _safe_parse_json(text: str) -> dict | None:
    if not text:
        return None
    text = text.strip()
    # 兜底剥 ```json ... ``` 标记
    if text.startswith("```"):
        text = re.sub(r"^```(json)?\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    try:
        return json.loads(text)
    except Exception as e:
        logger.warning("skill lint: bad json: %s", e)
        return None


def _filter_warnings(raw: dict | None) -> list[dict[str, str]]:
    if not isinstance(raw, dict):
        return []
    warnings = raw.get("warnings")
    if not isinstance(warnings, list):
        return []
    valid_keys = {c["key"] for c in _CHECK_KEYS}
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for w in warnings:
        if not isinstance(w, dict):
            continue
        k = (w.get("key") or "").strip()
        m = (w.get("msg") or "").strip()
        if k not in valid_keys or k in seen or not m:
            continue
        seen.add(k)
        out.append({"key": k, "msg": m[:30]})
    return out


async def lint_skill_completeness(body_markdown: str, model: str | None = None) -> list[dict[str, str]]:
    """跑一次 completeness check，返回 warning 列表。失败时返回 []（不阻塞保存）。"""
    body = (body_markdown or "").strip()
    if not body:
        return [{"key": c["key"], "msg": f"未明说{c['label']}"} for c in _CHECK_KEYS]

    s = get_settings()
    model_id = model or s.news_tag_model or s.openai_model or "gpt-4o-mini"

    client = _client()
    try:
        resp = await client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(body)},
            ],
            temperature=0.1,
            max_tokens=600,
        )
        text = resp.choices[0].message.content if resp.choices else ""
    except Exception as e:
        logger.warning("skill lint LLM call failed: %s", e)
        return []

    parsed = _safe_parse_json(text or "")
    return _filter_warnings(parsed)


def get_check_keys() -> list[dict[str, str]]:
    """暴露给 API 让前端展示「我们到底检查哪几项」。"""
    return list(_CHECK_KEYS)
