"use client";

/**
 * 通用新闻条目列表渲染.
 *
 * 抽自 NewsPage 的单条新闻渲染逻辑, 给「个股深度」NewsTab (个股相关新闻 timeline) 复用.
 *
 * 输入是已排好序的新闻数组 (调用方可以传 getNews / getStockNewsTimeline / getThemeNewsTimeline 的 items).
 * 不带任何过滤 / 检索 UI, 那些属于 NewsPage 自己的能力.
 */

import {
  Star,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  Newspaper,
} from "lucide-react";
import { useUIStore } from "@/stores/ui-store";

export interface NewsItemLite {
  id?: number;
  title: string;
  content?: string;
  pub_time: string;
  source?: string;
  importance?: number;
  sentiment?: "bullish" | "neutral" | "bearish";
  impact_horizon?: "short" | "swing" | "long" | "mixed";
  themes?: string[];
  rel_codes?: string[];
  tags?: string[];
  related_concepts?: string[];
}

const SENTIMENT_META: Record<
  NonNullable<NewsItemLite["sentiment"]>,
  { label: string; color: string; icon: typeof TrendingUp }
> = {
  bullish: { label: "利好", color: "var(--accent-red)", icon: TrendingUp },
  bearish: { label: "利空", color: "var(--accent-green)", icon: TrendingDown },
  neutral: { label: "中性", color: "var(--text-muted)", icon: Minus },
};

const HORIZON_META: Record<
  NonNullable<NewsItemLite["impact_horizon"]>,
  { label: string; color: string; desc: string }
> = {
  short: { label: "短线", color: "var(--accent-orange)", desc: "1-5 日盘面催化" },
  swing: { label: "波段", color: "var(--accent-blue)", desc: "5-20 日驱动" },
  long: { label: "长线", color: "var(--accent-purple)", desc: "6 月+ 产业逻辑" },
  mixed: { label: "复合", color: "var(--text-secondary)", desc: "多时间维度" },
};

