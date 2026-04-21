"use client";

import { useUIStore, type AiDensity } from "@/stores/ui-store";

const ITEMS: { id: AiDensity; label: string; tip: string }[] = [
  { id: "headline", label: "极简", tip: "只看 AI 一句话结论" },
  { id: "concise", label: "标准", tip: "结论 + 关键支持证据" },
  { id: "detailed", label: "完整", tip: "结论 + 全部数据 + 趋势图" },
];

interface Props {
  /** 用于高亮当前模式的强调色, 可不传, 默认紫色 */
  accent?: string;
  /** 紧凑模式 (字号更小, 用在卡片头部) */
  compact?: boolean;
}

/**
 * AI 卡片信息密度切换器 — 一组 3 段按钮 (极简 / 标准 / 完整).
 * 全局共享 ui-store 里的 aiStyle, 改一次, 所有用了它的卡片同步.
 */
export function AiDensitySwitch({ accent, compact = true }: Props = {}) {
  const aiStyle = useUIStore((s) => s.aiStyle);
  const setAiStyle = useUIStore((s) => s.setAiStyle);
  const acc = accent ?? "var(--accent-purple)";

  return (
    <span
      style={{
        display: "inline-flex",
        borderRadius: 3,
        overflow: "hidden",
        border: "1px solid var(--border-color)",
      }}
    >
      {ITEMS.map((it) => {
        const active = aiStyle === it.id;
        return (
          <button
            key={it.id}
            onClick={() => setAiStyle(it.id)}
            title={it.tip}
            style={{
              padding: compact ? "1px 6px" : "3px 10px",
              fontSize: compact ? 9 : 11,
              fontWeight: 700,
              background: active ? acc : "transparent",
              color: active ? "#fff" : "var(--text-muted)",
              cursor: "pointer",
              borderRight: "1px solid var(--border-color)",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </span>
  );
}
