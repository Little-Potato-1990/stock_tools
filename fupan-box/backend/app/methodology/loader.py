"""扫描 content/methodology 下 markdown 文章, 构建内存索引.

设计要点:
1. 启动后第一次访问时构建索引, 后续 60s 复用 (避免每次请求都扫盘).
   开发模式下若文件 mtime 变化则自动失效, 不需要重启进程.
2. YAML frontmatter 用 PyYAML 解析 (PyYAML 已通过 alembic/celery 间接安装).
3. 列表接口只回传 meta + summary (从正文截取), 详情接口才回传完整 markdown.
4. 自动从正文提取「核心命题」(以 `> ` 开头的第一段) 作为 summary fallback.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

CACHE_TTL_SEC = 60.0


# === 已知 category 元数据 (中文标签 + 颜色 hint) ===
CATEGORY_META: dict[str, dict[str, str]] = {
    "value_longterm": {
        "label": "价值与长线",
        "desc": "价值投资 / 长期持有 / 估值方法",
        "color": "var(--accent-purple)",
    },
    "technical": {
        "label": "技术与波段",
        "desc": "趋势 / 形态 / 量价 / 缠论",
        "color": "var(--accent-blue)",
    },
    "short_term": {
        "label": "短线与情绪",
        "desc": "龙虎榜 / 接力 / 题材 / 涨停战法",
        "color": "var(--accent-orange)",
    },
    "macro": {
        "label": "宏观与认知",
        "desc": "宏观周期 / 行业生命周期 / 资金面",
        "color": "var(--accent-red)",
    },
}


@dataclass
class MethodologyArticle:
    """单篇文章. content 仅在详情接口回传, 列表只回传 meta + summary."""

    slug: str
    title: str
    category: str
    inspired_by: str = ""
    applicable_to: list[str] = field(default_factory=list)
    market_phase: list[str] = field(default_factory=list)
    estimated_read_min: int = 10
    tags: list[str] = field(default_factory=list)
    skill_id: str | None = None
    summary: str = ""
    content: str = ""
    word_count: int = 0
    file_path: str = ""
    file_mtime: float = 0.0

    def to_meta(self) -> dict[str, Any]:
        """列表接口回传 (不含 content)."""
        return {
            "slug": self.slug,
            "title": self.title,
            "category": self.category,
            "category_label": CATEGORY_META.get(self.category, {}).get("label", self.category),
            "inspired_by": self.inspired_by,
            "applicable_to": self.applicable_to,
            "market_phase": self.market_phase,
            "estimated_read_min": self.estimated_read_min,
            "tags": self.tags,
            "skill_id": self.skill_id,
            "summary": self.summary,
            "word_count": self.word_count,
        }

    def to_detail(self) -> dict[str, Any]:
        """详情接口回传 (含 content)."""
        return {**self.to_meta(), "content": self.content}


@dataclass
class _IndexCache:
    articles: dict[str, MethodologyArticle] = field(default_factory=dict)
    built_at: float = 0.0
    dir_signature: tuple = ()


_cache = _IndexCache()
_lock = threading.Lock()


def _resolve_content_dir() -> Path:
    """优先使用 settings.methodology_content_dir;
    否则按 backend 上一级 content/methodology 推断.

    优先级:
      1. env 显式配置
      2. backend 同级仓库根 / content/methodology
      3. 当前 cwd / content/methodology (兜底)
    """
    from app.config import get_settings

    s = get_settings()
    if s.methodology_content_dir:
        p = Path(s.methodology_content_dir).expanduser().resolve()
        return p

    # backend/app/methodology/loader.py -> 上溯 4 级到仓库根
    here = Path(__file__).resolve()
    repo_root = here.parents[3]  # backend/app/methodology/loader.py
    candidate = repo_root / "content" / "methodology"
    if candidate.exists():
        return candidate

    return (Path.cwd() / "content" / "methodology").resolve()


def _extract_summary(body: str, max_len: int = 220) -> str:
    """从正文提取一段简短摘要.

    策略:
      1. 优先找紧跟 "## 核心命题" 的 `> xxx` 块引用 (我们的文章约定写法)
      2. 否则找第一个 `> xxx`
      3. 否则取第一段非标题非空文本
    """
    lines = body.splitlines()
    n = len(lines)

    def _flush_quote(start: int) -> str:
        chunks: list[str] = []
        i = start
        while i < n and lines[i].lstrip().startswith(">"):
            chunks.append(lines[i].lstrip().lstrip(">").strip())
            i += 1
        return " ".join(c for c in chunks if c)

    for i, raw in enumerate(lines):
        line = raw.strip()
        if line.startswith("## 核心命题") or line.startswith("# 核心命题"):
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            if j < n and lines[j].lstrip().startswith(">"):
                text = _flush_quote(j)
                if text:
                    return text[:max_len]
            break

    for i, raw in enumerate(lines):
        if raw.lstrip().startswith(">"):
            text = _flush_quote(i)
            if text:
                return text[:max_len]

    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("---") or line.startswith(">"):
            continue
        return line[:max_len]

    return ""


def _word_count(text: str) -> int:
    """中文字符 + 英文单词 粗略字数 (用于阅读时长校准)."""
    cn = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    en = sum(1 for w in text.split() if any("a" <= c.lower() <= "z" for c in w))
    return cn + en


def _parse_file(path: Path) -> MethodologyArticle | None:
    """解析单个 markdown 文件. 不合规返回 None."""
    try:
        raw = path.read_text(encoding="utf-8")
    except Exception as e:
        logger.warning(f"methodology: read failed {path}: {e}")
        return None

    if not raw.startswith("---"):
        logger.warning(f"methodology: missing frontmatter {path}")
        return None

    parts = raw.split("---", 2)
    if len(parts) < 3:
        logger.warning(f"methodology: malformed frontmatter {path}")
        return None

    fm_raw, body = parts[1], parts[2].lstrip("\n")
    try:
        fm: dict[str, Any] = yaml.safe_load(fm_raw) or {}
        if not isinstance(fm, dict):
            raise ValueError("frontmatter not a dict")
    except Exception as e:
        logger.warning(f"methodology: yaml parse failed {path}: {e}")
        return None

    slug = str(fm.get("slug") or path.stem)
    title = str(fm.get("title") or slug)
    category = str(fm.get("category") or "uncategorized")

    def _strlist(v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        if isinstance(v, (list, tuple)):
            return [str(x).strip() for x in v if str(x).strip()]
        return []

    summary = _extract_summary(body)
    wc = _word_count(body)

    try:
        read_min = int(fm.get("estimated_read_min") or 0)
    except (TypeError, ValueError):
        read_min = 0
    if read_min <= 0:
        # 中文阅读约 350 字/分钟
        read_min = max(3, round(wc / 350))

    return MethodologyArticle(
        slug=slug,
        title=title,
        category=category,
        inspired_by=str(fm.get("inspired_by") or ""),
        applicable_to=_strlist(fm.get("applicable_to")),
        market_phase=_strlist(fm.get("market_phase")),
        estimated_read_min=read_min,
        tags=_strlist(fm.get("tags")),
        skill_id=(str(fm["skill_id"]) if fm.get("skill_id") not in (None, "null", "") else None),
        summary=summary,
        content=body,
        word_count=wc,
        file_path=str(path),
        file_mtime=path.stat().st_mtime,
    )


def _dir_signature(d: Path) -> tuple:
    """目录指纹: 用于检测是否需要重建索引."""
    if not d.exists():
        return ()
    try:
        files = sorted(d.glob("*.md"))
        return tuple((f.name, f.stat().st_mtime, f.stat().st_size) for f in files)
    except Exception:
        return ()


def _build_index() -> dict[str, MethodologyArticle]:
    d = _resolve_content_dir()
    if not d.exists():
        logger.warning(f"methodology: content dir not found: {d}")
        return {}

    out: dict[str, MethodologyArticle] = {}
    for f in sorted(d.glob("*.md")):
        article = _parse_file(f)
        if article is None:
            continue
        if article.slug in out:
            logger.warning(
                f"methodology: duplicate slug '{article.slug}' "
                f"({out[article.slug].file_path} vs {article.file_path})"
            )
        out[article.slug] = article
    logger.info(f"methodology: indexed {len(out)} articles from {d}")
    return out


def get_index(force_refresh: bool = False) -> dict[str, MethodologyArticle]:
    """获取最新索引. 60s TTL + mtime 指纹双重失效."""
    now = time.monotonic()
    with _lock:
        d = _resolve_content_dir()
        sig = _dir_signature(d)
        stale = (
            force_refresh
            or not _cache.articles
            or (now - _cache.built_at) > CACHE_TTL_SEC
            or sig != _cache.dir_signature
        )
        if stale:
            _cache.articles = _build_index()
            _cache.built_at = now
            _cache.dir_signature = sig
        return _cache.articles


def list_articles(
    category: str = "",
    tag: str = "",
    q: str = "",
) -> list[MethodologyArticle]:
    """按 category / tag / 关键词过滤. 关键词在 title + summary + tags 内做小写包含."""
    articles = list(get_index().values())

    if category:
        articles = [a for a in articles if a.category == category]
    if tag:
        articles = [a for a in articles if tag in a.tags]
    if q:
        ql = q.lower().strip()
        if ql:
            articles = [
                a
                for a in articles
                if ql in a.title.lower()
                or ql in a.summary.lower()
                or any(ql in t.lower() for t in a.tags)
            ]

    # 按 category 排序 (固定顺序), 同 category 内按 estimated_read_min asc, 然后 title
    cat_order = list(CATEGORY_META.keys())

    def _key(a: MethodologyArticle):
        try:
            ci = cat_order.index(a.category)
        except ValueError:
            ci = len(cat_order)
        return (ci, a.estimated_read_min, a.title)

    articles.sort(key=_key)
    return articles


def get_article(slug: str) -> MethodologyArticle | None:
    return get_index().get(slug)


def categories_summary() -> list[dict[str, Any]]:
    """各分类计数 + 每个分类的高频 tag (取 top 8)."""
    idx = get_index()
    out: list[dict[str, Any]] = []
    for cat in [*CATEGORY_META.keys(), "uncategorized"]:
        items = [a for a in idx.values() if a.category == cat]
        if not items:
            continue
        tag_freq: dict[str, int] = {}
        for a in items:
            for t in a.tags:
                tag_freq[t] = tag_freq.get(t, 0) + 1
        top_tags = sorted(tag_freq.items(), key=lambda kv: (-kv[1], kv[0]))[:8]
        meta = CATEGORY_META.get(cat, {"label": cat, "desc": "", "color": "var(--text-secondary)"})
        out.append(
            {
                "key": cat,
                "label": meta["label"],
                "desc": meta["desc"],
                "color": meta["color"],
                "count": len(items),
                "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
            }
        )
    return out


def all_tags() -> list[dict[str, Any]]:
    """全量 tag 频次表."""
    idx = get_index()
    freq: dict[str, int] = {}
    for a in idx.values():
        for t in a.tags:
            freq[t] = freq.get(t, 0) + 1
    return [{"tag": t, "count": c} for t, c in sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))]
