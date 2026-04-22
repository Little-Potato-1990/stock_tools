"""技术因子现算工具——给 skill_screener 用。

设计要点:
1. 输入是一组股票代码 + trade_date，从 daily_quotes 一次性拉最近 ~270 个交易日的窗口；
2. 用 pandas DataFrame 向量化算 MA20 / MA60 / MA250 / 近 N 日新高 / 近 N 日涨幅；
3. 每个 compute 函数返回 dict[code, value]，screener 自己组合。
4. 没有历史数据的股票（次新股、停牌） 该因子返回 None，不命中。
"""
from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.stock import DailyQuote

logger = logging.getLogger(__name__)


# 拉数据的"足够长"窗口：MA250 需要至少 250 个交易日，留余量到 280
WINDOW_DAYS = 280


@dataclass
class FactorBundle:
    """单只股票的全套技术因子计算结果。"""
    code: str
    close: float | None = None
    ma20: float | None = None
    ma60: float | None = None
    ma250: float | None = None
    high_60d: float | None = None
    pct_5d: float | None = None
    pct_20d: float | None = None
    pct_60d: float | None = None

    @property
    def above_ma60(self) -> bool | None:
        if self.close is None or self.ma60 is None:
            return None
        return self.close > self.ma60

    @property
    def ma_bull_arrangement(self) -> bool | None:
        if None in (self.ma20, self.ma60, self.ma250):
            return None
        return self.ma20 > self.ma60 > self.ma250

    @property
    def break_60_day_high(self) -> bool | None:
        if self.close is None or self.high_60d is None:
            return None
        # 收盘 ≥ 60 日内最高 (含今天) 视为新高
        return self.close >= self.high_60d * 0.999

    @property
    def pullback_to_ma20(self) -> bool | None:
        """收盘价距 MA20 不超过 ±2%，且站在 MA20 之上则视为回踩。"""
        if self.close is None or self.ma20 is None or self.ma20 == 0:
            return None
        gap = (self.close - self.ma20) / self.ma20
        return -0.02 <= gap <= 0.02 and self.close >= self.ma20

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "close": self.close,
            "ma20": self.ma20,
            "ma60": self.ma60,
            "ma250": self.ma250,
            "high_60d": self.high_60d,
            "pct_5d": self.pct_5d,
            "pct_20d": self.pct_20d,
            "pct_60d": self.pct_60d,
            "above_ma60": self.above_ma60,
            "ma_bull_arrangement": self.ma_bull_arrangement,
            "break_60_day_high": self.break_60_day_high,
            "pullback_to_ma20": self.pullback_to_ma20,
        }


def compute_factors(
    session: Session,
    codes: Iterable[str],
    trade_date: date,
) -> dict[str, FactorBundle]:
    """批量计算技术因子。返回 {code: FactorBundle}。"""
    code_list = sorted({(c or "").strip() for c in codes if c})
    if not code_list:
        return {}

    start = trade_date - timedelta(days=int(WINDOW_DAYS * 1.6))
    rows = session.execute(
        select(
            DailyQuote.stock_code,
            DailyQuote.trade_date,
            DailyQuote.close,
            DailyQuote.high,
        ).where(
            DailyQuote.stock_code.in_(code_list),
            DailyQuote.trade_date >= start,
            DailyQuote.trade_date <= trade_date,
        )
    ).all()

    if not rows:
        return {c: FactorBundle(code=c) for c in code_list}

    df = pd.DataFrame(rows, columns=["code", "trade_date", "close", "high"])
    df["close"] = df["close"].astype(float)
    df["high"] = df["high"].astype(float)
    df = df.sort_values(["code", "trade_date"])

    out: dict[str, FactorBundle] = {}
    for code, sub in df.groupby("code"):
        bundle = FactorBundle(code=code)
        if sub.empty:
            out[code] = bundle
            continue

        closes = sub["close"].reset_index(drop=True)
        highs = sub["high"].reset_index(drop=True)
        n = len(closes)

        bundle.close = float(closes.iloc[-1])
        if n >= 20:
            bundle.ma20 = float(closes.iloc[-20:].mean())
        if n >= 60:
            bundle.ma60 = float(closes.iloc[-60:].mean())
        if n >= 250:
            bundle.ma250 = float(closes.iloc[-250:].mean())
        if n >= 1:
            bundle.high_60d = float(highs.iloc[-min(60, n):].max())
        if n >= 6:
            base = float(closes.iloc[-6])
            bundle.pct_5d = (bundle.close - base) / base * 100 if base else None
        if n >= 21:
            base = float(closes.iloc[-21])
            bundle.pct_20d = (bundle.close - base) / base * 100 if base else None
        if n >= 61:
            base = float(closes.iloc[-61])
            bundle.pct_60d = (bundle.close - base) / base * 100 if base else None

        out[code] = bundle

    # 没数据的股票补空记录
    for c in code_list:
        out.setdefault(c, FactorBundle(code=c))
    return out
