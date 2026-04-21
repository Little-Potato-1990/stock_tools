"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  Activity,
  Thermometer,
  Coins,
  Flame,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { AiCardError, AiCardFooter, AiCardLoading } from "./AiCardChrome";
import { StreamHeadlineControl } from "./StreamHeadlineControl";
import { AiDensitySwitch } from "./AiDensitySwitch";
import { AiActionBar } from "./AiActionBar";
import { useStreamingHeadline } from "@/hooks/useStreamingHeadline";
import { Dial } from "./dial/Dial";
import type { DialItem } from "./dial/types";

export interface TrendPoint {
  date: string;
  lu: number;
  ld?: number;
  broken_rate: number;
  yesterday_lu_up_rate: number;
  max_height?: number;
}

interface SentimentBrief {
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

interface SignalSection {
  kind: "strong" | "weak" | "reverse";
  label: string;
  color: string;
  icon: LucideIcon;
  text: string;
  source: string;
}

/** signals 数组 prompt 固定为: 涨停 / 炸板 / 赚钱效应 三个维度.
 *  按位置分配 强势(涨停) / 反向(炸板) / 弱势(赚钱效应), 由文字内容反映正负. */
function classifySignals(
  signals: Array<{ label: string; text: string }>,
): SignalSection[] {
  const out: SignalSection[] = [];
  const get = (i: number) => signals[i];
  const s0 = get(0);
  const s1 = get(1);
  const s2 = get(2);
  if (s0) {
    out.push({
      kind: "strong",
      label: "强信号",
      color: "var(--accent-red)",
      icon: TrendingUp,
      text: s0.text,
      source: s0.label,
    });
  }
  if (s1) {
    out.push({
      kind: "reverse",
      label: "反向信号",
      color: "var(--accent-yellow)",
      icon: AlertTriangle,
      text: s1.text,
      source: s1.label,
    });
  }
  if (s2) {
    out.push({
      kind: "weak",
      label: "弱信号",
      color: "var(--accent-green)",
      icon: TrendingDown,
      text: s2.text,
      source: s2.label,
    });
  }
  return out;
}

function SignalLine({ s }: { s: SignalSection }) {
  const Icon = s.icon;
  return (
    <div
      className="flex items-start gap-2"
      style={{
        padding: "6px 10px",
        borderLeft: `2px solid ${s.color}`,
        background: "var(--bg-card)",
        borderRadius: "0 3px 3px 0",
      }}
    >
      <span
        className="flex items-center gap-1 flex-shrink-0"
        style={{ marginTop: 1 }}
      >
        <Icon size={11} style={{ color: s.color }} />
        <span
          className="font-bold"
          style={{ fontSize: 10, color: s.color, letterSpacing: "0.04em" }}
        >
          {s.label}
        </span>
      </span>
      <span
        style={{
          fontSize: "var(--font-xs)",
          color: "var(--text-secondary)",
          lineHeight: 1.5,
        }}
      >
        <span style={{ color: "var(--text-muted)" }}>{s.source} · </span>
        {s.text}
      </span>
    </div>
  );
}

interface Props {
  /** hero 模式: 字号更大, padding 更宽, 用作页面顶部主视觉 */
  hero?: boolean;
  /** 用户在 L1 仪表盘上点击 "查看证据" 时回调, 把 anchor 抛给页面去高亮 L2. */
  onEvidenceClick?: (anchor: DialAnchor) => void;
  /** brief 加载完成后, 把 trend_5d 抛给页面共享 (避免 L2 重复请求). */
  onTrendLoad?: (trend: TrendPoint[]) => void;
}

export function SentimentAiCard({ hero = false, onEvidenceClick, onTrendLoad }: Props = {}) {
  const [data, setData] = useState<SentimentBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aiStyle = useUIStore((s) => s.aiStyle);
  const stream = useStreamingHeadline("sentiment", data?.trade_date, data?.model);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.getSentimentBrief(undefined, refresh);
      const brief = d as unknown as SentimentBrief;
      setData(brief);
      if (onTrendLoad) onTrendLoad(brief.trend_5d ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // onTrendLoad 是 setState 引用, useEffect 依赖固定为 [] 避免重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <AiCardLoading message="AI 正在判断当前情绪阶段..." />;
  }

  if (error || !data) {
    return <AiCardError error={error} />;
  }

  const dials = deriveDials(data);
  const signalSections = classifySignals(data.signals);

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
        <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
          {data.trade_date} · {data.model}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <AiDensitySwitch accent={PHASE_COLOR[data.phase]} />
          <StreamHeadlineControl
            isStreaming={stream.isStreaming}
            hasOverride={stream.hasOverride}
            onStart={stream.start}
            onReset={stream.reset}
            size={hero ? 13 : 11}
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
        {stream.hasOverride ? (
          <>
            {stream.text || "…"}
            {stream.isStreaming && (
              <span
                className="ml-0.5 inline-block animate-pulse"
                style={{ color: PHASE_COLOR[data.phase] }}
              >
                ▍
              </span>
            )}
          </>
        ) : (
          data.judgment
        )}
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

      {/* === L1.B: 三段读数 (强 / 反向 / 弱), concise & detailed 都展示 === */}
      {aiStyle !== "headline" && signalSections.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5 mb-3">
          {signalSections.map((s) => (
            <SignalLine key={s.kind} s={s} />
          ))}
        </div>
      )}

