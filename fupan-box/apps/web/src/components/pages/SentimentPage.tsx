"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Table } from "lucide-react";
import { OverviewBar } from "@/components/market/OverviewBar";
import { SentimentChart } from "@/components/market/SentimentChart";
import { SentimentAiCard } from "@/components/market/SentimentAiCard";

function CollapseSection({
  icon,
  title,
  desc,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid var(--border-color)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 transition-colors"
        style={{
          background: open ? "var(--bg-tertiary)" : "var(--bg-secondary)",
          textAlign: "left",
        }}
      >
        {open ? (
          <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
        ) : (
          <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />
        )}
        <span style={{ color: "var(--accent-blue)" }}>{icon}</span>
        <span
          className="font-bold"
          style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
        >
          {title}
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{desc}</span>
      </button>
      {open && children}
    </div>
  );
}

export function SentimentPage() {
  return (
    <div>
      {/* AI 占主视觉 */}
      <SentimentAiCard hero />

      {/* P1: 情绪周期主图直接展示 (5 张高级图由组件内部折叠), 不再多套一层 Collapse */}
      <SentimentChart />

      {/* 原始热力表折叠 — 用户核对 AI 结论时再展开 */}
      <CollapseSection
        icon={<Table size={13} />}
        title="60 日情绪热力表"
        desc="原始指标矩阵 · 主板/创业板分级 · 用于核对 AI 结论"
      >
        <OverviewBar />
      </CollapseSection>
    </div>
  );
}
