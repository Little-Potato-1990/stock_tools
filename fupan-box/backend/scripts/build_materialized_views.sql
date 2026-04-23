-- build_materialized_views.sql — Phase 1.5
--
-- 物化视图集合，覆盖 plan §4 的「排行榜/今日热度页面 < 200ms」需求。
-- 调用方式：psql -f build_materialized_views.sql
-- 刷新方式：CALL refresh_warm_views(); （封装在最后）
--
-- 6 个物化视图：
--   1. universe_default_active     in 市 + ST 标的全集（用于 API 默认过滤）
--   2. universe_wide               全 A + ST + 退市
--   3. today_top_gainers           最新交易日涨幅榜 Top 100
--   4. today_top_losers            最新交易日跌幅榜 Top 100
--   5. hot_themes                  最新交易日题材热度榜 Top 30
--   6. lhb_today                   最新交易日龙虎榜 stocks 列表（JSONB 展开）

-- 1. universe_default_active：listed_active + st + star_st
CREATE MATERIALIZED VIEW IF NOT EXISTS universe_default_active AS
SELECT code, name, market, board, status, industry
FROM stocks
WHERE status IN ('listed_active', 'st', 'star_st');

CREATE UNIQUE INDEX IF NOT EXISTS uq_universe_default_code
  ON universe_default_active (code);
CREATE INDEX IF NOT EXISTS ix_universe_default_board
  ON universe_default_active (board);

-- 2. universe_wide：全 A + ST + 退市
CREATE MATERIALIZED VIEW IF NOT EXISTS universe_wide AS
SELECT code, name, market, board, status, industry, delist_date
FROM stocks;

CREATE UNIQUE INDEX IF NOT EXISTS uq_universe_wide_code
  ON universe_wide (code);
CREATE INDEX IF NOT EXISTS ix_universe_wide_status
  ON universe_wide (status);

-- 注意：daily_quotes.stock_code 形如 'sz000001' / 'sh600000' / 'bj920001'，
--      而 stocks.code 是 6 位裸码 '000001'，所以 join 时要剥前缀。
--      用 RIGHT(q.stock_code, 6) 兼容所有市场前缀。

-- 3. today_top_gainers：最新交易日涨幅 Top 100，关联 stocks 取 name + status
CREATE MATERIALIZED VIEW IF NOT EXISTS today_top_gainers AS
WITH latest AS (
  SELECT MAX(trade_date) AS d FROM daily_quotes
)
SELECT
  RIGHT(q.stock_code, 6) AS code,
  q.stock_code AS full_code,
  s.name,
  s.status,
  s.board,
  q.trade_date,
  q.close,
  q.change_pct,
  q.amount,
  q.turnover_rate
FROM daily_quotes q
JOIN latest ON q.trade_date = latest.d
JOIN stocks s ON s.code = RIGHT(q.stock_code, 6)
WHERE s.status IN ('listed_active', 'st', 'star_st')
ORDER BY q.change_pct DESC
LIMIT 100;

CREATE UNIQUE INDEX IF NOT EXISTS uq_today_top_gainers_code
  ON today_top_gainers (code);

-- 4. today_top_losers
CREATE MATERIALIZED VIEW IF NOT EXISTS today_top_losers AS
WITH latest AS (
  SELECT MAX(trade_date) AS d FROM daily_quotes
)
SELECT
  RIGHT(q.stock_code, 6) AS code,
  q.stock_code AS full_code,
  s.name,
  s.status,
  s.board,
  q.trade_date,
  q.close,
  q.change_pct,
  q.amount,
  q.turnover_rate
FROM daily_quotes q
JOIN latest ON q.trade_date = latest.d
JOIN stocks s ON s.code = RIGHT(q.stock_code, 6)
WHERE s.status IN ('listed_active', 'st', 'star_st')
ORDER BY q.change_pct ASC
LIMIT 100;

CREATE UNIQUE INDEX IF NOT EXISTS uq_today_top_losers_code
  ON today_top_losers (code);

-- 5. hot_themes：最新交易日 themes snapshot top 30
CREATE MATERIALIZED VIEW IF NOT EXISTS hot_themes AS
WITH latest AS (
  SELECT MAX(trade_date) AS d
  FROM daily_snapshots
  WHERE snapshot_type = 'themes'
),
expanded AS (
  SELECT
    s.trade_date,
    jsonb_array_elements(s.data->'top') AS theme
  FROM daily_snapshots s
  JOIN latest ON s.trade_date = latest.d
  WHERE s.snapshot_type = 'themes'
)
SELECT
  trade_date,
  theme->>'name' AS name,
  theme->>'code' AS code,
  (theme->>'change_pct')::numeric AS change_pct,
  (theme->>'up_count')::int AS up_count,
  (theme->>'down_count')::int AS down_count,
  (theme->>'turnover_rate')::numeric AS turnover_rate,
  theme->>'lead_stock' AS lead_stock,
  (theme->>'rank')::int AS rank
FROM expanded
ORDER BY (theme->>'change_pct')::numeric DESC
LIMIT 30;

CREATE INDEX IF NOT EXISTS ix_hot_themes_rank ON hot_themes (rank);

-- 6. lhb_today：最新 LHB snapshot 的 stocks 数组展开
CREATE MATERIALIZED VIEW IF NOT EXISTS lhb_today AS
WITH latest AS (
  SELECT MAX(trade_date) AS d
  FROM daily_snapshots
  WHERE snapshot_type = 'lhb'
),
expanded AS (
  SELECT
    s.trade_date,
    jsonb_array_elements(s.data->'stocks') AS s_obj
  FROM daily_snapshots s
  JOIN latest ON s.trade_date = latest.d
  WHERE s.snapshot_type = 'lhb'
)
SELECT
  trade_date,
  s_obj->>'stock_code' AS stock_code,
  s_obj->>'stock_name' AS stock_name,
  (s_obj->>'pct_change')::numeric AS pct_change,
  (s_obj->>'turnover_rate')::numeric AS turnover_rate,
  (s_obj->>'amount')::numeric AS amount,
  (s_obj->>'lhb_buy')::numeric AS lhb_buy,
  (s_obj->>'lhb_sell')::numeric AS lhb_sell,
  (s_obj->>'net_amount')::numeric AS net_amount,
  s_obj->>'reason' AS reason
FROM expanded;

CREATE INDEX IF NOT EXISTS ix_lhb_today_code ON lhb_today (stock_code);
CREATE INDEX IF NOT EXISTS ix_lhb_today_net
  ON lhb_today (net_amount DESC);

-- 一键刷新存储过程
CREATE OR REPLACE PROCEDURE refresh_warm_views()
LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY universe_default_active;
  REFRESH MATERIALIZED VIEW CONCURRENTLY universe_wide;
  REFRESH MATERIALIZED VIEW CONCURRENTLY today_top_gainers;
  REFRESH MATERIALIZED VIEW CONCURRENTLY today_top_losers;
  REFRESH MATERIALIZED VIEW hot_themes;
  REFRESH MATERIALIZED VIEW lhb_today;
END;
$$;

COMMENT ON PROCEDURE refresh_warm_views IS
  'Phase 1.5 物化视图统一刷新；建议在 daily_pipeline 末尾 + 18:30 LHB 入库后调用。';
