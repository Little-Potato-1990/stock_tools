"""数据管线：采集 → 清洗 → 计算 → 预聚合 → 写入。

入口函数 run_daily_pipeline(trade_date) 供 Celery 定时任务调用。
"""

import logging
from datetime import date, datetime
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, delete
from app.config import get_settings
from app.database import Base
from app.models.stock import Stock, DailyQuote
from app.models.market import LimitUpRecord, LimitDownRecord, MarketSentiment, LadderSummary
from app.models.snapshot import DailySnapshot, DataUpdateLog
from app.models.capital import (
    CapitalFlowDaily, NorthHoldDaily, EtfFlowDaily, AnnouncementEvent,
)
from app.pipeline.akshare_adapter import AKShareAdapter
from app.services.etf_registry import all_tracked_etfs, by_code as etf_meta_by_code

logger = logging.getLogger(__name__)
settings = get_settings()


def get_adapter():
    if settings.data_source == "akshare":
        return AKShareAdapter()
    if settings.data_source == "tushare":
        from app.pipeline.tushare_adapter import TushareAdapter
        return TushareAdapter()
    raise ValueError(f"Unknown data source: {settings.data_source}")


def _classify_market(code: str) -> str:
    """按 stock_code 后 6 位前缀分桶: sh_main/sz_main/gem/star/bj/other"""
    if not code:
        return "other"
    six = code[-6:]
    c2, c3 = six[:2], six[:3]
    if c3 in ("688", "689"):
        return "star"
    if c2 == "30":
        return "gem"
    if c2 == "60":
        return "sh_main"
    if c2 == "00":
        return "sz_main"
    if c2 in ("83", "87", "88", "92", "43"):
        return "bj"
    return "other"


def _log_step(session: Session, trade_date: date, step: str, status: str, **kwargs):
    log = DataUpdateLog(
        trade_date=trade_date, step=step, status=status,
        records_count=kwargs.get("records_count", 0),
        error_message=kwargs.get("error_message"),
        finished_at=datetime.now() if status != "running" else None,
    )
    session.add(log)
    session.commit()


def run_daily_pipeline(trade_date: date | None = None):
    """主入口：跑完整的日采集管线"""
    engine = create_engine(settings.database_url_sync)
    Base.metadata.create_all(engine)

    if trade_date is None:
        trade_date = date.today()

    adapter = get_adapter()

    if not adapter.is_trading_day(trade_date):
        logger.info(f"{trade_date} is not a trading day, skipping.")
        return

    with Session(engine) as session:
        try:
            _step_collect(session, adapter, trade_date)
            _step_compute(session, trade_date)
            _step_aggregate(session, adapter, trade_date)
            _step_collect_capital(session, adapter, trade_date)
            _step_collect_north_hold(session, adapter, trade_date)
            _step_collect_etf(session, adapter, trade_date)
            _step_collect_announce(session, adapter, trade_date)
            logger.info(f"Pipeline completed for {trade_date}")
        except Exception as e:
            logger.exception(f"Pipeline failed for {trade_date}")
            _log_step(session, trade_date, "pipeline", "failed", error_message=str(e))
            raise


