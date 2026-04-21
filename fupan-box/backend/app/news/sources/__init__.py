"""统一新闻数据源接口.

每个 source 实现 BaseSource.fetch(since: datetime|None) -> list[NewsRaw]
失败必须返回 [] 而不是抛异常 (单源挂掉不影响整体).
"""
from app.news.sources.base import BaseSource, NewsRaw, fetch_all_sources

__all__ = ["BaseSource", "NewsRaw", "fetch_all_sources"]
