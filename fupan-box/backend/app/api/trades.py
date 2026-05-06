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

# 同花顺历史成交截图不含费税列时的兜底估算参数（保守低佣金，避免过度扣减）。
_EST_COMMISSION_RATE = 0.0000377  # 约万0.377，贴近同花顺收益曲线的实盘净值口径
_EST_STAMP_TAX_RATE = 0.001     # 卖出千1


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


def _estimate_trade_fees(r: UserTradeRaw) -> tuple[float, float, float]:
    """返回 (fee, transfer_fee, stamp_tax) 的有效值.

    若 OCR 流水费税全为 0，则按成交额做保守估算，减少收益高估:
    - commission: 万0.4
    - stamp tax: 卖出千1
    """
    fee = float(r.fee or 0.0)
    transfer_fee = float(r.transfer_fee or 0.0)
    stamp_tax = float(r.stamp_tax or 0.0)

    if fee > 0 or transfer_fee > 0 or stamp_tax > 0:
        return fee, transfer_fee, stamp_tax

    amount = float(r.amount) if r.amount is not None else float(r.price) * float(r.qty)
    est_fee = amount * _EST_COMMISSION_RATE
    est_stamp = amount * _EST_STAMP_TAX_RATE if _is_sell(r.side) else 0.0
    return est_fee, 0.0, est_stamp


