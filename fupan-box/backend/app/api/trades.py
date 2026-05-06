"""我的交易复盘 API.

P0 「我的复盘」MVP:
- 手动录入 round-trip 交易 (买入价/卖出价/持仓时长/介入逻辑)
- 模式诊断: 追高比例/胜率/期望/平均持仓
- AI 综合复盘 (LLM 调用 — 计入 quota)
"""
from collections import defaultdict, deque
from datetime import date as date_type, datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from pydantic import BaseModel, Field
from app.database import get_db
from app.api.auth import get_current_user
from app.models.user import User, UserTrade, UserTradeRaw, UserHolding
from app.models.stock import DailyQuote
from app.ai.trade_review import diagnose_pattern, generate_ai_review

router = APIRouter()


def _real_trade_stmt(user_id: int, since: date_type):
    """仅保留真实交易配对: 排除含 virtual_initial 原始腿的 round-trip."""
    virtual_leg_exists = (
        select(UserTradeRaw.id)
        .where(
            UserTradeRaw.user_id == user_id,
            UserTradeRaw.matched_trade_id == UserTrade.id,
            UserTradeRaw.source == "virtual_initial",
        )
        .exists()
    )
    return (
        select(UserTrade)
        .where(
            UserTrade.user_id == user_id,
            UserTrade.trade_date >= since,
            ~virtual_leg_exists,
        )
    )


def _is_buy(side: str | None) -> bool:
    s = (side or "").strip().lower()
    return s in {"buy", "b", "买", "买入"}


def _is_sell(side: str | None) -> bool:
    s = (side or "").strip().lower()
    return s in {"sell", "s", "卖", "卖出"}


async def _latest_quote_map(db: AsyncSession, codes: list[str]) -> dict[str, float]:
    if not codes:
        return {}
    subq = (
        select(
            DailyQuote.stock_code.label("stock_code"),
            func.max(DailyQuote.trade_date).label("max_date"),
        )
        .where(DailyQuote.stock_code.in_(codes))
        .group_by(DailyQuote.stock_code)
        .subquery()
    )
    rows = await db.execute(
        select(DailyQuote.stock_code, DailyQuote.close)
        .join(
            subq,
            and_(
                DailyQuote.stock_code == subq.c.stock_code,
                DailyQuote.trade_date == subq.c.max_date,
            ),
        )
    )
    return {str(code): float(close) for code, close in rows.all()}


async def _anchor_quote_map(
    db: AsyncSession,
    codes: list[str],
    anchor_date: date_type,
) -> dict[str, float]:
    if not codes:
        return {}
    subq = (
        select(
            DailyQuote.stock_code.label("stock_code"),
            func.max(DailyQuote.trade_date).label("max_date"),
        )
        .where(
            DailyQuote.stock_code.in_(codes),
            DailyQuote.trade_date <= anchor_date,
        )
        .group_by(DailyQuote.stock_code)
        .subquery()
    )
    rows = await db.execute(
        select(DailyQuote.stock_code, DailyQuote.close)
        .join(
            subq,
            and_(
                DailyQuote.stock_code == subq.c.stock_code,
                DailyQuote.trade_date == subq.c.max_date,
            ),
        )
    )
    return {str(code): float(close) for code, close in rows.all()}


