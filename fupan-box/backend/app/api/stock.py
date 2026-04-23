"""个股 7 维上下文 HTTP 端点.

主要供前端 chip / drawer / hover popover 调用, 也可作为 LLM 工具.

读取顺序 (cache-first 改造后):
    1. PG brief_cache `stock_context:{code}:{td}` — prewarm-stock-context 每日 17:40 写入
    2. 内存 cached_call 120s — 防点击风暴
    3. 实时 SQL 拼装 (fallback, 第一次访问 / universe 外 / 部分维度未落库)
"""
import asyncio
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.brief_cache import pg_get, pg_set
from app.api._cache import cached_call
from app.database import get_db
from app.models.stock import DailyQuote
from app.services.stock_context import get_stock_context, get_stock_contexts


router = APIRouter()

_CONTEXT_PG_TTL_H = 24.0


async def _resolve_trade_date(db: AsyncSession, td: date | None) -> date | None:
    if td:
        return td
    r = await db.execute(select(func.max(DailyQuote.trade_date)))
    return r.scalar_one_or_none()


async def _ctx_via_pg_or_db(
    db: AsyncSession, code: str, td: date | None, dims: list[str] | None,
) -> dict:
    """先试 PG cache, miss 再跑 SQL + 回写 (仅无 dims 子集过滤时命中 cache key)."""
    resolved = await _resolve_trade_date(db, td)
    # 只有"全维度"版本落 PG cache. 指定 dimensions 时跳过 cache, 避免污染.
    use_cache = resolved and not dims
    if use_cache:
        key = f"stock_context:{code}:{resolved.isoformat()}"
        cached = await asyncio.to_thread(pg_get, key)
        if cached is not None:
            return cached

    ctx = await get_stock_context(db, code, trade_date=resolved, dimensions=dims)

    if use_cache and isinstance(ctx, dict):
        try:
            await asyncio.to_thread(
                pg_set, key, ctx,
                action="stock_context", model=None, trade_date=resolved,
                ttl_hours=_CONTEXT_PG_TTL_H, source="ondemand",
            )
        except Exception:
            pass
    return ctx


@router.get("/context/{code}")
async def stock_context(
    code: str,
    trade_date: date | None = Query(None),
    dimensions: str | None = Query(None, description="逗号分隔的维度子集, 如 price,capital"),
    db: AsyncSession = Depends(get_db),
):
    """单股 7 维上下文."""
    code = code.strip().zfill(6)
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(status_code=400, detail="invalid stock code")
    dims = [d.strip() for d in dimensions.split(",")] if dimensions else None
    key = ("stock_ctx", code, str(trade_date), dimensions or "")
    return await cached_call(
        key,
        lambda: _ctx_via_pg_or_db(db, code, trade_date, dims),
        ttl=120.0,
    )


class BatchReq(BaseModel):
    codes: list[str] = Field(..., min_length=1, max_length=80)
    trade_date: date | None = None
    dimensions: list[str] | None = None


@router.post("/context/batch")
async def stock_context_batch(req: BatchReq, db: AsyncSession = Depends(get_db)):
    """批量上下文(最多 80 只). 适合自选 / 题材成分股一次性渲染 chip."""
    return await get_stock_contexts(
        db, req.codes, trade_date=req.trade_date, dimensions=req.dimensions,
    )


def _normalize_kline_code(code: str) -> str:
    """将 sz000001 / sh600000 / 000001 统一为 6 位裸码 (daily_quotes 用 RIGHT(stock_code,6) 对齐)."""
    raw = code.strip().lower()
    for prefix in ("sz", "sh", "bj"):
        if raw.startswith(prefix):
            tail = raw[len(prefix) :]
            if tail.isdigit():
                raw = tail
            break
    if not raw.isdigit():
        raise HTTPException(status_code=400, detail="invalid stock code")
    out = raw.zfill(6)
    if len(out) != 6:
        raise HTTPException(status_code=400, detail="invalid stock code")
    return out


def _parse_kline_fields(fields: str) -> tuple[bool, bool, bool]:
    """解析 fields 查询参数: ohlc 始终返回; vol / turnover / amplitude 按需附加."""
    parts = {p.strip().lower() for p in fields.split(",") if p.strip()}
    return ("vol" in parts, "turnover" in parts, "amplitude" in parts)


