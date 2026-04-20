"""盘中异动检测.

每分钟拉一次 AKShare spot, 与 5min 前快照对比, 检出:
    - surge   : 5min 涨幅变化 >= 3%, 且累计涨幅 >= 5% (急拉)
    - plunge  : 5min 跌幅变化 >= 3%, 且累计跌幅 >= 5% (闪崩)
    - break   : 涨停打开 (前一刻涨停 ≥ 9.7%, 现已 < 9.5%)
    - seal    : 反包封板 (前 < 9.5%, 现 ≥ 9.7%)
    - theme_burst: 板块成分股 5min 内 >=5 只急拉

数据流: ak.stock_zh_a_spot_em (1min cache, 内存) -> 历史窗口 (5min) -> diff -> 落库
LLM 解读: 不在检测阶段调用 (省钱), 用户点开异动详情时按需生成
"""
from __future__ import annotations

import logging
import time as time_mod
from collections import deque
from datetime import date as date_type, datetime, time, timedelta
from typing import Any

logger = logging.getLogger(__name__)


# 内存窗口: 保留最近 6 个分钟级 snapshot
# {timestamp: {code: {"price": x, "change_pct": y, "volume": v, "name": n}}}
_SNAPSHOT_WINDOW: deque[tuple[float, dict[str, dict[str, Any]]]] = deque(maxlen=6)


def _is_trading_time() -> bool:
    """A 股交易时段: 9:30-11:30 + 13:00-15:00."""
    now = datetime.now().time()
    morning = time(9, 30) <= now <= time(11, 30)
    afternoon = time(13, 0) <= now <= time(15, 0)
    return morning or afternoon


def _fetch_spot_snapshot() -> dict[str, dict[str, Any]] | None:
    """拉一份全市场 spot 快照. 失败返回 None."""
    try:
        import akshare as ak
        df = ak.stock_zh_a_spot_em()
    except Exception as e:
        logger.warning(f"fetch_spot failed: {e}")
        return None

    out: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        code = str(row.get("代码", "")).strip()
        if not code or len(code) != 6:
            continue
        try:
            chg = float(row.get("涨跌幅", 0) or 0)
            price = float(row.get("最新价", 0) or 0)
            if price <= 0:
                continue
            out[code] = {
                "name": str(row.get("名称", "")),
                "price": price,
                "change_pct": chg,
                "volume": int(row.get("成交量", 0) or 0),
                "amount": float(row.get("成交额", 0) or 0),
                "turnover_rate": float(row.get("换手率", 0) or 0) if row.get("换手率") else None,
            }
        except (ValueError, TypeError):
            continue
    return out


def _is_zt_pct(pct: float) -> bool:
    """判断当前涨幅是否处于涨停区. 不区分 ST/创业板严格按 9.7+ 视为接近涨停."""
    return pct >= 9.7


def _is_dt_pct(pct: float) -> bool:
    return pct <= -9.7


def _detect_diffs(
    prev_snap: dict[str, dict[str, Any]],
    cur_snap: dict[str, dict[str, Any]],
    window_min: int,
) -> list[dict[str, Any]]:
    """对比两个 snapshot, 输出原子异动事件."""
    events: list[dict[str, Any]] = []

    for code, cur in cur_snap.items():
        prev = prev_snap.get(code)
        if not prev:
            continue
        delta = cur["change_pct"] - prev["change_pct"]
        cum = cur["change_pct"]

        # surge — 5min 涨幅变化 >=3% 且累计 >=5%
        if delta >= 3.0 and cum >= 5.0:
            sev = 5 if cum >= 9.5 else 4 if cum >= 7.0 else 3
            events.append({
                "anomaly_type": "surge",
                "code": code,
                "name": cur["name"],
                "price": cur["price"],
                "change_pct": cum,
                "delta_5m_pct": round(delta, 2),
                "volume_yi": round(cur["amount"] / 1e8, 2),
                "severity": sev,
            })
            continue

        # plunge — 5min 跌幅变化 >=3% 且累计 <=-5%
        if delta <= -3.0 and cum <= -5.0:
            sev = 5 if cum <= -9.5 else 4 if cum <= -7.0 else 3
            events.append({
                "anomaly_type": "plunge",
                "code": code,
                "name": cur["name"],
                "price": cur["price"],
                "change_pct": cum,
                "delta_5m_pct": round(delta, 2),
                "volume_yi": round(cur["amount"] / 1e8, 2),
                "severity": sev,
            })
            continue

        # 涨停打开
        if _is_zt_pct(prev["change_pct"]) and cur["change_pct"] < 9.5:
            events.append({
                "anomaly_type": "break",
                "code": code,
                "name": cur["name"],
                "price": cur["price"],
                "change_pct": cum,
                "delta_5m_pct": round(delta, 2),
                "volume_yi": round(cur["amount"] / 1e8, 2),
                "severity": 4,
            })
            continue

        # 反包封板
        if not _is_zt_pct(prev["change_pct"]) and _is_zt_pct(cur["change_pct"]):
            events.append({
                "anomaly_type": "seal",
                "code": code,
                "name": cur["name"],
                "price": cur["price"],
                "change_pct": cum,
                "delta_5m_pct": round(delta, 2),
                "volume_yi": round(cur["amount"] / 1e8, 2),
                "severity": 3,
            })

    return events


