"""个股 7 维上下文 HTTP 端点.

主要供前端 chip / drawer / hover popover 调用, 也可作为 LLM 工具.
"""
from datetime import date
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.api._cache import cached_call
from app.services.stock_context import get_stock_context, get_stock_contexts


router = APIRouter()


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
        lambda: get_stock_context(db, code, trade_date=trade_date, dimensions=dims),
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
