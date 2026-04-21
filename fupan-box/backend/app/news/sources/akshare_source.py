"""akshare 新闻 + 公告源.

包含:
- cls         : 财联社电报 (stock_news_em symbol="财联社") - 复用现有
- ak_global   : 东财全球财经快讯 (stock_info_global_em)
- ak_cctv     : 央视新闻联播 (news_cctv) — 政策/宏观
- ak_notice   : 沪深京公告 (stock_notice_report) — A 股关键公司公告
- ak_zhibo    : 同花顺/东财直播 (stock_info_global_ths / sina) — 多源轮询
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from app.news.sources.base import BaseSource, NewsRaw

logger = logging.getLogger(__name__)


def _parse_dt(s: Any) -> datetime | None:
    if not s:
        return None
    if isinstance(s, datetime):
        return s
    s = str(s).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y%m%d %H:%M:%S", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    # 形如 "2026-04-21T17:30:00" 等
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00").replace("/", "-")[:19])
    except Exception:
        return None


class AkClsSource(BaseSource):
    """财联社电报."""
    name = "cls"

    def fetch_sync(self, since: datetime | None = None, limit: int = 80) -> list[NewsRaw]:
        import akshare as ak

        try:
            df = ak.stock_news_em(symbol="财联社")
        except Exception as e:
            logger.debug("[cls] stock_news_em failed: %s", e)
            return []
        if df is None or df.empty:
            return []
        out: list[NewsRaw] = []
        for _, row in df.head(limit).iterrows():
            title = str(row.get("新闻标题", row.get("标题", row.get("title", "")))).strip()
            if not title:
                continue
            content = str(row.get("新闻内容", row.get("内容", row.get("content", "")))).strip()
            pub = _parse_dt(row.get("发布时间", row.get("时间", row.get("datetime", ""))))
            if pub is None:
                continue
            if since and pub < since:
                continue
            url = str(row.get("新闻链接", row.get("链接", row.get("url", "")))).strip()
            out.append(NewsRaw(
                source="cls",
                title=title[:300],
                content=content[:1500],
                pub_time=pub,
                source_url=url,
            ))
        return out


class AkGlobalSource(BaseSource):
    """东财全球财经快讯."""
    name = "ak_global"

    def fetch_sync(self, since: datetime | None = None, limit: int = 80) -> list[NewsRaw]:
        import akshare as ak

        try:
            df = ak.stock_info_global_em()
        except Exception as e:
            logger.debug("[ak_global] failed: %s", e)
            return []
        if df is None or df.empty:
            return []
        out: list[NewsRaw] = []
        for _, row in df.head(limit).iterrows():
            title = str(row.get("标题", row.get("title", ""))).strip()
            if not title:
                continue
            content = str(row.get("摘要", row.get("内容", ""))).strip()
            pub = _parse_dt(row.get("发布时间", row.get("时间", "")))
            if pub is None:
                continue
            if since and pub < since:
                continue
            url = str(row.get("链接", row.get("url", ""))).strip()
            out.append(NewsRaw(
                source="ak_global",
                title=title[:300],
                content=content[:1500],
                pub_time=pub,
                source_url=url,
            ))
        return out


class AkCctvSource(BaseSource):
    """央视新闻联播 (政策/宏观, 每日盘后才有)."""
    name = "ak_cctv"

    def fetch_sync(self, since: datetime | None = None, limit: int = 30) -> list[NewsRaw]:
        import akshare as ak

        # ak.news_cctv(date='YYYYMMDD'): 当天的, 默认尝试最近 3 天
        out: list[NewsRaw] = []
        for delta_days in range(0, 3):
            day = (datetime.now() - timedelta(days=delta_days)).strftime("%Y%m%d")
            try:
                df = ak.news_cctv(date=day)
            except Exception:
                continue
            if df is None or df.empty:
                continue
            for _, row in df.head(limit).iterrows():
                title = str(row.get("title", row.get("标题", ""))).strip()
                if not title:
                    continue
                content = str(row.get("content", row.get("内容", ""))).strip()
                pub = _parse_dt(row.get("date", row.get("日期", day))) or datetime.now()
                if since and pub < since:
                    continue
                out.append(NewsRaw(
                    source="ak_cctv",
                    title=title[:300],
                    content=content[:1500],
                    pub_time=pub,
                    source_url="",
                    raw_tags=["新闻联播", "政策"],
                ))
            if out:
                break
        return out


class AkNoticeSource(BaseSource):
    """沪深京公告 - 公司层面的关键事件 (重大资产重组 / 业绩预告 / 重大合同)."""
    name = "ak_notice"

    def fetch_sync(self, since: datetime | None = None, limit: int = 100) -> list[NewsRaw]:
        import akshare as ak

        # 取昨天 + 今天的公告
        out: list[NewsRaw] = []
        for delta_days in range(0, 2):
            day = (datetime.now() - timedelta(days=delta_days)).strftime("%Y%m%d")
            try:
                # 重大事项: 业绩预告/资产重组/重大合同 等高价值类型
                df = ak.stock_notice_report(symbol="重大事项", date=day)
            except Exception as e:
                logger.debug("[ak_notice] %s failed: %s", day, e)
                continue
            if df is None or df.empty:
                continue
            for _, row in df.head(limit).iterrows():
                code = str(row.get("代码", row.get("code", ""))).strip()
                name = str(row.get("名称", row.get("name", ""))).strip()
                title = str(row.get("公告标题", row.get("标题", ""))).strip()
                if not title:
                    continue
                # 拼成易读标题: "[600519 贵州茅台] 业绩预告 ..."
                full_title = f"[{code} {name}] {title}" if code else title
                ann_type = str(row.get("公告类型", row.get("类型", ""))).strip()
                pub = _parse_dt(row.get("公告日期", row.get("日期", day))) or datetime.now()
                if since and pub < since:
                    continue
                url = str(row.get("公告链接", row.get("链接", ""))).strip()
                out.append(NewsRaw(
                    source="ak_notice",
                    title=full_title[:300],
                    content=ann_type[:200],
                    pub_time=pub,
                    source_url=url,
                    raw_tags=["公告", ann_type] if ann_type else ["公告"],
                ))
        return out


class AkSinaZhiboSource(BaseSource):
    """新浪财经 7x24 实时直播."""
    name = "ak_sina_zhibo"

    def fetch_sync(self, since: datetime | None = None, limit: int = 50) -> list[NewsRaw]:
        import akshare as ak

        try:
            df = ak.stock_info_global_sina()
        except Exception as e:
            logger.debug("[ak_sina_zhibo] failed: %s", e)
            return []
        if df is None or df.empty:
            return []
        out: list[NewsRaw] = []
        for _, row in df.head(limit).iterrows():
            content = str(row.get("内容", row.get("content", ""))).strip()
            if not content:
                continue
            # 直播没有单独标题, 取前 40 字作为标题
            title = content.split("。")[0][:60] or content[:60]
            pub = _parse_dt(row.get("时间", row.get("发布时间", "")))
            if pub is None:
                continue
            if since and pub < since:
                continue
            out.append(NewsRaw(
                source="ak_sina_zhibo",
                title=title[:300],
                content=content[:1500],
                pub_time=pub,
                source_url="",
            ))
        return out


def get_akshare_sources() -> list[BaseSource]:
    """工厂方法 — 一键获取所有 akshare 源 (用于 ingest)."""
    return [
        AkClsSource(),
        AkGlobalSource(),
        AkCctvSource(),
        AkNoticeSource(),
        AkSinaZhiboSource(),
    ]
