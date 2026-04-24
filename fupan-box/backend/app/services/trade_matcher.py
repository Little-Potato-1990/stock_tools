"""Raw 成交单边流水 FIFO 配对 → UserTrade + 持仓反推核对.

核心责任:
    1. fifo_match_trades / materialize_trades: 把单边流水配成 round-trip
    2. _remaining_after_fifo: 模拟 FIFO 后剩余库存
    3. compute_reconciliation: 对比反推持仓 vs 截图持仓, 给每只股诊断 status
    4. inject_virtual_initial: 截图起点不全时, 注入 virtual_initial buy 兜底 (幂等)
    5. reconcile_and_repair: 端到端 = 配对 → 诊断 → 注入 → 重配对 → 终态报告
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time as dtime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import UserHolding, UserTrade, UserTradeRaw

logger = logging.getLogger(__name__)

_DEFAULT_TT = "09:30:00"
_VIRTUAL_SOURCE = "virtual_initial"


@dataclass
class _BuyLot:
    trade_date: date
    trade_time: str
    price: float
    qty_left: int
    raw_id: int


@dataclass
class _QEntry:
    date: date
    time: str
    price: float
    qty_left: int
    raw_id: int


def _parse_time(s: str | None) -> str:
    if not s or not str(s).strip():
        return _DEFAULT_TT
    t = str(s).strip()
    parts = t.split(":")
    if len(parts) == 2:
        t = f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:00"
    return t


def _to_dt(d: date, t: str) -> datetime:
    tt = _parse_time(t)
    h, m, s = (int(x) for x in tt.split(":")[:3])
    return datetime.combine(d, dtime(h, m, s))


def fifo_match_trades(raw_trades: list[UserTradeRaw]) -> list[dict[str, Any]]:
    """输入: 同代码、已按 trade_date / trade_time 升序的未配对 raw. 输出整笔 round-trip 列表。"""
    buy_queue: list[_QEntry] = []
    out: list[dict[str, Any]] = []
    for r in raw_trades:
        if r.matched_trade_id is not None:
            continue
        if r.side == "buy":
            buy_queue.append(
                _QEntry(
                    r.trade_date, r.trade_time or _DEFAULT_TT, r.price, r.qty, r.id
                )
            )
        elif r.side == "sell":
            need = r.qty
            avail = sum(x.qty_left for x in buy_queue)
            if avail < need:
                logger.debug(
                    "fifo: insufficient buy qty for sell raw_id=%s need=%s avail=%s",
                    r.id,
                    need,
                    avail,
                )
                continue
            acc_buy: list[tuple[int, float, int]] = []
            weighted = 0.0
            first_dt: datetime | None = None
            while need > 0 and buy_queue:
                front = buy_queue[0]
                take = min(need, front.qty_left)
                acc_buy.append((front.raw_id, front.price, take))
                weighted += take * front.price
                tdt = _to_dt(front.date, str(front.time))
                if first_dt is None or tdt < first_dt:
                    first_dt = tdt
                need -= take
                if take == front.qty_left:
                    buy_queue.pop(0)
                else:
                    buy_queue[0] = _QEntry(
                        front.date,
                        front.time,
                        front.price,
                        front.qty_left - take,
                        front.raw_id,
                    )
            if need > 0:
                continue
            qty = r.qty
            buy_price = weighted / qty if qty else 0.0
            sell_price = r.price
            pnl = (sell_price - buy_price) * qty
            pnl_pct = (pnl / (buy_price * qty) * 100) if (buy_price * qty) else 0.0
            sell_dt = _to_dt(r.trade_date, r.trade_time or "")
            hmin: int | None = None
            if first_dt is not None:
                hmin = int((sell_dt - first_dt).total_seconds() // 60)
            raw_buy_ids = [t[0] for t in acc_buy]
            out.append({
                "trade_date": r.trade_date,
                "code": r.stock_code,
                "name": r.stock_name,
                "buy_price": buy_price,
                "sell_price": sell_price,
                "qty": qty,
                "holding_minutes": hmin,
                "pnl": pnl,
                "pnl_pct": pnl_pct,
                "raw_buy_ids": raw_buy_ids,
                "raw_sell_ids": [r.id],
            })
    return out


def _remaining_after_fifo(
    raws: list[UserTradeRaw],
) -> dict[tuple[str, str], tuple[int, float | None]]:
    """全量流水模拟 FIFO, 得到 (code, account_label) -> (剩余数量, 剩余均价)."""
    by_key: dict[tuple[str, str], list[UserTradeRaw]] = {}
    for r in raws:
        k = (r.stock_code, r.account_label)
        by_key.setdefault(k, []).append(r)
    out: dict[tuple[str, str], tuple[int, float | None]] = {}
    for k, rows in by_key.items():
        rows = sorted(
            rows,
            key=lambda x: (x.trade_date, _parse_time(x.trade_time), x.id),
        )
        q: list[_BuyLot] = []
        for r in rows:
            if r.side == "buy":
                q.append(
                    _BuyLot(
                        r.trade_date, r.trade_time or _DEFAULT_TT, r.price, r.qty, r.id
                    )
                )
            elif r.side == "sell":
                need = r.qty
                avail = sum(x.qty_left for x in q)
                if avail < need:
                    need = 0
                    continue
                while need > 0 and q:
                    front = q[0]
                    take = min(need, front.qty_left)
                    need -= take
                    if take == front.qty_left:
                        q.pop(0)
                    else:
                        q[0] = _BuyLot(
                            front.trade_date,
                            front.trade_time,
                            front.price,
                            front.qty_left - take,
                            front.raw_id,
                        )
        rem_qty = sum(x.qty_left for x in q)
        w = sum(x.qty_left * x.price for x in q)
        rem_avg = (w / rem_qty) if rem_qty else None
        out[k] = (rem_qty, rem_avg)
    return out


async def materialize_trades(db: AsyncSession, user_id: int) -> dict[str, Any]:
    res = await db.execute(
        select(UserTradeRaw)
        .where(
            UserTradeRaw.user_id == user_id,
            UserTradeRaw.matched_trade_id.is_(None),
        )
        .order_by(UserTradeRaw.trade_date, UserTradeRaw.trade_time, UserTradeRaw.id)
    )
    rows = list(res.scalars().all())
    by_code: dict[str, list[UserTradeRaw]] = {}
    for r in rows:
        by_code.setdefault(r.stock_code, []).append(r)
    new_trades = 0
    for code, rlist in by_code.items():
        pairs = fifo_match_trades(rlist)
        for p in pairs:
            ut = UserTrade(
                user_id=user_id,
                trade_date=p["trade_date"],
                code=code,
                name=p.get("name"),
                buy_price=p["buy_price"],
                sell_price=p["sell_price"],
                qty=p["qty"],
                intraday_chg_at_buy=None,
                holding_minutes=p.get("holding_minutes"),
                reason="auto-paired",
                pnl=p["pnl"],
                pnl_pct=p["pnl_pct"],
            )
            db.add(ut)
            await db.flush()
            tid = ut.id
            for rid in p["raw_buy_ids"] + p["raw_sell_ids"]:
                r2 = next((x for x in rlist if x.id == rid), None)
                if r2 is not None and r2.matched_trade_id is None:
                    r2.matched_trade_id = tid
            new_trades += 1
    await db.commit()
    return {"user_id": user_id, "new_round_trips": new_trades}


async def reconcile_holdings_from_trades(
    db: AsyncSession, user_id: int
) -> dict[str, Any]:
    """旧版纯诊断接口, 保留兼容. 新代码请用 compute_reconciliation."""
    res = await db.execute(
        select(UserTradeRaw)
        .where(UserTradeRaw.user_id == user_id)
        .order_by(UserTradeRaw.trade_date, UserTradeRaw.trade_time, UserTradeRaw.id)
    )
    all_raw = list(res.scalars().all())
    implied = _remaining_after_fifo(all_raw)

    h_res = await db.execute(select(UserHolding).where(UserHolding.user_id == user_id))
    holdings = list(h_res.scalars().all())
    warnings: list[str] = []
    h_by_key: dict[tuple[str, str], UserHolding] = {}
    for h in holdings:
        h_by_key[(h.stock_code, h.account_label)] = h
    for (code, alabel), (iqty, iavg) in implied.items():
        key = (code, alabel)
        h = h_by_key.get(key)
        if not h and iqty > 0:
            warnings.append(
                f"反推有持仓 {code}@{alabel} qty={iqty} avg≈{iavg} 但 user_holdings 无记录"
            )
        elif h:
            if h.qty != iqty:
                warnings.append(
                    f"数量不一致: {code}@{alabel} 截图/持仓表={h.qty} 流水反推={iqty}"
                )
            if iavg is not None and h.avg_cost is not None:
                if iqty > 0 and abs(iavg - h.avg_cost) > 0.02 * (h.avg_cost or 1) + 0.5:
                    warnings.append(
                        f"成本差异(参考): {code}@{alabel} 表={h.avg_cost} 反推≈{iavg}"
                    )
    for h in holdings:
        key = (h.stock_code, h.account_label)
        if key not in implied and h.qty > 0:
            warnings.append(
                f"有持仓 {h.stock_code}@{h.account_label} qty={h.qty} 但流水反推为 0"
            )
    implied_out = {
        f"{c}|{a}": {"qty": v[0], "avg_cost": v[1]}
        for (c, a), v in implied.items()
    }
    return {"user_id": user_id, "implied": implied_out, "warnings": warnings}


# === Reconcile + Virtual Initial 升级版 (解决用户截图起点不全的问题) ===


def _net_change_after_cutoff(
    raws: list[UserTradeRaw], cutoff_inclusive: date
) -> dict[tuple[str, str], int]:
    """对每只 (code, account) 计算 cutoff_inclusive 当天及之后的 net = sum(buy.qty) - sum(sell.qty).

    用来反推 cutoff 之前应有的初始库存:
        needed_initial = ground_truth_qty - net_change_after_cutoff
    跳过 source=virtual_initial 的行 (避免循环).
    """
    out: dict[tuple[str, str], int] = {}
    for r in raws:
        if r.source == _VIRTUAL_SOURCE:
            continue
        if r.trade_date < cutoff_inclusive:
            continue
        k = (r.stock_code, r.account_label)
        delta = r.qty if r.side == "buy" else -r.qty
        out[k] = out.get(k, 0) + delta
    return out


def _earliest_real_date(
    raws: list[UserTradeRaw], code: str, account: str
) -> date | None:
    """该股票在 raw 表里最早的【真实】(非 virtual) 成交日期."""
    earliest: date | None = None
    for r in raws:
        if r.source == _VIRTUAL_SOURCE:
            continue
        if r.stock_code != code or r.account_label != account:
            continue
        if earliest is None or r.trade_date < earliest:
            earliest = r.trade_date
    return earliest


def _latest_real_date(
    raws: list[UserTradeRaw], code: str, account: str
) -> date | None:
    """该股票在 raw 表里最近一笔【真实】(非 virtual) 成交日期."""
    latest: date | None = None
    for r in raws:
        if r.source == _VIRTUAL_SOURCE:
            continue
        if r.stock_code != code or r.account_label != account:
            continue
        if latest is None or r.trade_date > latest:
            latest = r.trade_date
    return latest


def _detect_mid_gaps(
    raws: list[UserTradeRaw],
    code: str,
    account: str,
    threshold_days: int = 30,
) -> list[dict[str, Any]]:
    """检测某只股的真实成交序列里, 是否存在 >threshold_days 的连续无成交段.

    返回每段缺口: {"from": date, "to": date, "gap_days": N}
    用于提示用户"中间漏传了一段历史"——如果该缺口在用户实际有交易的时间窗内,
    qty 反推可能是错的; 如果该段确实没操作, 可以忽略.
    """
    dates = sorted({
        r.trade_date for r in raws
        if r.source != _VIRTUAL_SOURCE
        and r.stock_code == code
        and r.account_label == account
    })
    if len(dates) < 2:
        return []
    gaps: list[dict[str, Any]] = []
    for i in range(1, len(dates)):
        delta = (dates[i] - dates[i - 1]).days
        if delta > threshold_days:
            gaps.append({
                "from": dates[i - 1].isoformat(),
                "to": dates[i].isoformat(),
                "gap_days": delta - 1,  # 中间空白的天数 (不含前后两笔当天)
            })
    return gaps


def _coverage_summary(raws: list[UserTradeRaw]) -> dict[str, Any]:
    """整体 raw 表的真实成交时间覆盖统计 (跨所有股)."""
    real_dates = [r.trade_date for r in raws if r.source != _VIRTUAL_SOURCE]
    real_count = len(real_dates)
    if real_count == 0:
        return {
            "earliest_real_date": None,
            "latest_real_date": None,
            "span_days": 0,
            "real_trade_count": 0,
            "virtual_count": sum(1 for r in raws if r.source == _VIRTUAL_SOURCE),
        }
    earliest = min(real_dates)
    latest = max(real_dates)
    return {
        "earliest_real_date": earliest.isoformat(),
        "latest_real_date": latest.isoformat(),
        "span_days": (latest - earliest).days + 1,
        "real_trade_count": real_count,
        "virtual_count": sum(1 for r in raws if r.source == _VIRTUAL_SOURCE),
    }


async def compute_reconciliation(
    db: AsyncSession, user_id: int
) -> dict[str, Any]:
    """对每只持仓股诊断状态, 返回结构化结果.

    per-stock status:
        - "ok"                   流水反推 = 截图持仓
        - "gap_before_cutoff"    截图起点之前已有底仓 (反推 < 截图), 可注入 virtual_initial 修复
        - "no_raw_history"       raw 完全无该股流水, 全部底仓需注入 virtual_initial
        - "excess_in_raw"        反推 > 截图, 用户漏传了 sell 截图, 需补传
        - "implied_no_holding"   流水反推有库存但持仓表无该股, 用户漏传了 sell 或 holdings 截图
    """
    res = await db.execute(
        select(UserTradeRaw)
        .where(UserTradeRaw.user_id == user_id)
        .order_by(UserTradeRaw.trade_date, UserTradeRaw.trade_time, UserTradeRaw.id)
    )
    all_raw = list(res.scalars().all())
    implied = _remaining_after_fifo(all_raw)

    h_res = await db.execute(select(UserHolding).where(UserHolding.user_id == user_id))
    holdings = list(h_res.scalars().all())
    h_by_key: dict[tuple[str, str], UserHolding] = {
        (h.stock_code, h.account_label): h for h in holdings
    }

    keys = set(h_by_key.keys()) | set(implied.keys())
    per_stock: list[dict[str, Any]] = []
    repair_plans: list[dict[str, Any]] = []

    for key in sorted(keys):
        code, account = key
        h = h_by_key.get(key)
        iqty, iavg = implied.get(key, (0, None))
        ground = h.qty if h else 0
        name = h.stock_name if h else None
        avg_cost = h.avg_cost if h else None
        earliest_real = _earliest_real_date(all_raw, code, account)
        latest_real = _latest_real_date(all_raw, code, account)
        coverage_days = (
            (latest_real - earliest_real).days + 1
            if (earliest_real and latest_real) else 0
        )
        mid_gaps = _detect_mid_gaps(all_raw, code, account, threshold_days=30)

        if not h and iqty > 0:
            status = "implied_no_holding"
            gap = 0
            note = (
                f"流水反推剩 {iqty} 股但持仓表无该股, 可能漏传了 sell 截图 "
                f"或 holdings 截图未涵盖此股"
            )
        elif h and iqty > h.qty:
            status = "excess_in_raw"
            gap = iqty - h.qty
            note = (
                f"流水反推 {iqty} 股 > 截图持仓 {h.qty} 股, 多 {gap} 股, "
                f"可能漏传了 {gap} 股的 sell 截图"
            )
        elif h and iqty < h.qty:
            gap = h.qty - iqty
            if iqty == 0 and earliest_real is None:
                status = "no_raw_history"
                note = f"raw 表完全无该股流水, 截图持仓 {h.qty} 股, 将注入 virtual_initial 兜底"
            else:
                status = "gap_before_cutoff"
                # 文案分支: 如果检测到中间缺口, 提示用户可能漏传中段, 而非"起点不全"
                if mid_gaps:
                    largest = max(mid_gaps, key=lambda g: g["gap_days"])
                    note = (
                        f"截图起点之前已有底仓 {gap} 股 (反推 {iqty}, 持仓 {h.qty}), "
                        f"已注入 virtual_initial 兜底。"
                        f"⚠ 同时检测到 {largest['from']} → {largest['to']} 有 {largest['gap_days']} 天无成交"
                        f"——若这段时间你有交易, 请补传该区间截图; 若无操作可忽略。"
                    )
                else:
                    note = (
                        f"截图起点之前已有底仓 {gap} 股 (反推 {iqty}, 持仓 {h.qty}), "
                        f"已注入 virtual_initial 兜底 (这是合理场景: 你只想从 {earliest_real} 开始分析)"
                    )
            inject_date = (earliest_real - timedelta(days=1)) if earliest_real else date.today()
            repair_plans.append({
                "code": code,
                "account_label": account,
                "name": name,
                "qty": gap,
                "price": avg_cost,
                "trade_date": inject_date,
            })
        elif h and iqty == h.qty:
            status = "ok"
            gap = 0
            base = f"数据完整: 流水反推 = 截图持仓 = {h.qty} 股"
            if earliest_real and latest_real:
                base += f" (覆盖 {earliest_real} → {latest_real}, 共 {coverage_days} 天)"
            if mid_gaps:
                largest = max(mid_gaps, key=lambda g: g["gap_days"])
                base += (
                    f" ⚠ 中间 {largest['from']} → {largest['to']} 有 {largest['gap_days']} 天无成交, "
                    f"若该段有交易请补传截图"
                )
            note = base
        else:
            status = "ok"
            gap = 0
            note = "持仓与流水均为空"

        per_stock.append({
            "code": code,
            "name": name,
            "account_label": account,
            "ground_truth_qty": ground,
            "implied_qty": iqty,
            "implied_avg_cost": round(iavg, 4) if iavg is not None else None,
            "screen_avg_cost": avg_cost,
            "earliest_real_date": earliest_real.isoformat() if earliest_real else None,
            "latest_real_date": latest_real.isoformat() if latest_real else None,
            "coverage_days": coverage_days,
            "mid_gaps": mid_gaps,
            "status": status,
            "gap_qty": gap,
            "note": note,
        })

    summary = {
        "ok": sum(1 for s in per_stock if s["status"] == "ok"),
        "gap_before_cutoff": sum(1 for s in per_stock if s["status"] == "gap_before_cutoff"),
        "no_raw_history": sum(1 for s in per_stock if s["status"] == "no_raw_history"),
        "excess_in_raw": sum(1 for s in per_stock if s["status"] == "excess_in_raw"),
        "implied_no_holding": sum(1 for s in per_stock if s["status"] == "implied_no_holding"),
        "with_mid_gaps": sum(1 for s in per_stock if s.get("mid_gaps")),
    }
    coverage = _coverage_summary(all_raw)
    return {
        "user_id": user_id,
        "per_stock": per_stock,
        "summary": summary,
        "repair_plans": repair_plans,
        "coverage": coverage,
    }


async def inject_virtual_initial(
    db: AsyncSession, user_id: int, plans: list[dict[str, Any]]
) -> dict[str, Any]:
    """根据 repair_plans 注入 virtual_initial buy 行 (幂等).

    contract_no 用 'virtual:initial:{user}:{code}:{account}' 唯一前缀,
    重复调用同股 contract_no 一致 → 被 ux_trades_raw_contract 唯一约束拦截不会重复.
    """
    injected = 0
    skipped_existing = 0
    for p in plans:
        code = str(p["code"])
        account = str(p.get("account_label") or "default")
        qty = int(p.get("qty") or 0)
        if qty <= 0:
            continue
        price = p.get("price")
        if price is None or float(price) <= 0:
            # 没有 avg_cost 时不注入 (无法确定虚拟买入价), 留给用户手动补
            continue
        trade_date = p.get("trade_date")
        if not isinstance(trade_date, date):
            try:
                trade_date = date.fromisoformat(str(trade_date))
            except (TypeError, ValueError):
                trade_date = date.today()
        cno = f"virtual:initial:{user_id}:{code}:{account}"
        # 先查是否已存在 (幂等)
        existing = (await db.execute(
            select(UserTradeRaw).where(
                UserTradeRaw.user_id == user_id,
                UserTradeRaw.contract_no == cno,
            )
        )).scalar_one_or_none()
        if existing is not None:
            # 数量变化时, 更新现有行 (用户后续补传更早截图后, 缺口可能变小)
            if existing.qty != qty or abs((existing.price or 0) - float(price)) > 1e-6:
                existing.qty = qty
                existing.price = float(price)
                existing.trade_date = trade_date
                existing.matched_trade_id = None  # 让 FIFO 重新配对
                injected += 1
            else:
                skipped_existing += 1
            continue
        v = UserTradeRaw(
            user_id=user_id,
            trade_date=trade_date,
            trade_time="09:30:00",
            stock_code=code,
            stock_name=p.get("name"),
            side="buy",
            price=float(price),
            qty=qty,
            amount=float(price) * qty,
            fee=0.0,
            stamp_tax=0.0,
            transfer_fee=0.0,
            contract_no=cno,
            account_label=account,
            source=_VIRTUAL_SOURCE,
        )
        db.add(v)
        injected += 1
    await db.commit()
    return {"injected": injected, "skipped_existing": skipped_existing}


async def reconcile_and_repair(
    db: AsyncSession, user_id: int
) -> dict[str, Any]:
    """端到端: 清理旧 virtual → 配对 → 诊断 → 注入新 virtual → 重配对 → 终态报告.

    每次都先清空旧 virtual_initial 再重新计算缺口, 这样补传截图后 virtual 数量
    会自动收敛 (例: 第一次注入 300 → 用户补传更早截图 → 真实缺口变 100 → 自动调整).

    返回结构:
        {
            "before": {summary, per_stock},     # 清理 virtual + 注入前状态
            "after":  {summary, per_stock},     # 注入后终态
            "injected": {injected, skipped_existing},
            "round_trips_total": N              # user_trades 表当前总数
        }
    """
    # 0. 清理上一轮注入的 virtual_initial (让 reconcile 基于纯真实流水诊断)
    #    用 SQL 直接清: 先把所有引用了 virtual 的 round-trip 解绑, 再删 virtual raw 行
    #    更简单: 删 user_trades 全集 + 重置 raw.matched_trade_id, 然后删 virtual raw
    raw_q = await db.execute(
        select(UserTradeRaw).where(UserTradeRaw.user_id == user_id)
    )
    for r in raw_q.scalars().all():
        r.matched_trade_id = None
    await db.flush()
    await db.execute(
        UserTrade.__table__.delete().where(UserTrade.user_id == user_id)
    )
    await db.execute(
        UserTradeRaw.__table__.delete().where(
            (UserTradeRaw.user_id == user_id)
            & (UserTradeRaw.source == _VIRTUAL_SOURCE)
        )
    )
    await db.commit()

    # 1. 跑一次 FIFO 配对 (基于真实流水, 缺口部分的 sell 会被跳过)
    await materialize_trades(db, user_id)

    # 2. 诊断 (此时不含 virtual)
    before = await compute_reconciliation(db, user_id)
    plans = before.get("repair_plans") or []

    # 3. 注入 virtual_initial (有缺口才注入)
    inject_result = {"injected": 0, "skipped_existing": 0}
    if plans:
        # 注入前先重置受影响股的配对状态, 让 FIFO 能重新计算 (含 virtual buy)
        # 顺序: 先把 raw 的 matched_trade_id 置空 (FK 指向 user_trades.id), 再 delete user_trades
        affected_codes = [str(p["code"]) for p in plans]
        raw_q = await db.execute(
            select(UserTradeRaw).where(
                UserTradeRaw.user_id == user_id,
                UserTradeRaw.stock_code.in_(affected_codes),
            )
        )
        for r in raw_q.scalars().all():
            r.matched_trade_id = None
        await db.flush()
        existing_trades_q = await db.execute(
            select(UserTrade).where(
                UserTrade.user_id == user_id,
                UserTrade.code.in_(affected_codes),
            )
        )
        for t in existing_trades_q.scalars().all():
            await db.delete(t)
        await db.commit()

        inject_result = await inject_virtual_initial(db, user_id, plans)

        # 4. 注入完重跑 FIFO
        await materialize_trades(db, user_id)

    # 5. 终态诊断
    after = await compute_reconciliation(db, user_id)

    # round-trip 总数
    rt_count = (await db.execute(
        select(UserTrade).where(UserTrade.user_id == user_id)
    )).scalars().all()

    return {
        "user_id": user_id,
        "before": {
            "summary": before["summary"],
            "per_stock": before["per_stock"],
            "coverage": before.get("coverage"),
        },
        "after": {
            "summary": after["summary"],
            "per_stock": after["per_stock"],
            "coverage": after.get("coverage"),
        },
        "injected": inject_result,
        "round_trips_total": len(rt_count),
    }