def _step_collect(session: Session, adapter, trade_date: date):
    """Step 1: 采集原始数据"""
    _log_step(session, trade_date, "collect", "running")

    # 涨停数据
    raw_limit_ups = adapter.fetch_limit_up(trade_date)
    session.execute(delete(LimitUpRecord).where(LimitUpRecord.trade_date == trade_date))
    for r in raw_limit_ups:
        session.add(LimitUpRecord(
            stock_code=r.stock_code,
            stock_name=r.stock_name,
            trade_date=r.trade_date,
            continuous_days=r.continuous_days,
            first_limit_time=r.first_limit_time,
            last_limit_time=r.last_limit_time,
            open_count=r.open_count,
            limit_order_amount=r.limit_order_amount,
            is_one_word=r.is_one_word,
            is_t_board=r.is_t_board,
            limit_reason=r.limit_reason,
            theme_names=r.theme_names if r.theme_names else None,
            industry=r.industry,
        ))
    session.commit()

    # 日K线
    raw_quotes = adapter.fetch_daily_quotes(trade_date)
    session.execute(delete(DailyQuote).where(DailyQuote.trade_date == trade_date))
    limit_up_codes = {r.stock_code for r in raw_limit_ups}
    limit_down_codes = set(adapter.fetch_limit_down(trade_date))

    for q in raw_quotes:
        session.add(DailyQuote(
            stock_code=q.stock_code,
            trade_date=q.trade_date,
            open=q.open, high=q.high, low=q.low, close=q.close,
            pre_close=q.pre_close, change_pct=q.change_pct,
            volume=q.volume, amount=q.amount,
            turnover_rate=q.turnover_rate, amplitude=q.amplitude,
            is_limit_up=q.stock_code in limit_up_codes,
            is_limit_down=q.stock_code in limit_down_codes,
        ))
    session.commit()

    _log_step(session, trade_date, "collect", "success",
              records_count=len(raw_quotes) + len(raw_limit_ups))


