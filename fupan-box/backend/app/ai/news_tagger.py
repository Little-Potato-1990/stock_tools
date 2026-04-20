"""财联社/财经新闻 AI 批量打标.

输入: 一批新闻 [{title, content, pub_time}]
输出: 每条新闻附加 tags / themes / rel_codes / importance / sentiment

策略:
- 一次 LLM 调用打 30 条 (节约 token + 提速)
- in-memory cache, key = hash(titles), TTL 30 分钟
- LLM 失败时返回 heuristic (按 themes / 关键词)
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from typing import Any

from app.ai.brief_generator import _call_llm

logger = logging.getLogger(__name__)

_TAG_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_TAG_TTL = 1800.0


_BULLISH_KW = [
    "利好", "突破", "新高", "增长", "扩产", "中标", "签约", "订单", "合作",
    "回购", "增持", "并购", "重组", "上调", "扭亏", "翻倍", "激增",
]
_BEARISH_KW = [
    "利空", "下跌", "新低", "亏损", "减持", "立案", "调查", "处罚",
    "下调", "暂停", "停产", "ST", "退市", "诉讼", "黑天鹅",
]
_HOT_THEMES = [
    "AI", "人工智能", "大模型", "算力", "芯片", "半导体", "光刻机",
    "机器人", "人形机器人", "低空经济", "eVTOL", "新能源", "锂电池",
    "光伏", "氢能", "储能", "数据要素", "数字经济", "信创",
    "军工", "航天", "卫星", "可控核聚变", "固态电池", "脑机接口",
    "Sora", "GPT", "DeepSeek", "Manus", "Agent",
]


def _hash_news(items: list[dict]) -> str:
    h = hashlib.md5()
    for it in items:
        h.update((it.get("title", "") + "|").encode("utf-8", errors="ignore"))
    return h.hexdigest()


def _heuristic_one(item: dict, theme_pool: set[str]) -> dict[str, Any]:
    text = (item.get("title", "") or "") + " " + (item.get("content", "") or "")

    themes = [t for t in _HOT_THEMES if t in text]
    for t in theme_pool:
        if len(t) >= 2 and t in text and t not in themes:
            themes.append(t)
    themes = themes[:6]

    bull = sum(1 for kw in _BULLISH_KW if kw in text)
    bear = sum(1 for kw in _BEARISH_KW if kw in text)
    if bull > bear and bull > 0:
        sentiment = "bullish"
    elif bear > bull and bear > 0:
        sentiment = "bearish"
    else:
        sentiment = "neutral"

    importance = 2
    if any(kw in text for kw in ("重磅", "突发", "首次", "罕见", "千亿", "万亿", "国务院", "央行降准", "降息", "财政")):
        importance = 5
    elif any(kw in text for kw in ("百亿", "新规", "出台", "印发", "试点", "重组", "并购", "上市")):
        importance = 4
    elif themes:
        importance = 3

    rel_codes = re.findall(r"\b(\d{6})\b", text)
    rel_codes = list(dict.fromkeys(rel_codes))[:5]

    tags = []
    if themes:
        tags.append(themes[0])
    if sentiment == "bullish":
        tags.append("利好")
    elif sentiment == "bearish":
        tags.append("利空")
    if importance >= 4:
        tags.append("重磅")

    return {
        "tags": tags,
        "themes": themes,
        "rel_codes": rel_codes,
        "importance": importance,
        "sentiment": sentiment,
    }


def _build_prompt(items: list[dict]) -> tuple[str, str]:
    system = (
        "你是 A 股新闻打标专家。我会给你一批财经/财联社新闻, "
        "请逐条判断其题材关联、重要程度、利好/利空倾向, "
        "严格按 JSON schema 返回。**禁止**编造代码/题材/情绪, 不确定的字段留空。"
    )
    items_min = [
        {
            "i": idx,
            "title": (it.get("title") or "")[:80],
            "content": (it.get("content") or "")[:200],
        }
        for idx, it in enumerate(items)
    ]
    user = (
        f"```json\n{json.dumps(items_min, ensure_ascii=False)}\n```\n\n"
        "请输出 JSON, schema 如下 (results 数组顺序必须与输入 i 对齐):\n"
        "```json\n"
        "{\n"
        '  "results": [\n'
        "    {\n"
        '      "i": 0,\n'
        '      "tags": ["<=3 个简短标签, 最多4字, 例: 主升题材/政策/利好/突发"],\n'
        '      "themes": ["<=4 个相关概念名"],\n'
        '      "rel_codes": ["<=4 个相关 6 位股票代码"],\n'
        '      "importance": 1,\n'
        '      "sentiment": "bullish | neutral | bearish"\n'
        "    }\n"
        "  ]\n"
        "}\n```\n"
        "重要程度 1-5: 5=重磅政策/行业级别催化, 4=单股大单/大并购, 3=正常题材新闻, 2=普通公告, 1=噪音。"
        "只判断你能从文本看出的, 不要凭空编。"
    )
    return system, user


def _merge(items: list[dict], llm_out: dict | None, theme_pool: set[str]) -> list[dict[str, Any]]:
    base = [_heuristic_one(it, theme_pool) for it in items]
    if not llm_out:
        return base

    results = llm_out.get("results")
    if not isinstance(results, list):
        return base

    by_idx = {r.get("i"): r for r in results if isinstance(r, dict)}
    valid_sentiment = {"bullish", "neutral", "bearish"}

    for idx, fallback in enumerate(base):
        r = by_idx.get(idx)
        if not r:
            continue

        tags = r.get("tags") or []
        if isinstance(tags, list):
            clean = [str(t).strip()[:8] for t in tags if t][:3]
            if clean:
                fallback["tags"] = clean

        themes = r.get("themes") or []
        if isinstance(themes, list):
            clean = [str(t).strip()[:20] for t in themes if t][:5]
            if clean:
                fallback["themes"] = clean

        rel = r.get("rel_codes") or []
        if isinstance(rel, list):
            clean = [str(c).strip() for c in rel if isinstance(c, str) and re.match(r"^\d{6}$", c.strip())][:5]
            if clean:
                fallback["rel_codes"] = clean

        imp = r.get("importance")
        if isinstance(imp, int) and 1 <= imp <= 5:
            fallback["importance"] = imp

        sent = r.get("sentiment")
        if isinstance(sent, str) and sent in valid_sentiment:
            fallback["sentiment"] = sent

    return base


async def tag_news_batch(
    items: list[dict],
    theme_pool: set[str] | None = None,
    model_id: str = "deepseek-v3",
) -> list[dict[str, Any]]:
    """批量打标; 返回与 items 等长 list."""
    if not items:
        return []

    theme_pool = theme_pool or set()
    cache_key = _hash_news(items) + "|" + model_id
    cached = _TAG_CACHE.get(cache_key)
    if cached and time.time() - cached[0] < _TAG_TTL:
        return cached[1]

    sys, usr = _build_prompt(items)
    try:
        llm_out = await _call_llm(sys, usr, model_id)
    except Exception as e:
        logger.warning("news tagger llm failed: %s", e)
        llm_out = None

    merged = _merge(items, llm_out, theme_pool)
    _TAG_CACHE[cache_key] = (time.time(), merged)
    return merged
