from sqlalchemy import String, Date, Numeric, Integer, Boolean, Text, Time, UniqueConstraint, ARRAY
from sqlalchemy.orm import Mapped, mapped_column
from datetime import date, time
from app.database import Base


class LimitUpRecord(Base):
    """涨停明细"""
    __tablename__ = "limit_up_records"
    __table_args__ = (
        UniqueConstraint("stock_code", "trade_date", name="uq_limit_up"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    stock_code: Mapped[str] = mapped_column(String(10), index=True)
    stock_name: Mapped[str | None] = mapped_column(String(50))
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    continuous_days: Mapped[int] = mapped_column(Integer, default=1)
    first_limit_time: Mapped[time | None] = mapped_column(Time)
    last_limit_time: Mapped[time | None] = mapped_column(Time)
    open_count: Mapped[int] = mapped_column(Integer, default=0)  # 炸板次数
    limit_order_amount: Mapped[float | None] = mapped_column(Numeric(18, 2))
    is_one_word: Mapped[bool] = mapped_column(Boolean, default=False)  # 一字板
    is_t_board: Mapped[bool] = mapped_column(Boolean, default=False)   # T字板
    limit_reason: Mapped[str | None] = mapped_column(Text)
    theme_names: Mapped[list[str] | None] = mapped_column(ARRAY(String(100)))
    industry: Mapped[str | None] = mapped_column(String(50), index=True)


class LimitDownRecord(Base):
    """跌停明细"""
    __tablename__ = "limit_down_records"
    __table_args__ = (
        UniqueConstraint("stock_code", "trade_date", name="uq_limit_down"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    stock_code: Mapped[str] = mapped_column(String(10), index=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    continuous_days: Mapped[int] = mapped_column(Integer, default=1)
    is_one_word: Mapped[bool] = mapped_column(Boolean, default=False)


class MarketSentiment(Base):
    """大盘情绪指标"""
    __tablename__ = "market_sentiment"

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    total_amount: Mapped[float] = mapped_column(Numeric(18, 2))        # 大盘成交额
    up_count: Mapped[int] = mapped_column(Integer)                     # 上涨家数
    down_count: Mapped[int] = mapped_column(Integer)                   # 下跌家数
    limit_up_count: Mapped[int] = mapped_column(Integer)               # 涨停家数
    limit_down_count: Mapped[int] = mapped_column(Integer)             # 跌停家数
    broken_limit_count: Mapped[int] = mapped_column(Integer, default=0)  # 炸板数
    broken_rate: Mapped[float] = mapped_column(Numeric(8, 4), default=0) # 炸板率
    max_height: Mapped[int] = mapped_column(Integer, default=0)        # 最高连板
    open_limit_up: Mapped[int] = mapped_column(Integer, default=0)     # 开盘涨停
    open_limit_down: Mapped[int] = mapped_column(Integer, default=0)   # 开盘跌停
    open_high_count: Mapped[int] = mapped_column(Integer, default=0)   # 高开家数
    open_low_count: Mapped[int] = mapped_column(Integer, default=0)    # 大低开家数(≥5%低开)
    up_rate: Mapped[float | None] = mapped_column(Numeric(8, 4))       # 收盘上涨率
    sh_up_rate: Mapped[float | None] = mapped_column(Numeric(8, 4))    # 上证主板上涨率
    sz_up_rate: Mapped[float | None] = mapped_column(Numeric(8, 4))    # 深证主板上涨率
    gem_up_rate: Mapped[float | None] = mapped_column(Numeric(8, 4))   # 创业板上涨率
    yesterday_lu_up_rate: Mapped[float | None] = mapped_column(Numeric(8, 4))      # 昨涨停今上涨率(赚钱效应)
    yesterday_panic_up_rate: Mapped[float | None] = mapped_column(Numeric(8, 4))   # 昨≥4板今上涨率(妖股次日)
    yesterday_weak_up_rate: Mapped[float | None] = mapped_column(Numeric(8, 4))    # 昨跌停今上涨率(弱势次日)
    main_lu_open_avg: Mapped[float | None] = mapped_column(Numeric(8, 4))    # 主板昨涨停今开盘平均涨幅
    main_lu_body_avg: Mapped[float | None] = mapped_column(Numeric(8, 4))    # 主板昨涨停今实体涨幅 (close-open)/open
    main_lu_change_avg: Mapped[float | None] = mapped_column(Numeric(8, 4))  # 主板昨涨停今平均涨幅 (close-pre_close)/pre_close
    gem_lu_open_avg: Mapped[float | None] = mapped_column(Numeric(8, 4))     # 创业板昨涨停今开盘平均涨幅
    gem_lu_body_avg: Mapped[float | None] = mapped_column(Numeric(8, 4))     # 创业板昨涨停今实体涨幅
    gem_lu_change_avg: Mapped[float | None] = mapped_column(Numeric(8, 4))   # 创业板昨涨停今平均涨幅
    one_word_count: Mapped[int] = mapped_column(Integer, default=0)    # 一字板数量
    # DEPRECATED: 历史综合情绪分, 当前 pipeline 不再写入, 保留列避免破坏旧表; 未来如需 DROP 走单独迁移.
    sentiment_score: Mapped[float | None] = mapped_column(Numeric(8, 4))


class LadderSummary(Base):
    """连板梯队汇总——每日每层级一条"""
    __tablename__ = "ladder_summary"
    __table_args__ = (
        UniqueConstraint("trade_date", "board_level", name="uq_ladder"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    board_level: Mapped[int] = mapped_column(Integer)  # 1,2,3,4,5,6,7(含7+)
    stock_count: Mapped[int] = mapped_column(Integer)
    promotion_count: Mapped[int] = mapped_column(Integer, default=0)
    promotion_rate: Mapped[float] = mapped_column(Numeric(8, 4), default=0)