def _step_compute(session: Session, trade_date: date):
    """Step 2: 计算衍生指标（梯队、情绪等）"""
    _log_step(session, trade_date, "compute", "running")

    limit_ups = session.query(LimitUpRecord).filter(
        LimitUpRecord.trade_date == trade_date
    ).all()

    quotes = session.query(DailyQuote).filter(
        DailyQuote.trade_date == trade_date
    ).all()

    up_count = sum(1 for q in quotes if q.change_pct and float(q.change_pct) > 0)
    down_count = sum(1 for q in quotes if q.change_pct and float(q.change_pct) < 0)
    total_amount = sum(float(q.amount or 0) for q in quotes)
    limit_down_count = sum(1 for q in quotes if q.is_limit_down)
    broken_count = sum(1 for r in limit_ups if r.open_count and r.open_count > 0)
    max_height = max((r.continuous_days for r in limit_ups), default=0)
    broken_rate = broken_count / len(limit_ups) if limit_ups else 0

    total_stocks = up_count + down_count
    up_rate = round(up_count / total_stocks, 4) if total_stocks > 0 else 0

    open_high = 0
    open_low = 0
    for q in quotes:
        if q.pre_close and float(q.pre_close) > 0:
            ratio = float(q.open or 0) / float(q.pre_close)
            if ratio > 1.0:
                open_high += 1
            if ratio <= 0.95:
                open_low += 1

    one_word = sum(1 for r in limit_ups if r.is_one_word)

    # 三市场分桶上涨率
    sh_up, sh_total = 0, 0
    sz_up, sz_total = 0, 0
    gem_up, gem_total = 0, 0
    for q in quotes:
        market = _classify_market(q.stock_code)
        if market not in ("sh_main", "sz_main", "gem"):
            continue
        if not q.change_pct:
            continue
        is_up = float(q.change_pct) > 0
        if market == "sh_main":
            sh_total += 1
            sh_up += 1 if is_up else 0
        elif market == "sz_main":
            sz_total += 1
            sz_up += 1 if is_up else 0
        elif market == "gem":
            gem_total += 1
            gem_up += 1 if is_up else 0
    sh_up_rate = round(sh_up / sh_total, 4) if sh_total else None
    sz_up_rate = round(sz_up / sz_total, 4) if sz_total else None
    gem_up_rate = round(gem_up / gem_total, 4) if gem_total else None

    # 开盘涨停: limit_ups 中 first_limit_time <= 09:30:00
    from datetime import time as dtime
    open_lu_count = sum(
        1 for r in limit_ups
        if r.first_limit_time and r.first_limit_time <= dtime(9, 30, 0)
    )
    # 开盘跌停: 当日跌停且 open == low (开盘即封死跌停的近似判定)
    open_ld_count = sum(
        1 for q in quotes
        if q.is_limit_down and q.open and q.low and float(q.open) == float(q.low)
    )

    # 昨日衍生上涨率: 昨涨停 / 昨≥4板妖股 / 昨跌停 各自今日上涨率
    from sqlalchemy import func as sa_func
    prev_date = session.query(sa_func.max(MarketSentiment.trade_date)).filter(
        MarketSentiment.trade_date < trade_date
    ).scalar()
    yesterday_lu_rate = None
    yesterday_panic_rate = None
    yesterday_weak_rate = None
    main_lu_open_avg = main_lu_body_avg = main_lu_change_avg = None
    gem_lu_open_avg = gem_lu_body_avg = gem_lu_change_avg = None
    if prev_date:
        today_quotes_map = {q.stock_code: q for q in quotes}

        def _up_rate_of(codes: list[str]) -> float | None:
            if not codes:
                return None
            ups = sum(
                1 for c in codes
                if c in today_quotes_map and today_quotes_map[c].change_pct
                and float(today_quotes_map[c].change_pct) > 0
            )
            return round(ups / len(codes), 4)

        prev_lu_records = session.query(LimitUpRecord).filter(
            LimitUpRecord.trade_date == prev_date
        ).all()
        prev_lu_codes = [r.stock_code for r in prev_lu_records]
        prev_panic_codes = [r.stock_code for r in prev_lu_records if r.continuous_days >= 4]
        prev_weak_codes = [
            r.stock_code for r in
            session.query(LimitDownRecord).filter(LimitDownRecord.trade_date == prev_date).all()
        ]

        yesterday_lu_rate = _up_rate_of(prev_lu_codes)
        yesterday_panic_rate = _up_rate_of(prev_panic_codes)
        yesterday_weak_rate = _up_rate_of(prev_weak_codes)

        # 主板/创业板 昨涨停 今 开盘/实体/涨幅 三均值
        def _avg_pct_of(codes: list[str]) -> tuple[float | None, float | None, float | None]:
            opens, bodies, changes = [], [], []
            for c in codes:
                q = today_quotes_map.get(c)
                if not q or not q.pre_close or not q.open or not q.close:
                    continue
                pre = float(q.pre_close)
                op = float(q.open)
                cl = float(q.close)
                if pre <= 0 or op <= 0:
                    continue
                opens.append((op - pre) / pre)
                bodies.append((cl - op) / op)
                changes.append((cl - pre) / pre)
            mean = lambda xs: round(sum(xs) / len(xs), 4) if xs else None
            return mean(opens), mean(bodies), mean(changes)

        main_codes = [c for c in prev_lu_codes if _classify_market(c) == "sh_main" or _classify_market(c) == "sz_main"]
        gem_codes = [c for c in prev_lu_codes if _classify_market(c) == "gem"]
        main_lu_open_avg, main_lu_body_avg, main_lu_change_avg = _avg_pct_of(main_codes)
        gem_lu_open_avg, gem_lu_body_avg, gem_lu_change_avg = _avg_pct_of(gem_codes)

    session.execute(delete(MarketSentiment).where(MarketSentiment.trade_date == trade_date))
    session.add(MarketSentiment(
        trade_date=trade_date,
        total_amount=total_amount,
        up_count=up_count,
        down_count=down_count,
        limit_up_count=len(limit_ups),
        limit_down_count=limit_down_count,
        broken_limit_count=broken_count,
        broken_rate=round(broken_rate, 4),
        max_height=max_height,
        open_limit_up=open_lu_count,
        open_limit_down=open_ld_count,
        open_high_count=open_high,
        open_low_count=open_low,
        up_rate=up_rate,
        sh_up_rate=sh_up_rate,
        sz_up_rate=sz_up_rate,
        gem_up_rate=gem_up_rate,
        yesterday_lu_up_rate=yesterday_lu_rate,
        yesterday_panic_up_rate=yesterday_panic_rate,
        yesterday_weak_up_rate=yesterday_weak_rate,
        main_lu_open_avg=main_lu_open_avg,
        main_lu_body_avg=main_lu_body_avg,
        main_lu_change_avg=main_lu_change_avg,
        gem_lu_open_avg=gem_lu_open_avg,
        gem_lu_body_avg=gem_lu_body_avg,
        gem_lu_change_avg=gem_lu_change_avg,
        one_word_count=one_word,
    ))

    # 梯队汇总
    from collections import Counter
    level_counts = Counter()
    for r in limit_ups:
        level = min(r.continuous_days, 7)
        level_counts[level] += 1

    session.execute(delete(LadderSummary).where(LadderSummary.trade_date == trade_date))
    for level in range(1, 8):
        session.add(LadderSummary(
            trade_date=trade_date,
            board_level=level,
            stock_count=level_counts.get(level, 0),
            promotion_count=0,
            promotion_rate=0,
        ))
    session.commit()

    _step_compute_promotion(session, trade_date)
    _log_step(session, trade_date, "compute", "success", records_count=len(limit_ups))


