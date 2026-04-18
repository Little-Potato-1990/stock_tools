"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { getCellColor } from "@/lib/colorScale";

interface LadderStock {
  stock_code: string;
  stock_name?: string;
  open_count: number;
  theme_names?: string[] | null;
}

interface LadderLevel {
  board_level: number;
  stock_count: number;
  promotion_count: number;
  promotion_rate: number;
  stocks?: LadderStock[];
}

interface DayLadder {
  trade_date: string;
  data: { levels: LadderLevel[] };
}

function SealRateBar({ levels }: { levels: LadderLevel[] }) {
  const multiStocks = levels
    .filter((l) => l.board_level >= 2)
    .flatMap((l) => l.stocks ?? []);
  const firstStocks = levels
    .filter((l) => l.board_level === 1)
    .flatMap((l) => l.stocks ?? []);

  const multiTotal = multiStocks.length;
  const multiSealed = multiStocks.filter((s) => s.open_count === 0).length;
  const firstTotal = firstStocks.length;
  const firstSealed = firstStocks.filter((s) => s.open_count === 0).length;

  if (multiTotal === 0 && firstTotal === 0) return null;

  const items = [
    { label: "连板梯队", sealed: multiSealed, total: multiTotal },
    { label: "首板", sealed: firstSealed, total: firstTotal },
  ];

  return (
    <div className="flex flex-wrap gap-4 px-3 py-2" style={{ borderBottom: "1px solid var(--border-color)" }}>
      {items.map(({ label, sealed, total }) => {
        if (total === 0) return null;
        const rate = (sealed / total) * 100;
        const cell = getCellColor(rate / 100, "rate");
        return (
          <div key={label} className="flex items-center gap-2">
            <span style={{ color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}>
              {label}
            </span>
            <span
              className="font-bold tabular-nums"
              style={{ color: "var(--text-primary)", fontSize: "var(--font-lg)" }}
            >
              {sealed}/{total}
            </span>
            <span
              className="font-bold tabular-nums"
              style={{
                background: cell.background,
                color: cell.color,
                padding: "2px 8px",
                borderRadius: 3,
                fontSize: "var(--font-md)",
              }}
            >
              {rate.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function LadderStats() {
  const [days, setDays] = useState<DayLadder[]>([]);

  useEffect(() => {
    api
      .getSnapshotRange("ladder", 8)
      .then((res) => setDays(res as unknown as DayLadder[]))
      .catch(console.error);
  }, []);

  if (days.length === 0) {
    return (
      <div className="px-3 py-2">
        <div className="h-40 animate-pulse" style={{ background: "var(--bg-card)" }} />
      </div>
    );
  }

  const LEVELS = [7, 6, 5, 4, 3, 2, 1];
  const latestDay = days[0];

  const getLevel = (day: DayLadder, lv: number): LadderLevel | undefined =>
    day.data.levels.find((l) => l.board_level === lv);

  return (
    <div>
      {latestDay && <SealRateBar levels={latestDay.data.levels} />}

      <div className="overflow-x-auto" style={{ borderBottom: "1px solid var(--border-color)" }}>
        <table className="data-table" style={{ minWidth: 500 }}>
          <thead>
            <tr>
              <th className="label-cell" style={{ width: 90, textAlign: "left" }}>板级</th>
              {days.map((d, i) => (
                <th
                  key={d.trade_date}
                  style={{
                    color: i === 0 ? "var(--accent-orange)" : "var(--text-secondary)",
                    background: i === 0 ? "rgba(245,158,11,0.08)" : "var(--bg-tertiary)",
                  }}
                >
                  {d.trade_date.slice(5).replace("-", "/")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEVELS.map((lv) => (
              <tr key={lv}>
                <td className="label-cell">
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {lv >= 7 ? "7板+" : `${lv}板`}
                  </span>
                  {lv >= 2 && lv < 7 && (
                    <span style={{ color: "var(--text-muted)", marginLeft: 4, fontSize: "var(--font-xs)" }}>
                      晋级
                    </span>
                  )}
                </td>
                {days.map((d) => {
                  const level = getLevel(d, lv);
                  const count = level?.stock_count ?? 0;
                  const rate = level?.promotion_rate ?? 0;
                  const cell = getCellColor(count, "count_red", { max: lv >= 5 ? 5 : 30 });
                  return (
                    <td
                      key={d.trade_date}
                      style={{
                        background: count > 0 ? cell.background : "var(--cell-neutral)",
                        color: count > 0 ? cell.color : "var(--text-muted)",
                      }}
                    >
                      <div className="font-bold tabular-nums" style={{ fontSize: "var(--font-lg)" }}>
                        {count}
                      </div>
                      {lv >= 2 && rate > 0 && (
                        <div
                          className="font-semibold tabular-nums"
                          style={{ fontSize: "var(--font-xs)", opacity: 0.85 }}
                        >
                          晋{(rate * 100).toFixed(0)}%
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
