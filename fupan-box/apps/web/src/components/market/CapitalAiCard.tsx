"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, TrendingUp, Activity } from "lucide-react";
import { api } from "@/lib/api";
import { AiCardError, AiCardFooter, AiCardLoading } from "./AiCardChrome";
import { AiActionBar } from "./AiActionBar";
import { getCacheMeta } from "./CacheMetaBadge";

interface CapitalBrief {
  trade_date: string;
  generated_at: string;
  model: string;
  headline: string;
  stance: string;
  signals: Array<{ label: string; text: string }>;
  playbook: Array<{ label: string; action: string }>;
  evidence?: string[];
  highlights?: {
    concept_top?: Array<{ name: string; main_inflow?: number }>;
    industry_top?: Array<{ name: string; main_inflow?: number }>;
    etf_team?: { total_inflow?: number; etf_count?: number };
  };
}

const STANCE_COLOR: Record<string, string> = {
  净流入主导: "var(--accent-red)",
  净流出主导: "var(--accent-green)",
  分化: "var(--accent-yellow)",
  防御: "var(--accent-blue)",
};

export function CapitalAiCard({ hero = false }: { hero?: boolean } = {}) {
  const [data, setData] = useState<CapitalBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (refresh = false, dateOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.getCapitalBrief(dateOverride, refresh);
      setData(d as unknown as CapitalBrief);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <AiCardLoading message="AI 正在分析今日资金面..." />;
  if (error || !data) return <AiCardError error={error} />;

  const accent = STANCE_COLOR[data.stance] ?? "var(--accent-purple)";

  return (
    <div
      className={hero ? "px-6 py-5" : "px-3 py-2.5"}
      style={{
        background: hero
          ? `linear-gradient(135deg, ${accent}18 0%, var(--bg-tertiary) 60%)`
          : "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)",
        borderBottom: "1px solid var(--border-color)",
        borderLeft: hero ? `3px solid ${accent}` : undefined,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={hero ? 16 : 14} style={{ color: "var(--accent-purple)" }} />
        <span
          className="font-bold"
          style={{
            color: "var(--accent-purple)",
            fontSize: hero ? "var(--font-md)" : "var(--font-sm)",
            letterSpacing: 1,
          }}
        >
          AI 今日资金定调
        </span>
        <span
          className="font-bold"
          style={{
            padding: hero ? "2px 12px" : "1px 8px",
            background: accent,
            color: "#fff",
            borderRadius: 3,
            fontSize: hero ? "var(--font-sm)" : "var(--font-xs)",
          }}
        >
          {data.stance}
        </span>
        <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
          {data.trade_date} · {data.model}
        </span>
        <button
          onClick={() => load(true)}
          className="ml-auto p-1 transition-opacity hover:opacity-70"
          title="重新生成"
          style={{ color: "var(--text-muted)" }}
        >
          <RefreshCw size={hero ? 13 : 11} />
        </button>
      </div>

      <div
        className={hero ? "font-bold mb-3" : "font-bold mb-2"}
        style={{
          fontSize: hero ? 24 : "var(--font-md)",
          color: "var(--text-primary)",
          lineHeight: hero ? 1.4 : 1.5,
        }}
      >
        {data.headline}
      </div>

      {data.signals.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5 mb-3">
          {data.signals.map((s, i) => (
            <div
              key={i}
              className="flex items-start gap-2"
              style={{
                padding: "6px 10px",
                borderLeft: `2px solid ${accent}`,
                background: "var(--bg-card)",
                borderRadius: "0 3px 3px 0",
              }}
            >
              <Activity size={11} style={{ color: accent, marginTop: 2 }} />
              <span style={{ fontSize: "var(--font-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                <span className="font-bold" style={{ color: accent }}>{s.label}</span>
                <span style={{ color: "var(--text-muted)" }}> · </span>
                {s.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.playbook.length > 0 && (
        <div
          className="mb-3"
          style={{
            padding: "8px 10px",
            background: "var(--bg-card)",
            borderRadius: 4,
            border: "1px solid var(--border-color)",
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {data.playbook.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5" style={{ fontSize: "var(--font-xs)" }}>
                <span className="font-bold flex-shrink-0" style={{ color: "var(--text-muted)", width: 36 }}>
                  {s.label}
                </span>
                <span style={{ color: "var(--text-primary)" }}>{s.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.highlights && (data.highlights.concept_top?.length || data.highlights.industry_top?.length) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          {data.highlights.concept_top && data.highlights.concept_top.length > 0 && (
            <div style={{ fontSize: "var(--font-xs)" }}>
              <span style={{ color: "var(--text-muted)" }}>概念主流: </span>
              {data.highlights.concept_top.slice(0, 3).map((c, i) => (
                <span key={i} style={{ marginRight: 8 }}>
                  <TrendingUp size={9} style={{ display: "inline", color: "var(--accent-red)" }} />{" "}
                  {c.name} {((c.main_inflow ?? 0) / 1e8).toFixed(1)}亿
                </span>
              ))}
            </div>
          )}
          {data.highlights.industry_top && data.highlights.industry_top.length > 0 && (
            <div style={{ fontSize: "var(--font-xs)" }}>
              <span style={{ color: "var(--text-muted)" }}>行业主流: </span>
              {data.highlights.industry_top.slice(0, 3).map((c, i) => (
                <span key={i} style={{ marginRight: 8 }}>
                  <TrendingUp size={9} style={{ display: "inline", color: "var(--accent-red)" }} />{" "}
                  {c.name} {((c.main_inflow ?? 0) / 1e8).toFixed(1)}亿
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end mb-1">
        <AiActionBar
          summary={`今日资金面「${data.stance}」: ${data.headline}`}
          evidence={data.evidence}
          askPrompt={`今日资金定调为「${data.stance}」: ${data.headline}\n请基于主力/北向/国家队三类资金的最新数据, 进一步推演明日方向并给出具体仓位建议。`}
          accent={accent}
        />
      </div>

      <AiCardFooter
        kind="capital"
        tradeDate={data.trade_date}
        model={data.model}
        snapshot={{ headline: data.headline, stance: data.stance, evidence: data.evidence }}
        cacheMeta={getCacheMeta(data)}
        onPickDate={(iso) => load(false, iso)}
      />
    </div>
  );
}