def _kline_row_from_mapping(
    r: dict,
    want_vol: bool,
    want_turnover: bool,
    want_amplitude: bool,
) -> dict:
    """将一行 SQL 结果压成短键 JSON (d/o/h/l/c + 可选 vol/turnover/amplitude)."""
    dval = r["d"]
    row: dict = {
        "d": dval.isoformat() if isinstance(dval, date) else str(dval),
        "o": float(r["o"]) if r.get("o") is not None else None,
        "h": float(r["h"]) if r.get("h") is not None else None,
        "l": float(r["l"]) if r.get("l") is not None else None,
        "c": float(r["c"]) if r.get("c") is not None else None,
    }
    if want_vol and "vol" in r:
        vol = r["vol"]
        row["vol"] = int(vol) if vol is not None else None
    if want_turnover and "turnover" in r:
        tr = r["turnover"]
        row["turnover"] = float(tr) if tr is not None else None
    if want_amplitude and "amplitude" in r:
        amp = r["amplitude"]
        row["amplitude"] = float(amp) if amp is not None else None
    return row


def _build_kline_sql(
    lod: str,
    want_vol: bool,
    want_turnover: bool,
    want_amplitude: bool,
) -> str:
    """拼装日 / 周 / 月 K 线 SQL (聚合在 PG 内完成)."""
    ohlc = [
        "(array_agg(open ORDER BY trade_date ASC))[1] AS o",
        "MAX(high) AS h",
        "MIN(low) AS l",
        "(array_agg(close ORDER BY trade_date DESC))[1] AS c",
    ]
    if lod == "day":
        cols = [
            "trade_date AS d",
            "open AS o",
            "high AS h",
            "low AS l",
            "close AS c",
        ]
        if want_vol:
            cols.append("volume AS vol")
        if want_turnover:
            cols.append("turnover_rate AS turnover")
        if want_amplitude:
            cols.append("amplitude AS amplitude")
        return (
            f"SELECT {', '.join(cols)} FROM daily_quotes "
            "WHERE right(stock_code, 6) = :code "
            "AND trade_date >= :start AND trade_date <= :end "
            "ORDER BY d"
        )
    if lod == "week":
        bucket = "date_trunc('week', trade_date)::date AS d"
        group = "date_trunc('week', trade_date)"
    else:
        bucket = "date_trunc('month', trade_date)::date AS d"
        group = "date_trunc('month', trade_date)"
    cols = [bucket, *ohlc]
    if want_vol:
        cols.append("SUM(volume) AS vol")
    if want_turnover:
        cols.append("AVG(turnover_rate) AS turnover")
    if want_amplitude:
        cols.append("AVG(amplitude) AS amplitude")
    return (
        f"SELECT {', '.join(cols)} FROM daily_quotes "
        "WHERE right(stock_code, 6) = :code "
        "AND trade_date >= :start AND trade_date <= :end "
        f"GROUP BY {group} ORDER BY d"
    )


async def _fetch_kline_impl(
    db: AsyncSession,
    code_norm: str,
    start: date | None,
    end: date | None,
    lod: str,
    want_vol: bool,
    want_turnover: bool,
    want_amplitude: bool,
) -> dict:
    """实际查库: 默认 end=全市场最近交易日, start=end 往前 365 天."""
    end_eff = end
    if end_eff is None:
        end_eff = await _resolve_trade_date(db, None)
    start_eff = start
    if end_eff is None:
        return {"code": code_norm, "lod": lod, "rows": []}
    if start_eff is None:
        start_eff = end_eff - timedelta(days=365)
    if start_eff > end_eff:
        return {"code": code_norm, "lod": lod, "rows": []}

    sql = _build_kline_sql(lod, want_vol, want_turnover, want_amplitude)
    result = await db.execute(
        text(sql),
        {"code": code_norm, "start": start_eff, "end": end_eff},
    )
    rows = [
        _kline_row_from_mapping(dict(m), want_vol, want_turnover, want_amplitude)
        for m in result.mappings()
    ]
    return {"code": code_norm, "lod": lod, "rows": rows}


@router.get("/kline/{code}")
async def get_kline(
    code: str,
    start: date | None = Query(None),
    end: date | None = Query(None),
    lod: str = Query("day", pattern="^(day|week|month)$"),
    fields: str = Query("ohlc,vol", description="逗号分隔: ohlc,vol,turnover,amplitude"),
    db: AsyncSession = Depends(get_db),
):
    """单股 K 线 / 历史行情, 支持日周月 LOD (PG 聚合), 短字段名减小体积."""
    code_norm = _normalize_kline_code(code)
    want_vol, want_turnover, want_amplitude = _parse_kline_fields(fields)
    key = ("kline", code_norm, start, end, lod, fields)
    return await cached_call(
        key,
        lambda: _fetch_kline_impl(
            db,
            code_norm,
            start,
            end,
            lod,
            want_vol,
            want_turnover,
            want_amplitude,
        ),
        ttl=60.0,
    )
