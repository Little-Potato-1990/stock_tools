"use client";

import { Newspaper, TrendingDown, TrendingUp } from "lucide-react";
import type { SentimentNewsRef } from "./SentimentAiCard";

interface Props {
  /** brief.news_pool 全集 (按重要性) */
  newsPool?: SentimentNewsRef[];
  /** brief.news_ids LLM 重点引用的 (按情绪驱动) */
  pickedIds?: number[];
  onNewsClick?: (id: number) => void;
  /** 嵌入到主卡内部时, 取消外层分隔边距 */
  inCard?: boolean;
}

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
    <div>
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

export function SentimentEvidenceGrid({ newsPool, pickedIds, onNewsClick, inCard = false }: Props) {
  if (!newsPool || newsPool.length === 0) return null;

  return (
    <div
      className={inCard ? "pt-2" : "px-3 py-3"}
      style={{
        background: "transparent",
        borderBottom: inCard ? "none" : "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <NewsDriverRow pool={newsPool} picked={pickedIds} onClick={onNewsClick} />
    </div>
  );
}