function ImportanceStars({ value }: { value: number }) {
  const v = Math.max(0, Math.min(5, value));
  return (
    <span className="inline-flex items-center" title={`重要级 ${v}/5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={9}
          fill={i < v ? "var(--accent-orange)" : "transparent"}
          stroke={i < v ? "var(--accent-orange)" : "var(--border-color)"}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
}

interface Props {
  items: NewsItemLite[];
  /** 命中自选的代码集合 (可选, 决定是否给条目高亮 + 显示「自选」徽章) */
  watchCodes?: Set<string>;
  /** 空态文案 */
  emptyText?: string;
  /** 是否显示「问 AI」快捷追问按钮 (默认 true) */
  showAskAi?: boolean;
}

export function NewsTimelineList({
  items,
  watchCodes,
  emptyText = "暂无相关新闻",
  showAskAi = true,
}: Props) {
  const openThemeDetail = useUIStore((s) => s.openThemeDetail);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const askAI = useUIStore((s) => s.askAI);
  const watch = watchCodes ?? new Set<string>();

  if (items.length === 0) {
    return (
      <div className="py-12 flex flex-col items-center gap-3">
        <div
          className="w-14 h-14 rounded flex items-center justify-center"
          style={{ background: "var(--bg-tertiary)" }}
        >
          <Newspaper size={24} style={{ color: "var(--accent-blue)" }} />
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: "var(--font-md)" }}>
          {emptyText}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((item, i) => {
        const watchHit = (item.rel_codes || []).some((c) => watch.has(c));
        const sent = item.sentiment ? SENTIMENT_META[item.sentiment] : null;
        const SentIcon = sent?.icon;
        const themesArr = item.themes || item.related_concepts || [];
        return (
          <div
            key={`${item.id ?? item.pub_time}-${i}`}
            className="px-3 py-2"
            style={{
              background: watchHit
                ? "rgba(245,158,11,0.06)"
                : "var(--bg-card)",
              border: watchHit
                ? "1px solid rgba(245,158,11,0.4)"
                : "1px solid var(--border-color)",
              borderRadius: 4,
            }}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  {item.source && (
                    <span
                      style={{
                        padding: "1px 5px",
                        background: "var(--bg-tertiary)",
                        color: "var(--text-muted)",
                        fontSize: 10,
                        borderRadius: 2,
                        border: "1px solid var(--border-color)",
                      }}
                    >
                      {item.source}
                    </span>
                  )}
                  {watchHit && (
                    <span
                      className="flex items-center gap-0.5 font-bold"
                      style={{
                        padding: "1px 5px",
                        background: "var(--accent-orange)",
                        color: "#1a1d28",
                        fontSize: 10,
                        borderRadius: 2,
                      }}
                    >
                      <Star size={9} fill="#1a1d28" />
                      自选
                    </span>
                  )}
                  {sent && SentIcon && (
                    <span
                      className="flex items-center gap-0.5 font-bold"
                      style={{
                        padding: "1px 5px",
                        background:
                          sent.color === "var(--text-muted)"
                            ? "var(--bg-tertiary)"
                            : "transparent",
                        border: `1px solid ${sent.color}`,
                        color: sent.color,
                        fontSize: 10,
                        borderRadius: 2,
                      }}
                    >
                      <SentIcon size={9} />
                      {sent.label}
                    </span>
                  )}
                  {item.impact_horizon && HORIZON_META[item.impact_horizon] && (
                    <span
                      className="font-bold"
                      style={{
                        padding: "1px 5px",
                        background: `${HORIZON_META[item.impact_horizon].color}22`,
                        border: `1px solid ${HORIZON_META[item.impact_horizon].color}`,
                        color: HORIZON_META[item.impact_horizon].color,
                        fontSize: 10,
                        borderRadius: 2,
                      }}
                      title={HORIZON_META[item.impact_horizon].desc}
                    >
                      {HORIZON_META[item.impact_horizon].label}
                    </span>
                  )}
                  {item.tags &&
                    item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="font-semibold"
                        style={{
                          padding: "1px 5px",
                          background: "rgba(168,85,247,0.14)",
                          color: "var(--accent-purple)",
                          fontSize: 10,
                          borderRadius: 2,
                          border: "1px solid rgba(168,85,247,0.3)",
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  {(item.importance || 0) > 0 && (
                    <ImportanceStars value={item.importance || 0} />
                  )}
                </div>
                <h3
                  className="font-semibold leading-snug"
                  style={{
                    color: "var(--text-primary)",
                    fontSize: "var(--font-md)",
                  }}
                >
                  {item.title}
                </h3>
                {item.content && (
                  <p
                    className="mt-1 leading-relaxed line-clamp-2"
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "var(--font-sm)",
                    }}
                  >
                    {item.content}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                  {themesArr.slice(0, 6).map((concept) => (
                    <button
                      key={concept}
                      onClick={() => openThemeDetail(concept)}
                      className="rounded transition-colors"
                      style={{
                        padding: "1px 6px",
                        fontSize: 10,
                        background: "rgba(245,158,11,0.14)",
                        color: "var(--accent-orange)",
                        border: "1px solid rgba(245,158,11,0.3)",
                      }}
                    >
                      {concept}
                    </button>
                  ))}
                  {(item.rel_codes || []).slice(0, 4).map((c) => (
                    <button
                      key={c}
                      onClick={() => openStockDetail(c)}
                      className="rounded transition-colors tabular-nums"
                      style={{
                        padding: "1px 5px",
                        fontSize: 10,
                        background: watch.has(c)
                          ? "rgba(245,158,11,0.18)"
                          : "var(--bg-tertiary)",
                        color: watch.has(c)
                          ? "var(--accent-orange)"
                          : "var(--text-secondary)",
                        border: `1px solid ${
                          watch.has(c)
                            ? "rgba(245,158,11,0.4)"
                            : "var(--border-color)"
                        }`,
                      }}
                      title={watch.has(c) ? "你的自选" : "查看个股"}
                    >
                      {c}
                    </button>
                  ))}
                  {showAskAi && (
                    <button
                      onClick={() =>
                        askAI(
                          `这条新闻: 「${item.title}」\n${item.content || ""}\n\n请帮我判断: (1) 真实利好/利空程度 (2) 涉及哪些 A 股标的最受益/受损 (3) 短线是否值得参与, 给出明日盘前关注点。`,
                        )
                      }
                      className="ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors"
                      style={{
                        fontSize: 10,
                        background: "rgba(168,85,247,0.12)",
                        color: "var(--accent-purple)",
                        border: "1px solid rgba(168,85,247,0.3)",
                      }}
                      title="让 AI 拆这条新闻"
                    >
                      <Zap size={9} />
                      问AI
                    </button>
                  )}
                </div>
              </div>
              {item.pub_time && (
                <span
                  className="whitespace-nowrap flex-shrink-0 tabular-nums"
                  style={{ color: "var(--text-muted)", fontSize: 10 }}
                >
                  {item.pub_time.slice(5, 16)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
