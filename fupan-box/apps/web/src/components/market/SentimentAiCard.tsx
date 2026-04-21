"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, Activity } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { AiCardError, AiCardFooter, AiCardLoading } from "./AiCardChrome";
import { StreamHeadlineControl } from "./StreamHeadlineControl";
import { AiDensitySwitch } from "./AiDensitySwitch";
import { AiActionBar } from "./AiActionBar";
import { useStreamingHeadline } from "@/hooks/useStreamingHeadline";

interface TrendPoint {
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

interface Props {
  /** hero 模式: 字号更大, padding 更宽, 用作页面顶部主视觉 */
  hero?: boolean;
}

export function SentimentAiCard({ hero = false }: Props = {}) {
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
      setData(d as unknown as SentimentBrief);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return <AiCardLoading message="AI 正在判断当前情绪阶段..." />;
  }

  if (error || !data) {
    return <AiCardError error={error} />;
  }

  return (
    <div
      className={hero ? "px-5 py-4" : "px-3 py-2.5"}
      style={{
        background: hero
          ? `linear-gradient(135deg, ${PHASE_COLOR[data.phase]}12 0%, var(--bg-tertiary) 60%)`
          : "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)",
        borderBottom: "1px solid var(--border-color)",
        borderLeft: hero ? `3px solid ${PHASE_COLOR[data.phase]}` : undefined,
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

      <div
        className={hero ? "font-bold mb-3" : "font-bold mb-2"}
        style={{
          fontSize: hero ? 22 : "var(--font-md)",
          color: "var(--text-primary)",
          lineHeight: hero ? 1.45 : 1.5,
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

      {aiStyle !== "headline" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
          <div
            style={{
              padding: "6px 10px",
              background: "var(--bg-card)",
              borderRadius: 4,
              border: "1px solid var(--border-color)",
            }}
          >
            <div
              className="flex items-center gap-1 mb-1.5"
              style={{ fontSize: 10, color: "var(--accent-orange)", fontWeight: 700 }}
            >
              <Activity size={10} />
              关键信号
            </div>
            {data.signals.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5 mb-1"
                style={{ fontSize: "var(--font-xs)" }}
              >
                <span
                  className="font-bold flex-shrink-0"
                  style={{ color: "var(--text-muted)", width: 50 }}
                >
                  {s.label}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>{s.text}</span>
              </div>
            ))}
          </div>

          <div
            style={{
              padding: "6px 10px",
              background: "var(--bg-card)",
              borderRadius: 4,
              border: "1px solid var(--border-color)",
            }}
          >
            <div
              className="flex items-center gap-1 mb-1.5"
              style={{ fontSize: 10, color: "var(--accent-red)", fontWeight: 700 }}
            >
              <Sparkles size={10} />
              短线对策
            </div>
            {data.playbook.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5 mb-1"
                style={{ fontSize: "var(--font-xs)" }}
              >
                <span
                  className="font-bold flex-shrink-0"
                  style={{ color: "var(--text-muted)", width: 50 }}
                >
                  {s.label}
                </span>
                <span style={{ color: "var(--text-primary)" }}>{s.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {aiStyle === "detailed" && data.trend_5d.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
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
