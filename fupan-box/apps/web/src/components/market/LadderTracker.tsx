"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { getCellColor, getBoardLevelColor } from "@/lib/colorScale";

interface DailyEntry {
  date: string;
  change_pct: number | null;
  is_limit_up: boolean;
  board_level: number;
}

interface TrackedStock {
  stock_code: string;
  stock_name: string;
  continuous_days: number;
  limit_reason: string | null;
  theme_names: string[];
  daily: DailyEntry[];
}

interface TrackData {
  dates: string[];
  stocks: TrackedStock[];
}

export function LadderTracker() {
  const [data, setData] = useState<TrackData | null>(null);
  const openStockDetail = useUIStore((s) => s.openStockDetail);

  useEffect(() => {
    api
      .getLadderTrack(8)
      .then((res) => setData(res as unknown as TrackData))
      .catch(console.error);
  }, []);

  if (!data) {
    return (
      <div className="px-3 py-2">
        <div className="h-48 animate-pulse" style={{ background: "var(--bg-card)" }} />
      </div>
    );
  }

  if (data.stocks.length === 0) {
    return (
      <div className="px-3 py-6 text-center" style={{ color: "var(--text-muted)", fontSize: "var(--font-md)" }}>
        暂无连板股票
      </div>
    );
  }

  return (
    <div>
      <div
        className="px-3 py-1.5"
        style={{ color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}
      >
        连板股跨日追踪 · <span className="font-bold" style={{ color: "var(--text-primary)" }}>{data.stocks.length}</span> 只 ×{" "}
        <span className="font-bold" style={{ color: "var(--text-primary)" }}>{data.dates.length}</span> 日
      </div>
      <div className="overflow-x-auto" style={{ borderTop: "1px solid var(--border-color)", borderBottom: "1px solid var(--border-color)" }}>
        <table className="data-table" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              <th className="label-cell" style={{ minWidth: 96, textAlign: "left" }}>个股</th>
              <th style={{ width: 44 }}>板</th>
              {data.dates.map((d, i) => (
                <th
                  key={d}
                  style={{
                    color: i === data.dates.length - 1 ? "var(--accent-orange)" : "var(--text-secondary)",
                    background: i === data.dates.length - 1 ? "rgba(245,158,11,0.08)" : "var(--bg-tertiary)",
                    minWidth: 60,
                  }}
                >
                  {d.slice(5).replace("-", "/")}
                </th>
              ))}
              <th style={{ minWidth: 90, textAlign: "left" }}>原因</th>
            </tr>
          </thead>
          <tbody>
            {data.stocks.map((stock) => (
              <tr key={stock.stock_code} className="clickable">
                <td
                  className="label-cell"
                  style={{ cursor: "pointer" }}
                  onClick={() => openStockDetail(stock.stock_code)}
                >
                  <div
                    className="font-bold truncate"
                    style={{ color: "var(--text-primary)", fontSize: "var(--font-lg)", maxWidth: 96 }}
                  >
                    {stock.stock_name}
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: "var(--font-xs)" }}>
                    {stock.stock_code}
                  </div>
                </td>
                <td>
                  <span
                    className="font-bold"
                    style={{
                      display: "inline-block",
                      padding: "2px 6px",
                      borderRadius: 3,
                      background: getBoardLevelColor(stock.continuous_days),
                      color: "#fff",
                      fontSize: "var(--font-md)",
                      minWidth: 22,
                    }}
                  >
                    {stock.continuous_days}
                  </span>
                </td>
                {stock.daily.map((d) => {
                  const cell =
                    d.change_pct == null
                      ? { background: "var(--cell-neutral)", color: "var(--text-muted)" }
                      : getCellColor(d.change_pct, "change");
                  return (
                    <td
                      key={d.date}
                      style={{
                        background: cell.background,
                        color: cell.color,
                      }}
                    >
                      {d.change_pct != null ? (
                        <div>
                          <div className="font-bold tabular-nums" style={{ fontSize: "var(--font-md)" }}>
                            {d.change_pct >= 0 ? "+" : ""}
                            {d.change_pct.toFixed(1)}%
                          </div>
                          {d.board_level > 0 && (
                            <div
                              className="font-semibold"
                              style={{ fontSize: "var(--font-xs)", opacity: 0.85 }}
                            >
                              {d.board_level}板
                            </div>
                          )}
                        </div>
                      ) : (
                        <span>-</span>
                      )}
                    </td>
                  );
                })}
                <td
                  className="truncate"
                  style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)", maxWidth: 120, textAlign: "left" }}
                  title={stock.limit_reason || ""}
                >
                  {stock.limit_reason || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
