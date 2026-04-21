"use client";

import { ChevronDown } from "lucide-react";
import { TrendArrow } from "./TrendArrow";
import { colorFromTrend } from "@/lib/format";
import type { DialItem } from "./types";

interface DialProps<TAnchor extends string> {
  d: DialItem<TAnchor>;
  hero?: boolean;
  /**
   * true 时显示彩色边框 + 阴影 (NewsAiCard 用以表示当前激活的过滤项).
   * 其它 AiCard 的 dial 默认 false (无 active 概念).
   */
  active?: boolean;
  onClick?: () => void;
  /** dial 底部的引导文案. 默认 "查看证据" (定位到 L2 证据), NewsAiCard 用 "筛选列表". */
  jumpHint?: string;
  /** 自定义 title tooltip. 默认 "{label}: {caption} — 点击{jumpHint}". */
  tooltip?: string;
}

/**
 * 通用 AI dial 按钮.
 *
 * 替代 5 个 AiCard (LhbDial / LadderDial / SentimentDial / NewsDial / ThemeDial) 中
 * 几乎一致的本地实现. NewsDial 的 active 边框逻辑通过 active prop 暴露.
 *
 * 注: ThemeDial 原本 delta 颜色固定为 d.color 而非 trend 色, 但其 deriveThemeDials
 * 永远返回 trend="flat" 且 delta=undefined, 走不到 delta 分支, 通用化无可见差异.
 */
export function Dial<TAnchor extends string>({
  d,
  hero = false,
  active = false,
  onClick,
  jumpHint = "查看证据",
  tooltip,
}: DialProps<TAnchor>) {
  const Icon = d.icon;
  return (
    <button
      onClick={onClick}
      className="flex flex-col text-left transition-colors group"
      style={{
        padding: hero ? "10px 12px" : "8px 10px",
        background: "var(--bg-card)",
        border: active
          ? `2px solid ${d.color}`
          : "1px solid var(--border-color)",
        boxShadow: active ? `0 0 0 4px ${d.color}22` : undefined,
        borderRadius: 4,
        cursor: "pointer",
      }}
      title={tooltip ?? `${d.label}: ${d.caption} — 点击${jumpHint}`}
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <span
          className="flex items-center gap-1"
          style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}
        >
          <Icon size={11} style={{ color: d.color }} />
          {d.label}
        </span>
        {d.delta && (
          <span
            className="flex items-center gap-0.5 tabular-nums"
            style={{
              fontSize: 9,
              color: colorFromTrend(d.trend),
              fontWeight: 600,
            }}
          >
            <TrendArrow trend={d.trend} />
            {d.delta}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-0.5 mb-0.5">
        <span
          className="font-bold tabular-nums"
          style={{
            fontSize: hero ? 22 : 18,
            color: d.color,
            lineHeight: 1,
          }}
        >
          {d.value}
        </span>
        {d.unit && (
          <span
            className="font-bold"
            style={{ fontSize: hero ? 12 : 11, color: d.color, opacity: 0.85 }}
          >
            {d.unit}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--text-secondary)",
          lineHeight: 1.35,
          minHeight: hero ? 26 : 22,
        }}
      >
        {d.caption}
      </div>
      <div
        className="flex items-center gap-0.5 mt-1.5 transition-opacity opacity-60 group-hover:opacity-100"
        style={{ fontSize: 9, color: d.color, fontWeight: 600 }}
      >
        {jumpHint}
        <ChevronDown size={9} />
      </div>
    </button>
  );
}
