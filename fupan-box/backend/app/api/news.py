"""News RAG / 时间线接口 (Phase 4).

Endpoints:
  GET /api/news/search          q + (filters) → 语义检索 (pgvector cosine)
  GET /api/news/timeline        code → 个股新闻时间线 (含命中题材)
  GET /api/news/theme-timeline  theme → 题材新闻时间线
  GET /api/news/{news_id}       单条详情 + 相关 (语义近邻)
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.ai import NewsSummary
from app.news.embed import embed_text
from app.news.ingest import (
    _row_to_dict,
    fetch_news_for_codes,
    fetch_news_for_themes,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _engine():
    return create_engine(get_settings().database_url_sync, pool_pre_ping=True)


@router.get("/search")
async def search_news(
    q: str = Query(..., min_length=2, max_length=200, description="查询语句"),
    limit: int = Query(20, ge=1, le=100),
    hours: int = Query(168, ge=1, le=24 * 30, description="回看时长 (小时)"),
    min_importance: int = Query(0, ge=0, le=5),
    sentiment: str = Query("", description="bullish|neutral|bearish"),
    impact_horizon: str = Query("", description="影响时间维度: short|swing|long|mixed"),
    code: str = Query("", description="只限命中此股票代码"),
    theme: str = Query("", description="只限命中此题材"),
):
    """RAG 语义检索. 用 pgvector cosine 距离 (<=>).

    返回 [{...新闻字段, _distance}], distance 越小越相似 (0 = 完全匹配).
    若 embedding 未生成 (status != 'done'), 该行不会出现在结果里.
    """
    vec = embed_text(q)
    if vec is None:
        raise HTTPException(
            status_code=503,
            detail="embedding 服务不可用 (检查 openai_api_key / news_embedding_model)",
        )

    s = get_settings()
    if len(vec) != s.news_embedding_dim:
        raise HTTPException(
            status_code=500,
            detail=f"embedding 维度不匹配: got {len(vec)}, expect {s.news_embedding_dim}",
        )

    cutoff = datetime.now() - timedelta(hours=hours)
    eng = _engine()
    try:
        # pgvector 的 sqlalchemy 适配支持 <=> 操作符 (cosine_distance)
        with Session(eng) as session:
            # 用 raw SQL + bind param, 兼容 pgvector cast
            params: dict = {
                "vec": vec,
                "cutoff": cutoff,
                "limit": limit,
            }
            where_clauses = [
                "embedding IS NOT NULL",
                "embedding_status = 'done'",
                "pub_time >= :cutoff",
            ]
            if min_importance:
                where_clauses.append("importance >= :min_imp")
                params["min_imp"] = min_importance
            if sentiment in ("bullish", "neutral", "bearish"):
                where_clauses.append("sentiment = :sent")
                params["sent"] = sentiment
            if impact_horizon in ("short", "swing", "long", "mixed"):
                where_clauses.append("impact_horizon = :ih")
                params["ih"] = impact_horizon
            if code.strip():
                where_clauses.append("related_stocks ?| array[:code]")
                params["code"] = code.strip()
            if theme.strip():
                where_clauses.append("related_themes ?| array[:theme]")
                params["theme"] = theme.strip()

            sql = text(
                f"""
                SELECT id, embedding <=> CAST(:vec AS vector) AS distance
                FROM news_summaries
                WHERE {' AND '.join(where_clauses)}
                ORDER BY distance ASC
                LIMIT :limit
                """
            )
            res = session.execute(sql, params).all()
            ids_with_dist: list[tuple[int, float]] = [(int(r[0]), float(r[1])) for r in res]
            if not ids_with_dist:
                return []
            ids = [r[0] for r in ids_with_dist]
            rows = session.execute(
                select(NewsSummary).where(NewsSummary.id.in_(ids))
            ).scalars().all()
            row_map = {r.id: r for r in rows}
            out: list[dict] = []
            for nid, dist in ids_with_dist:
                if nid in row_map:
                    d = _row_to_dict(row_map[nid])
                    d["_distance"] = round(dist, 4)
                    d["_score"] = round(1.0 - dist, 4)  # 余弦相似 (0..1)
                    out.append(d)
            return out
    finally:
        eng.dispose()


@router.get("/timeline")
async def stock_news_timeline(
    code: str = Query(..., min_length=4, max_length=10),
    days: int = Query(30, ge=1, le=180),
    limit: int = Query(80, ge=1, le=200),
):
    """个股新闻时间线 — 按 pub_time desc, 用于个股详情页 / WhyRoseModal 深度展开."""
    items = fetch_news_for_codes([code.strip()], hours=days * 24, limit=limit)
    items.sort(key=lambda x: x.get("pub_time") or "", reverse=True)
    return {"code": code, "days": days, "count": len(items), "items": items}


@router.get("/theme-timeline")
async def theme_news_timeline(
    theme: str = Query(..., min_length=2, max_length=40),
    days: int = Query(30, ge=1, le=180),
    limit: int = Query(80, ge=1, le=200),
):
    """题材新闻时间线 — 用于题材详情页 / ThemeAiCard 深度展开."""
    items = fetch_news_for_themes([theme.strip()], hours=days * 24, limit=limit)
    items.sort(key=lambda x: x.get("pub_time") or "", reverse=True)
    return {"theme": theme, "days": days, "count": len(items), "items": items}


@router.get("/{news_id}")
async def get_news_detail(
    news_id: int,
    related: int = Query(5, ge=0, le=20, description="附带语义近邻数量, 0=不查"),
):
    """单条新闻详情 + 语义近邻 (用于跨页 focus=ID 后展开)."""
    s = get_settings()
    eng = _engine()
    try:
        with Session(eng) as session:
            row = session.get(NewsSummary, news_id)
            if row is None:
                raise HTTPException(404, "news not found")
            detail = _row_to_dict(row)

            related_items: list[dict] = []
            if related > 0 and row.embedding is not None and row.embedding_status == "done":
                # 注意: 这里不能直接用 row.embedding 作为 raw SQL 参数 — 需要列表
                vec = list(row.embedding)
                if len(vec) == s.news_embedding_dim:
                    sql = text(
                        """
                        SELECT id, embedding <=> CAST(:vec AS vector) AS distance
                        FROM news_summaries
                        WHERE embedding_status = 'done' AND id != :nid
                        ORDER BY distance ASC
                        LIMIT :lim
                        """
                    )
                    res = session.execute(sql, {"vec": vec, "nid": news_id, "lim": related}).all()
                    ids_with_dist = [(int(r[0]), float(r[1])) for r in res]
                    if ids_with_dist:
                        ids = [r[0] for r in ids_with_dist]
                        sub_rows = session.execute(
                            select(NewsSummary).where(NewsSummary.id.in_(ids))
                        ).scalars().all()
                        sub_map = {r.id: r for r in sub_rows}
                        for nid, dist in ids_with_dist:
                            if nid in sub_map:
                                d = _row_to_dict(sub_map[nid])
                                d["_distance"] = round(dist, 4)
                                related_items.append(d)
            return {"detail": detail, "related": related_items}
    finally:
        eng.dispose()
