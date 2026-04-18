"""数据源适配器接口。

切换数据源只需：
1. 新建一个 XxxAdapter(DataSourceAdapter) 类
2. 在 .env 中设置 DATA_SOURCE=xxx
不改动任何管线逻辑。
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, time


@dataclass
class RawDailyQuote:
    stock_code: str
    trade_date: date
    open: float
    high: float
    low: float
    close: float
    pre_close: float
    change_pct: float
    volume: int
    amount: float
    turnover_rate: float | None = None
    amplitude: float | None = None


@dataclass
class RawLimitUp:
    stock_code: str
    stock_name: str
    trade_date: date
    continuous_days: int = 1
    first_limit_time: time | None = None
    last_limit_time: time | None = None
    open_count: int = 0
    limit_order_amount: float | None = None
    is_one_word: bool = False
    is_t_board: bool = False
    limit_reason: str | None = None
    industry: str | None = None
    theme_names: list[str] = field(default_factory=list)


@dataclass
class RawThemeData:
    theme_name: str
    stocks: list[str]  # 成分股代码列表


class DataSourceAdapter(ABC):
    """数据源适配器抽象基类"""

    @abstractmethod
    def fetch_daily_quotes(self, trade_date: date) -> list[RawDailyQuote]:
        ...

    @abstractmethod
    def fetch_limit_up(self, trade_date: date) -> list[RawLimitUp]:
        ...

    @abstractmethod
    def fetch_limit_down(self, trade_date: date) -> list[str]:
        """返回跌停股票代码列表"""
        ...

    @abstractmethod
    def fetch_themes(self) -> list[RawThemeData]:
        """获取概念板块及其成分股"""
        ...

    @abstractmethod
    def fetch_stock_list(self) -> list[dict]:
        """获取全部A股列表"""
        ...

    @abstractmethod
    def is_trading_day(self, d: date) -> bool:
        ...
