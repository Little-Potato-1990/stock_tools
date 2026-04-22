"use client";

import { useEffect, useState, useCallback } from "react";
import {
  X,
  RefreshCw,
  Scale,
  TrendingUp,
  TrendingDown,
  Gavel,
  MessageSquare,
  AlertTriangle,
  Target,
} from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { api } from "@/lib/api";
import { CacheMetaBadge, getCacheMeta } from "./CacheMetaBadge";
import { ShareCardButton } from "@/components/common/ShareCardButton";

type Debate = Awaited<ReturnType<typeof api.getDebate>>;

const VERDICT_META: Record<
  Debate["judge"]["verdict"],
  { color: string; icon: typeof TrendingUp }
> = {
  看多: { color: "var(--accent-red)", icon: TrendingUp },
  看空: { color: "var(--accent-green)", icon: TrendingDown },
  分歧: { color: "var(--accent-orange)", icon: Scale },
  观望: { color: "var(--text-muted)", icon: AlertTriangle },
};

export function DebateModal() {
  const target = useUIStore((s) => s.debateTopic);
  const close = useUIStore((s) => s.closeDebate);
  const askAI = useUIStore((s) => s.askAI);

  const [data, setData] = useState<Debate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      if (!target) return;
      setLoading(true);
      setError(null);
      try {
        const d = await api.getDebate(target.type, target.key, undefined, refresh);
        setData(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [target],
  );

  useEffect(() => {
    if (!target) {
      setData(null);
      return;
    }
    load();
  }, [target, load]);

  if (!target) return null;

  const handleAsk = () => {
    if (!data) return;
    const bullText = data.bull.reasons.map((r) => `[${r.label}] ${r.text}`).join("\n");
    const bearText = data.bear.reasons.map((r) => `[${r.label}] ${r.text}`).join("\n");
    const prompt = [
      `针对「${data.topic_label}」的多空辩论 (AI 裁判判: ${data.judge.verdict}, ${data.judge.summary}):`,
      "",
      `多头观点 (置信度 ${data.bull.confidence}):`,
      data.bull.headline,
      bullText,
      `多头触发条件: ${data.bull.trigger}`,
      "",
      `空头观点 (置信度 ${data.bear.confidence}):`,
      data.bear.headline,
      bearText,
      `空头触发条件: ${data.bear.trigger}`,
      "",
      `关键变量: ${data.judge.key_variable}`,
      `下一步: ${data.judge.next_step}`,
      "",
      "请你站在第三方角度: (1) 哪一方的论据更扎实? 哪条最薄弱? (2) 我作为短线散户应该如何执行? 给出明日盘前/盘中/盘后的具体动作清单。",
    ].join("\n");
    askAI(prompt);
    close();
  };

  const verdict = data?.judge.verdict;
  const verdictMeta = verdict ? VERDICT_META[verdict] : null;
  const VerdictIcon = verdictMeta?.icon;

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.55)" }}
        onClick={close}
      />
      <div
        className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 overflow-hidden"
        style={{
          width: 560,
          maxHeight: "88vh",
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: 6,
          boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{
            background: "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Scale size={15} style={{ color: "var(--accent-purple)" }} />
            <span
              className="font-bold"
              style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
            >
              AI 多空辩论
            </span>
            <span
              className="px-1.5 py-0.5 rounded font-bold"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                fontSize: 11,
              }}
            >
              {target.label || data?.topic_label || (target.type === "market" ? "今日大盘" : target.key)}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="p-1 rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
              title="重启辩论"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={close}
              className="p-1 rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: "calc(88vh - 102px)" }}>
          {loading && !data ? (
            <div className="px-4 py-12 text-center" style={{ color: "var(--text-muted)" }}>
              <RefreshCw
                size={22}
                className="animate-spin mx-auto mb-3"
                style={{ color: "var(--accent-purple)" }}
              />
              <div
                style={{
                  fontSize: "var(--font-md)",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                }}
              >
                多头/空头/裁判 三方 AI 分析中…
              </div>
              <div className="mt-1.5" style={{ fontSize: 10 }}>
                首次约 30-60 秒（3 次 LLM 调用），后续 30 分钟内秒回
              </div>
            </div>
          ) : error ? (
            <div className="px-4 py-8 text-center">
              <div style={{ color: "var(--accent-red)", fontSize: "var(--font-sm)" }}>{error}</div>
              <button
                onClick={() => load(true)}
                className="mt-3 px-3 py-1.5 rounded font-bold"
                style={{
                  background: "var(--accent-purple)",
                  color: "#fff",
                  fontSize: "var(--font-xs)",
                }}
              >
                重试
              </button>
            </div>
          ) : data ? (
            <div className="p-3 space-y-3">
              {verdictMeta && VerdictIcon && (
                <div
                  className="px-3 py-2.5 flex items-center gap-3"
                  style={{
                    background: "var(--bg-secondary)",
                    border: `1px solid ${verdictMeta.color}66`,
                    borderRadius: 4,
                  }}
                >
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded font-bold"
                    style={{
                      background: verdictMeta.color,
                      color: "#fff",
                      fontSize: 13,
                      flexShrink: 0,
                    }}
                  >
                    <Gavel size={12} />
                    裁判:{verdict}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      style={{
                        fontSize: "var(--font-sm)",
                        color: "var(--text-primary)",
                        lineHeight: 1.5,
                      }}
                    >
                      {data.judge.summary}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div
                      className="font-bold tabular-nums"
                      style={{ fontSize: 18, color: verdictMeta.color }}
                    >
                      {data.judge.win_margin}
                    </div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)" }}>领先分</div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <SideCard side="bull" data={data.bull} />
                <SideCard side="bear" data={data.bear} />
              </div>

              <div
                className="px-3 py-2.5 space-y-1.5"
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 4,
                }}
              >
                <div className="flex items-center gap-1.5">
                  <Target size={11} style={{ color: "var(--accent-orange)" }} />
                  <span
                    className="font-bold"
                    style={{ fontSize: "var(--font-sm)", color: "var(--text-primary)" }}
                  >
                    关键变量
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "var(--font-xs)",
                    color: "var(--text-secondary)",
                    lineHeight: 1.6,
                  }}
                >
                  {data.judge.key_variable}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <ChevronRightDot />
                  <span
                    className="font-bold"
                    style={{ fontSize: "var(--font-xs)", color: "var(--accent-blue)" }}
                  >
                    下一步:
                  </span>
                  <span
                    style={{ fontSize: "var(--font-xs)", color: "var(--text-secondary)" }}
                  >
                    {data.judge.next_step}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div
          className="flex items-center justify-between px-3 py-2"
          style={{
            background: "var(--bg-secondary)",
            borderTop: "1px solid var(--border-color)",
          }}
        >
          <div className="flex items-center gap-2" style={{ fontSize: 10, color: "var(--text-muted)" }}>
            <span>
              {data?.model && `模型: ${data.model}`}
              {data?.trade_date && ` · ${data.trade_date}`}
            </span>
            {getCacheMeta(data) && (
              <CacheMetaBadge meta={getCacheMeta(data)} />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {data && (
              <ShareCardButton
                title={data.topic_label || target.label || target.key || ""}
                subtitle={`AI 多空辩论 · ${data.trade_date} · ${data.model}`}
                verdict={`裁判: ${data.judge.verdict} (${data.judge.win_margin}分)`}
                verdictColor={
                  data.judge.verdict === "看多"
                    ? "#ef4444"
                    : data.judge.verdict === "看空"
                      ? "#22c55e"
                      : data.judge.verdict === "分歧"
                        ? "#f59e0b"
                        : "#6b7280"
                }
                headline={data.judge.summary}
                sections={[
                  { label: `多头 (置信度 ${data.bull.confidence})`, text: data.bull.headline },
                  { label: `空头 (置信度 ${data.bear.confidence})`, text: data.bear.headline },
                  { label: "关键变量", text: data.judge.key_variable },
                  { label: "下一步", text: data.judge.next_step },
                ]}
                variant="inline"
                buttonLabel="生成分享卡"
              />
            )}
            <button
              onClick={close}
              className="px-2.5 py-1 rounded"
              style={{
                color: "var(--text-secondary)",
                fontSize: "var(--font-xs)",
                border: "1px solid var(--border-color)",
              }}
            >
              关闭
            </button>
            <button
              onClick={handleAsk}
              disabled={!data}
              className="flex items-center gap-1 px-2.5 py-1 rounded font-bold"
              style={{
                background: "var(--accent-purple)",
                color: "#fff",
                fontSize: "var(--font-xs)",
                opacity: data ? 1 : 0.5,
              }}
            >
              <MessageSquare size={11} />
              带辩论结果追问 AI
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function SideCard({
  side,
  data,
}: {
  side: "bull" | "bear";
  data: Debate["bull"];
}) {
  const isBull = side === "bull";
  const color = isBull ? "var(--accent-red)" : "var(--accent-green)";
  const Icon = isBull ? TrendingUp : TrendingDown;
  const label = isBull ? "多头" : "空头";
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${color}55`,
        borderRadius: 4,
        padding: "8px 10px",
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Icon size={12} style={{ color }} />
          <span className="font-bold" style={{ fontSize: "var(--font-sm)", color }}>
            {label}观点
          </span>
        </div>
        <span
          className="px-1.5 py-0.5 rounded font-bold tabular-nums"
          style={{
            background: `${color}22`,
            color,
            fontSize: 10,
          }}
        >
          置信 {data.confidence}
        </span>
      </div>
      <div
        className="font-bold mb-2"
        style={{
          fontSize: "var(--font-sm)",
          color: "var(--text-primary)",
          lineHeight: 1.4,
        }}
      >
        {data.headline}
      </div>
      <div className="space-y-1 mb-2">
        {data.reasons.slice(0, 4).map((r, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span
              className="flex-shrink-0 px-1.5 py-0.5 rounded font-bold tabular-nums"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                fontSize: 9,
                lineHeight: 1.3,
              }}
            >
              {r.label}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
              }}
            >
              {r.text}
            </span>
          </div>
        ))}
      </div>
      {data.trigger && (
        <div
          className="mt-2 px-1.5 py-1 flex items-start gap-1"
          style={{
            background: `${color}11`,
            borderLeft: `2px solid ${color}`,
            borderRadius: 2,
          }}
        >
          <Target size={9} className="mt-0.5 flex-shrink-0" style={{ color }} />
          <span
            style={{
              fontSize: 10,
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            <span style={{ color, fontWeight: 700 }}>触发: </span>
            {data.trigger}
          </span>
        </div>
      )}
    </div>
  );
}

function ChevronRightDot() {
  return (
    <span
      style={{
        width: 4,
        height: 4,
        borderRadius: "50%",
        background: "var(--accent-blue)",
        display: "inline-block",
      }}
    />
  );
}
