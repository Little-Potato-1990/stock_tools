"""盘中异动 API.

GET  /api/intraday/anomalies          列最近 N 条 (含未读计数)
GET  /api/intraday/anomalies/unseen-count  顶栏小红点
GET  /api/intraday/anomalies/{id}     详情 + LLM 解读 (按需调 LLM, 缓存到 ai_brief 字段)
POST /api/intraday/anomalies/seen     批量标已读
POST /api/intraday/scan               手动触发扫描 (开发/调试)
"""
from __future__ import annotations

from datetime import datetime, timedelta, date as date_type
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, update, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.intraday.anomaly_brief import generate_anomaly_brief
from app.intraday.anomaly_detector import scan_once
from app.intraday.labels import label_anomaly
from app.models.anomaly import IntradayAnomaly

router = APIRouter()


def _row_to_dict(r: IntradayAnomaly) -> dict[str, Any]:
    return {
        "id": r.id,
        "trade_date": r.trade_date.isoformat(),
        "detected_at": r.detected_at.isoformat(),
        "anomaly_type": r.anomaly_type,
        "anomaly_label": label_anomaly(r.anomaly_type),
        "code": r.code,
        "name": r.name,
        "theme": r.theme,
        "price": r.price,
        "change_pct": r.change_pct,
        "delta_5m_pct": r.delta_5m_pct,
        "volume_yi": r.volume_yi,
        "severity": r.severity,
        "ai_brief": r.ai_brief,
        "seen": r.seen,
    }


@router.get("/anomalies")
async def list_anomalies(
    limit: int = Query(50, ge=1, le=200),
    min_severity: int = Query(1, ge=1, le=5),
    trade_date: date_type | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(IntradayAnomaly).where(IntradayAnomaly.severity >= min_severity)
    if trade_date:
        q = q.where(IntradayAnomaly.trade_date == trade_date)
    q = q.order_by(desc(IntradayAnomaly.detected_at)).limit(limit)
    result = await db.execute(q)
    rows = result.scalars().all()
    return [_row_to_dict(r) for r in rows]


@router.get("/anomalies/unseen-count")
async def unseen_count(db: AsyncSession = Depends(get_db)):
    today = date_type.today()
    cnt = await db.scalar(
        select(func.count(IntradayAnomaly.id)).where(
            IntradayAnomaly.trade_date == today,
            IntradayAnomaly.seen == False,  # noqa: E712
            IntradayAnomaly.severity >= 3,
        )
    )
    return {"trade_date": today.isoformat(), "unseen": int(cnt or 0)}


@router.get("/anomalies/{anom_id}")
async def get_anomaly_detail(
    anom_id: int,
    refresh_brief: int = Query(0),
    model: str = Query("deepseek-v3"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(IntradayAnomaly).where(IntradayAnomaly.id == anom_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Anomaly not found")
    base = _row_to_dict(row)

    if not base["ai_brief"] or refresh_brief:
        try:
            brief_out = await generate_anomaly_brief(anom_id, model)
            base["ai_brief"] = brief_out.get("brief")
            base["context"] = brief_out.get("context")
        except Exception as e:
            base["ai_brief_error"] = str(e)

    return base


class SeenReq(BaseModel):
    ids: list[int] | None = None
    all_today: bool = False


@router.post("/anomalies/seen")
async def mark_seen(req: SeenReq, db: AsyncSession = Depends(get_db)):
    if req.all_today:
        today = date_type.today()
        await db.execute(
            update(IntradayAnomaly)
            .where(IntradayAnomaly.trade_date == today, IntradayAnomaly.seen == False)  # noqa: E712
            .values(seen=True)
        )
    elif req.ids:
        await db.execute(
            update(IntradayAnomaly)
            .where(IntradayAnomaly.id.in_(req.ids))
            .values(seen=True)
        )
    else:
        raise HTTPException(400, "Provide ids or all_today=true")
    await db.commit()
    return {"ok": True}


@router.post("/scan")
async def trigger_scan(
    fake: int = Query(0, description="1=注入 mock 数据 (用于离线测试)"),
):
    """手动触发一次扫描. 调试 / 离线 mock 用."""
    if fake:
        from app.intraday.anomaly_detector import _SNAPSHOT_WINDOW
        import time as time_mod
        now = time_mod.time()
        # 注入两份模拟 spot: 5min 前涨幅都低, 现在拉升 / 跳水 / 炸板
        prev_snap = {
            "600519": {"name": "贵州茅台", "price": 1500, "change_pct": 1.0, "volume": 100000, "amount": 1.5e9, "turnover_rate": 0.5},
            "002230": {"name": "科大讯飞", "price": 50, "change_pct": 9.8, "volume": 5e6, "amount": 8e8, "turnover_rate": 6.0},
            "300750": {"name": "宁德时代", "price": 230, "change_pct": 2.0, "volume": 2e6, "amount": 4.6e8, "turnover_rate": 1.0},
            "601398": {"name": "工商银行", "price": 6.0, "change_pct": -1.5, "volume": 5e7, "amount": 3e8, "turnover_rate": 0.2},
        }
        cur_snap = {
            "600519": {"name": "贵州茅台", "price": 1620, "change_pct": 9.0, "volume": 250000, "amount": 4e9, "turnover_rate": 1.2},  # surge +8%
            "002230": {"name": "科大讯飞", "price": 49, "change_pct": 7.5, "volume": 1.2e7, "amount": 1.5e9, "turnover_rate": 12.0},  # 涨停打开
            "300750": {"name": "宁德时代", "price": 207, "change_pct": -8.0, "volume": 6e6, "amount": 1.3e9, "turnover_rate": 2.5},  # plunge
            "601398": {"name": "工商银行", "price": 6.6, "change_pct": 9.8, "volume": 1.5e8, "amount": 1e9, "turnover_rate": 0.6},   # 反包封板
        }
        _SNAPSHOT_WINDOW.clear()
        _SNAPSHOT_WINDOW.append((now - 300, prev_snap))
        result = scan_once(fake_snap=cur_snap)
        return result
    return scan_once()
