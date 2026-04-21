import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from app.ai.brief_cache import invalidate_pg
from app.api.auth import _enqueue_user_prewarm, get_current_user
from app.database import get_db
from app.models.user import User, UserWatchlist

logger = logging.getLogger(__name__)
router = APIRouter()


def _invalidate_user_watchlist_cache(user_id: int) -> None:
    """自选股变动后失效掉 per-user 相关 cache, 下一次 peruser_prewarm 重建.

    只清 watchlist_brief:{user_id}: 前缀; news_brief 靠 2h TTL 自然淘汰,
    避免误伤公共预热 key (hash="_").
    """
    try:
        invalidate_pg(f"watchlist_brief:{user_id}:")
    except Exception as e:
        logger.debug(f"invalidate watchlist cache user={user_id}: {e}")


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
    background_tasks: BackgroundTasks,
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
    background_tasks.add_task(_invalidate_user_watchlist_cache, user.id)
    background_tasks.add_task(_enqueue_user_prewarm, user.id)
    return {"id": item.id, "stock_code": item.stock_code}


@router.delete("/{stock_code}")
async def remove_from_watchlist(
    stock_code: str,
    background_tasks: BackgroundTasks,
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
    background_tasks.add_task(_invalidate_user_watchlist_cache, user.id)
    background_tasks.add_task(_enqueue_user_prewarm, user.id)
    return {"ok": True}