      {/* === L1.C: 短线对策 (仅 detailed 模式展示, 给愿意深读的用户) === */}
      {aiStyle === "detailed" && data.playbook.length > 0 && (
        <div
          className="mb-3"
          style={{
            padding: "8px 10px",
            background: "var(--bg-card)",
            borderRadius: 4,
            border: "1px solid var(--border-color)",
          }}
        >
          <div
            className="flex items-center gap-1 mb-2"
            style={{ fontSize: 10, color: "var(--accent-purple)", fontWeight: 700 }}
          >
            <Sparkles size={10} />
            短线对策
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {data.playbook.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5"
                style={{ fontSize: "var(--font-xs)" }}
              >
                <span
                  className="font-bold flex-shrink-0"
                  style={{ color: "var(--text-muted)", width: 36 }}
                >
                  {s.label}
                </span>
                <span style={{ color: "var(--text-primary)" }}>{s.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === L1.D: 5 日趋势小条 (仅 detailed) === */}
      {aiStyle === "detailed" && data.trend_5d.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <Activity size={10} style={{ color: "var(--text-muted)" }} />
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>近 5 日:</span>
          <div className="flex items-end gap-2 flex-1">
            {data.trend_5d.map((p) => (
              <div
                key={p.date}
                className="flex flex-col items-center"
                title={`${p.date} 涨停 ${p.lu} / 炸板率 ${(p.broken_rate * 100).toFixed(0)}%`}
              >
                <span
                  className="font-bold tabular-nums"
                  style={{
                    fontSize: 10,
                    color: p.yesterday_lu_up_rate >= 0.5 ? "var(--accent-red)" : "var(--accent-green)",
                  }}
                >
                  {p.lu}
                </span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
                  {p.date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === Footer: action bar + feedback === */}
      <div className="flex items-center justify-end mb-1">
        <AiActionBar
          summary={`大盘情绪「${data.phase_label}」: ${data.judgment}`}
          evidence={data.evidence}
          askPrompt={`当前情绪阶段判断为「${data.phase_label}」: ${data.judgment}\n请基于近 5 日数据进一步推演明日可能的走势, 并给出更具体的应对建议。`}
          accent={PHASE_COLOR[data.phase]}
        />
      </div>

      <AiCardFooter
        kind="sentiment"
        tradeDate={data.trade_date}
        model={data.model}
        snapshot={{ headline: data.judgment, phase: data.phase, evidence: data.evidence }}
      />
    </div>
  );
}
