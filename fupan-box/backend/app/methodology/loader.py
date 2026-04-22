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


# === 已知 category 元数据 (中文标签 + 颜色 hint, 旧字段, 仅作面包屑兼容) ===
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


# === 基础知识 4 类子分类元数据 (新主轴, 词典视图分组用) ===
FOUNDATION_SUBCAT_META: dict[str, dict[str, str]] = {
    "technical": {
        "label": "技术分析",
        "desc": "趋势 / 形态 / 量价 / 指标 / 缠论",
        "color": "var(--accent-blue)",
    },
    "valuation": {
        "label": "估值方法",
        "desc": "PE / PB / PS / DCF / 估值适用场景",
        "color": "var(--accent-purple)",
    },
    "financial": {
        "label": "财务分析",
        "desc": "ROE / 杜邦 / 现金流 / 财报勾稽",
        "color": "var(--accent-green)",
    },
    "macro": {
        "label": "宏观与周期",
        "desc": "美林时钟 / 行业生命周期 / 流动性 / 风格轮动",
        "color": "var(--accent-red)",
    },
}


# === 投资体系元数据 (与 system-*.md frontmatter 的 system_key 对应) ===
SYSTEM_META: dict[str, dict[str, str]] = {
    "system-value-longterm": {
        "label": "价值长线",
        "tagline": "护城河 + 长期持有，赚企业成长的钱",
        "horizon": "3-10 年",
        "risk": "低-中",
        "color": "var(--accent-purple)",
    },
    "system-midline-trend": {
        "label": "中长线趋势",
        "tagline": "基本面 + 行情双确认，吃主升浪",
        "horizon": "3-12 月",
        "risk": "中",
        "color": "var(--accent-blue)",
    },
    "system-swing-technical": {
        "label": "技术波段",
        "tagline": "纯技术派，趋势 + 形态 + 量价驱动",
        "horizon": "1-8 周",
        "risk": "中-高",
        "color": "var(--accent-cyan)",
    },
    "system-short-intraday": {
        "label": "短线情绪",
        "tagline": "打板 / 题材接力 / 龙虎榜跟庄",
        "horizon": "1-5 天",
        "risk": "高",
        "color": "var(--accent-orange)",
    },
    "system-macro-rotation": {
        "label": "宏观周期",
        "tagline": "自上而下，跟着宏观与风格轮动",
        "horizon": "6-24 月",
        "risk": "中",
        "color": "var(--accent-red)",
    },
    "system-event-driven": {
        "label": "事件驱动",
        "tagline": "围绕政策 / 业绩 / 重组 / 解禁等事件博弈",
        "horizon": "数日 - 数月",
        "risk": "中-高",
        "color": "var(--accent-yellow)",
    },
    "system-high-dividend": {
        "label": "高股息",
        "tagline": "稳定现金流 + 类债思路，吃股息与估值修复",
        "horizon": "1-5 年",
        "risk": "低",
        "color": "var(--accent-green)",
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
    # === 两层架构新增字段 (向后兼容: 缺省值不影响旧文章) ===
    # kind 三态: system (体系总览) / foundation (基础知识, 中性客观) / tactic (战法, 绑定体系)
    kind: str = "foundation"
    # 仅 foundation 用: technical | valuation | financial | macro
    foundation_subcategory: str = ""
    # 仅 system 用: 体系自身 key (= slug), 便于反向引用
    system_key: str = ""
    # 仅 system 用: 必读基础知识 / 配套战法 slug 列表
    related_foundations: list[str] = field(default_factory=list)
    related_tactics: list[str] = field(default_factory=list)
    # 仅 tactic 用: 反向归属 system_key 列表
    belongs_to_systems: list[str] = field(default_factory=list)

    def _system_meta(self) -> dict[str, Any]:
        """若 kind=system, 给出 SYSTEM_META 中的展示字段."""
        if self.kind != "system":
            return {}
        m = SYSTEM_META.get(self.system_key or self.slug, {})
        return {
            "system_label": m.get("label", self.title),
            "system_tagline": m.get("tagline", ""),
            "system_horizon": m.get("horizon", ""),
            "system_risk": m.get("risk", ""),
            "system_color": m.get("color", "var(--accent-purple)"),
        }

    def _foundation_meta(self) -> dict[str, Any]:
        """若 kind=foundation, 给出子分类标签."""
        if self.kind != "foundation":
            return {}
        m = FOUNDATION_SUBCAT_META.get(self.foundation_subcategory, {})
        return {
            "foundation_subcategory_label": m.get("label", self.foundation_subcategory),
            "foundation_subcategory_color": m.get("color", "var(--text-secondary)"),
        }

    def to_meta(self) -> dict[str, Any]:
        """列表接口回传 (不含 content)."""
        base = {
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
            # 新字段
            "kind": self.kind,
            "foundation_subcategory": self.foundation_subcategory,
            "system_key": self.system_key,
            "related_foundations": self.related_foundations,
            "related_tactics": self.related_tactics,
            "belongs_to_systems": self.belongs_to_systems,
        }
        base.update(self._system_meta())
        base.update(self._foundation_meta())
        return base

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

    # 两层架构字段 (向后兼容: 老文章无这些字段时默认 kind=foundation, 子分类按
    # 旧 category 推断, 让"未补 frontmatter 的旧 md"在新视图里也不至于完全消失).
    kind_raw = str(fm.get("kind") or "").strip().lower()
    if kind_raw not in ("system", "foundation", "tactic"):
        kind_raw = "foundation"

    foundation_subcat = str(fm.get("foundation_subcategory") or "").strip().lower()
    if kind_raw == "foundation" and not foundation_subcat:
        # 兜底: 按旧 category 粗略映射, 避免老 md 无 subcat 时被分到"未分类"
        _map = {
            "technical": "technical",
            "value_longterm": "valuation",
            "macro": "macro",
        }
        foundation_subcat = _map.get(category, "")

    system_key = str(fm.get("system_key") or "").strip()
    if kind_raw == "system" and not system_key:
        # system 默认 system_key = slug, 方便引用
        system_key = slug

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
        kind=kind_raw,
        foundation_subcategory=foundation_subcat,
        system_key=system_key,
        related_foundations=_strlist(fm.get("related_foundations")),
        related_tactics=_strlist(fm.get("related_tactics")),
        belongs_to_systems=_strlist(fm.get("belongs_to_systems")),
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


# ============== 两层架构: 体系 / 基础知识 / 战法 三态查询 ==============


def list_systems() -> list[MethodologyArticle]:
    """所有 kind=system 的体系总览, 按 SYSTEM_META 顺序排."""
    idx = get_index()
    order = list(SYSTEM_META.keys())
    items = [a for a in idx.values() if a.kind == "system"]

    def _k(a: MethodologyArticle):
        try:
            return order.index(a.system_key or a.slug)
        except ValueError:
            return len(order)

    items.sort(key=_k)
    return items


def list_foundations(subcat: str = "") -> list[MethodologyArticle]:
    """基础知识列表. 可按子分类过滤. 同子分类内按 read_min asc + title."""
    idx = get_index()
    items = [a for a in idx.values() if a.kind == "foundation"]
    if subcat:
        items = [a for a in items if a.foundation_subcategory == subcat]
    sub_order = list(FOUNDATION_SUBCAT_META.keys())

    def _k(a: MethodologyArticle):
        try:
            si = sub_order.index(a.foundation_subcategory)
        except ValueError:
            si = len(sub_order)
        return (si, a.estimated_read_min, a.title)

    items.sort(key=_k)
    return items


def list_tactics(system_key: str = "") -> list[MethodologyArticle]:
    """战法列表. 可按所属体系 system_key 过滤."""
    idx = get_index()
    items = [a for a in idx.values() if a.kind == "tactic"]
    if system_key:
        items = [a for a in items if system_key in a.belongs_to_systems]
    items.sort(key=lambda a: (a.estimated_read_min, a.title))
    return items


def foundations_summary() -> list[dict[str, Any]]:
    """基础知识 4 子分类的计数 + 高频 tag, 给前端 foundations 视图侧栏用."""
    idx = get_index()
    out: list[dict[str, Any]] = []
    for sub, meta in FOUNDATION_SUBCAT_META.items():
        items = [a for a in idx.values() if a.kind == "foundation" and a.foundation_subcategory == sub]
        if not items:
            # 子分类即使为空也保留, 让前端显示完整骨架
            out.append({
                "key": sub,
                "label": meta["label"],
                "desc": meta["desc"],
                "color": meta["color"],
                "count": 0,
                "top_tags": [],
            })
            continue
        tag_freq: dict[str, int] = {}
        for a in items:
            for t in a.tags:
                tag_freq[t] = tag_freq.get(t, 0) + 1
        top_tags = sorted(tag_freq.items(), key=lambda kv: (-kv[1], kv[0]))[:8]
        out.append({
            "key": sub,
            "label": meta["label"],
            "desc": meta["desc"],
            "color": meta["color"],
            "count": len(items),
            "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
        })
    return out


def systems_with_links() -> list[dict[str, Any]]:
    """所有体系 + 各自挂接的 foundation/tactic 简要 meta. 用于 landing 卡片墙."""
    idx = get_index()
    out: list[dict[str, Any]] = []
    for sys_a in list_systems():
        rf_meta = []
        for slug in sys_a.related_foundations:
            a = idx.get(slug)
            if a is not None:
                rf_meta.append(a.to_meta())
        rt_meta = []
        for slug in sys_a.related_tactics:
            a = idx.get(slug)
            if a is not None:
                rt_meta.append(a.to_meta())
        out.append({
            **sys_a.to_meta(),
            "related_foundations_meta": rf_meta,
            "related_tactics_meta": rt_meta,
        })
    return out


def referenced_by_systems(slug: str) -> list[dict[str, Any]]:
    """反查: 此 foundation/tactic 被哪些 system 引用."""
    out: list[dict[str, Any]] = []
    for sys_a in list_systems():
        if slug in sys_a.related_foundations or slug in sys_a.related_tactics:
            out.append(sys_a.to_meta())
    return out


def belongs_to_systems_meta(belongs: list[str]) -> list[dict[str, Any]]:
    """tactic 详情用: 把 belongs_to_systems 的 system_key 解析成完整 meta."""
    idx = get_index()
    out: list[dict[str, Any]] = []
    # 用 slug 反查 (system_key 默认 = slug)
    by_key: dict[str, MethodologyArticle] = {a.system_key or a.slug: a for a in list_systems()}
    for k in belongs:
        a = by_key.get(k) or idx.get(k)
        if a is not None and a.kind == "system":
            out.append(a.to_meta())
    return out
