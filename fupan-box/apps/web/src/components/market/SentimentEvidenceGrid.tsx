"use client";

import { TrendingUp, Coins, Flame, AlertTriangle, Newspaper, TrendingDown } from "lucide-react";
import { EvidenceCard } from "./dial/EvidenceCard";
import type { CardSpec } from "./dial/types";
import type { DialAnchor, SentimentNewsRef, TrendPoint } from "./SentimentAiCard";

interface Props {
  /** 来自 SentimentAiCard 的 trend_5d, 共享避免重复请求 */
  trendData: TrendPoint[];
  /** 高亮锚点: 与 L1 dial 联动. null 表示未高亮 */
  highlight: DialAnchor | null;
  /** brief.news_pool 全集 (按重要性) */
  newsPool?: SentimentNewsRef[];
  /** brief.news_ids LLM 重点引用的 (按情绪驱动) */
  pickedIds?: number[];
  onNewsClick?: (id: number) => void;
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

function NewsDriverRow({
  pool,
  picked,
  onClick,
}: {
  pool?: SentimentNewsRef[];
  picked?: number[];
  onClick?: (id: number) => void;
}) {
  if (!pool || pool.length === 0) return null;
  // LLM 引用优先, 然后按 importance
  const pickedSet = new Set(picked || []);
  const ordered = [...pool].sort((a, b) => {
    const ap = pickedSet.has(a.id) ? 0 : 1;
    const bp = pickedSet.has(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return (b.importance || 0) - (a.importance || 0);
  });
  return (
    <div className="mt-3 pt-2" style={{ borderTop: "1px solid var(--border-color)" }}>
      <div
        className="flex items-center gap-2 mb-1.5"
        style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em" }}
      >
        <Newspaper size={10} style={{ color: "var(--accent-purple)" }} />
        <span style={{ fontWeight: 700 }}>消息面驱动</span>
        <span>· AI 圈出影响今日情绪的关键新闻 (高亮 = LLM 重点引用)</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ordered.slice(0, 6).map((n) => {
          const isPicked = pickedSet.has(n.id);
          const sentColor =
            n.sentiment === "bullish" ? "var(--accent-red)" :
            n.sentiment === "bearish" ? "var(--accent-green)" :
            "var(--text-muted)";
          const SentIcon = n.sentiment === "bullish" ? TrendingUp : n.sentiment === "bearish" ? TrendingDown : null;
          return (
            <button
              key={n.id}
              onClick={() => onClick?.(n.id)}
              className="rounded text-left flex items-start gap-1"
              style={{
                padding: "4px 8px",
                fontSize: 11,
                background: isPicked ? "rgba(168,85,247,0.16)" : "var(--bg-card)",
                border: isPicked ? "1px solid rgba(168,85,247,0.55)" : "1px solid var(--border-color)",
                color: "var(--text-primary)",
                maxWidth: 280,
              }}
              title={n.title}
            >
              {SentIcon ? <SentIcon size={10} style={{ color: sentColor, marginTop: 1, flexShrink: 0 }} /> : null}
              <span className="truncate" style={{ maxWidth: 240 }}>{n.title}</span>
              {(n.importance || 0) >= 4 && (
                <span style={{ fontSize: 9, color: "var(--accent-orange)", marginLeft: "auto" }}>★</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SentimentEvidenceGrid({ trendData, highlight, newsPool, pickedIds, onNewsClick }: Props) {
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
      <NewsDriverRow pool={newsPool} picked={pickedIds} onClick={onNewsClick} />
    </div>
  );
}
