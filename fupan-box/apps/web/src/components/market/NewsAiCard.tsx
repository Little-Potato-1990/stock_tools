"use client";

import {
  Sparkles,
  Star,
  Target,
  ShieldAlert,
  Briefcase,
  Landmark,
  ArrowRight,
} from "lucide-react";

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

interface TopInsightCard {
  key: string;
  title: string;
  value: string;
  sub: string;
  color: string;
  icon: typeof Target;
  onClick?: () => void;
}

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
}: Props) {
  const stats = brief?.stats ?? fallbackCounts(news);
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
  const watchHitCount = Math.max(alerts.length, watchHits || 0);
  const firstThread = threads[0];
  const firstShock = shock[0];
  const watchCodeList = Array.from(new Set(alerts.flatMap((a) => a.codes || []))).slice(0, 3);
  const watchCodeText = watchCodeList.length > 0 ? watchCodeList.join("/") : "无";
  const tomorrowShort = (brief?.tomorrow_brief || "暂无盯点").slice(0, 32);
  const topCards: TopInsightCard[] = [
    {
      key: "thread",
      title: "主线追踪",
      value: firstThread?.name || "暂无",
      sub: firstThread?.summary || "暂无主线结论",
      color: "var(--accent-purple)",
      icon: Target,
      onClick: firstThread ? () => onThreadClick?.(firstThread) : undefined,
    },
    {
      key: "risk",
      title: "风险雷达",
      value: firstShock ? "有" : "低",
      sub: firstShock?.summary || "暂无突发风险",
      color: firstShock ? "var(--accent-red)" : "var(--accent-green)",
      icon: ShieldAlert,
      onClick: firstShock ? () => onBucketClick?.("shock", firstShock) : undefined,
    },
    {
      key: "watch",
      title: "自选命中",
      value: `${watchHitCount}条`,
      sub: watchCodeText === "无" ? "无自选命中" : `命中代码: ${watchCodeText}`,
      color: watchHitCount > 0 ? "var(--accent-orange)" : "var(--text-muted)",
      icon: Star,
      onClick: () => onDialClick?.("watch"),
    },
    {
      key: "tomorrow",
      title: "明日盯点",
      value: brief?.tomorrow_brief ? "已生成" : "待生成",
      sub: brief?.tomorrow_brief || "暂无盯点",
      color: "var(--accent-blue)",
      icon: Sparkles,
    },
  ];

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

      {/* L1 高密摘要条：让 headline 下方直接给出可执行信息 */}
      {!loading && stats.total > 0 && (
        <div
          className="mb-2 flex flex-wrap items-center gap-1.5"
          style={{
            fontSize: 11,
            color: "var(--text-secondary)",
            lineHeight: 1.4,
          }}
        >
          <SummaryPill
            label="主线"
            text={firstThread?.name || "暂无"}
            color="var(--accent-purple)"
            onClick={firstThread ? () => onThreadClick?.(firstThread) : undefined}
          />
          <SummaryPill
            label="风险"
            text={firstShock ? "有" : "低"}
            color={firstShock ? "var(--accent-red)" : "var(--accent-green)"}
            onClick={firstShock ? () => onBucketClick?.("shock", firstShock) : undefined}
          />
          <SummaryPill
            label="自选"
            text={watchCodeText === "无" ? "无命中" : watchCodeText}
            color={watchHitCount > 0 ? "var(--accent-orange)" : "var(--text-muted)"}
            onClick={() => onDialClick?.("watch")}
          />
          <SummaryPill
            label="明日"
            text={tomorrowShort}
            color="var(--accent-blue)"
          />
        </div>
      )}

      {/* L1 顶部决策看板（替代原低信息量 dials） */}
      {!loading && stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {topCards.map((c) => {
            const Icon = c.icon;
            const isActive = c.key === "watch" && activeAnchor === "watch";
            return (
              <button
                key={c.key}
                onClick={c.onClick}
                disabled={!c.onClick}
                className="flex flex-col text-left"
                style={{
                  padding: hero ? "10px 12px" : "8px 10px",
                  background: "var(--bg-card)",
                  border: isActive ? `2px solid ${c.color}` : "1px solid var(--border-color)",
                  borderRadius: 4,
                  boxShadow: isActive ? `0 0 0 4px ${c.color}22` : undefined,
                  cursor: c.onClick ? "pointer" : "default",
                  opacity: c.onClick ? 1 : 0.95,
                }}
                title={c.onClick ? "点击定位下方对应内容" : undefined}
              >
                <div className="flex items-center gap-1 mb-1">
                  <Icon size={11} style={{ color: c.color }} />
                  <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>
                    {c.title}
                  </span>
                </div>
                <div
                  className="font-bold truncate"
                  style={{ fontSize: hero ? 20 : 16, color: c.color, lineHeight: 1.1 }}
                  title={c.value}
                >
                  {c.value}
                </div>
                <div
                  className="line-clamp-2"
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    color: "var(--text-secondary)",
                    lineHeight: 1.35,
                    minHeight: hero ? 26 : 24,
                  }}
                  title={c.sub}
                >
                  {c.sub}
                </div>
              </button>
            );
          })}
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

function SummaryPill({
  label,
  text,
  color,
  onClick,
}: {
  label: string;
  text: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="inline-flex items-center gap-1 rounded"
      style={{
        padding: "2px 6px",
        background: "var(--bg-card)",
        border: `1px solid ${onClick ? `${color}55` : "var(--border-color)"}`,
        color: "var(--text-secondary)",
        cursor: onClick ? "pointer" : "default",
      }}
      title={onClick ? "点击联动下方对应内容" : undefined}
    >
      <span style={{ color, fontWeight: 700 }}>{label}:</span>
      <span className="truncate" style={{ maxWidth: 180 }}>{text}</span>
    </button>
  );
}
