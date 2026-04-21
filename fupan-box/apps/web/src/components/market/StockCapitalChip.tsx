"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Globe2, Crown } from "lucide-react";
import { api } from "@/lib/api";

interface CapitalCtx {
  main?: {
    today_main_inflow?: number | null;
    net_5d?: number | null;
  } | null;
  north?: {
    chg_amount_today?: number | null;
    chg_amount_5d?: number | null;
    hold_pct?: number | null;
  } | null;
  strength_score?: number;
}

interface InstitutionalCtx {
  has_national_team?: boolean;
  has_social?: boolean;
  has_insurance?: boolean;
  has_qfii?: boolean;
  holders?: Array<{ canonical?: string | null; type?: string | null }>;
  event_summary?: Record<string, number>;
}

interface StockContext {
  code: string;
  name?: string;
  capital?: CapitalCtx | null;
  institutional?: InstitutionalCtx | null;
}

const TAG_COLOR: Record<string, string> = {
  national_team: "var(--accent-red)",
  social: "var(--accent-orange)",
  insurance: "var(--accent-blue)",
  qfii: "var(--accent-purple)",
};

function fmtYi(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return (v / 1e8).toFixed(digits) + "亿";
}

function chipColor(v: number | null | undefined): string {
  if (v == null) return "var(--text-muted)";
  if (v > 0) return "var(--accent-red)";
  if (v < 0) return "var(--accent-green)";
  return "var(--text-muted)";
}

interface Props {
  code: string;
  /** compact: 一行紧凑展示, full: 多行详细 */
  variant?: "compact" | "full";
  /** 已有 context 时直接渲染, 否则自动 fetch */
  context?: StockContext | null;
  /** 静默失败 (不显示加载/错误状态), 用于次要场景 */
  silent?: boolean;
}

export function StockCapitalChip({ code, variant = "compact", context, silent = false }: Props) {
  const [data, setData] = useState<StockContext | null>(context ?? null);
  const [loading, setLoading] = useState(!context);

  useEffect(() => {
    if (context) {
      setData(context);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.getStockContext(code)
      .then((d) => { if (!cancelled) setData(d as unknown as StockContext); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, context]);

  if (loading && !silent) {
    return (
      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
        <span className="inline-block animate-pulse">···</span>
      </span>
    );
  }
  if (!data) return null;

  const cap = data.capital ?? null;
  const inst = data.institutional ?? null;

  const mainToday = cap?.main?.today_main_inflow ?? null;
  const main5d = cap?.main?.net_5d ?? null;
  const north5d = cap?.north?.chg_amount_5d ?? null;

  const tags: Array<{ key: string; label: string; color: string }> = [];
  if (inst?.has_national_team) tags.push({ key: "national_team", label: "国家队", color: TAG_COLOR.national_team });
  if (inst?.has_social) tags.push({ key: "social", label: "社保", color: TAG_COLOR.social });
  if (inst?.has_insurance) tags.push({ key: "insurance", label: "险资", color: TAG_COLOR.insurance });
  if (inst?.has_qfii) tags.push({ key: "qfii", label: "QFII", color: TAG_COLOR.qfii });

  if (variant === "compact") {
    if (!mainToday && !north5d && tags.length === 0) return null;
    return (
      <span
        className="inline-flex items-center gap-1.5"
        style={{ fontSize: 10 }}
      >
        {mainToday != null && (
          <span style={{ color: chipColor(mainToday) }} title={`今日主力净流入 ${fmtYi(mainToday)}`}>
            {mainToday >= 0 ? <TrendingUp size={9} style={{ display: "inline" }} /> : <TrendingDown size={9} style={{ display: "inline" }} />}
            <span className="ml-0.5 tabular-nums font-bold">主{fmtYi(mainToday)}</span>
          </span>
        )}
        {north5d != null && north5d !== 0 && (
          <span style={{ color: chipColor(north5d) }} title={`北向 5 日净增持 ${fmtYi(north5d)}`}>
            <Globe2 size={9} style={{ display: "inline" }} />
            <span className="ml-0.5 tabular-nums font-bold">北{fmtYi(north5d)}</span>
          </span>
        )}
        {tags.map((t) => (
          <span
            key={t.key}
            className="px-1 font-bold"
            style={{
              background: t.color,
              color: "#fff",
              borderRadius: 2,
              fontSize: 9,
              lineHeight: 1.4,
            }}
            title="季报披露的核心持有人"
          >
            <Crown size={8} style={{ display: "inline", marginRight: 1 }} />
            {t.label}
          </span>
        ))}
      </span>
    );
  }

  // full variant —— 多行展示
  return (
    <div
      className="px-2 py-1.5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 3,
        fontSize: "var(--font-xs)",
        lineHeight: 1.6,
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span style={{ color: "var(--text-muted)" }}>主力今日:</span>
        <span className="font-bold tabular-nums" style={{ color: chipColor(mainToday) }}>
          {fmtYi(mainToday)}
        </span>
        <span style={{ color: "var(--text-muted)" }}>5日累计:</span>
        <span className="font-bold tabular-nums" style={{ color: chipColor(main5d) }}>
          {fmtYi(main5d)}
        </span>
        <span style={{ color: "var(--text-muted)" }}>北向5日:</span>
        <span className="font-bold tabular-nums" style={{ color: chipColor(north5d) }}>
          {fmtYi(north5d)}
        </span>
        {cap?.strength_score != null && (
          <span style={{ color: "var(--text-muted)" }}>
            强度:
            <span
              className="ml-1 font-bold"
              style={{ color: cap.strength_score >= 1 ? "var(--accent-red)" : cap.strength_score <= -1 ? "var(--accent-green)" : "var(--text-secondary)" }}
            >
              {cap.strength_score >= 0 ? "+" : ""}{cap.strength_score}
            </span>
          </span>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex items-center gap-1 mt-1">
          <span style={{ color: "var(--text-muted)" }}>主力身份:</span>
          {tags.map((t) => (
            <span
              key={t.key}
              className="px-1 font-bold"
              style={{
                background: t.color,
                color: "#fff",
                borderRadius: 2,
                fontSize: 9,
                lineHeight: 1.4,
              }}
            >
              <Crown size={8} style={{ display: "inline", marginRight: 1 }} />
              {t.label}
            </span>
          ))}
        </div>
      )}
      {inst?.event_summary && Object.values(inst.event_summary).some((v) => v > 0) && (
        <div className="flex items-center gap-2 mt-1" style={{ color: "var(--text-muted)" }}>
          <span>近30天公告:</span>
          {Object.entries(inst.event_summary)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => (
              <span key={k}>
                {k} <span className="font-bold" style={{ color: "var(--text-secondary)" }}>{v}</span>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
