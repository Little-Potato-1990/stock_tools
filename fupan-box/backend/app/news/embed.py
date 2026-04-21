"""新闻向量化 (Phase 4 RAG).

通过 OpenAI 兼容 API 把 (title + summary[:300]) 编码为 1536 维向量,
写入 news_summaries.embedding (pgvector).

策略:
- 只 embed `embedding_status IN (NULL, 'pending')` 的新闻
- 单批 ≤ news_embedding_batch (避免触发上下文/速率限制)
- 失败标 'failed', 下一轮跳过 (人工排查)
- ingest 新写入的新闻默认 status='pending', 由 worker 拉走

API:
- mark_pending(news_ids)        把现有行批量改 pending
- embed_pending(limit)          worker 主入口 — 拉一批 pending → embed → 写库
- embed_text(text) -> list[float]  单条 (供 search 用)
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Iterable

from openai import OpenAI
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.ai import NewsSummary

logger = logging.getLogger(__name__)


def _client() -> OpenAI | None:
    s = get_settings()
    if not s.openai_api_key:
        logger.warning("[embed] openai_api_key is empty, skip embedding")
        return None
    kwargs: dict = {"api_key": s.openai_api_key}
    if s.openai_base_url:
        kwargs["base_url"] = s.openai_base_url
    return OpenAI(**kwargs)


def _build_text(row: NewsSummary | dict) -> str:
    """把新闻 (title + summary 前 300 字) 拼成一段文本."""
    if isinstance(row, dict):
        title = (row.get("title") or "").strip()
        summary = (row.get("summary") or row.get("content") or "").strip()
    else:
        title = (row.title or "").strip()
        summary = (row.summary or "").strip()
    if not title:
        return ""
    if summary:
        return f"{title}\n{summary[:300]}"
    return title


def embed_text(text: str) -> list[float] | None:
    """单条文本 → 向量. 失败返回 None."""
    if not text.strip():
        return None
    client = _client()
    if client is None:
        return None
    s = get_settings()
    try:
        resp = client.embeddings.create(
            model=s.news_embedding_model,
            input=text[:8000],  # 大多数 embedding 模型上下文 8k
        )
        return list(resp.data[0].embedding)
    except Exception as exc:
        logger.warning("[embed] single err model=%s err=%s", s.news_embedding_model, exc)
        return None


def _embed_batch(texts: list[str]) -> list[list[float] | None]:
    """批量调 embedding API. 返回与输入等长的列表 (失败位 None)."""
    client = _client()
    if client is None:
        return [None] * len(texts)
    s = get_settings()
    try:
        resp = client.embeddings.create(
            model=s.news_embedding_model,
            input=[t[:8000] for t in texts],
        )
        out: list[list[float] | None] = [None] * len(texts)
        for d in resp.data:
            out[d.index] = list(d.embedding)
        return out
    except Exception as exc:
        logger.warning(
            "[embed] batch err model=%s n=%d err=%s",
            s.news_embedding_model, len(texts), exc,
        )
        return [None] * len(texts)


def mark_pending(news_ids: Iterable[int]) -> int:
    """把若干行的 embedding_status 置 pending (供 worker 拉)."""
    ids = [int(i) for i in news_ids if i is not None]
    if not ids:
        return 0
    s = get_settings()
    eng = create_engine(s.database_url_sync, pool_pre_ping=True)
    try:
        with Session(eng) as session:
            res = session.execute(
                update(NewsSummary)
                .where(NewsSummary.id.in_(ids))
                .where(
                    (NewsSummary.embedding_status.is_(None))
                    | (NewsSummary.embedding_status == "failed")
                )
                .values(embedding_status="pending")
            )
            session.commit()
            return int(res.rowcount or 0)
    finally:
        eng.dispose()


def embed_pending(limit: int | None = None) -> dict:
    """Worker 主入口: 拉 pending → embed → 写库.

    返回 {fetched, ok, failed}.
    """
    s = get_settings()
    n_per_run = limit if limit is not None else s.news_embedding_per_run
    batch_size = max(1, s.news_embedding_batch)

    eng = create_engine(s.database_url_sync, pool_pre_ping=True)
    fetched = 0
    ok = 0
    failed = 0
    try:
        with Session(eng) as session:
            q = (
                select(NewsSummary)
                .where(
                    (NewsSummary.embedding_status == "pending")
                    | (NewsSummary.embedding_status.is_(None))
                )
                .order_by(NewsSummary.id.desc())
                .limit(n_per_run)
            )
            rows: list[NewsSummary] = list(session.execute(q).scalars().all())
            fetched = len(rows)
            if not rows:
                return {"fetched": 0, "ok": 0, "failed": 0}

            for i in range(0, len(rows), batch_size):
                chunk = rows[i : i + batch_size]
                texts = [_build_text(r) for r in chunk]
                # 空文本直接标失败
                idxs_with_text = [(j, t) for j, t in enumerate(texts) if t.strip()]
                if not idxs_with_text:
                    for r in chunk:
                        r.embedding_status = "failed"
                        r.embedded_at = datetime.now()
                        failed += 1
                    session.commit()
                    continue
                batch_texts = [t for _, t in idxs_with_text]
                vecs = _embed_batch(batch_texts)
                expected_dim = s.news_embedding_dim
                for (orig_j, _), vec in zip(idxs_with_text, vecs):
                    r = chunk[orig_j]
                    if vec and len(vec) == expected_dim:
                        r.embedding = vec  # type: ignore[attr-defined]
                        r.embedding_model = s.news_embedding_model
                        r.embedding_status = "done"
                        r.embedded_at = datetime.now()
                        ok += 1
                    else:
                        r.embedding_status = "failed"
                        r.embedded_at = datetime.now()
                        failed += 1
                # chunk 里没 text 的也标 failed
                done_indices = {j for j, _ in idxs_with_text}
                for j, r in enumerate(chunk):
                    if j not in done_indices:
                        r.embedding_status = "failed"
                        r.embedded_at = datetime.now()
                        failed += 1
                session.commit()
    finally:
        eng.dispose()
    logger.info("[embed] run done fetched=%d ok=%d failed=%d", fetched, ok, failed)
    return {"fetched": fetched, "ok": ok, "failed": failed}
