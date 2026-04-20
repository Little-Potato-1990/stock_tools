"""跨 brief 上下文工具 (P2-1).

设计原则:
- 软读 PG 缓存里其他 brief 的结论, 不存在就跳过 (绝不阻塞调 LLM)
- 只取关键判定字段, 拼成 50-100 字的 hint, 注入到 user prompt
- 调用方在 _build_prompt 之前调用, 把返回串拼到上下文区
- 不引入循环依赖: 每个 brief 只引上游 brief 的输出, 不引下游

依赖图 (调用 → 被调用):
    theme   ← sentiment
    ladder  ← sentiment, theme
    lhb     ← theme, ladder
    brief   ← sentiment, theme, ladder  (综合 brief)
"""

from __future__ import annotations

import logging
from datetime import date

from app.ai.brief_cache import pg_get

logger = logging.getLogger(__name__)


def _safe_pg_get(key: str) -> dict | None:
    """同 pg_get, 但任何异常都吃掉返回 None — 跨上下文软读, 不影响主流程."""
    try:
        return pg_get(key)
    except Exception as exc:
        logger.debug("cross_context pg_get failed: %s — %s", key, exc)
        return None


def get_sentiment_hint(trade_date: date, model_id: str = "deepseek-v3") -> str:
    """大盘情绪定调一行 (空字符串表示无上游 brief)."""
    cached = _safe_pg_get(f"sentiment_brief:{trade_date.isoformat()}:{model_id}")
    if not cached:
        return ""
    phase_label = (cached.get("phase_label") or "").strip()
    judgment = (cached.get("judgment") or "").strip()
    if not phase_label and not judgment:
        return ""
    parts = []
    if phase_label:
        parts.append(f"大盘阶段: **{phase_label}**")
    if judgment:
        # 截断, 避免上游 judgment 占太多 token
        parts.append(judgment[:50])
    return " · ".join(parts)


def get_theme_hint(trade_date: date, model_id: str = "deepseek-v3") -> str:
    """题材主线 + 退潮一行."""
    cached = _safe_pg_get(f"theme_brief:{trade_date.isoformat()}:{model_id}")
    if not cached:
        return ""
    leading = [it.get("name") for it in (cached.get("leading") or []) if it.get("name")]
    fading = [it.get("name") for it in (cached.get("fading") or []) if it.get("name")]
    next_bet = (cached.get("next_bet") or {}).get("name", "")
    parts: list[str] = []
    if leading:
        parts.append(f"主线题材: **{'/'.join(leading[:3])}**")
    if fading:
        parts.append(f"退潮题材: {'/'.join(fading[:2])}")
    if next_bet:
        parts.append(f"明日重点: {next_bet}")
    return " · ".join(parts)


def get_ladder_hint(trade_date: date, model_id: str = "deepseek-v3") -> str:
    """板梯关键龙头一行."""
    cached = _safe_pg_get(f"ladder_brief:{trade_date.isoformat()}:{model_id}")
    if not cached:
        return ""
    headline = (cached.get("headline") or "").strip()
    key_stocks = cached.get("key_stocks") or []
    parts: list[str] = []
    if headline:
        parts.append(headline[:60])
    if key_stocks:
        # 优先列高度龙头/主线龙头/空间股
        top = []
        for s in key_stocks[:3]:
            name = s.get("name", "")
            board = s.get("board", "")
            tag = s.get("tag", "")
            if name and board:
                top.append(f"{tag}{name}({board}板)")
        if top:
            parts.append("核心: " + ", ".join(top))
    return " · ".join(parts)


def build_cross_context_block(
    trade_date: date,
    model_id: str = "deepseek-v3",
    *,
    include_sentiment: bool = False,
    include_theme: bool = False,
    include_ladder: bool = False,
) -> str:
    """生成跨 brief 上下文 markdown 段, 注入到 user prompt.

    返回为空 (所有上游都未命中缓存) 时, 返回空串, 让 prompt 退化为单 brief 模式.
    """
    lines: list[str] = []
    if include_sentiment:
        h = get_sentiment_hint(trade_date, model_id)
        if h:
            lines.append(f"- {h}")
    if include_theme:
        h = get_theme_hint(trade_date, model_id)
        if h:
            lines.append(f"- {h}")
    if include_ladder:
        h = get_ladder_hint(trade_date, model_id)
        if h:
            lines.append(f"- {h}")

    if not lines:
        return ""

    return (
        "\n## 上游 AI 判定 (作为参考, 你的判断要与之呼应或明确反驳, 不要无视)\n"
        + "\n".join(lines)
        + "\n"
    )


# === P2-2 通用反套话约束: 所有 brief system prompt 复用 ===

NO_FLUFF_RULES = (
    "\n\n**禁止套话清单 (出现即视为低质输出)**:\n"
    "- 谨慎乐观 / 总体平稳 / 多空分歧 / 有待观察 / 短期承压 / 整体表现一般\n"
    "- 任何不带具体数字、阶段、票名、题材名的判断\n"
    "- 模糊的对策, 如 '关注' / '留意' / '注意风险' (要给数字或动作)\n\n"
    "**正例 vs 反例**:\n"
    "✓ '高度断在 5 板, 主线光模块 4 只接力'\n"
    "✗ '今日高度有所收缩, 题材表现一般'\n"
    "✓ '仓位降至 5 成, 只做中军和补涨, 破位即出'\n"
    "✗ '建议谨慎操作, 控制仓位'\n"
)
