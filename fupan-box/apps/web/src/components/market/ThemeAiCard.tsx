"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Zap,
  Target,
  MessageSquare,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { AiCardError, AiCardFooter, AiCardLoading } from "./AiCardChrome";
import { getCacheMeta } from "./CacheMetaBadge";
import { EvidenceBadge } from "./EvidenceBadge";
import { StreamHeadlineControl } from "./StreamHeadlineControl";
import { useStreamingHeadline } from "@/hooks/useStreamingHeadline";
import { Dial } from "./dial/Dial";
import type { DialItem } from "./dial/types";

export interface ThemeNewsRef {
  id: number;
  title: string;
  sentiment?: "bullish" | "neutral" | "bearish" | null;
  importance?: number;
  pub_time?: string | null;
}

export interface ThemeItem {
  name: string;
  ai_note: string;
  today_rank?: number | null;
  lu_trend?: number[];
  chg_today?: number;
  news_ids?: number[];      // LLM 引用的 news_pool id
  news_refs?: ThemeNewsRef[]; // 后端拼好的相关新闻 (该题材命中)
}

export interface ThemeBriefNewsPoolItem {
  id: number;
  title: string;
  sentiment?: "bullish" | "neutral" | "bearish" | null;
  importance?: number;
  pub_time?: string | null;
}

export interface ThemeBriefData {
  trade_date: string;
  generated_at: string;
  model: string;
  headline: string;
  leading: ThemeItem[];
  fading: ThemeItem[];
  emerging: ThemeItem[];
  next_bet: { name: string; reason: string };
  evidence?: string[];
  news_pool?: ThemeBriefNewsPoolItem[];
}

export type ThemeDialAnchor = "leading" | "emerging" | "fading" | "next_bet";

function deriveThemeDials(d: ThemeBriefData): DialItem<ThemeDialAnchor>[] {
  const leadCount = d.leading.length;
  const emCount = d.emerging.length;
  const fadeCount = d.fading.length;

  const leadName = d.leading[0]?.name ?? "无";
  const emName = d.emerging[0]?.name ?? "无";
  const fadeName = d.fading[0]?.name ?? "无";

  // 主线强度 (越多越强)
  const leadColor =
    leadCount >= 2 ? "var(--accent-red)" : leadCount === 1 ? "var(--accent-orange)" : "var(--accent-green)";
  const leadCaption = leadCount > 0 ? `龙头: ${leadName}` : "无主线在位, 杂题材";

  // 新晋活跃度
  const emColor =
    emCount >= 2 ? "var(--accent-orange)" : emCount === 1 ? "var(--accent-yellow)" : "var(--text-muted)";
  const emCaption = emCount > 0 ? `首发: ${emName}` : "无新热点冒头";

  // 退潮风险 (越多越偏退潮 — 反向, 红色警告)
  const fadeColor =
    fadeCount >= 2 ? "var(--accent-red)" : fadeCount === 1 ? "var(--accent-orange)" : "var(--accent-green)";
  const fadeCaption = fadeCount > 0 ? `退潮: ${fadeName}` : "无退潮迹象";

  // 下注信心
  const hasBet = !!d.next_bet?.name;
  const betColor = hasBet ? "var(--accent-purple)" : "var(--text-muted)";
  const betCaption = hasBet ? `${d.next_bet.name}` : "未给下注建议";

  return [
    {
      anchor: "leading",
      icon: TrendingUp,
      label: "主线强度",
      value: `${leadCount}`,
      unit: "条",
      trend: "flat",
      caption: leadCaption,
      color: leadColor,
    },
    {
      anchor: "emerging",
      icon: Zap,
      label: "新晋活跃",
      value: `${emCount}`,
      unit: "条",
      trend: "flat",
      caption: emCaption,
      color: emColor,
    },
    {
      anchor: "fading",
      icon: TrendingDown,
      label: "退潮风险",
      value: `${fadeCount}`,
      unit: "条",
      trend: "flat",
      caption: fadeCaption,
      color: fadeColor,
    },
    {
      anchor: "next_bet",
      icon: Target,
      label: "明日下注",
      value: hasBet ? "✓" : "—",
      trend: "flat",
      caption: betCaption,
      color: betColor,
    },
  ];
}

function MiniTrend({ trend }: { trend: number[] }) {
  if (!trend || trend.length === 0) return null;
  const max = Math.max(...trend, 1);
  return (
    <span className="inline-flex items-end gap-[2px]" style={{ height: 10 }}>
      {trend.map((v, i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: Math.max(2, (v / max) * 10),
            background:
              i === trend.length - 1
                ? "var(--accent-red)"
                : "var(--text-muted)",
            opacity: i === trend.length - 1 ? 1 : 0.6,
          }}
        />
      ))}
    </span>
  );
}