def _select_mirror_rows_to_skip(
    raws: list[UserTradeRaw],
    holdings_qty_by_key: dict[tuple[str, str], float],
) -> set[int]:
    """识别同一键上同时存在买卖的镜像行，选择一侧跳过.

    键定义: (code, account, date, time, price, qty)。该形态通常是 OCR 方向误判噪声。
    选择规则: 以当前持仓数量为目标，优先删除能让净仓位更接近目标的一侧。
    """
    mirrors: dict[
        tuple[str, str, date_type, str | None, float, int],
        dict[str, list[UserTradeRaw]],
    ] = defaultdict(lambda: {"buy": [], "sell": []})
    net_qty_by_key: dict[tuple[str, str], float] = defaultdict(float)

    for r in raws:
        key_pos = (str(r.stock_code), str(r.account_label or "default"))
        if _is_buy(r.side):
            net_qty_by_key[key_pos] += float(r.qty)
            side = "buy"
        elif _is_sell(r.side):
            net_qty_by_key[key_pos] -= float(r.qty)
            side = "sell"
        else:
            continue
        mk = (
            key_pos[0],
            key_pos[1],
            r.trade_date,
            r.trade_time,
            float(r.price),
            int(r.qty),
        )
        mirrors[mk][side].append(r)

    # 按时间顺序处理，保持结果稳定。
    mirror_keys = sorted(
        mirrors.keys(),
        key=lambda k: (k[2], k[3] or "", k[0], k[5], k[4]),
    )

    skip_ids: set[int] = set()
    for mk in mirror_keys:
        bucket = mirrors[mk]
        buys = bucket["buy"]
        sells = bucket["sell"]
        n = min(len(buys), len(sells))
        if n <= 0:
            continue

        key_pos = (mk[0], mk[1])
        qty = float(mk[5] or 0)
        target = float(holdings_qty_by_key.get(key_pos, 0.0))
        cur_net = float(net_qty_by_key.get(key_pos, 0.0))

        # 需要增大净仓位 => 删 sell；反之删 buy。
        drop_side = "sell" if (target - cur_net) >= 0 else "buy"
        chosen = sells if drop_side == "sell" else buys
        for r in chosen[:n]:
            skip_ids.add(int(r.id))
        if drop_side == "sell":
            net_qty_by_key[key_pos] += qty * n
        else:
            net_qty_by_key[key_pos] -= qty * n

    return skip_ids


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
    holdings_qty_by_key = {
        (str(h.stock_code), str(h.account_label or "default")): float(h.qty or 0.0)
        for h in holdings
    }

    skip_raw_ids = _select_mirror_rows_to_skip(raws, holdings_qty_by_key)
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
    pre_lots: dict[tuple[str, str], deque[dict[str, float | date_type]]] = defaultdict(deque)
    # 区间内已平仓盈亏(严格口径): 起点前底仓按锚定价计, 区间内新开仓按买入成本计.
    closed_pnl = 0.0
    old_sell_realized_pnl = 0.0
    old_lot_sell_chunks: list[tuple[tuple[str, str], float, float]] = []

    for r in raws:
        if int(r.id) in skip_raw_ids:
            continue
        key = (str(r.stock_code), str(r.account_label or "default"))
        if r.trade_date < since:
            if _is_buy(r.side):
                total_cost_pre = float(r.price) * float(r.qty) + float(r.fee or 0.0) + float(r.transfer_fee or 0.0) + float(r.stamp_tax or 0.0)
                unit_cost_pre = (total_cost_pre / float(r.qty)) if r.qty else float(r.price)
                pre_lots[key].append({
                    "buy_date": r.trade_date,
                    "buy_price": unit_cost_pre,
                    "qty_left": float(r.qty),
                })
            elif _is_sell(r.side):
                need_pre = float(r.qty)
                q_pre = pre_lots[key]
                while need_pre > 0 and q_pre:
                    lot_pre = q_pre[0]
                    take_pre = min(need_pre, float(lot_pre["qty_left"]))
                    left_pre = float(lot_pre["qty_left"]) - take_pre
                    need_pre -= take_pre
                    if left_pre <= 0:
                        q_pre.popleft()
                    else:
                        lot_pre["qty_left"] = left_pre
        if _is_buy(r.side):
            fee, transfer_fee, stamp_tax = _estimate_trade_fees(r)
            total_cost = float(r.price) * float(r.qty) + fee + transfer_fee + stamp_tax
            unit_cost = (total_cost / float(r.qty)) if r.qty else float(r.price)
            lots[key].append({
                "buy_date": r.trade_date,
                "buy_price": unit_cost,
                "qty_left": float(r.qty),
            })
            continue
        if not _is_sell(r.side):
            continue
        need = float(r.qty)
        fee, transfer_fee, stamp_tax = _estimate_trade_fees(r)
        total_net = float(r.price) * float(r.qty) - fee - transfer_fee - stamp_tax
        sell_px = (total_net / float(r.qty)) if r.qty else float(r.price)
        q = lots[key]
        while need > 0 and q:
            lot = q[0]
            lot_qty = float(lot["qty_left"])
            take = min(need, lot_qty)
            if r.trade_date >= since:
                buy_date = lot["buy_date"]
                if isinstance(buy_date, date_type) and buy_date < since:
                    old_lot_sell_chunks.append((key, take, float(lot["buy_price"])))
                    old_sell_realized_pnl += (sell_px - float(lot["buy_price"])) * take
                else:
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
    open_old_qty_by_key: dict[tuple[str, str], float] = defaultdict(float)
    open_new_qty_by_key: dict[tuple[str, str], float] = defaultdict(float)
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
                open_new_qty_by_key[key] += qty
            else:
                open_old_lots.append((key, qty, buy_px))
                open_old_qty_by_key[key] += qty

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

    old_codes = sorted(
        {k[0] for k, _, _ in open_old_lots}
        | {k[0] for k, _, _ in old_lot_sell_chunks}
        | {str(h.stock_code) for h in holdings if (h.qty or 0) > 0}
    )
    anchor_px_map = await _anchor_quote_map(db, old_codes, since)

    open_initial_pnl = 0.0
    for key, qty, buy_px in open_old_lots:
        code = key[0]
        cur = current_price_by_key.get(key) or current_price_by_code.get(code)
        if cur is None:
            continue
        anchor_px = anchor_px_map.get(code, buy_px)
        open_initial_pnl += (cur - anchor_px) * qty

    pre_qty_by_key: dict[tuple[str, str], float] = {
        key: sum(float(lot["qty_left"]) for lot in q if float(lot["qty_left"]) > 0)
        for key, q in pre_lots.items()
    }

    # 用当前持仓做终态约束，补齐「流水未能回放出的剩余仓位」:
    # - end_qty 来自 UserHolding(当前真实持仓)
    # - lot_end_qty 来自 raw FIFO 回放后的剩余
    # 差额 uncovered_qty 说明 raw 覆盖不足或中间有噪声行，需补计入区间浮盈。
    for h in holdings:
        key = (str(h.stock_code), str(h.account_label or "default"))
        end_qty = float(h.qty or 0)
        if end_qty <= 0:
            continue
        lot_old = float(open_old_qty_by_key.get(key, 0.0))
        lot_new = float(open_new_qty_by_key.get(key, 0.0))
        lot_end = lot_old + lot_new
        uncovered_qty = end_qty - lot_end
        if uncovered_qty <= 1e-9:
            continue

        code = key[0]
        cur = current_price_by_key.get(key) or current_price_by_code.get(code)
        if cur is None:
            continue

        pre_qty = float(pre_qty_by_key.get(key, 0.0))
        missing_initial_qty = max(0.0, pre_qty - lot_old)
        fill_initial_qty = min(uncovered_qty, missing_initial_qty)
        fill_new_qty = max(0.0, uncovered_qty - fill_initial_qty)

        if fill_initial_qty > 0:
            anchor_px = anchor_px_map.get(code, cur)
            open_initial_pnl += (cur - anchor_px) * fill_initial_qty
        if fill_new_qty > 0:
            avg_cost = float(h.avg_cost) if h.avg_cost is not None else cur
            open_new_pnl += (cur - avg_cost) * fill_new_qty

    # 起点前底仓在区间内卖出: 只计 "区间内" 收益, 即 (卖出净价 - 区间锚定价) * 数量.
    old_sell_anchor_basis = 0.0
    old_sell_buy_basis = 0.0
    for key, qty, buy_px in old_lot_sell_chunks:
        code = key[0]
        anchor_px = anchor_px_map.get(code)
        if anchor_px is None:
            # 没有锚定价时, 回退到原口径 (卖出 - 买入), 避免静默丢失收益.
            continue
        old_sell_anchor_basis += anchor_px * qty
        old_sell_buy_basis += buy_px * qty
    if old_lot_sell_chunks:
        closed_pnl = closed_pnl + old_sell_realized_pnl - (old_sell_anchor_basis - old_sell_buy_basis)

    # 区间口径: 统计该时间窗口内的全部盈亏变化。
    # 包含:
    # 1) 起点前底仓在窗口内的浮盈变化(open_initial_pnl)
    # 2) 窗口内新开仓未平部分的浮盈(open_new_pnl)
    holding_pnl = open_initial_pnl + open_new_pnl
    return {
        "closed_pnl": round(closed_pnl, 2),
        "holding_pnl": round(holding_pnl, 2),
        "account_pnl": round(closed_pnl + holding_pnl, 2),
        "holding_from_initial_pnl": round(open_initial_pnl, 2),
        "holding_from_new_buys_pnl": round(open_new_pnl, 2),
    }


