"""统一新闻数据源基类 + 并发聚合入口.

NewsRaw 是 source → ingest 之间的标准 DTO; 所有 source 都必须返回这个 shape:

    {
        "source": "cls" | "ak_global" | "tushare_news" | "tushare_cctv"
                  | "rss_wallstreet" | "rss_cbn" | "ak_notice" | ...,
        "source_url": "...",        # 可空
        "title": "...",
        "content": "...",           # 摘要或正文, 上限 1500 字
        "pub_time": datetime,        # Asia/Shanghai 本地时间
        "raw_tags": ["..."],         # source 自带标签 (可空)
    }
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

logger = logging.getLogger(__name__)


@dataclass
class NewsRaw:
    source: str
    title: str
    pub_time: datetime
    content: str = ""
    source_url: str = ""
    raw_tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "title": self.title,
            "content": self.content,
            "pub_time": self.pub_time.isoformat(timespec="seconds"),
            "source_url": self.source_url,
            "raw_tags": list(self.raw_tags or []),
        }


class BaseSource:
    """所有 source 的基类. 实现 fetch_sync 即可."""

    name: str = "base"
    enabled: bool = True

    def fetch_sync(self, since: datetime | None = None, limit: int = 50) -> list[NewsRaw]:
        """同步抓取 (子类实现). since 用于增量, 可忽略 (内部按 limit 截断)."""
        raise NotImplementedError

    async def fetch(self, since: datetime | None = None, limit: int = 50) -> list[NewsRaw]:
        """async 包装, 跑在 thread pool 避免阻塞 event loop."""
        try:
            return await asyncio.to_thread(self.fetch_sync, since, limit)
        except Exception as e:
            logger.warning("[news.source.%s] fetch failed: %s", self.name, e)
            return []


async def fetch_all_sources(
    sources: Iterable[BaseSource],
    since: datetime | None = None,
    limit_per_source: int = 80,
) -> list[NewsRaw]:
    """并发跑所有 enabled source, 合并结果, 失败的源返回空."""
    enabled = [s for s in sources if getattr(s, "enabled", True)]
    if not enabled:
        return []
    results = await asyncio.gather(
        *[s.fetch(since, limit_per_source) for s in enabled],
        return_exceptions=False,
    )
    out: list[NewsRaw] = []
    for src, items in zip(enabled, results):
        logger.info("[news.source.%s] fetched %d items", src.name, len(items))
        out.extend(items)
    return out
