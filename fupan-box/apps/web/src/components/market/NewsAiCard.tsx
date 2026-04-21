"use client";

import {
  Sparkles,
  Newspaper,
  Star,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";
import { Dial } from "./dial/Dial";
import type { DialItem } from "./dial/types";

interface NewsLite {
  title: string;
  importance?: number;
  sentiment?: "bullish" | "neutral" | "bearish";
  rel_codes?: string[];
}

export type NewsDialAnchor = "total" | "important" | "net_sentiment" | "watch";

interface NewsCounts {
  total: number;
  important: number;
  bullish: number;
  bearish: number;
  net: number;
}

function aggregateNews(news: NewsLite[]): NewsCounts {
  let important = 0;
  let bullish = 0;
  let bearish = 0;
  for (const n of news) {
    if ((n.importance ?? 0) >= 3) important++;
    if (n.sentiment === "bullish") bullish++;
    else if (n.sentiment === "bearish") bearish++;
  }
  return {
    total: news.length,
    important,
    bullish,
    bearish,
    net: bullish - bearish,
  };
}

function deriveDials(c: NewsCounts, watchHits: number): DialItem<NewsDialAnchor>[] {
  const importantPct = c.total > 0 ? Math.round((c.important / c.total) * 100) : 0;
  const importantCaption =
    importantPct >= 30 ? "重磅密度高, 注意主线变量"
    : importantPct >= 15 ? "重磅占比正常"
    : "多为日常资讯, 无重大变量";
  const importantColor =
    importantPct >= 30 ? "var(--accent-red)"
    : importantPct >= 15 ? "var(--accent-orange)"
    : "var(--text-muted)";

  const netCaption =
    c.net >= 5 ? `利好 ${c.bullish} 利空 ${c.bearish}, 情绪偏多`
    : c.net <= -5 ? `利好 ${c.bullish} 利空 ${c.bearish}, 情绪偏空`
    : `利好 ${c.bullish} 利空 ${c.bearish}, 多空相当`;
  const netColor =
    c.net >= 5 ? "var(--accent-red)"
    : c.net <= -5 ? "var(--accent-green)"
    : "var(--text-muted)";

  const watchCaption =
    watchHits >= 3 ? "自选多次命中, 优先关注"
    : watchHits >= 1 ? "有自选命中, 可点开"
    : "无自选命中";
  const watchColor =
    watchHits >= 3 ? "var(--accent-orange)"
    : watchHits >= 1 ? "var(--accent-yellow)"
    : "var(--text-muted)";

  const totalCaption =
    c.total >= 50 ? "信息流密集"
    : c.total >= 20 ? "正常密度"
    : "信息稀疏";

  return [
    {
      anchor: "total",
      icon: Newspaper,
      label: "今日要闻",
      value: `${c.total}`,
      unit: "条",
      trend: "flat",
      caption: totalCaption,
      color: "var(--text-primary)",
    },
    {
      anchor: "important",
      icon: AlertTriangle,
      label: "重磅密度",
      value: `${importantPct}`,
      unit: "%",
      trend: importantPct >= 15 ? "up" : "flat",
      delta: `${c.important} 条`,
      caption: importantCaption,
      color: importantColor,
    },
    {
      anchor: "net_sentiment",
      icon: c.net >= 0 ? TrendingUp : TrendingDown,
      label: "情绪净值",
      value: `${c.net >= 0 ? "+" : ""}${c.net}`,
      trend: c.net > 0 ? "up" : c.net < 0 ? "down" : "flat",
      caption: netCaption,
      color: netColor,
    },
    {
      anchor: "watch",
      icon: Star,
      label: "自选命中",
      value: `${watchHits}`,
      unit: "条",
      trend: watchHits >= 1 ? "up" : "flat",
      caption: watchCaption,
      color: watchColor,
    },
  ];
}

function buildHeadline(c: NewsCounts, watchHits: number): string {
  if (c.total === 0) return "今日暂无要闻流入, 可点击右上角刷新拉取最新";

  const tilt =
    c.net >= 5 ? "AI 标记情绪偏多"
    : c.net <= -5 ? "AI 标记情绪偏空"
    : "多空消息相当";
  const watchPart = watchHits > 0 ? `, 其中 ${watchHits} 条命中自选` : "";
  const importantPart = c.important > 0 ? `, ${c.important} 条重磅` : "";
  return `今日 AI 已打标 ${c.total} 条要闻${importantPart}${watchPart}, ${tilt}`;
}

interface Props {
  news: NewsLite[];
  watchHits: number;
  loading?: boolean;
  hero?: boolean;
  activeAnchor?: NewsDialAnchor | null;
  onDialClick?: (anchor: NewsDialAnchor) => void;
}

export function NewsAiCard({
  news,
  watchHits,
  loading,
  hero = false,
  activeAnchor,
  onDialClick,
}: Props) {
  const counts = aggregateNews(news);
  const dials = deriveDials(counts, watchHits);
  const headline = loading ? "AI 正在打标新闻..." : buildHeadline(counts, watchHits);

  return (
    <div
      className={hero ? "px-6 py-5" : "px-3 py-2.5"}
      style={{
        background: hero
          ? "linear-gradient(135deg, rgba(168,85,247,0.10) 0%, var(--bg-tertiary) 60%)"
          : "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)",
        borderBottom: "1px solid var(--border-color)",
        borderLeft: hero ? "3px solid var(--accent-purple)" : undefined,
      }}
    >
      <div className={hero ? "flex items-center gap-2 mb-3" : "flex items-center gap-2 mb-2"}>
        <Sparkles size={hero ? 16 : 14} style={{ color: "var(--accent-purple)" }} />
        <span
          className="font-bold"
          style={{
            color: "var(--accent-purple)",
            fontSize: hero ? "var(--font-md)" : "var(--font-sm)",
            letterSpacing: 1,
          }}
        >
          AI 要闻聚合
        </span>
        <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
          · 实时聚合 · 标签由 AI 打标
        </span>
      </div>

      <div
        className={hero ? "font-bold mb-3" : "font-bold mb-2"}
        style={{
          fontSize: hero ? 22 : "var(--font-md)",
          color: "var(--text-primary)",
          lineHeight: hero ? 1.4 : 1.5,
          letterSpacing: hero ? 0.3 : 0,
        }}
      >
        {headline}
      </div>

      {!loading && news.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {dials.map((d) => (
            <Dial
              key={d.anchor}
              d={d}
              hero={hero}
              active={activeAnchor === d.anchor}
              onClick={() => onDialClick?.(d.anchor)}
              jumpHint="筛选列表"
            />
          ))}
        </div>
      )}
    </div>
  );
}
