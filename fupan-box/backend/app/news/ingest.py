"""多源新闻聚合 → 去重 → 打标 → 落库 入口.

调用入口:
    await ingest_once(window_hours=12, do_tag=True) -> dict   # 主流程
    fetch_pending_for_brief(hours=24) -> list[dict]            # 给 news_brief 用

设计:
- 单次入库目标 100-300 条 (多源 union 后); 失败源静默跳过
- 标题用 64-bit SimHash 转 16-hex 作为 title_hash, on conflict do nothing
- 同 hash 不同源, 把 url 合并写入 source_urls JSON
- 抓 6 位股票代码 + 当日概念名命中, 落 related_stocks / related_themes
- 完成 ingest 后立刻批量调 news_tagger.tag_news_batch (50 条一组), 写 importance/sentiment/tags
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy import create_engine, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.ai.news_tagger import _heuristic_one, tag_news_batch
from app.config import get_settings
from app.models.ai import NewsSummary
from app.news.sources import NewsRaw, fetch_all_sources
from app.news.sources.akshare_source import get_akshare_sources
from app.news.sources.rss_source import get_rss_sources
from app.news.sources.tushare_source import get_tushare_sources

logger = logging.getLogger(__name__)


# ---------- SimHash 去重 ----------

_PUNCT_RE = re.compile(r"[\s\u3000\W_]+", flags=re.UNICODE)


def _tokens(s: str) -> list[str]:
    """简单 tokenize: 按字 + 短词. 中英文混合裸切, 不引入分词器依赖."""
    s = _PUNCT_RE.sub("", s.lower())
    if not s:
        return []
    # 中文按字, 英文 / 数字按 3-gram
    out: list[str] = []
    buf: list[str] = []
    for ch in s:
        if "\u4e00" <= ch <= "\u9fff":
            if buf:
                out.extend(_ngrams("".join(buf), 3))
                buf = []
            out.append(ch)
        else:
            buf.append(ch)
    if buf:
        out.extend(_ngrams("".join(buf), 3))
    return out or [s[:8]]


def _ngrams(s: str, n: int) -> list[str]:
    if len(s) <= n:
        return [s]
    return [s[i:i + n] for i in range(len(s) - n + 1)]


def simhash_hex(text: str, bits: int = 64) -> str:
    """64-bit SimHash, 返回 16-hex."""
    if not text:
        return "0" * (bits // 4)
    tokens = _tokens(text)
    if not tokens:
        return "0" * (bits // 4)
    counts = {}
    for t in tokens:
        counts[t] = counts.get(t, 0) + 1
    v = [0] * bits
    for tok, w in counts.items():
        h = int(hashlib.md5(tok.encode("utf-8")).hexdigest()[:bits // 4], 16)
        for i in range(bits):
            if h & (1 << i):
                v[i] += w
            else:
                v[i] -= w
    out = 0
    for i in range(bits):
        if v[i] >= 0:
            out |= (1 << i)
    return f"{out:0{bits // 4}x}"


def hamming_distance(h1: str, h2: str) -> int:
    return bin(int(h1, 16) ^ int(h2, 16)).count("1")


# ---------- 抽实体 ----------

_STOCK_CODE_RE = re.compile(r"\b(\d{6})\b")


def _extract_codes(text: str) -> list[str]:
    found = _STOCK_CODE_RE.findall(text)
    out: list[str] = []
    for c in found:
        # 过滤明显的非股票代码 (年份 / 日期之类), 简单按 A 股代码段
        if c.startswith(("60", "00", "30", "68", "8", "9", "43")):
            if c not in out:
                out.append(c)
    return out[:8]


def _match_themes(text: str, theme_pool: set[str]) -> list[str]:
    out: list[str] = []
    for t in theme_pool:
        if len(t) >= 2 and t in text and t not in out:
            out.append(t)
        if len(out) >= 8:
            break
    return out


def _load_theme_pool() -> set[str]:
    """优先走 ThemeDaily 最近一日的 name 集合, 失败 fallback 静态热点池."""
    try:
        settings = get_settings()
        eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
        try:
            with Session(eng) as s:
                from app.models.theme import Theme
                rows = s.execute(select(Theme.name).limit(2000)).scalars().all()
                names = {r for r in rows if r}
                if names:
                    return names
        finally:
            eng.dispose()
    except Exception as e:
        logger.debug("load_theme_pool db failed: %s", e)
    # 静态 fallback
    from app.ai.news_tagger import _HOT_THEMES
    return set(_HOT_THEMES)


# ---------- 主流程 ----------

def _build_sources():
    """汇总所有 source. 子源失败时 fetch 自动返回 []."""
    return [
        *get_akshare_sources(),
        *get_tushare_sources(),
        *get_rss_sources(),
    ]


async def _fetch_all(window_hours: float) -> list[NewsRaw]:
    since = datetime.now() - timedelta(hours=window_hours)
    sources = _build_sources()
    return await fetch_all_sources(sources, since=since, limit_per_source=80)


def _enrich_raw(items: list[NewsRaw], theme_pool: set[str]) -> list[dict]:
    """加 title_hash + 抽实体, 返回适合 upsert 的 dict 列表."""
    enriched: list[dict] = []
    for it in items:
        title = it.title or ""
        if not title:
            continue
        text = title + " " + (it.content or "")
        h = simhash_hex(title)  # 仅用 title, 同源同标题不同时间更新内容
        codes = _extract_codes(text)
        themes = _match_themes(text, theme_pool)
        # 兜底打标 (LLM 失败时用)
        heur = _heuristic_one({"title": title, "content": it.content or ""}, theme_pool)
        enriched.append({
            "title": title[:500],
            "title_hash": h,
            "summary": (it.content or "")[:1500],
            "source": it.source,
            "source_url": it.source_url[:800] if it.source_url else None,
            "source_urls": {it.source: it.source_url} if it.source_url else None,
            "publish_date": it.pub_time.date(),
            "pub_time": it.pub_time,
            "related_stocks": codes or None,
            "related_themes": themes or None,
            "raw_tags": list(it.raw_tags or []) or None,
            # 兜底 importance/sentiment, LLM 后续会覆盖
            "importance": int(heur.get("importance", 2)),
            "sentiment": heur.get("sentiment"),
            "tags": heur.get("tags") or None,
            "embedding_status": "pending",
        })
    # 同一批内按 title_hash 去重 (取最早 pub_time + 合并 source_urls)
    by_hash: dict[str, dict] = {}
    for row in enriched:
        h = row["title_hash"]
        prev = by_hash.get(h)
        if prev is None:
            by_hash[h] = row
            continue
        # 保留 pub_time 较早的 + 合并 source_urls
        if row["pub_time"] < prev["pub_time"]:
            row["source_urls"] = {**(prev["source_urls"] or {}), **(row["source_urls"] or {})}
            by_hash[h] = row
        else:
            prev["source_urls"] = {**(prev["source_urls"] or {}), **(row["source_urls"] or {})}
    return list(by_hash.values())


def _upsert_batch(rows: list[dict]) -> tuple[int, int]:
    """upsert (title_hash 唯一); 返回 (新增数, 更新数). 用 ON CONFLICT 合并 source_urls."""
    if not rows:
        return 0, 0
    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    inserted = 0
    updated = 0
    try:
        with Session(eng) as session:
            # 先批量查已存在的 hash
            hashes = [r["title_hash"] for r in rows]
            existing_rows = session.execute(
                select(NewsSummary.title_hash, NewsSummary.source_urls)
                .where(NewsSummary.title_hash.in_(hashes))
            ).all()
            existing = {h: (urls or {}) for h, urls in existing_rows}

            # 分两批: insert (新) + update (合并 source_urls)
            new_rows = [r for r in rows if r["title_hash"] not in existing]
            update_rows = [r for r in rows if r["title_hash"] in existing]

            if new_rows:
                stmt = pg_insert(NewsSummary).values(new_rows)
                # ON CONFLICT DO NOTHING — 双保险, 防多 worker 并发
                stmt = stmt.on_conflict_do_nothing(index_elements=["title_hash"])
                res = session.execute(stmt)
                inserted = int(res.rowcount or 0)

            for r in update_rows:
                merged_urls = {**existing[r["title_hash"]], **(r["source_urls"] or {})}
                session.execute(
                    update(NewsSummary)
                    .where(NewsSummary.title_hash == r["title_hash"])
                    .values(source_urls=merged_urls)
                )
                updated += 1
            session.commit()
    finally:
        eng.dispose()
    return inserted, updated


async def _llm_tag_recent(hours: int = 24, batch_size: int = 30, model: str = "deepseek-v3") -> int:
    """对最近 N 小时 ai_tagged_at IS NULL 的新闻批量打标 (覆盖 importance/sentiment/tags)."""
    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    cutoff = datetime.now() - timedelta(hours=hours)
    pending: list[NewsSummary] = []
    try:
        with Session(eng) as s:
            pending = list(s.execute(
                select(NewsSummary)
                .where(
                    NewsSummary.ai_tagged_at.is_(None),
                    NewsSummary.pub_time >= cutoff,
                )
                .order_by(NewsSummary.pub_time.desc())
                .limit(200)
            ).scalars().all())
    finally:
        eng.dispose()

    if not pending:
        return 0

    theme_pool = _load_theme_pool()
    tagged = 0
    for i in range(0, len(pending), batch_size):
        batch = pending[i:i + batch_size]
        items = [{"title": n.title, "content": n.summary or ""} for n in batch]
        try:
            tags_arr = await tag_news_batch(items, theme_pool=theme_pool, model_id=model)
        except Exception as e:
            logger.warning("[news.tag] batch failed: %s", e)
            continue
        # 写回
        eng2 = create_engine(settings.database_url_sync, pool_pre_ping=True)
        try:
            with Session(eng2) as s:
                for n, tg in zip(batch, tags_arr):
                    upd: dict = {"ai_tagged_at": datetime.now()}
                    if isinstance(tg.get("importance"), int):
                        upd["importance"] = max(1, min(5, int(tg["importance"])))
                    if tg.get("sentiment") in ("bullish", "neutral", "bearish"):
                        upd["sentiment"] = tg["sentiment"]
                    if tg.get("tags"):
                        upd["tags"] = list(tg["tags"])[:5]
                    if tg.get("themes"):
                        # LLM 抽出的 themes 可能比 ingest 时更准, 合并
                        existing = list(n.related_themes or [])
                        merged = existing + [t for t in tg["themes"] if t not in existing]
                        upd["related_themes"] = merged[:10]
                    if tg.get("rel_codes"):
                        existing = list(n.related_stocks or [])
                        merged = existing + [c for c in tg["rel_codes"] if c not in existing]
                        upd["related_stocks"] = merged[:10]
                    s.execute(update(NewsSummary).where(NewsSummary.id == n.id).values(**upd))
                    tagged += 1
                s.commit()
        finally:
            eng2.dispose()
    return tagged


async def ingest_once(
    window_hours: float = 12.0,
    do_tag: bool = True,
    tag_model: str = "deepseek-v3",
) -> dict:
    """主入口: 拉所有源 → 去重 → 落库 → (可选) AI 打标."""
    raw = await _fetch_all(window_hours)
    if not raw:
        logger.info("[news.ingest] no new items in window=%sh", window_hours)
        return {
            "fetched": 0,
            "inserted": 0,
            "updated": 0,
            "tagged": 0,
        }
    theme_pool = _load_theme_pool()
    rows = _enrich_raw(raw, theme_pool)
    inserted, updated = await asyncio.to_thread(_upsert_batch, rows)
    logger.info(
        "[news.ingest] fetched=%d unique=%d inserted=%d updated=%d",
        len(raw), len(rows), inserted, updated,
    )

    tagged = 0
    if do_tag and inserted > 0:
        try:
            tagged = await _llm_tag_recent(hours=int(window_hours) + 1, model=tag_model)
        except Exception as e:
            logger.warning("[news.ingest] tag pass failed: %s", e)
    return {
        "fetched": len(raw),
        "unique": len(rows),
        "inserted": inserted,
        "updated": updated,
        "tagged": tagged,
    }


# ---------- 给 news_brief / API 的查询 helper ----------

def fetch_recent_news(
    hours: int = 24,
    limit: int = 100,
    min_importance: int | None = None,
    sources: Iterable[str] | None = None,
) -> list[dict]:
    """读最近 N 小时的新闻 (按 importance desc + pub_time desc)."""
    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    cutoff = datetime.now() - timedelta(hours=hours)
    try:
        with Session(eng) as s:
            q = select(NewsSummary).where(NewsSummary.pub_time >= cutoff)
            if min_importance:
                q = q.where(NewsSummary.importance >= min_importance)
            if sources:
                q = q.where(NewsSummary.source.in_(list(sources)))
            q = q.order_by(NewsSummary.importance.desc(), NewsSummary.pub_time.desc()).limit(limit)
            rows = s.execute(q).scalars().all()
            return [_row_to_dict(r) for r in rows]
    finally:
        eng.dispose()


def fetch_news_for_codes(codes: list[str], hours: int = 72, limit: int = 30) -> list[dict]:
    """给定股票代码集合, 取最近 N 小时命中的新闻."""
    if not codes:
        return []
    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    cutoff = datetime.now() - timedelta(hours=hours)
    try:
        with Session(eng) as s:
            from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB

            # related_stocks 是 JSONB array, 用 ?| 操作符判断包含任一
            q = (
                select(NewsSummary)
                .where(
                    NewsSummary.pub_time >= cutoff,
                    NewsSummary.related_stocks.op("?|")(list(codes)),
                )
                .order_by(NewsSummary.importance.desc(), NewsSummary.pub_time.desc())
                .limit(limit)
            )
            rows = s.execute(q).scalars().all()
            return [_row_to_dict(r) for r in rows]
    finally:
        eng.dispose()


def fetch_news_for_themes(themes: list[str], hours: int = 72, limit: int = 30) -> list[dict]:
    if not themes:
        return []
    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    cutoff = datetime.now() - timedelta(hours=hours)
    try:
        with Session(eng) as s:
            q = (
                select(NewsSummary)
                .where(
                    NewsSummary.pub_time >= cutoff,
                    NewsSummary.related_themes.op("?|")(list(themes)),
                )
                .order_by(NewsSummary.importance.desc(), NewsSummary.pub_time.desc())
                .limit(limit)
            )
            rows = s.execute(q).scalars().all()
            return [_row_to_dict(r) for r in rows]
    finally:
        eng.dispose()


def _row_to_dict(r: NewsSummary) -> dict:
    return {
        "id": r.id,
        "title": r.title,
        "content": r.summary or "",
        "source": r.source,
        "source_url": r.source_url,
        "source_urls": r.source_urls or {},
        "pub_time": r.pub_time.isoformat(timespec="seconds") if r.pub_time else None,
        "publish_date": r.publish_date.isoformat() if r.publish_date else None,
        "rel_codes": list(r.related_stocks or []),
        "themes": list(r.related_themes or []),
        "tags": list(r.tags or []),
        "raw_tags": list(r.raw_tags or []),
        "importance": int(r.importance or 0),
        "sentiment": r.sentiment,
    }
