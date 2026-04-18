"""AKShare 数据源实现"""

import logging

import akshare as ak
import pandas as pd
from datetime import date, time, datetime
from app.pipeline.adapter import (
    DataSourceAdapter, RawDailyQuote, RawLimitUp, RawThemeData,
)

logger = logging.getLogger(__name__)


class AKShareAdapter(DataSourceAdapter):

    def fetch_daily_quotes(self, trade_date: date) -> list[RawDailyQuote]:
        date_str = trade_date.strftime("%Y%m%d")
        try:
            df = ak.stock_zh_a_spot_em()
        except Exception:
            return []

        results = []
        for _, row in df.iterrows():
            code = str(row.get("代码", ""))
            if not code:
                continue
            try:
                results.append(RawDailyQuote(
                    stock_code=code,
                    trade_date=trade_date,
                    open=float(row.get("今开", 0) or 0),
                    high=float(row.get("最高", 0) or 0),
                    low=float(row.get("最低", 0) or 0),
                    close=float(row.get("最新价", 0) or 0),
                    pre_close=float(row.get("昨收", 0) or 0),
                    change_pct=float(row.get("涨跌幅", 0) or 0),
                    volume=int(row.get("成交量", 0) or 0),
                    amount=float(row.get("成交额", 0) or 0),
                    turnover_rate=float(row.get("换手率", 0) or 0) if row.get("换手率") else None,
                    amplitude=float(row.get("振幅", 0) or 0) if row.get("振幅") else None,
                ))
            except (ValueError, TypeError):
                continue
        return results

    def fetch_limit_up(self, trade_date: date) -> list[RawLimitUp]:
        date_str = trade_date.strftime("%Y%m%d")
        try:
            df = ak.stock_zt_pool_em(date=date_str)
        except Exception:
            return []

        results = []
        for _, row in df.iterrows():
            code = str(row.get("代码", ""))
            if not code:
                continue

            ft = row.get("首次封板时间")
            lt = row.get("最终封板时间")
            first_time = _parse_time(ft)
            last_time = _parse_time(lt)

            results.append(RawLimitUp(
                stock_code=code,
                stock_name=str(row.get("名称", "")),
                trade_date=trade_date,
                continuous_days=int(row.get("连板数", 1) or 1),
                first_limit_time=first_time,
                last_limit_time=last_time,
                open_count=int(row.get("炸板次数", 0) or 0),
                limit_order_amount=float(row.get("封板资金", 0) or 0) if row.get("封板资金") else None,
                limit_reason=str(row.get("涨停统计", "")) if row.get("涨停统计") else None,
                industry=str(row.get("所属行业", "")) if row.get("所属行业") else None,
            ))
        return results

    def fetch_limit_down(self, trade_date: date) -> list[str]:
        date_str = trade_date.strftime("%Y%m%d")
        try:
            df = ak.stock_zt_pool_dtgc_em(date=date_str)
            return [str(row["代码"]) for _, row in df.iterrows() if row.get("代码")]
        except Exception:
            return []

    def fetch_themes(self) -> list[RawThemeData]:
        try:
            df = ak.stock_board_concept_name_em()
        except Exception:
            return []

        results = []
        for _, row in df.iterrows():
            name = str(row.get("板块名称", ""))
            if not name:
                continue
            try:
                cons_df = ak.stock_board_concept_cons_em(symbol=name)
                stocks = [str(r["代码"]) for _, r in cons_df.iterrows() if r.get("代码")]
            except Exception:
                stocks = []
            results.append(RawThemeData(theme_name=name, stocks=stocks))
        return results

    def fetch_industry_board_daily(self, trade_date=None) -> list[dict]:
        """获取行业板块当日行情排名（akshare 仅支持当日，trade_date 参数忽略）"""
        try:
            df = ak.stock_board_industry_name_em()
        except Exception:
            return []

        results = []
        for _, row in df.iterrows():
            name = str(row.get("板块名称", ""))
            if not name:
                continue
            results.append({
                "rank": int(row.get("排名", 0) or 0),
                "name": name,
                "code": str(row.get("板块代码", "")),
                "change_pct": float(row.get("涨跌幅", 0) or 0),
                "total_market_cap": float(row.get("总市值", 0) or 0),
                "turnover_rate": float(row.get("换手率", 0) or 0),
                "up_count": int(row.get("上涨家数", 0) or 0),
                "down_count": int(row.get("下跌家数", 0) or 0),
                "lead_stock": str(row.get("领涨股票", "")),
                "lead_stock_pct": float(row.get("领涨股票-涨跌幅", 0) or 0),
            })
        return results

    def fetch_concept_board_daily(self, trade_date=None) -> list[dict]:
        """获取概念板块当日行情排名（akshare 仅支持当日，trade_date 参数忽略）"""
        try:
            df = ak.stock_board_concept_name_em()
        except Exception:
            return []

        results = []
        for _, row in df.iterrows():
            name = str(row.get("板块名称", ""))
            if not name:
                continue
            results.append({
                "rank": int(row.get("排名", 0) or 0),
                "name": name,
                "code": str(row.get("板块代码", "")),
                "change_pct": float(row.get("涨跌幅", 0) or 0),
                "total_market_cap": float(row.get("总市值", 0) or 0),
                "turnover_rate": float(row.get("换手率", 0) or 0),
                "up_count": int(row.get("上涨家数", 0) or 0),
                "down_count": int(row.get("下跌家数", 0) or 0),
                "lead_stock": str(row.get("领涨股票", "")),
                "lead_stock_pct": float(row.get("领涨股票-涨跌幅", 0) or 0),
            })
        return results

    def fetch_concept_cons(self, concept_name: str) -> list[dict]:
        """获取概念板块成分股"""
        try:
            df = ak.stock_board_concept_cons_em(symbol=concept_name)
        except Exception:
            return []

        results = []
        for _, row in df.iterrows():
            code = str(row.get("代码", ""))
            if not code:
                continue
            results.append({
                "stock_code": code,
                "stock_name": str(row.get("名称", code)),
                "change_pct": float(row.get("涨跌幅", 0) or 0),
                "close": float(row.get("最新价", 0) or 0),
                "amount": float(row.get("成交额", 0) or 0),
                "turnover_rate": float(row.get("换手率", 0) or 0),
                "total_market_cap": float(row.get("总市值", 0) or 0),
            })
        return results

    def fetch_industry_cons(self, industry_name: str) -> list[dict]:
        """行业板块成分股（东方财富）"""
        if not industry_name:
            return []
        try:
            df = ak.stock_board_industry_cons_em(symbol=industry_name)
        except Exception as e:
            logger.warning(f"akshare stock_board_industry_cons_em({industry_name}): {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            code = str(r.get("代码", "") or "").strip()
            if not code:
                continue
            out.append({
                "stock_code": code,
                "stock_name": str(r.get("名称", "") or code),
                "change_pct": float(r.get("涨跌幅", 0) or 0),
                "close": float(r.get("最新价", 0) or 0),
                "amount": float(r.get("成交额", 0) or 0),
                "turnover_rate": float(r.get("换手率", 0) or 0),
                "total_market_cap": float(r.get("总市值", 0) or 0),
                "desc": "",
                "hot_num": 0,
            })
        return out

    def fetch_stock_list(self) -> list[dict]:
        try:
            df = ak.stock_info_a_code_name()
            return [
                {"code": str(row["code"]), "name": str(row["name"])}
                for _, row in df.iterrows()
            ]
        except Exception:
            return []

    def is_trading_day(self, d: date) -> bool:
        if d.weekday() >= 5:
            return False
        try:
            df = ak.tool_trade_date_hist_sina()
            trade_dates = set(pd.to_datetime(df["trade_date"]).dt.date)
            return d in trade_dates
        except Exception:
            return d.weekday() < 5


def _parse_time(val) -> time | None:
    if val is None or pd.isna(val):
        return None
    if isinstance(val, time):
        return val
    s = str(val).strip()
    for fmt in ("%H:%M:%S", "%H:%M", "%H%M%S"):
        try:
            return datetime.strptime(s, fmt).time()
        except ValueError:
            continue
    return None
