"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  Thermometer,
  Coins,
  Flame,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { AiCardError, AiCardFooter, AiCardLoading } from "./AiCardChrome";
import { AiActionBar } from "./AiActionBar";
import { Dial } from "./dial/Dial";
import type { DialItem } from "./dial/types";
import { SentimentEvidenceGrid } from "./SentimentEvidenceGrid";

export interface TrendPoint {
  date: string;
  lu: number;
  ld?: number;
  broken_rate: number;
  yesterday_lu_up_rate: number;
  max_height?: number;
}

export interface SentimentNewsRef {
  id: number;
  title: string;
  sentiment?: "bullish" | "neutral" | "bearish" | null;
  importance?: number;
  tags?: string[];
}

export interface SentimentBrief {
  trade_date: string;
  generated_at: string;
  model: string;
  phase: "rising" | "peak" | "diverge" | "fading" | "repair";
  phase_label: string;
  judgment: string;
  signals: Array<{ label: string; text: string }>;
  playbook: Array<{ label: string; action: string }>;
  trend_5d: TrendPoint[];
  evidence?: string[];
  news_ids?: number[];
  news_pool?: SentimentNewsRef[];
}

const PHASE_COLOR: Record<SentimentBrief["phase"], string> = {
  rising: "var(--accent-red)",
  peak: "var(--accent-orange)",
  diverge: "var(--accent-yellow)",
  fading: "var(--accent-green)",
  repair: "var(--accent-blue)",
};

const PHASE_SCORE: Record<SentimentBrief["phase"], number> = {
  rising: 80,
  peak: 90,
  diverge: 60,
  fading: 30,
  repair: 50,
};

/** L1 仪表盘指示器锚点 */
export type DialAnchor = "limit_up" | "making_money" | "max_height" | "broken_rate";

function deriveDials(data: SentimentBrief): DialItem<DialAnchor>[] {
  const series = data.trend_5d || [];
  const t = series[series.length - 1];
  const prev = series.length >= 2 ? series[series.length - 2] : null;
  const phase = data.phase;

  // 1. 情绪温度 — 基于 phase 派生 + 涨停数微调
  const baseScore = PHASE_SCORE[phase] ?? 50;
  const luBonus = t ? Math.min(Math.max((t.lu - 50) * 0.2, -10), 10) : 0;
  const score = Math.round(baseScore + luBonus);
  const tempCaption =
    score >= 80 ? "偏热, 警惕分歧" : score >= 60 ? "中性偏强" : score >= 40 ? "中性偏弱" : "偏冷, 关注修复";
  const tempColor =
    score >= 75 ? "var(--accent-red)" : score >= 50 ? "var(--accent-orange)" : "var(--accent-green)";

  // 2. 赚钱效应 — yesterday_lu_up_rate
  const earn = t ? Math.round((t.yesterday_lu_up_rate ?? 0.5) * 100) : 0;
  const earnPrev = prev ? Math.round((prev.yesterday_lu_up_rate ?? 0.5) * 100) : null;
  const earnDelta = earnPrev !== null ? earn - earnPrev : null;
  const earnCaption =
    earn >= 60 ? "强势, 跟风可参与" : earn >= 45 ? "中性, 谨慎选股" : "弱势, 跟风票不挣钱";
  const earnColor =
    earn >= 60 ? "var(--accent-red)" : earn >= 40 ? "var(--accent-orange)" : "var(--accent-green)";

  // 3. 高度结构 — max_height
  const height = t?.max_height ?? 0;
  const heightPrev = prev?.max_height ?? null;
  const heightDelta = heightPrev !== null ? height - heightPrev : null;
  const heightCaption =
    height >= 6 ? "妖股出炉, 高度突破" : height >= 4 ? "中军到位" : "高度未起, 需观察";
  const heightColor =
    height >= 6 ? "var(--accent-red)" : height >= 4 ? "var(--accent-orange)" : "var(--accent-yellow)";

  // 4. 分歧风险 — broken_rate + phase
  const broken = t?.broken_rate ?? 0;
  const brokenPct = Math.round(broken * 100);
  const brokenPrev = prev?.broken_rate ?? null;
  const brokenDelta = brokenPrev !== null ? Math.round((broken - brokenPrev) * 100) : null;
  const riskLevel =
    phase === "diverge" || broken > 0.45
      ? "高"
      : broken > 0.3 || phase === "fading"
        ? "中"
        : "低";
  const riskCaption = `炸板率 ${brokenPct}%${brokenDelta !== null ? `, 较昨日 ${brokenDelta >= 0 ? "+" : ""}${brokenDelta}pp` : ""}`;
  const riskColor =
    riskLevel === "高"
      ? "var(--accent-red)"
      : riskLevel === "中"
        ? "var(--accent-orange)"
        : "var(--accent-green)";

  return [
    {
      anchor: "limit_up",
      icon: Thermometer,
      label: "情绪温度",
      value: `${score}`,
      unit: "分",
      trend: luBonus > 1 ? "up" : luBonus < -1 ? "down" : "flat",
      delta: t ? `${data.phase_label}` : undefined,
      caption: tempCaption,
      color: tempColor,
    },
    {
      anchor: "making_money",
      icon: Coins,
      label: "赚钱效应",
      value: `${earn}`,
      unit: "%",
      trend: earnDelta !== null && earnDelta > 0 ? "up" : earnDelta !== null && earnDelta < 0 ? "down" : "flat",
      delta: earnDelta !== null ? `${earnDelta >= 0 ? "+" : ""}${earnDelta}pp` : undefined,
      caption: earnCaption,
      color: earnColor,
    },
    {
      anchor: "max_height",
      icon: Flame,
      label: "高度结构",
      value: `${height}`,
      unit: "板",
      trend: heightDelta !== null && heightDelta > 0 ? "up" : heightDelta !== null && heightDelta < 0 ? "down" : "flat",
      delta: heightDelta !== null ? `${heightDelta >= 0 ? "+" : ""}${heightDelta}板` : undefined,
      caption: heightCaption,
      color: heightColor,
    },
    {
      anchor: "broken_rate",
      icon: AlertTriangle,
      label: "分歧风险",
      value: riskLevel,
      trend: brokenDelta !== null && brokenDelta > 0 ? "up" : brokenDelta !== null && brokenDelta < 0 ? "down" : "flat",
      delta: brokenDelta !== null ? `${brokenDelta >= 0 ? "+" : ""}${brokenDelta}pp` : undefined,
      caption: riskCaption,
      color: riskColor,
    },
  ];
}

