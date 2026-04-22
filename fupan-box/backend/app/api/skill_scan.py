"""体系驱动的选股扫描 API.

POST /api/skill-scan/run
   body: {skill_ref, universe, top_n}
   返回 SSE 流:
     event: meta       开始, 含 skill 名字 / universe / top_n
     event: filter     硬过滤完成 (含通过数)
     event: score      评分完成 (top_n 候选基础数据 list)
     event: candidate  每只股票的 LLM 体系视角点评 (按完成顺序流出)
     event: summary    整体扫描小结
     event: done       含 scan_run_id

GET /api/skill-scan/runs            历史扫描列表
GET /api/skill-scan/runs/{id}       单次扫描完整结果
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import date
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.config import get_settings
from app.database import get_db
from app.models.user import SkillScanRun, User, UserSkill
from app.ai.active_skill import ActiveSkill, aresolve_active_skill_for_user
from app.services.skill_screener import Candidate, ScreenerResult, run_scan

logger = logging.getLogger(__name__)
router = APIRouter()


# =============== request schema ===============


class ScanRequest(BaseModel):
    skill_ref: str | None = None  # 必须；'system:xxx' / 'user:42'
    universe: str  # 'hs300' / 'all' / 'industry:xxx' / 'theme:xxx' / 'watchlist'
    top_n: int = 30


# =============== utils ===============


def _sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


def _client() -> AsyncOpenAI:
    s = get_settings()
    return AsyncOpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url)


def _tier_from_score(score: float, max_score: float) -> str:
    if max_score <= 0:
        return "仅供参考"
    ratio = score / max_score
    if ratio >= 0.7:
        return "强烈推荐"
    if ratio >= 0.4:
        return "适合关注"
    return "仅供参考"


def _build_candidate_prompt(
    skill: ActiveSkill, candidate: Candidate
) -> tuple[str, str]:
    system = (
        f"你是基于「{skill.name}」体系的选股点评助手。"
        "用户的体系如下，请你严格按照该体系的逻辑判断这只股票。\n"
        f"\n体系正文:\n{(skill.body_markdown or '').strip()[:2500]}\n"
        "\n输出严格 JSON, 不要 markdown 代码块, schema:\n"
        "{\"reason\": \"≤80 字 体系视角点评 (引用具体数字)\", "
        "\"watchout\": \"≤30 字 风险点 (没有就给空串)\"}\n"
        "禁止套话、禁止编造数字。"
    )
    base = candidate.base_data or {}
    val = base.get("valuation") or {}
    fund = base.get("fundamentals") or {}
    factors = base.get("factors") or {}
    user = (
        f"股票: {candidate.name}({candidate.code}) 行业: {candidate.industry or '其他'}\n"
        f"评分: {candidate.score:.2f}\n"
        f"命中因子: {[h.get('label') for h in candidate.factor_hits]}\n"
        f"估值快照: PE-TTM={val.get('pe_ttm')} PB={val.get('pb')} "
        f"PE5年分位={val.get('pe_pct_5y_pct')}% 股息率={val.get('dv_ratio')}% "
        f"总市值={val.get('total_mv_yi')}亿\n"
        f"财务快照: ROE={fund.get('roe')}% 营收同比={fund.get('revenue_yoy')}% "
        f"净利同比={fund.get('net_profit_yoy')}% 3年平均ROE={fund.get('roe_3y_avg')}\n"
        f"技术快照: 收盘={factors.get('close')} MA20={factors.get('ma20')} "
        f"MA60={factors.get('ma60')} 多头排列={factors.get('ma_bull_arrangement')} "
        f"60日新高={factors.get('break_60_day_high')}\n"
    )
    return system, user


async def _llm_review_candidate(
    skill: ActiveSkill, candidate: Candidate, model_id: str
) -> dict[str, str]:
    """对单只股票跑一次 LLM 点评。失败时返回 fallback。"""
    system, user = _build_candidate_prompt(skill, candidate)
    try:
        client = _client()
        resp = await client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
            max_tokens=300,
        )
        text = (resp.choices[0].message.content or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json\n"):
                text = text[5:]
        parsed = json.loads(text)
        return {
            "reason": str(parsed.get("reason") or "")[:120],
            "watchout": str(parsed.get("watchout") or "")[:60],
        }
    except Exception as e:
        logger.warning("review candidate %s failed: %s", candidate.code, e)
        hits_label = "、".join(h.get("label") or h.get("factor", "") for h in candidate.factor_hits[:3])
        return {
            "reason": f"命中{hits_label or '若干因子'}，评分 {candidate.score:.2f}（LLM 解读失败，回退规则版）",
            "watchout": "",
        }


async def _llm_summary(
    skill: ActiveSkill, result: ScreenerResult, scored_candidates: list[dict]
) -> str:
    """整体小结：1 段 ≤ 100 字。"""
    s = get_settings()
    model_id = s.news_tag_model or s.openai_model or "deepseek-v3"
    system = (
        f"你是「{skill.name}」体系的选股扫描总结助手。"
        "给一段 ≤100 字的整体小结，必须出现：通过过滤的数量 / 平均评分 / 最值得关注的 1-2 只代码。"
        "禁止套话。"
    )
    head = scored_candidates[:5]
    user = (
        f"扫描范围: {result.universe} (universe size={result.universe_size})\n"
        f"硬过滤通过: {result.pre_filter_count} 只 → 取 top {result.final_count}\n"
        f"top 5 摘要: {[(c['code'], c['name'], c['score'], c.get('industry')) for c in head]}"
    )
    try:
        client = _client()
        resp = await client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.4,
            max_tokens=200,
        )
        return (resp.choices[0].message.content or "").strip()[:200]
    except Exception as e:
        logger.warning("summary failed: %s", e)
        return f"过滤通过 {result.pre_filter_count} 只，最终取 {result.final_count} 只候选。"


# =============== main scan endpoint ===============


@router.post("/run")
async def run_scan_endpoint(
    req: ScanRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """触发一次扫描（SSE 流式）。"""
    if not req.skill_ref:
        raise HTTPException(400, "skill_ref required (must explicitly choose a skill)")

    active_skill = await aresolve_active_skill_for_user(db, user.id, req.skill_ref)
    if not active_skill:
        raise HTTPException(400, "skill not found or unsupported ref")

    # 拿规则
    derived_rules: dict[str, Any] = {}
    if active_skill.source == "user":
        # 从 UserSkill 读最新 derived_rules（已包含用户校对版本）
        sid = int(req.skill_ref.split(":")[1])
        row = await db.get(UserSkill, sid)
        if row and row.derived_rules:
            derived_rules = row.derived_rules
    else:
        # 系统预设：derived_rules 暂未预抽，给一个保守默认（不过滤、不评分）
        # 让 LLM 解读阶段做主要的"判断"
        derived_rules = {"filters": {"exclude_st": True}, "scorers": []}

    universe = (req.universe or "").strip() or "hs300"
    top_n = max(5, min(50, int(req.top_n or 30)))

    # 创建 ScanRun 记录
    scan_run = SkillScanRun(
        user_id=user.id,
        skill_ref=req.skill_ref,
        skill_name_snapshot=active_skill.name[:80],
        universe=universe,
        top_n=top_n,
        rules_snapshot=derived_rules,
        status="running",
    )
    db.add(scan_run)
    await db.commit()
    await db.refresh(scan_run)
    scan_run_id = scan_run.id

    settings = get_settings()
    review_model = settings.news_tag_model or settings.openai_model or "deepseek-v3"

    async def event_stream() -> AsyncGenerator[str, None]:
        t0 = time.time()
        try:
            yield _sse("meta", {
                "scan_run_id": scan_run_id,
                "skill_ref": req.skill_ref,
                "skill_name": active_skill.name,
                "universe": universe,
                "top_n": top_n,
            })

            # screener 是 sync + 较重，丢线程
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                lambda: run_scan(user.id, derived_rules, universe, top_n, date.today()),
            )
            yield _sse("filter", {
                "universe_size": result.universe_size,
                "pre_filter_count": result.pre_filter_count,
                "final_count": result.final_count,
            })

            scored_candidates = [c.to_dict() for c in result.candidates]
            yield _sse("score", {"candidates": scored_candidates})

            if not result.candidates:
                # 立即结束
                from app.database import async_session as _SF
                async with _SF() as db2:
                    row = await db2.get(SkillScanRun, scan_run_id)
                    if row:
                        row.status = "done"
                        row.candidates = []
                        row.summary = "硬过滤后无候选，请放宽规则或扩大 universe"
                        row.pre_filter_count = result.pre_filter_count
                        row.final_count = 0
                        row.duration_ms = int((time.time() - t0) * 1000)
                        await db2.commit()
                yield _sse("summary", {"text": "硬过滤后无候选，请放宽规则或扩大 universe"})
                yield _sse("done", {"scan_run_id": scan_run_id})
                return

            # LLM 逐只点评——并行 5 只一组
            sem = asyncio.Semaphore(5)
            pending_buffer: list[tuple[int, dict]] = []
            review_map: dict[int, dict] = {}

            async def _review_one(idx: int, cand: Candidate) -> None:
                async with sem:
                    review = await _llm_review_candidate(active_skill, cand, review_model)
                    review_map[idx] = review
                    pending_buffer.append((idx, review))

            tasks = [
                asyncio.create_task(_review_one(i, c))
                for i, c in enumerate(result.candidates)
            ]

            seen = 0
            while seen < len(tasks):
                await asyncio.sleep(0.15)
                while pending_buffer:
                    idx, review = pending_buffer.pop(0)
                    cand = result.candidates[idx]
                    payload = {
                        "idx": idx,
                        "code": cand.code,
                        "name": cand.name,
                        "industry": cand.industry,
                        "score": round(cand.score, 3),
                        "factor_hits": cand.factor_hits,
                        "base_data": cand.base_data,
                        "review": review,
                    }
                    yield _sse("candidate", payload)
                    seen += 1
                if all(t.done() for t in tasks) and not pending_buffer:
                    break

            summary_text = await _llm_summary(active_skill, result, scored_candidates)
            yield _sse("summary", {"text": summary_text})

            # 收尾持久化
            from app.database import async_session as _SF
            max_score = max((c.score for c in result.candidates), default=0.0)
            full_candidates = []
            for idx, cand in enumerate(result.candidates):
                full_candidates.append({
                    "code": cand.code,
                    "name": cand.name,
                    "industry": cand.industry,
                    "score": round(cand.score, 3),
                    "factor_hits": cand.factor_hits,
                    "base_data": cand.base_data,
                    "review": review_map.get(idx, {}),
                    "tier": _tier_from_score(cand.score, max_score),
                })

            async with _SF() as db2:
                row = await db2.get(SkillScanRun, scan_run_id)
                if row:
                    row.status = "done"
                    row.candidates = full_candidates
                    row.summary = summary_text
                    row.pre_filter_count = result.pre_filter_count
                    row.final_count = len(full_candidates)
                    row.duration_ms = int((time.time() - t0) * 1000)
                    await db2.commit()

            yield _sse("done", {"scan_run_id": scan_run_id})

        except Exception as e:
            logger.exception("scan failed: %s", e)
            from app.database import async_session as _SF
            async with _SF() as db2:
                row = await db2.get(SkillScanRun, scan_run_id)
                if row:
                    row.status = "failed"
                    row.error = str(e)[:500]
                    row.duration_ms = int((time.time() - t0) * 1000)
                    await db2.commit()
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# =============== history ===============


@router.get("/runs")
async def list_runs(
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(SkillScanRun)
            .where(SkillScanRun.user_id == user.id)
            .order_by(SkillScanRun.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return {
        "items": [
            {
                "id": r.id,
                "skill_ref": r.skill_ref,
                "skill_name": r.skill_name_snapshot,
                "universe": r.universe,
                "top_n": r.top_n,
                "status": r.status,
                "pre_filter_count": r.pre_filter_count,
                "final_count": r.final_count,
                "duration_ms": r.duration_ms,
                "summary": r.summary,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


@router.get("/runs/{run_id}")
async def get_run(
    run_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(SkillScanRun, run_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "run not found")
    return {
        "id": row.id,
        "skill_ref": row.skill_ref,
        "skill_name": row.skill_name_snapshot,
        "universe": row.universe,
        "top_n": row.top_n,
        "status": row.status,
        "pre_filter_count": row.pre_filter_count,
        "final_count": row.final_count,
        "duration_ms": row.duration_ms,
        "rules_snapshot": row.rules_snapshot,
        "candidates": row.candidates,
        "summary": row.summary,
        "error": row.error,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