def _step_compute_promotion(session: Session, trade_date: date):
    """计算晋级率：昨天 N 板中有几个今天变成了 N+1 板"""
    from sqlalchemy import func
    prev_date_row = session.query(func.max(MarketSentiment.trade_date)).filter(
        MarketSentiment.trade_date < trade_date
    ).scalar()
    if not prev_date_row:
        return

    prev_date = prev_date_row
    today_map = {}
    for r in session.query(LimitUpRecord).filter(LimitUpRecord.trade_date == trade_date).all():
        today_map[r.stock_code] = r.continuous_days

    prev_limit_ups = session.query(LimitUpRecord).filter(
        LimitUpRecord.trade_date == prev_date
    ).all()

    from collections import Counter
    promotions = Counter()
    for r in prev_limit_ups:
        prev_level = min(r.continuous_days, 7)
        if r.stock_code in today_map and today_map[r.stock_code] > r.continuous_days:
            promotions[prev_level] += 1

    prev_level_counts = Counter()
    for r in prev_limit_ups:
        prev_level_counts[min(r.continuous_days, 7)] += 1

    for ladder in session.query(LadderSummary).filter(LadderSummary.trade_date == trade_date).all():
        prev_count = prev_level_counts.get(ladder.board_level, 0)
        promo = promotions.get(ladder.board_level, 0)
        ladder.promotion_count = promo
        ladder.promotion_rate = round(promo / prev_count, 4) if prev_count > 0 else 0

    session.commit()


