"""物化视图排行榜：涨跌榜、题材热度、龙虎榜及统一刷新入口."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._cache import cached_call, invalidate
from app.api._redis_cache import get_json
from app.database import get_db


async def _redis_fastpath(key: str, limit: int) -> list | None:
    """Redis 排行榜 fast path：只在 (universe=default, no board, limit<=100)
    且 warmup 已写入 list 型 payload 时返回截断结果，否则返 None 让上层走 SQL。"""
    cached = await get_json(key)
    if isinstance(cached, list):
        return cached[:limit]
    return None

router = APIRouter()

_MV_TABLES = (
    "universe_default_active",
    "universe_wide",
    "today_top_gainers",
    "today_top_losers",
    "hot_themes",
    "lhb_today",
)

# 排行榜「板块」条件：:board 为 NULL 时不过滤
_BOARD_MV = " AND (CAST(:board AS text) IS NULL OR board = :board)"
_BOARD_STOCKS_ALIAS = " AND (CAST(:board AS text) IS NULL OR s.board = :board)"

_GAINERS_WIDE = """
WITH latest AS (SELECT MAX(trade_date) AS d FROM daily_quotes)
SELECT
  RIGHT(q.stock_code, 6) AS code,
  q.stock_code AS full_code,
  s.name,
  s.status,
  s.board,
  q.trade_date,
  q.close,
  q.change_pct,
  q.amount,
  q.turnover_rate
FROM daily_quotes q
JOIN latest ON q.trade_date = latest.d
JOIN stocks s ON s.code = RIGHT(q.stock_code, 6)
WHERE 1=1{board}
ORDER BY q.change_pct DESC
LIMIT :lim
"""

_GAINERS_DELISTED = """
WITH latest AS (SELECT MAX(trade_date) AS d FROM daily_quotes)
SELECT
  RIGHT(q.stock_code, 6) AS code,
  q.stock_code AS full_code,
  s.name,
  s.status,
  s.board,
  q.trade_date,
  q.close,
  q.change_pct,
  q.amount,
  q.turnover_rate
FROM daily_quotes q
JOIN latest ON q.trade_date = latest.d
JOIN stocks s ON s.code = RIGHT(q.stock_code, 6)
WHERE s.status = 'delisted'{board}
ORDER BY q.change_pct DESC
LIMIT :lim
"""

_LOSERS_WIDE = """
WITH latest AS (SELECT MAX(trade_date) AS d FROM daily_quotes)
SELECT
  RIGHT(q.stock_code, 6) AS code,
  q.stock_code AS full_code,
  s.name,
  s.status,
  s.board,
  q.trade_date,
  q.close,
  q.change_pct,
  q.amount,
  q.turnover_rate
FROM daily_quotes q
JOIN latest ON q.trade_date = latest.d
JOIN stocks s ON s.code = RIGHT(q.stock_code, 6)
WHERE 1=1{board}
ORDER BY q.change_pct ASC
LIMIT :lim
"""

_LOSERS_DELISTED = """
WITH latest AS (SELECT MAX(trade_date) AS d FROM daily_quotes)
SELECT
  RIGHT(q.stock_code, 6) AS code,
  q.stock_code AS full_code,
  s.name,
  s.status,
  s.board,
  q.trade_date,
  q.close,
  q.change_pct,
  q.amount,
  q.turnover_rate
