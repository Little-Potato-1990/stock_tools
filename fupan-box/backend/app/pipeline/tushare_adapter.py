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
from datetime import date, datetime, time, timedelta

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


def _to_ts_code(code: str) -> str:
    """6 位代码 -> tushare ts_code (000001 -> 000001.SZ, 600000 -> 600000.SH, ...)."""
    code = str(code).strip().zfill(6)
    if code.startswith(("60", "68", "9")):
        return f"{code}.SH"
    if code.startswith(("0", "30", "20")):
        return f"{code}.SZ"
    if code.startswith(("4", "8")):
        return f"{code}.BJ"
    return f"{code}.SH"


def _to_etf_ts_code(code: str) -> str:
    """ETF 6 位代码 -> tushare ts_code (510300 -> 510300.SH, 159915 -> 159915.SZ)."""
    code = str(code).strip().zfill(6)
    if code.startswith("15"):
        return f"{code}.SZ"
    return f"{code}.SH"


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

    def _fetch_dc_board(
        self, trade_date: date | None, content_type: str
    ) -> list[dict]:
        """通用 dc_index 抓取：concept / industry / region 共用同一字段格式。

        change_pct 取自真实 pct_change，z_t_num/up_num 仅作为辅助字段（来自 KPL 拼接）。
        """
        d = (trade_date or date.today()).strftime("%Y%m%d")
        try:
            df = self._pro.dc_index(trade_date=d, content_type=content_type)
        except Exception as e:
            logger.warning(f"tushare dc_index {content_type} {d}: {e}")
            return []
        if df is None or df.empty:
            return []
        # 用 KPL 概念榜补涨停数（仅 concept 有意义）
        zt_map: dict[str, tuple[int, int]] = {}
        if content_type == "concept" and trade_date is not None:
            try:
                kpl_rows = self.fetch_kpl_concept_daily(trade_date)
                for it in kpl_rows:
                    zt_map[it["name"]] = (it["z_t_num"], it["up_num"])
            except Exception:
                pass
        rows = []
        for _, r in df.iterrows():
            name = str(r.get("name", "") or "").strip()
            if not name:
                continue
            zt, up_kpl = zt_map.get(name, (0, 0))
            rows.append({
                "name": name,
                "code": str(r.get("ts_code", "") or ""),
                "change_pct": _safe_float(r.get("pct_change"), 0.0) or 0.0,
                "total_market_cap": _safe_float(r.get("total_mv"), 0.0) or 0.0,
                "turnover_rate": _safe_float(r.get("turnover_rate"), 0.0) or 0.0,
                "up_count": _safe_int(r.get("up_num"), 0) or up_kpl,
                "down_count": _safe_int(r.get("down_num"), 0),
                "lead_stock": str(r.get("leading", "") or ""),
                "lead_stock_pct": _safe_float(r.get("leading_pct"), 0.0) or 0.0,
                "z_t_num": zt,
            })
        rows.sort(key=lambda x: x["change_pct"], reverse=True)
        for i, item in enumerate(rows, 1):
            item["rank"] = i
        return rows

    def fetch_concept_board_daily(
        self, trade_date: date | None = None
    ) -> list[dict]:
        """概念板块日榜：dc_index content_type=concept，change_pct 为真实涨跌幅。"""
        return self._fetch_dc_board(trade_date, "concept")

    def fetch_industry_board_daily(
        self, trade_date: date | None = None
    ) -> list[dict]:
        """行业板块日榜：dc_index content_type=industry。"""
        return self._fetch_dc_board(trade_date, "industry")

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
        df_idx = None
        for ct in ("industry", "concept", "region"):
            try:
                part = self._pro.dc_index(content_type=ct)
            except Exception as e:
                logger.warning(f"tushare dc_index {ct} lookup failed: {e}")
                part = None
            if part is None or part.empty:
                continue
            df_idx = part if df_idx is None else pd.concat([df_idx, part], ignore_index=True)
        if df_idx is None or df_idx.empty:
            return []
        hit = df_idx[df_idx["name"] == industry_name]
        if hit.empty:
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

    # ==================== 资金维度（8000 积分版） ====================

    def fetch_market_fund_flow(self, trade_date: date) -> dict | None:
        """大盘资金流分项（pro.moneyflow_mkt_dc，6000+ 积分）。

        映射为 akshare 兼容的 key（runner.py 直接 JSONB 落库）。
        """
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.moneyflow_mkt_dc(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare moneyflow_mkt_dc {d}: {e}")
            return None
        if df is None or df.empty:
            return None
        r = df.iloc[0]
        return {
            "trade_date": trade_date.isoformat(),
            "主力净流入-净额": _safe_float(r.get("net_amount")),
            "超大单净流入-净额": _safe_float(r.get("buy_elg_amount")),
            "大单净流入-净额": _safe_float(r.get("buy_lg_amount")),
            "中单净流入-净额": _safe_float(r.get("buy_md_amount")),
            "小单净流入-净额": _safe_float(r.get("buy_sm_amount")),
            "上证-收盘价": _safe_float(r.get("close_sh")),
            "上证-涨跌幅": _safe_float(r.get("pct_change_sh")),
            "深证-收盘价": _safe_float(r.get("close_sz")),
            "深证-涨跌幅": _safe_float(r.get("pct_change_sz")),
        }

    def fetch_north_fund_flow(self, trade_date: date) -> dict | None:
        """北向资金当日净流入（pro.moneyflow_hsgt）。"""
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.moneyflow_hsgt(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare moneyflow_hsgt {d}: {e}")
            return None
        if df is None or df.empty:
            return None
        r = df.iloc[0]
        hgt = _safe_float(r.get("hgt"), 0.0) or 0.0
        sgt = _safe_float(r.get("sgt"), 0.0) or 0.0
        north = _safe_float(r.get("north_money"))
        if north is None:
            north = hgt + sgt
        items = [
            {"type": "沪股通", "板块": "沪股通", "成交净买额": hgt},
            {"type": "深股通", "板块": "深股通", "成交净买额": sgt},
        ]
        ggt_ss = _safe_float(r.get("ggt_ss"))
        ggt_sz = _safe_float(r.get("ggt_sz"))
        if ggt_ss is not None:
            items.append({"type": "港股通(沪)", "板块": "港股通(沪)", "成交净买额": ggt_ss})
        if ggt_sz is not None:
            items.append({"type": "港股通(深)", "板块": "港股通(深)", "成交净买额": ggt_sz})
        return {
            "trade_date": trade_date.isoformat(),
            "items": items,
            "net_inflow": north,
            "south_money": _safe_float(r.get("south_money")),
        }

    def fetch_north_hold(self, trade_date: date, top: int = 300) -> list[dict]:
        """北向资金持股。

        优先 tushare pro.hk_hold；2024-08-20 起 hk_hold 仅季报披露，
        平日（非季报日）返空时自动懒加载 AKShare stock_hsgt_hold_stock_em 兜底。
        """
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.hk_hold(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare hk_hold {d}: {e}")
            df = None

        if df is not None and not df.empty:
            if "exchange" in df.columns:
                df = df[df["exchange"].isin(["SH", "SZ"])].copy()
            if "vol" in df.columns:
                df = df.sort_values("vol", ascending=False)
            df = df.head(top)
            out = []
            for _, r in df.iterrows():
                code = _norm_code(r.get("code") or r.get("ts_code"))
                if not code:
                    continue
                out.append({
                    "stock_code": code,
                    "stock_name": str(r.get("name", "") or ""),
                    "hold_shares": _safe_float(r.get("vol")),
                    "hold_amount": None,
                    "hold_pct": _safe_float(r.get("ratio")),
                    "chg_shares": None,
                    "chg_amount": None,
                })
            if out:
                return out

        # 兜底：tushare 返空（平日 / 2024-08-20 后非季报日），改走 AKShare
        try:
            from app.pipeline.akshare_adapter import AKShareAdapter
            return AKShareAdapter().fetch_north_hold(trade_date, top=top)
        except Exception as e:
            logger.warning(f"north_hold akshare fallback failed: {e}")
            return []

    def _fetch_moneyflow_ind_dc(
        self, trade_date: date, content_type: str
    ) -> list[dict]:
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.moneyflow_ind_dc(trade_date=d, content_type=content_type)
        except Exception as e:
            logger.warning(f"tushare moneyflow_ind_dc {content_type} {d}: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            name = str(r.get("name", "") or "").strip()
            if not name:
                continue
            out.append({
                "name": name,
                "code": str(r.get("ts_code", "") or ""),
                "change_pct": _safe_float(r.get("pct_change"), 0.0) or 0.0,
                "main_inflow": _safe_float(r.get("net_amount"), 0.0) or 0.0,
                "main_inflow_pct": _safe_float(r.get("net_amount_rate"), 0.0) or 0.0,
                "huge_inflow": _safe_float(r.get("buy_elg_amount"), 0.0) or 0.0,
                "big_inflow": _safe_float(r.get("buy_lg_amount"), 0.0) or 0.0,
                "lead_stock": str(r.get("lead_name", "") or ""),
                "lead_stock_pct": _safe_float(r.get("lead_chg"), 0.0) or 0.0,
                "rank": _safe_int(r.get("rank"), 0),
            })
        return out

    def fetch_concept_fund_flow(self, trade_date: date) -> list[dict]:
        # tushare moneyflow_ind_dc.content_type 仅接受 中文 "概念/行业/地域"
        return self._fetch_moneyflow_ind_dc(trade_date, "概念")

    def fetch_industry_fund_flow(self, trade_date: date) -> list[dict]:
        return self._fetch_moneyflow_ind_dc(trade_date, "行业")

    def fetch_stock_fund_flow_rank(self, trade_date: date) -> list[dict]:
        """个股资金流（pro.moneyflow_dc，东财全市场）。"""
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.moneyflow_dc(trade_date=d)
        except Exception as e:
            logger.warning(f"tushare moneyflow_dc {d}: {e}")
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
                "change_pct": _safe_float(r.get("pct_change"), 0.0) or 0.0,
                "main_inflow": _safe_float(r.get("net_amount"), 0.0) or 0.0,
                "main_inflow_pct": _safe_float(r.get("net_amount_rate"), 0.0) or 0.0,
                "huge_inflow": _safe_float(r.get("buy_elg_amount"), 0.0) or 0.0,
                "big_inflow": _safe_float(r.get("buy_lg_amount"), 0.0) or 0.0,
                "mid_inflow": _safe_float(r.get("buy_md_amount"), 0.0) or 0.0,
                "small_inflow": _safe_float(r.get("buy_sm_amount"), 0.0) or 0.0,
            })
        return out

    # ==================== ETF ====================

    def _etf_basic_map(self) -> dict[str, str]:
        """缓存 ETF 代码 -> 名称（pro.fund_basic market='E'）。"""
        if hasattr(self, "_etf_name_cache"):
            return self._etf_name_cache
        cache: dict[str, str] = {}
        try:
            df = self._pro.fund_basic(market="E", fields="ts_code,name")
            if df is not None and not df.empty:
                for _, r in df.iterrows():
                    cache[_norm_code(r.get("ts_code"))] = str(r.get("name", "") or "")
        except Exception as e:
            logger.warning(f"tushare fund_basic E: {e}")
        self._etf_name_cache = cache
        return cache

    def fetch_etf_spot(self, trade_date: date | None = None) -> list[dict]:
        """ETF 当日行情（pro.fund_daily）。trade_date=None 时取最近一个交易日。"""
        td = trade_date or date.today()
        # 若 trade_date 传 None（被 api/market.py 调用），用最近 30 天兜底找最近一个有数据的日子
        candidates = [td] if trade_date is not None else [
            td - timedelta(days=i) for i in range(0, 8)
        ]
        df = None
        for cand in candidates:
            d = cand.strftime("%Y%m%d")
            try:
                df = self._pro.fund_daily(trade_date=d)
            except Exception as e:
                logger.warning(f"tushare fund_daily {d}: {e}")
                df = None
                continue
            if df is not None and not df.empty:
                break
        if df is None or df.empty:
            return []
        name_map = self._etf_basic_map()

        # 盘中 IOPV / 折溢价兜底：tushare fund_daily 没有这两个字段，
        # 懒加载 AKShare ak.fund_etf_spot_em 拿一次盘口快照按 code 合并。
        iopv_map: dict[str, dict] = {}
        try:
            import akshare as ak
            ak_df = ak.fund_etf_spot_em()
            if ak_df is not None and not ak_df.empty:
                for _, ar in ak_df.iterrows():
                    ak_code = str(ar.get("代码", "") or "").zfill(6)
                    if not ak_code or ak_code == "000000":
                        continue
                    iopv_map[ak_code] = {
                        "nav": _safe_float(ar.get("IOPV实时估值"))
                            if "IOPV实时估值" in ar.index else None,
                        "premium_rate": _safe_float(ar.get("折价率"))
                            if "折价率" in ar.index else None,
                    }
        except Exception as e:
            logger.warning(f"akshare fund_etf_spot_em fallback failed: {e}")

        out = []
        for _, r in df.iterrows():
            ts_code = str(r.get("ts_code", "") or "")
            code = _norm_code(ts_code)
            if not code:
                continue
            # 仅保留 ETF 代码段
            if not code.startswith(("15", "51", "56", "58")):
                continue
            extra = iopv_map.get(code, {})
            out.append({
                "etf_code": code,
                "etf_name": name_map.get(code, ""),
                "close": _safe_float(r.get("close"), 0.0) or 0.0,
                "change_pct": _safe_float(r.get("pct_chg"), 0.0) or 0.0,
                "amount": (_safe_float(r.get("amount"), 0.0) or 0.0) * 1000,  # 千元 -> 元
                "volume": (_safe_float(r.get("vol"), 0.0) or 0.0) * 100,  # 手 -> 股
                "nav": extra.get("nav"),
                "premium_rate": extra.get("premium_rate"),
            })
        return out

    def fetch_etf_share(self, etf_code: str) -> dict | None:
        """单只 ETF 近 40 日份额历史（pro.fund_share + pro.fund_nav 拼装）。"""
        ts_etf = _to_etf_ts_code(etf_code)
        end = date.today().strftime("%Y%m%d")
        start = (date.today() - timedelta(days=40)).strftime("%Y%m%d")
        try:
            df_share = self._pro.fund_share(
                ts_code=ts_etf, start_date=start, end_date=end
            )
        except Exception as e:
            logger.warning(f"tushare fund_share {ts_etf}: {e}")
            return None
        if df_share is None or df_share.empty:
            return None
        try:
            df_nav = self._pro.fund_nav(
                ts_code=ts_etf, start_date=start, end_date=end
            )
        except Exception:
            df_nav = None
        nav_map: dict[str, float] = {}
        if df_nav is not None and not df_nav.empty:
            for _, r in df_nav.iterrows():
                d = str(r.get("nav_date") or r.get("end_date") or "")
                v = _safe_float(r.get("unit_nav") or r.get("adj_nav"))
                if d and v is not None:
                    nav_map[d] = v
        df_share = df_share.sort_values("trade_date")
        history = []
        for _, r in df_share.iterrows():
            td = str(r.get("trade_date", ""))
            share_wan = _safe_float(r.get("fd_share"), 0.0) or 0.0
            history.append({
                "净值日期": td,
                "基金份额": share_wan / 10000.0,  # 万份 -> 亿份
                "单位净值": nav_map.get(td, 0.0),
            })
        return {"etf_code": etf_code, "history": history[-20:]}

    # ==================== 公告事件 ====================

    def fetch_announce_increase_decrease(self, trade_date: date) -> list[dict]:
        """股东增减持公告（pro.stk_holdertrade，按公告日筛选）。"""
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.stk_holdertrade(ann_date=d)
        except Exception as e:
            logger.warning(f"tushare stk_holdertrade {d}: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            code = _norm_code(r.get("ts_code"))
            if not code:
                continue
            in_de = str(r.get("in_de", "") or "").strip().upper()
            event_type = "increase" if in_de == "IN" else "decrease"
            holder_type = str(r.get("holder_type", "") or "").strip()
            actor_type = "exec" if holder_type == "G" else "major_holder"
            change_vol = _safe_float(r.get("change_vol"), 0.0) or 0.0
            avg_price = _safe_float(r.get("avg_price"))
            scale = (
                abs(change_vol) * avg_price / 10000.0
                if avg_price is not None
                else None
            )
            ann_raw = str(r.get("ann_date", "") or "")[:8]
            try:
                td_str = datetime.strptime(ann_raw, "%Y%m%d").date().isoformat()
            except ValueError:
                td_str = trade_date.isoformat()
            out.append({
                "stock_code": code,
                "stock_name": "",
                "event_type": event_type,
                "actor": str(r.get("holder_name", "") or ""),
                "actor_type": actor_type,
                "shares": abs(change_vol),
                "scale": scale,
                "trade_date": td_str,
                "detail": {
                    k: (None if (v is None or (isinstance(v, float) and pd.isna(v))) else str(v))
                    for k, v in r.items()
                },
            })
        return out

    def fetch_announce_repurchase(self, trade_date: date) -> list[dict]:
        """公司回购公告（pro.repurchase，按公告日）。"""
        d = trade_date.strftime("%Y%m%d")
        try:
            df = self._pro.repurchase(ann_date=d)
        except Exception as e:
            logger.warning(f"tushare repurchase {d}: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            code = _norm_code(r.get("ts_code"))
            if not code:
                continue
            shares = _safe_float(r.get("vol"), 0.0) or 0.0
            amount = _safe_float(r.get("amount"), 0.0) or 0.0  # 万元
            out.append({
                "stock_code": code,
                "stock_name": "",
                "event_type": "repurchase",
                "actor": "",
                "actor_type": "self_company",
                "shares": shares,
                "scale": amount,  # 已是万元
                "progress": str(r.get("proc", "") or "")[:20],
                "trade_date": trade_date.isoformat(),
                "detail": {
                    k: (None if (v is None or (isinstance(v, float) and pd.isna(v))) else str(v))
                    for k, v in r.items()
                },
            })
        return out

    def fetch_announce_placard(self, trade_date: date) -> list[dict]:
        """举牌公告（tushare 无原生接口，懒加载 AKShare 兜底）。"""
        try:
            from app.pipeline.akshare_adapter import AKShareAdapter
            return AKShareAdapter().fetch_announce_placard(trade_date)
        except Exception as e:
            logger.warning(f"placard fallback to akshare failed: {e}")
            return []

    # ==================== 季报股东 ====================

    def fetch_holder_top10(
        self, stock_code: str, report_date: date | None = None
    ) -> list[dict]:
        """前十大股东（pro.top10_holders，按 period 拉取）。"""
        ts_code = _to_ts_code(stock_code)
        kwargs: dict = {"ts_code": ts_code}
        if report_date is not None:
            kwargs["period"] = report_date.strftime("%Y%m%d")
        try:
            df = self._pro.top10_holders(**kwargs)
        except Exception as e:
            logger.warning(f"tushare top10_holders {ts_code}: {e}")
            return []
        if df is None or df.empty:
            return []
        if report_date is not None and "end_date" in df.columns:
            target = report_date.strftime("%Y%m%d")
            df = df[df["end_date"].astype(str).str[:8] == target]
        if df.empty:
            return []
        out = []
        for idx, (_, r) in enumerate(df.iterrows(), 1):
            end_str = str(r.get("end_date", "") or "")[:8]
            try:
                rd = datetime.strptime(end_str, "%Y%m%d").date()
            except ValueError:
                rd = report_date
            out.append({
                "report_date": rd.isoformat() if rd else None,
                "stock_code": stock_code,
                "holder_name": str(r.get("holder_name", "") or ""),
                "rank": idx,
                "shares": _safe_float(r.get("hold_amount")),
                "shares_pct": _safe_float(r.get("hold_ratio")),
                "change_shares": _safe_float(r.get("hold_change")),
                "is_free_float": False,
            })
        return out

    def fetch_holder_free_top10(
        self, stock_code: str, report_date: date | None = None
    ) -> list[dict]:
        """前十大流通股东（pro.top10_floatholders）。"""
        ts_code = _to_ts_code(stock_code)
        kwargs: dict = {"ts_code": ts_code}
        if report_date is not None:
            kwargs["period"] = report_date.strftime("%Y%m%d")
        try:
            df = self._pro.top10_floatholders(**kwargs)
        except Exception as e:
            logger.warning(f"tushare top10_floatholders {ts_code}: {e}")
            return []
        if df is None or df.empty:
            return []
        if report_date is not None and "end_date" in df.columns:
            target = report_date.strftime("%Y%m%d")
            df = df[df["end_date"].astype(str).str[:8] == target]
        if df.empty:
            return []
        out = []
        for idx, (_, r) in enumerate(df.iterrows(), 1):
            end_str = str(r.get("end_date", "") or "")[:8]
            try:
                rd = datetime.strptime(end_str, "%Y%m%d").date()
            except ValueError:
                rd = report_date
            out.append({
                "report_date": rd.isoformat() if rd else None,
                "stock_code": stock_code,
                "holder_name": str(r.get("holder_name", "") or ""),
                "rank": idx,
                "shares": _safe_float(r.get("hold_amount")),
                "shares_pct": _safe_float(r.get("hold_ratio")),
                "change_shares": _safe_float(r.get("hold_change")),
                "is_free_float": True,
            })
        return out

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
