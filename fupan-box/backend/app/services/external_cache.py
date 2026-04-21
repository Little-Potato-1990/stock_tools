"""外部数据源 (akshare / adapter) 的 redis 缓存 helper.

用于把 fund_flow / all-boards / theme-detail 等原本"用户请求时打外网"的
数据, 改为 celery beat 定时拉取写入 redis, API 优先读 redis, miss 才兜底
直接调用.

设计要点:
    - 单源单 key, TTL 覆盖"刷新周期 × 2", 保证即使 beat 漏一次也还能读.
    - 序列化用 json (外部数据都是可 json 的 list[dict] / dict).
    - sync / async 双入口: celery worker 走 sync (redis-py); FastAPI 走 async.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import redis
import redis.asyncio as aioredis

from app.config import get_settings

logger = logging.getLogger(__name__)


def _sync_client() -> redis.Redis:
    settings = get_settings()
    return redis.Redis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)


_async_client: aioredis.Redis | None = None


async def _get_async_client() -> aioredis.Redis | None:
    global _async_client
    if _async_client is not None:
        return _async_client
    try:
        settings = get_settings()
        _async_client = aioredis.from_url(
            settings.redis_url, encoding="utf-8", decode_responses=True
        )
        await _async_client.ping()
    except Exception as e:
        logger.warning(f"external_cache async client unavailable: {e}")
        _async_client = None
    return _async_client


# ============ sync (celery worker 用) ============

def cache_set_sync(key: str, value: Any, ttl_seconds: int) -> bool:
    try:
        cli = _sync_client()
        cli.set(key, json.dumps(value, ensure_ascii=False, default=str), ex=ttl_seconds)
        return True
    except Exception as e:
        logger.warning(f"external_cache.set sync {key}: {e}")
        return False


def cache_get_sync(key: str) -> Any | None:
    try:
        cli = _sync_client()
        s = cli.get(key)
        if not s:
            return None
        return json.loads(s)
    except Exception as e:
        logger.warning(f"external_cache.get sync {key}: {e}")
        return None


# ============ async (FastAPI 用) ============

async def cache_get(key: str) -> Any | None:
    cli = await _get_async_client()
    if cli is None:
        return None
    try:
        s = await cli.get(key)
        if not s:
            return None
        return json.loads(s)
    except Exception as e:
        logger.warning(f"external_cache.get async {key}: {e}")
        return None


async def cache_set(key: str, value: Any, ttl_seconds: int) -> bool:
    cli = await _get_async_client()
    if cli is None:
        return False
    try:
        await cli.set(key, json.dumps(value, ensure_ascii=False, default=str), ex=ttl_seconds)
        return True
    except Exception as e:
        logger.warning(f"external_cache.set async {key}: {e}")
        return False


# ============ 固定 key constants ============

# fund_flow: 主力资金流排名, 盘中每 5min 刷新; 盘后用最后一次
KEY_FUND_FLOW = "external:fund_flow:concept"            # 概念
KEY_HOT_CONCEPT = "external:hot_concept"                # 人气概念
KEY_ALL_BOARDS_CONCEPT = "external:all_boards:concept"  # 概念板块列表
KEY_ALL_BOARDS_INDUSTRY = "external:all_boards:industry"  # 行业板块列表
KEY_THEME_DETAIL_PREFIX = "external:theme_detail:"      # + theme_name

# 默认 TTL (秒); 远大于 beat 周期, 即使漏一轮仍可读
TTL_FUND_FLOW = 15 * 60          # 15min (盘中每 5min 刷新)
TTL_HOT_CONCEPT = 20 * 60        # 20min
TTL_ALL_BOARDS = 6 * 3600        # 6h (每天 2 次)
TTL_THEME_DETAIL = 4 * 3600      # 4h (每天盘后刷一次)
