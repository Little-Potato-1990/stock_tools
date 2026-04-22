"""投资体系 (Skill) API.

路由清单:
  GET    /api/skills/options        当前用户可挂载的全部体系 (系统预设 + 用户自建)
  GET    /api/skills/active         当前激活体系 (从 UserSettings 取)
  PUT    /api/skills/active         设置默认激活体系 (写 UserSettings.active_skill_ref)

  GET    /api/skills/user           我的体系列表
  POST   /api/skills/user           新建 (异步 lint + extract_rules)
  GET    /api/skills/user/{id}      详情
  PUT    /api/skills/user/{id}      更新 body / name (改了 body 重新 lint+extract)
  PATCH  /api/skills/user/{id}/rules  手工校对 derived_rules (rules_user_edited=true)
  POST   /api/skills/user/{id}/lint    强制重跑 completeness check
  POST   /api/skills/user/{id}/extract 强制基于 body 重抽 derived_rules (会覆盖手工修改)
  DELETE /api/skills/user/{id}      软删除 (is_archived=true)

  GET    /api/skills/catalog        因子白名单 + lint 检查清单 (前端编辑器用)
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.database import get_db
from app.models.user import User, UserSettings, UserSkill
from app.ai.skill_lint import get_check_keys, lint_skill_completeness
from app.ai.skill_rules_extractor import (
    ALLOWED_FILTER_FACTORS,
    ALLOWED_SCORER_FACTORS,
    extract_derived_rules,
    get_factor_catalog,
)
from app.methodology.loader import SYSTEM_META, list_systems

logger = logging.getLogger(__name__)
router = APIRouter()


# =============== Pydantic schemas ===============


class ActiveRefRequest(BaseModel):
    ref: str | None = None  # None / 'none' / 'system:xxx' / 'user:42'


class CreateSkillRequest(BaseModel):
    name: str
    body_markdown: str
    icon: str | None = None
    slug: str | None = None  # 不传时自动生成


class UpdateSkillRequest(BaseModel):
    name: str | None = None
    body_markdown: str | None = None
    icon: str | None = None


class PatchRulesRequest(BaseModel):
    derived_rules: dict


# =============== utils ===============


def _slugify(name: str) -> str:
    """简易 slug：只保留 [a-z0-9-]，中文/特殊字符压成 'skill'."""
    s = (name or "").strip().lower()
    s = re.sub(r"[^a-z0-9\u4e00-\u9fff\-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "skill"


async def _get_or_create_settings(db: AsyncSession, user_id: int) -> UserSettings:
    row = await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    settings = row.scalar_one_or_none()
    if settings:
        return settings
    settings = UserSettings(user_id=user_id)
    db.add(settings)
    await db.commit()
    await db.refresh(settings)
    return settings


async def _ensure_unique_slug(db: AsyncSession, user_id: int, base: str) -> str:
    slug = base
    suffix = 2
    while True:
        row = await db.execute(
            select(UserSkill.id).where(
                UserSkill.user_id == user_id, UserSkill.slug == slug
            )
        )
        if not row.scalar_one_or_none():
            return slug
        slug = f"{base}-{suffix}"
        suffix += 1
        if suffix > 99:
            return f"{base}-{datetime.utcnow().timestamp():.0f}"


def _skill_to_dict(s: UserSkill, with_body: bool = False) -> dict[str, Any]:
    out = {
        "id": s.id,
        "ref": f"user:{s.id}",
        "slug": s.slug,
        "name": s.name,
        "icon": s.icon,
        "completeness_warnings": s.completeness_warnings or [],
        "derived_rules": s.derived_rules,
        "rules_user_edited": s.rules_user_edited,
        "rules_extracted_at": s.rules_extracted_at.isoformat() if s.rules_extracted_at else None,
        "is_archived": s.is_archived,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }
    if with_body:
        out["body_markdown"] = s.body_markdown
    return out


def _system_options() -> list[dict[str, Any]]:
    """系统预设 7 个体系打包成下拉项。"""
    out = []
    for art in list_systems():
        meta = SYSTEM_META.get(art.system_key or art.slug, {})
        out.append({
            "ref": f"system:{art.slug}",
            "source": "system",
            "slug": art.slug,
            "name": meta.get("label") or art.title,
            "tagline": meta.get("tagline", ""),
            "horizon": meta.get("horizon", ""),
            "risk": meta.get("risk", ""),
            "color": meta.get("color", ""),
        })
    return out


# =============== 后台任务 ===============


async def _async_lint_and_extract(skill_id: int, force_extract: bool = False) -> None:
    """跑 lint + extract_rules，更新 UserSkill 字段。
    force_extract=False 时若 rules_user_edited=True 则跳过 extract（保留用户手工版本）。
    """
    from app.database import async_session

    async with async_session() as db:
        skill = await db.get(UserSkill, skill_id)
        if not skill:
            return
        body = skill.body_markdown or ""

        try:
            warnings = await lint_skill_completeness(body)
        except Exception as e:
            logger.warning("lint task failed skill=%s: %s", skill_id, e)
            warnings = None

        rules: dict | None = None
        if force_extract or not skill.rules_user_edited:
            try:
                rules = await extract_derived_rules(body)
            except Exception as e:
                logger.warning("extract task failed skill=%s: %s", skill_id, e)

        if warnings is not None:
            skill.completeness_warnings = warnings
        if rules is not None:
            skill.derived_rules = rules
            skill.rules_extracted_at = datetime.utcnow()
            skill.rules_user_edited = False
        await db.commit()


def _enqueue_lint_and_extract(
    background_tasks: BackgroundTasks, skill_id: int, force_extract: bool = False
) -> None:
    background_tasks.add_task(_async_lint_and_extract, skill_id, force_extract)


# =============== options / active ===============


@router.get("/options")
async def get_skill_options(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """下拉菜单数据：系统预设 7 个 + 用户自建（未归档）。"""
    rows = (
        await db.execute(
            select(UserSkill)
            .where(UserSkill.user_id == user.id, UserSkill.is_archived == False)  # noqa: E712
            .order_by(UserSkill.updated_at.desc())
        )
    ).scalars().all()

    user_items = [
        {
            "ref": f"user:{r.id}",
            "source": "user",
            "id": r.id,
            "slug": r.slug,
            "name": r.name,
            "icon": r.icon,
        }
        for r in rows
    ]
    return {
        "system": _system_options(),
        "user": user_items,
    }


@router.get("/active")
async def get_active(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回当前用户的默认激活体系（None 表示中立）。"""
    settings = await _get_or_create_settings(db, user.id)
    ref = settings.active_skill_ref

    name: str | None = None
    if ref:
        if ref.startswith("system:"):
            slug = ref[len("system:"):]
            meta = SYSTEM_META.get(slug, {})
            name = meta.get("label") or slug
        elif ref.startswith("user:"):
            try:
                sid = int(ref[len("user:"):])
                row = await db.get(UserSkill, sid)
                if row and row.user_id == user.id and not row.is_archived:
                    name = row.name
                else:
                    ref = None
            except Exception:
                ref = None
    return {"ref": ref, "name": name}