def _step_aggregate(session: Session, adapter, trade_date: date):
    """Step 3: 生成预聚合 JSON 快照"""
    _log_step(session, trade_date, "aggregate", "running")
    session.execute(delete(DailySnapshot).where(DailySnapshot.trade_date == trade_date))

    # Overview 快照
    sent = session.query(MarketSentiment).filter(MarketSentiment.trade_date == trade_date).first()
    if sent:
        session.add(DailySnapshot(
            trade_date=trade_date,
            snapshot_type="overview",
            data={
                "total_amount": float(sent.total_amount),
                "limit_up_count": sent.limit_up_count,
                "limit_down_count": sent.limit_down_count,
                "broken_limit_count": sent.broken_limit_count,
                "broken_rate": float(sent.broken_rate),
                "max_height": sent.max_height,
                "up_count": sent.up_count,
                "down_count": sent.down_count,
                "up_rate": float(sent.up_rate) if sent.up_rate else 0,
                "open_high_count": sent.open_high_count,
                "open_low_count": sent.open_low_count,
                "open_limit_up_count": sent.open_limit_up,
                "open_limit_down_count": sent.open_limit_down,
                "sh_up_rate": float(sent.sh_up_rate) if sent.sh_up_rate is not None else None,
                "sz_up_rate": float(sent.sz_up_rate) if sent.sz_up_rate is not None else None,
                "gem_up_rate": float(sent.gem_up_rate) if sent.gem_up_rate is not None else None,
                "yesterday_lu_up_rate": float(sent.yesterday_lu_up_rate) if sent.yesterday_lu_up_rate is not None else None,
                "yesterday_panic_up_rate": float(sent.yesterday_panic_up_rate) if sent.yesterday_panic_up_rate is not None else None,
                "yesterday_weak_up_rate": float(sent.yesterday_weak_up_rate) if sent.yesterday_weak_up_rate is not None else None,
                "main_lu_open_avg": float(sent.main_lu_open_avg) if sent.main_lu_open_avg is not None else None,
                "main_lu_body_avg": float(sent.main_lu_body_avg) if sent.main_lu_body_avg is not None else None,
                "main_lu_change_avg": float(sent.main_lu_change_avg) if sent.main_lu_change_avg is not None else None,
                "gem_lu_open_avg": float(sent.gem_lu_open_avg) if sent.gem_lu_open_avg is not None else None,
                "gem_lu_body_avg": float(sent.gem_lu_body_avg) if sent.gem_lu_body_avg is not None else None,
                "gem_lu_change_avg": float(sent.gem_lu_change_avg) if sent.gem_lu_change_avg is not None else None,
                "one_word_count": sent.one_word_count,
            },
        ))

    # Ladder 快照
    ladders = session.query(LadderSummary).filter(
        LadderSummary.trade_date == trade_date
    ).order_by(LadderSummary.board_level.desc()).all()

    limit_ups = session.query(LimitUpRecord).filter(
        LimitUpRecord.trade_date == trade_date
    ).all()

    quotes_today = session.query(DailyQuote).filter(
        DailyQuote.trade_date == trade_date
    ).all()
    amount_by_code = {q.stock_code: float(q.amount or 0) for q in quotes_today}

    ladder_data = []
    for ld in ladders:
        stocks_at_level = [
            {
                "stock_code": r.stock_code,
                "stock_name": r.stock_name,
                "first_limit_time": str(r.first_limit_time) if r.first_limit_time else None,
                "open_count": r.open_count,
                "limit_reason": r.limit_reason,
                "industry": r.industry,
                "theme_names": r.theme_names,
                "limit_order_amount": float(r.limit_order_amount) if r.limit_order_amount else None,
                "amount": amount_by_code.get(r.stock_code),
                "is_one_word": bool(r.is_one_word),
            }
            for r in limit_ups if min(r.continuous_days, 7) == ld.board_level
        ]
        ladder_data.append({
            "board_level": ld.board_level,
            "stock_count": ld.stock_count,
            "promotion_count": ld.promotion_count,
            "promotion_rate": float(ld.promotion_rate),
            "stocks": stocks_at_level,
        })

    session.add(DailySnapshot(
        trade_date=trade_date,
        snapshot_type="ladder",
        data={"levels": ladder_data},
    ))

    # 题材板块快照
    try:
        concept_data = adapter.fetch_concept_board_daily(trade_date)
        if concept_data:
            top_themes = sorted(concept_data, key=lambda x: x["change_pct"], reverse=True)[:50]
            bottom_themes = sorted(concept_data, key=lambda x: x["change_pct"])[:20]
            session.add(DailySnapshot(
                trade_date=trade_date,
                snapshot_type="themes",
                data={
                    "total_count": len(concept_data),
                    "top": top_themes,
                    "bottom": bottom_themes,
                },
            ))
    except Exception as e:
        logger.warning(f"Failed to fetch concept board data: {e}")

    # 行业板块快照
    try:
        industry_data = adapter.fetch_industry_board_daily(trade_date)
        if industry_data:
            top_industries = sorted(industry_data, key=lambda x: x["change_pct"], reverse=True)[:50]
            bottom_industries = sorted(industry_data, key=lambda x: x["change_pct"])[:20]
            session.add(DailySnapshot(
                trade_date=trade_date,
                snapshot_type="industries",
                data={
                    "total_count": len(industry_data),
                    "top": top_industries,
                    "bottom": bottom_industries,
                },
            ))
    except Exception as e:
        logger.warning(f"Failed to fetch industry board data: {e}")

    # 龙虎榜快照（仅 tushare 适配器有此接口）
    if hasattr(adapter, "fetch_lhb_list") and hasattr(adapter, "fetch_lhb_inst"):
        try:
            lhb_stocks = adapter.fetch_lhb_list(trade_date)
            lhb_insts = adapter.fetch_lhb_inst(trade_date)
            if not lhb_stocks:
                _log_step(
                    session, trade_date, "lhb", "empty",
                    error_message="tushare top_list 返回空（一般是 18:00 前调用或当日非交易日）",
                )
            else:
                # 按 stock_code 把营业部明细聚合到字典
                insts_by_code: dict[str, list[dict]] = {}
                for it in lhb_insts:
                    insts_by_code.setdefault(it["stock_code"], []).append(it)
                # 每只股票的营业部按 net_buy 降序
                for code, arr in insts_by_code.items():
                    arr.sort(key=lambda x: x.get("net_buy", 0), reverse=True)

                # 计算游资榜：所有非"机构专用"营业部按当日总净买入聚合
                hot_money_stats: dict[str, dict] = {}
                for it in lhb_insts:
                    if it.get("is_inst"):
                        continue
                    name = it.get("exalter", "")
                    if not name:
                        continue
                    rec = hot_money_stats.setdefault(name, {
                        "exalter": name,
                        "appearance": 0,
                        "buy_total": 0.0,
                        "sell_total": 0.0,
                        "net_buy_total": 0.0,
                        "stocks": [],
                    })
                    rec["appearance"] += 1
                    rec["buy_total"] += it.get("buy", 0.0)
                    rec["sell_total"] += it.get("sell", 0.0)
                    rec["net_buy_total"] += it.get("net_buy", 0.0)
                    rec["stocks"].append({
                        "stock_code": it["stock_code"],
                        "net_buy": it["net_buy"],
                        "side": it["side"],
                    })
                hot_money_list = sorted(
                    hot_money_stats.values(),
                    key=lambda x: x["net_buy_total"],
                    reverse=True,
                )

                session.add(DailySnapshot(
                    trade_date=trade_date,
                    snapshot_type="lhb",
                    data={
                        "stock_count": len(lhb_stocks),
                        "inst_count": len(lhb_insts),
                        "stocks": lhb_stocks,
                        "insts_by_code": insts_by_code,
                        "hot_money_top": hot_money_list[:50],
                    },
                ))
                _log_step(
                    session, trade_date, "lhb", "success",
                    records_count=len(lhb_stocks),
                )
        except Exception as e:
            logger.warning(f"Failed to fetch LHB data: {e}")
            _log_step(session, trade_date, "lhb", "failed", error_message=str(e))

    # KPL 概念成分股快照（仅 tushare 适配器有此接口，前端题材弹窗用）
    try:
        if hasattr(adapter, "fetch_kpl_concept_cons_daily"):
            cons_rows = adapter.fetch_kpl_concept_cons_daily(trade_date)
            if cons_rows:
                by_concept: dict[str, list[dict]] = {}
                for r in cons_rows:
                    by_concept.setdefault(r["concept_name"], []).append({
                        "stock_code": r["stock_code"],
                        "stock_name": r["stock_name"],
                        "desc": r["desc"],
                        "hot_num": r["hot_num"],
                    })
                # 每个概念按 hot_num 排序
                for k in by_concept:
                    by_concept[k].sort(key=lambda x: x.get("hot_num", 0), reverse=True)
                session.add(DailySnapshot(
                    trade_date=trade_date,
                    snapshot_type="theme_cons",
                    data={
                        "concept_count": len(by_concept),
                        "by_concept": by_concept,
                    },
                ))
    except Exception as e:
        logger.warning(f"Failed to fetch KPL concept cons: {e}")

    added = sum(1 for obj in session.new if isinstance(obj, DailySnapshot))
    session.commit()
    _log_step(session, trade_date, "aggregate", "success", records_count=added)


