"""Redis 滑窗限流中间件 (Phase 1).

策略:
- 匿名 (按 IP):                默认 60 次/分钟
- 登录用户 (按 user_id):        默认 300 次/分钟
- 排除路径: /api/health*, /api/auth/login, /api/auth/register, 静态资源

实现:
- ZSET 滑窗 (timestamp 作为 score), 60 秒滚动窗口
- 一次请求 = 1 个 token 消耗
- 超限返回 429 + Retry-After header

未来 Phase 5 quota 三档 (anonymous / free / pro) 由调用方在 router 内单独处理,
这里只做粗粒度网关限流, 防止扫接口 / 爬数据.
"""
from __future__ import annotations

import logging
import time
from typing import Awaitable, Callable

import redis.asyncio as aioredis
from fastapi import Request, Response
from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import get_settings

logger = logging.getLogger(__name__)


_EXCLUDED_PREFIXES = (
    "/api/health",
    "/api/auth/login",
    "/api/auth/register",
    "/docs",
    "/openapi.json",
    "/redoc",
)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """基于 Redis ZSET 滑窗的全站限流中间件."""

    def __init__(
        self,
        app,
        anonymous_per_min: int = 60,
        user_per_min: int = 300,
        window_seconds: int = 60,
        redis_url: str | None = None,
    ):
        super().__init__(app)
        settings = get_settings()
        self._anon_limit = anonymous_per_min
        self._user_limit = user_per_min
        self._window = window_seconds
        self._secret = settings.secret_key
        self._algo = settings.algorithm
        self._redis: aioredis.Redis | None = None
        self._redis_url = redis_url or settings.redis_url

    async def _get_redis(self) -> aioredis.Redis | None:
        if self._redis is not None:
            return self._redis
        try:
            self._redis = aioredis.from_url(
                self._redis_url, encoding="utf-8", decode_responses=True
            )
            await self._redis.ping()
        except Exception as e:
            logger.warning(f"rate limit redis unavailable, skip: {e}")
            self._redis = None
        return self._redis

    def _identify(self, request: Request) -> tuple[str, int]:
        """返回 (limit_key, limit_per_min). 优先 user_id, 退化到 IP."""
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
            try:
                payload = jwt.decode(token, self._secret, algorithms=[self._algo])
                uid = payload.get("sub")
                if uid:
                    return f"rl:u:{uid}", self._user_limit
            except JWTError:
                pass

        client_host = request.client.host if request.client else "unknown"
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            client_host = forwarded.split(",")[0].strip()
        return f"rl:ip:{client_host}", self._anon_limit

    @staticmethod
    def _is_excluded(path: str) -> bool:
        return any(path.startswith(p) for p in _EXCLUDED_PREFIXES)

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if self._is_excluded(request.url.path):
            return await call_next(request)
        if not request.url.path.startswith("/api/"):
            return await call_next(request)

        redis = await self._get_redis()
        if redis is None:
            return await call_next(request)

        key, limit = self._identify(request)
        now_ms = int(time.time() * 1000)
        window_start = now_ms - self._window * 1000

        try:
            pipe = redis.pipeline()
            pipe.zremrangebyscore(key, 0, window_start)
            pipe.zadd(key, {f"{now_ms}-{id(request)}": now_ms})
            pipe.zcard(key)
            pipe.expire(key, self._window + 5)
            _, _, count, _ = await pipe.execute()
        except Exception as e:
            logger.warning(f"rate limit redis op failed, skip: {e}")
            return await call_next(request)

        remaining = max(0, limit - int(count))
        if int(count) > limit:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too Many Requests",
                    "limit": limit,
                    "window_seconds": self._window,
                },
                headers={
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(self._window),
                    "Retry-After": str(self._window),
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(self._window)
        return response
