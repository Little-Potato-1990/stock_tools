"""Tushare Pro 数据源实现。

需要 5000+ 积分；用到的接口：
- pro.daily / pro.daily_basic        日线行情 + 换手率
- pro.limit_list_d                   涨跌停板（含 industry / first_time / open_times / fd_amount）
- pro.kpl_list                       开盘啦涨停明细（lu_time / lu_desc / theme）
- pro.kpl_concept / kpl_concept_cons 开盘啦每日概念榜 + 成分股（真正每日不同）
- pro.dc_index                       东财概念/行业指数日榜
- pro.stock_basic / pro.trade_cal    基础信息 + 交易日历
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, time

import pandas as pd
import tushare as ts

from app.config import get_settings
from app.pipeline.adapter import (
    DataSourceAdapter,
    RawDailyQuote,
    RawLimitUp,
    RawThemeData,
)

logger = logging.getLogger(__name__)


def _norm_code(ts_code) -> str:
    """000037.SZ -> 000037"""
    if ts_code is None:
        return ""
    s = str(ts_code).strip()
    if not s:
        return ""
    return s.split(".")[0]


def _parse_int_time(v) -> time | None:
    """93403 / '93403' / '09:34:03' -> time(9, 34, 3)"""
    if v is None:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    s = str(v).strip()
    if not s or s.lower() == "nan" or s == "None":
        return None
    if ":" in s:
        for fmt in ("%H:%M:%S", "%H:%M"):
            try:
                return datetime.strptime(s, fmt).time()
            except ValueError:
                continue
        return None
    s = s.split(".")[0]
    s = s.zfill(6)
    try:
        h = int(s[:-4])
        m = int(s[-4:-2])
        sec = int(s[-2:])
    except ValueError:
        return None
    if 0 <= h < 24 and 0 <= m < 60 and 0 <= sec < 60:
        return time(h, m, sec)
    return None


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


def _safe_int(v, default=0):
    f = _safe_float(v, None)
    if f is None:
        return default
    try:
        return int(f)
    except (ValueError, TypeError):
        return default


def _parse_continuous(lu_desc) -> int:
    """开盘啦 lu_desc 解析连板数：'4天3板' -> 3, '首板' -> 1, '3板' -> 3"""
    if lu_desc is None:
        return 0
    try:
        if pd.isna(lu_desc):
            return 0
    except (TypeError, ValueError):
        pass
    s = str(lu_desc).strip()
    if not s:
        return 0
    if s == "首板":
        return 1
    m = re.search(r"(\d+)\s*板", s)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return 0
    return 0


def _split_themes(s) -> list[str]:
    if s is None:
        return []
    try:
        if pd.isna(s):
            return []
    except (TypeError, ValueError):
        pass
    text = str(s).strip()
    if not text:
        return []
    text = text.replace("，", "、").replace(",", "、").replace("/", "、")
    return [t.strip() for t in text.split("、") if t.strip()]


class TushareAdapter(DataSourceAdapter):
    """Tushare Pro 数据源（5000+ 积分版本）"""

    def __init__(self):
        settings = get_settings()
        if not settings.tushare_token:
            raise RuntimeError("TUSHARE_TOKEN is not set")
        ts.set_token(settings.tushare_token)
        self._pro = ts.pro_api()
        self._cal_cache: dict[str, set[date]] = {}

    def fetch_daily_quotes(self, trade_date: date) -> list[RawDailyQuote]:
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.daily(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare daily {d}: {e}")
            return []
        if df is None or df.empty:
            return []
        try:
            db = self._pro.daily_basic(
                trade_date=d, fields="ts_code,turnover_rate"
            )
        except Exception as e:
            logger.warning(f"tushare daily_basic {d}: {e}")
            db = None

        tr_map: dict[str, float] = {}
        if db is not None and not db.empty:
            for _, r in db.iterrows():
                v = _safe_float(r.get("turnover_rate"))
                if v is not None:
                    tr_map[r.get("ts_code")] = v

        out: list[RawDailyQuote] = []
        for _, r in df.iterrows():
            code = _norm_code(r.get("ts_code"))
            if not code:
                continue
            try:
                pre = _safe_float(r.get("pre_close"), 0.0) or 0.0
                hi = _safe_float(r.get("high"), 0.0) or 0.0
                lo = _safe_float(r.get("low"), 0.0) or 0.0
                amp = ((hi - lo) / pre * 100) if pre > 0 else None
                amount_kyuan = _safe_float(r.get("amount"), 0.0) or 0.0
                vol_hand = _safe_int(r.get("vol"), 0)
                out.append(RawDailyQuote(
                    stock_code=code,
                    trade_date=trade_date,
                    open=_safe_float(r.get("open"), 0.0) or 0.0,
                    high=hi,
                    low=lo,
                    close=_safe_float(r.get("close"), 0.0) or 0.0,
                    pre_close=pre,
                    change_pct=_safe_float(r.get("pct_chg"), 0.0) or 0.0,
                    volume=vol_hand * 100,
                    amount=amount_kyuan * 1000,
                    turnover_rate=tr_map.get(r.get("ts_code")),
                    amplitude=amp,
                ))
            except Exception:
                continue
        return out

    def fetch_limit_up(self, trade_date: date) -> list[RawLimitUp]:
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.limit_list_d(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare limit_list_d {d}: {e}")
            return []
        if df is None or df.empty:
            return []

        df_u = df[df["limit"] == "U"].copy()
        if df_u.empty:
            return []

        try:
            kpl = self._pro.kpl_list(trade_date=d, tag="涨停")
        except Exception:
            kpl = None

        kpl_map: dict[str, dict] = {}
        if kpl is not None and not kpl.empty:
            for _, r in kpl.iterrows():
                kpl_map[r.get("ts_code")] = {
                    "lu_desc": r.get("lu_desc"),
                    "theme": r.get("theme"),
                    "lu_time": r.get("lu_time"),
                    "open_time": r.get("open_time"),
                    "last_time": r.get("last_time"),
                }

        out: list[RawLimitUp] = []
        for _, r in df_u.iterrows():
            ts_code_raw = r.get("ts_code")
            code = _norm_code(ts_code_raw)
            if not code:
                continue
            kpl_d = kpl_map.get(ts_code_raw, {})

            ft = _parse_int_time(r.get("first_time"))
            lt = _parse_int_time(r.get("last_time"))
            if ft is None and kpl_d.get("lu_time"):
                ft = _parse_int_time(kpl_d["lu_time"])
            if lt is None and kpl_d.get("last_time"):
                lt = _parse_int_time(kpl_d["last_time"])

            cont = _safe_int(r.get("limit_times"), 0)
            if cont <= 0:
                cont = _parse_continuous(kpl_d.get("lu_desc")) or 1

            theme_names = _split_themes(kpl_d.get("theme"))
            limit_reason = kpl_d.get("lu_desc") or r.get("up_stat") or None
            if limit_reason is not None:
                try:
                    if pd.isna(limit_reason):
                        limit_reason = None
                except (TypeError, ValueError):
                    pass
            if limit_reason is not None:
                limit_reason = str(limit_reason).strip() or None

            industry = r.get("industry")
            if industry is None:
                pass
            else:
                try:
                    if pd.isna(industry):
                        industry = None
                except (TypeError, ValueError):
                    pass
            if industry is not None:
                industry = str(industry).strip() or None

            open_times = _safe_int(r.get("open_times"), 0)
            is_one_word = (
                open_times == 0
                and ft is not None
                and ft <= time(9, 30, 5)
            )

            out.append(RawLimitUp(
                stock_code=code,
                stock_name=str(r.get("name", "") or ""),
                trade_date=trade_date,
                continuous_days=cont,
                first_limit_time=ft,
                last_limit_time=lt,
                open_count=open_times,
                limit_order_amount=_safe_float(r.get("fd_amount")),
                is_one_word=is_one_word,
                is_t_board=False,
                limit_reason=limit_reason,
                industry=industry,
                theme_names=theme_names,
            ))
        return out

    def fetch_limit_down(self, trade_date: date) -> list[str]:
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.limit_list_d(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare limit_list_d (D) {d}: {e}")
            return []
        if df is None or df.empty:
            return []
        return [
            _norm_code(c)
            for c in df.loc[df["limit"] == "D", "ts_code"].tolist()
            if c
        ]

    def fetch_themes(self) -> list[RawThemeData]:
        """KPL 概念全集（默认取最近一个交易日的榜）。"""
        try:
            df = self._pro.kpl_concept()
        except Exception as e:
            logger.warning(f"tushare kpl_concept: {e}")
            return []
        if df is None or df.empty:
            return []
        out: list[RawThemeData] = []
        for _, r in df.iterrows():
            ts_code = r.get("ts_code")
            name = str(r.get("name", "") or "").strip()
            if not name or not ts_code:
                continue
            try:
                cons = self._pro.kpl_concept_cons(ts_code=ts_code)
            except Exception:
                cons = None
            stocks = (
                [_norm_code(c) for c in cons["con_code"].tolist() if c]
                if cons is not None and not cons.empty
                else []
            )
            out.append(RawThemeData(theme_name=name, stocks=stocks))
        return out

    def fetch_kpl_concept_daily(self, trade_date: date) -> list[dict]:
        """开盘啦每日概念榜（带涨停数 / 上涨数，每日真实不同）。"""
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.kpl_concept(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare kpl_concept {d}: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            name = str(r.get("name", "") or "").strip()
            if not name:
                continue
            zt = _safe_int(r.get("z_t_num"), 0)
            up = _safe_int(r.get("up_num"), 0)
            out.append({
                "name": name,
                "code": str(r.get("ts_code", "") or ""),
                "z_t_num": zt,
                "up_num": up,
            })
        out.sort(key=lambda x: (-x["z_t_num"], -x["up_num"]))
        return out

    def fetch_kpl_concept_cons_daily(self, trade_date: date) -> list[dict]:
        """开盘啦每日概念成分股（每个题材的入选个股 + 入选逻辑）。"""
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.kpl_concept_cons(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare kpl_concept_cons {d}: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            con_code = _norm_code(r.get("con_code"))
            if not con_code:
                continue
            out.append({
                "concept_code": str(r.get("ts_code", "") or ""),
                "concept_name": str(r.get("name", "") or ""),
                "stock_code": con_code,
                "stock_name": str(r.get("con_name", "") or ""),
                "desc": str(r.get("desc", "") or ""),
                "hot_num": _safe_int(r.get("hot_num"), 0),
            })
        return out

    def fetch_concept_board_daily(
        self, trade_date: date | None = None
    ) -> list[dict]:
        """概念板块日榜（兼容 runner.py 调用）：用 KPL 概念榜 + 必要字段补齐。"""
        td = trade_date or date.today()
        kpl = self.fetch_kpl_concept_daily(td)
        if not kpl:
            return []
        out = []
        for i, item in enumerate(kpl, 1):
            out.append({
                "rank": i,
                "name": item["name"],
                "code": item["code"],
                "change_pct": float(item["z_t_num"]),
                "z_t_num": item["z_t_num"],
                "up_num": item["up_num"],
                "total_market_cap": 0.0,
                "turnover_rate": 0.0,
                "up_count": item["up_num"],
                "down_count": 0,
                "lead_stock": "",
                "lead_stock_pct": 0.0,
            })
        return out

    def fetch_industry_board_daily(
        self, trade_date: date | None = None
    ) -> list[dict]:
        """东财行业/概念板块日榜（带涨跌幅 / 领涨股 / 总市值）。"""
        d = (trade_date or date.today()).strftime("%Y%m%d")
        try:
            df = self._pro.dc_index(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare dc_index {d}: {e}")
            return []
        if df is None or df.empty:
            return []
        rows = []
        for _, r in df.iterrows():
            name = str(r.get("name", "") or "").strip()
            if not name:
                continue
            rows.append({
                "name": name,
                "code": str(r.get("ts_code", "") or ""),
                "change_pct": _safe_float(r.get("pct_change"), 0.0) or 0.0,
                "total_market_cap": _safe_float(r.get("total_mv"), 0.0) or 0.0,
                "turnover_rate": _safe_float(r.get("turnover_rate"), 0.0) or 0.0,
                "up_count": _safe_int(r.get("up_num"), 0),
                "down_count": _safe_int(r.get("down_num"), 0),
                "lead_stock": str(r.get("leading", "") or ""),
                "lead_stock_pct": _safe_float(r.get("leading_pct"), 0.0) or 0.0,
            })
        rows.sort(key=lambda x: x["change_pct"], reverse=True)
        for i, item in enumerate(rows, 1):
            item["rank"] = i
        return rows

    def fetch_concept_cons(
        self, concept_name: str, ts_code: str | None = None
    ) -> list[dict]:
        """概念成分股。优先按 KPL 题材码（KP 后缀）查，其次按名称匹配。"""
        try:
            if ts_code:
                cons = self._pro.kpl_concept_cons(ts_code=ts_code)
            else:
                df = self._pro.kpl_concept()
                hit = (
                    df[df["name"] == concept_name]
                    if df is not None and not df.empty
                    else None
                )
                if hit is None or hit.empty:
                    return []
                cons = self._pro.kpl_concept_cons(ts_code=hit.iloc[0]["ts_code"])
        except Exception:
            return []
        if cons is None or cons.empty:
            return []
        out = []
        for _, r in cons.iterrows():
            code = _norm_code(r.get("con_code"))
            if not code:
                continue
            out.append({
                "stock_code": code,
                "stock_name": str(r.get("con_name", "") or code),
                "change_pct": 0.0,
                "close": 0.0,
                "amount": 0.0,
                "turnover_rate": 0.0,
                "total_market_cap": 0.0,
                "desc": str(r.get("desc", "") or ""),
                "hot_num": _safe_int(r.get("hot_num"), 0),
            })
        return out

    def fetch_industry_cons(self, industry_name: str) -> list[dict]:
        """行业/东财指数成分股。先用 dc_index 找 ts_code，再用 dc_member 取成分。"""
        if not industry_name:
            return []
        try:
            df_idx = self._pro.dc_index()
        except Exception as e:
            logger.warning(f"tushare dc_index lookup failed: {e}")
            return []
        if df_idx is None or df_idx.empty:
            return []
        hit = df_idx[df_idx["name"] == industry_name]
        if hit.empty:
            # 名字精确匹配不到，尝试模糊匹配（包含关系）
            hit = df_idx[df_idx["name"].str.contains(industry_name, na=False, regex=False)]
        if hit.empty:
            return []
        ts_code = str(hit.iloc[0].get("ts_code", "") or "")
        if not ts_code:
            return []
        try:
            cons = self._pro.dc_member(ts_code=ts_code)
        except Exception as e:
            logger.warning(f"tushare dc_member {ts_code}: {e}")
            return []
        if cons is None or cons.empty:
            return []
        out = []
        for _, r in cons.iterrows():
            code = _norm_code(r.get("con_code"))
            if not code:
                continue
            out.append({
                "stock_code": code,
                "stock_name": str(r.get("name", "") or code),
                "change_pct": 0.0,
                "close": 0.0,
                "amount": 0.0,
                "turnover_rate": 0.0,
                "total_market_cap": 0.0,
                "desc": "",
                "hot_num": 0,
            })
        return out

    def fetch_lhb_list(self, trade_date: date) -> list[dict]:
        """龙虎榜个股明细（每日上榜的全部个股 + 净买入 / 上榜原因）。"""
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.top_list(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare top_list {d}: {e}")
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
                "stock_name": str(r.get("name", "") or ""),
                "close": _safe_float(r.get("close"), 0.0) or 0.0,
                "pct_change": _safe_float(r.get("pct_change"), 0.0) or 0.0,
                "turnover_rate": _safe_float(r.get("turnover_rate"), 0.0) or 0.0,
                "amount": _safe_float(r.get("amount"), 0.0) or 0.0,
                "lhb_buy": _safe_float(r.get("l_buy"), 0.0) or 0.0,
                "lhb_sell": _safe_float(r.get("l_sell"), 0.0) or 0.0,
                "lhb_amount": _safe_float(r.get("l_amount"), 0.0) or 0.0,
                "net_amount": _safe_float(r.get("net_amount"), 0.0) or 0.0,
                "net_rate": _safe_float(r.get("net_rate"), 0.0) or 0.0,
                "amount_rate": _safe_float(r.get("amount_rate"), 0.0) or 0.0,
                "float_values": _safe_float(r.get("float_values"), 0.0) or 0.0,
                "reason": str(r.get("reason", "") or ""),
            })
        return out

    def fetch_lhb_inst(self, trade_date: date) -> list[dict]:
        """龙虎榜营业部明细（每个上榜个股的买卖席位 + 净买入 + 是否机构）。"""
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.top_inst(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare top_inst {d}: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            code = _norm_code(r.get("ts_code"))
            if not code:
                continue
            exalter = str(r.get("exalter", "") or "").strip()
            out.append({
                "stock_code": code,
                "exalter": exalter,
                "is_inst": exalter == "机构专用",
                "side": _safe_int(r.get("side"), 0),
                "buy": _safe_float(r.get("buy"), 0.0) or 0.0,
                "buy_rate": _safe_float(r.get("buy_rate"), 0.0) or 0.0,
                "sell": _safe_float(r.get("sell"), 0.0) or 0.0,
                "sell_rate": _safe_float(r.get("sell_rate"), 0.0) or 0.0,
                "net_buy": _safe_float(r.get("net_buy"), 0.0) or 0.0,
                "reason": str(r.get("reason", "") or ""),
            })
        return out

    def fetch_stock_list(self) -> list[dict]:
        try:
            df = self._pro.stock_basic(
                list_status="L", fields="ts_code,symbol,name,industry"
            )
        except Exception as e:
            logger.warning(f"tushare stock_basic: {e}")
            return []
        if df is None or df.empty:
            return []
        return [
            {"code": str(r["symbol"]), "name": str(r["name"])}
            for _, r in df.iterrows()
        ]

    def is_trading_day(self, d: date) -> bool:
        if d.weekday() >= 5:
            return False
        ym = d.strftime("%Y%m")
        if ym not in self._cal_cache:
            try:
                df = self._pro.trade_cal(
                    exchange="SSE",
                    start_date=f"{ym}01",
                    end_date=f"{ym}31",
                )
                self._cal_cache[ym] = {
                    datetime.strptime(row["cal_date"], "%Y%m%d").date()
                    for _, row in df.iterrows()
                    if int(row["is_open"]) == 1
                }
            except Exception as e:
                logger.warning(f"tushare trade_cal {ym}: {e}")
                self._cal_cache[ym] = set()
        cache = self._cal_cache[ym]
        if not cache:
            return d.weekday() < 5
        return d in cache
