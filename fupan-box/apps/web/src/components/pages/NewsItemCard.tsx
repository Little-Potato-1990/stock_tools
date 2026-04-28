"use client";

import { memo, useCallback, type MouseEvent } from "react";
import { Star, Zap, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { HORIZON_META, type NewsHorizon as Horizon } from "@/components/pages/news-constants";

type Sentiment = "bullish" | "bearish" | "neutral";

const SENTIMENT_META: Record<Sentiment, { label: string; color: string; icon: typeof TrendingUp }> = {
  bullish: { label: "利好", color: "var(--accent-red)", icon: TrendingUp },
  bearish: { label: "利空", color: "var(--accent-green)", icon: TrendingDown },
  neutral: { label: "中性", color: "var(--text-muted)", icon: Minus },
};

export interface NewsCardItem {
  id?: number | null;
  pub_time?: string | null;
  title: string;
  content?: string | null;
  source?: string | null;
  sentiment?: Sentiment | null;
  impact_horizon?: Horizon | null;
  tags?: string[] | null;
  importance?: number | null;
  rel_codes?: string[] | null;
  themes?: string[] | null;
  related_concepts?: string[] | null;
  _watchHit: boolean;
  _watchCodes: Set<string>;
}

export function newsItemKey(item: NewsCardItem): string {
  return `${item.id ?? item.pub_time ?? item.title ?? "news"}::${item.source ?? ""}`;
}

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

function sameStringArray(a?: string[] | null, b?: string[] | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

function areEqual(
  prev: Readonly<NewsItemCardProps>,
  next: Readonly<NewsItemCardProps>,
): boolean {
  const a = prev.item;
  const b = next.item;
  if (
    a.id !== b.id ||
    a.pub_time !== b.pub_time ||
    a.title !== b.title ||
    a.content !== b.content ||
    a.source !== b.source ||
    a.sentiment !== b.sentiment ||
    a.impact_horizon !== b.impact_horizon ||
    a.importance !== b.importance ||
    a._watchHit !== b._watchHit
  ) {
    return false;
  }
  if (
    !sameStringArray(a.tags, b.tags) ||
    !sameStringArray(a.rel_codes, b.rel_codes) ||
    !sameStringArray(a.themes, b.themes) ||
    !sameStringArray(a.related_concepts, b.related_concepts) ||
    !sameSet(a._watchCodes, b._watchCodes)
  ) {
    return false;
  }
  return (
    prev.openThemeDetail === next.openThemeDetail &&
    prev.openStockDetail === next.openStockDetail &&
    prev.askAI === next.askAI
  );
}

interface NewsItemCardProps {
  item: NewsCardItem;
  openThemeDetail: (name: string) => void;
  openStockDetail: (code: string, name?: string) => void;
  askAI: (message: string) => void;
}

export const NewsItemCard = memo(function NewsItemCard({
  item,
  openThemeDetail,
  openStockDetail,
  askAI,
}: NewsItemCardProps) {
  const sent = item.sentiment ? SENTIMENT_META[item.sentiment] : null;
  const SentIcon = sent?.icon;
  const themesArr = item.themes || item.related_concepts || [];
  const onMetaActionClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest<HTMLButtonElement>("button[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const value = btn.dataset.value;
      if (!action || !value) return;
      if (action === "theme") {
        openThemeDetail(value);
        return;
      }
      if (action === "code") {
        openStockDetail(value);
      }
    },
    [openStockDetail, openThemeDetail],
  );
  const askThisNews = useCallback(() => {
    askAI(
      `这条新闻: 「${item.title}」\n${item.content || ""}\n\n请帮我判断: (1) 真实利好/利空程度 (2) 涉及哪些 A 股标的最受益/受损 (3) 短线是否值得参与, 给出明日盘前关注点。`,
    );
  }, [askAI, item.title, item.content]);

  return (
    <div
      id={item.id != null ? `news-item-${item.id}` : undefined}
      className="px-3 py-2"
      style={{
        background: item._watchHit ? "rgba(245,158,11,0.06)" : "var(--bg-card)",
        border: item._watchHit ? "1px solid rgba(245,158,11,0.4)" : "1px solid var(--border-color)",
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
                title="新闻源"
              >
                {item.source}
              </span>
            )}
            {item._watchHit && (
              <span
                className="flex items-center gap-0.5 font-bold"
                style={{
                  padding: "1px 5px",
                  background: "var(--accent-orange)",
                  color: "#1a1d28",
                  fontSize: 10,
                  borderRadius: 2,
                }}
                title="命中你的自选股"
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
                  background: sent.color === "var(--text-muted)" ? "var(--bg-tertiary)" : "transparent",
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
            {item.impact_horizon && (
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
            {item.tags && item.tags.length > 0 && item.tags.map((tag) => (
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
            {(item.importance || 0) > 0 && <ImportanceStars value={item.importance || 0} />}
          </div>
          <h3
            className="font-semibold leading-snug"
            style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
          >
            {item.title}
          </h3>
          {item.content && (
            <p
              className="mt-1 leading-relaxed line-clamp-2"
              style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
            >
              {item.content}
            </p>
          )}
          <div className="flex flex-wrap gap-1 mt-1.5 items-center" onClick={onMetaActionClick}>
            {themesArr.slice(0, 6).map((concept) => (
              <button
                key={concept}
                data-action="theme"
                data-value={concept}
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
                data-action="code"
                data-value={c}
                className="rounded transition-colors tabular-nums"
                style={{
                  padding: "1px 5px",
                  fontSize: 10,
                  background: item._watchCodes.has(c) ? "rgba(245,158,11,0.18)" : "var(--bg-tertiary)",
                  color: item._watchCodes.has(c) ? "var(--accent-orange)" : "var(--text-secondary)",
                  border: `1px solid ${item._watchCodes.has(c) ? "rgba(245,158,11,0.4)" : "var(--border-color)"}`,
                }}
                title={item._watchCodes.has(c) ? "你的自选" : "查看个股"}
              >
                {c}
              </button>
            ))}
            <button
              onClick={askThisNews}
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
}, areEqual);
