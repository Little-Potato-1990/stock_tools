"""定时拉取外部数据源 (akshare / adapter), 落 redis 供 API 只读.

覆盖端点:
    /api/market/bigdata-rank?dimension=fund_flow  -> KEY_FUND_FLOW
    /api/market/bigdata-rank?dimension=hot_concept -> KEY_HOT_CONCEPT
    /api/market/all-boards?kind=concept/industry   -> KEY_ALL_BOARDS_*
    /api/market/theme-detail?name=X                -> KEY_THEME_DETAIL_PREFIX + name

节拍:
    - fund_flow / hot_concept: 盘中 9-14 每 5 min
    - all-boards: 每天 9:25 + 15:30 两次
    - theme-detail: 每天 16:00 对当日 top 题材 (snapshot themes) 批量预拉
"""
from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.snapshot import DailySnapshot
from app.services.external_cache import (
    KEY_ALL_BOARDS_CONCEPT,
    KEY_ALL_BOARDS_INDUSTRY,
    KEY_FUND_FLOW,
    KEY_HOT_CONCEPT,
    KEY_THEME_DETAIL_PREFIX,
    TTL_ALL_BOARDS,
    TTL_FUND_FLOW,
    TTL_HOT_CONCEPT,
    TTL_THEME_DETAIL,
    cache_set_sync,
)
from app.tasks.celery_app import celery

logger = logging.getLogger(__name__)


# ============ fund_flow (akshare 概念资金流) ============

@celery.task(name="app.tasks.external_pull.pull_fund_flow")
def pull_fund_flow_task() -> dict:
    try:
        import akshare as ak
        df = ak.stock_sector_fund_flow_rank(indicator="今日", sector_type="概念资金流")
        items = []
        for _, row in df.head(50).iterrows():
            items.append({
                "name": str(row.get("名称", "")),
                "change_pct": float(row.get("今日涨跌幅", 0) or 0),
                "main_net_inflow": float(row.get("主力净流入-净额", 0) or 0),
                "main_net_pct": float(row.get("主力净流入-净占比", 0) or 0),
                "super_big_net": float(row.get("超大单净流入-净额", 0) or 0),
                "big_net": float(row.get("大单净流入-净额", 0) or 0),
                "mid_net": float(row.get("中单净流入-净额", 0) or 0),
                "small_net": float(row.get("小单净流入-净额", 0) or 0),
            })
        payload = {"dimension": "fund_flow", "label": "主力净流入", "items": items}
        cache_set_sync(KEY_FUND_FLOW, payload, TTL_FUND_FLOW)
        return {"status": "ok", "n": len(items)}
    except Exception as e:
        logger.warning(f"pull_fund_flow_task failed: {e}")
        return {"status": "error", "error": str(e)[:180]}


# ============ hot_concept (adapter 概念板块日线) ============

@celery.task(name="app.tasks.external_pull.pull_hot_concept")
def pull_hot_concept_task() -> dict:
    from app.pipeline.runner import get_adapter
    from app.pipeline.akshare_adapter import AKShareAdapter

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
    for c in concept_data[:50]:
        items.append({
            "name": c["name"],
            "change_pct": c["change_pct"],
            "up_count": c["up_count"],
            "down_count": c["down_count"],
            "lead_stock": c.get("lead_stock", ""),
            "lead_stock_pct": c.get("lead_stock_pct", 0),
        })
    items.sort(key=lambda x: -(x["up_count"] * 2 + x["change_pct"]))
    payload = {"dimension": "hot_concept", "label": "人气概念", "items": items[:30]}
    cache_set_sync(KEY_HOT_CONCEPT, payload, TTL_HOT_CONCEPT)
    return {"status": "ok", "n": len(items)}


# ============ all-boards (concept + industry 板块列表) ============

def _bucket(name: str) -> str:
    if not name:
        return "#"
    ch = name[0]
    if "0" <= ch <= "9":
        return ch
    return ch.upper() if ("A" <= ch.upper() <= "Z") else "中文"


