"use client";

import {
  Sparkles,
  Newspaper,
  Star,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  ShieldAlert,
  Briefcase,
  Landmark,
  ArrowRight,
} from "lucide-react";
import { Dial } from "./dial/Dial";
import type { DialItem } from "./dial/types";
import { CacheMetaBadge, getCacheMeta } from "./CacheMetaBadge";

interface NewsLite {
  id?: number;
  title: string;
  importance?: number;
  sentiment?: "bullish" | "neutral" | "bearish";
  rel_codes?: string[];
}

export interface NewsBriefThread {
  name: string;
  summary: string;
  themes?: string[];
  stock_codes: string[];
  news_ids: number[];
  sentiment: "bullish" | "neutral" | "bearish";
}

export interface NewsBriefBucket {
  summary: string;
  news_ids: number[];
}

export interface NewsBriefPayload {
  trade_date: string;
  generated_at: string;
  model: string;
  stats: { total: number; important: number; bullish: number; bearish: number; neutral: number; watch: number };
  headline: string;
  main_threads: NewsBriefThread[];
  policy: NewsBriefBucket[];
  shock: NewsBriefBucket[];
  earnings: NewsBriefBucket[];
  tomorrow_brief: string;
  watchlist_alerts?: Array<{
    news_id: number; title: string; codes: string[];
    importance: number; sentiment: string; pub_time: string;
  }>;
  global_signals?: Array<{
    news_id?: number;
    title: string;
    pub_time?: string | null;
    importance: number;
    sentiment?: string | null;
    overseas_event: string;
    transmission: string;
    beneficiary_codes: string[];
    confidence: "high" | "medium" | "low";
  }>;
}

export type NewsDialAnchor = "total" | "important" | "net_sentiment" | "watch";

function fallbackCounts(news: NewsLite[]): NewsBriefPayload["stats"] {
  let important = 0;
  let bullish = 0;
  let bearish = 0;
  for (const n of news) {
    if ((n.importance ?? 0) >= 4) important++;
    if (n.sentiment === "bullish") bullish++;
    else if (n.sentiment === "bearish") bearish++;
  }
  return {
    total: news.length,
    important,
    bullish,
    bearish,
    neutral: news.length - bullish - bearish,
    watch: 0,
  };
}

function deriveDials(
  c: NewsBriefPayload["stats"],
  watchHits: number,
): DialItem<NewsDialAnchor>[] {
  const importantPct = c.total > 0 ? Math.round((c.important / c.total) * 100) : 0;
  const importantCaption =
    importantPct >= 30 ? "重磅密度高, 注意主线变量"
    : importantPct >= 15 ? "重磅占比正常"
    : "多为日常资讯, 无重大变量";
  const importantColor =
    importantPct >= 30 ? "var(--accent-red)"
    : importantPct >= 15 ? "var(--accent-orange)"
    : "var(--text-muted)";

  const net = c.bullish - c.bearish;
  const netCaption =
    net >= 5 ? `利好 ${c.bullish} 利空 ${c.bearish}, 情绪偏多`
    : net <= -5 ? `利好 ${c.bullish} 利空 ${c.bearish}, 情绪偏空`
    : `利好 ${c.bullish} 利空 ${c.bearish}, 多空相当`;
  const netColor =
    net >= 5 ? "var(--accent-red)"
    : net <= -5 ? "var(--accent-green)"
    : "var(--text-muted)";

  const wh = watchHits || c.watch || 0;
  const watchCaption =
    wh >= 3 ? "自选多次命中, 优先关注"
    : wh >= 1 ? "有自选命中, 可点开"
    : "无自选命中";
  const watchColor =
    wh >= 3 ? "var(--accent-orange)"
    : wh >= 1 ? "var(--accent-yellow)"
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
      icon: net >= 0 ? TrendingUp : TrendingDown,
      label: "情绪净值",
      value: `${net >= 0 ? "+" : ""}${net}`,
      trend: net > 0 ? "up" : net < 0 ? "down" : "flat",
      caption: netCaption,
      color: netColor,
    },
    {
      anchor: "watch",
      icon: Star,
      label: "自选命中",
      value: `${wh}`,
      unit: "条",
      trend: wh >= 1 ? "up" : "flat",
      caption: watchCaption,
      color: watchColor,
    },
  ];
}