@router.put("/active")
async def set_active(
    req: ActiveRefRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    new_ref: str | None = None
    if req.ref and req.ref.lower() not in ("none", "null", "neutral", ""):
        ref = req.ref.strip()
        if ref.startswith("system:"):
            slug = ref[len("system:"):]
            if slug not in SYSTEM_META:
                raise HTTPException(404, f"unknown system skill: {slug}")
            new_ref = ref
        elif ref.startswith("user:"):
            try:
                sid = int(ref[len("user:"):])
            except ValueError:
                raise HTTPException(400, "invalid user skill ref")
            row = await db.get(UserSkill, sid)
            if not row or row.user_id != user.id or row.is_archived:
                raise HTTPException(404, "user skill not found")
            new_ref = ref
        else:
            raise HTTPException(400, "ref must be 'system:slug' or 'user:id' or null")

    settings = await _get_or_create_settings(db, user.id)
    settings.active_skill_ref = new_ref
    await db.commit()
    return {"ref": new_ref}


# =============== user skill CRUD ===============


@router.get("/user")
async def list_user_skills(
    include_archived: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(UserSkill).where(UserSkill.user_id == user.id)
    if not include_archived:
        stmt = stmt.where(UserSkill.is_archived == False)  # noqa: E712
    stmt = stmt.order_by(UserSkill.updated_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return {"items": [_skill_to_dict(r) for r in rows]}


@router.get("/user/{skill_id}")
async def get_user_skill(
    skill_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(UserSkill, skill_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "skill not found")
    return _skill_to_dict(row, with_body=True)


@router.post("/user")
async def create_user_skill(
    req: CreateSkillRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    name = (req.name or "").strip()
    body = (req.body_markdown or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    if not body:
        raise HTTPException(400, "body_markdown required")

    base_slug = _slugify(req.slug or name)
    slug = await _ensure_unique_slug(db, user.id, base_slug)

    skill = UserSkill(
        user_id=user.id,
        slug=slug,
        name=name[:80],
        icon=(req.icon or None),
        body_markdown=body,
        completeness_warnings=None,
        derived_rules=None,
        rules_user_edited=False,
        is_archived=False,
    )
    db.add(skill)
    await db.commit()
    await db.refresh(skill)

    _enqueue_lint_and_extract(background_tasks, skill.id, force_extract=True)
    return _skill_to_dict(skill, with_body=True)


@router.put("/user/{skill_id}")
async def update_user_skill(
    skill_id: int,
    req: UpdateSkillRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(UserSkill, skill_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "skill not found")

    body_changed = False
    if req.name is not None:
        nm = req.name.strip()
        if nm:
            row.name = nm[:80]
    if req.icon is not None:
        row.icon = req.icon or None
    if req.body_markdown is not None:
        new_body = req.body_markdown.strip()
        if new_body and new_body != (row.body_markdown or "").strip():
            row.body_markdown = new_body
            body_changed = True

    await db.commit()
    await db.refresh(row)

    if body_changed:
        # body 改了 → 重新 lint + 若用户没手工编辑过规则则重抽
        _enqueue_lint_and_extract(background_tasks, row.id, force_extract=False)

    return _skill_to_dict(row, with_body=True)


@router.patch("/user/{skill_id}/rules")
async def patch_user_skill_rules(
    skill_id: int,
    req: PatchRulesRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """用户手动改 derived_rules，写完置 rules_user_edited=true。"""
    row = await db.get(UserSkill, skill_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "skill not found")

    rules = req.derived_rules or {}
    # 简单 sanitize：只保留白名单字段
    filters = {
        k: v for k, v in (rules.get("filters") or {}).items() if k in ALLOWED_FILTER_FACTORS
    }
    scorers_raw = rules.get("scorers") or []
    scorers = []
    for it in scorers_raw:
        if not isinstance(it, dict):
            continue
        f = (it.get("factor") or "").strip()
        if f not in ALLOWED_SCORER_FACTORS:
            continue
        try:
            w = max(1, min(3, int(it.get("weight", 1))))
        except Exception:
            w = 1
        scorers.append({"factor": f, "weight": w})
    universe = rules.get("scan_universe_default") or "hs300"
    if not (
        universe in ("all", "hs300", "watchlist")
        or universe.startswith("industry:")
        or universe.startswith("theme:")
    ):
        universe = "hs300"
    try:
        top_n = max(5, min(100, int(rules.get("top_n_suggested") or 30)))
    except Exception:
        top_n = 30

    row.derived_rules = {
        "filters": filters,
        "scorers": scorers,
        "scan_universe_default": universe,
        "top_n_suggested": top_n,
        "unsupported_mentions": rules.get("unsupported_mentions") or [],
        "extracted_at": (row.derived_rules or {}).get("extracted_at"),
    }
    row.rules_user_edited = True
    await db.commit()
    await db.refresh(row)
    return _skill_to_dict(row, with_body=True)


@router.post("/user/{skill_id}/lint")
async def force_lint(
    skill_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(UserSkill, skill_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "skill not found")
    warnings = await lint_skill_completeness(row.body_markdown or "")
    row.completeness_warnings = warnings
    await db.commit()
    return {"completeness_warnings": warnings}


@router.post("/user/{skill_id}/extract")
async def force_extract(
    skill_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """强制重抽 derived_rules（会覆盖用户手工改过的规则）。"""
    row = await db.get(UserSkill, skill_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "skill not found")
    rules = await extract_derived_rules(row.body_markdown or "")
    row.derived_rules = rules
    row.rules_extracted_at = datetime.utcnow()
    row.rules_user_edited = False
    await db.commit()
    await db.refresh(row)
    return {"derived_rules": rules, "rules_user_edited": False}


@router.delete("/user/{skill_id}")
async def archive_user_skill(
    skill_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(UserSkill, skill_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "skill not found")
    row.is_archived = True

    # 若当前默认激活就是这个，自动清空
    settings = await _get_or_create_settings(db, user.id)
    if settings.active_skill_ref == f"user:{skill_id}":
        settings.active_skill_ref = None
    await db.commit()
    return {"ok": True}


# =============== catalog ===============


@router.get("/catalog")
async def get_catalog():
    """前端编辑器用：因子白名单 + completeness check 关键点清单。"""
    return {
        "factor_catalog": get_factor_catalog(),
        "lint_keys": get_check_keys(),
    }
