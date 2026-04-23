"""warmup_redis.py — Phase 1.5

把 universe 成员、当日榜单、热门题材等 Warm 数据预灌到 Redis，让 API
首屏命中 Redis 而非现查 PG。

Key 约定（plan §3/§4）：
- universe:default_active                Set, 全部 listed_active+st+star_st 的 6 位 code
- universe:wide                          Set, 全 A 含退市
- universe:mainstream_index              Set, 沪深 300+中证 500+1000（如有 index_components 数据）
- ranking:today_top_gainers              JSON 序列化的 top 100
- ranking:today_top_losers               JSON 序列化的 top 100
- ranking:hot_themes                     JSON 序列化的 top 30
- ranking:lhb_today                      JSON 序列化的 lhb stocks 列表

幂等：每个 key 都先 DEL 再 SET/SADD。TTL 默认 12h，给后台 cron 留时间补刷。
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import redis
from sqlalchemy import text

from app.config import get_settings
from scripts._backfill_common import db_engine, setup_logging


logger = setup_logging("warmup_redis")


def _decimal_default(o):
    """Decimal / date -> JSON 友好类型。"""
    from decimal import Decimal
    from datetime import datetime as _dt, date as _date

    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (_dt, _date)):
        return o.isoformat()
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def _redis_client() -> redis.Redis:
    settings = get_settings()
    return redis.from_url(settings.redis_url, decode_responses=True)


def warmup_universe(r: redis.Redis) -> None:
    eng = db_engine()
    with eng.connect() as conn:
        # universe:default_active
        rows = conn.execute(
            text(
                "SELECT code FROM stocks "
                "WHERE status IN ('listed_active','st','star_st')"
            )
        ).fetchall()
        codes = [r[0] for r in rows]
        r.delete("universe:default_active")
        if codes:
            r.sadd("universe:default_active", *codes)
        r.expire("universe:default_active", 86400)
        logger.info(f"universe:default_active = {len(codes)} codes")

        # universe:wide
        rows = conn.execute(text("SELECT code FROM stocks")).fetchall()
        codes = [r[0] for r in rows]
        r.delete("universe:wide")
        if codes:
            r.sadd("universe:wide", *codes)
        r.expire("universe:wide", 86400)
        logger.info(f"universe:wide = {len(codes)} codes")


def warmup_rankings(r: redis.Redis) -> None:
    eng = db_engine()
    with eng.connect() as conn:
        # 用刚建好的物化视图直接捞 top
        for view, key in (
            ("today_top_gainers", "ranking:today_top_gainers"),
            ("today_top_losers", "ranking:today_top_losers"),
        ):
            try:
                rows = conn.execute(text(f"SELECT * FROM {view}")).mappings().all()
            except Exception as e:
                logger.warning(f"{view} not ready: {e}")
                continue
            payload = json.dumps(
                [dict(row) for row in rows], default=_decimal_default, ensure_ascii=False
            )
            r.set(key, payload, ex=12 * 3600)
            logger.info(f"{key} = {len(rows)} rows")

        try:
            rows = conn.execute(text("SELECT * FROM hot_themes")).mappings().all()
            r.set(
                "ranking:hot_themes",
                json.dumps(
                    [dict(row) for row in rows],
                    default=_decimal_default,
                    ensure_ascii=False,
                ),
                ex=12 * 3600,
            )
            logger.info(f"ranking:hot_themes = {len(rows)} rows")
        except Exception as e:
            logger.warning(f"hot_themes not ready: {e}")

        try:
            rows = conn.execute(text("SELECT * FROM lhb_today")).mappings().all()
            r.set(
                "ranking:lhb_today",
                json.dumps(
                    [dict(row) for row in rows],
                    default=_decimal_default,
                    ensure_ascii=False,
                ),
                ex=12 * 3600,
            )
            logger.info(f"ranking:lhb_today = {len(rows)} rows")
        except Exception as e:
            logger.warning(f"lhb_today not ready: {e}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--skip-universe", action="store_true", help="只刷 ranking, 不动 universe"
    )
    p.add_argument(
        "--skip-rankings", action="store_true", help="只刷 universe, 不动 ranking"
    )
    p.add_argument(
        "--also-clear-cache",
        action="store_true",
        help="灌完 Redis 后清理进程内 rankings 内存缓存，避免与 Redis 不一致",
    )
    args = p.parse_args()

    r = _redis_client()
    if not args.skip_universe:
        warmup_universe(r)
    if not args.skip_rankings:
        warmup_rankings(r)
    if args.also_clear_cache:
        try:
            from app.api._cache import invalidate

            n = invalidate(prefix="rankings")
            logger.info("in-memory cache invalidated prefix=rankings (%d entries)", n)
        except Exception as e:
            logger.warning("also-clear-cache skipped: %s", e)
    logger.info("DONE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
