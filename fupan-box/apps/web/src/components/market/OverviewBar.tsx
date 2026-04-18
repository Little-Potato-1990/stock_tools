"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { getCellColor, type ColorScaleType } from "@/lib/colorScale";

interface OverviewData {
  total_amount: number;
  limit_up_count: number;
  limit_down_count: number;
  broken_limit_count: number;
  broken_rate: number;
  max_height: number;
  up_count: number;
  down_count: number;
  up_rate: number;
  open_high_count: number;
  open_low_count: number;
  open_limit_up_count?: number;
  open_limit_down_count?: number;
  sh_up_rate?: number | null;
  sz_up_rate?: number | null;
  gem_up_rate?: number | null;
  yesterday_lu_up_rate: number | null;
  yesterday_panic_up_rate?: number | null;
  yesterday_weak_up_rate?: number | null;
  main_lu_open_avg?: number | null;
  main_lu_body_avg?: number | null;
  main_lu_change_avg?: number | null;
}

interface DaySnapshot {
  trade_date: string;
  data: OverviewData;
}

// ladder snapshot 用于反推主板/创业板分级
interface LadderStockMini {
  stock_code: string;
  stock_name?: string;
  is_one_word?: boolean;
}
interface LadderLevel {
  board_level: number;
  stock_count: number;
  promotion_count: number;
  promotion_rate: number;
  stocks: LadderStockMini[];
}
interface LadderDay {
  trade_date: string;
  data: { levels: LadderLevel[] };
}

/** 按 6 位代码前缀粗分市场 */
function classifyMarket(code: string): "main" | "gem" | "star" | "bj" | "other" {
  // code 可能是 "SH600000" 也可能是 "600000"
  const six = code.slice(-6);
  const c2 = six.slice(0, 2);
  const c3 = six.slice(0, 3);
  if (c3 === "688" || c3 === "689") return "star";
  if (c2 === "30") return "gem";
  if (c2 === "60" || c2 === "00") return "main";
  if (c2 === "83" || c2 === "87" || c2 === "88" || c2 === "92" || c2 === "43") return "bj";
  return "other";
}

/** 把单日 ladder.levels 拆成主板和创业板的分级映射 */
function deriveBoardCounts(levels: LadderLevel[]) {
  const mainCounts = [0, 0, 0, 0, 0, 0, 0, 0]; // index 1..7
  const gemCounts = [0, 0, 0, 0]; // index 1..3
  let mainTopName = "";
  let mainTopLevel = 0;
  let gemTopName = "";
  let gemTopLevel = 0;

  for (const lv of levels) {
    const lvIdx = Math.min(lv.board_level, 7);
    for (const s of lv.stocks ?? []) {
      const market = classifyMarket(s.stock_code);
      if (market === "main") {
        mainCounts[lvIdx] += 1;
        if (lv.board_level > mainTopLevel) {
          mainTopLevel = lv.board_level;
          mainTopName = s.stock_name || s.stock_code;
        }
      } else if (market === "gem") {
        const gIdx = Math.min(lv.board_level, 3);
        gemCounts[gIdx] += 1;
        if (lv.board_level > gemTopLevel) {
          gemTopLevel = lv.board_level;
          gemTopName = s.stock_name || s.stock_code;
        }
      }
    }
  }
  return {
    mainCounts,
    gemCounts,
    mainTopName,
    mainTopLevel,
    gemTopName,
    gemTopLevel,
  };
}

interface ExtendedDay {
  trade_date: string;
  data: OverviewData;
  derived: ReturnType<typeof deriveBoardCounts>;
}

type CellValue = number | string | null;

type MetricDef = {
  label: string;
  group?: "section" | "row";
  /** 取值函数：如果返回 null 则显示 "-" */
  get: (d: ExtendedDay) => CellValue;
  format?: (v: CellValue) => string;
  colored?: boolean;
  scale?: ColorScaleType;
  scaleMax?: number;
};

const pctFmt = (v: CellValue) =>
  typeof v === "number" ? `${(v * 100).toFixed(2)}%` : "-";