interface Props {
  /** hero 模式: 字号更大, padding 更宽, 用作页面顶部主视觉 */
  hero?: boolean;
  /** 用户在 L1 仪表盘上点击时回调, 把 anchor 抛给页面做联动高亮. */
  onEvidenceClick?: (anchor: DialAnchor) => void;
  /** 点击消息面新闻时的跳转 */
  onNewsClick?: (id: number) => void;
}

export function SentimentAiCard({ hero = false, onEvidenceClick, onNewsClick }: Props = {}) {
  const [data, setData] = useState<SentimentBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aiStyle = useUIStore((s) => s.aiStyle);

  const load = async (refresh = false, dateOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.getSentimentBrief(dateOverride, refresh);
      const brief = d as unknown as SentimentBrief;
      setData(brief);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (loading) {
    return <AiCardLoading message="AI 正在判断当前情绪阶段..." />;
  }

  if (error || !data) {
    return <AiCardError error={error} />;
  }

  const dials = deriveDials(data);
  return (
    <div
      className={hero ? "px-6 py-5" : "px-3 py-2.5"}
      style={{
        background: hero
          ? `linear-gradient(135deg, ${PHASE_COLOR[data.phase]}18 0%, var(--bg-tertiary) 60%)`
          : "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)",
        borderBottom: "1px solid var(--border-color)",
        borderLeft: hero ? `3px solid ${PHASE_COLOR[data.phase]}` : undefined,
      }}
    >
      {/* === Header: AI tag + phase pill + meta + controls === */}
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
          AI 今日情绪定调
        </span>
        <span
          className="font-bold"
          style={{
            padding: hero ? "2px 12px" : "1px 8px",
            background: PHASE_COLOR[data.phase],
            color: "#fff",
            borderRadius: 3,
            fontSize: hero ? "var(--font-sm)" : "var(--font-xs)",
          }}
        >
          {data.phase_label}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <AiActionBar
            askPrompt={`当前情绪阶段判断为「${data.phase_label}」: ${data.judgment}\n请基于近 5 日数据进一步推演明日可能的走势, 并给出更具体的应对建议。`}
            accent={PHASE_COLOR[data.phase]}
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

      {/* === 大字号 judgment headline === */}
      <div
        className={hero ? "font-bold mb-3" : "font-bold mb-2"}
        style={{
          fontSize: hero ? 26 : "var(--font-md)",
          color: "var(--text-primary)",
          lineHeight: hero ? 1.4 : 1.5,
          letterSpacing: hero ? 0.3 : 0,
        }}
      >
        {data.judgment}
      </div>

      {/* === L1.A: 4 仪表盘 (concise & detailed 模式都展示, 是 AI 结论的核心可视化) === */}
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

      {/* 消息面驱动并入 headline 主卡，避免上下重复跳转 */}
      <SentimentEvidenceGrid
        newsPool={data.news_pool}
        pickedIds={data.news_ids}
        onNewsClick={onNewsClick}
        inCard
      />

      <AiCardFooter
        kind="sentiment"
        tradeDate={data.trade_date}
        model={data.model}
        snapshot={{ headline: data.judgment, phase: data.phase, evidence: data.evidence }}
      />
    </div>
  );
}
