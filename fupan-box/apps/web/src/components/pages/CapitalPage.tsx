"use client";

import { useState, useEffect } from "react";
import { useUIStore, type CapitalScope } from "@/stores/ui-store";
import { api } from "@/lib/api";
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

const SUB_TABS: { key: CapitalScope; label: string }[] = [
  { key: "wind", label: "风向标个股" },
  { key: "industry", label: "行业资金分析" },
  { key: "theme", label: "题材资金分析" },
  { key: "front_volume", label: "每日成交前排" },
];

function cellBg(chg: number): string {
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

function WindGrid() {
  const [data, setData] = useState<{
    dates: string[];
    cells: Record<string, CellStock[]>;
  } | null>(null);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const openStockDetail = useUIStore((s) => s.openStockDetail);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getStrongStocksGrid("recent", 7, 8),
      api.getSnapshotRange("overview", 7),
    ])
      .then(([grid, ovs]) => {
        setData(
          grid as unknown as { dates: string[]; cells: Record<string, CellStock[]> }
        );
        const m: Record<string, number> = {};
        for (const o of ovs as unknown as Array<{
          trade_date: string;
          data: { total_amount: number };
        }>) {
          m[o.trade_date] = o.data?.total_amount ?? 0;
        }
        setAmounts(m);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="px-3 py-3 grid gap-1.5" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
        {Array.from({ length: 5 * 7 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse" style={{ background: "var(--bg-card)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: data.dates.length * 165 }}>
        <div
          className="grid sticky top-0 z-10"
          style={{
            gridTemplateColumns: `repeat(${data.dates.length}, minmax(165px, 1fr))`,
            background: "var(--bg-secondary)",
            borderBottom: "1px solid var(--border-color)",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {data.dates.map((d, i) => (
            <div
              key={d}
              className="tabular-nums"
              style={{
                padding: "6px 8px",
                color: i === 0 ? "var(--accent-orange)" : "var(--text-secondary)",
                background: i === 0 ? "rgba(245,158,11,0.1)" : "transparent",
                borderRight: i < data.dates.length - 1 ? "1px solid var(--border-color)" : "none",
              }}
            >
              <span>{d.replace(/-/g, "")}</span>
              {amounts[d] != null && (
                <span className="ml-2" style={{ color: "var(--text-muted)", fontSize: 10 }}>
                  大盘 {(amounts[d] / 1e8).toFixed(0)}亿
                </span>
              )}
            </div>
          ))}
        </div>

        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${data.dates.length}, minmax(165px, 1fr))`,
          }}
        >
          {data.dates.map((d, dayIdx) => {
            const cells = data.cells[d] || [];
            const marketAmount = amounts[d] ?? 0;
            return (
              <div
                key={d}
                className="flex flex-col gap-1 p-1"
                style={{
                  background: dayIdx === 0 ? "rgba(245,158,11,0.04)" : "transparent",
                  borderRight:
                    dayIdx < data.dates.length - 1
                      ? "1px solid var(--border-color)"
                      : "none",
                }}
              >
                {cells.map((s) => {
                  const ratio = marketAmount > 0 ? (s.amount / marketAmount) * 100 : 0;
                  return (
                    <div
                      key={`${d}-${s.stock_code}-${s.rank}`}
                      onClick={() => openStockDetail(s.stock_code, s.stock_name)}
                      className="stock-card"
                      style={{ background: cellBg(s.change_pct), minHeight: 64 }}
                    >
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="font-bold truncate" style={{ fontSize: 12 }}>
                          {s.stock_name}
                        </span>
                        {s.primary_theme && (
                          <span
                            className="theme-tag"
                            style={{
                              marginTop: 0,
                              fontSize: 9,
                              padding: "0px 4px",
                            }}
                          >
                            {s.primary_theme.length > 4
                              ? s.primary_theme.slice(0, 4)
                              : s.primary_theme}
                          </span>
                        )}
                      </div>
                      <div
                        className="flex items-baseline justify-between mt-0.5 tabular-nums"
                        style={{ fontSize: 9, opacity: 0.92 }}
                      >
                        <span>当日涨幅</span>
                        <span className="font-bold" style={{ fontSize: 11 }}>
                          {s.change_pct >= 0 ? "+" : ""}
                          {s.change_pct.toFixed(2)}%
                        </span>
                      </div>
                      <div
                        className="flex items-baseline justify-between tabular-nums"
                        style={{ fontSize: 9, opacity: 0.85 }}
                      >
                        <span>当日成交</span>
                        <span>{(s.amount / 1e8).toFixed(2)}亿</span>
                      </div>
                      <div
                        className="flex items-baseline justify-between tabular-nums"
                        style={{ fontSize: 9, opacity: 0.78 }}
                      >
                        <span>占大盘比</span>
                        <span>{ratio.toFixed(2)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlaceholderTab({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: 360 }}>
      <div
        className="rounded-lg px-6 py-8 text-center"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          maxWidth: 360,
        }}
      >
        <div
          className="font-bold mb-2"
          style={{ color: "var(--text-primary)", fontSize: "var(--font-lg)" }}
        >
          {label}
        </div>
        <div
          style={{ color: "var(--text-muted)", fontSize: "var(--font-md)", lineHeight: 1.6 }}
        >
          {desc}
        </div>
        <div
          className="mt-3 inline-block px-3 py-1 rounded"
          style={{
            background: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
            fontSize: "var(--font-sm)",
          }}
        >
          数据源对接中
        </div>
      </div>
    </div>
  );
}

export function CapitalPage() {
  const scope = useUIStore((s) => s.capitalScope);
  const setScope = useUIStore((s) => s.setCapitalScope);

  return (
    <div>
      <PageHeader
        title="资金分析"
        subtitle={SUB_TABS.find((t) => t.key === scope)?.label}
      />

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

      {scope === "wind" && <WindGrid />}
      {scope === "industry" && (
        <PlaceholderTab
          label="行业资金分析"
          desc="按行业聚合资金净流入/流出, 找到当前最强势的行业及其内部资金分布。"
        />
      )}
      {scope === "theme" && (
        <PlaceholderTab
          label="题材资金分析"
          desc="按概念题材聚合资金净流入/流出, 监控游资追逐的热点题材。"
        />
      )}
      {scope === "front_volume" && (
        <PlaceholderTab
          label="每日成交前排"
          desc="按日成交金额排序的标的列表 (Top50), 反映当日最受关注的个股资金集中度。"
        />
      )}
    </div>
  );
}
