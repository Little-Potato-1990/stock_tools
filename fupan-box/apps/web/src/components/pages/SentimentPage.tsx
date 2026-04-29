"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown, ChevronRight, Table } from "lucide-react";
import { OverviewBar } from "@/components/market/OverviewBar";
import {
  SentimentAiCard,
  type DialAnchor,
} from "@/components/market/SentimentAiCard";

const SentimentChart = dynamic(
  () => import("@/components/market/SentimentChart").then((m) => m.SentimentChart),
  {
    loading: () => (
      <div className="px-3 py-3 space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-44 rounded animate-pulse"
            style={{ background: "var(--bg-card)" }}
          />
        ))}
      </div>
    ),
  },
);

/** L1 dial 锚点 → OverviewBar 中需要高亮的指标 label.
 *  3 列拆开方便 Step E 在 OverviewBar 里渲染角标. */
const ANCHOR_TO_OVERVIEW_FIELDS: Record<DialAnchor, string[]> = {
  limit_up: ["收盘涨停", "开盘涨停"],
  making_money: ["收盘上涨率", "上日强势票上涨率"],
  max_height: ["主板最高板", "主板 - 妖股"],
  broken_rate: ["收盘跌停", "开盘跌停"],
};

/** AI 默认关注的 OverviewBar 字段 (无 highlight 时也角标这些). */
export const DEFAULT_AI_HIGHLIGHT_FIELDS = Array.from(
  new Set(Object.values(ANCHOR_TO_OVERVIEW_FIELDS).flat()),
);

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
  const [highlight, setHighlight] = useState<DialAnchor | null>(null);

  const handleNewsClick = (id: number) => {
    // 点击 news → 跳到 news 页 (用 hash route, 由 NewsPage 自行解析)
    if (typeof window !== "undefined") {
      window.location.hash = `#/news?focus=${id}`;
    }
  };

  // L1 仪表盘联动:
  // - 同一 anchor 二次点击则取消高亮 (toggle)
  // - 否则切换到新 anchor, 用于 L4 热力表角标聚焦
  const handleEvidenceClick = (anchor: DialAnchor) => {
    setHighlight((prev) => (prev === anchor ? null : anchor));
  };

  // L1 高亮 anchor → OverviewBar 需要打 "AI 关注" 角标的字段集合
  const overviewHighlightFields = highlight
    ? ANCHOR_TO_OVERVIEW_FIELDS[highlight]
    : DEFAULT_AI_HIGHLIGHT_FIELDS;

  return (
    <div>
      {/* L1: AI 主视觉 (judgment + 4 仪表盘 + 三段读数) */}
      <SentimentAiCard
        hero
        onEvidenceClick={handleEvidenceClick}
        onNewsClick={handleNewsClick}
      />

      {/* L3: 详细图表 (情绪周期主图 + 5 张折叠子图) */}
      <SentimentChart />

      {/* L4: 60 日全量热力表, 默认展开 — 用于核对 AI 结论 */}
      <CollapseSection
        icon={<Table size={13} />}
        title="60 日情绪热力表"
        desc="50+ 指标全量 · AI 关注字段已加角标 · 用于核对 AI 结论"
        defaultOpen
      >
        <OverviewBar aiHighlightFields={overviewHighlightFields} />
      </CollapseSection>
    </div>
  );
}
