import asyncio
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
    from sqlalchemy import func as sa_func

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
    count: int = Query(50, ge=5, le=200),
    hours: int = Query(24, ge=1, le=168, description="时间窗 (小时)"),
    min_importance: int = Query(0, ge=0, le=5, description="最小重要级 0=不限"),
    sources: str = Query("", description="过滤源, 多个逗号分隔. e.g. cls,ak_global,tushare_wallstreet"),
    sentiment: str = Query("", description="过滤倾向: bullish | neutral | bearish"),
    impact_horizon: str = Query("", description="影响时间维度过滤: short | swing | long | mixed"),
    code: str = Query("", description="只返回命中此股票代码的"),
    theme: str = Query("", description="只返回命中此题材的"),
    sort: str = Query("default", regex="^(default|time|smart)$"),
    fallback_live: int = Query(1, ge=0, le=1, description="DB 没数据时, 是否实时拉一次 ingest 兜底"),
    watch: str = Query("", description="逗号分隔自选股代码, sort=smart 时给加成"),
    hot_themes: str = Query("", description="逗号分隔当前热点题材, sort=smart 时给加成"),
    debug_score: int = Query(0, ge=0, le=1, description="sort=smart 时返回 _score / _score_breakdown"),
    db: AsyncSession = Depends(get_db),
):
    """多源财经新闻 (Phase 1 后改为读 news_summaries 表).

    数据通路: celery beat 每 30 分钟拉所有源 + AI 打标 → news_summaries
    本接口仅做查询 / 过滤; 兜底情况下 (DB 空) 触发一次 ingest_once.
    """
    from app.news.ingest import (
        fetch_news_for_codes,
        fetch_news_for_themes,
        fetch_recent_news,
        ingest_once,
    )

    src_list: list[str] | None = None
    if sources.strip():
        src_list = [s.strip() for s in sources.split(",") if s.strip()]

    if code.strip():
        items = await asyncio.to_thread(
            fetch_news_for_codes, [code.strip()], hours, count
        )
    elif theme.strip():
        items = await asyncio.to_thread(
            fetch_news_for_themes, [theme.strip()], hours, count
        )
    else:
        items = await asyncio.to_thread(
            fetch_recent_news,
            hours, count, (min_importance or None), src_list,
        )

    if sentiment in ("bullish", "neutral", "bearish"):
        items = [it for it in items if it.get("sentiment") == sentiment]

    if impact_horizon in ("short", "swing", "long", "mixed"):
        items = [it for it in items if it.get("impact_horizon") == impact_horizon]

    if not items and fallback_live:
        # DB 空 → 实时跑一次轻量 ingest (不打标, 防阻塞 API)
        try:
            await ingest_once(window_hours=12.0, do_tag=False)
            items = await asyncio.to_thread(
                fetch_recent_news, hours, count, (min_importance or None), src_list,
            )
        except Exception:
            items = []

    if sort == "time":
        items.sort(key=lambda x: x.get("pub_time") or "", reverse=True)
    elif sort == "smart":
        from app.news.ranker import rank_news
        wc = [c.strip() for c in watch.split(",") if c.strip()]
        ht = [t.strip() for t in hot_themes.split(",") if t.strip()]
        items = rank_news(
            items,
            watch_codes=wc,
            hot_themes=ht,
            top_k=count,
            attach_score=bool(debug_score),
        )
    return items


