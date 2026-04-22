import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import market, snapshot, auth, ai_chat, ai_brief, watchlist, trades, quota, intraday, plans, me, news, stock, capital, methodology, skills, skill_scan
from app.config import get_settings
from app.database import engine, Base
from app.middleware.rate_limit import RateLimitMiddleware
from app.embedded_celery import (
    start_embedded_celery,
    stop_embedded_celery,
    heartbeat as celery_heartbeat,
)

logger = logging.getLogger("fupanbox")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # schema 由 alembic 管理 (alembic upgrade head). 仅当显式开启 dev 兜底
    # 时, 为本地零启动体验保留 create_all 行为.
    if os.environ.get("DEV_AUTO_CREATE_ALL", "0") == "1":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.warning(
            "DEV_AUTO_CREATE_ALL=1 启用了 Base.metadata.create_all, 仅用于本地开发, "
            "生产环境请改用: alembic upgrade head"
        )

    embedded = start_embedded_celery()
    app.state.embedded_celery = embedded
    logger.info(f"embedded celery: {embedded}")

    stop_event = asyncio.Event()

    async def _hb_loop():
        while not stop_event.is_set():
            try:
                await asyncio.sleep(5.0)
                celery_heartbeat()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"celery heartbeat error: {e}")

    hb_task = asyncio.create_task(_hb_loop())

    try:
        yield
    finally:
        stop_event.set()
        hb_task.cancel()
        try:
            await hb_task
        except Exception:
            pass
        stop_embedded_celery()
        await engine.dispose()


app = FastAPI(
    title="复盘盒子 API",
    version="0.1.0",
    lifespan=lifespan,
)

_settings = get_settings()
if _settings.rate_limit_enabled:
    app.add_middleware(
        RateLimitMiddleware,
        anonymous_per_min=_settings.rate_limit_anonymous_per_min,
        user_per_min=_settings.rate_limit_user_per_min,
    )

app.add_middleware(
    CORSMiddleware,
    # 显式列出常见 dev origin (localhost / 127.0.0.1 / 局域网 IP, 含 3000 / 3001 fallback).
    # 同时用 regex 兜底任意私网/本机 origin, 避免浏览器跨 origin 时被 CORS 静默拦掉
    # (现象: fetch 抛 NetworkError, 后端日志看不到任何请求).
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://0.0.0.0:3000",
    ],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market.router, prefix="/api/market", tags=["market"])
app.include_router(snapshot.router, prefix="/api/snapshot", tags=["snapshot"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(ai_chat.router, prefix="/api/ai", tags=["ai"])
app.include_router(ai_brief.router, prefix="/api/ai", tags=["ai"])
app.include_router(watchlist.router, prefix="/api/watchlist", tags=["watchlist"])
app.include_router(trades.router, prefix="/api/trades", tags=["trades"])
app.include_router(quota.router, prefix="/api/quota", tags=["quota"])
app.include_router(intraday.router, prefix="/api/intraday", tags=["intraday"])
app.include_router(plans.router, prefix="/api/plans", tags=["plans"])
app.include_router(me.router, prefix="/api/me", tags=["me"])
app.include_router(news.router, prefix="/api/news", tags=["news"])
app.include_router(stock.router, prefix="/api/stock", tags=["stock"])
app.include_router(capital.router, prefix="/api/market/capital", tags=["capital"])
from app.api import midlong
app.include_router(midlong.router, prefix="/api/midlong", tags=["midlong"])
app.include_router(methodology.router, prefix="/api/methodology", tags=["methodology"])
app.include_router(skills.router, prefix="/api/skills", tags=["skills"])
app.include_router(skill_scan.router, prefix="/api/skill-scan", tags=["skill-scan"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/health/celery")
async def health_celery():
    """嵌入式 celery worker / beat 的存活情况."""
    info = getattr(app.state, "embedded_celery", {})
    hb = celery_heartbeat()
    return {**info, **hb}
