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


# === P3-2 跨模块 AI 副驾人设 (current_view → persona) ===
#
# 用户在不同页面问 AI, 默认上下文 / 关注重点是不一样的:
# - 在「计划」里问 "这个怎么样" → 是在问计划合理性, 不是在问个股基本面
# - 在「龙虎榜」里问 "怎么看" → 是在问游资动向, 不是在问技术面
# 通过 persona 让 AI 自动聚焦, 减少用户反复说"我现在看的是 XX 页面"的成本.
#
# 注: 模块 key 必须与前端 NavModule 完全一致 (见 ui-store.ts).

CHAT_PERSONAS: dict[str, str] = {
    "today": (
        "用户当前在「今日复盘」页. AI 已经写好了今日定调 / 主线 / 龙头 / 明日候选池, "
        "用户基本看过了, 不要再复述卡片内容. 重点回答 (a) 用户对 AI 结论的质疑, "
        "(b) 用今日盘口数据交叉验证, (c) 给出用户没看到的细节."
    ),
    "sentiment": (
        "用户当前在「大盘情绪」页. 默认问题都是关于情绪周期定位 / 阶段切换 / 主线强弱. "
        "回答必须落到具体阶段 (启动/共振/分歧/退潮) 和数字, 禁止 '总体平稳' '谨慎乐观' 等套话."
    ),
    "ladder": (
        "用户当前在「连板天梯」页. 默认问题都是关于高度梯队健康度 / 龙头定位 / 接力风险. "
        "回答必须直接报具体票名 / 板数 / 是否首板 / 龙头 vs 跟风, 给可执行动作."
    ),
    "themes": (
        "用户当前在「题材追踪」页. 默认问题都是关于题材主升 / 退潮 / 新题材机会. "
        "回答必须落到具体题材名 + 龙头票 + 阶段判断 + 是否还能上车."
    ),
    "capital": (
        "用户当前在「资金风向标」页. 默认问题都是关于北向 / 主力 / 行业资金净流入. "
        "回答必须给具体方向 + 金额 + 是否持续, 禁止 '资金有所流入' 等模糊表达."
    ),
    "lhb": (
        "用户当前在「龙虎榜分析」页. 默认问题都是关于游资动向 / 营业部抱团 / 接力概率. "
        "回答必须直接报营业部名 + 买卖额 + 是哪一路游资 + 接下来概率."
    ),
    "search": (
        "用户当前在「个股检索」页. 用户提到 '这只' '这个票' 默认指他刚搜的标的. "
        "回答覆盖基本面 / 题材归属 / 近期资金 / 风险点, 直接给买卖建议."
    ),
    "news": (
        "用户当前在「财联社要闻」页. 默认问题都是关于新闻对哪些板块/标的有影响. "
        "回答必须明确受益板块和标的, 并判断是否过度炒作 / 短期博弈 / 中长期布局."
    ),
    "watchlist": (
        "用户当前在「我的自选」页. 任何问题默认范围限定在用户自选股内. "
        "主动提示自选股中今日表现最强 / 最弱 / 触发了用户计划的标的, "
        "用 '你的 XX' 而不是 '该股'."
    ),
    "plans": (
        "用户当前在「我的计划」页. 默认问题都是关于用户写的交易计划. "
        "重点帮用户审核计划合理性: 触发条件是否过紧或过松, 仓位是否过大, 止损是否合理, "
        "已触发的计划是否需要执行 / 撤销 / 改条件. 不要只复述, 必须给优化建议."
    ),
    "ai_track": (
        "用户当前在「AI 战绩」页. 默认问题都是关于 AI 历史预测准确率. "
        "回答必须诚实承认 AI 的失败案例, 给出哪些场景准 / 哪些场景不准的总结, "
        "不要只夸 AI, 要帮用户校准对 AI 的信任度."
    ),
    "my_review": (
        "用户当前在「我的复盘」(个人交易记录) 页. 默认问题都是关于用户实际交易. "
        "重点帮用户找规律 / 找漏洞 / 给改进点, 不要客套, 直接指出过早卖飞 / 追高 / 不止损等问题. "
        "回答以 '你' 为主语."
    ),
    "account": (
        "用户当前在「账户套餐」页. 默认问题都是关于账户 / 计费 / 额度. 简短回答, 不要扯大盘."
    ),
}

DEFAULT_PERSONA = (
    "默认聚焦回答, 不知道用户上下文时, 先确认 '你说的是 XX 吗' 再展开."
)


def get_chat_persona(current_view: str | None) -> str:
    """根据当前页面返回 AI 副驾的 persona 提示串.

    返回的字符串可直接拼到 system prompt 末尾.
    """
    if not current_view:
        return DEFAULT_PERSONA
    return CHAT_PERSONAS.get(current_view, DEFAULT_PERSONA)


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
