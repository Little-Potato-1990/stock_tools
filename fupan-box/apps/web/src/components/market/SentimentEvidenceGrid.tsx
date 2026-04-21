"use client";

import { TrendingUp, Coins, Flame, AlertTriangle } from "lucide-react";
import { EvidenceCard } from "./dial/EvidenceCard";
import type { CardSpec } from "./dial/types";
import type { DialAnchor, TrendPoint } from "./SentimentAiCard";

interface Props {
  /** 来自 SentimentAiCard 的 trend_5d, 共享避免重复请求 */
  trendData: TrendPoint[];
  /** 高亮锚点: 与 L1 dial 联动. null 表示未高亮 */
  highlight: DialAnchor | null;
}

const CARDS: CardSpec<DialAnchor, TrendPoint>[] = [
  {
    anchor: "limit_up",
    icon: TrendingUp,
    title: "涨停数 5 日",
    pick: (p) => p.lu,
    fmt: (v) => `${Math.round(v)}`,
    positive: "high",
    describe: (vals, today) => {
      if (vals.length < 2) return `今日 ${today} 只`;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const delta = today - avg;
      const dir = delta > 5 ? "高于" : delta < -5 ? "低于" : "接近";
      return `今日 ${today} 只, ${dir}近 5 日均值 ${avg.toFixed(0)}`;
    },
  },
  {
    anchor: "making_money",
    icon: Coins,
    title: "赚钱效应 5 日",
    pick: (p) => p.yesterday_lu_up_rate,
    fmt: (v) => `${(v * 100).toFixed(0)}%`,
    positive: "high",
    describe: (vals, today) => {
      if (vals.length < 2) return `今日 ${(today * 100).toFixed(0)}%`;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const dir =
        today > avg + 0.05 ? "改善" : today < avg - 0.05 ? "走弱" : "持平";
      return `今日 ${(today * 100).toFixed(0)}%, 较 5 日均值 ${(avg * 100).toFixed(0)}% ${dir}`;
    },
  },
  {
    anchor: "max_height",
    icon: Flame,
    title: "高度结构 5 日",
    pick: (p) => p.max_height ?? 0,
    fmt: (v) => `${Math.round(v)}板`,
    positive: "high",
    describe: (vals, today) => {
      const peak = Math.max(...vals);
      if (today >= peak) return `今日 ${today} 板, 5 日新高`;
      return `今日 ${today} 板, 5 日峰值 ${peak} 板`;
    },
  },
  {
    anchor: "broken_rate",
    icon: AlertTriangle,
    title: "炸板率 5 日",
    pick: (p) => p.broken_rate,
    fmt: (v) => `${(v * 100).toFixed(0)}%`,
    positive: "low",
    describe: (vals, today) => {
      if (vals.length < 2) return `今日 ${(today * 100).toFixed(0)}%`;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const delta = (today - avg) * 100;
      const dir =
        delta > 5 ? "升高 (恶化)" : delta < -5 ? "下降 (改善)" : "持平";
      return `今日 ${(today * 100).toFixed(0)}%, 较均值 ${dir} ${Math.abs(delta).toFixed(0)}pp`;
    },
  },
];

export function SentimentEvidenceGrid({ trendData, highlight }: Props) {
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
