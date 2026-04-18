"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { TrendingUp } from "lucide-react";

interface IndustryItem {
  rank: number;
  name: string;
  code: string;
  change_pct: number;
  up_count: number;
  down_count: number;
  lead_stock: string;
  lead_stock_pct: number;
  turnover_rate: number;
  total_market_cap: number;
}

interface DayData {
  trade_date: string;
  items: IndustryItem[];
}

const ROWS = 16;

type SubTab = "analysis" | "filter" | "streak";
type FilterKey = "all" | "strong" | "weak" | "high_amt" | "low_amt" | "high_turnover";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "analysis", label: "行业分析" },
  { key: "filter", label: "筛选" },
  { key: "streak", label: "连续强势行业" },
];

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "strong", label: "强势" },
  { key: "weak", label: "弱势" },
  { key: "high_amt", label: "高成交" },
  { key: "low_amt", label: "低成交" },
  { key: "high_turnover", label: "高换手" },
];

function applyFilter(items: IndustryItem[], f: FilterKey): IndustryItem[] {
  if (f === "all") return items;
  // 计算 amount/turnover 中位数
  const amts = items.map((i) => i.total_market_cap);
  const turns = items.map((i) => i.turnover_rate);
  const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
  const med = (a: number[]) =>
    a.length === 0 ? 0 : sorted(a)[Math.floor(a.length / 2)];
  const amtMed = med(amts);
  const turnMed = med(turns);
  return items.filter((i) => {
    switch (f) {
      case "strong":
        return i.change_pct >= 2;
      case "weak":
        return i.change_pct < 0;
      case "high_amt":
        return i.total_market_cap >= amtMed * 1.5;
      case "low_amt":
        return i.total_market_cap <= amtMed * 0.5;
      case "high_turnover":
        return i.turnover_rate >= turnMed * 1.5;
      default:
        return true;
    }
  });
}