def _key_order(k: str) -> tuple:
    if k == "#":
        return (3, k)
    if k == "中文":
        return (2, k)
    if k.isdigit():
        return (0, k)
    return (1, k)


def _build_all_boards_payload(kind: str) -> dict:
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
    sorted_keys = sorted(groups.keys(), key=_key_order)
    return {
        "kind": kind,
        "groups": [{"letter": k, "items": groups[k]} for k in sorted_keys],
    }


@celery.task(name="app.tasks.external_pull.pull_all_boards")
def pull_all_boards_task() -> dict:
    out = {}
    try:
        c = _build_all_boards_payload("concept")
        cache_set_sync(KEY_ALL_BOARDS_CONCEPT, c, TTL_ALL_BOARDS)
        out["concept"] = len(c.get("groups") or [])
    except Exception as e:
        logger.warning(f"pull_all_boards concept: {e}")
        out["concept_error"] = str(e)[:120]
    try:
        i = _build_all_boards_payload("industry")
        cache_set_sync(KEY_ALL_BOARDS_INDUSTRY, i, TTL_ALL_BOARDS)
        out["industry"] = len(i.get("groups") or [])
    except Exception as e:
        logger.warning(f"pull_all_boards industry: {e}")
        out["industry_error"] = str(e)[:120]
    return out


# ============ theme-detail (每天盘后预拉当日 top 题材) ============

def _build_theme_detail_payload(name: str) -> dict:
    """对齐 api/market.py::get_theme_detail 的输出结构, 从 adapter 拉成分 + DB enrich 涨停."""
    from sqlalchemy import func as sa_func
    from app.models.market import LimitUpRecord
    from app.pipeline.akshare_adapter import AKShareAdapter
    from app.pipeline.runner import get_adapter

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

    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    try:
        with Session(eng) as s:
            latest_date = s.execute(
                select(sa_func.max(LimitUpRecord.trade_date))
            ).scalar_one_or_none()
            lu_map: dict[str, int] = {}
            if latest_date:
                codes = [x["stock_code"] for x in stocks]
                lu_rows = s.execute(
                    select(LimitUpRecord).where(
                        LimitUpRecord.trade_date == latest_date,
                        LimitUpRecord.stock_code.in_(codes),
                    )
                ).scalars().all()
                lu_map = {r.stock_code: r.continuous_days for r in lu_rows}
    finally:
        eng.dispose()

    for st in stocks:
        st["is_limit_up"] = st["stock_code"] in lu_map
        st["continuous_days"] = lu_map.get(st["stock_code"], 0)

    limit_up = sorted(
        [st for st in stocks if st["is_limit_up"]],
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


def _pick_top_themes(td: date, top_n: int = 30) -> list[str]:
    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    themes: list[str] = []
    try:
        with Session(eng) as s:
            snap = s.execute(
                select(DailySnapshot).where(
                    DailySnapshot.snapshot_type == "themes",
                    DailySnapshot.trade_date == td,
                )
            ).scalar_one_or_none()
            if snap and snap.data:
                rows = snap.data.get("top") or snap.data.get("themes") or snap.data.get("ranking") or []
                if isinstance(rows, list):
                    for r in rows[:top_n]:
                        name = r.get("name") if isinstance(r, dict) else None
                        if name:
                            themes.append(name)
    finally:
        eng.dispose()
    return themes


@celery.task(name="app.tasks.external_pull.pull_theme_detail")
def pull_theme_detail_task(top_n: int = 30, trade_date_str: str | None = None) -> dict:
    td = date.fromisoformat(trade_date_str) if trade_date_str else date.today()
    names = _pick_top_themes(td, top_n)
    ok = 0
    err = 0
    for name in names:
        try:
            payload = _build_theme_detail_payload(name)
            cache_set_sync(f"{KEY_THEME_DETAIL_PREFIX}{name}", payload, TTL_THEME_DETAIL)
            ok += 1
        except Exception as e:
            err += 1
            logger.warning(f"pull_theme_detail {name}: {e}")
    return {"ok": ok, "error": err, "total": len(names)}
