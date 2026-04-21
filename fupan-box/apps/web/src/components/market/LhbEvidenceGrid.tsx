"use client";

import { Wallet, Landmark, Flame, Layers } from "lucide-react";
import { fmtAmount } from "@/lib/format";
import { EvidenceCard } from "./dial/EvidenceCard";
import type { CardSpec } from "./dial/types";
import type { LhbDialAnchor, LhbTrendPoint } from "./LhbAiCard";

interface Props {
  trendData: LhbTrendPoint[];
  highlight: LhbDialAnchor | null;
}

function fmtCount(v: number, unit: string): string {
  return `${Math.round(v)}${unit}`;
}

function describeAmountVsAvg(vals: number[], today: number): string {
  if (vals.length < 2) return `今日 ${fmtAmount(today)}`;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const delta = today - avg;
  const dir =
    delta > Math.max(Math.abs(avg) * 0.2, 5e7)
      ? "高于"
      : delta < -Math.max(Math.abs(avg) * 0.2, 5e7)
        ? "低于"
        : "接近";
  return `今日 ${fmtAmount(today)}, ${dir} 5 日均值 ${fmtAmount(avg)}`;
}

function describeCountVsAvg(
  vals: number[],
  today: number,
  unit: string,
): string {
  if (vals.length < 2) return `今日 ${today}${unit}`;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const delta = today - avg;
  const dir =
    delta > Math.max(avg * 0.15, 3)
      ? "高于"
      : delta < -Math.max(avg * 0.15, 3)
        ? "低于"
        : "接近";
  return `今日 ${today}${unit}, ${dir} 5 日均值 ${avg.toFixed(0)}${unit}`;
}

const CARDS: CardSpec<LhbDialAnchor, LhbTrendPoint>[] = [
  {
    anchor: "total_net",
    icon: Wallet,
    title: "上榜净买入 5 日",
    pick: (p) => p.total_net,
    fmt: fmtAmount,
    positive: "high",
    describe: (vals, today) => describeAmountVsAvg(vals, today),
  },
  {
    anchor: "inst_net",
    icon: Landmark,
    title: "机构净买入 5 日",
    pick: (p) => p.inst_net,
    fmt: fmtAmount,
    positive: "high",
    describe: (vals, today) => describeAmountVsAvg(vals, today),
  },
  {
    anchor: "hot_money",
    icon: Flame,
    title: "游资席位 5 日",
    pick: (p) => p.hot_money,
    fmt: (v) => fmtCount(v, "席"),
    positive: "high",
    describe: (vals, today) => describeCountVsAvg(vals, today, "席"),
  },
  {
    anchor: "stock_count",
    icon: Layers,
    title: "上榜股数 5 日",
    pick: (p) => p.stock_count,
    fmt: (v) => fmtCount(v, "只"),
    positive: "high",
    describe: (vals, today) => describeCountVsAvg(vals, today, "只"),
  },
];

export function LhbEvidenceGrid({ trendData, highlight }: Props) {
  if (!trendData || trendData.length === 0) {
    return (
      <div
        className="px-3 py-2"
        style={{
          fontSize: "var(--font-xs)",
          color: "var(--text-muted)",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        关键证据加载中…
      </div>
    );
  }

  return (
    <div
      className="px-3 py-3"
      style={{
        background: "var(--bg-tertiary)",
        borderBottom: "1px solid var(--border-color)",
      }}
    >
      <div
        className="flex items-center gap-2 mb-2"
        style={{
          fontSize: 10,
          color: "var(--text-muted)",
          letterSpacing: "0.08em",
        }}
      >
        <span style={{ fontWeight: 700 }}>AI 引用证据</span>
        <span>· 4 个核心维度的 5 日趋势, 与上方仪表盘一一对应, 点击仪表盘可定位</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {CARDS.map((spec) => (
          <EvidenceCard
            key={spec.anchor}
            spec={spec}
            trendData={trendData}
            highlight={highlight === spec.anchor}
          />
        ))}
      </div>
    </div>
  );
}
