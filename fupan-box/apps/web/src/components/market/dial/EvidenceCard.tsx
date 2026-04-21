"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { ArrowDownToLine } from "lucide-react";
import { Sparkline } from "./Sparkline";
import type { CardSpec } from "./types";

/**
 * 颜色策略 — 真按 spec.positive 翻转 low 分支.
 *
 * - positive="high": 高于均值 = 积极 → 红色 (上涨色); 低于 → 绿色.
 * - positive="low" : 高于均值 = 消极 → 绿色 (下跌色); 低于 → 红色.
 *
 * (历史代码两个分支返回同一逻辑, low 字段是死代码; 本次按用户选择 real_reverse 修正.)
 */
function colorOf<P>(
  spec: CardSpec<string, P>,
  today: number,
  vals: number[],
): string {
  if (vals.length < 2) return "var(--text-muted)";
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const above = today > avg;
  if (spec.positive === "high") {
    return above ? "var(--accent-red)" : "var(--accent-green)";
  }
  return above ? "var(--accent-green)" : "var(--accent-red)";
}

interface EvidenceCardProps<P> {
  spec: CardSpec<string, P>;
  trendData: P[];
  highlight: boolean;
}

/**
 * 通用证据卡 — sparkline + 数值 + 一句话描述, 支持 L1 dial 高亮联动.
 * 替代 LhbEvidenceGrid / LadderEvidenceGrid / SentimentEvidenceGrid 中
 * 几乎一致的本地实现.
 */
export function EvidenceCard<P>({
  spec,
  trendData,
  highlight,
}: EvidenceCardProps<P>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const Icon = spec.icon;
  const vals = trendData.map(spec.pick);
  const today = vals.length > 0 ? vals[vals.length - 1] : 0;
  const color = colorOf(spec, today, vals);
  const lastPoint = trendData[trendData.length - 1];
  const description =
    trendData.length > 0
      ? spec.describe(vals, today, lastPoint)
      : "数据加载中…";

  useEffect(() => {
    if (highlight && ref.current) {
      ref.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [highlight]);

  const baseStyle: CSSProperties = {
    padding: "10px 12px",
    background: "var(--bg-card)",
    border: highlight
      ? `2px solid ${color}`
      : "1px solid var(--border-color)",
    borderRadius: 4,
    transition: "all 200ms ease",
    boxShadow: highlight ? `0 0 0 4px ${color}22` : "none",
    position: "relative",
  };

  return (
    <div ref={ref} style={baseStyle}>
      {highlight && (
        <span
          className="absolute flex items-center gap-1"
          style={{
            top: -10,
            left: 8,
            padding: "1px 6px",
            background: color,
            color: "#fff",
            fontSize: 9,
            fontWeight: 700,
            borderRadius: 3,
            letterSpacing: "0.04em",
          }}
        >
          <ArrowDownToLine size={9} />
          AI 关注
        </span>
      )}
      <div className="flex items-center justify-between mb-1">
        <span
          className="flex items-center gap-1"
          style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}
        >
          <Icon size={11} style={{ color }} />
          {spec.title}
        </span>
        <span
          className="font-bold tabular-nums"
          style={{ fontSize: 14, color, lineHeight: 1 }}
        >
          {spec.fmt(today)}
        </span>
      </div>
      <Sparkline values={vals} color={color} highlight={highlight} />
      <div
        style={{
          marginTop: 4,
          fontSize: 10,
          color: "var(--text-secondary)",
          lineHeight: 1.4,
        }}
      >
        {description}
      </div>
    </div>
  );
}
