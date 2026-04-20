"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, MessageSquare, Building2 } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { EvidenceBadge } from "./EvidenceBadge";

interface KeyOffice {
  name: string;
  is_inst: boolean;
  tag: string;
  net_buy: number;
  note: string;
}

interface KeyStock {
  code: string;
  name: string;
  net_amount: number;
  tag: string;
  note: string;
}

interface LhbBrief {
  trade_date: string;
  generated_at: string;
  model: string;
  headline: string;
  structure: Array<{ label: string; text: string }>;
  key_offices: KeyOffice[];
  key_stocks: KeyStock[];
  evidence?: string[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const TAG_COLOR: Record<string, string> = {
  "知名游资": "var(--accent-orange)",
  "机构": "var(--accent-purple)",
  "一线席位": "var(--accent-red)",
  "游资接力": "var(--accent-red)",
  "游资": "var(--accent-orange)",
  "游资抢筹": "var(--accent-red)",
  "机构出货": "var(--accent-green)",
  "对手盘激烈": "var(--accent-purple)",
  "资金分歧": "var(--text-muted)",
};

function fmtAmount(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${sign}${(a / 1e4).toFixed(0)}万`;
  return `${sign}${a.toFixed(0)}`;
}

export function LhbAiCard() {
  const [data, setData] = useState<LhbBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const askAI = useUIStore((s) => s.askAI);
  const setLhbScope = useUIStore((s) => s.setLhbScope);
  const setLhbOfficeQuery = useUIStore((s) => s.setLhbOfficeQuery);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}/api/ai/lhb-brief${refresh ? "?refresh=1" : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const d = (await res.json()) as LhbBrief;
      setData(d);
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
    return (
      <div
        className="px-3 py-2 flex items-center gap-2"
        style={{
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-color)",
          fontSize: "var(--font-sm)",
          color: "var(--text-muted)",
        }}
      >
        <Sparkles size={14} style={{ color: "var(--accent-purple)" }} />
        AI 正在拆解游资动向...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="px-3 py-2"
        style={{
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-color)",
          fontSize: "var(--font-sm)",
          color: "var(--accent-red)",
        }}
      >
        AI 龙虎榜拆解暂不可用 {error ? `(${error})` : ""}
      </div>
    );
  }

  const jumpToOffice = (name: string) => {
    setLhbOfficeQuery(name);
    setLhbScope("office_history");
  };

  return (
    <div
      className="px-3 py-2.5"
      style={{
        background:
          "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)",
        borderBottom: "1px solid var(--border-color)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} style={{ color: "var(--accent-purple)" }} />
        <span
          className="font-bold"
          style={{
            color: "var(--accent-purple)",
            fontSize: "var(--font-sm)",
            letterSpacing: 1,
          }}
        >
          AI 龙虎榜拆解
        </span>
        <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
          {data.trade_date} · {data.model}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <EvidenceBadge evidence={data.evidence} />
          <button
            onClick={() => load(true)}
            className="p-1 transition-opacity hover:opacity-70"
            title="重新生成"
            style={{ color: "var(--text-muted)" }}
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      <div
        className="font-bold mb-2"
        style={{
          fontSize: "var(--font-md)",
          color: "var(--text-primary)",
          lineHeight: 1.5,
        }}
      >
        {data.headline}
      </div>

      <div
        className="grid gap-1.5 mb-2"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        {data.structure.map((it, i) => (
          <div
            key={i}
            className="flex items-start gap-1.5"
            style={{
              padding: "4px 8px",
              background: "var(--bg-card)",
              borderRadius: 3,
              fontSize: "var(--font-xs)",
            }}
          >
            <span
              className="font-bold flex-shrink-0"
              style={{
                color: "var(--accent-orange)",
                width: 30,
              }}
            >
              {it.label}
            </span>
            <span style={{ color: "var(--text-secondary)" }}>{it.text}</span>
          </div>
        ))}
      </div>

      {/* 核心席位 */}
      {data.key_offices.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {data.key_offices.map((o, i) => {
            const c = TAG_COLOR[o.tag] || (o.is_inst ? "var(--accent-purple)" : "var(--accent-orange)");
            const netColor =
              o.net_buy >= 0 ? "var(--accent-red)" : "var(--accent-green)";
            return (
              <div
                key={`o-${i}-${o.name}`}
                className="flex items-center gap-1.5"
                style={{
                  padding: "4px 8px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 3,
                  fontSize: "var(--font-xs)",
                }}
                title={o.note}
              >
                <button
                  onClick={() => jumpToOffice(o.name)}
                  className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
                >
                  <Building2 size={10} style={{ color: c }} />
                  <span className="font-bold" style={{ color: c }}>
                    {o.tag}
                  </span>
                  <span
                    className="truncate"
                    style={{ color: "var(--text-primary)", maxWidth: 180 }}
                  >
                    {o.name}
                  </span>
                  <span
                    className="font-bold tabular-nums"
                    style={{ color: netColor }}
                  >
                    {fmtAmount(o.net_buy)}
                  </span>
                  <span
                    style={{ color: "var(--text-muted)", maxWidth: 200 }}
                    className="truncate"
                  >
                    · {o.note}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 核心目标股 */}
      {data.key_stocks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.key_stocks.map((s) => {
            const c = TAG_COLOR[s.tag] || "var(--text-muted)";
            const netColor =
              s.net_amount >= 0 ? "var(--accent-red)" : "var(--accent-green)";
            return (
              <div
                key={s.code}
                className="flex items-center gap-1.5"
                style={{
                  padding: "4px 8px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 3,
                  fontSize: "var(--font-xs)",
                }}
                title={s.note}
              >
                <button
                  onClick={() => openStockDetail(s.code, s.name)}
                  className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
                >
                  <span className="font-bold" style={{ color: c }}>
                    {s.tag}
                  </span>
                  <span style={{ color: "var(--text-primary)" }}>{s.name}</span>
                  <span
                    className="font-bold tabular-nums"
                    style={{ color: netColor }}
                  >
                    {fmtAmount(s.net_amount)}
                  </span>
                  <span
                    style={{ color: "var(--text-muted)", maxWidth: 200 }}
                    className="truncate"
                  >
                    · {s.note}
                  </span>
                </button>
                <button
                  onClick={() =>
                    askAI(
                      `${s.name}(${s.code}) 今日上龙虎榜, 净 ${fmtAmount(s.net_amount)}, AI 标记「${s.tag}」: ${s.note}\n请帮我深入拆解游资席位的真实意图和后续操作策略。`,
                      { code: s.code, name: s.name }
                    )
                  }
                  className="ml-1 transition-opacity hover:opacity-80"
                  title="问 AI"
                  style={{
                    padding: "1px 4px",
                    background: "var(--accent-purple)",
                    color: "#fff",
                    borderRadius: 2,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 2,
                    fontSize: 10,
                  }}
                >
                  <MessageSquare size={9} />
                  问AI
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
