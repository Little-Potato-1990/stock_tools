"""个股 7 维上下文 HTTP 端点.

主要供前端 chip / drawer / hover popover 调用, 也可作为 LLM 工具.

读取顺序 (cache-first 改造后):
    1. PG brief_cache `stock_context:{code}:{td}` — prewarm-stock-context 每日 17:40 写入
    2. 内存 cached_call 120s — 防点击风暴
    3. 实时 SQL 拼装 (fallback, 第一次访问 / universe 外 / 部分维度未落库)
"""
import asyncio
from datetime import date
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.brief_cache import pg_get, pg_set
from app.api._cache import cached_call
from app.database import get_db
from app.models.stock import DailyQuote
from app.services.stock_context import get_stock_context, get_stock_contexts


router = APIRouter()

_CONTEXT_PG_TTL_H = 24.0


async def _resolve_trade_date(db: AsyncSession, td: date | None) -> date | None:
    if td:
        return td
    r = await db.execute(select(func.max(DailyQuote.trade_date)))
    return r.scalar_one_or_none()


async def _ctx_via_pg_or_db(
    db: AsyncSession, code: str, td: date | None, dims: list[str] | None,
) -> dict:
    """先试 PG cache, miss 再跑 SQL + 回写 (仅无 dims 子集过滤时命中 cache key)."""
    resolved = await _resolve_trade_date(db, td)
    # 只有"全维度"版本落 PG cache. 指定 dimensions 时跳过 cache, 避免污染.
    use_cache = resolved and not dims
    if use_cache:
        key = f"stock_context:{code}:{resolved.isoformat()}"
        cached = await asyncio.to_thread(pg_get, key)
        if cached is not None:
            return cached

    ctx = await get_stock_context(db, code, trade_date=resolved, dimensions=dims)

    if use_cache and isinstance(ctx, dict):
        try:
            await asyncio.to_thread(
                pg_set, key, ctx,
                action="stock_context", model=None, trade_date=resolved,
                ttl_hours=_CONTEXT_PG_TTL_H, source="ondemand",
            )
        except Exception:
            pass
    return ctx


@router.get("/context/{code}")
async def stock_context(
    code: str,
    trade_date: date | None = Query(None),
    dimensions: str | None = Query(None, description="逗号分隔的维度子集, 如 price,capital"),
    db: AsyncSession = Depends(get_db),
):
    """单股 7 维上下文."""
    code = code.strip().zfill(6)
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(status_code=400, detail="invalid stock code")
    dims = [d.strip() for d in dimensions.split(",")] if dimensions else None
    key = ("stock_ctx", code, str(trade_date), dimensions or "")
    return await cached_call(
        key,
        lambda: _ctx_via_pg_or_db(db, code, trade_date, dims),
        ttl=120.0,
    )


class BatchReq(BaseModel):
    codes: list[str] = Field(..., min_length=1, max_length=80)
    trade_date: date | None = None
    dimensions: list[str] | None = None


@router.post("/context/batch")
async def stock_context_batch(req: BatchReq, db: AsyncSession = Depends(get_db)):
    """批量上下文(最多 80 只). 适合自选 / 题材成分股一次性渲染 chip."""
    return await get_stock_contexts(
        db, req.codes, trade_date=req.trade_date, dimensions=req.dimensions,
    )
