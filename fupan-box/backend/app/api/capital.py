"""资金维度 HTTP 端点 (挂在 /api/market/capital 前缀, 单文件聚合便于维护).

12 个端点:
    market         - 大盘资金流(N 日)
    north          - 北向当日 + 历史
    north/holds    - 北向单股持仓 Top
    concept        - 概念板块主力净流入榜
    industry       - 行业板块主力净流入榜
    stock-rank     - 个股主力净流入榜(支持多维过滤)
    limit-order    - 涨停封单按题材
    etf            - ETF 净申购榜(国家队代理)
    announce       - 公告事件流(增减持/回购/举牌)
    holders        - 主力持仓追踪(按身份/股票)
    movements      - 主力身份动向(季报变动汇总)
    summary        - 一句话当日资金概览(给 CapitalPage 顶部 summary bar)
"""
from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, desc, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.capital import (
    CapitalFlowDaily, NorthHoldDaily, EtfFlowDaily, AnnouncementEvent,
)
from app.models.holder import HolderSnapshotQuarterly
from app.api._cache import cached_call


router = APIRouter()


async def _latest_capital_date(db: AsyncSession) -> date | None:
    r = await db.execute(select(func.max(CapitalFlowDaily.trade_date)))
    return r.scalar_one_or_none()


# 1. 大盘资金流(近 N 日)
@router.get("/market")
async def capital_market(
    days: int = Query(10, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(
        select(CapitalFlowDaily)
        .where(CapitalFlowDaily.scope == "market")
        .order_by(CapitalFlowDaily.trade_date.desc())
        .limit(days)
    )
    rows = r.scalars().all()
    return [
        {"trade_date": x.trade_date.isoformat(), **(x.data or {})}
        for x in rows
    ]


# 2. 北向资金当日 + 近 N 日趋势
@router.get("/north")
async def capital_north(
    days: int = Query(20, ge=1, le=120),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(
        select(CapitalFlowDaily)
        .where(CapitalFlowDaily.scope == "north")
        .order_by(CapitalFlowDaily.trade_date.desc())
        .limit(days)
    )
    rows = r.scalars().all()
    return [
        {"trade_date": x.trade_date.isoformat(), **(x.data or {})}
        for x in rows
    ]


# 3. 北向单股持仓 Top
@router.get("/north/holds")
async def capital_north_holds(
    trade_date: date | None = Query(None),
    top: int = Query(50, ge=1, le=300),
    sort: str = Query("amount", pattern="^(amount|chg_5d|hold_pct)$"),
    db: AsyncSession = Depends(get_db),
):
    if not trade_date:
        r = await db.execute(select(func.max(NorthHoldDaily.trade_date)))
        trade_date = r.scalar_one_or_none()
    if not trade_date:
        return []

    if sort == "chg_5d":
        # 取该 date 所有, 加 5 日前持仓做差(简化: 直接按当日 chg_amount)
        col = NorthHoldDaily.chg_amount.desc().nullslast()
    elif sort == "hold_pct":
        col = NorthHoldDaily.hold_pct.desc().nullslast()
    else:
        col = NorthHoldDaily.hold_amount.desc().nullslast()

    r = await db.execute(
        select(NorthHoldDaily)
        .where(NorthHoldDaily.trade_date == trade_date)
        .order_by(col)
        .limit(top)
    )
    rows = r.scalars().all()
    return [
        {
            "trade_date": x.trade_date.isoformat(),
            "stock_code": x.stock_code,
            "stock_name": x.stock_name,
            "hold_shares": x.hold_shares,
            "hold_amount": x.hold_amount,
            "hold_pct": x.hold_pct,
            "chg_shares": x.chg_shares,
            "chg_amount": x.chg_amount,
        }
        for x in rows
    ]


# 4. 概念主力净流入榜
@router.get("/concept")
async def capital_concept(
    trade_date: date | None = Query(None),
    top: int = Query(30, ge=1, le=200),
    direction: str = Query("inflow", pattern="^(inflow|outflow)$"),
    db: AsyncSession = Depends(get_db),
):
    if not trade_date:
        trade_date = await _latest_capital_date(db)
    if not trade_date:
        return []
    r = await db.execute(
        select(CapitalFlowDaily)
        .where(
            CapitalFlowDaily.scope == "concept",
            CapitalFlowDaily.trade_date == trade_date,
        )
    )
    rows = r.scalars().all()
    items = [{"name": x.scope_key, **(x.data or {})} for x in rows]
    items.sort(
        key=lambda d: d.get("main_inflow", 0) or 0,
        reverse=(direction == "inflow"),
    )
    return items[:top]


# 5. 行业主力净流入榜
@router.get("/industry")
async def capital_industry(
    trade_date: date | None = Query(None),
    top: int = Query(30, ge=1, le=200),
    direction: str = Query("inflow", pattern="^(inflow|outflow)$"),
    db: AsyncSession = Depends(get_db),
):
    if not trade_date:
        trade_date = await _latest_capital_date(db)
    if not trade_date:
        return []
    r = await db.execute(
        select(CapitalFlowDaily)
        .where(
            CapitalFlowDaily.scope == "industry",
            CapitalFlowDaily.trade_date == trade_date,
        )
    )
    rows = r.scalars().all()
    items = [{"name": x.scope_key, **(x.data or {})} for x in rows]
    items.sort(
        key=lambda d: d.get("main_inflow", 0) or 0,
        reverse=(direction == "inflow"),
    )
    return items[:top]


# 6. 个股主力净流入榜 + 多维过滤
@router.get("/stock-rank")
async def capital_stock_rank(
    trade_date: date | None = Query(None),
    top: int = Query(50, ge=1, le=300),
    direction: str = Query("inflow", pattern="^(inflow|outflow)$"),
    min_change_pct: float | None = Query(None, description="过滤涨跌幅下限(%)"),
    max_change_pct: float | None = Query(None),
    has_north: bool = Query(False, description="仅返回北向重仓股"),
    db: AsyncSession = Depends(get_db),
):
    if not trade_date:
        trade_date = await _latest_capital_date(db)
    if not trade_date:
        return []

    r = await db.execute(
        select(CapitalFlowDaily)
        .where(
            CapitalFlowDaily.scope == "stock",
            CapitalFlowDaily.trade_date == trade_date,
        )
    )
    rows = r.scalars().all()
    items = [
        {"stock_code": x.scope_key, **(x.data or {})}
        for x in rows
    ]

    if min_change_pct is not None:
        items = [it for it in items if (it.get("change_pct") or 0) >= min_change_pct]
    if max_change_pct is not None:
        items = [it for it in items if (it.get("change_pct") or 0) <= max_change_pct]

    if has_north:
        nr = await db.execute(
            select(NorthHoldDaily.stock_code)
            .where(NorthHoldDaily.trade_date == trade_date)
        )
        north_set = {row[0] for row in nr.all()}
        items = [it for it in items if it["stock_code"] in north_set]

    items.sort(
        key=lambda d: d.get("main_inflow", 0) or 0,
        reverse=(direction == "inflow"),
    )
    return items[:top]


# 7. 涨停封单按题材
@router.get("/limit-order")
async def capital_limit_order(
    trade_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    if not trade_date:
        trade_date = await _latest_capital_date(db)
    if not trade_date:
        return []
    r = await db.execute(
        select(CapitalFlowDaily)
        .where(
            CapitalFlowDaily.scope == "limit_order",
            CapitalFlowDaily.trade_date == trade_date,
        )
        .order_by(desc(CapitalFlowDaily.id))
    )
    rows = r.scalars().all()
    items = [{"theme": x.scope_key, **(x.data or {})} for x in rows]
    items.sort(key=lambda d: d.get("limit_order_total", 0) or 0, reverse=True)
    return items


# 8. ETF 净申购榜(国家队代理)
@router.get("/etf")
async def capital_etf(
    trade_date: date | None = Query(None),
    category: str | None = Query(None, description="national_team_broad / national_team_industry / dividend / other"),
    top: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    if not trade_date:
        r = await db.execute(select(func.max(EtfFlowDaily.trade_date)))
        trade_date = r.scalar_one_or_none()
    if not trade_date:
        return []
    q = select(EtfFlowDaily).where(EtfFlowDaily.trade_date == trade_date)
    if category:
        q = q.where(EtfFlowDaily.category == category)
    q = q.order_by(EtfFlowDaily.inflow_estimate.desc().nullslast()).limit(top)
    r = await db.execute(q)
    rows = r.scalars().all()
    return [
        {
            "trade_date": x.trade_date.isoformat(),
            "etf_code": x.etf_code,
            "etf_name": x.etf_name,
            "category": x.category,
            "shares_change": x.shares_change,
            "inflow_estimate": x.inflow_estimate,
            "amount": x.amount,
            "close": x.close,
            "change_pct": x.change_pct,
            "premium_rate": x.premium_rate,
        }
        for x in rows
    ]


# 9. 公告事件流
@router.get("/announce")
async def capital_announce(
    days: int = Query(7, ge=1, le=60),
    event_type: str | None = Query(None),
    actor_type: str | None = Query(None),
    top: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    end = date.today()
    start = end - timedelta(days=days)
    q = select(AnnouncementEvent).where(
        AnnouncementEvent.trade_date.between(start, end)
    )
    if event_type:
        q = q.where(AnnouncementEvent.event_type == event_type)
    if actor_type:
        q = q.where(AnnouncementEvent.actor_type == actor_type)
    q = q.order_by(AnnouncementEvent.trade_date.desc()).limit(top)
    r = await db.execute(q)
    rows = r.scalars().all()
    return [
        {
            "id": x.id,
            "trade_date": x.trade_date.isoformat(),
            "stock_code": x.stock_code,
            "stock_name": x.stock_name,
            "event_type": x.event_type,
            "actor": x.actor,
            "actor_type": x.actor_type,
            "scale": x.scale,
            "shares": x.shares,
            "progress": x.progress,
            "tags": x.tags,
        }
        for x in rows
    ]


# 10. 主力持仓追踪——按 canonical_name(汇金 / 社保 / 等)看持仓股票列表
@router.get("/holders")
async def capital_holders(
    canonical: str | None = Query(None, description="主力名 e.g. 中央汇金"),
    holder_type: str | None = Query(None, description="sovereign/social/insurance/qfii/fund"),
    top: int = Query(50, ge=1, le=300),
    report_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    if not report_date:
        r = await db.execute(select(func.max(HolderSnapshotQuarterly.report_date)))
        report_date = r.scalar_one_or_none()
    if not report_date:
        return []

    q = select(HolderSnapshotQuarterly).where(
        HolderSnapshotQuarterly.report_date == report_date,
    )
    if canonical:
        q = q.where(HolderSnapshotQuarterly.canonical_name == canonical)
    elif holder_type:
        q = q.where(HolderSnapshotQuarterly.holder_type == holder_type)
    else:
        q = q.where(HolderSnapshotQuarterly.canonical_name.is_not(None))
    q = q.order_by(HolderSnapshotQuarterly.shares_pct.desc().nullslast()).limit(top)

    r = await db.execute(q)
    rows = r.scalars().all()
    return [
        {
            "report_date": x.report_date.isoformat(),
            "stock_code": x.stock_code,
            "stock_name": x.stock_name,
            "holder_name": x.holder_name,
            "canonical_name": x.canonical_name,
            "holder_type": x.holder_type,
            "fund_company": x.fund_company,
            "is_free_float": x.is_free_float,
            "rank": x.rank,
            "shares": x.shares,
            "shares_pct": x.shares_pct,
            "change_shares": x.change_shares,
            "change_type": x.change_type,
        }
        for x in rows
    ]


# 11. 主力身份动向汇总——本季度 vs 上季度变动
@router.get("/movements")
async def capital_movements(
    holder_type: str | None = Query(None),
    canonical: str | None = Query(None),
    change_type: str | None = Query("add", pattern="^(new|add|cut|exit|unchanged)$"),
    top: int = Query(50, ge=1, le=300),
    report_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    if not report_date:
        r = await db.execute(select(func.max(HolderSnapshotQuarterly.report_date)))
        report_date = r.scalar_one_or_none()
    if not report_date:
        return []

    q = select(HolderSnapshotQuarterly).where(
        HolderSnapshotQuarterly.report_date == report_date,
        HolderSnapshotQuarterly.canonical_name.is_not(None),
    )
    if change_type:
        q = q.where(HolderSnapshotQuarterly.change_type == change_type)
    if holder_type:
        q = q.where(HolderSnapshotQuarterly.holder_type == holder_type)
    if canonical:
        q = q.where(HolderSnapshotQuarterly.canonical_name == canonical)
    q = q.order_by(HolderSnapshotQuarterly.change_shares.desc().nullslast()).limit(top)

    r = await db.execute(q)
    rows = r.scalars().all()
    return [
        {
            "report_date": x.report_date.isoformat(),
            "stock_code": x.stock_code,
            "stock_name": x.stock_name,
            "canonical_name": x.canonical_name,
            "holder_type": x.holder_type,
            "fund_company": x.fund_company,
            "rank": x.rank,
            "shares_pct": x.shares_pct,
            "change_shares": x.change_shares,
            "change_type": x.change_type,
        }
        for x in rows
    ]


# 12. 当日资金概览(给 CapitalPage 顶部 summary bar 用)
@router.get("/summary")
async def capital_summary(
    trade_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    if not trade_date:
        trade_date = await _latest_capital_date(db)
    if not trade_date:
        return {"trade_date": None}

    async def _build():
        out: dict = {"trade_date": trade_date.isoformat()}
        # 大盘
        r = await db.execute(
            select(CapitalFlowDaily).where(
                CapitalFlowDaily.scope == "market",
                CapitalFlowDaily.trade_date == trade_date,
            )
        )
        m = r.scalar_one_or_none()
        out["market"] = m.data if m else None

        # 北向
        r = await db.execute(
            select(CapitalFlowDaily).where(
                CapitalFlowDaily.scope == "north",
                CapitalFlowDaily.trade_date == trade_date,
            )
        )
        n = r.scalar_one_or_none()
        out["north"] = n.data if n else None

        # 概念 / 行业 Top3 inflow + Top3 outflow
        for scope, key in [("concept", "concept"), ("industry", "industry")]:
            r = await db.execute(
                select(CapitalFlowDaily).where(
                    CapitalFlowDaily.scope == scope,
                    CapitalFlowDaily.trade_date == trade_date,
                )
            )
            items = sorted(
                [{"name": x.scope_key, **(x.data or {})} for x in r.scalars().all()],
                key=lambda d: d.get("main_inflow", 0) or 0, reverse=True,
            )
            out[f"{key}_top_inflow"] = items[:3]
            out[f"{key}_top_outflow"] = items[-3:][::-1]

        # ETF 国家队代理
        r = await db.execute(
            select(EtfFlowDaily).where(
                EtfFlowDaily.trade_date == trade_date,
                EtfFlowDaily.category == "national_team_broad",
            )
        )
        etfs = r.scalars().all()
        out["national_team_etf"] = {
            "total_inflow": round(sum((x.inflow_estimate or 0) for x in etfs), 0),
            "etf_count": len(etfs),
        }

        # 公告事件计数(过去 1 日)
        r = await db.execute(
            select(AnnouncementEvent.event_type, func.count())
            .where(AnnouncementEvent.trade_date == trade_date)
            .group_by(AnnouncementEvent.event_type)
        )
        out["announce_count"] = {k: v for k, v in r.all()}

        return out

    return await cached_call(("capital_summary", trade_date.isoformat()), _build, ttl=180.0)
