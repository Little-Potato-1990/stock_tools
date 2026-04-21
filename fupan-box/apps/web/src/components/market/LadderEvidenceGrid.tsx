"use client";

import { Flame, TrendingUp, Layers, AlertTriangle } from "lucide-react";
import { EvidenceCard } from "./dial/EvidenceCard";
import type { CardSpec } from "./dial/types";
import type { LadderDialAnchor, LadderTrendPoint } from "./LadderAiCard";

interface Props {
  trendData: LadderTrendPoint[];
  highlight: LadderDialAnchor | null;
}

const CARDS: CardSpec<LadderDialAnchor, LadderTrendPoint>[] = [
  {
    anchor: "max_level",
    icon: Flame,
    title: "最高板 5 日",
    pick: (p) => p.max_level,
    fmt: (v) => `${Math.round(v)}板`,
    positive: "high",
    describe: (vals, today) => {
      const peak = Math.max(...vals);
      if (today >= peak) return `今日 ${today} 板, 5 日新高`;
      return `今日 ${today} 板, 5 日峰值 ${peak} 板`;
    },
  },
  {
    anchor: "promo",
    icon: TrendingUp,
    title: "晋级率 5 日",
    pick: (p) => p.promo_rate,
    fmt: (v) => `${(v * 100).toFixed(0)}%`,
    positive: "high",
    describe: (vals, today, p) => {
      if (vals.length < 2)
        return `今日 ${(today * 100).toFixed(0)}% (${p?.promo_count ?? 0}/${p?.promo_total ?? 0})`;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const dir =
        today > avg + 0.05 ? "改善" : today < avg - 0.05 ? "走弱" : "持平";
      return `今日 ${(today * 100).toFixed(0)}% (${p?.promo_count ?? 0}/${p?.promo_total ?? 0}), 较 5 日均值 ${dir}`;
    },
  },
  {
    anchor: "first_board",
    icon: Layers,
    title: "首板数 5 日",
    pick: (p) => p.first_board,
    fmt: (v) => `${Math.round(v)}只`,
    positive: "high",
    describe: (vals, today) => {
      if (vals.length < 2) return `今日 ${today} 只`;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const delta = today - avg;
      const dir = delta > 5 ? "高于" : delta < -5 ? "低于" : "接近";
      return `今日 ${today} 只首板, ${dir}近 5 日均值 ${avg.toFixed(0)}`;
    },
  },
  {
    anchor: "broken",
    icon: AlertTriangle,
    title: "炸板数 5 日",
    pick: (p) => p.broken,
    fmt: (v) => `${Math.round(v)}只`,
    positive: "low",
    describe: (vals, today) => {
      if (vals.length < 2) return `今日 ${today} 只`;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const delta = today - avg;
      const dir =
        delta > 3 ? "升高 (恶化)" : delta < -3 ? "下降 (改善)" : "持平";
      return `今日 ${today} 只, 较均值 ${dir} ${Math.abs(delta).toFixed(0)}`;
    },
  },
];

export function LadderEvidenceGrid({ trendData, highlight }: Props) {
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
