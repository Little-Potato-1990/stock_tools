"""ETF 关键名单注册.

国家队代理变量: 汇金救市靠扫这些宽基 ETF, 当日份额突增 = 国家队入场最强信号.
行业 ETF 用于观察特定赛道资金流向.
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class EtfMeta:
    code: str
    name: str
    category: str  # national_team_broad / national_team_industry / hot_theme / dividend / bond / other
    note: str = ""


# 国家队首选——宽基 ETF (汇金 2024 年 9 月救市重点扫货标的)
NATIONAL_TEAM_BROAD: list[EtfMeta] = [
    EtfMeta("510300", "沪深300ETF", "national_team_broad", "汇金核心持仓"),
    EtfMeta("510050", "上证50ETF", "national_team_broad", "汇金核心持仓"),
    EtfMeta("510500", "中证500ETF", "national_team_broad", "汇金中盘配置"),
    EtfMeta("159915", "创业板ETF", "national_team_broad", "汇金成长配置"),
    EtfMeta("588000", "科创50ETF", "national_team_broad", "汇金科技配置"),
    EtfMeta("159922", "中证1000ETF", "national_team_broad", "汇金小盘对冲"),
    EtfMeta("159949", "创业板50ETF", "national_team_broad", ""),
    EtfMeta("510180", "上证180ETF", "national_team_broad", ""),
]

# 行业 ETF——观察行业资金倾向
NATIONAL_TEAM_INDUSTRY: list[EtfMeta] = [
    EtfMeta("512880", "证券ETF", "national_team_industry", "牛市先锋指标"),
    EtfMeta("512170", "医疗ETF", "national_team_industry", ""),
    EtfMeta("512760", "芯片ETF", "national_team_industry", ""),
    EtfMeta("512480", "半导体ETF", "national_team_industry", ""),
    EtfMeta("515000", "科技ETF", "national_team_industry", ""),
    EtfMeta("512690", "酒ETF", "national_team_industry", ""),
    EtfMeta("512660", "军工ETF", "national_team_industry", ""),
    EtfMeta("512200", "房地产ETF", "national_team_industry", ""),
]

# 红利 / 防御
DIVIDEND: list[EtfMeta] = [
    EtfMeta("510880", "红利ETF", "dividend", "防御资金代理"),
    EtfMeta("563020", "红利低波ETF", "dividend", ""),
]


def all_tracked_etfs() -> list[EtfMeta]:
    return [*NATIONAL_TEAM_BROAD, *NATIONAL_TEAM_INDUSTRY, *DIVIDEND]


def by_code(code: str) -> EtfMeta | None:
    for it in all_tracked_etfs():
        if it.code == code:
            return it
    return None
