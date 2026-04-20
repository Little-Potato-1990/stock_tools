"""我的交易复盘 API.

P0 「我的复盘」MVP:
- 手动录入 round-trip 交易 (买入价/卖出价/持仓时长/介入逻辑)
- 模式诊断: 追高比例/胜率/期望/平均持仓
- AI 综合复盘 (LLM 调用 — 计入 quota)
"""
from datetime import date as date_type, datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from pydantic import BaseModel, Field
from app.database import get_db
from app.api.auth import get_current_user
from app.models.user import User, UserTrade
from app.ai.trade_review import diagnose_pattern, generate_ai_review

router = APIRouter()


class TradeCreate(BaseModel):
    trade_date: date_type
    code: str = Field(..., min_length=6, max_length=6)
    name: str | None = None
    buy_price: float = Field(..., gt=0)
    sell_price: float = Field(..., gt=0)
    qty: int = Field(..., gt=0)
    intraday_chg_at_buy: float | None = None
    holding_minutes: int | None = Field(None, ge=0)
    reason: str | None = None


class TradeOut(BaseModel):
    id: int
    trade_date: date_type
    code: str
    name: str | None
    buy_price: float
    sell_price: float
    qty: int
    intraday_chg_at_buy: float | None
    holding_minutes: int | None
    reason: str | None
    pnl: float
    pnl_pct: float
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/", response_model=TradeOut)
async def create_trade(
    req: TradeCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pnl = (req.sell_price - req.buy_price) * req.qty
    pnl_pct = (req.sell_price - req.buy_price) / req.buy_price * 100.0 if req.buy_price else 0.0
    trade = UserTrade(
        user_id=user.id,
        trade_date=req.trade_date,
        code=req.code,
        name=req.name,
        buy_price=req.buy_price,
        sell_price=req.sell_price,
        qty=req.qty,
        intraday_chg_at_buy=req.intraday_chg_at_buy,
        holding_minutes=req.holding_minutes,
        reason=req.reason,
        pnl=pnl,
        pnl_pct=pnl_pct,
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)
    return trade


@router.get("/", response_model=list[TradeOut])
async def list_trades(
    days: int = Query(30, ge=1, le=365),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from datetime import timedelta
    since = date_type.today() - timedelta(days=days)
    result = await db.execute(
        select(UserTrade)
        .where(UserTrade.user_id == user.id, UserTrade.trade_date >= since)
        .order_by(UserTrade.trade_date.desc(), UserTrade.id.desc())
    )
    return result.scalars().all()


@router.delete("/{trade_id}")
async def delete_trade(
    trade_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserTrade).where(UserTrade.id == trade_id, UserTrade.user_id == user.id)
    )
    trade = result.scalar_one_or_none()
    if not trade:
        raise HTTPException(404, "Trade not found")
    await db.delete(trade)
    await db.commit()
    return {"ok": True}


@router.get("/pattern")
async def get_pattern(
    days: int = Query(30, ge=7, le=365),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """模式诊断 — 纯统计, 不调 LLM, 不计 quota."""
    from datetime import timedelta
    since = date_type.today() - timedelta(days=days)
    result = await db.execute(
        select(UserTrade)
        .where(UserTrade.user_id == user.id, UserTrade.trade_date >= since)
        .order_by(UserTrade.trade_date.desc())
    )
    trades = result.scalars().all()
    return diagnose_pattern(trades, days=days)


@router.post("/ai-review")
async def post_ai_review(
    days: int = Query(30, ge=7, le=180),
    model: str = Query("deepseek-v3"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """AI 交易复盘 — 调 LLM, 计入 quota (trade_review)."""
    from app.api.quota import check_and_log_quota
    from datetime import timedelta

    await check_and_log_quota(db, user, action="trade_review", model=model)

    since = date_type.today() - timedelta(days=days)
    result = await db.execute(
        select(UserTrade)
        .where(UserTrade.user_id == user.id, UserTrade.trade_date >= since)
        .order_by(UserTrade.trade_date.desc())
    )
    trades = result.scalars().all()
    if not trades:
        raise HTTPException(400, "暂无交易记录, 先录入几笔")

    pattern = diagnose_pattern(trades, days=days)
    review = await generate_ai_review(trades, pattern, model)
    return {"pattern": pattern, "review": review}
