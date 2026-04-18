"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useUIStore, type StrongScope } from "@/stores/ui-store";
import { PageHeader } from "@/components/layout/PageHeader";

interface CellStock {
  rank: number;
  stock_code: string;
  stock_name: string;
  change_pct: number;
  amount: number;
  turnover_rate: number;
  is_limit_up: boolean;
  is_one_word: boolean;
  is_t_board: boolean;
  open_count: number;
  continuous_days: number;
  primary_theme: string | null;
}

interface GridData {
  dates: string[];
  rows: number;
  cells: Record<string, CellStock[]>;
}

const SUB_TABS: { key: StrongScope; label: string }[] = [
  { key: "recent", label: "近期强势股" },
  { key: "main", label: "主板强势股" },
  { key: "gem", label: "创业板强势股" },
  { key: "star", label: "科创强势股" },
  { key: "bj", label: "北交强势股" },
];

type FilterKey = "all" | "high_amt" | "low_amt" | "one_word" | "t_board" | "rebound";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "high_amt", label: "高成交" },
  { key: "low_amt", label: "低成交" },
  { key: "one_word", label: "一字板" },
  { key: "t_board", label: "T字板" },
  { key: "rebound", label: "反包板" },
];

/** 计算中位数, 用于"高/低成交"过滤的阈值 */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function applyFilter(data: GridData, f: FilterKey): GridData {
  if (f === "all") return data;
  // 计算每天 amount 中位数
  const medByDate: Record<string, number> = {};
  for (const d of data.dates) {
    const amts = (data.cells[d] || []).map((c) => c.amount);
    medByDate[d] = median(amts);
  }
  const newCells: Record<string, CellStock[]> = {};
  for (const d of data.dates) {
    const med = medByDate[d];
    newCells[d] = (data.cells[d] || []).filter((c) => {
      switch (f) {
        case "high_amt":
          return c.amount >= med * 1.5;
        case "low_amt":
          return c.amount <= med * 0.5;
        case "one_word":
          return c.is_one_word;
        case "t_board":
          return c.is_t_board;
        case "rebound":
          return c.open_count > 0 && c.is_limit_up;
        default:
          return true;
      }
    });
  }
  return { ...data, cells: newCells };
}

/** 根据涨跌幅返回卡片整体染色 */
function cardBg(s: CellStock): string {
  const chg = s.change_pct;
  if (chg >= 9.8) return "var(--cell-red-5)";
  if (chg >= 7) return "var(--cell-red-4)";
  if (chg >= 4) return "var(--cell-red-3)";
  if (chg >= 1.5) return "var(--cell-red-2)";
  if (chg >= 0) return "var(--cell-red-1)";
  if (chg > -1.5) return "var(--cell-green-1)";
  if (chg > -4) return "var(--cell-green-2)";
  if (chg > -7) return "var(--cell-green-3)";
  return "var(--cell-green-4)";
}

function StockCell({ s, onClick }: { s: CellStock; onClick: () => void }) {
  const tagText = s.is_one_word
    ? "一字"
    : s.is_t_board
    ? "T字"
    : s.open_count > 0
    ? "炸板"
    : null;

  return (
    <div
      onClick={onClick}
      className="stock-card"
      style={{ background: cardBg(s), height: "100%" }}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-bold truncate" style={{ fontSize: 12, lineHeight: 1.1 }}>
          {s.stock_name}
        </span>
        {s.primary_theme && (
          <span
            className="theme-tag"
            style={{ marginTop: 0, marginRight: 0, fontSize: 9, padding: "0px 4px" }}
          >
            {s.primary_theme.length > 4 ? s.primary_theme.slice(0, 4) : s.primary_theme}
          </span>
        )}
      </div>
      <div
        className="flex items-baseline justify-between mt-0.5 tabular-nums"
        style={{ fontSize: 10, opacity: 0.92 }}
      >
        <span>{s.stock_code}</span>
        <span className="font-bold" style={{ fontSize: 11 }}>
          {s.change_pct >= 0 ? "+" : ""}
          {s.change_pct.toFixed(2)}%
        </span>
      </div>
      <div
        className="flex items-baseline justify-between mt-0.5 tabular-nums"
        style={{ fontSize: 9, opacity: 0.78 }}
      >
        <span>成交 {(s.amount / 1e8).toFixed(2)}亿</span>
        {s.continuous_days > 0 && (
          <span className="font-bold" style={{ opacity: 0.95 }}>
            {s.continuous_days}板
          </span>
        )}
      </div>
      {tagText && (
        <div className="mt-auto">
          <span
            className="theme-tag"
            style={{
              marginTop: 0,
              fontSize: 9,
              padding: "0px 4px",
              background: "rgba(0,0,0,0.32)",
            }}
          >
            {tagText}
          </span>
        </div>
      )}
    </div>
  );
}