function IndustryCell({
  item,
  rank,
  consecutive,
}: {
  item: IndustryItem;
  rank: number;
  consecutive: number;
}) {
  // 总强度: 复用 change_pct × up_count 给一个直观值
  const strength = (item.change_pct * Math.max(item.up_count, 1)).toFixed(2);
  const chgColor = item.change_pct >= 0 ? "var(--accent-red)" : "var(--accent-green)";
  const leadColor = item.lead_stock_pct >= 0 ? "var(--accent-red)" : "var(--accent-green)";

  return (
    <div
      className="rounded transition-colors"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        padding: "6px 8px",
        minHeight: 88,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {/* 顶部: 排名 + 名 + 涨跌 */}
      <div className="flex items-baseline justify-between gap-1">
        <span
          className="font-bold truncate"
          style={{ color: "var(--text-primary)", fontSize: 12 }}
        >
          <span style={{ color: "var(--text-muted)", marginRight: 3 }}>
            #{rank}
          </span>
          {item.name}
        </span>
        <span
          className="font-bold tabular-nums"
          style={{ color: chgColor, fontSize: 11, flexShrink: 0 }}
        >
          {item.change_pct >= 0 ? "+" : ""}
          {item.change_pct.toFixed(2)}%
        </span>
      </div>

      {/* 中部: 双列 stats + lead */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {/* 左 stats */}
        <div
          className="flex flex-col tabular-nums"
          style={{ fontSize: 9, color: "var(--text-secondary)", lineHeight: 1.4 }}
        >
          <span>
            总强度{" "}
            <span
              style={{ color: "var(--text-primary)", fontWeight: 700 }}
            >
              {strength}
            </span>
          </span>
          <span>
            强势数{" "}
            <span
              style={{ color: "var(--text-primary)", fontWeight: 700 }}
            >
              {item.up_count}
            </span>
          </span>
          <span>
            平均强度{" "}
            <span style={{ color: chgColor, fontWeight: 700 }}>
              {item.change_pct >= 0 ? "+" : ""}
              {item.change_pct.toFixed(2)}
            </span>
          </span>
        </div>
        {/* 右 lead stock */}
        <div
          className="flex flex-col tabular-nums truncate"
          style={{ fontSize: 9, color: "var(--text-secondary)", lineHeight: 1.4 }}
        >
          <span style={{ color: "var(--text-muted)" }}>领涨</span>
          <span
            className="font-bold truncate"
            style={{ color: "var(--text-primary)", fontSize: 10 }}
          >
            {item.lead_stock || "-"}
          </span>
          <span style={{ color: leadColor, fontWeight: 700 }}>
            {item.lead_stock_pct >= 0 ? "+" : ""}
            {item.lead_stock_pct.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* 底部: 持续上榜 badge */}
      <div className="mt-auto">
        <span
          className="inline-block"
          style={{
            fontSize: 9,
            padding: "1px 6px",
            borderRadius: 2,
            fontWeight: 700,
            background:
              consecutive >= 2
                ? "rgba(34,197,94,0.18)"
                : "rgba(245,158,11,0.18)",
            color:
              consecutive >= 2
                ? "var(--accent-green)"
                : "var(--accent-orange)",
          }}
        >
          {consecutive >= 2 ? `连续上榜 ${consecutive}天` : "新上榜"}
        </span>
      </div>
    </div>
  );
}

/** 渲染日期列网格 (各 sub-tab 复用) */
function IndustryGrid({
  data,
  consecutiveDays,
  filter,
}: {
  data: { days: DayData[] };
  consecutiveDays: (name: string, dayIdx: number) => number;
  filter?: FilterKey;
}) {
  const dates = data.days.map((d) => d.trade_date);
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: dates.length * 200 }}>
        <div
          className="grid sticky top-0 z-10"
          style={{
            gridTemplateColumns: `repeat(${dates.length}, minmax(200px, 1fr))`,
            background: "var(--bg-secondary)",
            borderBottom: "1px solid var(--border-color)",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {dates.map((d, i) => (
            <div
              key={d}
              className="text-center tabular-nums"
              style={{
                padding: "6px 4px",
                color:
                  i === 0
                    ? "var(--accent-orange)"
                    : "var(--text-secondary)",
                background:
                  i === 0 ? "rgba(245,158,11,0.1)" : "transparent",
                borderRight:
                  i < dates.length - 1
                    ? "1px solid var(--border-color)"
                    : "none",
              }}
            >
              {d.replace(/-/g, "")}
              {i === 0 && (
                <span
                  style={{
                    marginLeft: 4,
                    color: "var(--text-muted)",
                    fontSize: 10,
                  }}
                >
                  排 #1
                </span>
              )}
            </div>
          ))}
        </div>

        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${dates.length}, minmax(200px, 1fr))`,
          }}
        >
          {data.days.map((day, dayIdx) => {
            const items = filter
              ? applyFilter(day.items || [], filter).slice(0, ROWS)
              : (day.items || []).slice(0, ROWS);
            return (
              <div
                key={day.trade_date}
                className="flex flex-col gap-1 p-1"
                style={{
                  background:
                    dayIdx === 0 ? "rgba(245,158,11,0.04)" : "transparent",
                  borderRight:
                    dayIdx < dates.length - 1
                      ? "1px solid var(--border-color)"
                      : "none",
                }}
              >
                {items.length === 0 ? (
                  <div
                    className="text-center"
                    style={{
                      color: "var(--text-muted)",
                      fontSize: 11,
                      padding: 12,
                    }}
                  >
                    无符合条件的行业
                  </div>
                ) : (
                  items.map((item, idx) => (
                    <IndustryCell
                      key={`${day.trade_date}-${item.code}`}
                      item={item}
                      rank={idx + 1}
                      consecutive={consecutiveDays(item.name, dayIdx)}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 连续强势行业列表 (黄底高亮 ≥2 天) */
function StreakList({
  data,
  consecutiveDays,
}: {
  data: { days: DayData[] };
  consecutiveDays: (name: string, dayIdx: number) => number;
}) {
  if (data.days.length === 0) return null;
  const today = data.days[0];
  const list = (today.items || [])
    .map((it) => ({ it, streak: consecutiveDays(it.name, 0) }))
    .filter((x) => x.streak >= 2)
    .sort((a, b) => b.streak - a.streak || b.it.change_pct - a.it.change_pct);

  // 数据天数不足时, 给出明确提示而不是空白
  if (data.days.length < 2) {
    return (
      <div className="p-3">
        <div
          className="mb-2 font-bold"
          style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
        >
          连续上榜 ≥2 天的行业
        </div>
        <div
          className="rounded"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            padding: 16,
            color: "var(--text-secondary)",
            fontSize: 12,
            lineHeight: 1.7,
          }}
        >
          <div
            className="font-bold mb-1"
            style={{ color: "var(--accent-orange)", fontSize: 13 }}
          >
            数据采集中
          </div>
          当前仅有 {data.days.length} 天行业排名数据 ({today.trade_date}),
          至少需要 2 天才能计算连续上榜行业。
          <div className="mt-1" style={{ color: "var(--text-muted)", fontSize: 11 }}>
            (行业 snapshot 通过当日实时接口采集, 历史数据需要随每日 pipeline 自然累积)
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div
        className="mb-2 font-bold"
        style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
      >
        连续上榜 ≥2 天的行业 ({list.length})
      </div>
      {list.length === 0 ? (
        <div
          className="text-center"
          style={{
            color: "var(--text-muted)",
            fontSize: 11,
            padding: 24,
          }}
        >
          暂无连续上榜的行业
        </div>
      ) : (
        <div
          className="grid gap-1.5"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          }}
        >
          {list.map(({ it, streak }) => {
            const chgColor =
              it.change_pct >= 0
                ? "var(--accent-red)"
                : "var(--accent-green)";
            return (
              <div
                key={it.code}
                className="rounded"
                style={{
                  // 文档要求"黄色背景"标识强势
                  background: "rgba(245,158,11,0.12)",
                  border: "1px solid rgba(245,158,11,0.3)",
                  padding: "8px 10px",
                }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="font-bold truncate"
                    style={{
                      color: "var(--text-primary)",
                      fontSize: 12,
                    }}
                  >
                    {it.name}
                  </span>
                  <span
                    className="font-bold tabular-nums flex items-center gap-0.5"
                    style={{ color: chgColor, fontSize: 11 }}
                  >
                    <TrendingUp size={10} />
                    {it.change_pct >= 0 ? "+" : ""}
                    {it.change_pct.toFixed(2)}%
                  </span>
                </div>
                <div
                  className="flex items-center justify-between mt-1 tabular-nums"
                  style={{ fontSize: 10, color: "var(--text-secondary)" }}
                >
                  <span>领涨 {it.lead_stock || "-"}</span>
                  <span
                    className="font-bold"
                    style={{
                      background: "var(--accent-orange)",
                      color: "#1a1d28",
                      padding: "0 6px",
                      borderRadius: 2,
                      fontSize: 10,
                    }}
                  >
                    持续 {streak} 天
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function IndustriesPage() {
  const [data, setData] = useState<{ rows: number; days: DayData[] } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<SubTab>("analysis");
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    setLoading(true);
    api
      .getIndustriesGrid(6, ROWS)
      .then((res) =>
        setData(res as unknown as { rows: number; days: DayData[] })
      )
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function consecutiveDays(name: string, dayIdx: number): number {
    if (!data) return 0;
    let count = 0;
    for (let i = dayIdx; i < data.days.length; i++) {
      if ((data.days[i].items || []).some((t) => t.name === name)) count++;
      else break;
    }
    return count;
  }

  const dates = data?.days.map((d) => d.trade_date) ?? [];

  return (
    <div>
      <PageHeader
        title="行业追踪"
        subtitle={
          dates.length > 0
            ? `${dates[0]} 共 ${data?.days[0]?.items.length ?? 0}+ 行业`
            : undefined
        }
      />

      {/* sub-tabs */}
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
            onClick={() => setTab(key)}
            className="font-medium transition-colors relative"
            style={{
              padding: "0 14px",
              height: 36,
              fontSize: "var(--font-md)",
              color: tab === key ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {label}
            {tab === key && (
              <div
                className="absolute bottom-0 left-2 right-2"
                style={{ height: 2, background: "var(--accent-orange)" }}
              />
            )}
          </button>
        ))}
      </div>

      {/* 筛选条 (仅在 filter tab) */}
      {tab === "filter" && (
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
                color:
                  filter === key ? "#fff" : "var(--text-secondary)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 内容 */}
      {loading || !data ? (
        <div
          className="px-3 py-3 grid gap-1.5"
          style={{ gridTemplateColumns: "repeat(6, 1fr)" }}
        >
          {Array.from({ length: 5 * 6 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse"
              style={{ background: "var(--bg-card)" }}
            />
          ))}
        </div>
      ) : tab === "analysis" ? (
        <IndustryGrid data={data} consecutiveDays={consecutiveDays} />
      ) : tab === "filter" ? (
        <IndustryGrid
          data={data}
          consecutiveDays={consecutiveDays}
          filter={filter}
        />
      ) : (
        <StreakList data={data} consecutiveDays={consecutiveDays} />
      )}
    </div>
  );
}
