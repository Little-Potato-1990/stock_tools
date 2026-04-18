from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import date
from app.database import get_db
from app.models.market import MarketSentiment, LadderSummary, LimitUpRecord
from app.models.snapshot import DailySnapshot
from app.api._cache import cached_call

router = APIRouter()


@router.get("/sentiment")
async def get_sentiment(
    start_date: date = Query(None),
    end_date: date = Query(None),
    days: int = Query(5, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
):
    """大盘情绪指标，默认最近 N 个交易日"""
    query = select(MarketSentiment).order_by(MarketSentiment.trade_date.desc())
    if start_date and end_date:
        query = query.where(
            MarketSentiment.trade_date.between(start_date, end_date)
        )
    else:
        query = query.limit(days)
    result = await db.execute(query)
    rows = result.scalars().all()
    return [_sentiment_to_dict(r) for r in rows]


@router.get("/ladder")
async def get_ladder(
    trade_date: date = Query(None),
    days: int = Query(5, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
):
    """连板梯队汇总"""
    if trade_date:
        query = select(LadderSummary).where(
            LadderSummary.trade_date == trade_date
        ).order_by(LadderSummary.board_level.desc())
    else:
        subq = (
            select(LadderSummary.trade_date)
            .distinct()
            .order_by(LadderSummary.trade_date.desc())
            .limit(days)
        )
        query = (
            select(LadderSummary)
            .where(LadderSummary.trade_date.in_(subq))
            .order_by(LadderSummary.trade_date.desc(), LadderSummary.board_level.desc())
        )
    result = await db.execute(query)
    rows = result.scalars().all()
    return [_ladder_to_dict(r) for r in rows]


@router.get("/limit-up")
async def get_limit_up(
    trade_date: date = Query(...),
    min_board: int = Query(1, ge=1),
    db: AsyncSession = Depends(get_db),
):
    """某日涨停个股明细"""
    query = (
        select(LimitUpRecord)
        .where(
            LimitUpRecord.trade_date == trade_date,
            LimitUpRecord.continuous_days >= min_board,
        )
        .order_by(LimitUpRecord.continuous_days.desc(), LimitUpRecord.first_limit_time)
    )
    result = await db.execute(query)
    return [_limit_up_to_dict(r) for r in result.scalars().all()]


@router.get("/search")
async def search_stocks(
    q: str = Query("", min_length=1, max_length=20),
    db: AsyncSession = Depends(get_db),
):
    """搜索股票 - 按代码或名称"""
    from app.models.stock import DailyQuote
    from sqlalchemy import func as sa_func, or_

    latest_date = (await db.execute(
        select(sa_func.max(DailyQuote.trade_date))
    )).scalar()
    if not latest_date:
        return []

    query = (
        select(DailyQuote)
        .where(
            DailyQuote.trade_date == latest_date,
            DailyQuote.stock_code.contains(q),
        )
        .order_by(DailyQuote.amount.desc())
        .limit(30)
    )
    result = await db.execute(query)
    quotes = result.scalars().all()

    lu_query = select(LimitUpRecord).where(
        LimitUpRecord.trade_date == latest_date,
        LimitUpRecord.stock_code.in_([q.stock_code for q in quotes]),
    )
    lu_result = await db.execute(lu_query)
    lu_map = {r.stock_code: r for r in lu_result.scalars().all()}

    return [
        {
            "stock_code": q.stock_code,
            "stock_name": lu_map[q.stock_code].stock_name if q.stock_code in lu_map else q.stock_code,
            "change_pct": float(q.change_pct) if q.change_pct else 0,
            "close": float(q.close) if q.close else 0,
            "amount": float(q.amount) if q.amount else 0,
            "turnover_rate": float(q.turnover_rate) if q.turnover_rate else 0,
            "is_limit_up": q.is_limit_up,
            "is_limit_down": q.is_limit_down,
        }
        for q in quotes
    ]


def _sentiment_to_dict(r: MarketSentiment) -> dict:
    return {
        "trade_date": str(r.trade_date),
        "total_amount": float(r.total_amount),
        "up_count": r.up_count,
        "down_count": r.down_count,
        "limit_up_count": r.limit_up_count,
        "limit_down_count": r.limit_down_count,
        "broken_limit_count": r.broken_limit_count,
        "broken_rate": float(r.broken_rate),
        "max_height": r.max_height,
        "open_high_count": r.open_high_count,
        "open_low_count": r.open_low_count,
        "open_limit_up_count": r.open_limit_up,
        "open_limit_down_count": r.open_limit_down,
        "up_rate": float(r.up_rate) if r.up_rate is not None else None,
        "sh_up_rate": float(r.sh_up_rate) if r.sh_up_rate is not None else None,
        "sz_up_rate": float(r.sz_up_rate) if r.sz_up_rate is not None else None,
        "gem_up_rate": float(r.gem_up_rate) if r.gem_up_rate is not None else None,
        "yesterday_lu_up_rate": float(r.yesterday_lu_up_rate) if r.yesterday_lu_up_rate is not None else None,
        "yesterday_panic_up_rate": float(r.yesterday_panic_up_rate) if r.yesterday_panic_up_rate is not None else None,
        "yesterday_weak_up_rate": float(r.yesterday_weak_up_rate) if r.yesterday_weak_up_rate is not None else None,
        "main_lu_open_avg": float(r.main_lu_open_avg) if r.main_lu_open_avg is not None else None,
        "main_lu_body_avg": float(r.main_lu_body_avg) if r.main_lu_body_avg is not None else None,
        "main_lu_change_avg": float(r.main_lu_change_avg) if r.main_lu_change_avg is not None else None,
        "gem_lu_open_avg": float(r.gem_lu_open_avg) if r.gem_lu_open_avg is not None else None,
        "gem_lu_body_avg": float(r.gem_lu_body_avg) if r.gem_lu_body_avg is not None else None,
        "gem_lu_change_avg": float(r.gem_lu_change_avg) if r.gem_lu_change_avg is not None else None,
        "one_word_count": getattr(r, "one_word_count", 0) or 0,
    }


def _ladder_to_dict(r: LadderSummary) -> dict:
    return {
        "trade_date": str(r.trade_date),
        "board_level": r.board_level,
        "stock_count": r.stock_count,
        "promotion_count": r.promotion_count,
        "promotion_rate": float(r.promotion_rate),
    }


@router.get("/yesterday-limit-up")
async def get_yesterday_limit_up_performance(
    db: AsyncSession = Depends(get_db),
):
    """昨日涨停股今日表现"""
    from sqlalchemy import func as sa_func
    latest_two = (
        select(MarketSentiment.trade_date)
        .order_by(MarketSentiment.trade_date.desc())
        .limit(2)
    )
    result = await db.execute(latest_two)
    dates = [row[0] for row in result.all()]
    if len(dates) < 2:
        return []

    today, yesterday = dates[0], dates[1]

    from app.models.stock import DailyQuote
    prev_lu = await db.execute(
        select(LimitUpRecord).where(LimitUpRecord.trade_date == yesterday)
    )
    prev_limit_ups = prev_lu.scalars().all()
    codes = [r.stock_code for r in prev_limit_ups]
    if not codes:
        return []

    today_q = await db.execute(
        select(DailyQuote).where(
            DailyQuote.trade_date == today,
            DailyQuote.stock_code.in_(codes),
        )
    )
    today_quotes = {q.stock_code: q for q in today_q.scalars().all()}

    result_list = []
    for r in prev_limit_ups:
        q = today_quotes.get(r.stock_code)
        result_list.append({
            "stock_code": r.stock_code,
            "stock_name": r.stock_name,
            "yesterday_continuous": r.continuous_days,
            "yesterday_open_count": r.open_count,
            "today_change_pct": float(q.change_pct) if q and q.change_pct else None,
            "today_open": float(q.open) if q and q.open else None,
            "today_close": float(q.close) if q and q.close else None,
            "today_is_limit_up": q.is_limit_up if q else False,
            "today_amount": float(q.amount) if q and q.amount else None,
        })

    result_list.sort(key=lambda x: x["today_change_pct"] or -999, reverse=True)
    return result_list


@router.get("/news")
async def get_financial_news(
    count: int = Query(30, ge=5, le=100),
    db: AsyncSession = Depends(get_db),
):
    """财经要闻: 拉取最新财经新闻 + 关联概念标签"""
    # 实时新闻没有 Tushare 等价接口, 这里直接走 akshare 实时接口;
    # 概念名单仍优先走可配置的 adapter, akshare 仅作 fallback.
    import akshare as ak
    from app.pipeline.akshare_adapter import AKShareAdapter
    from app.pipeline.runner import get_adapter

    primary = get_adapter()
    fallback = AKShareAdapter() if not isinstance(primary, AKShareAdapter) else None
    concept_names: set[str] = set()
    for adapter in (primary, fallback):
        if adapter is None:
            continue
        try:
            concept_data = adapter.fetch_concept_board_daily() or []
            if concept_data:
                concept_names = {c["name"] for c in concept_data if c.get("name")}
                break
        except Exception:
            continue

    try:
        df = ak.stock_news_em(symbol="财联社")
        if df is None or df.empty:
            df = ak.stock_info_global_em()
    except Exception:
        try:
            df = ak.stock_info_global_em()
        except Exception:
            return []

    if df is None or df.empty:
        return []

    results = []
    for _, row in df.head(count).iterrows():
        title = str(row.get("新闻标题", row.get("标题", row.get("title", ""))))
        content = str(row.get("新闻内容", row.get("内容", row.get("content", ""))))
        pub_time = str(row.get("发布时间", row.get("时间", row.get("datetime", ""))))

        if not title:
            continue

        related_concepts = []
        text = title + content
        for cn in concept_names:
            if len(cn) >= 2 and cn in text:
                related_concepts.append(cn)

        results.append({
            "title": title,
            "content": content[:200] if content else "",
            "pub_time": pub_time,
            "related_concepts": related_concepts[:8],
        })

    return results


@router.get("/bigdata-rank")
async def get_bigdata_rank(
    dimension: str = Query("fund_flow", description="排名维度"),
    db: AsyncSession = Depends(get_db),
):
    """大数据多维排名: 按不同资金维度对概念板块排名"""
    # 实时主力资金流仅 akshare 提供; 其他维度走 DB / 现有 adapter.
    from app.pipeline.akshare_adapter import AKShareAdapter
    import akshare as ak

    if dimension == "fund_flow":
        try:
            df = ak.stock_sector_fund_flow_rank(indicator="今日", sector_type="概念资金流")
            results = []
            for _, row in df.head(30).iterrows():
                results.append({
                    "name": str(row.get("名称", "")),
                    "change_pct": float(row.get("今日涨跌幅", 0) or 0),
                    "main_net_inflow": float(row.get("主力净流入-净额", 0) or 0),
                    "main_net_pct": float(row.get("主力净流入-净占比", 0) or 0),
                    "super_big_net": float(row.get("超大单净流入-净额", 0) or 0),
                    "big_net": float(row.get("大单净流入-净额", 0) or 0),
                    "mid_net": float(row.get("中单净流入-净额", 0) or 0),
                    "small_net": float(row.get("小单净流入-净额", 0) or 0),
                })
            return {"dimension": "fund_flow", "label": "主力净流入", "items": results}
        except Exception as e:
            return {"dimension": "fund_flow", "label": "主力净流入", "items": [], "error": str(e)}

    elif dimension == "limit_up_order":
        from sqlalchemy import func as sa_func
        latest_date = (await db.execute(
            select(sa_func.max(LimitUpRecord.trade_date))
        )).scalar()

        theme_order: dict[str, float] = {}
        if latest_date:
            lu_result = await db.execute(
                select(LimitUpRecord).where(
                    LimitUpRecord.trade_date == latest_date,
                    LimitUpRecord.limit_order_amount.isnot(None),
                )
            )
            for r in lu_result.scalars().all():
                for t in (r.theme_names or []):
                    if t:
                        theme_order[t] = theme_order.get(t, 0) + float(r.limit_order_amount or 0)

        items = sorted(
            [{"name": k, "order_amount": v} for k, v in theme_order.items()],
            key=lambda x: -x["order_amount"],
        )[:30]
        return {"dimension": "limit_up_order", "label": "涨停封单额", "items": items}

    elif dimension == "hot_concept":
        from app.pipeline.runner import get_adapter
        primary = get_adapter()
        fallback = AKShareAdapter() if not isinstance(primary, AKShareAdapter) else None
        concept_data: list[dict] = []
        for adapter in (primary, fallback):
            if adapter is None:
                continue
            try:
                concept_data = adapter.fetch_concept_board_daily() or []
                if concept_data:
                    break
            except Exception:
                continue
        items = []
        for c in concept_data[:30]:
            items.append({
                "name": c["name"],
                "change_pct": c["change_pct"],
                "up_count": c["up_count"],
                "down_count": c["down_count"],
                "lead_stock": c.get("lead_stock", ""),
                "lead_stock_pct": c.get("lead_stock_pct", 0),
            })
        items.sort(key=lambda x: -(x["up_count"] * 2 + x["change_pct"]))
        return {"dimension": "hot_concept", "label": "人气概念", "items": items[:30]}

    return {"dimension": dimension, "label": dimension, "items": [], "error": "不支持的维度"}


@router.get("/theme-detail")
async def get_theme_detail(
    name: str = Query(..., min_length=1, max_length=50),
    db: AsyncSession = Depends(get_db),
):
    """题材/行业详情：取该板块成分股，按不同维度分类。
    依次按"主数据源-概念 / 主数据源-行业 / AKShare-概念 / AKShare-行业"四级兜底。"""
    from app.pipeline.runner import get_adapter
    from app.pipeline.akshare_adapter import AKShareAdapter
    from sqlalchemy import func as sa_func

    primary = get_adapter()
    fallback = AKShareAdapter() if not isinstance(primary, AKShareAdapter) else None

    def _try(adapter, method: str) -> list[dict]:
        if adapter is None:
            return []
        fn = getattr(adapter, method, None)
        if fn is None:
            return []
        try:
            return fn(name) or []
        except Exception:
            return []

    stocks = (
        _try(primary, "fetch_concept_cons")
        or _try(primary, "fetch_industry_cons")
        or _try(fallback, "fetch_concept_cons")
        or _try(fallback, "fetch_industry_cons")
    )

    if not stocks:
        return {"name": name, "total": 0, "all": [], "limit_up": [], "hot": [], "core": [], "high": []}

    codes = [s["stock_code"] for s in stocks]

    latest_date = (await db.execute(
        select(sa_func.max(LimitUpRecord.trade_date))
    )).scalar()

    lu_map: dict[str, int] = {}
    if latest_date:
        lu_result = await db.execute(
            select(LimitUpRecord).where(
                LimitUpRecord.trade_date == latest_date,
                LimitUpRecord.stock_code.in_(codes),
            )
        )
        for r in lu_result.scalars().all():
            lu_map[r.stock_code] = r.continuous_days

    for s in stocks:
        s["is_limit_up"] = s["stock_code"] in lu_map
        s["continuous_days"] = lu_map.get(s["stock_code"], 0)

    limit_up = sorted(
        [s for s in stocks if s["is_limit_up"]],
        key=lambda x: (-x["continuous_days"], -x["change_pct"]),
    )
    hot = sorted(stocks, key=lambda x: -x["amount"])[:20]
    core = sorted(stocks, key=lambda x: -x["total_market_cap"])[:15]
    high = sorted(stocks, key=lambda x: -x["change_pct"])[:30]
    all_sorted = sorted(stocks, key=lambda x: -x["change_pct"])

    return {
        "name": name,
        "total": len(stocks),
        "all": all_sorted,
        "limit_up": limit_up,
        "hot": hot,
        "core": core,
        "high": high,
    }


@router.get("/stock-detail")
async def get_stock_detail(
    code: str = Query(..., min_length=1, max_length=10),
    db: AsyncSession = Depends(get_db),
):
    """个股详情: 基础资料、涨停原因、行业、概念标签、近期行情"""
    from app.models.stock import DailyQuote, Stock
    from sqlalchemy import func as sa_func

    latest_date = (await db.execute(
        select(sa_func.max(DailyQuote.trade_date))
    )).scalar()

    stock_info: dict = {"stock_code": code, "stock_name": code}

    # 基础资料 (来自 stocks 表)
    stock_row = await db.execute(select(Stock).where(Stock.code == code))
    s = stock_row.scalar_one_or_none()
    if s:
        market_label = {
            "SH": "上交所",
            "SZ": "深交所",
            "BJ": "北交所",
        }.get(s.market or "", s.market or "")
        stock_info["stock_name"] = s.name or code
        stock_info["market_label"] = market_label
        stock_info["market"] = s.market
        stock_info["industry"] = s.industry
        stock_info["list_date"] = str(s.list_date) if s.list_date else None
        stock_info["is_st"] = s.is_st

    lu = await db.execute(
        select(LimitUpRecord)
        .where(LimitUpRecord.stock_code == code)
        .order_by(LimitUpRecord.trade_date.desc())
        .limit(1)
    )
    lu_record = lu.scalar_one_or_none()
    if lu_record:
        stock_info["stock_name"] = lu_record.stock_name or stock_info.get("stock_name", code)
        stock_info["limit_reason"] = lu_record.limit_reason
        stock_info["theme_names"] = lu_record.theme_names or []
        stock_info["continuous_days"] = lu_record.continuous_days
        stock_info["last_limit_date"] = str(lu_record.trade_date)
    else:
        stock_info["limit_reason"] = None
        stock_info["theme_names"] = []
        stock_info["continuous_days"] = 0
        stock_info["last_limit_date"] = None

    quotes = await db.execute(
        select(DailyQuote)
        .where(DailyQuote.stock_code == code)
        .order_by(DailyQuote.trade_date.desc())
        .limit(10)
    )
    recent = []
    for q in quotes.scalars().all():
        recent.append({
            "trade_date": str(q.trade_date),
            "open": float(q.open),
            "close": float(q.close),
            "high": float(q.high),
            "low": float(q.low),
            "change_pct": float(q.change_pct) if q.change_pct else 0,
            "amount": float(q.amount) if q.amount else 0,
            "is_limit_up": q.is_limit_up,
            "is_limit_down": q.is_limit_down,
        })
    stock_info["recent_quotes"] = recent

    all_lu = await db.execute(
        select(LimitUpRecord)
        .where(LimitUpRecord.stock_code == code)
        .order_by(LimitUpRecord.trade_date.desc())
        .limit(20)
    )
    all_themes: set[str] = set()
    for r in all_lu.scalars().all():
        for t in (r.theme_names or []):
            if t:
                all_themes.add(t)
    stock_info["all_themes"] = sorted(all_themes)

    return stock_info


@router.get("/all-boards")
async def get_all_boards(
    kind: str = Query("concept", regex="^(concept|industry)$"),
):
    """返回所有概念/行业板块，按首字符分组用于"概念分类/行业分类"页面。"""
    from app.pipeline.runner import get_adapter
    from app.pipeline.akshare_adapter import AKShareAdapter

    primary = get_adapter()
    fallback = AKShareAdapter() if not isinstance(primary, AKShareAdapter) else None

    def _fetch(adapter):
        if adapter is None:
            return []
        try:
            if kind == "concept":
                return adapter.fetch_concept_board_daily() or []
            return adapter.fetch_industry_board_daily() or []
        except Exception:
            return []

    boards = _fetch(primary) or _fetch(fallback)

    def _bucket(name: str) -> str:
        if not name:
            return "#"
        ch = name[0]
        if "0" <= ch <= "9":
            return ch
        return ch.upper() if ("A" <= ch.upper() <= "Z") else "中文"

    groups: dict[str, list[dict]] = {}
    for b in boards:
        name = b.get("name", "")
        if not name:
            continue
        key = _bucket(name)
        groups.setdefault(key, []).append({
            "name": name,
            "code": b.get("code", ""),
            "change_pct": b.get("change_pct", 0),
        })

    def _key_order(k: str) -> tuple:
        if k == "#":
            return (3, k)
        if k == "中文":
            return (2, k)
        if k.isdigit():
            return (0, k)
        return (1, k)

    sorted_keys = sorted(groups.keys(), key=_key_order)
    return {
        "kind": kind,
        "groups": [{"letter": k, "items": groups[k]} for k in sorted_keys],
    }


@router.get("/industries-grid")
async def get_industries_grid(
    days: int = Query(7, ge=2, le=15),
    rows: int = Query(20, ge=5, le=50),
    db: AsyncSession = Depends(get_db),
):
    """行业 rank × 日期 网格

    返回最近 N 天的行业快照, 每天包含 top-K 行业 + 每个行业的核心数据
    (总强度=领涨幅×成员数, 强势数=红盘股数, 平均强度=平均涨跌幅,
     连续上榜=该行业最近连续在榜天数, 关联个股=领涨/次涨)。
    """
    return await cached_call(
        ("industries-grid", days, rows),
        _industries_grid_impl,
        db,
        days,
        rows,
    )


async def _industries_grid_impl(db: AsyncSession, days: int, rows: int):
    snap_query = (
        select(DailySnapshot)
        .where(DailySnapshot.snapshot_type == "industries")
        .order_by(DailySnapshot.trade_date.desc())
        .limit(days)
    )
    snap_res = await db.execute(snap_query)
    rows_db = list(snap_res.scalars().all())

    days_out = []
    for r in rows_db:
        top = (r.data.get("top") or [])[:rows]
        days_out.append({
            "trade_date": str(r.trade_date),
            "items": top,
        })

    return {
        "rows": rows,
        "days": days_out,
    }


@router.get("/strong-stocks-grid")
async def get_strong_stocks_grid(
    days: int = Query(8, ge=2, le=15),
    rows: int = Query(5, ge=3, le=10),
    scope: str = Query("recent", regex="^(recent|main|gem|star|bj)$"),
    db: AsyncSession = Depends(get_db),
):
    """强势股 rank × 日期 网格

    每个日期列取该日 top-N 强势股 (按板级 + 涨幅 + 成交综合排序),
    再附带该股在 lookback 窗口内的近 2 日涨幅 (用于"暂无后两日涨幅"等标签).

    Args:
        scope: recent=全部, main=主板(60/00), gem=创业板(300), star=科创板(688), bj=北交(8/4)
    """
    return await cached_call(
        ("strong-stocks-grid", days, rows, scope),
        _strong_stocks_grid_impl,
        db,
        days,
        rows,
        scope,
    )


async def _strong_stocks_grid_impl(db: AsyncSession, days: int, rows: int, scope: str):
    from app.models.stock import DailyQuote
    from sqlalchemy import func as sa_func

    date_rows = await db.execute(
        select(MarketSentiment.trade_date)
        .order_by(MarketSentiment.trade_date.desc())
        .limit(days)
    )
    trade_dates = [row[0] for row in date_rows.all()]
    if not trade_dates:
        return {"dates": [], "rows": rows, "cells": {}}

    def _scope_filter(code: str) -> bool:
        if scope == "main":
            return code.startswith(("60", "00")) and not code.startswith("300")
        if scope == "gem":
            return code.startswith("300") or code.startswith("301")
        if scope == "star":
            return code.startswith("688") or code.startswith("689")
        if scope == "bj":
            return code.startswith(("8", "4")) and len(code) == 6
        return True

    cells: dict[str, list] = {}

    for dt in trade_dates:
        lu_res = await db.execute(
            select(LimitUpRecord).where(LimitUpRecord.trade_date == dt)
        )
        lu_records = list(lu_res.scalars().all())
        lu_map = {r.stock_code: r for r in lu_records if _scope_filter(r.stock_code)}

        q_res = await db.execute(
            select(DailyQuote).where(DailyQuote.trade_date == dt)
        )
        quotes = [q for q in q_res.scalars().all() if _scope_filter(q.stock_code)]

        scored = []
        for q in quotes:
            lu = lu_map.get(q.stock_code)
            board = lu.continuous_days if lu else 0
            chg = float(q.change_pct or 0)
            amount = float(q.amount or 0)
            score = board * 1000 + chg * 10 + amount / 1e9
            scored.append((score, q, lu))

        scored.sort(key=lambda x: -x[0])
        top = scored[:rows]

        cell_list = []
        for rank_idx, (_, q, lu) in enumerate(top, start=1):
            cell_list.append({
                "rank": rank_idx,
                "stock_code": q.stock_code,
                "stock_name": (lu.stock_name if lu and lu.stock_name else q.stock_code),
                "change_pct": float(q.change_pct) if q.change_pct else 0,
                "amount": float(q.amount) if q.amount else 0,
                "turnover_rate": float(q.turnover_rate) if q.turnover_rate else 0,
                "is_limit_up": q.is_limit_up,
                "is_one_word": lu.is_one_word if lu else False,
                "is_t_board": lu.is_t_board if lu else False,
                "open_count": lu.open_count if lu else 0,
                "continuous_days": lu.continuous_days if lu else 0,
                "limit_reason": lu.limit_reason if lu else None,
                "theme_names": (lu.theme_names if lu and lu.theme_names else [])[:1],
                "primary_theme": ((lu.theme_names or [None])[0] if lu else None),
            })
        cells[str(dt)] = cell_list

    return {
        "dates": [str(d) for d in trade_dates],
        "rows": rows,
        "cells": cells,
    }


@router.get("/ladder-track")
async def get_ladder_track(
    days: int = Query(8, ge=2, le=15),
    db: AsyncSession = Depends(get_db),
):
    """连板梯队跨日追踪: 每只连板股多日涨跌幅"""
    return await cached_call(
        ("ladder-track", days),
        _ladder_track_impl,
        db,
        days,
    )


async def _ladder_track_impl(db: AsyncSession, days: int):
    from app.models.stock import DailyQuote
    from sqlalchemy import func as sa_func

    date_rows = await db.execute(
        select(MarketSentiment.trade_date)
        .order_by(MarketSentiment.trade_date.desc())
        .limit(days)
    )
    trade_dates = [row[0] for row in date_rows.all()]
    if len(trade_dates) < 2:
        return {"dates": [], "stocks": []}

    latest_date = trade_dates[0]

    lu_result = await db.execute(
        select(LimitUpRecord)
        .where(
            LimitUpRecord.trade_date == latest_date,
            LimitUpRecord.continuous_days >= 2,
        )
        .order_by(LimitUpRecord.continuous_days.desc(), LimitUpRecord.first_limit_time)
    )
    tracked_stocks = lu_result.scalars().all()
    codes = [r.stock_code for r in tracked_stocks]

    if not codes:
        return {"dates": [str(d) for d in trade_dates], "stocks": []}

    quotes_result = await db.execute(
        select(DailyQuote).where(
            DailyQuote.stock_code.in_(codes),
            DailyQuote.trade_date.in_(trade_dates),
        )
    )
    quote_map: dict[str, dict[str, dict]] = {}
    for q in quotes_result.scalars().all():
        code = q.stock_code
        dt = str(q.trade_date)
        if code not in quote_map:
            quote_map[code] = {}
        quote_map[code][dt] = {
            "change_pct": float(q.change_pct) if q.change_pct else 0,
            "is_limit_up": q.is_limit_up,
            "is_limit_down": q.is_limit_down,
            "close": float(q.close) if q.close else 0,
        }

    lu_all_result = await db.execute(
        select(LimitUpRecord).where(
            LimitUpRecord.stock_code.in_(codes),
            LimitUpRecord.trade_date.in_(trade_dates),
        )
    )
    lu_map: dict[str, dict[str, int]] = {}
    for r in lu_all_result.scalars().all():
        code = r.stock_code
        dt = str(r.trade_date)
        if code not in lu_map:
            lu_map[code] = {}
        lu_map[code][dt] = r.continuous_days

    stocks_out = []
    for r in tracked_stocks:
        daily: list[dict] = []
        for dt in reversed(trade_dates):
            dt_str = str(dt)
            q = quote_map.get(r.stock_code, {}).get(dt_str)
            board = lu_map.get(r.stock_code, {}).get(dt_str, 0)
            daily.append({
                "date": dt_str,
                "change_pct": q["change_pct"] if q else None,
                "is_limit_up": q["is_limit_up"] if q else False,
                "board_level": board,
            })
        stocks_out.append({
            "stock_code": r.stock_code,
            "stock_name": r.stock_name or r.stock_code,
            "continuous_days": r.continuous_days,
            "limit_reason": r.limit_reason,
            "theme_names": r.theme_names or [],
            "daily": daily,
        })

    return {
        "dates": [str(d) for d in reversed(trade_dates)],
        "stocks": stocks_out,
    }


def _limit_up_to_dict(r: LimitUpRecord) -> dict:
    return {
        "stock_code": r.stock_code,
        "stock_name": r.stock_name or r.stock_code,
        "trade_date": str(r.trade_date),
        "continuous_days": r.continuous_days,
        "first_limit_time": str(r.first_limit_time) if r.first_limit_time else None,
        "last_limit_time": str(r.last_limit_time) if r.last_limit_time else None,
        "open_count": r.open_count,
        "is_one_word": r.is_one_word,
        "is_t_board": r.is_t_board,
        "limit_reason": r.limit_reason,
        "theme_names": r.theme_names,
    }