async def _current_holdings_pnl(db: AsyncSession, user_id: int) -> float:
    v = await db.scalar(
        select(func.coalesce(func.sum(UserHolding.pnl), 0)).where(UserHolding.user_id == user_id)
    )
    return round(float(v or 0.0), 2)


async def _earliest_real_raw_trade_date(db: AsyncSession, user_id: int) -> date_type | None:
    return await db.scalar(
        select(func.min(UserTradeRaw.trade_date)).where(
            UserTradeRaw.user_id == user_id,
            UserTradeRaw.source != "virtual_initial",
        )
    )


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
    if days >= 3650:
        earliest = await _earliest_real_raw_trade_date(db, user.id)
        if earliest is not None:
            since = earliest
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
    pattern["holdings_snapshot_pnl"] = await _current_holdings_pnl(db, user.id)
    pattern["account_vs_holdings_diff"] = round(
        float(pattern["account_pnl"]) - float(pattern["holdings_snapshot_pnl"]),
        2,
    )
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
    if days >= 3650:
        earliest = await _earliest_real_raw_trade_date(db, user.id)
        if earliest is not None:
            since = earliest
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
    pattern["holdings_snapshot_pnl"] = await _current_holdings_pnl(db, user.id)
    pattern["account_vs_holdings_diff"] = round(
        float(pattern["account_pnl"]) - float(pattern["holdings_snapshot_pnl"]),
        2,
    )
    review = await generate_ai_review(trades, pattern, model)
    return {"pattern": pattern, "review": review}