const SENT_BADGE = {
  bullish: { label: "利好", color: "var(--accent-red)" },
  bearish: { label: "利空", color: "var(--accent-green)" },
  neutral: { label: "中性", color: "var(--text-muted)" },
} as const;

interface Props {
  news: NewsLite[];
  brief?: NewsBriefPayload | null;
  briefLoading?: boolean;
  briefStreaming?: string;          // 流式 headline (打字机)
  watchHits: number;
  loading?: boolean;
  hero?: boolean;
  activeAnchor?: NewsDialAnchor | null;
  onDialClick?: (anchor: NewsDialAnchor) => void;
  onThreadClick?: (thread: NewsBriefThread) => void;
  onBucketClick?: (bucket: "policy" | "shock" | "earnings", item: NewsBriefBucket) => void;
  onCodeClick?: (code: string) => void;
  onThemeClick?: (name: string) => void;
}

export function NewsAiCard({
  news,
  brief,
  briefLoading,
  briefStreaming,
  watchHits,
  loading,
  hero = false,
  activeAnchor,
  onDialClick,
  onThreadClick,
  onBucketClick,
  onCodeClick,
  onThemeClick,
}: Props) {
  const stats = brief?.stats ?? fallbackCounts(news);
  const dials = deriveDials(stats, watchHits);
  // 优先级: streaming > brief.headline > loading text > 兜底句
  let headline: string;
  if (briefStreaming) headline = briefStreaming;
  else if (brief?.headline) headline = brief.headline;
  else if (loading || briefLoading) headline = "AI 正在汇总今日要闻...";
  else if (stats.total === 0) headline = "今日暂无要闻流入, 可点击右上角刷新拉取最新";
  else headline = `今日 AI 已抓 ${stats.total} 条要闻, 等待 brief 加载`;

  const threads = brief?.main_threads ?? [];
  const policy = brief?.policy ?? [];
  const shock = brief?.shock ?? [];
  const earnings = brief?.earnings ?? [];
  const alerts = brief?.watchlist_alerts ?? [];

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
          · 多源聚合 · LLM 主线/政策/突发分桶
        </span>
        <span className="ml-auto flex items-center gap-2">
          {brief?.model && (
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {brief.model}
            </span>
          )}
          {getCacheMeta(brief) && (
            <CacheMetaBadge meta={getCacheMeta(brief)} />
          )}
        </span>
      </div>

      {/* L1 headline */}
      <div
        className={hero ? "font-bold mb-3" : "font-bold mb-2"}
        style={{
          fontSize: hero ? 22 : "var(--font-md)",
          color: "var(--text-primary)",
          lineHeight: hero ? 1.4 : 1.5,
          letterSpacing: hero ? 0.3 : 0,
          minHeight: hero ? 30 : undefined,
        }}
      >
        {headline}
      </div>

      {/* L1 dials */}
      {!loading && stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
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

      {/* L2 main_threads */}
      {threads.length > 0 && (
        <div className="mb-3">
          <SectionTitle icon={Target} text="主线追踪" color="var(--accent-purple)" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1.5">
            {threads.map((t, idx) => {
              const sb = SENT_BADGE[t.sentiment] ?? SENT_BADGE.neutral;
              return (
                <button
                  key={`${t.name}-${idx}`}
                  onClick={() => onThreadClick?.(t)}
                  className="text-left px-3 py-2 rounded transition-colors hover:opacity-100"
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-color)",
                    opacity: 0.95,
                  }}
                  title={`点击筛选「${t.name}」相关新闻`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="font-bold"
                      style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
                    >
                      {t.name}
                    </span>
                    <span
                      style={{
                        padding: "1px 5px",
                        background: "transparent",
                        border: `1px solid ${sb.color}`,
                        color: sb.color,
                        fontSize: 10,
                        borderRadius: 2,
                      }}
                    >
                      {sb.label}
                    </span>
                    <ArrowRight size={11} style={{ color: "var(--text-muted)", marginLeft: "auto" }} />
                  </div>
                  <div
                    className="leading-snug mb-1"
                    style={{ color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}
                  >
                    {t.summary}
                  </div>
                  {(t.stock_codes?.length ?? 0) + (t.themes?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(t.themes || []).slice(0, 3).map((th) => (
                        <span
                          key={th}
                          onClick={(e) => { e.stopPropagation(); onThemeClick?.(th); }}
                          className="cursor-pointer"
                          style={{
                            padding: "1px 5px",
                            fontSize: 10,
                            background: "rgba(245,158,11,0.14)",
                            color: "var(--accent-orange)",
                            border: "1px solid rgba(245,158,11,0.3)",
                            borderRadius: 2,
                          }}
                        >
                          {th}
                        </span>
                      ))}
                      {(t.stock_codes || []).slice(0, 4).map((c) => (
                        <span
                          key={c}
                          onClick={(e) => { e.stopPropagation(); onCodeClick?.(c); }}
                          className="cursor-pointer tabular-nums"
                          style={{
                            padding: "1px 5px",
                            fontSize: 10,
                            background: "var(--bg-tertiary)",
                            color: "var(--text-secondary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: 2,
                          }}
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* L2 政策 / 突发 / 业绩 三个小桶 */}
      {(policy.length > 0 || shock.length > 0 || earnings.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
          <BucketCard
            icon={Landmark}
            title="政策"
            color="var(--accent-blue)"
            items={policy}
            onClick={(it) => onBucketClick?.("policy", it)}
          />
          <BucketCard
            icon={ShieldAlert}
            title="突发风险"
            color="var(--accent-red)"
            items={shock}
            onClick={(it) => onBucketClick?.("shock", it)}
          />
          <BucketCard
            icon={Briefcase}
            title="业绩 / 公告"
            color="var(--accent-orange)"
            items={earnings}
            onClick={(it) => onBucketClick?.("earnings", it)}
          />
        </div>
      )}

      {/* L2 自选股命中告警 */}
      {alerts.length > 0 && (
        <div
          className="mb-3 px-3 py-2 rounded"
          style={{
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.4)",
          }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <Star size={12} style={{ color: "var(--accent-orange)" }} fill="var(--accent-orange)" />
            <span
              className="font-bold"
              style={{ color: "var(--accent-orange)", fontSize: "var(--font-sm)" }}
            >
              你的自选股被命中 ({alerts.length})
            </span>
          </div>
          <div className="space-y-0.5">
            {alerts.slice(0, 4).map((a, i) => (
              <div
                key={i}
                className="leading-snug truncate"
                style={{ color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}
                title={a.title}
              >
                <span
                  className="tabular-nums font-semibold mr-1.5"
                  style={{ color: "var(--accent-orange)" }}
                >
                  {a.codes.join("/")}
                </span>
                {a.title}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* L2 明日盯点 */}
      {brief?.tomorrow_brief && (
        <div
          className="px-3 py-2 rounded flex items-start gap-2"
          style={{
            background: "rgba(168,85,247,0.08)",
            border: "1px dashed rgba(168,85,247,0.4)",
          }}
        >
          <Sparkles size={12} style={{ color: "var(--accent-purple)", marginTop: 2, flexShrink: 0 }} />
          <div>
            <span
              className="font-bold mr-1"
              style={{ color: "var(--accent-purple)", fontSize: "var(--font-sm)" }}
            >
              明日盯点:
            </span>
            <span style={{ color: "var(--text-primary)", fontSize: "var(--font-sm)" }}>
              {brief.tomorrow_brief}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  text,
  color,
}: {
  icon: typeof Target;
  text: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={12} style={{ color }} />
      <span className="font-bold" style={{ color, fontSize: "var(--font-sm)", letterSpacing: 0.5 }}>
        {text}
      </span>
    </div>
  );
}

function BucketCard({
  icon: Icon,
  title,
  color,
  items,
  onClick,
}: {
  icon: typeof Landmark;
  title: string;
  color: string;
  items: NewsBriefBucket[];
  onClick?: (it: NewsBriefBucket) => void;
}) {
  return (
    <div
      className="px-3 py-2 rounded"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={11} style={{ color }} />
        <span className="font-bold" style={{ color, fontSize: "var(--font-sm)" }}>
          {title}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "var(--font-xs)" }}>
          今日暂无
        </div>
      ) : (
        <div className="space-y-1">
          {items.slice(0, 2).map((it, i) => (
            <button
              key={i}
              onClick={() => onClick?.(it)}
              className="text-left w-full leading-snug hover:opacity-100"
              style={{
                color: "var(--text-secondary)",
                fontSize: "var(--font-sm)",
                opacity: 0.95,
              }}
              title="点击高亮相关新闻"
            >
              <ArrowRight size={9} style={{ display: "inline", color: "var(--text-muted)", marginRight: 4 }} />
              {it.summary}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
