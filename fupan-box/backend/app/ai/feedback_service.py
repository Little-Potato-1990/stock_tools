"""AI brief 反馈服务 — P3-C 反馈闭环.

- record_feedback: 写一条 (user, kind, trade_date, rating)
- get_feedback_stats: 按 kind 聚合最近 N 天的 thumb up/down + evidence 正确率
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.ai import AIBriefFeedback

logger = logging.getLogger(__name__)


_VALID_KINDS = {
    "today", "sentiment", "theme", "ladder", "lhb", "news",
    "capital", "institutional",
}


def _engine():
    return create_engine(get_settings().database_url_sync)


def record_feedback(
    *,
    user_id: int | None,
    brief_kind: str,
    trade_date: date,
    rating: int,
    model: str | None = None,
    reason: str | None = None,
    evidence_correct: bool | None = None,
    snapshot: dict | None = None,
) -> dict[str, Any]:
    if brief_kind not in _VALID_KINDS:
        return {"ok": False, "error": f"unknown brief_kind: {brief_kind}"}
    if rating not in (1, -1):
        return {"ok": False, "error": "rating must be 1 or -1"}

    engine = _engine()
    try:
        with Session(engine) as s:
            row = AIBriefFeedback(
                user_id=user_id,
                brief_kind=brief_kind,
                trade_date=trade_date,
                model=(model or "")[:50] or None,
                rating=int(rating),
                reason=(reason or "")[:500] or None,
                evidence_correct=evidence_correct,
                snapshot=snapshot,
            )
            s.add(row)
            s.commit()
            s.refresh(row)
            return {"ok": True, "id": row.id, "created_at": row.created_at.isoformat()}
    except Exception as e:
        logger.exception("record_feedback failed: %s", e)
        return {"ok": False, "error": str(e)}
    finally:
        engine.dispose()


def get_feedback_stats(days: int = 30) -> dict[str, Any]:
    """按 brief_kind 聚合 thumb up/down + evidence 正确率."""
    cutoff = datetime.now() - timedelta(days=days)
    engine = _engine()
    try:
        with Session(engine) as s:
            rows = s.execute(
                select(
                    AIBriefFeedback.brief_kind,
                    AIBriefFeedback.rating,
                    AIBriefFeedback.evidence_correct,
                    AIBriefFeedback.created_at,
                    AIBriefFeedback.reason,
                    AIBriefFeedback.trade_date,
                    AIBriefFeedback.model,
                    AIBriefFeedback.snapshot,
                )
                .where(AIBriefFeedback.created_at >= cutoff)
                .order_by(AIBriefFeedback.created_at.desc())
                .limit(200)
            ).all()

            kinds: dict[str, dict[str, Any]] = {}
            recent: list[dict[str, Any]] = []
            for r in rows:
                k = r.brief_kind
                bucket = kinds.setdefault(
                    k, {"up": 0, "down": 0, "evidence_yes": 0, "evidence_no": 0, "total": 0}
                )
                bucket["total"] += 1
                if r.rating == 1:
                    bucket["up"] += 1
                else:
                    bucket["down"] += 1
                if r.evidence_correct is True:
                    bucket["evidence_yes"] += 1
                elif r.evidence_correct is False:
                    bucket["evidence_no"] += 1

                if len(recent) < 60:
                    recent.append({
                        "kind": k,
                        "rating": int(r.rating),
                        "trade_date": r.trade_date.isoformat() if r.trade_date else None,
                        "model": r.model,
                        "reason": r.reason,
                        "evidence_correct": r.evidence_correct,
                        "headline": (r.snapshot or {}).get("headline") if isinstance(r.snapshot, dict) else None,
                        "created_at": r.created_at.isoformat(),
                    })

            for v in kinds.values():
                tot = v["total"] or 1
                v["up_rate"] = round(v["up"] / tot, 3)
                ev_tot = v["evidence_yes"] + v["evidence_no"]
                v["evidence_correct_rate"] = round(v["evidence_yes"] / ev_tot, 3) if ev_tot else None

            overall_total = sum(v["total"] for v in kinds.values())
            overall_up = sum(v["up"] for v in kinds.values())
            overall_ev_yes = sum(v["evidence_yes"] for v in kinds.values())
            overall_ev_no = sum(v["evidence_no"] for v in kinds.values())
            overall = {
                "total": overall_total,
                "up": overall_up,
                "down": sum(v["down"] for v in kinds.values()),
                "up_rate": round(overall_up / overall_total, 3) if overall_total else None,
                "evidence_correct_rate": round(
                    overall_ev_yes / (overall_ev_yes + overall_ev_no), 3
                ) if (overall_ev_yes + overall_ev_no) else None,
            }

            return {"days": days, "by_kind": kinds, "overall": overall, "recent": recent}
    except Exception as e:
        logger.exception("get_feedback_stats failed: %s", e)
        return {"days": days, "by_kind": {}, "overall": {}, "recent": [], "error": str(e)}
    finally:
        engine.dispose()
