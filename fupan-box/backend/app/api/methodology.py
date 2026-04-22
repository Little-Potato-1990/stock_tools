"""方法论文库 API (Phase 5 + 两层架构升级).

旧端点 (向后兼容, 用于「按旧 4 类」浏览):
  GET  /api/methodology/list         列表 (meta + summary), 支持 category/tag/q 过滤
  GET  /api/methodology/categories   旧 4 类汇总 (含计数 + 高频标签)
  GET  /api/methodology/tags         全量标签频次
  GET  /api/methodology/refresh      手动刷新索引

新端点 (两层架构: 投资体系 / 基础知识 / 战法):
  GET  /api/methodology/systems      所有体系 + 各自挂接的 foundation/tactic 简要 meta
  GET  /api/methodology/foundations  基础知识词典视图 (4 子分类汇总)
  GET  /api/methodology/foundations/list?subcat=...  基础知识列表
  GET  /api/methodology/tactics?system_key=...       战法列表 (可按所属体系过滤)

详情:
  GET  /api/methodology/{slug}       单篇详情, 按 kind 自动 join 关联文章 meta
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.methodology.loader import (
    CATEGORY_META,
    FOUNDATION_SUBCAT_META,
    SYSTEM_META,
    all_tags,
    belongs_to_systems_meta,
    categories_summary,
    foundations_summary,
    get_article,
    get_index,
    list_articles,
    list_foundations,
    list_systems,
    list_tactics,
    referenced_by_systems,
    systems_with_links,
)

router = APIRouter()


# ============== 旧端点 (兼容) ==============


@router.get("/list")
async def list_endpoint(
    category: str = Query("", description="分类: value_longterm / technical / short_term / macro"),
    tag: str = Query("", description="标签精确匹配"),
    q: str = Query("", description="关键词 (在 title/summary/tags 内匹配)"),
    limit: int = Query(100, ge=1, le=500),
):
    """方法论列表 (旧端点, 不区分 kind, 全部文章一锅). 仅返回 meta + summary."""
    items = list_articles(category=category.strip(), tag=tag.strip(), q=q.strip())
    items = items[:limit]
    return {
        "total": len(items),
        "items": [a.to_meta() for a in items],
    }


@router.get("/categories")
async def categories_endpoint():
    """旧 4 类汇总 (含每类文章数 + 高频标签). 主要给旧前端用."""
    return {
        "categories": categories_summary(),
        "category_meta": [
            {"key": k, **v} for k, v in CATEGORY_META.items()
        ],
    }


@router.get("/tags")
async def tags_endpoint():
    """全量标签频次. 标签云用."""
    return {"tags": all_tags()}


@router.get("/refresh")
async def refresh_endpoint():
    """强制刷新索引. dev 时改了 markdown 但不想等 60s 缓存可以打这个."""
    idx = get_index(force_refresh=True)
    return {"ok": True, "count": len(idx)}


# ============== 新端点: 两层架构 ==============


@router.get("/systems")
async def systems_endpoint():
    """所有投资体系 + 每个体系挂接的基础知识 / 战法简要 meta.

    给前端 landing 卡片墙用. 卡片字段从 system_meta 取 (label/tagline/horizon/risk/color),
    挂接列表是 ArticleCard 复用所需的 MethodologyMeta 数组.
    """
    return {
        "systems": systems_with_links(),
        "system_meta": [
            {"key": k, **v} for k, v in SYSTEM_META.items()
        ],
    }


@router.get("/foundations")
async def foundations_endpoint():
    """基础知识 4 子分类汇总 (含计数 + 高频 tag), 给词典视图侧栏用."""
    return {
        "subcategories": foundations_summary(),
        "subcategory_meta": [
            {"key": k, **v} for k, v in FOUNDATION_SUBCAT_META.items()
        ],
    }


@router.get("/foundations/list")
async def foundations_list_endpoint(
    subcat: str = Query("", description="子分类: technical | valuation | financial | macro"),
    q: str = Query("", description="关键词 (在 title/summary/tags 内匹配)"),
    limit: int = Query(200, ge=1, le=500),
):
    """基础知识列表 (按子分类过滤). 返回 meta 数组."""
    items = list_foundations(subcat=subcat.strip())
    if q:
        ql = q.lower().strip()
        items = [
            a
            for a in items
            if ql in a.title.lower()
            or ql in a.summary.lower()
            or any(ql in t.lower() for t in a.tags)
        ]
    items = items[:limit]
    return {
        "total": len(items),
        "items": [a.to_meta() for a in items],
    }


@router.get("/tactics")
async def tactics_endpoint(
    system_key: str = Query("", description="按所属体系过滤"),
    limit: int = Query(200, ge=1, le=500),
):
    """战法列表 (可按所属体系 system_key 过滤)."""
    items = list_tactics(system_key=system_key.strip())
    items = items[:limit]
    return {
        "total": len(items),
        "items": [a.to_meta() for a in items],
    }


# ============== 详情 (按 kind 自动 join 关联) ==============


@router.get("/{slug}")
async def detail_endpoint(slug: str):
    """单篇详情, 含完整 markdown 正文.

    扩展: 按 kind 自动 join 关联文章 meta, 让前端一次拉到位:
      - kind=system    → related_foundations_meta + related_tactics_meta
      - kind=foundation→ referenced_by_systems  (反查所有 system 中包含本 slug)
      - kind=tactic    → belongs_to_systems_meta
    """
    a = get_article(slug)
    if a is None:
        raise HTTPException(status_code=404, detail=f"methodology article not found: {slug}")

    out = a.to_detail()

    if a.kind == "system":
        idx = get_index()
        out["related_foundations_meta"] = [
            idx[s].to_meta() for s in a.related_foundations if s in idx
        ]
        out["related_tactics_meta"] = [
            idx[s].to_meta() for s in a.related_tactics if s in idx
        ]
    elif a.kind == "foundation":
        out["referenced_by_systems"] = referenced_by_systems(a.slug)
    elif a.kind == "tactic":
        out["belongs_to_systems_meta"] = belongs_to_systems_meta(a.belongs_to_systems)

    return out