export function StrongStocksPage() {
  const scope = useUIStore((s) => s.strongScope);
  const setScope = useUIStore((s) => s.setStrongScope);
  const openStockDetail = useUIStore((s) => s.openStockDetail);

  const [data, setData] = useState<GridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api
      .getStrongStocksGrid(scope, 8, 5)
      .then((res) => {
        if (!cancel) setData(res as unknown as GridData);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [scope]);

  // 预热: mount 时后台并行拉其他 scope, 让 sub-tab 切换瞬间命中后端 cache
  useEffect(() => {
    const others = SUB_TABS.map((t) => t.key).filter((k) => k !== scope);
    const id = window.setTimeout(() => {
      others.forEach((k) => {
        api.getStrongStocksGrid(k, 8, 5).catch(() => {});
      });
    }, 800);
    return () => window.clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader
        title="强势股追踪"
        subtitle={SUB_TABS.find((t) => t.key === scope)?.label}
      />

      {/* 子 tabs (急速复盘风格) */}
      <div
        className="flex items-center px-3"
        style={{
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
          height: 36,
        }}
      >
        {SUB_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setScope(key)}
            className="font-medium transition-colors relative"
            style={{
              padding: "0 14px",
              height: 36,
              fontSize: "var(--font-md)",
              color: scope === key ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {label}
            {scope === key && (
              <div
                className="absolute bottom-0 left-2 right-2"
                style={{ height: 2, background: "var(--accent-orange)" }}
              />
            )}
          </button>
        ))}
      </div>

      {/* 筛选条 */}
      <div
        className="flex items-center gap-1 px-3 py-2"
        style={{
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className="font-semibold transition-colors"
            style={{
              padding: "3px 10px",
              borderRadius: 3,
              fontSize: 11,
              background:
                filter === key
                  ? "var(--accent-orange)"
                  : "var(--bg-tertiary)",
              color: filter === key ? "#fff" : "var(--text-secondary)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading || !data ? (
        <div className="px-3 py-3 grid gap-1.5" style={{ gridTemplateColumns: "60px repeat(8, minmax(120px, 1fr))" }}>
          {Array.from({ length: 5 * 9 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse"
              style={{ background: "var(--bg-card)" }}
            />
          ))}
        </div>
      ) : (
        <StrongGrid
          data={applyFilter(data, filter)}
          onCellClick={(s) => openStockDetail(s.stock_code, s.stock_name)}
        />
      )}
    </div>
  );
}

function StrongGrid({
  data,
  onCellClick,
}: {
  data: GridData;
  onCellClick: (s: CellStock) => void;
}) {
  const ranks = Array.from({ length: data.rows }, (_, i) => i + 1);
  const dates = data.dates;
  const cols = `60px repeat(${dates.length}, minmax(140px, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 60 + dates.length * 140 }}>
        {/* 表头 */}
        <div
          className="grid sticky top-0 z-10"
          style={{
            gridTemplateColumns: cols,
            background: "var(--bg-secondary)",
            borderBottom: "1px solid var(--border-color)",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <div
            style={{
              padding: "6px 4px",
              color: "var(--text-secondary)",
              textAlign: "center",
              borderRight: "1px solid var(--border-color)",
            }}
          >
            Rank
          </div>
          {dates.map((d, i) => (
            <div
              key={d}
              className="text-center tabular-nums"
              style={{
                padding: "6px 4px",
                color: i === 0 ? "var(--accent-orange)" : "var(--text-secondary)",
                background: i === 0 ? "rgba(245,158,11,0.1)" : "transparent",
                borderRight: i < dates.length - 1 ? "1px solid var(--border-color)" : "none",
              }}
            >
              {d.replace(/-/g, "")}
              {i === 0 && (
                <span
                  style={{
                    marginLeft: 4,
                    color: "var(--text-muted)",
                    fontSize: 10,
                    fontWeight: 500,
                  }}
                >
                  排 #1
                </span>
              )}
            </div>
          ))}
        </div>

        {/* 行 */}
        {ranks.map((rank) => (
          <div
            key={rank}
            className="grid"
            style={{
              gridTemplateColumns: cols,
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            <div
              style={{
                padding: "8px 4px",
                color: "var(--text-secondary)",
                fontWeight: 700,
                textAlign: "center",
                fontSize: 13,
                background: "var(--bg-secondary)",
                borderRight: "1px solid var(--border-color)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              #{rank}
            </div>
            {dates.map((d, i) => {
              const cellList = data.cells[d] || [];
              const cell = cellList.find((c) => c.rank === rank);
              return (
                <div
                  key={d}
                  style={{
                    padding: 4,
                    borderRight:
                      i < dates.length - 1
                        ? "1px solid var(--border-color)"
                        : "none",
                    background: i === 0 ? "rgba(245,158,11,0.04)" : "transparent",
                    height: 88,
                  }}
                >
                  {cell ? (
                    <StockCell s={cell} onClick={() => onCellClick(cell)} />
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--text-muted)",
                        fontSize: 10,
                      }}
                    >
                      -
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
