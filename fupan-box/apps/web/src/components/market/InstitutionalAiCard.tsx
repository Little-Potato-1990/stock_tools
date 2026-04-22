"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, Users, Crown, Building2 } from "lucide-react";
import { api } from "@/lib/api";
import { AiCardError, AiCardFooter, AiCardLoading } from "./AiCardChrome";
import { getCacheMeta } from "./CacheMetaBadge";
import { AiActionBar } from "./AiActionBar";
import { useUIStore } from "@/stores/ui-store";

interface HolderItem {
  code: string;
  name: string | null;
  actor: string;
  change_type: string;
  shares_pct?: number | null;
}

interface EventItem {
  date: string;
  code: string;
  name: string | null;
  type: string;
  actor: string | null;
  actor_type: string | null;
  scale?: number | null;
}

interface InstitutionalBrief {
  trade_date: string;
  report_date: string | null;
  generated_at: string;
  model: string;
  headline: string;
  stance: string;
  signals: Array<{ label: string; text: string }>;
  playbook: Array<{ label: string; action: string }>;
  evidence?: string[];
  highlights?: Record<string, { adds?: HolderItem[]; cuts?: HolderItem[] }>;
  events_recent?: EventItem[];
  event_summary?: Record<string, number>;
}

const STANCE_COLOR: Record<string, string> = {
  国家队进场: "var(--accent-red)",
  险资社保增持: "var(--accent-orange)",
  公募抱团: "var(--accent-blue)",
  外资流出: "var(--accent-green)",
  资金分散: "var(--text-muted)",
};

const TYPE_LABEL: Record<string, string> = {
  national_team: "国家队",
  insurance: "险资",
  social: "社保",
  fund: "公募",
  qfii: "QFII",
};

export function InstitutionalAiCard({ hero = false }: { hero?: boolean } = {}) {
  const [data, setData] = useState<InstitutionalBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openStockDetail = useUIStore((s) => s.openStockDetail);

  const load = async (refresh = false, dateOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.getInstitutionalBrief(dateOverride, refresh);
      setData(d as unknown as InstitutionalBrief);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <AiCardLoading message="AI 正在分析主力身份动向..." />;
  if (error || !data) return <AiCardError error={error} />;

  const accent = STANCE_COLOR[data.stance] ?? "var(--accent-purple)";
  const hl = data.highlights ?? {};

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
          AI 主力身份动向
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
          报告期 {data.report_date ?? "—"} · {data.model}
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
          fontSize: hero ? 22 : "var(--font-md)",
          color: "var(--text-primary)",
          lineHeight: hero ? 1.4 : 1.5,
        }}
      >
        {data.headline}
      </div>

      {data.signals.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mb-3">
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
              <Crown size={11} style={{ color: accent, marginTop: 2 }} />
              <span style={{ fontSize: "var(--font-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                <span className="font-bold" style={{ color: accent }}>{s.label}</span>
                <span style={{ color: "var(--text-muted)" }}> · </span>
                {s.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {Object.keys(hl).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          {Object.entries(hl).map(([k, v]) => {
            const adds = v.adds ?? [];
            if (adds.length === 0) return null;
            return (
              <div
                key={k}
                style={{
                  padding: "6px 10px",
                  background: "var(--bg-card)",
                  borderRadius: 3,
                  border: "1px solid var(--border-color)",
                }}
              >
                <div className="flex items-center gap-1 mb-1">
                  <Users size={10} style={{ color: accent }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: accent }}>
                    {TYPE_LABEL[k] ?? k} 加仓 {adds.length} 股
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5" style={{ fontSize: "var(--font-xs)" }}>
                  {adds.slice(0, 5).map((a, i) => (
                    <button
                      key={i}
                      onClick={() => openStockDetail(a.code, a.name ?? a.code)}
                      className="hover:underline"
                      style={{ color: "var(--text-primary)" }}
                      title={`${a.actor} · ${a.change_type}`}
                    >
                      {a.name ?? a.code}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.events_recent && data.events_recent.length > 0 && (
        <div
          className="mb-3"
          style={{
            padding: "6px 10px",
            background: "var(--bg-card)",
            borderRadius: 3,
            border: "1px solid var(--border-color)",
            fontSize: "var(--font-xs)",
          }}
        >
          <div className="flex items-center gap-1 mb-1">
            <Building2 size={10} style={{ color: "var(--text-muted)" }} />
            <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>近期公告事件</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {data.events_recent.slice(0, 6).map((e, i) => (
              <div key={i} className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                <span style={{ color: "var(--text-muted)", width: 60 }}>{e.date.slice(5)}</span>
                <span style={{ width: 60 }}>{e.type}</span>
                <button
                  onClick={() => openStockDetail(e.code, e.name ?? e.code)}
                  className="hover:underline"
                  style={{ color: "var(--text-primary)", flex: 1, textAlign: "left" }}
                >
                  {e.name ?? e.code}
                </button>
                <span style={{ color: "var(--text-muted)" }}>{e.actor ?? ""}</span>
              </div>
            ))}
          </div>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
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

      <div className="flex items-center justify-end mb-1">
        <AiActionBar
          summary={`主力身份「${data.stance}」: ${data.headline}`}
          evidence={data.evidence}
          askPrompt={`本期主力身份动向定调为「${data.stance}」: ${data.headline}\n请进一步分析国家队/险资/社保/公募/QFII 各自的加仓主线, 并给出具体跟随策略。`}
          accent={accent}
        />
      </div>

      <AiCardFooter
        kind="institutional"
        tradeDate={data.trade_date}
        model={data.model}
        snapshot={{ headline: data.headline, stance: data.stance, evidence: data.evidence }}
        cacheMeta={getCacheMeta(data)}
        onPickDate={(iso) => load(false, iso)}
      />
    </div>
  );
}