const METRICS: MetricDef[] = [
  // ===== 市场整体 =====
  { label: "市场整体", group: "section", get: () => "" },
  {
    label: "大盘成交金额",
    get: (d) => d.data.total_amount,
    format: (v) => (typeof v === "number" ? `${(v / 1e8).toFixed(2)}亿` : "-"),
  },
  { label: "开盘涨停", get: (d) => d.data.open_limit_up_count ?? 0 },
  { label: "开盘高开", get: (d) => d.data.open_high_count },
  { label: "开盘跌停", get: (d) => d.data.open_limit_down_count ?? 0 },
  { label: "收盘涨停", get: (d) => d.data.limit_up_count },
  { label: "收盘跌停", get: (d) => d.data.limit_down_count },
  {
    label: "收盘上涨率",
    get: (d) => d.data.up_rate,
    format: pctFmt,
    colored: true,
    scale: "rate",
  },
  {
    label: "上日强势票上涨率",
    get: (d) => d.data.yesterday_lu_up_rate,
    format: pctFmt,
    colored: true,
    scale: "rate",
  },
  {
    label: "上日弱势票上涨率",
    get: (d) => d.data.yesterday_weak_up_rate ?? null,
    format: pctFmt,
    colored: true,
    scale: "rate",
  },
  {
    label: "上日妖股上涨率",
    get: (d) => d.data.yesterday_panic_up_rate ?? null,
    format: pctFmt,
    colored: true,
    scale: "rate",
  },
  {
    label: "上证上涨率",
    get: (d) => d.data.sh_up_rate ?? null,
    format: pctFmt,
    colored: true,
    scale: "rate",
  },
  {
    label: "深证上涨率",
    get: (d) => d.data.sz_up_rate ?? null,
    format: pctFmt,
    colored: true,
    scale: "rate",
  },
  {
    label: "创业板上涨率",
    get: (d) => d.data.gem_up_rate ?? null,
    format: pctFmt,
    colored: true,
    scale: "rate",
  },

  // ===== 创业板连板 =====
  { label: "创业板连板", group: "section", get: () => "" },
  { label: "创业板 - 1板", get: (d) => d.derived.gemCounts[1] },
  { label: "创业板 - 2板", get: (d) => d.derived.gemCounts[2] },
  { label: "创业板 ≥ 3板", get: (d) => d.derived.gemCounts[3] },
  {
    label: "创业板 - 妖股",
    get: (d) =>
      d.derived.gemTopLevel > 0
        ? `${d.derived.gemTopName}(${d.derived.gemTopLevel})`
        : "-",
  },

  // ===== 主板连板 =====
  { label: "主板连板", group: "section", get: () => "" },
  { label: "主板 - 1板", get: (d) => d.derived.mainCounts[1] },
  { label: "主板 - 2板", get: (d) => d.derived.mainCounts[2] },
  { label: "主板 - 3板", get: (d) => d.derived.mainCounts[3] },
  { label: "主板 - 4板", get: (d) => d.derived.mainCounts[4] },
  { label: "主板 - 5板", get: (d) => d.derived.mainCounts[5] },
  { label: "主板 - 6板", get: (d) => d.derived.mainCounts[6] },
  { label: "主板 ≥ 7板", get: (d) => d.derived.mainCounts[7] },
  {
    label: "主板上日涨停实体涨幅",
    get: (d) => d.data.main_lu_body_avg ?? null,
    format: pctFmt,
    colored: true,
    scale: "change",
  },
  {
    label: "主板上日涨停平均涨幅",
    get: (d) => d.data.main_lu_change_avg ?? null,
    format: pctFmt,
    colored: true,
    scale: "change",
  },
  {
    label: "主板上日涨停开盘平均",
    get: (d) => d.data.main_lu_open_avg ?? null,
    format: pctFmt,
    colored: true,
    scale: "change",
  },
  { label: "主板最高板", get: (d) => d.data.max_height },
  {
    label: "主板 - 妖股",
    get: (d) =>
      d.derived.mainTopLevel > 0
        ? `${d.derived.mainTopName}(${d.derived.mainTopLevel})`
        : "-",
  },
];

/** 表头日期下方的色点指示 */
function dayDots(d: OverviewData): Array<"red" | "green"> {
  const dots: Array<"red" | "green"> = [];
  if ((d.limit_up_count ?? 0) >= 80) dots.push("red", "red", "red");
  else if ((d.limit_up_count ?? 0) >= 50) dots.push("red", "red");
  else if ((d.limit_up_count ?? 0) >= 30) dots.push("red");
  if ((d.limit_down_count ?? 0) >= 10) dots.push("green", "green", "green");
  else if ((d.limit_down_count ?? 0) >= 5) dots.push("green", "green");
  else if ((d.limit_down_count ?? 0) >= 2) dots.push("green");
  return dots.slice(0, 4);
}

function fmtCell(m: MetricDef, val: CellValue): string {
  if (m.format) return m.format(val);
  if (val == null || val === "") return "-";
  return String(val);
}

const PAGE_SIZE = 9;
const MAX_DAYS = 60;
const SCROLL_THRESHOLD = 120; // px from right edge to trigger load

