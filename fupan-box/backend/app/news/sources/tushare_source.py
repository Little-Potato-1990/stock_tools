"""tushare pro 新闻源.

需要 settings.tushare_token. token 为空时所有源都返回空, 不报错.

接入:
- tushare_news    : pro.news(src='wallstreet'|'sina'|'10jqka'|'eastmoney') — 多平台快讯
- tushare_cctv    : pro.cctv_news() — 联播
- tushare_major   : pro.anns_d() — 重大公告 (替代旧 major_news)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from app.config import get_settings
from app.news.sources.base import BaseSource, NewsRaw

logger = logging.getLogger(__name__)


_PRO_INSTANCE = None


def _get_pro():
    """单例化 tushare pro client. token 缺失返回 None."""
    global _PRO_INSTANCE
    if _PRO_INSTANCE is not None:
        return _PRO_INSTANCE
    settings = get_settings()
    token = (settings.tushare_token or "").strip()
    if not token:
        return None
    try:
        import tushare as ts
        ts.set_token(token)
        _PRO_INSTANCE = ts.pro_api()
        return _PRO_INSTANCE
    except Exception as e:
        logger.warning("[tushare] pro_api init failed: %s", e)
        return None


def _parse_ts_dt(s: Any) -> datetime | None:
    if not s:
        return None
    if isinstance(s, datetime):
        return s
    s = str(s).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y%m%d %H:%M:%S", "%Y%m%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    return None


class TushareNewsSource(BaseSource):
    """tushare pro.news() — 华尔街见闻 / 新浪 / 同花顺 / 东财 多平台."""
    name = "tushare_news"

    SOURCES = ["wallstreet", "sina", "10jqka", "eastmoney"]

    def fetch_sync(self, since: datetime | None = None, limit: int = 50) -> list[NewsRaw]:
        pro = _get_pro()
        if pro is None:
            return []
        out: list[NewsRaw] = []
        end = datetime.now()
        start = since or (end - timedelta(hours=12))
        for src in self.SOURCES:
            try:
                df = pro.news(
                    src=src,
                    start_date=start.strftime("%Y-%m-%d %H:%M:%S"),
                    end_date=end.strftime("%Y-%m-%d %H:%M:%S"),
                )
            except Exception as e:
                logger.debug("[tushare_news.%s] failed: %s", src, e)
                continue
            if df is None or df.empty:
                continue
            for _, row in df.head(limit).iterrows():
                content = str(row.get("content", "")).strip()
                title = str(row.get("title", "") or content[:60]).strip()
                if not title:
                    continue
                pub = _parse_ts_dt(row.get("datetime", row.get("pub_time", "")))
                if pub is None:
                    continue
                if since and pub < since:
                    continue
                out.append(NewsRaw(
                    source=f"tushare_{src}",
                    title=title[:300],
                    content=content[:1500],
                    pub_time=pub,
                    source_url="",
                    raw_tags=[src],
                ))
        return out


class TushareCctvSource(BaseSource):
    """tushare pro.cctv_news() — 联播文字稿."""
    name = "tushare_cctv"

    def fetch_sync(self, since: datetime | None = None, limit: int = 30) -> list[NewsRaw]:
        pro = _get_pro()
        if pro is None:
            return []
        out: list[NewsRaw] = []
        for delta_days in range(0, 3):
            day = (datetime.now() - timedelta(days=delta_days)).strftime("%Y%m%d")
            try:
                df = pro.cctv_news(date=day)
            except Exception as e:
                logger.debug("[tushare_cctv] %s failed: %s", day, e)
                continue
            if df is None or df.empty:
                continue
            for _, row in df.head(limit).iterrows():
                title = str(row.get("title", "")).strip()
                if not title:
                    continue
                content = str(row.get("content", "")).strip()
                pub = _parse_ts_dt(row.get("date", day)) or datetime.now()
                if since and pub < since:
                    continue
                out.append(NewsRaw(
                    source="tushare_cctv",
                    title=title[:300],
                    content=content[:1500],
                    pub_time=pub,
                    source_url="",
                    raw_tags=["新闻联播", "政策"],
                ))
            if out:
                break
        return out


class TushareAnnsSource(BaseSource):
    """tushare pro.anns_d() — A 股每日公告 (替代旧 major_news).

    最近 24h 的全部公告, 默认按 ann_date 取昨天 + 今天.
    """
    name = "tushare_anns"

    def fetch_sync(self, since: datetime | None = None, limit: int = 100) -> list[NewsRaw]:
        pro = _get_pro()
        if pro is None:
            return []
        out: list[NewsRaw] = []
        for delta_days in range(0, 2):
            day = (datetime.now() - timedelta(days=delta_days)).strftime("%Y%m%d")
            try:
                df = pro.anns_d(ann_date=day)
            except Exception as e:
                logger.debug("[tushare_anns] %s failed: %s", day, e)
                continue
            if df is None or df.empty:
                continue
            for _, row in df.head(limit).iterrows():
                title = str(row.get("title", "")).strip()
                if not title:
                    continue
                code_full = str(row.get("ts_code", "")).strip()
                code = code_full.split(".")[0] if code_full else ""
                name = str(row.get("name", "")).strip()
                full_title = f"[{code} {name}] {title}" if code else title
                pub = _parse_ts_dt(row.get("ann_date", day)) or datetime.now()
                if since and pub < since:
                    continue
                url = str(row.get("url", "")).strip()
                out.append(NewsRaw(
                    source="tushare_anns",
                    title=full_title[:300],
                    content="",
                    pub_time=pub,
                    source_url=url,
                    raw_tags=["公告"],
                ))
        return out


def get_tushare_sources() -> list[BaseSource]:
    """工厂. token 没配的话 fetch_sync 自然返回空, 不影响整体."""
    return [
        TushareNewsSource(),
        TushareCctvSource(),
        TushareAnnsSource(),
    ]
