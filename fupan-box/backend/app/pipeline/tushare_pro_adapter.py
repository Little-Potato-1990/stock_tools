"""Tushare Pro 中长视角专用 adapter.

独立于 tushare_adapter.py (后者负责日线 / 涨停 / KPL / 龙虎榜 / 行业).
本 adapter 只覆盖中长线维度:
- fetch_fina_indicator   : pro.fina_indicator (5000 积分)  财务指标
- fetch_forecast         : pro.forecast (2000)             业绩预告
- fetch_express          : pro.express (2000)              业绩快报
- fetch_daily_basic_full : pro.daily_basic 全字段 (2000)   PE/PB/PS/total_mv/...
- fetch_report_rc        : pro.report_rc (2000)            卖方研报一致预期

调用约定:
- 所有方法返回 list[dict], 字段已标准化, 由 tasks/* 直接落库
- stock_code 统一 6 位, 调 tushare 时再补 .SZ/.SH 后缀
- 内部无重试 / 无限速控制, 调用方 (tasks) 负责 batch + sleep
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

import pandas as pd
import tushare as ts

from app.config import get_settings

logger = logging.getLogger(__name__)


def _norm_code(ts_code) -> str:
    if ts_code is None:
        return ""
    s = str(ts_code).strip()
    if not s:
        return ""
    return s.split(".")[0]


def _to_ts_code(code: str) -> str:
    """000001 -> 000001.SZ, 600000 -> 600000.SH, 688001 -> 688001.SH, 300001 -> 300001.SZ"""
    code = str(code).strip().zfill(6)
    if code.startswith(("60", "68", "9")):
        return f"{code}.SH"
    if code.startswith(("0", "30", "20")):
        return f"{code}.SZ"
    if code.startswith(("4", "8")):
        return f"{code}.BJ"
    return f"{code}.SH"


def _safe_float(v, default=None):
    if v is None:
        return default
    try:
        if pd.isna(v):
            return default
    except (TypeError, ValueError):
        pass
    try:
        return float(v)
    except (ValueError, TypeError):
        return default


def _safe_int(v, default=None):
    f = _safe_float(v, None)
    if f is None:
        return default
    try:
        return int(f)
    except (ValueError, TypeError):
        return default


def _parse_date(v) -> date | None:
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    s = str(v).strip()
    if not s or len(s) < 8:
        return None
    try:
        return datetime.strptime(s[:8], "%Y%m%d").date()
    except ValueError:
        return None


class TusharePioAdapter:
    """Tushare pro 中长视角专用 (避免与 TushareAdapter 命名冲突)."""

    def __init__(self):
        settings = get_settings()
        if not settings.tushare_token:
            raise RuntimeError("TUSHARE_TOKEN is not set")
        ts.set_token(settings.tushare_token)
        self._pro = ts.pro_api()

    # ===================== 财务指标 =====================

    def fetch_fina_indicator(
        self,
        stock_code: str,
        start_period: str | None = None,
        end_period: str | None = None,
    ) -> list[dict]:
        """单股多季度财务指标.

        Args:
            stock_code: 6 位代码.
            start_period / end_period: YYYYMMDD, 不传则取最近 5 年 (20 季).
        """
        ts_code = _to_ts_code(stock_code)
        kwargs: dict[str, Any] = {"ts_code": ts_code}
        if start_period:
            kwargs["start_date"] = start_period
        if end_period:
            kwargs["end_date"] = end_period

        try:
            df = self._pro.fina_indicator(**kwargs)
        except Exception as e:
            logger.warning(f"tushare fina_indicator {ts_code}: {e}")
            return []
        if df is None or df.empty:
            return []

        out = []
        for _, r in df.iterrows():
            rd = _parse_date(r.get("end_date"))
            if not rd:
                continue
            out.append({
                "stock_code": stock_code,
                "report_date": rd,
                "ann_date": _parse_date(r.get("ann_date")),
                "revenue": None,  # 由 fetch_income 补齐绝对值
                "revenue_yoy": _safe_float(r.get("tr_yoy")),
                "net_profit_yoy": _safe_float(r.get("netprofit_yoy")),
                "gross_margin": _safe_float(r.get("grossprofit_margin")),
                "net_margin": _safe_float(r.get("netprofit_margin")),
                "roe": _safe_float(r.get("roe")),
                "roa": _safe_float(r.get("roa")),
                "debt_ratio": _safe_float(r.get("debt_to_assets")),
                "current_ratio": _safe_float(r.get("current_ratio")),
                "cash_flow_op_to_revenue": _safe_float(r.get("ocf_to_or")),
                "eps": _safe_float(r.get("eps")),
                "bps": _safe_float(r.get("bps")),
            })
        return out

    def fetch_income(
        self,
        stock_code: str,
        start_period: str | None = None,
        end_period: str | None = None,
    ) -> list[dict]:
        """单股利润表 (pro.income)，提供 revenue / 归母净利润绝对值。"""
        ts_code = _to_ts_code(stock_code)
        kwargs: dict[str, Any] = {
            "ts_code": ts_code,
            "fields": "ts_code,end_date,ann_date,revenue,n_income_attr_p",
        }
        if start_period:
            kwargs["start_date"] = start_period
        if end_period:
            kwargs["end_date"] = end_period
        try:
            df = self._pro.income(**kwargs)
        except Exception as e:
            logger.warning(f"tushare income {ts_code}: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            rd = _parse_date(r.get("end_date"))
            if not rd:
                continue
            out.append({
                "stock_code": stock_code,
                "report_date": rd,
                "revenue": _safe_float(r.get("revenue")),
                "net_profit": _safe_float(r.get("n_income_attr_p")),
            })
        return out

    def fetch_cashflow(
        self,
        stock_code: str,
        start_period: str | None = None,
        end_period: str | None = None,
    ) -> list[dict]:
        """单股现金流量表 (pro.cashflow)，提供经营活动现金流绝对值。"""
        ts_code = _to_ts_code(stock_code)
        kwargs: dict[str, Any] = {
            "ts_code": ts_code,
            "fields": "ts_code,end_date,ann_date,n_cashflow_act",
        }
        if start_period:
            kwargs["start_date"] = start_period
        if end_period:
            kwargs["end_date"] = end_period
        try:
            df = self._pro.cashflow(**kwargs)
        except Exception as e:
            logger.warning(f"tushare cashflow {ts_code}: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            rd = _parse_date(r.get("end_date"))
            if not rd:
                continue
            out.append({
                "stock_code": stock_code,
                "report_date": rd,
                "cash_flow_op": _safe_float(r.get("n_cashflow_act")),
            })
        return out

    # ===================== 业绩预告 / 快报 =====================

    def fetch_forecast(self, ann_date: date) -> list[dict]:
        """单日业绩预告披露 (按公告日)."""
        d = ann_date.strftime("%Y%m%d")
        try:
            df = self._pro.forecast(ann_date=d)
        except Exception as e:
            logger.warning(f"tushare forecast {d}: {e}")
            return []
        if df is None or df.empty:
            return []

        out = []
        for _, r in df.iterrows():
            code = _norm_code(r.get("ts_code"))
            if not code:
                continue
            ann = _parse_date(r.get("ann_date"))
            period = str(r.get("end_date", "") or "").strip()
            if not ann or not period:
                continue
            out.append({
                "stock_code": code,
                "ann_date": ann,
                "period": period,
                "type": "forecast",
                "nature": str(r.get("type", "") or "").strip() or None,
                "change_pct_low": _safe_float(r.get("p_change_min")),
                "change_pct_high": _safe_float(r.get("p_change_max")),
                "net_profit_low": _safe_float(r.get("net_profit_min")),
                "net_profit_high": _safe_float(r.get("net_profit_max")),
                "last_period_net_profit": _safe_float(r.get("last_parent_net")),
                "summary": str(r.get("summary", "") or "").strip()[:500] or None,
                "reason": str(r.get("change_reason", "") or "").strip()[:500] or None,
            })
        return out

    def fetch_express(self, ann_date: date) -> list[dict]:
        """单日业绩快报披露."""
        d = ann_date.strftime("%Y%m%d")
        try:
            df = self._pro.express(ann_date=d)
        except Exception as e:
            logger.warning(f"tushare express {d}: {e}")
            return []
        if df is None or df.empty:
            return []

        out = []
        for _, r in df.iterrows():
            code = _norm_code(r.get("ts_code"))
            if not code:
                continue
            ann = _parse_date(r.get("ann_date"))
            period = str(r.get("end_date", "") or "").strip()
            if not ann or not period:
                continue
            out.append({
                "stock_code": code,
                "ann_date": ann,
                "period": period,
                "type": "express",
                "nature": None,
                "change_pct_low": _safe_float(r.get("yoy_net_profit")),
                "change_pct_high": _safe_float(r.get("yoy_net_profit")),
                "net_profit_low": _safe_float(r.get("n_income")),
                "net_profit_high": _safe_float(r.get("n_income")),
                "last_period_net_profit": _safe_float(r.get("perd_net_profit")),
                "summary": None,
                "reason": None,
            })
        return out

    # ===================== 估值 (daily_basic 全字段) =====================

    def fetch_daily_basic_full(self, trade_date: date) -> list[dict]:
        """单日全市场估值快照 (PE/PB/PS/total_mv/...).

        现有 tushare_adapter.fetch_daily_quotes 仅取 turnover_rate, 这里独立调取全字段.
        """
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.daily_basic(
                trade_date=d,
                fields=(
                    "ts_code,trade_date,pe,pe_ttm,pb,ps,ps_ttm,"
                    "dv_ratio,dv_ttm,total_share,float_share,free_share,"
                    "total_mv,circ_mv"
                ),
            )
        except Exception as e:
            logger.warning(f"tushare daily_basic full {d}: {e}")
            return []
        if df is None or df.empty:
            return []

        out = []
        for _, r in df.iterrows():
            code = _norm_code(r.get("ts_code"))
            if not code:
                continue
            out.append({
                "stock_code": code,
                "trade_date": trade_date,
                "pe": _safe_float(r.get("pe")),
                "pe_ttm": _safe_float(r.get("pe_ttm")),
                "pb": _safe_float(r.get("pb")),
                "ps": _safe_float(r.get("ps")),
                "ps_ttm": _safe_float(r.get("ps_ttm")),
                "dv_ratio": _safe_float(r.get("dv_ratio")),
                "dv_ttm": _safe_float(r.get("dv_ttm")),
                "total_share": _safe_float(r.get("total_share")),
                "float_share": _safe_float(r.get("float_share")),
                "free_share": _safe_float(r.get("free_share")),
                "total_mv": _safe_float(r.get("total_mv")),
                "circ_mv": _safe_float(r.get("circ_mv")),
            })
        return out

    # ===================== 卖方一致预期 =====================

    def fetch_report_rc(
        self,
        stock_code: str,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[dict]:
        """单股卖方研报明细 (近 N 天). 由调用方按周聚合.

        Args:
            stock_code: 6 位代码.
            start_date / end_date: 默认近 90 天.
        """
        ts_code = _to_ts_code(stock_code)
        kwargs: dict[str, Any] = {"ts_code": ts_code}
        if start_date:
            kwargs["start_date"] = start_date.strftime("%Y%m%d")
        if end_date:
            kwargs["end_date"] = end_date.strftime("%Y%m%d")

        try:
            df = self._pro.report_rc(**kwargs)
        except Exception as e:
            logger.warning(f"tushare report_rc {ts_code}: {e}")
            return []
        if df is None or df.empty:
            return []

        out = []
        for _, r in df.iterrows():
            rep_date = _parse_date(r.get("report_date"))
            if not rep_date:
                continue
            base_year = rep_date.year
            out.append({
                "stock_code": stock_code,
                "report_date": rep_date,
                "org_name": str(r.get("org_name", "") or "").strip() or None,
                "rating": str(r.get("rating", "") or "").strip() or None,
                "target_price": _safe_float(r.get("max_price")) or _safe_float(r.get("min_price")),
                "target_price_max": _safe_float(r.get("max_price")),
                "target_price_min": _safe_float(r.get("min_price")),
                "eps_fy1": (
                    _safe_float(r.get(f"eps_{base_year}"))
                    or _safe_float(r.get("eps_fy1"))
                ),
                "eps_fy2": (
                    _safe_float(r.get(f"eps_{base_year + 1}"))
                    or _safe_float(r.get("eps_fy2"))
                ),
                "eps_fy3": (
                    _safe_float(r.get(f"eps_{base_year + 2}"))
                    or _safe_float(r.get("eps_fy3"))
                ),
            })
        return out
