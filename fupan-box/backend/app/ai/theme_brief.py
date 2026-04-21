"""题材轮动 AI 拆解.

输入: 近 N 天 themes / industries snapshot + 近 N 天 ladder snapshot
派生: 每个题材的 5 日表现 (涨幅 / 涨停数 / 排名变化)
LLM 输出: 当前主线、退潮题材、新兴题材、下一棒猜想

输出 schema:
{
  "trade_date": "...",
  "generated_at": "...",
  "model": "...",
  "headline": "一句话概括 (≤40字)",
  "leading": [{"name": "...", "rank_today": N, "lu_today": N, "trend": [...], "ai_note": "..."}],
  "fading": [{"name": "...", "ai_note": "..."}],
  "emerging": [{"name": "...", "ai_note": "..."}],
  "next_bet": {"name": "...", "reason": "..."}
}
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.ai.brief_generator import _call_llm, _latest_trade_date_with_data
from app.ai.cross_context import NO_FLUFF_RULES, build_cross_context_block
from app.config import get_settings
from app.models.snapshot import DailySnapshot

logger = logging.getLogger(__name__)


def _load_themes_series(trade_date: date, days: int = 5) -> list[dict]:
    """加载近 N 个交易日的 themes snapshot, 按日期升序."""
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            rows = session.execute(
                select(DailySnapshot)
                .where(
                    DailySnapshot.snapshot_type == "themes",
                    DailySnapshot.trade_date <= trade_date,
                )
                .order_by(DailySnapshot.trade_date.desc())
                .limit(days)
            ).scalars().all()
            return [{"date": r.trade_date.isoformat(), "data": r.data or {}} for r in reversed(rows)]
    finally:
        engine.dispose()


def _load_ladder_series(trade_date: date, days: int = 5) -> list[dict]:
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            rows = session.execute(
                select(DailySnapshot)
                .where(
                    DailySnapshot.snapshot_type == "ladder",
                    DailySnapshot.trade_date <= trade_date,
                )
                .order_by(DailySnapshot.trade_date.desc())
                .limit(days)
            ).scalars().all()
            return [{"date": r.trade_date.isoformat(), "data": r.data or {}} for r in reversed(rows)]
    finally:
        engine.dispose()


def _theme_lu_count(ladder_data: dict, theme_name: str) -> int:
    """该日 ladder 里题材出现的涨停股数."""
    cnt = 0
    for lvl in ladder_data.get("levels") or []:
        for s in lvl.get("stocks") or []:
            if theme_name in (s.get("theme_names") or []):
                cnt += 1
    return cnt


def _aggregate_themes(themes_series: list[dict], ladder_series: list[dict]) -> dict[str, Any]:
    """聚合每个题材的 5 日序列: 排名 / 涨幅 / 涨停数."""
    if not themes_series:
        return {"profiles": [], "all_themes": []}

    today = themes_series[-1]
    today_top = today["data"].get("top") or []

    candidate_names = {t.get("name") for t in today_top[:30] if t.get("name")}
    for snap in themes_series[:-1]:
        for t in (snap["data"].get("top") or [])[:15]:
            if t.get("name"):
                candidate_names.add(t["name"])

    profiles = []
    for name in candidate_names:
        ranks: list[int | None] = []
        chgs: list[float] = []
        for snap in themes_series:
            top = snap["data"].get("top") or []
            r = next((i + 1 for i, t in enumerate(top) if t.get("name") == name), None)
            ranks.append(r)
            c = next((float(t.get("change_pct", 0)) for t in top if t.get("name") == name), 0.0)
            chgs.append(c)

        lu_trend = []
        for ld_snap in ladder_series:
            lu_trend.append(_theme_lu_count(ld_snap["data"], name))

        today_rank = ranks[-1]
        first_rank = next((r for r in ranks if r is not None), None)
        new_today = today_rank is not None and not any(r is not None for r in ranks[:-1])

        # 排名变化方向
        if today_rank is None:
            direction = "exit"
        elif first_rank is None:
            direction = "new"
        elif first_rank - today_rank >= 5:
            direction = "rising"
        elif today_rank - first_rank >= 5:
            direction = "fading"
        else:
            direction = "stable"

        profiles.append({
            "name": name,
            "today_rank": today_rank,
            "today_chg": chgs[-1],
            "ranks": ranks,
            "chgs": chgs,
            "lu_trend": lu_trend,
            "direction": direction,
            "is_new": new_today,
        })

    profiles.sort(key=lambda p: p["today_rank"] or 999)
    return {"profiles": profiles[:25], "today_top10": [t.get("name") for t in today_top[:10]]}


def _derive_pools(agg: dict[str, Any]) -> dict[str, list[dict]]:
    profiles = agg["profiles"]
    leading = sorted(
        [p for p in profiles if p["today_rank"] and p["today_rank"] <= 8],
        key=lambda x: (x["today_rank"], -x["today_chg"]),
    )[:5]
    fading = [p for p in profiles if p["direction"] == "fading"][:5]
    emerging = [p for p in profiles if p["is_new"] or (p["direction"] == "rising" and p["today_rank"] and p["today_rank"] <= 15)][:5]
    return {"leading": leading, "fading": fading, "emerging": emerging}


def _load_theme_news(pools: dict[str, list[dict]], hours: int = 36, per_theme: int = 4) -> dict[str, list[dict]]:
    """给 leading/fading/emerging 每个题材拉最近相关新闻。

    返回 {theme_name: [{id, title, sentiment, importance, pub_time}, ...]}.
    单个题材最多 per_theme 条, 跨池子去重.
    """
    from app.news.ingest import fetch_news_for_themes

    names: list[str] = []
    for k in ("leading", "emerging", "fading"):
        for p in pools.get(k) or []:
            n = p.get("name")
            if n and n not in names:
                names.append(n)
    out: dict[str, list[dict]] = {}
    for name in names[:12]:
        try:
            rows = fetch_news_for_themes([name], hours=hours, limit=per_theme)
        except Exception as exc:
            logger.debug("[theme-news] %s err=%s", name, exc)
            rows = []
        if not rows:
            continue
        out[name] = [
            {
                "id": r["id"],
                "title": (r.get("title") or "")[:80],
                "sentiment": r.get("sentiment"),
                "importance": int(r.get("importance") or 0),
                "pub_time": r.get("pub_time"),
            }
            for r in rows
        ]
    return out


def _build_prompt(
    trade_date: str,
    agg: dict[str, Any],
    pools: dict[str, list[dict]],
    cross_ctx: str = "",
    theme_news: dict[str, list[dict]] | None = None,
) -> tuple[str, str]:
    system = (
        "你是 A 股短线复盘专家, 专门做题材轮动节奏判断。"
        "基于给定的近 5 日题材排名/涨幅/涨停数据, 用中文输出 JSON。"
        "**严格要求**: name 必须从给定数据中选, 不得编造。判断要直接、精炼、有可操作性。"
        + NO_FLUFF_RULES
    )

    profile_brief = []
    for p in agg["profiles"][:20]:
        profile_brief.append({
            "name": p["name"],
            "ranks_5d": p["ranks"],
            "chg_5d": [round(x, 2) for x in p["chgs"]],
            "lu_5d": p["lu_trend"],
            "direction": p["direction"],
            "is_new": p["is_new"],
        })

    pool_brief = {
        "leading": [{"name": p["name"], "today_rank": p["today_rank"]} for p in pools["leading"]],
        "fading": [{"name": p["name"]} for p in pools["fading"]],
        "emerging": [{"name": p["name"], "today_rank": p["today_rank"], "is_new": p["is_new"]} for p in pools["emerging"]],
    }

    news_block = ""
    if theme_news:
        news_lite = {
            n: [
                {"id": x["id"], "t": x["title"], "s": x.get("sentiment") or "neutral"}
                for x in lst[:3]
            ]
            for n, lst in theme_news.items()
        }
        news_block = (
            "\n相关新闻 (近 36h, 用于校验主线/退潮逻辑, 必要时在 ai_note 里引用 news_id):\n"
            f"```json\n{json.dumps(news_lite, ensure_ascii=False)[:1800]}\n```\n"
        )

    user = (
        f"今日 {trade_date} 题材排名/涨幅/涨停数据如下:\n\n"
        f"```json\n{json.dumps({'profiles': profile_brief, 'pools': pool_brief}, ensure_ascii=False)[:3500]}\n```\n"
        f"{news_block}"
        f"{cross_ctx}"
        "\n请输出 JSON, 严格按以下 schema:\n"
        "```json\n"
        "{\n"
        '  "headline": "一句话概括今日轮动 (≤40字), 突出主线/退潮/新晋焦点",\n'
        '  "leading": [\n'
        '    {"name": "(从 leading 中选)", "ai_note": "≤40字, 写明持续性判断, 若有新闻支撑可写明", "news_ids": [可选, 引用相关新闻id最多2个]}\n'
        "  ],\n"
        '  "fading": [\n'
        '    {"name": "(从 fading 中选)", "ai_note": "≤40字, 写明退潮原因或后续", "news_ids": []}\n'
        "  ],\n"
        '  "emerging": [\n'
        '    {"name": "(从 emerging 中选)", "ai_note": "≤40字, 写明潜力点, 若有催化新闻请引用", "news_ids": []}\n'
        "  ],\n"
        '  "next_bet": {"name": "(可选, 从 emerging 或 leading 选)", "reason": "≤50字, 明日重点关注的逻辑"},\n'
        '  "evidence": [\n'
        '    "1-3 条 ≤30 字 关键数字证据, 必须引用 profiles 里的真实数字",\n'
        '    "示例: \'光模块今日排名 #1, 涨停 12 只, 5日 lu_trend [3,5,7,9,12]\'"\n'
        "  ]\n"
        "}\n```\n"
        "leading/fading/emerging 各输出 2-3 条。不要返回 markdown fence。"
    )
    return system, user


def _heuristic_brief(agg: dict[str, Any], pools: dict[str, list[dict]]) -> dict[str, Any]:
    leading_names = [p["name"] for p in pools["leading"]]
    fading_names = [p["name"] for p in pools["fading"]]
    emerging_names = [p["name"] for p in pools["emerging"]]
    headline = (
        f"主线 {leading_names[0]}" if leading_names else "今日题材分散"
    )
    evidence: list[str] = []
    if pools["leading"]:
        p = pools["leading"][0]
        evidence.append(f"主线 {p['name']} 今日排名 #{p['today_rank']}, 涨停 {p['lu_trend'][-1] if p['lu_trend'] else 0} 只")
    if pools["fading"]:
        evidence.append(f"退潮: {'/'.join(fading_names[:2])}, 排名下滑")
    if pools["emerging"]:
        p = pools["emerging"][0]
        evidence.append(f"新晋 {p['name']} 今日排名 #{p['today_rank']}")
    return {
        "headline": headline,
        "leading": [{"name": p["name"], "ai_note": f"今日排名 {p['today_rank']}, 涨停数 {p['lu_trend'][-1]}"} for p in pools["leading"][:3]],
        "fading": [{"name": p["name"], "ai_note": "近期排名下滑, 跟风票熄火"} for p in pools["fading"][:3]],
        "emerging": [{"name": p["name"], "ai_note": "新进 top, 关注延续性"} for p in pools["emerging"][:3]],
        "next_bet": {"name": (emerging_names + leading_names)[0] if (emerging_names or leading_names) else "", "reason": "暂无 LLM 推荐"},
        "evidence": evidence,
    }


def _merge_llm(
    agg: dict[str, Any],
    pools: dict[str, list[dict]],
    llm_out: dict | None,
    theme_news: dict[str, list[dict]] | None = None,
) -> dict[str, Any]:
    if not llm_out:
        return _heuristic_brief(agg, pools)

    leading_set = {p["name"] for p in pools["leading"]}
    fading_set = {p["name"] for p in pools["fading"]}
    emerging_set = {p["name"] for p in pools["emerging"]}
    all_set = leading_set | fading_set | emerging_set | {p["name"] for p in agg["profiles"]}

    valid_news_ids: set[int] = set()
    if theme_news:
        for lst in theme_news.values():
            for it in lst:
                if it.get("id") is not None:
                    valid_news_ids.add(int(it["id"]))

    def _clean_list(arr_in, valid_set, max_n=3):
        out = []
        for it in arr_in or []:
            name = (it.get("name") or "").strip()
            if name not in valid_set:
                continue
            note = (it.get("ai_note") or "").strip()[:50]
            if not note:
                continue
            ids_in = it.get("news_ids") or []
            news_ids: list[int] = []
            for nid in ids_in[:3]:
                try:
                    nid_int = int(nid)
                except (TypeError, ValueError):
                    continue
                if nid_int in valid_news_ids and nid_int not in news_ids:
                    news_ids.append(nid_int)
            out.append({"name": name, "ai_note": note, "news_ids": news_ids})
            if len(out) >= max_n:
                break
        return out

    leading = _clean_list(llm_out.get("leading"), leading_set)
    fading = _clean_list(llm_out.get("fading"), fading_set)
    emerging = _clean_list(llm_out.get("emerging"), emerging_set | leading_set)

    if not leading:
        leading = _heuristic_brief(agg, pools)["leading"]
    if not fading and pools["fading"]:
        fading = _heuristic_brief(agg, pools)["fading"]
    if not emerging and pools["emerging"]:
        emerging = _heuristic_brief(agg, pools)["emerging"]

    headline = (llm_out.get("headline") or "").strip()[:60]
    if not headline:
        headline = _heuristic_brief(agg, pools)["headline"]

    nb = llm_out.get("next_bet") or {}
    next_bet = {"name": "", "reason": ""}
    if isinstance(nb, dict):
        nm = (nb.get("name") or "").strip()
        if nm in all_set:
            next_bet = {"name": nm, "reason": (nb.get("reason") or "")[:60]}
    if not next_bet["name"]:
        next_bet = _heuristic_brief(agg, pools)["next_bet"]

    profile_map = {p["name"]: p for p in agg["profiles"]}
    theme_news = theme_news or {}
    for arr in (leading, fading, emerging):
        for it in arr:
            p = profile_map.get(it["name"])
            if p:
                it["today_rank"] = p["today_rank"]
                it["lu_trend"] = p["lu_trend"]
                it["chg_today"] = round(p["chgs"][-1] if p["chgs"] else 0.0, 2)
            it["news_refs"] = theme_news.get(it["name"], [])[:3]

    evidence: list[str] = []
    for raw in (llm_out.get("evidence") or [])[:3]:
        s = (str(raw) if not isinstance(raw, str) else raw).strip()[:40]
        if s:
            evidence.append(s)
    if not evidence:
        evidence = _heuristic_brief(agg, pools).get("evidence", [])

    news_pool: dict[int, dict] = {}
    for lst in theme_news.values():
        for it in lst:
            nid = it.get("id")
            if nid is None:
                continue
            news_pool[int(nid)] = {
                "id": int(nid),
                "title": it.get("title") or "",
                "sentiment": it.get("sentiment"),
                "importance": int(it.get("importance") or 0),
                "pub_time": it.get("pub_time"),
            }

    return {
        "headline": headline,
        "leading": leading,
        "fading": fading,
        "emerging": emerging,
        "next_bet": next_bet,
        "evidence": evidence,
        "news_pool": list(news_pool.values()),
    }


async def generate_theme_brief(
    trade_date: date | None,
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()

    themes_series = _load_themes_series(trade_date, days=5)
    ladder_series = _load_ladder_series(trade_date, days=5)

    base: dict[str, Any] = {
        "trade_date": trade_date.isoformat(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "model": model_id,
        "headline": "",
        "leading": [],
        "fading": [],
        "emerging": [],
        "next_bet": {"name": "", "reason": ""},
        "evidence": [],
        "news_pool": [],
    }

    if not themes_series:
        base["headline"] = f"{trade_date.isoformat()} 暂无题材数据"
        return base

    agg = _aggregate_themes(themes_series, ladder_series)
    pools = _derive_pools(agg)
    theme_news = _load_theme_news(pools, hours=36, per_theme=4)

    cross_ctx = build_cross_context_block(
        trade_date, model_id, include_sentiment=True
    )

    # P3 题材资金画像注入: 给主线 / 新生 / 退潮 题材标注当日资金 (concept scope)
    try:
        from app.models.capital import CapitalFlowDaily
        from sqlalchemy import create_engine, select
        from sqlalchemy.orm import Session as _Sess
        settings = get_settings()
        eng = create_engine(settings.database_url_sync)
        cand_names = set()
        for grp in ("leading", "fading", "emerging"):
            for it in (pools.get(grp) or [])[:5]:
                if it.get("name"): cand_names.add(it["name"])
        cap_lines = []
        if cand_names:
            with _Sess(eng) as sess:
                rows = sess.execute(
                    select(CapitalFlowDaily).where(
                        CapitalFlowDaily.scope == "concept",
                        CapitalFlowDaily.trade_date == trade_date,
                        CapitalFlowDaily.scope_key.in_(list(cand_names)),
                    )
                ).scalars().all()
                for r in rows:
                    d = r.data or {}
                    mi = d.get("main_inflow")
                    if mi is None: continue
                    cap_lines.append(f"- {r.scope_key}: 主力{mi/1e8:+.2f}亿")
        eng.dispose()
        if cap_lines:
            cross_ctx = (cross_ctx or "") + "\n【题材资金动向】\n" + "\n".join(cap_lines) + "\n"
    except Exception:
        pass

    system, user = _build_prompt(trade_date.isoformat(), agg, pools, cross_ctx, theme_news)
    llm_out = await _call_llm(system, user, model_id)
    merged = _merge_llm(agg, pools, llm_out, theme_news)
    base.update(merged)
    return base
