import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import market, snapshot, auth, ai_chat, ai_brief, watchlist, trades, quota, intraday
from app.database import engine, Base
from app.embedded_celery import (
    start_embedded_celery,
    stop_embedded_celery,
    heartbeat as celery_heartbeat,
)

logger = logging.getLogger("fupanbox")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/health/celery")
async def health_celery():
    """嵌入式 celery worker / beat 的存活情况."""
    info = getattr(app.state, "embedded_celery", {})
    hb = celery_heartbeat()
    return {**info, **hb}