export function OverviewBar() {
  const [extDays, setExtDays] = useState<ExtendedDay[]>([]);
  const [days, setDays] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // 拉取数据 (随 days 增加而增加)
  useEffect(() => {
    let cancel = false;
    if (days > PAGE_SIZE) setLoadingMore(true);
    Promise.all([
      api.getSnapshotRange("overview", days) as unknown as Promise<DaySnapshot[]>,
      api.getSnapshotRange("ladder", days) as unknown as Promise<LadderDay[]>,
    ])
      .then(([overview, ladder]) => {
        if (cancel) return;
        const ladderMap = new Map(ladder.map((d) => [d.trade_date, d]));
        const merged: ExtendedDay[] = overview.map((d) => {
          const ld = ladderMap.get(d.trade_date);
          return {
            trade_date: d.trade_date,
            data: d.data,
            derived: deriveBoardCounts(ld?.data.levels ?? []),
          };
        });
        setExtDays(merged);
        // 后端返回不足请求量, 说明数据库已耗尽
        if (overview.length < days) setHasMore(false);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancel) setLoadingMore(false);
      });
    return () => {
      cancel = true;
    };
  }, [days]);

  const triggerLoadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setDays((d) => (d >= MAX_DAYS ? d : Math.min(d + PAGE_SIZE, MAX_DAYS)));
  }, [hasMore, loadingMore]);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceToRight = el.scrollWidth - el.clientWidth - el.scrollLeft;
    if (distanceToRight < SCROLL_THRESHOLD) triggerLoadMore();
  }, [triggerLoadMore]);

  // Auto-fill: 数据加载完后若容器仍未溢出, 继续加载直到溢出或耗尽
  useEffect(() => {
    if (extDays.length === 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    const id = window.setTimeout(() => {
      const overflow = el.scrollWidth - el.clientWidth;
      if (overflow < SCROLL_THRESHOLD && hasMore && !loadingMore) {
        triggerLoadMore();
      }
    }, 80);
    return () => window.clearTimeout(id);
  }, [extDays, hasMore, loadingMore, triggerLoadMore]);

  // 监听 wheel 横向手势, 即使容器未溢出也能触发加载
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX);
      const dy = Math.abs(e.deltaY);
      if (dx <= dy) return; // 主要是垂直, 不处理
      // 用户向左划 (内容右移, 想看更早数据): deltaX > 0
      if (e.deltaX <= 0) return;
      acc += e.deltaX;
      if (acc > 60) {
        acc = 0;
        triggerLoadMore();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [triggerLoadMore]);

  if (extDays.length === 0) {
    return (
      <div className="px-3 py-2">
        <div
          className="h-72 animate-pulse"
          style={{ background: "var(--bg-card)" }}
        />
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      className="overflow-x-auto relative"
      style={{ borderBottom: "1px solid var(--border-color)" }}
    >
      {/* 右上角小标识: 加载更多 / 已到边界 */}
      {(loadingMore || !hasMore) && (
        <div
          className="absolute"
          style={{
            top: 6,
            right: 8,
            zIndex: 5,
            fontSize: 10,
            color: "var(--text-muted)",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            padding: "2px 6px",
            borderRadius: 3,
          }}
        >
          {loadingMore
            ? "加载更多..."
            : `已显示 ${extDays.length} 天 (无更多)`}
        </div>
      )}
      <table className="data-table" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            <th
              className="label-cell"
              style={{ width: 130, textAlign: "left" }}
            >
              日期
            </th>
            {extDays.map((d) => {
              const dots = dayDots(d.data);
              return (
                <th
                  key={d.trade_date}
                  style={{
                    color: "var(--text-secondary)",
                    background: "var(--bg-secondary)",
                    minWidth: 70,
                  }}
                >
                  <div
                    className="font-bold tabular-nums"
                    style={{ fontSize: 12 }}
                  >
                    {d.trade_date.replace(/-/g, "")}
                  </div>
                  <div className="flex justify-center gap-0.5 mt-0.5">
                    {dots.map((c, di) => (
                      <span
                        key={di}
                        style={{
                          display: "inline-block",
                          width: 5,
                          height: 5,
                          borderRadius: "50%",
                          background:
                            c === "red"
                              ? "var(--accent-red)"
                              : "var(--accent-green)",
                        }}
                      />
                    ))}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m, idx) => {
            // 区段分隔符
            if (m.group === "section") {
              return (
                <tr key={`sec-${idx}`}>
                  <td
                    colSpan={extDays.length + 1}
                    style={{
                      background: "var(--bg-secondary)",
                      color: "var(--text-muted)",
                      fontSize: 10,
                      textAlign: "left",
                      padding: "2px 8px",
                      letterSpacing: 1,
                      fontWeight: 700,
                      borderBottom: "1px solid var(--border-color)",
                      height: 20,
                      lineHeight: 1,
                    }}
                  >
                    {m.label}
                  </td>
                </tr>
              );
            }
            return (
              <tr key={`m-${idx}`}>
                <td className="label-cell">{m.label}</td>
                {extDays.map((d) => {
                  const val = m.get(d);
                  if (!m.colored) {
                    return (
                      <td
                        key={d.trade_date}
                        className="cell-num"
                        style={{
                          background: "transparent",
                          color: "var(--text-primary)",
                        }}
                      >
                        {fmtCell(m, val)}
                      </td>
                    );
                  }
                  let coloredVal = typeof val === "number" ? val : null;
                  if (m.scale === "change" && coloredVal !== null) {
                    coloredVal = coloredVal * 100;
                  }
                  const cell = getCellColor(
                    coloredVal,
                    m.scale ?? "rate",
                    { max: m.scaleMax }
                  );
                  return (
                    <td
                      key={d.trade_date}
                      className="cell-num"
                      style={{
                        background: cell.background,
                        color: cell.color,
                      }}
                    >
                      {fmtCell(m, val)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
