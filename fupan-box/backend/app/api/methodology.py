"""方法论文库 API (Phase 5).

Endpoints:
  GET  /api/methodology/list         列表 (meta + summary), 支持 category/tag/q 过滤
  GET  /api/methodology/categories   分类汇总 (含计数 + 高频标签)
  GET  /api/methodology/tags         全量标签频次
  GET  /api/methodology/{slug}       单篇详情 (含完整 markdown)
  POST /api/methodology/refresh      手动刷新索引 (开发用)
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.methodology.loader import (
    CATEGORY_META,
    all_tags,
    categories_summary,
    get_article,
    get_index,
    list_articles,
)

router = APIRouter()


@router.get("/list")
async def list_endpoint(
    category: str = Query("", description="分类: value_longterm / technical / short_term / macro"),
    tag: str = Query("", description="标签精确匹配"),
    q: str = Query("", description="关键词 (在 title/summary/tags 内匹配)"),
    limit: int = Query(100, ge=1, le=500),
):
    """方法论列表. 默认按分类固定顺序 + 阅读时长升序排.

    仅返回 meta + summary, 完整 markdown 走详情接口.
    """
    items = list_articles(category=category.strip(), tag=tag.strip(), q=q.strip())
    items = items[:limit]
    return {
        "total": len(items),
        "items": [a.to_meta() for a in items],
    }


@router.get("/categories")
async def categories_endpoint():
    """分类汇总 (含每个分类下的文章数 + 高频标签). 用于左侧筛选条/导航."""
    return {
        "categories": categories_summary(),
        "category_meta": [
            {"key": k, **v} for k, v in CATEGORY_META.items()
        ],
    }


@router.get("/tags")
async def tags_endpoint():
    """全量标签频次. 用于标签云."""
    return {"tags": all_tags()}


@router.get("/refresh")
async def refresh_endpoint():
    """强制刷新索引. dev 时改了 markdown 但不想等 60s 缓存可以打这个."""
    idx = get_index(force_refresh=True)
    return {"ok": True, "count": len(idx)}


@router.get("/{slug}")
async def detail_endpoint(slug: str):
    """单篇详情, 含完整 markdown 正文."""
    a = get_article(slug)
    if a is None:
        raise HTTPException(status_code=404, detail=f"methodology article not found: {slug}")
    return a.to_detail()
