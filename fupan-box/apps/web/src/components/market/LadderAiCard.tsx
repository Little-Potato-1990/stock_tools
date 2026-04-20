"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { EvidenceBadge } from "./EvidenceBadge";

interface LadderBrief {
  trade_date: string;
  generated_at: string;
  model: string;
  headline: string;
  structure: Array<{ label: string; text: string }>;
  key_stocks: Array<{ code: string; name: string; board: number; tag: string; note: string }>;
  evidence?: string[];
}

const TAG_COLOR: Record<string, string> = {
  "高度龙头": "var(--accent-red)",
  "主线龙头": "var(--accent-orange)",
  "超预期": "var(--accent-purple)",
  "空间股": "var(--accent-red)",
  "梯队跟随": "var(--text-muted)",
};

export function LadderAiCard() {
  const [data, setData] = useState<LadderBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const askAI = useUIStore((s) => s.askAI);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = refresh ? "/api/ai/ladder-brief?refresh=1" : "/api/ai/ladder-brief";
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}${url}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const d = (await res.json()) as LadderBrief;
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.getLadderBrief().then(setData).catch((e) => setError(String(e))).finally(() => setLoading(false));
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
        AI 正在拆解梯队...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="px-3 py-2 flex items-center gap-2"
        style={{
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-color)",
          fontSize: "var(--font-sm)",
          color: "var(--accent-red)",
        }}
      >
        AI 拆解暂不可用 {error ? `(${error})` : ""}
      </div>
    );
  }

  return (
    <div
      className="px-3 py-2.5"
      style={{
        background: "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)",
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
          AI 梯队拆解
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
        }}
      >
        {data.headline}
      </div>

      <div
        className="grid gap-1.5 mb-2"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
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

      <div className="flex flex-wrap gap-1.5">
        {data.key_stocks.map((s) => (
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
              <span
                className="font-bold"
                style={{ color: TAG_COLOR[s.tag] || "var(--text-muted)" }}
              >
                {s.tag}
              </span>
              <span style={{ color: "var(--text-primary)" }}>{s.name}</span>
              <span
                className="font-bold tabular-nums"
                style={{
                  background: "var(--accent-red)",
                  color: "#fff",
                  padding: "1px 5px",
                  borderRadius: 2,
                  fontSize: 10,
                }}
              >
                {s.board}板
              </span>
              <span
                style={{ color: "var(--text-muted)", maxWidth: 200 }}
                className="truncate"
              >
                {s.note}
              </span>
            </button>
            <button
              onClick={() =>
                askAI(
                  `${s.name}(${s.code}) 当前 ${s.board} 板, AI 标记为「${s.tag}」: ${s.note}\n请深入拆解这只票后续的关键看点和风险点。`,
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
        ))}
      </div>
    </div>
  );
}