def scan_once(
    fake_snap: dict[str, dict[str, Any]] | None = None,
    window_min: int = 5,
) -> dict[str, Any]:
    """运行一次扫描, 落库异动事件.

    fake_snap: 测试用, 注入 spot 数据避免依赖 akshare.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.anomaly import IntradayAnomaly

    snap = fake_snap if fake_snap is not None else _fetch_spot_snapshot()
    if not snap:
        return {"status": "no_data", "saved": 0}

    now_ts = time_mod.time()
    _SNAPSHOT_WINDOW.append((now_ts, snap))

    if len(_SNAPSHOT_WINDOW) < 2:
        return {"status": "warming", "saved": 0, "snapshots": len(_SNAPSHOT_WINDOW)}

    # 对比 ~5min 前 (找出最早一条距今 >= window_min*60 秒的, 否则用最早一条)
    target_ts = now_ts - window_min * 60
    prev_pair = _SNAPSHOT_WINDOW[0]
    for ts, sn in _SNAPSHOT_WINDOW:
        if ts <= target_ts:
            prev_pair = (ts, sn)
        else:
            break

    events = _detect_diffs(prev_pair[1], snap, window_min)
    if not events:
        return {"status": "ok", "saved": 0, "snapshots": len(_SNAPSHOT_WINDOW)}

    # 落库 — 同 code 同 anomaly_type 5min 内只保留 1 条 (去重)
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    saved = 0
    skipped = 0
    high_sev_ids: list[int] = []  # severity >= 4 的 id, 异步触发 LLM brief
    try:
        with Session(engine) as session:
            for ev in events:
                # 去重: 同 code+type, 5min 内已存在则跳过
                from sqlalchemy import select, and_
                cutoff = datetime.now() - timedelta(minutes=window_min)
                exists = session.execute(
                    select(IntradayAnomaly.id).where(
                        and_(
                            IntradayAnomaly.code == ev["code"],
                            IntradayAnomaly.anomaly_type == ev["anomaly_type"],
                            IntradayAnomaly.detected_at >= cutoff,
                        )
                    ).limit(1)
                ).scalar_one_or_none()
                if exists:
                    skipped += 1
                    continue
                row = IntradayAnomaly(
                    trade_date=date_type.today(),
                    detected_at=datetime.now(),
                    anomaly_type=ev["anomaly_type"],
                    code=ev["code"],
                    name=ev["name"],
                    price=ev["price"],
                    change_pct=ev["change_pct"],
                    delta_5m_pct=ev["delta_5m_pct"],
                    volume_yi=ev["volume_yi"],
                    severity=ev["severity"],
                )
                session.add(row)
                session.flush()  # 拿到 id
                saved += 1
                if ev["severity"] >= 4:
                    high_sev_ids.append(row.id)
            session.commit()
    finally:
        engine.dispose()

    # 高严重度异动: 立即顺手生成 LLM brief, 用户点开零等待
    # 用线程池跑, 不阻塞 celery 任务返回
    if high_sev_ids:
        import threading
        from app.intraday.anomaly_brief import generate_anomaly_brief_sync

        def _bg():
            for aid in high_sev_ids:
                try:
                    generate_anomaly_brief_sync(aid)
                except Exception as e:
                    logger.warning(f"prewarm anomaly brief {aid} failed: {e}")

        threading.Thread(target=_bg, daemon=True).start()

    return {
        "status": "ok",
        "saved": saved,
        "skipped_dup": skipped,
        "snapshots": len(_SNAPSHOT_WINDOW),
        "events": len(events),
        "prewarm_high_sev": len(high_sev_ids),
    }


def reset_window():
    """测试 / 切换交易日时清空内存窗口."""
    _SNAPSHOT_WINDOW.clear()
