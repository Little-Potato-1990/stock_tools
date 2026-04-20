"""盘中异动 (anomaly) 中英对照 — API / brief / 前端展示共用.

放在 intraday 子包下避免循环 import (anomaly_detector 写入 anomaly_type, brief 与 api
读后做展示).
"""
from __future__ import annotations

ANOMALY_TYPE_LABEL: dict[str, str] = {
    "surge": "急拉",
    "plunge": "闪崩",
    "break": "涨停打开",
    "seal": "反包封板",
    "theme_burst": "板块异动",
}


def label_anomaly(anomaly_type: str) -> str:
    """安全取标签, 未知类型 fallback 为原值, 让前端不会因 None 报错."""
    return ANOMALY_TYPE_LABEL.get(anomaly_type, anomaly_type)