async def _account_pnl_since(
    db: AsyncSession,
    user_id: int,
    since: date_type,
) -> dict[str, float]:
    raw_rows = await db.execute(
        select(UserTradeRaw)
        .where(
            UserTradeRaw.user_id == user_id,
            UserTradeRaw.source != "virtual_initial",
        )
        .order_by(UserTradeRaw.trade_date, UserTradeRaw.trade_time, UserTradeRaw.id)
    )
    raws = list(raw_rows.scalars().all())
    if not raws:
        return {
            "closed_pnl": 0.0,
            "holding_pnl": 0.0,
            "account_pnl": 0.0,
            "holding_from_initial_pnl": 0.0,
            "holding_from_new_buys_pnl": 0.0,
        }

    holdings_rows = await db.execute(
        select(UserHolding).where(UserHolding.user_id == user_id, UserHolding.qty > 0)
    )
    holdings = list(holdings_rows.scalars().all())
    current_price_by_key: dict[tuple[str, str], float] = {}
    current_price_by_code: dict[str, float] = {}
    for h in holdings:
        if h.market_price is None:
            continue
        p = float(h.market_price)
        if p <= 0:
            continue
        key = (str(h.stock_code), str(h.account_label or "default"))
        current_price_by_key[key] = p
        current_price_by_code.setdefault(str(h.stock_code), p)

    lots: dict[tuple[str, str], deque[dict[str, float | date_type]]] = defaultdict(deque)
    closed_pnl = 0.0

    for r in raws:
        key = (str(r.stock_code), str(r.account_label or "default"))
        if _is_buy(r.side):
            lots[key].append({
                "buy_date": r.trade_date,
                "buy_price": float(r.price),
                "qty_left": float(r.qty),
            })
            continue
        if not _is_sell(r.side):
            continue
        need = float(r.qty)
        sell_px = float(r.price)
        q = lots[key]
        while need > 0 and q:
            lot = q[0]
            lot_qty = float(lot["qty_left"])
            take = min(need, lot_qty)
            if r.trade_date >= since:
                closed_pnl += (sell_px - float(lot["buy_price"])) * take
            left = lot_qty - take
            need -= take
            if left <= 0:
                q.popleft()
            else:
                lot["qty_left"] = left
        # 若 sell 缺少对应 buy, 说明流水不完整; 此处按既有口径忽略剩余未匹配数量.

    open_old_lots: list[tuple[tuple[str, str], float, float]] = []
    open_new_lots: list[tuple[tuple[str, str], float, float]] = []
    open_codes: set[str] = set()

    for key, q in lots.items():
        code = key[0]
        for lot in q:
            qty = float(lot["qty_left"])
            if qty <= 0:
                continue
            open_codes.add(code)
            buy_date = lot["buy_date"]
            buy_px = float(lot["buy_price"])
            if isinstance(buy_date, date_type) and buy_date >= since:
                open_new_lots.append((key, qty, buy_px))
            else:
                open_old_lots.append((key, qty, buy_px))

    # holdings 没有市价时, 用日线最新 close 兜底
    missing_codes = sorted(c for c in open_codes if c not in current_price_by_code)
    if missing_codes:
        latest_quotes = await _latest_quote_map(db, missing_codes)
        for c, p in latest_quotes.items():
            current_price_by_code[c] = p

    open_new_pnl = 0.0
    for key, qty, buy_px in open_new_lots:
        code = key[0]
        cur = current_price_by_key.get(key) or current_price_by_code.get(code)
        if cur is None:
            continue
        open_new_pnl += (cur - buy_px) * qty

    old_codes = sorted({k[0] for k, _, _ in open_old_lots})
    anchor_px_map = await _anchor_quote_map(db, old_codes, since)

    open_initial_pnl = 0.0
    for key, qty, buy_px in open_old_lots:
        code = key[0]
        cur = current_price_by_key.get(key) or current_price_by_code.get(code)
        if cur is None:
            continue
        anchor_px = anchor_px_map.get(code, buy_px)
        open_initial_pnl += (cur - anchor_px) * qty

    holding_pnl = open_initial_pnl + open_new_pnl
    return {
        "closed_pnl": round(closed_pnl, 2),
        "holding_pnl": round(holding_pnl, 2),
        "account_pnl": round(closed_pnl + holding_pnl, 2),
        "holding_from_initial_pnl": round(open_initial_pnl, 2),
        "holding_from_new_buys_pnl": round(open_new_pnl, 2),
    }


def _auto_reason_draft(trade: UserTrade) -> str:
    pos = trade.intraday_chg_at_buy
    hold = trade.holding_minutes
    chunks: list[str] = []
    if pos is None:
        chunks.append("分时位置未记录，先按强弱试错")
    elif pos >= 5:
        chunks.append(f"当日已涨 {pos:.1f}%，偏强势跟随")
    elif pos >= 2:
        chunks.append(f"当日涨幅 {pos:.1f}%，转强介入")
    elif pos <= -1:
        chunks.append(f"当日回撤 {abs(pos):.1f}%，偏回落低吸")
    else:
        chunks.append(f"当日涨幅 {pos:.1f}%，中性位置试错")
    if hold is None:
        chunks.append("持仓时长未记录")
    elif hold <= 60:
        chunks.append(f"计划快进快出（持仓 {hold} 分钟）")
    elif hold <= 240:
        chunks.append(f"日内节奏（持仓 {hold} 分钟）")
    else:
        chunks.append(f"偏隔夜节奏（持仓 {hold} 分钟）")
    return "AI草稿：" + "；".join(chunks)