def _step_collect_capital(session: Session, adapter, trade_date: date):
    """Step 4: 资金流采集——大盘 / 北向 / 概念 / 行业 / 个股 / 涨停封单."""
    _log_step(session, trade_date, "capital", "running")
    total = 0
    try:
        session.execute(
            delete(CapitalFlowDaily).where(CapitalFlowDaily.trade_date == trade_date)
        )

        market = adapter.fetch_market_fund_flow(trade_date)
        if market:
            session.add(CapitalFlowDaily(
                trade_date=trade_date, scope="market", scope_key="", data=market,
            ))
            total += 1

        north = adapter.fetch_north_fund_flow(trade_date)
        if north:
            session.add(CapitalFlowDaily(
                trade_date=trade_date, scope="north", scope_key="", data=north,
            ))
            total += 1

        for c in adapter.fetch_concept_fund_flow(trade_date):
            session.add(CapitalFlowDaily(
                trade_date=trade_date, scope="concept",
                scope_key=c["name"], data=c,
            ))
            total += 1

        for i in adapter.fetch_industry_fund_flow(trade_date):
            session.add(CapitalFlowDaily(
                trade_date=trade_date, scope="industry",
                scope_key=i["name"], data=i,
            ))
            total += 1

        for s in adapter.fetch_stock_fund_flow_rank(trade_date):
            session.add(CapitalFlowDaily(
                trade_date=trade_date, scope="stock",
                scope_key=s["stock_code"], data=s,
            ))
            total += 1

        # 涨停封单按题材汇总
        from collections import defaultdict
        agg: dict[str, dict] = defaultdict(lambda: {"theme": None, "stocks": [], "limit_order_total": 0.0})
        rows = session.query(LimitUpRecord).filter(LimitUpRecord.trade_date == trade_date).all()
        for r in rows:
            order_amt = float(r.limit_order_amount or 0)
            for theme in (r.theme_names or [r.industry] if r.industry else (r.theme_names or [])):
                if not theme:
                    continue
                agg[theme]["theme"] = theme
                agg[theme]["stocks"].append({
                    "stock_code": r.stock_code, "stock_name": r.stock_name,
                    "continuous_days": r.continuous_days, "limit_order_amount": order_amt,
                })
                agg[theme]["limit_order_total"] += order_amt
        for theme, data in agg.items():
            session.add(CapitalFlowDaily(
                trade_date=trade_date, scope="limit_order",
                scope_key=theme, data=data,
            ))
            total += 1

        session.commit()
        _log_step(session, trade_date, "capital", "success", records_count=total)
    except Exception as e:
        session.rollback()
        logger.exception("capital flow collect failed")
        _log_step(session, trade_date, "capital", "failed", error_message=str(e))


