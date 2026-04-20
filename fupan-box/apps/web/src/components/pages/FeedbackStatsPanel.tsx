"use client";

import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, MessageSquare, Activity } from "lucide-react";
import { api } from "@/lib/api";

type FeedbackStats = Awaited<ReturnType<typeof api.getFeedbackStats>>;

const KIND_LABEL: Record<string, string> = {
  today: "今日定调",
  sentiment: "情绪",
  theme: "题材",
  ladder: "连板",
  lhb: "龙虎榜",
};

const KIND_ORDER = ["today", "sentiment", "theme", "ladder", "lhb"];

interface Props {
  days: number;
}

export function FeedbackStatsPanel({ days }: Props) {
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const j = await api.getFeedbackStats(days);
        if (!cancelled) setStats(j);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (loading) {
    return (
      <div
        className="px-3 py-6 text-center"
        style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
      >
        加载用户反馈中...
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div
        className="px-3 py-6 text-center"
        style={{ color: "var(--accent-red)", fontSize: "var(--font-sm)" }}
      >
        反馈数据暂不可用 {error ? `(${error})` : ""}
      </div>
    );
  }

  const overall = stats.overall;
  const overallTotal = overall.total ?? 0;

  if (overallTotal === 0) {
    return (
      <div
        className="px-3 py-8 text-center"
        style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
      >
        最近 {days} 天内还没有用户反馈 — 在任意 AI 卡片底部点 👍 / 👎 即可写入。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-3 px-3 py-3"
        style={{
          background:
            "linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(239,68,68,0.05) 100%)",
          border: "1px solid rgba(34,197,94,0.25)",
          borderRadius: 6,
        }}
      >
        <OverallCell
          label="总反馈"
          value={overallTotal}
          color="var(--text-primary)"
          icon={<MessageSquare size={11} />}
        />
        <OverallCell
          label="👍 占比"
          value={
            overall.up_rate == null
              ? "—"
              : `${(overall.up_rate * 100).toFixed(0)}%`
          }
          color={
            overall.up_rate != null && overall.up_rate >= 0.7
              ? "var(--accent-green)"
              : overall.up_rate != null && overall.up_rate >= 0.5
              ? "var(--accent-orange)"
              : "var(--accent-red)"
          }
          icon={<ThumbsUp size={11} />}
        />
        <OverallCell
          label="👎 数"
          value={overall.down ?? 0}
          color="var(--accent-red)"
          icon={<ThumbsDown size={11} />}
        />
        <OverallCell
          label="证据正确率"
          value={
            overall.evidence_correct_rate == null
              ? "—"
              : `${(overall.evidence_correct_rate * 100).toFixed(0)}%`
          }
          color={
            overall.evidence_correct_rate != null &&
            overall.evidence_correct_rate >= 0.6
              ? "var(--accent-green)"
              : "var(--accent-orange)"
          }
          icon={<Activity size={11} />}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {KIND_ORDER.map((k) => {
          const v = stats.by_kind[k];
          const upRate = v?.up_rate;
          return (
            <div
              key={k}
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: 4,
                padding: "8px 10px",
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className="font-bold"
                  style={{
                    fontSize: 11,
                    color: "var(--text-primary)",
                  }}
                >
                  {KIND_LABEL[k]}
                </span>
                <span
                  className="tabular-nums"
                  style={{ fontSize: 9, color: "var(--text-muted)" }}
                >
                  {v?.total ?? 0} 条
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="font-bold tabular-nums"
                  style={{
                    fontSize: 22,
                    color:
                      upRate == null
                        ? "var(--text-muted)"
                        : upRate >= 0.7
                        ? "var(--accent-green)"
                        : upRate >= 0.5
                        ? "var(--accent-orange)"
                        : "var(--accent-red)",
                  }}
                >
                  {upRate == null ? "—" : `${(upRate * 100).toFixed(0)}%`}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  👍 占比
                </span>
              </div>
              <div
                className="mt-1.5 flex items-center gap-1.5"
                style={{ fontSize: 10, color: "var(--text-muted)" }}
              >
                <ThumbsUp size={10} style={{ color: "var(--accent-green)" }} />
                {v?.up ?? 0}
                <ThumbsDown size={10} style={{ color: "var(--accent-red)" }} />
                {v?.down ?? 0}
                {v?.evidence_correct_rate != null && (
                  <>
                    <span style={{ color: "var(--text-muted)" }}>·</span>
                    证据正确 {(v.evidence_correct_rate * 100).toFixed(0)}%
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: 4,
        }}
      >
        <div
          className="px-3 py-2 font-bold"
          style={{
            fontSize: "var(--font-sm)",
            color: "var(--text-primary)",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          最近 {Math.min(stats.recent.length, 60)} 条反馈
        </div>
        <div className="divide-y" style={{ borderColor: "var(--border-color)" }}>
          {stats.recent.length === 0 && (
            <div
              className="px-3 py-4 text-center"
              style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}
            >
              暂无明细
            </div>
          )}
          {stats.recent.map((r, i) => (
            <div
              key={i}
              className="px-3 py-2 flex items-start gap-2"
              style={{
                fontSize: "var(--font-xs)",
                borderTop: i === 0 ? "none" : "1px solid var(--border-color)",
              }}
            >
              <span
                className="font-bold flex-shrink-0"
                style={{
                  width: 18,
                  textAlign: "center",
                  color:
                    r.rating === 1
                      ? "var(--accent-green)"
                      : "var(--accent-red)",
                }}
              >
                {r.rating === 1 ? <ThumbsUp size={11} /> : <ThumbsDown size={11} />}
              </span>
              <span
                className="font-bold flex-shrink-0"
                style={{ minWidth: 50, color: "var(--text-secondary)" }}
              >
                {KIND_LABEL[r.kind] || r.kind}
              </span>
              <span
                className="flex-shrink-0 tabular-nums"
                style={{ minWidth: 80, color: "var(--text-muted)" }}
              >
                {r.trade_date}
              </span>
              <span className="flex-1" style={{ color: "var(--text-primary)" }}>
                {r.headline || <span style={{ color: "var(--text-muted)" }}>(无快照)</span>}
              </span>
              {r.evidence_correct != null && (
                <span
                  style={{
                    padding: "1px 5px",
                    borderRadius: 2,
                    fontSize: 9,
                    background:
                      r.evidence_correct === true
                        ? "var(--accent-blue)"
                        : "var(--accent-orange)",
                    color: "#fff",
                  }}
                >
                  {r.evidence_correct ? "证据真" : "证据错"}
                </span>
              )}
              {r.reason && (
                <span
                  style={{
                    color: "var(--text-secondary)",
                    fontStyle: "italic",
                    maxWidth: 200,
                  }}
                  className="truncate"
                  title={r.reason}
                >
                  「{r.reason}」
                </span>
              )}
              <span
                className="tabular-nums flex-shrink-0"
                style={{ color: "var(--text-muted)", fontSize: 9 }}
              >
                {r.created_at.slice(5, 16).replace("T", " ")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OverallCell({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center">
      <div
        className="flex items-center gap-1 mb-1"
        style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}
      >
        {icon}
        {label}
      </div>
      <div
        className="font-bold tabular-nums"
        style={{ fontSize: 24, color }}
      >
        {value}
      </div>
    </div>
  );
}
