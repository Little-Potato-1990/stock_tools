"use client";

import { useState, useEffect, useMemo } from "react";
import { Newspaper, RefreshCw, Star, TrendingUp, TrendingDown, Minus, Sparkles, Filter, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { PageHeader } from "@/components/layout/PageHeader";
import { NewsAiCard, type NewsDialAnchor } from "@/components/market/NewsAiCard";

type NewsItem = Awaited<ReturnType<typeof api.getNews>>[number];

type Filt = "all" | "important" | "watch" | "bullish" | "bearish";

function filtToAnchor(f: Filt): NewsDialAnchor | null {
  if (f === "all") return "total";
  if (f === "important") return "important";
  if (f === "watch") return "watch";
  if (f === "bullish" || f === "bearish") return "net_sentiment";
  return null;
}

const SENTIMENT_META: Record<NonNullable<NewsItem["sentiment"]>, { label: string; color: string; icon: typeof TrendingUp }> = {
  bullish: { label: "利好", color: "var(--accent-red)", icon: TrendingUp },
  bearish: { label: "利空", color: "var(--accent-green)", icon: TrendingDown },
  neutral: { label: "中性", color: "var(--text-muted)", icon: Minus },
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

export function NewsPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filt, setFilt] = useState<Filt>("all");
  const [watch, setWatch] = useState<Set<string>>(new Set());

  const openThemeDetail = useUIStore((s) => s.openThemeDetail);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const askAI = useUIStore((s) => s.askAI);

  const fetchNews = async () => {
    setLoading(true);
    try {
      const res = await api.getNews(50, true);
      setNews(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    if (api.isLoggedIn()) {
      api.getWatchlist()
        .then((rows) => setWatch(new Set(rows.map((r) => r.stock_code))))
        .catch(() => {});
    }
  }, []);

  const decorated = useMemo(() => {
    return news.map((it) => {
      const watchHit = (it.rel_codes || []).some((c) => watch.has(c));
      return { ...it, _watchHit: watchHit };
    });
  }, [news, watch]);

  const filtered = useMemo(() => {
    let arr = decorated;
    if (filt === "important") arr = arr.filter((it) => (it.importance || 0) >= 3);
    else if (filt === "watch") arr = arr.filter((it) => it._watchHit);
    else if (filt === "bullish") arr = arr.filter((it) => it.sentiment === "bullish");
    else if (filt === "bearish") arr = arr.filter((it) => it.sentiment === "bearish");
    return arr.slice().sort((a, b) => {
      if (a._watchHit !== b._watchHit) return a._watchHit ? -1 : 1;
      return (b.importance || 0) - (a.importance || 0);
    });
  }, [decorated, filt]);

  const counts = useMemo(() => {
    return {
      all: decorated.length,
      important: decorated.filter((i) => (i.importance || 0) >= 3).length,
      watch: decorated.filter((i) => i._watchHit).length,
      bullish: decorated.filter((i) => i.sentiment === "bullish").length,
      bearish: decorated.filter((i) => i.sentiment === "bearish").length,
    };
  }, [decorated]);

  const subtitle = decorated.length > 0
    ? `${decorated.length} 条 · AI 已打标 · 命中自选 ${counts.watch}`
    : undefined;

  const handleDialClick = (anchor: NewsDialAnchor) => {
    if (anchor === "total") setFilt("all");
    else if (anchor === "important") setFilt((p) => (p === "important" ? "all" : "important"));
    else if (anchor === "watch") setFilt((p) => (p === "watch" ? "all" : "watch"));
    else if (anchor === "net_sentiment") {
      const tilt = counts.bullish >= counts.bearish ? "bullish" : "bearish";
      setFilt((p) => (p === tilt ? "all" : tilt));
    }
  };

  const activeAnchor = filtToAnchor(filt);

  return (
    <div>
      <PageHeader
        title="财联社要闻"
        subtitle={subtitle}
        actions={
          <button
            onClick={fetchNews}
            disabled={loading}
            className="rounded transition-colors flex items-center gap-1"
            style={{
              padding: "4px 10px",
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              fontSize: "var(--font-sm)",
              border: "1px solid var(--border-color)",
            }}
            title="刷新 + 重新打标"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
        }
      />

      {/* L1: AI 主视觉 (headline + 4 dial), 数据由前端聚合 */}
      <NewsAiCard
        hero
        news={decorated}
        watchHits={counts.watch}
        loading={loading}
        activeAnchor={activeAnchor}
        onDialClick={handleDialClick}
      />

      <div className="px-3 pt-2">
        <div
          className="flex items-center gap-1 mb-2 px-2 py-1.5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
          }}
        >
          <Filter size={11} style={{ color: "var(--text-muted)" }} />
          <FilterChip active={filt === "all"} onClick={() => setFilt("all")} label={`全部 ${counts.all}`} />
          <FilterChip active={filt === "important"} onClick={() => setFilt("important")} label={`重磅 ${counts.important}`} icon="⭐" />
          <FilterChip active={filt === "watch"} onClick={() => setFilt("watch")} label={`命中自选 ${counts.watch}`} accent="orange" />
          <FilterChip active={filt === "bullish"} onClick={() => setFilt("bullish")} label={`利好 ${counts.bullish}`} accent="red" />
          <FilterChip active={filt === "bearish"} onClick={() => setFilt("bearish")} label={`利空 ${counts.bearish}`} accent="green" />
          <span className="ml-auto flex items-center gap-1" style={{ fontSize: 10, color: "var(--text-muted)" }}>
            <Sparkles size={9} style={{ color: "var(--accent-purple)" }} />
            AI 标签可点击
          </span>
        </div>
      </div>

      <div className="px-3 pb-3 space-y-1">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse"
              style={{ background: "var(--bg-card)" }}
            />
          ))
        ) : filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-3">
            <div
              className="w-14 h-14 rounded flex items-center justify-center"
              style={{ background: "var(--bg-tertiary)" }}
            >
              <Newspaper size={24} style={{ color: "var(--accent-blue)" }} />
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "var(--font-md)" }}>
              当前筛选无数据
            </div>
          </div>
        ) : (
          filtered.map((item, i) => {
            const sent = item.sentiment ? SENTIMENT_META[item.sentiment] : null;
            const SentIcon = sent?.icon;
            return (
              <div
                key={`${item.pub_time}-${i}`}
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
                    <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                      {(item.themes || item.related_concepts || []).slice(0, 6).map((concept) => (
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
                            background: watch.has(c) ? "rgba(245,158,11,0.18)" : "var(--bg-tertiary)",
                            color: watch.has(c) ? "var(--accent-orange)" : "var(--text-secondary)",
                            border: `1px solid ${watch.has(c) ? "rgba(245,158,11,0.4)" : "var(--border-color)"}`,
                          }}
                          title={watch.has(c) ? "你的自选" : "查看个股"}
                        >
                          {c}
                        </button>
                      ))}
                      <button
                        onClick={() => askAI(`这条新闻: 「${item.title}」\n${item.content || ""}\n\n请帮我判断: (1) 真实利好/利空程度 (2) 涉及哪些 A 股标的最受益/受损 (3) 短线是否值得参与, 给出明日盘前关注点。`)}
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
          })
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  icon,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: string;
  accent?: "orange" | "red" | "green";
}) {
  const accentColor =
    accent === "orange" ? "var(--accent-orange)" :
    accent === "red" ? "var(--accent-red)" :
    accent === "green" ? "var(--accent-green)" :
    "var(--accent-blue)";
  return (
    <button
      onClick={onClick}
      className="rounded transition-colors"
      style={{
        padding: "2px 8px",
        fontSize: 11,
        background: active ? accentColor : "transparent",
        color: active ? "#fff" : "var(--text-secondary)",
        border: active ? `1px solid ${accentColor}` : "1px solid var(--border-color)",
        fontWeight: active ? 700 : 500,
      }}
    >
      {icon && <span className="mr-0.5">{icon}</span>}
      {label}
    </button>
  );
}
