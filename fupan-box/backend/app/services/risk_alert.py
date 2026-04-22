"""硬性风险检查 — 6 项高优先级警示.

借鉴 stock-research skill 的 Step 1.5 "拒止检查":
不阻断分析, 但在 UI 中醒目提示用户注意.

6 项检查:
    1. 大股东减持 (近 30 天公告)
    2. 连续亏损 (最近 2 季净利均为负)
    3. ST / *ST 状态
    4. 业绩预亏 (最近一期 forecast nature ∈ {首亏, 续亏, 预减})
    5. 大宗交易折价 (近 30 天 block trade 折价 ≥ 5%)
    6. 北向资金连续流出 (近 5 日 chg_shares 全为负)

返回格式: list[{"level": "high"|"medium", "tag": "...", "detail": "..."}]
空列表 = 无风险触发.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy import select, desc
from sqlalchemy.orm import Session

from app.models.capital import AnnouncementEvent, NorthHoldDaily
from app.models.fundamentals import StockFundamentalsQuarterly, StockForecastEvent
from app.models.stock import Stock

logger = logging.getLogger(__name__)

_NEGATIVE_NATURES = {"首亏", "续亏", "预减"}


def check_risk_alerts(
    session: Session, code: str, trade_date: date
) -> list[dict[str, str]]:
    """对单股跑 6 项风险检查, 返回触发的警示列表."""
    alerts: list[dict[str, str]] = []

    _check_st(session, code, alerts)
    _check_shareholder_reduction(session, code, trade_date, alerts)
    _check_consecutive_loss(session, code, alerts)
    _check_forecast_loss(session, code, alerts)
    _check_block_trade_discount(session, code, trade_date, alerts)
    _check_north_outflow(session, code, trade_date, alerts)

    return alerts


def _check_st(session: Session, code: str, alerts: list):
    try:
        stock = session.execute(
            select(Stock).where(Stock.code == code)
        ).scalar_one_or_none()
        if stock and stock.is_st:
            alerts.append({
                "level": "high",
                "tag": "ST警示",
                "detail": f"{stock.name} 当前为 ST/*ST 状态, 存在退市风险",
            })
    except Exception as e:
        logger.debug("risk_alert st check failed: %s", e)


def _check_shareholder_reduction(
    session: Session, code: str, trade_date: date, alerts: list
):
    try:
        since = trade_date - timedelta(days=30)
        rows = session.execute(
            select(AnnouncementEvent).where(
                AnnouncementEvent.stock_code == code,
                AnnouncementEvent.event_type == "减持",
                AnnouncementEvent.trade_date >= since,
                AnnouncementEvent.trade_date <= trade_date,
            ).order_by(desc(AnnouncementEvent.trade_date))
        ).scalars().all()
        if rows:
            total_scale = sum(r.scale or 0 for r in rows)
            actors = list({r.actor for r in rows if r.actor})[:2]
            actor_str = "、".join(actors) if actors else "股东"
            detail = f"近30天 {actor_str} 累计减持"
            if total_scale > 0:
                if total_scale >= 1e8:
                    detail += f" {total_scale / 1e8:.1f} 亿元"
                else:
                    detail += f" {total_scale / 1e4:.0f} 万元"
            alerts.append({
                "level": "high",
                "tag": "大股东减持",
                "detail": detail,
            })
    except Exception as e:
        logger.debug("risk_alert reduction check failed: %s", e)


def _check_consecutive_loss(session: Session, code: str, alerts: list):
    try:
        recent = session.execute(
            select(StockFundamentalsQuarterly).where(
                StockFundamentalsQuarterly.stock_code == code,
            ).order_by(desc(StockFundamentalsQuarterly.report_date)).limit(2)
        ).scalars().all()
        if len(recent) >= 2 and all(
            r.net_profit is not None and r.net_profit < 0 for r in recent
        ):
            alerts.append({
                "level": "high",
                "tag": "连续亏损",
                "detail": f"最近 {len(recent)} 个报告期净利润均为负",
            })
    except Exception as e:
        logger.debug("risk_alert consecutive loss check failed: %s", e)


def _check_forecast_loss(session: Session, code: str, alerts: list):
    try:
        latest = session.execute(
            select(StockForecastEvent).where(
                StockForecastEvent.stock_code == code,
            ).order_by(desc(StockForecastEvent.ann_date)).limit(1)
        ).scalar_one_or_none()
        if latest and latest.nature in _NEGATIVE_NATURES:
            alerts.append({
                "level": "high",
                "tag": "业绩预亏",
                "detail": f"最新业绩预告: {latest.nature} ({latest.period})",
            })
    except Exception as e:
        logger.debug("risk_alert forecast check failed: %s", e)


def _check_block_trade_discount(
    session: Session, code: str, trade_date: date, alerts: list
):
    try:
        since = trade_date - timedelta(days=30)
        rows = session.execute(
            select(AnnouncementEvent).where(
                AnnouncementEvent.stock_code == code,
                AnnouncementEvent.event_type == "大宗交易",
                AnnouncementEvent.trade_date >= since,
                AnnouncementEvent.trade_date <= trade_date,
            ).order_by(desc(AnnouncementEvent.trade_date))
        ).scalars().all()
        for r in rows:
            detail_data = r.detail or {}
            discount = detail_data.get("discount_pct")
            if isinstance(discount, (int, float)) and discount >= 5.0:
                alerts.append({
                    "level": "medium",
                    "tag": "大宗折价",
                    "detail": f"近30天大宗交易折价 {discount:.1f}%",
                })
                break
    except Exception as e:
        logger.debug("risk_alert block trade check failed: %s", e)


def _check_north_outflow(
    session: Session, code: str, trade_date: date, alerts: list
):
    try:
        recent = session.execute(
            select(NorthHoldDaily).where(
                NorthHoldDaily.stock_code == code,
                NorthHoldDaily.trade_date <= trade_date,
            ).order_by(desc(NorthHoldDaily.trade_date)).limit(5)
        ).scalars().all()
        if len(recent) >= 3 and all(
            r.chg_shares is not None and r.chg_shares < 0 for r in recent
        ):
            total_outflow = sum(abs(r.chg_amount or 0) for r in recent)
            detail = f"北向资金连续 {len(recent)} 日净流出"
            if total_outflow > 0:
                if total_outflow >= 1e8:
                    detail += f", 累计 {total_outflow / 1e8:.1f} 亿"
                else:
                    detail += f", 累计 {total_outflow / 1e4:.0f} 万"
            alerts.append({
                "level": "medium",
                "tag": "北向流出",
                "detail": detail,
            })
    except Exception as e:
        logger.debug("risk_alert north outflow check failed: %s", e)


def check_risk_alerts_sync(code: str, trade_date: date) -> list[dict[str, str]]:
    """独立引擎版, 给 why_rose 等同步调用方使用."""
    from sqlalchemy import create_engine
    from app.config import get_settings

    engine = create_engine(get_settings().database_url_sync)
    try:
        with Session(engine) as session:
            return check_risk_alerts(session, code, trade_date)
    except Exception as e:
        logger.warning("check_risk_alerts_sync failed: %s", e)
        return []
    finally:
        engine.dispose()
