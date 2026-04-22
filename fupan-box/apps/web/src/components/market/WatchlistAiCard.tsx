"use client";

import { useEffect, useState, useCallback } from "react";
import { Sparkles, RotateCcw, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { AiCardFooter } from "./AiCardChrome";
import { EvidenceBadge } from "./EvidenceBadge";
import { getCacheMeta } from "./CacheMetaBadge";
import { useSkillStore } from "@/stores/skill-store";
import { useUIStore } from "@/stores/ui-store";
import { SkillChip } from "@/components/skill/SkillChip";
import { SkillTagText } from "@/components/skill/SkillTagText";

type WatchlistBrief = Awaited<ReturnType<typeof api.getWatchlistBrief>>;

const TAG_COLOR: Record<string, string> = {
  涨停: "var(--accent-red)",
  大涨: "var(--accent-orange)",
  主线: "var(--accent-purple)",
  大跌: "var(--accent-green)",
  跌停: "var(--accent-green)",
  退潮: "var(--text-muted)",
};

interface Props {
  itemCount: number;
}

export function WatchlistAiCard({ itemCount }: Props) {
  const [data, setData] = useState<WatchlistBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const skillRef = useSkillStore((s) => s.activeRef);
  const setActiveModule = useUIStore((s) => s.setActiveModule);

  const load = useCallback(async (refresh = false, dateOverride?: string) => {
    if (itemCount === 0) {
      setData(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const d = await api.getWatchlistBrief(dateOverride, refresh, skillRef ?? undefined);
      setData(d);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "AI 生成失败");
    } finally {
      setLoading(false);
    }
  }, [itemCount, skillRef]);

  useEffect(() => {
    load(false);
  }, [load]);

  if (itemCount === 0) return null;

  const avg = data?.summary?.avg_change_pct;

  return (
    <div
      className="rounded-xl px-4 py-3 mb-3"
      style={{
        background: "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.05))",
        border: "1px solid rgba(139,92,246,0.25)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} style={{ color: "var(--accent-purple)" }} />
        <span className="font-semibold" style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}>
          自选股 AI 一句话定调
        </span>
        <button
          onClick={() => load(true)}
          className="ml-auto p-1 rounded hover:opacity-70"
          title="重新生成"
          style={{ color: "var(--accent-purple)" }}
          disabled={loading}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
        </button>
        {data?.model && (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{data.model}</span>
        )}
        <SkillChip compact onManageClick={() => setActiveModule("skills")} />
      </div>

      {err && <p className="text-xs" style={{ color: "var(--accent-red)" }}>{err}</p>}

      {!data && !err && loading && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>AI 生成中...</p>
      )}

      {data && (
        <>
          <p className="font-medium mb-1" style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}>
            <SkillTagText text={data.headline} />
          </p>

          {data.evidence?.length > 0 && (
            <div className="mb-2">
              <EvidenceBadge evidence={data.evidence} />
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
            <div style={{ color: "var(--text-muted)" }}>
              共 {data.summary.total} 只 / 命中 {data.summary.found}
            </div>
            <div style={{ color: "var(--accent-red)" }}>
              涨停 {data.summary.limit_up} / 跌停 {data.summary.limit_down}
            </div>
            <div style={{ color: avg != null && avg >= 0 ? "var(--accent-red)" : "var(--accent-green)" }}>
              均 {avg != null ? `${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%` : "—"}
            </div>
          </div>

          {data.per_stock?.length > 0 && (
            <div className="space-y-1 mb-2">
              {data.per_stock.slice(0, 8).map((s) => (
                <div key={s.code} className="flex items-center gap-2 text-xs">
                  <span className="font-medium" style={{ color: "var(--accent-orange)", minWidth: 56 }}>{s.code}</span>
                  <span
                    className="px-1.5 rounded"
                    style={{
                      background: "var(--bg-tertiary)",
                      color: TAG_COLOR[s.tag] || "var(--text-secondary)",
                      fontSize: 10,
                    }}
                  >
                    {s.tag}
                  </span>
                  <span className="flex-1 truncate" style={{ color: "var(--text-secondary)" }}>{s.note}</span>
                </div>
              ))}
              {data.per_stock.length > 8 && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  ...还有 {data.per_stock.length - 8} 只
                </p>
              )}
            </div>
          )}

          {data.focus?.code && (
            <p className="text-xs mb-2 px-2 py-1.5 rounded" style={{ background: "rgba(139,92,246,0.10)", color: "var(--text-primary)" }}>
              <span style={{ color: "var(--accent-purple)", fontWeight: 600 }}>明日关注 {data.focus.code}: </span>
              {data.focus.reason}
            </p>
          )}

          <AiCardFooter
            kind="today"
            tradeDate={data.trade_date}
            model={data.model}
            snapshot={{ headline: data.headline, focus: data.focus, evidence: data.evidence }}
            cacheMeta={getCacheMeta(data)}
            onPickDate={(iso) => load(false, iso)}
          />
        </>
      )}
    </div>
  );
}
