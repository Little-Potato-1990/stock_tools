"""StockContextService —— 7 维个股统一上下文.

任何场景需要"这只股票现在啥情况"时, 调用本服务即可拿到结构化数据,
避免 chip / brief / drawer 各自重写一遍 SQL.

7 维:
    price        : 价格 (当日 + 5/10/20 日涨幅 + 量价信号)
    capital      : 主力 + 北向 (当日 / 5 日累计 / 强度评分)
    seat         : 龙虎榜 (近 30 日上榜次数 + 知名席位次数)
    theme        : 题材 (归属题材 + 当日热度)
    news         : 新闻 (近 7 日 AI 标签 + 利好/利空数量)
    institutional: 主力身份 (汇金/社保/险资/QFII 是否持有 + 季报变动)
    etf_heat     : ETF (该股所在宽基 ETF 近 5 日净申购代理)

入口:
    async get_stock_context(db, code, ...) -> dict
    async get_stock_contexts(db, codes, ...) -> dict[str, dict]   # batch
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Iterable
from sqlalchemy import select, func, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import Stock, DailyQuote
from app.models.market import LimitUpRecord
from app.models.theme import ThemeStock, Theme, ThemeDaily
from app.models.industry import IndustryStock, Industry
from app.models.snapshot import DailySnapshot
from app.models.capital import (
    CapitalFlowDaily, NorthHoldDaily, EtfFlowDaily, AnnouncementEvent,
)
from app.models.holder import HolderSnapshotQuarterly
from app.models.ai import NewsSummary
from app.services.etf_registry import all_tracked_etfs

logger = logging.getLogger(__name__)


# ===================== 主入口 =====================

async def get_stock_context(
    db: AsyncSession,
    code: str,
    *,
    trade_date: date | None = None,
    dimensions: list[str] | None = None,
) -> dict:
    """组装单只股票 7 维上下文.

    Args:
        code: 股票 6 位代码.
        trade_date: 默认取最近一个有 daily_quote 的交易日.
        dimensions: 限定维度子集 (压缩响应); 默认全部.
    """
    code = str(code).zfill(6)
    if not trade_date:
        trade_date = await _latest_trade_date(db)
    dims = set(dimensions or ["price", "capital", "seat", "theme", "news", "institutional", "etf_heat"])

    base = await _stock_basic(db, code)
    ctx: dict = {
        "code": code,
        "name": base.get("name", code),
        "industry": base.get("industry"),
        "trade_date": trade_date.isoformat() if trade_date else None,
    }
    if not trade_date:
        return ctx

    if "price" in dims:
        ctx["price"] = await _ctx_price(db, code, trade_date)
    if "capital" in dims:
        ctx["capital"] = await _ctx_capital(db, code, trade_date)
    if "seat" in dims:
        ctx["seat"] = await _ctx_seat(db, code, trade_date)
    if "theme" in dims:
        ctx["theme"] = await _ctx_theme(db, code, trade_date)
    if "news" in dims:
        ctx["news"] = await _ctx_news(db, code, trade_date)
    if "institutional" in dims:
        ctx["institutional"] = await _ctx_institutional(db, code, trade_date)
    if "etf_heat" in dims:
        ctx["etf_heat"] = await _ctx_etf_heat(db, code, trade_date)

    return ctx


def get_stock_capital_sync(code: str, trade_date: date | None = None) -> dict:
    """同步版本——只抓 capital + institutional + seat 三维, 给 brief prompt 用.

    所有 brief 都跑在同步线程里 (asyncio.to_thread + 同步 engine), 直接复用此函数.
    返回结构与 get_stock_context() 兼容子集.
    """
    from sqlalchemy import create_engine, select, func, and_, or_
    from sqlalchemy.orm import Session
    from datetime import timedelta as _td
    from app.config import get_settings

    code = str(code).zfill(6)
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    out: dict = {"code": code, "capital": None, "institutional": None, "seat": None}
    try:
        with Session(engine) as s:
            if trade_date is None:
                trade_date = s.execute(select(func.max(DailyQuote.trade_date))).scalar_one_or_none()
            if trade_date is None:
                return out

            stock = s.execute(select(Stock).where(Stock.code == code)).scalar_one_or_none()
            if stock:
                out["name"] = stock.name
            out["trade_date"] = trade_date.isoformat()

            # capital
            start = trade_date - _td(days=10)
            cap_rows = s.execute(
                select(CapitalFlowDaily).where(
                    CapitalFlowDaily.scope == "stock",
                    CapitalFlowDaily.scope_key == code,
                    CapitalFlowDaily.trade_date.between(start, trade_date),
                ).order_by(CapitalFlowDaily.trade_date.desc()).limit(10)
            ).scalars().all()
            cap: dict = {"main": None, "north": None}
            if cap_rows:
                today = cap_rows[0]
                net5 = sum((row.data or {}).get("main_inflow", 0) for row in cap_rows[:5])
                cap["main"] = {
                    "today_main_inflow": (today.data or {}).get("main_inflow"),
                    "today_main_inflow_pct": (today.data or {}).get("main_inflow_pct"),
                    "net_5d": round(net5, 2),
                    "days_with_data": len(cap_rows),
                }
            nh_rows = s.execute(
                select(NorthHoldDaily).where(
                    NorthHoldDaily.stock_code == code,
                    NorthHoldDaily.trade_date <= trade_date,
                ).order_by(NorthHoldDaily.trade_date.desc()).limit(6)
            ).scalars().all()
            if nh_rows:
                latest = nh_rows[0]
                prev5 = nh_rows[5] if len(nh_rows) > 5 else nh_rows[-1]
                cap["north"] = {
                    "hold_amount": latest.hold_amount,
                    "hold_pct": latest.hold_pct,
                    "chg_amount_today": latest.chg_amount,
                    "chg_amount_5d": (
                        (latest.hold_amount or 0) - (prev5.hold_amount or 0)
                        if latest.hold_amount and prev5.hold_amount else None
                    ),
                }
            score = 0
            main = cap.get("main") or {}
            if main.get("today_main_inflow") and main["today_main_inflow"] > 1e7: score += 1
            if main.get("net_5d") and main["net_5d"] > 5e7: score += 1
            n_ = cap.get("north") or {}
            if n_.get("chg_amount_5d") and n_["chg_amount_5d"] > 0: score += 1
            if main.get("today_main_inflow") and main["today_main_inflow"] < -1e7: score -= 1
            if main.get("net_5d") and main["net_5d"] < -5e7: score -= 1
            if n_.get("chg_amount_5d") and n_["chg_amount_5d"] < 0: score -= 1
            cap["strength_score"] = score
            if cap["main"] or cap["north"]:
                out["capital"] = cap

            # institutional
            inst: dict = {}
            latest_rd = s.execute(
                select(func.max(HolderSnapshotQuarterly.report_date)).where(
                    HolderSnapshotQuarterly.stock_code == code,
                )
            ).scalar_one_or_none()
            if latest_rd:
                rows = s.execute(
                    select(HolderSnapshotQuarterly).where(
                        HolderSnapshotQuarterly.stock_code == code,
                        HolderSnapshotQuarterly.report_date == latest_rd,
                        HolderSnapshotQuarterly.canonical_name.is_not(None),
                    )
                ).scalars().all()
                types = sorted({r.holder_type for r in rows if r.holder_type})
                inst["report_date"] = latest_rd.isoformat()
                inst["holder_types"] = types
                inst["has_national_team"] = "sovereign" in types
                inst["has_social"] = "social" in types
                inst["has_insurance"] = "insurance" in types
                inst["has_qfii"] = "qfii" in types
            ev_start = trade_date - _td(days=30)
            evs = s.execute(
                select(AnnouncementEvent).where(
                    AnnouncementEvent.stock_code == code,
                    AnnouncementEvent.trade_date.between(ev_start, trade_date),
                ).order_by(AnnouncementEvent.trade_date.desc()).limit(20)
            ).scalars().all()
            if evs:
                inst["event_summary"] = {
                    "increase": sum(1 for e in evs if e.event_type == "increase"),
                    "decrease": sum(1 for e in evs if e.event_type == "decrease"),
                    "repurchase": sum(1 for e in evs if e.event_type == "repurchase"),
                    "placard": sum(1 for e in evs if e.event_type == "placard"),
                }
            if inst:
                out["institutional"] = inst

            # seat (近30日上榜次数)
            from app.models.snapshot import DailySnapshot as _DS
            sd = trade_date - _td(days=45)
            snaps = s.execute(
                select(_DS).where(
                    _DS.snapshot_type == "lhb",
                    _DS.trade_date.between(sd, trade_date),
                ).order_by(_DS.trade_date.desc()).limit(30)
            ).scalars().all()
            appear = 0
            famous = 0
            for snap in snaps:
                insts = ((snap.data or {}).get("insts_by_code") or {}).get(code, [])
                if not insts:
                    continue
                appear += 1
                for it in insts:
                    name = (it.get("exalter") or "")
                    if any(t in name for t in ("机构专用", "炒股养家", "孙哥", "赵老哥", "章盟主", "拉萨", "葛卫东", "宁波桑田路")):
                        famous += 1
            if appear:
                out["seat"] = {"appear_30d": appear, "famous_seat_30d": famous}
        return out
    finally:
        engine.dispose()


async def get_stock_contexts(
    db: AsyncSession,
    codes: Iterable[str],
    *,
    trade_date: date | None = None,
    dimensions: list[str] | None = None,
) -> dict[str, dict]:
    """批量获取 N 只股票上下文(顺序执行, 不并发以减少 DB 连接压力)."""
    codes = list({str(c).zfill(6) for c in codes if c})
    if not trade_date:
        trade_date = await _latest_trade_date(db)
    out: dict[str, dict] = {}
    for c in codes:
        try:
            out[c] = await get_stock_context(db, c, trade_date=trade_date, dimensions=dimensions)
        except Exception as e:
            logger.warning(f"stock_context {c}: {e}")
            out[c] = {"code": c, "error": str(e)}
    return out


# ===================== 内部 helpers =====================

async def _latest_trade_date(db: AsyncSession) -> date | None:
    r = await db.execute(select(func.max(DailyQuote.trade_date)))
    return r.scalar_one_or_none()


async def _stock_basic(db: AsyncSession, code: str) -> dict:
    r = await db.execute(select(Stock).where(Stock.code == code))
    s = r.scalar_one_or_none()
    if not s:
        return {}
    return {"name": s.name, "industry": s.industry, "is_st": bool(s.is_st)}


async def _ctx_price(db: AsyncSession, code: str, trade_date: date) -> dict | None:
    r = await db.execute(
        select(DailyQuote)
        .where(DailyQuote.stock_code == code, DailyQuote.trade_date <= trade_date)
        .order_by(DailyQuote.trade_date.desc())
        .limit(25)
    )
    rows = r.scalars().all()
    if not rows:
        return None
    today = rows[0]

    def _chg_n(n: int) -> float | None:
        if len(rows) <= n:
            return None
        prev = rows[n]
        if not prev.close or float(prev.close) == 0:
            return None
        return round((float(today.close) - float(prev.close)) / float(prev.close) * 100, 2)

    avg_volume_10 = (
        sum(float(q.volume or 0) for q in rows[1:11]) / max(1, min(10, len(rows) - 1))
        if len(rows) > 1 else None
    )
    volume_ratio = (
        round(float(today.volume) / avg_volume_10, 2)
        if avg_volume_10 and avg_volume_10 > 0 else None
    )

    return {
        "trade_date": today.trade_date.isoformat(),
        "close": float(today.close) if today.close else None,
        "change_pct": float(today.change_pct) if today.change_pct else None,
        "change_5d": _chg_n(5),
        "change_10d": _chg_n(10),
        "change_20d": _chg_n(20),
        "amount": float(today.amount) if today.amount else None,
        "turnover_rate": float(today.turnover_rate) if today.turnover_rate else None,
        "volume_ratio_10d": volume_ratio,
        "is_limit_up": bool(today.is_limit_up),
        "is_limit_down": bool(today.is_limit_down),
    }


async def _ctx_capital(db: AsyncSession, code: str, trade_date: date) -> dict | None:
    """主力 + 北向."""
    out: dict = {"main": None, "north": None}

    # 当日 + 近 5 日 主力净流入累计
    start = trade_date - timedelta(days=10)
    r = await db.execute(
        select(CapitalFlowDaily)
        .where(
            CapitalFlowDaily.scope == "stock",
            CapitalFlowDaily.scope_key == code,
            CapitalFlowDaily.trade_date.between(start, trade_date),
        )
        .order_by(CapitalFlowDaily.trade_date.desc())
        .limit(10)
    )
    rows = r.scalars().all()
    if rows:
        today = rows[0]
        net5 = sum((row.data or {}).get("main_inflow", 0) for row in rows[:5])
        out["main"] = {
            "today_main_inflow": (today.data or {}).get("main_inflow"),
            "today_main_inflow_pct": (today.data or {}).get("main_inflow_pct"),
            "today_huge_inflow": (today.data or {}).get("huge_inflow"),
            "net_5d": round(net5, 2),
            "days_with_data": len(rows),
        }

    # 北向
    r = await db.execute(
        select(NorthHoldDaily)
        .where(
            NorthHoldDaily.stock_code == code,
            NorthHoldDaily.trade_date <= trade_date,
        )
        .order_by(NorthHoldDaily.trade_date.desc())
        .limit(6)
    )
    nh_rows = r.scalars().all()
    if nh_rows:
        latest = nh_rows[0]
        prev5 = nh_rows[5] if len(nh_rows) > 5 else nh_rows[-1]
        out["north"] = {
            "hold_amount": latest.hold_amount,
            "hold_pct": latest.hold_pct,
            "chg_amount_today": latest.chg_amount,
            "chg_amount_5d": (
                (latest.hold_amount or 0) - (prev5.hold_amount or 0)
                if latest.hold_amount and prev5.hold_amount else None
            ),
        }

    # 强度评分: 简化版本——主力净流入符号 + 北向加仓 + 量比 综合 -3..+3
    score = 0
    main = out.get("main") or {}
    if main.get("today_main_inflow") and main["today_main_inflow"] > 1e7:
        score += 1
    if main.get("net_5d") and main["net_5d"] > 5e7:
        score += 1
    north = out.get("north") or {}
    if north.get("chg_amount_5d") and north["chg_amount_5d"] > 0:
        score += 1
    if main.get("today_main_inflow") and main["today_main_inflow"] < -1e7:
        score -= 1
    if main.get("net_5d") and main["net_5d"] < -5e7:
        score -= 1
    if north.get("chg_amount_5d") and north["chg_amount_5d"] < 0:
        score -= 1
    out["strength_score"] = score
    return out if (out["main"] or out["north"]) else None


async def _ctx_seat(db: AsyncSession, code: str, trade_date: date) -> dict | None:
    """龙虎榜——近 30 日上榜次数, 命名席位次数(从 lhb snapshot 中抓)."""
    start = trade_date - timedelta(days=45)
    r = await db.execute(
        select(DailySnapshot)
        .where(
            DailySnapshot.snapshot_type == "lhb",
            DailySnapshot.trade_date.between(start, trade_date),
        )
        .order_by(DailySnapshot.trade_date.desc())
        .limit(30)
    )
    snaps = r.scalars().all()
    if not snaps:
        return None
    appear_count = 0
    famous_count = 0
    last_date = None
    for snap in snaps:
        insts = ((snap.data or {}).get("insts_by_code") or {}).get(code, [])
        if not insts:
            continue
        appear_count += 1
        if last_date is None:
            last_date = snap.trade_date.isoformat()
        for it in insts:
            name = (it.get("exalter") or "").strip()
            if name and any(t in name for t in ("机构专用", "炒股养家", "孙哥", "赵老哥", "章盟主", "拉萨", "葛卫东", "宁波桑田路", "佛山张震")):
                famous_count += 1
    if appear_count == 0:
        return None
    return {
        "appear_30d": appear_count,
        "famous_seat_30d": famous_count,
        "last_appear": last_date,
    }


async def _ctx_theme(db: AsyncSession, code: str, trade_date: date) -> dict | None:
    """归属题材 + 当日热度."""
    r = await db.execute(
        select(Theme.name, ThemeDaily.avg_change_pct, ThemeDaily.rank, ThemeDaily.limit_up_count)
        .join(ThemeStock, ThemeStock.theme_id == Theme.id)
        .outerjoin(
            ThemeDaily,
            and_(ThemeDaily.theme_id == Theme.id, ThemeDaily.trade_date == trade_date),
        )
        .where(ThemeStock.stock_code == code)
        .order_by(ThemeDaily.avg_change_pct.desc().nullslast())
        .limit(5)
    )
    rows = r.all()
    if not rows:
        return None
    themes = [
        {
            "name": n,
            "change_pct": float(c) if c is not None else None,
            "rank": rk,
            "limit_up_count": lu,
        }
        for (n, c, rk, lu) in rows
    ]
    hottest = themes[0] if themes and themes[0]["change_pct"] is not None else None
    return {"themes": themes, "hottest": hottest}


async def _ctx_news(db: AsyncSession, code: str, trade_date: date) -> dict | None:
    """近 7 日新闻 AI 标签计数."""
    start = trade_date - timedelta(days=7)
    r = await db.execute(
        select(NewsSummary)
        .where(
            NewsSummary.publish_date >= start,
            or_(
                NewsSummary.related_stocks.contains([code]),
                NewsSummary.title.ilike(f"%{code}%"),
            ),
        )
        .order_by(NewsSummary.pub_time.desc().nullslast())
        .limit(20)
    )
    rows = r.scalars().all()
    if not rows:
        return None
    pos = neg = neu = 0
    for n in rows:
        s = (n.sentiment or "").lower()
        if "bull" in s or "pos" in s or "利好" in s:
            pos += 1
        elif "bear" in s or "neg" in s or "利空" in s:
            neg += 1
        else:
            neu += 1
    return {
        "count_7d": len(rows),
        "positive": pos,
        "negative": neg,
        "neutral": neu,
        "latest_title": rows[0].title if rows else None,
    }


async def _ctx_institutional(db: AsyncSession, code: str, trade_date: date) -> dict | None:
    """主力身份 + 季报变动 + 公告事件."""
    out: dict = {}

    # 季报: 取最新一期
    r = await db.execute(
        select(func.max(HolderSnapshotQuarterly.report_date))
        .where(HolderSnapshotQuarterly.stock_code == code)
    )
    latest_rd = r.scalar_one_or_none()
    if latest_rd:
        r = await db.execute(
            select(HolderSnapshotQuarterly)
            .where(
                HolderSnapshotQuarterly.stock_code == code,
                HolderSnapshotQuarterly.report_date == latest_rd,
                HolderSnapshotQuarterly.canonical_name.is_not(None),
            )
            .order_by(HolderSnapshotQuarterly.weight.desc(), HolderSnapshotQuarterly.shares.desc().nullslast())
        )
        rows = r.scalars().all()
        holders = [
            {
                "canonical": h.canonical_name,
                "type": h.holder_type,
                "fund_company": h.fund_company,
                "rank": h.rank,
                "shares_pct": h.shares_pct,
                "change_type": h.change_type,
            }
            for h in rows
        ]
        types = sorted({h["type"] for h in holders if h.get("type")})
        out["report_date"] = latest_rd.isoformat()
        out["holders"] = holders[:10]
        out["holder_types"] = types
        out["has_national_team"] = "sovereign" in types
        out["has_social"] = "social" in types
        out["has_insurance"] = "insurance" in types
        out["has_qfii"] = "qfii" in types

    # 近 30 日公告事件
    start = trade_date - timedelta(days=30)
    r = await db.execute(
        select(AnnouncementEvent)
        .where(
            AnnouncementEvent.stock_code == code,
            AnnouncementEvent.trade_date.between(start, trade_date),
        )
        .order_by(AnnouncementEvent.trade_date.desc())
        .limit(20)
    )
    events = r.scalars().all()
    if events:
        out["events_30d"] = [
            {
                "date": e.trade_date.isoformat(),
                "type": e.event_type,
                "actor": e.actor,
                "actor_type": e.actor_type,
                "scale": e.scale,
                "shares": e.shares,
            }
            for e in events
        ]
        out["event_summary"] = {
            "increase": sum(1 for e in events if e.event_type == "increase"),
            "decrease": sum(1 for e in events if e.event_type == "decrease"),
            "repurchase": sum(1 for e in events if e.event_type == "repurchase"),
            "placard": sum(1 for e in events if e.event_type == "placard"),
        }

    return out or None


async def _ctx_etf_heat(db: AsyncSession, code: str, trade_date: date) -> dict | None:
    """该股所在行业 ETF 近 5 日净申购代理(简化版本: 用宽基 ETF 整体作为大盘资金代理)."""
    start = trade_date - timedelta(days=10)
    r = await db.execute(
        select(EtfFlowDaily)
        .where(
            EtfFlowDaily.category == "national_team_broad",
            EtfFlowDaily.trade_date.between(start, trade_date),
        )
        .order_by(EtfFlowDaily.trade_date.desc())
    )
    rows = r.scalars().all()
    if not rows:
        return None
    by_etf: dict[str, list[EtfFlowDaily]] = {}
    for row in rows:
        by_etf.setdefault(row.etf_code, []).append(row)
    summary: list[dict] = []
    total_inflow_5d = 0.0
    for code_etf, items in by_etf.items():
        items.sort(key=lambda x: x.trade_date, reverse=True)
        net5 = sum((it.inflow_estimate or 0) for it in items[:5])
        total_inflow_5d += net5
        summary.append({
            "etf_code": code_etf,
            "etf_name": items[0].etf_name,
            "shares_change_today": items[0].shares_change,
            "inflow_5d": round(net5, 0),
        })
    summary.sort(key=lambda x: abs(x["inflow_5d"] or 0), reverse=True)
    return {
        "broad_etf_inflow_5d": round(total_inflow_5d, 0),
        "top_etfs": summary[:5],
        "note": "宽基 ETF 是大盘资金代理, 不直接对应该股, 用于判断系统性资金环境.",
    }