function ThemeRow({
  item,
  color,
  onAsk,
}: {
  item: ThemeItem;
  color: string;
  onAsk: () => void;
}) {
  return (
    <div
      className="flex items-start gap-1.5 mb-1"
      style={{ fontSize: "var(--font-xs)" }}
    >
      <span
        className="font-bold flex-shrink-0 inline-flex items-center gap-1"
        style={{ color, minWidth: 76 }}
      >
        {item.today_rank ? (
          <span
            className="inline-flex items-center justify-center font-bold"
            style={{
              width: 14,
              height: 14,
              borderRadius: 2,
              background: color,
              color: "#fff",
              fontSize: 9,
            }}
          >
            {item.today_rank}
          </span>
        ) : null}
        <span className="truncate" style={{ maxWidth: 60 }} title={item.name}>
          {item.name}
        </span>
      </span>
      <span
        style={{ color: "var(--text-secondary)", lineHeight: 1.45 }}
        className="flex-1"
      >
        {item.ai_note}
      </span>
      {item.lu_trend && item.lu_trend.length > 0 && (
        <span
          className="flex-shrink-0"
          title={`近 5 日涨停: ${item.lu_trend.join("/")}`}
        >
          <MiniTrend trend={item.lu_trend} />
        </span>
      )}
      <button
        onClick={onAsk}
        className="flex-shrink-0 transition-opacity hover:opacity-80"
        title="问 AI"
        style={{
          padding: "0px 4px",
          background: "var(--accent-purple)",
          color: "#fff",
          borderRadius: 2,
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          fontSize: 9,
          fontWeight: 700,
          height: 14,
        }}
      >
        <MessageSquare size={8} />
        问AI
      </button>
    </div>
  );
}

interface Props {
  hero?: boolean;
  onEvidenceClick?: (anchor: ThemeDialAnchor) => void;
  onBriefLoad?: (brief: ThemeBriefData) => void;
}