@router.get("/bigdata-rank")
async def get_bigdata_rank(
    dimension: str = Query("fund_flow", description="排名维度"),
    db: AsyncSession = Depends(get_db),
):
    """大数据多维排名: 按不同资金维度对概念板块排名.

    fund_flow / hot_concept 优先读 redis cache (celery beat 每 5 min 刷新),
    miss 才走外网 adapter 兜底, 减少每次点击都打 akshare.
    """
    from app.pipeline.akshare_adapter import AKShareAdapter
    from app.services.external_cache import (
        KEY_FUND_FLOW, KEY_HOT_CONCEPT, cache_get,
    )

    if dimension == "fund_flow":
        cached = await cache_get(KEY_FUND_FLOW)
        if cached:
            return cached
        # cache miss 兜底
        try:
            import akshare as ak
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
        cached = await cache_get(KEY_HOT_CONCEPT)
        if cached:
            return cached
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

    优先走 redis cache (beat 盘后对 top30 题材预拉), miss 再走 adapter 兜底.
    """
    from app.services.external_cache import KEY_THEME_DETAIL_PREFIX, cache_get
    cached = await cache_get(f"{KEY_THEME_DETAIL_PREFIX}{name}")
    if cached:
        return cached

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
    from app.models.stock import DailyQuote, Stock  # DailyQuote used in trailing query

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
    """返回所有概念/行业板块，按首字符分组用于"概念分类/行业分类"页面。

    优先读 redis cache (beat 每天 9:25 + 15:30 两次), miss 兜底打 adapter.
    """
    from app.services.external_cache import (
        KEY_ALL_BOARDS_CONCEPT, KEY_ALL_BOARDS_INDUSTRY, cache_get,
    )
    cached = await cache_get(
        KEY_ALL_BOARDS_CONCEPT if kind == "concept" else KEY_ALL_BOARDS_INDUSTRY
    )
    if cached:
        return cached

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
    from sqlalchemy import or_

    date_rows = await db.execute(
        select(MarketSentiment.trade_date)
        .order_by(MarketSentiment.trade_date.desc())
        .limit(days)
    )
    trade_dates = [row[0] for row in date_rows.all()]
    if not trade_dates:
        return {"dates": [], "rows": rows, "cells": {}}

    def _scope_clause(col):
        # SQL-level prefix filter, avoid loading 全部 quotes 后 Python 再筛.
        if scope == "main":
            return or_(col.like("60%"), col.like("00%")) & ~col.like("300%")
        if scope == "gem":
            return or_(col.like("300%"), col.like("301%"))
        if scope == "star":
            return or_(col.like("688%"), col.like("689%"))
        if scope == "bj":
            return or_(col.like("8%"), col.like("4%"))
        return None

    cells: dict[str, list] = {}
    PER_DAY_PREFETCH = max(rows * 20, 100)  # 给 lu 重排留余量

    for dt in trade_dates:
        lu_q = select(LimitUpRecord).where(LimitUpRecord.trade_date == dt)
        sc = _scope_clause(LimitUpRecord.stock_code)
        if sc is not None:
            lu_q = lu_q.where(sc)
        lu_res = await db.execute(lu_q)
        lu_records = list(lu_res.scalars().all())
        lu_map = {r.stock_code: r for r in lu_records}

        # 只取当日按 change_pct desc 前 N 条 quotes (绝大多数候选); 涨停股始终通过 lu_map 兜底进入打分.
        q_q = (
            select(DailyQuote)
            .where(DailyQuote.trade_date == dt)
            .order_by(DailyQuote.change_pct.desc().nullslast())
            .limit(PER_DAY_PREFETCH)
        )
        sc2 = _scope_clause(DailyQuote.stock_code)
        if sc2 is not None:
            q_q = q_q.where(sc2)
        q_res = await db.execute(q_q)
        quotes = list(q_res.scalars().all())

        scored = []
        seen_codes: set[str] = set()
        for q in quotes:
            seen_codes.add(q.stock_code)
            lu = lu_map.get(q.stock_code)
            board = lu.continuous_days if lu else 0
            chg = float(q.change_pct or 0)
            amount = float(q.amount or 0)
            score = board * 1000 + chg * 10 + amount / 1e9
            scored.append((score, q, lu))

        # 涨停股若不在 prefetch top-N 内, 也要拉进来 (例如一字板 amount 极小)
        missing_codes = [c for c in lu_map.keys() if c not in seen_codes]
        if missing_codes:
            extra_res = await db.execute(
                select(DailyQuote).where(
                    DailyQuote.trade_date == dt,
                    DailyQuote.stock_code.in_(missing_codes),
                )
            )
            for q in extra_res.scalars().all():
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
