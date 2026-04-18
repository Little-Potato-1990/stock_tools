from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from app.database import get_db
from app.api.auth import get_current_user
from app.models.user import User, UserWatchlist

router = APIRouter()


class WatchlistAddRequest(BaseModel):
    stock_code: str
    note: str | None = None


@router.get("/")
async def get_watchlist(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserWatchlist)
        .where(UserWatchlist.user_id == user.id)
        .order_by(UserWatchlist.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "stock_code": r.stock_code,
            "note": r.note,
            "ai_reason": r.ai_reason,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/")
async def add_to_watchlist(
    req: WatchlistAddRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(UserWatchlist).where(
            UserWatchlist.user_id == user.id,
            UserWatchlist.stock_code == req.stock_code,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Already in watchlist")

    item = UserWatchlist(
        user_id=user.id,
        stock_code=req.stock_code,
        note=req.note,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return {"id": item.id, "stock_code": item.stock_code}


@router.delete("/{stock_code}")
async def remove_from_watchlist(
    stock_code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        delete(UserWatchlist).where(
            UserWatchlist.user_id == user.id,
            UserWatchlist.stock_code == stock_code,
        )
    )
    await db.commit()
    return {"ok": True}