async def _autofill_reason_if_missing(db: AsyncSession, trades: list[UserTrade]) -> None:
    changed = False
    for t in trades:
        reason = (t.reason or "").strip().lower()
        if not reason or reason in {"auto-paired", "auto paired"}:
            t.reason = _auto_reason_draft(t)
            changed = True
    if changed:
        await db.commit()


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


class TradeUpdate(BaseModel):
    intraday_chg_at_buy: float | None = None
    holding_minutes: int | None = Field(None, ge=0)
    reason: str | None = None


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
    days: int = Query(30, ge=1, le=5000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from datetime import timedelta
    since = date_type.today() - timedelta(days=days)
    result = await db.execute(
        _real_trade_stmt(user.id, since)
        .order_by(UserTrade.trade_date.desc(), UserTrade.id.desc())
    )
    trades = list(result.scalars().all())
    await _autofill_reason_if_missing(db, trades)
    return trades


@router.put("/{trade_id}", response_model=TradeOut)
async def update_trade(
    trade_id: int,
    req: TradeUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    trade = await db.scalar(
        select(UserTrade).where(UserTrade.id == trade_id, UserTrade.user_id == user.id)
    )
    if not trade:
        raise HTTPException(404, "Trade not found")
    data = req.model_dump(exclude_unset=True)
    if "intraday_chg_at_buy" in data:
        trade.intraday_chg_at_buy = data["intraday_chg_at_buy"]
    if "holding_minutes" in data:
        trade.holding_minutes = data["holding_minutes"]
    if "reason" in data:
        trade.reason = data["reason"]
    await db.commit()
    await db.refresh(trade)
    return trade


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
    days: int = Query(30, ge=1, le=5000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """模式诊断 — 纯统计, 不调 LLM, 不计 quota."""
    from datetime import timedelta
    since = date_type.today() - timedelta(days=days)
    result = await db.execute(
        _real_trade_stmt(user.id, since)
        .order_by(UserTrade.trade_date.desc())
    )
    trades = result.scalars().all()
    pattern = diagnose_pattern(trades, days=days)
    pnl = await _account_pnl_since(db, user.id, since)
    pattern["total_pnl"] = pnl["closed_pnl"]
    pattern["closed_pnl"] = pnl["closed_pnl"]
    pattern["holding_pnl"] = pnl["holding_pnl"]
    pattern["account_pnl"] = pnl["account_pnl"]
    pattern["holding_from_initial_pnl"] = pnl["holding_from_initial_pnl"]
    pattern["holding_from_new_buys_pnl"] = pnl["holding_from_new_buys_pnl"]
    return pattern


@router.post("/ai-review")
async def post_ai_review(
    days: int = Query(30, ge=1, le=5000),
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
        _real_trade_stmt(user.id, since)
        .order_by(UserTrade.trade_date.desc())
    )
    trades = result.scalars().all()
    if not trades:
        raise HTTPException(400, "暂无交易记录, 先录入几笔")

    pattern = diagnose_pattern(trades, days=days)
    pnl = await _account_pnl_since(db, user.id, since)
    pattern["total_pnl"] = pnl["closed_pnl"]
    pattern["closed_pnl"] = pnl["closed_pnl"]
    pattern["holding_pnl"] = pnl["holding_pnl"]
    pattern["account_pnl"] = pnl["account_pnl"]
    pattern["holding_from_initial_pnl"] = pnl["holding_from_initial_pnl"]
    pattern["holding_from_new_buys_pnl"] = pnl["holding_from_new_buys_pnl"]
    review = await generate_ai_review(trades, pattern, model)
    return {"pattern": pattern, "review": review}
