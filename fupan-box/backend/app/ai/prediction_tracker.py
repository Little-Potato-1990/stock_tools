"""AI 预测落库 + T+N 校验 + 命中率统计.

闭环:  brief 生成 -> snapshot_predictions 落库 -> verify_pending T+N 校验 -> stats 统计

Sprint E.3: 把 AI 给出的判断, 留个底, 几天后回头看准不准, 形成自我进化.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import create_engine, select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.ai import AIPrediction
from app.models.snapshot import DailySnapshot
from app.models.stock import DailyQuote

logger = logging.getLogger(__name__)


_VERIFY_HORIZON = 3  # T+3 校验
_REGIME_BULL_LABELS = {"consensus": "拐点共振", "repair": "修复反弹"}
_REGIME_BEAR_LABELS = {"climax": "高潮退潮", "diverge": "分歧加大"}


def _engine():
    return create_engine(get_settings().database_url_sync)


def _next_n_trade_dates(session: Session, base: date, n: int) -> list[date]:
    """从 daily_quotes 取 base 之后的 n 个交易日."""
    rows = session.execute(
        select(DailyQuote.trade_date)
        .where(DailyQuote.trade_date > base)
        .group_by(DailyQuote.trade_date)
        .order_by(DailyQuote.trade_date)
        .limit(n)
    ).scalars().all()
    return list(rows)


def _index_change_after(session: Session, base: date, n: int) -> list[float]:
    """取大盘强弱 base 后 n 日, 用 overview.up_rate 归一化为 ±%.

    优先用真实指数涨跌, 缺失时回退到 up_rate (赚钱效应) 转换:
        up_rate=50 -> 0%, up_rate=80 -> +6%, up_rate=20 -> -6%
    """
    out: list[float] = []
    after_dates = _next_n_trade_dates(session, base, n)
    for td in after_dates:
        row = session.execute(
            select(DailySnapshot)
            .where(
                DailySnapshot.trade_date == td,
                DailySnapshot.snapshot_type == "overview",
            )
            .limit(1)
        ).scalar_one_or_none()
        if not row or not row.data:
            continue
        d = row.data
        sc = d.get("shanghai_change")
        if isinstance(sc, (int, float)):
            out.append(float(sc))
            continue
        ur = d.get("up_rate")
        if isinstance(ur, (int, float)):
            out.append((float(ur) - 50.0) / 5.0)
    return out


def _stock_changes_after(session: Session, code: str, base: date, n: int) -> list[float]:
    rows = session.execute(
        select(DailyQuote.trade_date, DailyQuote.change_pct)
        .where(DailyQuote.stock_code == code, DailyQuote.trade_date > base)
        .order_by(DailyQuote.trade_date)
        .limit(n)
    ).all()
    return [float(r.change_pct) for r in rows if r.change_pct is not None]


def snapshot_predictions(brief: dict[str, Any]) -> int:
    """把 brief 中的预测落库 (UPSERT). 返回新建 + 更新条数."""
    if not brief or not brief.get("trade_date"):
        return 0
    try:
        td = date.fromisoformat(brief["trade_date"])
    except Exception:
        return 0
    model = brief.get("model") or "unknown"

    rows: list[dict[str, Any]] = []

    if brief.get("regime"):
        rows.append({
            "trade_date": td,
            "model": model,
            "kind": "regime",
            "key": "_",
            "payload": {
                "regime": brief.get("regime"),
                "regime_label": brief.get("regime_label"),
                "tagline": brief.get("tagline"),
            },
        })

    sj = brief.get("similar_judgment") or {}
    if sj.get("tilt"):
        rows.append({
            "trade_date": td,
            "model": model,
            "kind": "tilt",
            "key": "_",
            "payload": {
                "tilt": sj.get("tilt"),
                "probability": sj.get("probability"),
                "key_risk": sj.get("key_risk"),
                "note": sj.get("note"),
            },
        })

    plan = brief.get("tomorrow_plan") or {}
    for kind in ("promotion", "first_board", "avoid"):
        items = plan.get(kind) or []
        for it in items[:8]:
            code = (it.get("code") or "").strip()
            if not code or len(code) != 6:
                continue
            rows.append({
                "trade_date": td,
                "model": model,
                "kind": kind,
                "key": code,
                "payload": {
                    "code": code,
                    "name": it.get("name"),
                    "reason": it.get("reason") or it.get("trigger") or "",
                    "trigger": it.get("trigger"),
                    "price": it.get("price"),
                },
            })

    if not rows:
        return 0

    eng = _engine()
    try:
        with Session(eng) as session:
            stmt = pg_insert(AIPrediction).values(rows)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_ai_pred",
                set_={"payload": stmt.excluded.payload, "model": stmt.excluded.model},
            )
            session.execute(stmt)
            session.commit()
            logger.info("ai_pred snapshot %d rows for %s", len(rows), td.isoformat())
            return len(rows)
    except Exception as e:
        logger.exception("snapshot_predictions failed: %s", e)
        return 0
    finally:
        eng.dispose()


def _judge_regime(payload: dict, idx_changes: list[float]) -> tuple[bool | None, float | None, dict]:
    """看大盘 next_3d 表现是否符合 regime 倾向."""
    if not idx_changes:
        return None, None, {"reason": "缺少校验日数据"}
    avg = sum(idx_changes) / len(idx_changes)
    regime = payload.get("regime")
    bull = regime in _REGIME_BULL_LABELS
    bear = regime in _REGIME_BEAR_LABELS
    hit: bool | None = None
    if bull:
        hit = avg > 0
    elif bear:
        hit = avg < 0
    score = max(-1.0, min(1.0, avg / 2.0))
    if not bull and avg < 0:
        score = -score
    return hit, score, {"avg_idx_change": round(avg, 3), "next_changes": idx_changes}


def _judge_tilt(payload: dict, idx_changes: list[float]) -> tuple[bool | None, float | None, dict]:
    """tilt: 延续 -> 同方向继续; 反转 -> 反向; 震荡 -> 振幅小."""
    if not idx_changes:
        return None, None, {"reason": "缺少校验日数据"}
    avg = sum(idx_changes) / len(idx_changes)
    abs_avg = sum(abs(x) for x in idx_changes) / len(idx_changes)
    tilt = payload.get("tilt")
    hit: bool | None = None
    if tilt == "延续":
        hit = abs(avg) > 0.3
    elif tilt == "反转":
        hit = (avg > 0.5) or (avg < -0.5)
    elif tilt == "震荡":
        hit = abs_avg < 0.8
    score = max(-1.0, min(1.0, abs(avg) / 2.0)) if hit else -0.3
    return hit, score, {"avg_idx_change": round(avg, 3), "abs_avg": round(abs_avg, 3)}


def _judge_promotion(payload: dict, stock_changes: list[float]) -> tuple[bool | None, float | None, dict]:
    """晋级候选: T+1 涨幅 >= 5% 算命中, T+1~T+3 累计 >= 10% 算超额命中."""
    if not stock_changes:
        return None, None, {"reason": "缺少行情"}
    t1 = stock_changes[0]
    cum = sum(stock_changes)
    hit = t1 >= 5.0
    score = max(-1.0, min(1.0, cum / 20.0))
    return hit, score, {"t1": t1, "cum_3d": round(cum, 2)}


def _judge_first_board(payload: dict, stock_changes: list[float]) -> tuple[bool | None, float | None, dict]:
    """首板低吸: T+1 ~ T+3 任一日涨幅 >= 9.8% 算命中."""
    if not stock_changes:
        return None, None, {"reason": "缺少行情"}
    max_chg = max(stock_changes)
    hit = max_chg >= 9.8
    cum = sum(stock_changes)
    score = max(-1.0, min(1.0, cum / 20.0))
    return hit, score, {"max_chg": round(max_chg, 2), "cum_3d": round(cum, 2)}


def _judge_avoid(payload: dict, stock_changes: list[float]) -> tuple[bool | None, float | None, dict]:
    """规避警告: T+1 ~ T+3 任一日跌幅 >= 5% 或累计 <= -5% 算命中 (确实该规避)."""
    if not stock_changes:
        return None, None, {"reason": "缺少行情"}
    cum = sum(stock_changes)
    min_chg = min(stock_changes)
    hit = (min_chg <= -5.0) or (cum <= -5.0)
    score = max(-1.0, min(1.0, -cum / 20.0))
    return hit, score, {"min_chg": round(min_chg, 2), "cum_3d": round(cum, 2)}


_JUDGE_BY_KIND = {
    "regime": _judge_regime,
    "tilt": _judge_tilt,
    "promotion": _judge_promotion,
    "first_board": _judge_first_board,
    "avoid": _judge_avoid,
}


def verify_pending(horizon: int = _VERIFY_HORIZON) -> dict[str, int]:
    """扫描 verified_at IS NULL 且 trade_date <= today-horizon 的预测, 跑 T+N 校验."""
    today = date.today()
    cutoff = today - timedelta(days=horizon)
    eng = _engine()
    counter = {"checked": 0, "hit": 0, "miss": 0, "skip": 0}
    try:
        with Session(eng) as session:
            pending = session.execute(
                select(AIPrediction)
                .where(
                    AIPrediction.verified_at.is_(None),
                    AIPrediction.trade_date <= cutoff,
                )
                .order_by(AIPrediction.trade_date)
                .limit(500)
            ).scalars().all()

            idx_cache: dict[date, list[float]] = {}
            for pred in pending:
                judge = _JUDGE_BY_KIND.get(pred.kind)
                if judge is None:
                    counter["skip"] += 1
                    continue
                if pred.kind in {"regime", "tilt"}:
                    if pred.trade_date not in idx_cache:
                        idx_cache[pred.trade_date] = _index_change_after(
                            session, pred.trade_date, horizon
                        )
                    series = idx_cache[pred.trade_date]
                else:
                    series = _stock_changes_after(
                        session, pred.key, pred.trade_date, horizon
                    )
                hit, score, vp = judge(pred.payload or {}, series)
                if hit is None:
                    counter["skip"] += 1
                    continue
                pred.hit = hit
                pred.score = score
                pred.verify_payload = vp
                pred.verified_at = datetime.now()
                counter["checked"] += 1
                if hit:
                    counter["hit"] += 1
                else:
                    counter["miss"] += 1
            session.commit()
    except Exception as e:
        logger.exception("verify_pending failed: %s", e)
    finally:
        eng.dispose()
    logger.info("ai_pred verify result: %s", counter)
    return counter


def run_diagnosis(days: int = 60) -> dict[str, Any]:
    """6 项策略诊断: 找出 AI 预测系统的薄弱环节, 驱动自我进化.

    1. hit_rate_trend    — 按 7 天窗口滑动, 看命中率趋势
    2. regime_failures   — 大盘势/tilt 预测失败案例聚合
    3. stock_bias        — 个股类预测 (promotion/first_board/avoid) 的系统性偏差
    4. high_conf_calibration — 高分预测 (score >= 0.5) vs 低分的命中率差异
    5. time_decay        — 按 trade_date 远近分段, 看命中率是否随时间衰减
    6. model_comparison  — 不同模型的命中率对比
    """
    cutoff = date.today() - timedelta(days=days)
    eng = _engine()
    try:
        with Session(eng) as session:
            verified = session.execute(
                select(AIPrediction).where(
                    AIPrediction.trade_date >= cutoff,
                    AIPrediction.verified_at.isnot(None),
                ).order_by(AIPrediction.trade_date)
            ).scalars().all()

            if not verified:
                return {
                    "window_days": days,
                    "total_verified": 0,
                    "items": {},
                    "summary": "数据不足, 无法进行策略诊断",
                }

            items: dict[str, Any] = {}

            # 1. hit_rate_trend: 7-day sliding windows
            items["hit_rate_trend"] = _diag_hit_rate_trend(verified)
            # 2. regime_failures
            items["regime_failures"] = _diag_regime_failures(verified)
            # 3. stock_bias
            items["stock_bias"] = _diag_stock_bias(verified)
            # 4. high_conf_calibration
            items["high_conf_calibration"] = _diag_calibration(verified)
            # 5. time_decay
            items["time_decay"] = _diag_time_decay(verified, cutoff)
            # 6. model_comparison
            items["model_comparison"] = _diag_model_comparison(verified)

            summary_parts = []
            trend = items["hit_rate_trend"]
            if len(trend) >= 2:
                first_rate = trend[0].get("hit_rate")
                last_rate = trend[-1].get("hit_rate")
                if first_rate is not None and last_rate is not None:
                    delta = last_rate - first_rate
                    if delta > 0.05:
                        summary_parts.append(f"命中率近期上升 {delta*100:+.0f}pp")
                    elif delta < -0.05:
                        summary_parts.append(f"命中率近期下降 {delta*100:+.0f}pp, 需关注")
                    else:
                        summary_parts.append("命中率近期持平")

            bias = items["stock_bias"]
            for kind, info in bias.items():
                rate = info.get("hit_rate")
                if rate is not None and rate < 0.25 and info.get("total", 0) >= 5:
                    label = {"promotion": "晋级", "first_board": "首板", "avoid": "规避"}.get(kind, kind)
                    summary_parts.append(f"{label}命中率偏低({rate*100:.0f}%)")

            cal = items["high_conf_calibration"]
            high_r = cal.get("high_score", {}).get("hit_rate")
            low_r = cal.get("low_score", {}).get("hit_rate")
            if high_r is not None and low_r is not None and high_r < low_r:
                summary_parts.append("高置信度预测反而不如低置信度, score 校准有问题")

            return {
                "window_days": days,
                "total_verified": len(verified),
                "items": items,
                "summary": "; ".join(summary_parts) if summary_parts else "各项指标正常, 暂无明显薄弱环节",
            }
    except Exception as e:
        logger.exception("run_diagnosis failed: %s", e)
        return {
            "window_days": days,
            "total_verified": 0,
            "items": {},
            "summary": f"诊断异常: {e}",
        }
    finally:
        eng.dispose()


def _diag_hit_rate_trend(preds: list[AIPrediction]) -> list[dict]:
    """按 7 天窗口聚合命中率."""
    if not preds:
        return []
    min_date = preds[0].trade_date
    max_date = preds[-1].trade_date
    windows: list[dict] = []
    cur = min_date
    while cur <= max_date:
        end = cur + timedelta(days=6)
        bucket = [p for p in preds if cur <= p.trade_date <= end]
        if bucket:
            hits = sum(1 for p in bucket if p.hit)
            windows.append({
                "start": cur.isoformat(),
                "end": min(end, max_date).isoformat(),
                "total": len(bucket),
                "hits": hits,
                "hit_rate": round(hits / len(bucket), 3),
            })
        cur = end + timedelta(days=1)
    return windows


def _diag_regime_failures(preds: list[AIPrediction]) -> list[dict]:
    """大盘势/tilt 预测失败案例."""
    failures = [
        p for p in preds
        if p.kind in ("regime", "tilt") and p.hit is False
    ]
    return [
        {
            "trade_date": p.trade_date.isoformat(),
            "kind": p.kind,
            "predicted": p.payload.get("regime") or p.payload.get("tilt"),
            "actual": p.verify_payload,
        }
        for p in failures[-10:]
    ]


def _diag_stock_bias(preds: list[AIPrediction]) -> dict[str, dict]:
    """个股类预测的命中率和平均得分."""
    stock_kinds = ("promotion", "first_board", "avoid")
    result: dict[str, dict] = {}
    for kind in stock_kinds:
        bucket = [p for p in preds if p.kind == kind]
        if not bucket:
            result[kind] = {"total": 0, "hits": 0, "hit_rate": None, "avg_score": None}
            continue
        hits = sum(1 for p in bucket if p.hit)
        scores = [p.score for p in bucket if p.score is not None]
        result[kind] = {
            "total": len(bucket),
            "hits": hits,
            "hit_rate": round(hits / len(bucket), 3),
            "avg_score": round(sum(scores) / len(scores), 3) if scores else None,
        }
    return result


def _diag_calibration(preds: list[AIPrediction]) -> dict[str, dict]:
    """高置信度 (|score| >= 0.5) vs 低置信度的命中率差异."""
    high = [p for p in preds if p.score is not None and abs(p.score) >= 0.5]
    low = [p for p in preds if p.score is not None and abs(p.score) < 0.5]

    def _bucket_stats(bucket: list) -> dict:
        if not bucket:
            return {"total": 0, "hits": 0, "hit_rate": None}
        hits = sum(1 for p in bucket if p.hit)
        return {
            "total": len(bucket),
            "hits": hits,
            "hit_rate": round(hits / len(bucket), 3),
        }

    return {
        "high_score": _bucket_stats(high),
        "low_score": _bucket_stats(low),
    }


def _diag_time_decay(preds: list[AIPrediction], cutoff: date) -> list[dict]:
    """按 trade_date 远近三等分, 看命中率是否衰减."""
    if len(preds) < 6:
        return []
    third = len(preds) // 3
    segments = [
        ("early", preds[:third]),
        ("middle", preds[third:2*third]),
        ("recent", preds[2*third:]),
    ]
    result = []
    for label, bucket in segments:
        if not bucket:
            continue
        hits = sum(1 for p in bucket if p.hit)
        result.append({
            "segment": label,
            "date_range": f"{bucket[0].trade_date.isoformat()} ~ {bucket[-1].trade_date.isoformat()}",
            "total": len(bucket),
            "hits": hits,
            "hit_rate": round(hits / len(bucket), 3),
        })
    return result


def _diag_model_comparison(preds: list[AIPrediction]) -> dict[str, dict]:
    """不同模型的命中率对比."""
    by_model: dict[str, list[AIPrediction]] = {}
    for p in preds:
        by_model.setdefault(p.model, []).append(p)
    result: dict[str, dict] = {}
    for model, bucket in by_model.items():
        hits = sum(1 for p in bucket if p.hit)
        result[model] = {
            "total": len(bucket),
            "hits": hits,
            "hit_rate": round(hits / len(bucket), 3),
        }
    return result


def get_stats(days: int = 30) -> dict[str, Any]:
    """命中率统计 (最近 N 天). 按 kind 聚合."""
    cutoff = date.today() - timedelta(days=days)
    eng = _engine()
    try:
        with Session(eng) as session:
            rows = session.execute(
                select(
                    AIPrediction.kind,
                    func.count(AIPrediction.id).label("total"),
                    func.sum(
                        func.cast(AIPrediction.verified_at.isnot(None), AIPrediction.id.type)
                    ).label("verified"),
                )
                .where(AIPrediction.trade_date >= cutoff)
                .group_by(AIPrediction.kind)
            ).all()

            hit_rows = session.execute(
                select(
                    AIPrediction.kind,
                    func.count(AIPrediction.id).label("hits"),
                    func.avg(AIPrediction.score).label("avg_score"),
                )
                .where(
                    AIPrediction.trade_date >= cutoff,
                    AIPrediction.hit.is_(True),
                )
                .group_by(AIPrediction.kind)
            ).all()

            verified_total = session.execute(
                select(func.count(AIPrediction.id))
                .where(
                    AIPrediction.trade_date >= cutoff,
                    AIPrediction.verified_at.isnot(None),
                )
            ).scalar() or 0

            hit_total = session.execute(
                select(func.count(AIPrediction.id))
                .where(
                    AIPrediction.trade_date >= cutoff,
                    AIPrediction.hit.is_(True),
                )
            ).scalar() or 0

            recent = session.execute(
                select(AIPrediction)
                .where(AIPrediction.trade_date >= cutoff)
                .order_by(AIPrediction.trade_date.desc(), AIPrediction.id.desc())
                .limit(50)
            ).scalars().all()

            by_kind: dict[str, dict[str, Any]] = {}
            for r in rows:
                by_kind[r.kind] = {
                    "total": int(r.total),
                    "verified": int(r.verified or 0),
                    "hits": 0,
                    "avg_score": None,
                }
            for r in hit_rows:
                if r.kind in by_kind:
                    by_kind[r.kind]["hits"] = int(r.hits)
                    by_kind[r.kind]["avg_score"] = (
                        round(float(r.avg_score), 3) if r.avg_score is not None else None
                    )

            for k, v in by_kind.items():
                v["hit_rate"] = (
                    round(v["hits"] / v["verified"], 3) if v["verified"] > 0 else None
                )

            return {
                "window_days": days,
                "from_date": cutoff.isoformat(),
                "to_date": date.today().isoformat(),
                "overall": {
                    "verified": verified_total,
                    "hits": hit_total,
                    "hit_rate": round(hit_total / verified_total, 3) if verified_total > 0 else None,
                },
                "by_kind": by_kind,
                "recent": [
                    {
                        "trade_date": p.trade_date.isoformat(),
                        "kind": p.kind,
                        "key": p.key,
                        "model": p.model,
                        "payload": p.payload,
                        "verify_payload": p.verify_payload,
                        "hit": p.hit,
                        "score": p.score,
                        "verified_at": p.verified_at.isoformat() if p.verified_at else None,
                    }
                    for p in recent
                ],
            }
    except Exception as e:
        logger.exception("get_stats failed: %s", e)
        return {
            "window_days": days,
            "from_date": cutoff.isoformat(),
            "to_date": date.today().isoformat(),
            "overall": {"verified": 0, "hits": 0, "hit_rate": None},
            "by_kind": {},
            "recent": [],
            "error": str(e),
        }
    finally:
        eng.dispose()