def _step_collect_north_hold(session: Session, adapter, trade_date: date):
    """Step 5: 北向单股持股快照."""
    _log_step(session, trade_date, "north_hold", "running")
    try:
        rows = adapter.fetch_north_hold(trade_date, top=300)
        if not rows:
            _log_step(session, trade_date, "north_hold", "empty")
            return
        session.execute(
            delete(NorthHoldDaily).where(NorthHoldDaily.trade_date == trade_date)
        )
        for r in rows:
            session.add(NorthHoldDaily(
                trade_date=trade_date,
                stock_code=r["stock_code"],
                stock_name=r.get("stock_name"),
                hold_shares=r.get("hold_shares"),
                hold_amount=r.get("hold_amount"),
                hold_pct=r.get("hold_pct"),
                chg_shares=r.get("chg_shares"),
                chg_amount=r.get("chg_amount"),
            ))
        session.commit()
        _log_step(session, trade_date, "north_hold", "success", records_count=len(rows))
    except Exception as e:
        session.rollback()
        logger.exception("north hold collect failed")
        _log_step(session, trade_date, "north_hold", "failed", error_message=str(e))


def _step_collect_etf(session: Session, adapter, trade_date: date):
    """Step 6: ETF 行情 + 关键宽基/行业 ETF 份额变化(净申购代理)."""
    _log_step(session, trade_date, "etf", "running")
    try:
        spot_rows = adapter.fetch_etf_spot()
        if not spot_rows:
            _log_step(session, trade_date, "etf", "empty")
            return
        spot_map = {r["etf_code"]: r for r in spot_rows}

        session.execute(delete(EtfFlowDaily).where(EtfFlowDaily.trade_date == trade_date))

        # 重点 ETF 拉份额历史
        tracked = all_tracked_etfs()
        tracked_codes = {e.code for e in tracked}
        for meta in tracked:
            spot = spot_map.get(meta.code)
            if not spot:
                continue
            shares = None
            shares_change = None
            inflow_estimate = None
            try:
                share_info = adapter.fetch_etf_share(meta.code)
                hist = (share_info or {}).get("history", []) if share_info else []
                if len(hist) >= 2:
                    today_share = float(hist[-1].get("基金份额", 0) or hist[-1].get("份额", 0) or 0)
                    prev_share = float(hist[-2].get("基金份额", 0) or hist[-2].get("份额", 0) or 0)
                    shares = today_share
                    shares_change = today_share - prev_share
                    nav = float(hist[-1].get("单位净值", 0) or 0) or spot.get("nav") or spot.get("close")
                    if nav:
                        inflow_estimate = shares_change * nav * 1e8  # 份额(亿份) × 净值
            except Exception as e:
                logger.warning(f"etf share {meta.code}: {e}")
            session.add(EtfFlowDaily(
                trade_date=trade_date,
                etf_code=meta.code,
                etf_name=meta.name,
                category=meta.category,
                shares=shares,
                shares_change=shares_change,
                amount=spot.get("amount"),
                nav=spot.get("nav"),
                premium_rate=spot.get("premium_rate"),
                inflow_estimate=inflow_estimate,
                close=spot.get("close"),
                change_pct=spot.get("change_pct"),
            ))

        # 其他 ETF 仅落基础行情(不算 inflow)
        for code, spot in spot_map.items():
            if code in tracked_codes:
                continue
            session.add(EtfFlowDaily(
                trade_date=trade_date,
                etf_code=code,
                etf_name=spot.get("etf_name"),
                category="other",
                amount=spot.get("amount"),
                nav=spot.get("nav"),
                premium_rate=spot.get("premium_rate"),
                close=spot.get("close"),
                change_pct=spot.get("change_pct"),
            ))
        session.commit()
        _log_step(session, trade_date, "etf", "success", records_count=len(spot_rows))
    except Exception as e:
        session.rollback()
        logger.exception("etf collect failed")
        _log_step(session, trade_date, "etf", "failed", error_message=str(e))