FROM daily_quotes q
JOIN latest ON q.trade_date = latest.d
JOIN stocks s ON s.code = RIGHT(q.stock_code, 6)
WHERE s.status = 'delisted'{board}
ORDER BY q.change_pct ASC
LIMIT :lim
"""


def _gainers_losers_sql(k: str, universe: str) -> str:
    """gainers 或 losers 的完整 SQL。universe: default / wide / active_only / st_only / delisted_only。"""
    is_losers = k == "losers"
    table = "today_top_losers" if is_losers else "today_top_gainers"
    order = "ASC" if is_losers else "DESC"
    wide = _LOSERS_WIDE if is_losers else _GAINERS_WIDE
    delisted = _LOSERS_DELISTED if is_losers else _GAINERS_DELISTED

    if universe == "wide":
        return wide.format(board=_BOARD_STOCKS_ALIAS)
    if universe == "delisted_only":
        return delisted.format(board=_BOARD_STOCKS_ALIAS)
    # 物化视图 + 按 status 细筛
    extra = ""
    if universe == "active_only":
        extra = " AND status = 'listed_active'"
    elif universe == "st_only":
        extra = " AND status IN ('st', 'star_st')"
    return (
        f"SELECT * FROM {table} WHERE 1=1{extra}{_BOARD_MV} "
        f"ORDER BY change_pct {order} LIMIT :lim"
    )


async def _rows(db: AsyncSession, sql: str, params: dict) -> list:
    """执行查询并将行序列化为 JSON 友好结构。"""
    result = await db.execute(text(sql), params)
    return jsonable_encoder([dict(m) for m in result.mappings().all()])


@router.get("/today/gainers")
async def today_gainers(
    limit: int = Query(50, ge=1, le=200),
    universe: str = Query("default"),
    board: str | None = Query(None, description="主板/创业板/科创板/北交所"),
    db: AsyncSession = Depends(get_db),
):
    """当日涨幅榜（`today_top_gainers` 或宽表内联 SQL）。

    universe=default 时走物化视图（在市+ST）；wide 为全 A 含停牌/退市等；
    active_only / st_only 在物化结果上再按 status 筛；delisted_only 为退市股
    内联榜。board 为可选板块过滤。
    """

    if limit <= 100 and universe == "default" and not board:
        fast = await _redis_fastpath("ranking:today_top_gainers", limit)
        if fast is not None:
            return fast

    async def _load():
        sql = _gainers_losers_sql("gainers", universe)
        return await _rows(db, sql, {"lim": limit, "board": board})

    return await cached_call(
        ("rankings", "gainers", limit, universe, board), _load, ttl=30.0
    )


@router.get("/today/losers")
async def today_losers(
    limit: int = Query(50, ge=1, le=200),
    universe: str = Query("default"),
    board: str | None = Query(None, description="主板/创业板/科创板/北交所"),
    db: AsyncSession = Depends(get_db),
):
    """当日跌幅榜（`today_top_losers` 或宽表内联 SQL），参数语义同 `today_gainers`。"""
    if limit <= 100 and universe == "default" and not board:
        fast = await _redis_fastpath("ranking:today_top_losers", limit)
        if fast is not None:
            return fast

    async def _load():
        sql = _gainers_losers_sql("losers", universe)
        return await _rows(db, sql, {"lim": limit, "board": board})

    return await cached_call(
        ("rankings", "losers", limit, universe, board), _load, ttl=30.0
    )


@router.get("/today/themes")
async def today_themes(
    limit: int = Query(50, ge=1, le=200),
    universe: str = Query("default", description="无实际过滤，仅为接口一致性保留"),
    board: str | None = Query(
        None, description="无实际过滤（题材榜无股票板块维度），保留占位"
    ),
    db: AsyncSession = Depends(get_db),
):
    """当日题材热度（`hot_themes`，最多 30 行）。

    物化视图为题材维度，无股票 status；universe / board 参数不产生过滤，仅与
    其他排行榜接口保持查询形状一致。
    """
    if limit <= 100:
        fast = await _redis_fastpath("ranking:hot_themes", limit)
        if fast is not None:
            return fast

    async def _load():
        return await _rows(
            db,
            """
            SELECT * FROM hot_themes
            ORDER BY rank ASC NULLS LAST
            LIMIT :lim
            """,
            {"lim": limit},
        )

    return await cached_call(
        ("rankings", "themes", limit, universe, board), _load, ttl=30.0
    )


@router.get("/today/lhb")
async def today_lhb(
    limit: int = Query(50, ge=1, le=200),
    universe: str = Query("default", description="无实际过滤，仅为接口一致性保留"),
    board: str | None = Query(
        None, description="无实际过滤（龙虎榜行内无 board 列），保留占位"
    ),
    db: AsyncSession = Depends(get_db),
):
    """当日龙虎榜展开列表（`lhb_today`）。

    快照内无与 stocks.status 同步的列；universe / board 不产生过滤，仅占位。
    """
    if limit <= 100:
        fast = await _redis_fastpath("ranking:lhb_today", limit)
        if fast is not None:
            return fast

    async def _load():
        return await _rows(
            db,
            """
            SELECT * FROM lhb_today
            ORDER BY net_amount DESC NULLS LAST
            LIMIT :lim
            """,
            {"lim": limit},
        )

    return await cached_call(
        ("rankings", "lhb", limit, universe, board), _load, ttl=30.0
    )


@router.post("/refresh")
async def refresh_warm_views(db: AsyncSession = Depends(get_db)):
    """执行 `CALL refresh_warm_views()` 并返回各物化视图行数。"""
    await db.execute(text("CALL refresh_warm_views()"))
    await db.commit()
    invalidate("rankings")
    counts: dict[str, int] = {}
    for t in _MV_TABLES:
        r = await db.execute(text(f"SELECT COUNT(*) AS c FROM {t}"))
        counts[t] = int(r.scalar_one())
    return {"refreshed": True, "counts": counts}
