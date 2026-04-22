"""统一「激活投资体系（Skill）」抽象。

skill_ref 编码格式：
  - 'system:<slug>'  系统预设体系，正文取自 content/methodology/system-*.md
  - 'user:<id>'      用户自建 UserSkill
  - None / ''        中立模式（不挂体系）

resolve 优先级：override > UserSettings.active_skill_ref > None。
render_skill_system_block 把激活体系拼成一段固定结构的 system prompt 段，
供 llm_service / watchlist_brief / multi_perspective 等入口注入。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ActiveSkill:
    ref: str                     # 标准化 ref 字符串
    source: str                  # 'system' | 'user'
    name: str
    body_markdown: str
    derived_rules: dict | None = None  # 仅用户自建可能有；系统预设也可以预抽缓存
    icon: str | None = None
    skill_id_for_log: str | int | None = None  # 用于配额/审计


def _parse_ref(ref: str | None) -> tuple[str, str] | None:
    """返回 (source, key) 或 None。"""
    if not ref:
        return None
    ref = ref.strip()
    if not ref or ref.lower() in ("none", "null", "neutral"):
        return None
    if ":" not in ref:
        return None
    source, _, key = ref.partition(":")
    source = source.strip().lower()
    key = key.strip()
    if source not in ("system", "user") or not key:
        return None
    return source, key


def _load_system_skill(slug: str) -> ActiveSkill | None:
    """从方法论库加载系统预设体系（kind=system 的 markdown）。"""
    try:
        from app.methodology.loader import get_article, SYSTEM_META
    except Exception as e:
        logger.warning("methodology loader unavailable: %s", e)
        return None

    art = get_article(slug)
    if not art or art.kind != "system":
        return None

    meta = SYSTEM_META.get(art.system_key or art.slug, {})
    name = meta.get("label") or art.title or slug
    return ActiveSkill(
        ref=f"system:{slug}",
        source="system",
        name=name,
        body_markdown=art.content or art.summary or "",
        derived_rules=None,
        icon=None,
        skill_id_for_log=slug,
    )


async def _aload_user_skill(db, user_id: int, skill_id_str: str) -> ActiveSkill | None:
    """AsyncSession 版的用户体系加载。"""
    try:
        skill_id = int(skill_id_str)
    except (TypeError, ValueError):
        return None

    from app.models.user import UserSkill

    row = await db.get(UserSkill, skill_id)
    if not row or row.user_id != user_id or row.is_archived:
        return None

    return ActiveSkill(
        ref=f"user:{row.id}",
        source="user",
        name=row.name or row.slug,
        body_markdown=row.body_markdown or "",
        derived_rules=row.derived_rules,
        icon=row.icon,
        skill_id_for_log=row.id,
    )


async def aresolve_active_skill_for_user(
    db,                       # AsyncSession
    user_id: int | None,
    override_ref: str | None,
) -> ActiveSkill | None:
    """AsyncSession 入口：自动从 UserSettings 取默认 skill_ref。"""
    raw_override = (override_ref or "").strip()
    if raw_override.lower() in ("none", "null", "neutral"):
        return None

    settings_ref = None
    if user_id is not None:
        try:
            from app.models.user import UserSettings
            from sqlalchemy import select

            res = await db.execute(
                select(UserSettings).where(UserSettings.user_id == user_id)
            )
            row = res.scalar_one_or_none()
            if row:
                settings_ref = row.active_skill_ref
        except Exception as e:
            logger.warning("aload user_settings failed: %s", e)

    parsed = _parse_ref(raw_override) or _parse_ref(settings_ref)
    if not parsed:
        return None

    source, key = parsed
    if source == "system":
        return _load_system_skill(key)
    if source == "user":
        if user_id is None:
            return None
        return await _aload_user_skill(db, user_id, key)
    return None


def render_skill_system_block(skill: ActiveSkill | None) -> str:
    """把激活体系渲染成 system prompt 段。中立模式返回空串。"""
    if not skill or not (skill.body_markdown or "").strip():
        return ""

    body = skill.body_markdown.strip()
    if len(body) > 4000:
        body = body[:4000] + "\n... (体系正文超长已截断)"

    src_label = "用户自建" if skill.source == "user" else "系统预设"
    name = skill.name or "未命名体系"

    rules_hint = ""
    if skill.derived_rules:
        try:
            import json
            rules_compact = json.dumps(
                skill.derived_rules, ensure_ascii=False, separators=(",", ":")
            )
            if len(rules_compact) > 1500:
                rules_compact = rules_compact[:1500] + "..."
            rules_hint = (
                "\n\n[派生执行规则供你参考，不必逐条引用]\n" + rules_compact
            )
        except Exception:
            pass

    return (
        "\n\n---\n"
        f"【激活的投资体系: {name}】(来源: {src_label})\n"
        "用户的体系描述如下，请你严格遵循其立场、周期、买卖逻辑与风控；"
        "你给出的所有判断都应基于该体系而非中立大盘观点。\n"
        f"\n{body}\n"
        f"{rules_hint}"
        "\n\n[体系视角元规则]\n"
        f"- 输出的第一行必须用【{name}视角】作为标记。\n"
        "- 当用户体系未明说某关键点（例如止损、仓位、选股范围）时，"
        "请明确指出『按你的体系，这里没说清，我按 X 处理』，不要冒充体系作者。\n"
        "- 不要弱化体系立场以追求所谓「中立」，用户已主动选择该体系。\n"
        "---\n"
    )
