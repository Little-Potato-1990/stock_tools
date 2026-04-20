from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import date
from app.database import get_db
from app.models.snapshot import DailySnapshot, DataUpdateLog

router = APIRouter()


@router.get("/{snapshot_type}")
async def get_snapshot(
    snapshot_type: str,
    trade_date: date = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """获取预聚合快照，前端直接消费"""
    valid_types = ["overview", "ladder", "themes", "industries", "theme_cons", "lhb"]
    if snapshot_type not in valid_types:
        raise HTTPException(400, f"snapshot_type must be one of {valid_types}")

    query = (
        select(DailySnapshot)
        .where(DailySnapshot.snapshot_type == snapshot_type)
        .order_by(DailySnapshot.trade_date.desc())
    )
    if trade_date:
        query = query.where(DailySnapshot.trade_date == trade_date)
    else:
        query = query.limit(1)

    result = await db.execute(query)
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "No snapshot data found")
    return {
        "trade_date": str(row.trade_date),
        "type": row.snapshot_type,
        "data": row.data,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/{snapshot_type}/range")
async def get_snapshot_range(
    snapshot_type: str,
    days: int = Query(5, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
):
    """获取最近 N 天的预聚合快照"""
    query = (
        select(DailySnapshot)
        .where(DailySnapshot.snapshot_type == snapshot_type)
        .order_by(DailySnapshot.trade_date.desc())
        .limit(days)
    )
    result = await db.execute(query)
    rows = result.scalars().all()
    return [
        {
            "trade_date": str(r.trade_date),
            "type": r.snapshot_type,
            "data": r.data,
        }
        for r in rows
    ]


@router.get("/lhb/office-history")
async def get_office_history(
    exalter: str = Query(..., description="营业部名称"),
    days: int = Query(30, ge=1, le=120, description="回溯多少天"),
    db: AsyncSession = Depends(get_db),
):
    """单个营业部的历史交易记录（跨日聚合 lhb snapshot）。"""
    query = (
        select(DailySnapshot)
        .where(DailySnapshot.snapshot_type == "lhb")
        .order_by(DailySnapshot.trade_date.desc())
        .limit(days)
    )
    result = await db.execute(query)
    rows = result.scalars().all()

    records = []
    total_buy = total_sell = total_net = 0.0
    appearance = 0
    for row in rows:
        insts_by_code: dict = row.data.get("insts_by_code", {}) or {}
        stocks_meta = {s["stock_code"]: s for s in row.data.get("stocks", [])}
        for code, inst_arr in insts_by_code.items():
            for it in inst_arr:
                if it.get("exalter") != exalter:
                    continue
                meta = stocks_meta.get(code, {})
                records.append({
                    "trade_date": str(row.trade_date),
                    "stock_code": code,
                    "stock_name": meta.get("stock_name", ""),
                    "pct_change": meta.get("pct_change", 0),
                    "side": it.get("side", 0),
                    "buy": it.get("buy", 0),
                    "sell": it.get("sell", 0),
                    "net_buy": it.get("net_buy", 0),
                    "reason": it.get("reason", ""),
                })
                total_buy += it.get("buy", 0)
                total_sell += it.get("sell", 0)
                total_net += it.get("net_buy", 0)
                appearance += 1
    return {
        "exalter": exalter,
        "days": days,
        "appearance": appearance,
        "total_buy": total_buy,
        "total_sell": total_sell,
        "total_net_buy": total_net,
        "records": records,
    }


@router.get("/lhb/hot-money")
async def get_hot_money_rank(
    days: int = Query(30, ge=1, le=120),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """游资榜聚合：跨 N 天合计每个营业部上榜次数 + 累计净买入。"""
    query = (
        select(DailySnapshot)
        .where(DailySnapshot.snapshot_type == "lhb")
        .order_by(DailySnapshot.trade_date.desc())
        .limit(days)
    )
    result = await db.execute(query)
    rows = result.scalars().all()

    agg: dict[str, dict] = {}
    for row in rows:
        for hm in row.data.get("hot_money_top", []) or []:
            name = hm.get("exalter", "")
            if not name:
                continue
            rec = agg.setdefault(name, {
                "exalter": name,
                "days_active": 0,
                "appearance": 0,
                "buy_total": 0.0,
                "sell_total": 0.0,
                "net_buy_total": 0.0,
                "stocks": set(),
            })
            rec["days_active"] += 1
            rec["appearance"] += hm.get("appearance", 0)
            rec["buy_total"] += hm.get("buy_total", 0)
            rec["sell_total"] += hm.get("sell_total", 0)
            rec["net_buy_total"] += hm.get("net_buy_total", 0)
            for s in hm.get("stocks", []):
                rec["stocks"].add(s.get("stock_code"))

    # 转 set 为 count
    out = []
    for rec in agg.values():
        out.append({
            "exalter": rec["exalter"],
            "days_active": rec["days_active"],
            "appearance": rec["appearance"],
            "buy_total": rec["buy_total"],
            "sell_total": rec["sell_total"],
            "net_buy_total": rec["net_buy_total"],
            "stock_count": len(rec["stocks"]),
        })
    out.sort(key=lambda x: x["net_buy_total"], reverse=True)
    return {"days": days, "limit": limit, "rank": out[:limit]}


@router.get("/status/update-log")
async def get_update_status(
    trade_date: date = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """数据更新状态，前端展示『数据更新至 XX 时间』"""
    query = select(DataUpdateLog).order_by(DataUpdateLog.started_at.desc())
    if trade_date:
        query = query.where(DataUpdateLog.trade_date == trade_date)
    query = query.limit(10)
    result = await db.execute(query)
    rows = result.scalars().all()
    return [
        {
            "trade_date": str(r.trade_date),
            "step": r.step,
            "status": r.status,
            "started_at": r.started_at.isoformat(),
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            "records_count": r.records_count,
            "error_message": r.error_message,
        }
        for r in rows
    ]


_CORE_SNAP_TYPES = ["overview", "ladder", "themes", "industries"]


@router.get("/status/health")
async def get_health_status(db: AsyncSession = Depends(get_db)):
    """聚合数据健康状态: 最新数据日期, 是否齐全, 上次管线时间."""
    from datetime import datetime, date as ddate
    from sqlalchemy import func, distinct

    latest_date_q = await db.execute(
        select(func.max(DailySnapshot.trade_date)).where(
            DailySnapshot.snapshot_type == "overview"
        )
    )
    latest_date = latest_date_q.scalar()

    snap_types: list[str] = []
    if latest_date:
        types_q = await db.execute(
            select(distinct(DailySnapshot.snapshot_type)).where(
                DailySnapshot.trade_date == latest_date
            )
        )
        snap_types = [r for r in types_q.scalars().all() if r]

    missing = [t for t in _CORE_SNAP_TYPES if t not in snap_types]
    ready = bool(latest_date) and not missing

    last_pipeline_q = await db.execute(
        select(DataUpdateLog)
        .where(DataUpdateLog.step == "aggregate", DataUpdateLog.status == "success")
        .order_by(DataUpdateLog.finished_at.desc().nullslast())
        .limit(1)
    )
    last = last_pipeline_q.scalar_one_or_none()

    last_failure_q = await db.execute(
        select(DataUpdateLog)
        .where(DataUpdateLog.status == "failed")
        .order_by(DataUpdateLog.started_at.desc())
        .limit(1)
    )
    last_failure = last_failure_q.scalar_one_or_none()

    today = ddate.today()
    today_ready = bool(latest_date and latest_date >= today)

    if today_ready and ready:
        status = "ok"
    elif ready:
        status = "stale"
    elif latest_date:
        status = "partial"
    else:
        status = "empty"

    stale_minutes: int | None = None
    if last and last.finished_at:
        stale_minutes = int((datetime.now() - last.finished_at).total_seconds() // 60)

    return {
        "status": status,
        "latest_trade_date": latest_date.isoformat() if latest_date else None,
        "today": today.isoformat(),
        "today_ready": today_ready,
        "ready": ready,
        "snapshot_types": sorted(snap_types),
        "missing": missing,
        "last_pipeline": (
            {
                "trade_date": last.trade_date.isoformat() if last else None,
                "finished_at": last.finished_at.isoformat() if last and last.finished_at else None,
                "records_count": last.records_count if last else 0,
            }
            if last
            else None
        ),
        "last_failure": (
            {
                "trade_date": last_failure.trade_date.isoformat(),
                "step": last_failure.step,
                "started_at": last_failure.started_at.isoformat(),
                "error_message": last_failure.error_message,
            }
            if last_failure
            else None
        ),
        "stale_minutes": stale_minutes,
    }