def _step_collect_announce(session: Session, adapter, trade_date: date):
    """Step 7: 公告事件流(增减持/回购/举牌)."""
    _log_step(session, trade_date, "announce", "running")
    try:
        events = []
        events.extend(adapter.fetch_announce_increase_decrease(trade_date))
        events.extend(adapter.fetch_announce_repurchase(trade_date))
        events.extend(adapter.fetch_announce_placard(trade_date))
        if not events:
            _log_step(session, trade_date, "announce", "empty")
            return
        for r in events:
            try:
                td = r.get("trade_date") or trade_date.isoformat()
                td_obj = datetime.strptime(td[:10], "%Y-%m-%d").date()
            except Exception:
                td_obj = trade_date
            session.add(AnnouncementEvent(
                trade_date=td_obj,
                stock_code=r["stock_code"],
                stock_name=r.get("stock_name"),
                event_type=r["event_type"],
                actor=r.get("actor"),
                actor_type=r.get("actor_type", "unknown"),
                scale=r.get("scale"),
                shares=r.get("shares"),
                progress=r.get("progress"),
                detail=r.get("detail"),
                tags=r.get("tags"),
                source_url=r.get("source_url"),
            ))
        session.commit()
        _log_step(session, trade_date, "announce", "success", records_count=len(events))
    except Exception as e:
        session.rollback()
        logger.exception("announce collect failed")
        _log_step(session, trade_date, "announce", "failed", error_message=str(e))
