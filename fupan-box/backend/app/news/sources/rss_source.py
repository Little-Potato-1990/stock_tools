"""RSS 新闻源 (华尔街见闻 / 第一财经 / 雪球热门 / 36kr / 新浪财经).

依赖 feedparser. 如未安装则 fetch 返回空, 避免拖累其他源.

可在 settings.news_rss_feeds 自定义额外 RSS, 多个用逗号分隔, 形如:
    name1::url1,name2::url2
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from app.news.sources.base import BaseSource, NewsRaw

logger = logging.getLogger(__name__)


# 默认内置 RSS feeds. 任何一个失败不影响其他.
DEFAULT_RSS_FEEDS: list[tuple[str, str]] = [
    # name(suffix), url
    ("rss_wallstreet", "https://api.wallstreetcn.com/apiv1/content/feed/rss"),
    ("rss_cbn", "https://www.yicai.com/api/ajax/getlatest/rss"),
    ("rss_36kr", "https://36kr.com/feed-news"),
    ("rss_xueqiu_today", "https://xueqiu.com/hots/topic/rss"),
    ("rss_sina_finance", "https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=50&versionNumber=1.2.4&format=rss"),
]


def _parse_rss_dt(entry: Any) -> datetime | None:
    # feedparser 把时间放在 published_parsed (struct_time) 或 updated_parsed
    for attr in ("published_parsed", "updated_parsed"):
        t = getattr(entry, attr, None)
        if t:
            try:
                return datetime(*t[:6])
            except Exception:
                continue
    # 字符串 fallback
    for attr in ("published", "updated"):
        v = getattr(entry, attr, None)
        if v:
            for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
                try:
                    dt = datetime.strptime(v, fmt)
                    if dt.tzinfo:
                        dt = dt.replace(tzinfo=None)
                    return dt
                except Exception:
                    continue
    return None


class RssSource(BaseSource):
    """单个 RSS feed."""

    def __init__(self, name: str, url: str):
        self.name = name
        self.url = url

    def fetch_sync(self, since: datetime | None = None, limit: int = 50) -> list[NewsRaw]:
        try:
            import feedparser
        except ImportError:
            logger.debug("[rss.%s] feedparser not installed, skipped", self.name)
            return []
        try:
            feed = feedparser.parse(self.url)
        except Exception as e:
            logger.debug("[rss.%s] parse failed: %s", self.name, e)
            return []
        if not getattr(feed, "entries", None):
            return []
        out: list[NewsRaw] = []
        for entry in feed.entries[:limit]:
            title = (getattr(entry, "title", "") or "").strip()
            if not title:
                continue
            content = (
                getattr(entry, "summary", "")
                or getattr(entry, "description", "")
                or ""
            ).strip()
            # 剥 HTML
            if content:
                content = _strip_html(content)
            pub = _parse_rss_dt(entry) or datetime.now()
            if since and pub < since:
                continue
            url = (getattr(entry, "link", "") or "").strip()
            out.append(NewsRaw(
                source=self.name,
                title=title[:300],
                content=content[:1500],
                pub_time=pub,
                source_url=url,
            ))
        return out


def _strip_html(s: str) -> str:
    import re
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"&nbsp;", " ", s)
    s = re.sub(r"&[a-z]+;", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def get_rss_sources() -> list[BaseSource]:
    """工厂方法 — 返回所有内置 RSS source. 用户自定义 feeds 可在 settings 里加."""
    return [RssSource(name, url) for name, url in DEFAULT_RSS_FEEDS]
