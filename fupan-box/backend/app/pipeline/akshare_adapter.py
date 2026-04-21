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
        # ak.stock_zh_a_spot_em 是当日实时, 不接受 trade_date; 调用方会用 trade_date 入库.
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

    # ==================== 资金维度 ====================

    def fetch_market_fund_flow(self, trade_date: date) -> dict | None:
        """大盘资金流——主力 / 超大单 / 大单 / 中单 / 小单 净流入(亿元)."""
        try:
            df = ak.stock_market_fund_flow()
        except Exception as e:
            logger.warning(f"stock_market_fund_flow: {e}")
            return None
        if df is None or df.empty:
            return None
        date_col = next((c for c in df.columns if "日期" in c), None)
        if date_col:
            df[date_col] = pd.to_datetime(df[date_col]).dt.date
            row = df[df[date_col] == trade_date]
            if row.empty:
                row = df.tail(1)
        else:
            row = df.tail(1)
        r = row.iloc[0]
        out = {"trade_date": trade_date.isoformat()}
        for k in ["主力净流入-净额", "超大单净流入-净额", "大单净流入-净额",
                  "中单净流入-净额", "小单净流入-净额",
                  "上证-收盘价", "上证-涨跌幅", "深证-收盘价", "深证-涨跌幅"]:
            if k in r.index:
                try:
                    out[k] = float(r[k])
                except (TypeError, ValueError):
                    out[k] = None
        return out

    def fetch_north_fund_flow(self, trade_date: date) -> dict | None:
        """北向资金当日净流入(沪股通/深股通分项)."""
        try:
            df = ak.stock_hsgt_fund_flow_summary_em()
        except Exception as e:
            logger.warning(f"stock_hsgt_fund_flow_summary_em: {e}")
            return None
        if df is None or df.empty:
            return None
        out = {"trade_date": trade_date.isoformat(), "items": []}
        for _, r in df.iterrows():
            try:
                out["items"].append({
                    "type": str(r.get("资金方向", "")),
                    "板块": str(r.get("板块", "")),
                    "成交净买额": float(r.get("成交净买额", 0) or 0),
                    "买入成交额": float(r.get("买入成交额", 0) or 0),
                    "卖出成交额": float(r.get("卖出成交额", 0) or 0),
                    "领涨股": str(r.get("领涨股", "")),
                    "领涨股涨跌幅": float(r.get("领涨股-涨跌幅", 0) or 0) if "领涨股-涨跌幅" in r.index else None,
                })
            except (ValueError, TypeError):
                continue
        net = sum(i["成交净买额"] for i in out["items"] if i["type"] in ("北向", "净流入") or "买" in i["type"])
        out["net_inflow"] = net
        return out

    def fetch_north_hold(self, trade_date: date, top: int = 200) -> list[dict]:
        """北向资金个股持股 Top N (按持股市值排序). trade_date 仅用于调用方入库标识."""
        candidates = [
            ("stock_hsgt_hold_stock_em", {"market": "北向", "indicator": "今日排行"}),
            ("stock_hsgt_hold_stock_em", {"market": "北向", "indicator": "5日排行"}),
        ]
        df = None
        last_err = None
        for fn, kw in candidates:
            try:
                df = getattr(ak, fn)(**kw)
                if df is not None and not df.empty:
                    break
            except Exception as e:
                last_err = e
                df = None
        if df is None or df.empty:
            logger.warning(f"north_hold empty: {last_err}")
            return []
        results = []
        for _, r in df.head(top).iterrows():
            code = str(r.get("代码", "") or r.get("stock_code", "")).zfill(6)
            if not code or code == "000000":
                continue
            try:
                results.append({
                    "stock_code": code,
                    "stock_name": str(r.get("名称", "") or r.get("stock_name", "")),
                    "hold_shares": float(r.get("持股数量", 0) or r.get("hold_shares", 0) or 0),
                    "hold_amount": float(r.get("持股市值", 0) or r.get("hold_market_cap", 0) or 0),
                    "hold_pct": float(r.get("持股占流通股比", 0) or r.get("hold_pct", 0) or 0),
                    "chg_shares": float(r.get("今日增持估计-股", 0) or 0) if "今日增持估计-股" in r.index else None,
                    "chg_amount": float(r.get("今日增持估计-市值", 0) or 0) if "今日增持估计-市值" in r.index else None,
                })
            except (ValueError, TypeError):
                continue
        return results

    def fetch_concept_fund_flow(self, trade_date: date) -> list[dict]:
        """概念板块主力净流入排名(当日)."""
        try:
            df = ak.stock_sector_fund_flow_rank(indicator="今日", sector_type="概念资金流")
        except Exception as e:
            logger.warning(f"stock_sector_fund_flow_rank concept: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            name = str(r.get("名称", "") or r.get("板块", ""))
            if not name:
                continue
            try:
                out.append({
                    "name": name,
                    "change_pct": float(r.get("今日涨跌幅", 0) or 0),
                    "main_inflow": float(r.get("今日主力净流入-净额", 0) or 0),
                    "main_inflow_pct": float(r.get("今日主力净流入-净占比", 0) or 0),
                    "huge_inflow": float(r.get("今日超大单净流入-净额", 0) or 0),
                    "big_inflow": float(r.get("今日大单净流入-净额", 0) or 0),
                    "lead_stock": str(r.get("今日主力净流入最大股", "") or r.get("领涨股", "")),
                })
            except (ValueError, TypeError):
                continue
        return out

    def fetch_industry_fund_flow(self, trade_date: date) -> list[dict]:
        """行业板块主力净流入排名(当日)."""
        try:
            df = ak.stock_sector_fund_flow_rank(indicator="今日", sector_type="行业资金流")
        except Exception as e:
            logger.warning(f"stock_sector_fund_flow_rank industry: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            name = str(r.get("名称", "") or r.get("板块", ""))
            if not name:
                continue
            try:
                out.append({
                    "name": name,
                    "change_pct": float(r.get("今日涨跌幅", 0) or 0),
                    "main_inflow": float(r.get("今日主力净流入-净额", 0) or 0),
                    "main_inflow_pct": float(r.get("今日主力净流入-净占比", 0) or 0),
                    "huge_inflow": float(r.get("今日超大单净流入-净额", 0) or 0),
                    "big_inflow": float(r.get("今日大单净流入-净额", 0) or 0),
                    "lead_stock": str(r.get("今日主力净流入最大股", "") or r.get("领涨股", "")),
                })
            except (ValueError, TypeError):
                continue
        return out

    def fetch_stock_fund_flow_rank(self, trade_date: date) -> list[dict]:
        """个股主力净流入排名(当日)."""
        try:
            df = ak.stock_individual_fund_flow_rank(indicator="今日")
        except Exception as e:
            logger.warning(f"stock_individual_fund_flow_rank: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            code = str(r.get("代码", "")).zfill(6)
            if not code or code == "000000":
                continue
            try:
                out.append({
                    "stock_code": code,
                    "stock_name": str(r.get("名称", "")),
                    "close": float(r.get("最新价", 0) or 0),
                    "change_pct": float(r.get("今日涨跌幅", 0) or 0),
                    "main_inflow": float(r.get("今日主力净流入-净额", 0) or 0),
                    "main_inflow_pct": float(r.get("今日主力净流入-净占比", 0) or 0),
                    "huge_inflow": float(r.get("今日超大单净流入-净额", 0) or 0),
                    "big_inflow": float(r.get("今日大单净流入-净额", 0) or 0),
                    "mid_inflow": float(r.get("今日中单净流入-净额", 0) or 0),
                    "small_inflow": float(r.get("今日小单净流入-净额", 0) or 0),
                })
            except (ValueError, TypeError):
                continue
        return out

    def fetch_etf_spot(self, trade_date: date | None = None) -> list[dict]:
        """ETF 实时行情(akshare 仅支持实时盘口, trade_date 仅作签名对齐用)."""
        try:
            df = ak.fund_etf_spot_em()
        except Exception as e:
            logger.warning(f"fund_etf_spot_em: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            code = str(r.get("代码", "")).zfill(6)
            if not code or code == "000000":
                continue
            try:
                out.append({
                    "etf_code": code,
                    "etf_name": str(r.get("名称", "")),
                    "close": float(r.get("最新价", 0) or 0),
                    "change_pct": float(r.get("涨跌幅", 0) or 0),
                    "amount": float(r.get("成交额", 0) or 0),
                    "volume": float(r.get("成交量", 0) or 0),
                    "nav": float(r.get("IOPV实时估值", 0) or 0) if "IOPV实时估值" in r.index else None,
                    "premium_rate": float(r.get("折价率", 0) or 0) if "折价率" in r.index else None,
                })
            except (ValueError, TypeError):
                continue
        return out

    def fetch_etf_share(self, etf_code: str) -> dict | None:
        """单只 ETF 历史份额(日频), 用来算净申购."""
        try:
            df = ak.fund_etf_fund_info_em(fund=etf_code)
        except Exception as e:
            logger.warning(f"fund_etf_fund_info_em({etf_code}): {e}")
            return None
        if df is None or df.empty:
            return None
        try:
            df["净值日期"] = pd.to_datetime(df["净值日期"]).dt.date
        except Exception:
            return None
        return {
            "etf_code": etf_code,
            "history": df.tail(20).to_dict(orient="records"),
        }

    def fetch_announce_increase_decrease(self, trade_date: date) -> list[dict]:
        """重要股东增减持公告(akshare 仅有近期, 不区分日期, 调用方筛选)."""
        try:
            df = ak.stock_share_hold_change_bse()
        except Exception:
            try:
                df = ak.stock_share_hold_change_szse()
            except Exception as e:
                logger.warning(f"announce inc/dec: {e}")
                return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            code = str(r.get("证券代码", "") or r.get("code", "")).zfill(6)
            if not code or code == "000000":
                continue
            try:
                amt = float(r.get("变动数量", 0) or r.get("变动股数", 0) or 0)
                event_type = "increase" if amt > 0 else "decrease"
                out.append({
                    "stock_code": code,
                    "stock_name": str(r.get("证券简称", "") or r.get("name", "")),
                    "event_type": event_type,
                    "actor": str(r.get("股东名称", "") or r.get("董监高姓名", "") or ""),
                    "actor_type": "exec" if "董监高" in str(r.get("身份", "")) else "major_holder",
                    "shares": abs(amt),
                    "scale": float(r.get("成交均价", 0) or 0) * abs(amt) / 10000 if r.get("成交均价") else None,
                    "trade_date": str(r.get("变动日期", "") or trade_date.isoformat())[:10],
                    "detail": {k: str(v) for k, v in r.items()},
                })
            except (ValueError, TypeError):
                continue
        return out

    def fetch_announce_repurchase(self, trade_date: date) -> list[dict]:
        """公司回购公告."""
        try:
            df = ak.stock_repurchase_em()
        except Exception as e:
            logger.warning(f"stock_repurchase_em: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            code = str(r.get("代码", "") or r.get("证券代码", "")).zfill(6)
            if not code or code == "000000":
                continue
            try:
                out.append({
                    "stock_code": code,
                    "stock_name": str(r.get("名称", "") or r.get("证券简称", "")),
                    "event_type": "repurchase",
                    "actor": str(r.get("名称", "")),
                    "actor_type": "self_company",
                    "shares": float(r.get("已回购股份数量", 0) or 0),
                    "scale": float(r.get("已回购金额", 0) or 0) / 10000,
                    "progress": str(r.get("最新公告日期", "")),
                    "trade_date": str(r.get("最新公告日期", "") or trade_date.isoformat())[:10],
                    "detail": {k: str(v) for k, v in r.items()},
                })
            except (ValueError, TypeError):
                continue
        return out

    def fetch_announce_placard(self, trade_date: date) -> list[dict]:
        """举牌公告."""
        try:
            df = ak.stock_jubai_jzlh_em()
        except Exception as e:
            logger.warning(f"stock_jubai: {e}")
            return []
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            code = str(r.get("被举牌股票代码", "") or r.get("代码", "")).zfill(6)
            if not code or code == "000000":
                continue
            try:
                out.append({
                    "stock_code": code,
                    "stock_name": str(r.get("被举牌股票", "") or r.get("名称", "")),
                    "event_type": "placard",
                    "actor": str(r.get("举牌方", "") or ""),
                    "actor_type": "external",
                    "shares": float(r.get("举牌数量", 0) or 0),
                    "scale": float(r.get("举牌金额", 0) or 0) / 10000,
                    "trade_date": str(r.get("举牌日期", "") or trade_date.isoformat())[:10],
                    "detail": {k: str(v) for k, v in r.items()},
                })
            except (ValueError, TypeError):
                continue
        return out

    def fetch_holder_top10(self, stock_code: str, report_date: date | None = None) -> list[dict]:
        """前十大股东(按报告期)."""
        try:
            df = ak.stock_gdfx_top_10_em(symbol=_with_sh_sz(stock_code))
        except Exception as e:
            logger.warning(f"stock_gdfx_top_10_em({stock_code}): {e}")
            return []
        if df is None or df.empty:
            return []
        results = []
        for _, r in df.iterrows():
            try:
                rd_raw = r.get("截止日期", "")
                rd = pd.to_datetime(rd_raw).date() if rd_raw else None
                if report_date and rd and rd != report_date:
                    continue
                results.append({
                    "report_date": rd.isoformat() if rd else None,
                    "stock_code": stock_code,
                    "holder_name": str(r.get("股东名称", "")),
                    "rank": int(r.get("排名", 0) or 0),
                    "shares": float(r.get("持股数", 0) or 0),
                    "shares_pct": float(r.get("持股比例", 0) or 0),
                    "change_shares": float(r.get("增减", 0) or 0) if "增减" in r.index else None,
                    "is_free_float": False,
                })
            except (ValueError, TypeError):
                continue
        return results

    def fetch_holder_free_top10(self, stock_code: str, report_date: date | None = None) -> list[dict]:
        """前十大流通股东(按报告期)."""
        try:
            df = ak.stock_gdfx_free_top_10_em(symbol=_with_sh_sz(stock_code))
        except Exception as e:
            logger.warning(f"stock_gdfx_free_top_10_em({stock_code}): {e}")
            return []
        if df is None or df.empty:
            return []
        results = []
        for _, r in df.iterrows():
            try:
                rd_raw = r.get("截止日期", "")
                rd = pd.to_datetime(rd_raw).date() if rd_raw else None
                if report_date and rd and rd != report_date:
                    continue
                results.append({
                    "report_date": rd.isoformat() if rd else None,
                    "stock_code": stock_code,
                    "holder_name": str(r.get("股东名称", "")),
                    "rank": int(r.get("排名", 0) or 0),
                    "shares": float(r.get("持股数", 0) or 0),
                    "shares_pct": float(r.get("持股比例", 0) or 0),
                    "change_shares": float(r.get("增减", 0) or 0) if "增减" in r.index else None,
                    "is_free_float": True,
                })
            except (ValueError, TypeError):
                continue
        return results


def _with_sh_sz(code: str) -> str:
    """6 位代码补 sh/sz/bj 前缀(akshare gdfx 接口需要)."""
    code = str(code).zfill(6)
    if code.startswith(("60", "68", "9")):
        return f"sh{code}"
    if code.startswith("8") or code.startswith("4"):
        return f"bj{code}"
    return f"sz{code}"


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