export function ThemeAiCard({ hero = false, onEvidenceClick, onBriefLoad }: Props = {}) {
  const [data, setData] = useState<ThemeBriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const askAI = useUIStore((s) => s.askAI);
  const openThemeDetail = useUIStore((s) => s.openThemeDetail);
  const aiStyle = useUIStore((s) => s.aiStyle);
  const stream = useStreamingHeadline("theme", data?.trade_date, data?.model);

  const load = async (refresh = false, dateOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.getThemeBrief(dateOverride, refresh);
      const brief = d as unknown as ThemeBriefData;
      setData(brief);
      if (onBriefLoad) onBriefLoad(brief);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <AiCardLoading message="AI 正在拆解题材轮动..." />;
  if (error || !data) return <AiCardError error={error} />;

  const askAboutTheme = (theme: string, note: string) => {
    askAI(
      `题材「${theme}」当前 AI 判断为: ${note}\n请深入分析这个题材的核心逻辑、关键龙头股、以及未来 1-3 天可能的走向。`
    );
  };

  const dials = deriveThemeDials(data);

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
        <Sparkles
          size={hero ? 16 : 14}
          style={{ color: "var(--accent-purple)" }}
        />
        <span
          className="font-bold"
          style={{
            color: "var(--accent-purple)",
            fontSize: hero ? "var(--font-md)" : "var(--font-sm)",
            letterSpacing: 1,
          }}
        >
          AI 题材轮动拆解
        </span>
        <span
          style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}
        >
          {data.trade_date} · {data.model}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <EvidenceBadge evidence={data.evidence} />
          <StreamHeadlineControl
            isStreaming={stream.isStreaming}
            hasOverride={stream.hasOverride}
            onStart={stream.start}
            onReset={stream.reset}
            size={hero ? 13 : 11}
          />
          <button
            onClick={() => load(true)}
            className="p-1 transition-opacity hover:opacity-70"
            title="重新生成 (走完整 brief 缓存)"
            style={{ color: "var(--text-muted)" }}
          >
            <RefreshCw size={hero ? 13 : 11} />
          </button>
        </div>
      </div>

      <div
        className={hero ? "font-bold mb-3" : "font-bold mb-2"}
        style={{
          fontSize: hero ? 26 : "var(--font-md)",
          color: "var(--text-primary)",
          lineHeight: hero ? 1.4 : 1.5,
          letterSpacing: hero ? 0.3 : 0,
        }}
      >
        {stream.hasOverride ? (
          <>
            {stream.text || "…"}
            {stream.isStreaming && (
              <span
                className="ml-0.5 inline-block animate-pulse"
                style={{ color: "var(--accent-purple)" }}
              >
                ▍
              </span>
            )}
          </>
        ) : (
          data.headline
        )}
      </div>

      {/* L1.A: 4 仪表盘 */}
      {aiStyle !== "headline" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {dials.map((d) => (
            <Dial
              key={d.anchor}
              d={d}
              hero={hero}
              onClick={() => onEvidenceClick?.(d.anchor)}
            />
          ))}
        </div>
      )}

      {/* L1.B: 主线 / 退潮 / 新晋 三段 (concise & detailed 都展示) */}
      {aiStyle !== "headline" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
          {data.leading.length > 0 && (
            <div
              style={{
                padding: "6px 10px",
                background: "var(--bg-card)",
                borderRadius: 4,
                border: "1px solid var(--border-color)",
                borderLeft: "3px solid var(--accent-red)",
              }}
            >
              <div
                className="flex items-center gap-1 mb-1.5"
                style={{
                  fontSize: 10,
                  color: "var(--accent-red)",
                  fontWeight: 700,
                }}
              >
                <TrendingUp size={10} />
                主线在位
              </div>
              {data.leading.map((it) => (
                <ThemeRow
                  key={`l-${it.name}`}
                  item={it}
                  color="var(--accent-red)"
                  onAsk={() => askAboutTheme(it.name, it.ai_note)}
                />
              ))}
            </div>
          )}

          {data.fading.length > 0 && (
            <div
              style={{
                padding: "6px 10px",
                background: "var(--bg-card)",
                borderRadius: 4,
                border: "1px solid var(--border-color)",
                borderLeft: "3px solid var(--accent-green)",
              }}
            >
              <div
                className="flex items-center gap-1 mb-1.5"
                style={{
                  fontSize: 10,
                  color: "var(--accent-green)",
                  fontWeight: 700,
                }}
              >
                <TrendingDown size={10} />
                退潮中
              </div>
              {data.fading.map((it) => (
                <ThemeRow
                  key={`f-${it.name}`}
                  item={it}
                  color="var(--accent-green)"
                  onAsk={() => askAboutTheme(it.name, it.ai_note)}
                />
              ))}
            </div>
          )}

          {data.emerging.length > 0 && (
            <div
              style={{
                padding: "6px 10px",
                background: "var(--bg-card)",
                borderRadius: 4,
                border: "1px solid var(--border-color)",
                borderLeft: "3px solid var(--accent-orange)",
              }}
            >
              <div
                className="flex items-center gap-1 mb-1.5"
                style={{
                  fontSize: 10,
                  color: "var(--accent-orange)",
                  fontWeight: 700,
                }}
              >
                <Zap size={10} />
                新晋热点
              </div>
              {data.emerging.map((it) => (
                <ThemeRow
                  key={`e-${it.name}`}
                  item={it}
                  color="var(--accent-orange)"
                  onAsk={() => askAboutTheme(it.name, it.ai_note)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* L1.C: 明日重点 (始终展示, 是 AI 决策结论) */}
      {data.next_bet?.name && (
        <div
          className="flex items-center gap-2"
          style={{
            padding: "6px 10px",
            background:
              "linear-gradient(90deg, rgba(168,85,247,0.12), rgba(168,85,247,0.04))",
            border: "1px solid rgba(168,85,247,0.3)",
            borderRadius: 4,
            fontSize: "var(--font-xs)",
          }}
        >
          <Target size={11} style={{ color: "var(--accent-purple)" }} />
          <span
            className="font-bold"
            style={{ color: "var(--accent-purple)" }}
          >
            明日重点
          </span>
          <button
            onClick={() => openThemeDetail(data.next_bet.name)}
            className="font-bold transition-opacity hover:opacity-80"
            style={{
              color: "var(--text-primary)",
              padding: "0 6px",
              background: "var(--bg-card)",
              borderRadius: 2,
            }}
          >
            {data.next_bet.name}
          </button>
          <span
            style={{ color: "var(--text-secondary)", lineHeight: 1.45 }}
            className="flex-1"
          >
            {data.next_bet.reason}
          </span>
          <button
            onClick={() =>
              askAI(
                `今日 AI 复盘判断: ${data.headline}\n建议明日重点关注题材: ${data.next_bet.name} —— ${data.next_bet.reason}\n请进一步给出可执行的盘前/盘中/盘后操作清单。`
              )
            }
            className="transition-opacity hover:opacity-80 flex-shrink-0"
            title="问 AI"
            style={{
              padding: "3px 8px",
              background: "var(--accent-purple)",
              color: "#fff",
              borderRadius: 3,
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            <MessageSquare size={10} />
            追问 AI
          </button>
        </div>
      )}
      <AiCardFooter
        kind="theme"
        tradeDate={data.trade_date}
        model={data.model}
        snapshot={{ headline: data.headline, evidence: data.evidence, next_bet: data.next_bet }}
        cacheMeta={getCacheMeta(data)}
        onPickDate={(iso) => load(false, iso)}
      />
    </div>
  );
}
