"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import {
  TrendingUp,
  TrendingDown,
  Zap,
  Target,
  ArrowDownToLine,
  type LucideIcon,
} from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import type {
  ThemeBriefData,
  ThemeDialAnchor,
  ThemeItem,
} from "./ThemeAiCard";

interface Props {
  brief: ThemeBriefData | null;
  highlight: ThemeDialAnchor | null;
}

interface CardSpec {
  anchor: ThemeDialAnchor;
  title: string;
  icon: LucideIcon;
  color: string;
  emptyText: string;
}

const CARDS: CardSpec[] = [
  {
    anchor: "leading",
    title: "主线龙头题材",
    icon: TrendingUp,
    color: "var(--accent-red)",
    emptyText: "今日无明显主线",
  },
  {
    anchor: "emerging",
    title: "新晋热点题材",
    icon: Zap,
    color: "var(--accent-orange)",
    emptyText: "今日无新晋热点",
  },
  {
    anchor: "fading",
    title: "退潮中题材",
    icon: TrendingDown,
    color: "var(--accent-green)",
    emptyText: "今日无明显退潮",
  },
  {
    anchor: "next_bet",
    title: "明日下注题材",
    icon: Target,
    color: "var(--accent-purple)",
    emptyText: "AI 未给出下注题材",
  },
];

/** 5 日涨停柱状 mini chart */
function LuTrendBars({ trend, color }: { trend: number[] | undefined; color: string }) {
  if (!trend || trend.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: 28, fontSize: 9, color: "var(--text-muted)" }}
      >
        暂无 5 日涨停数据
      </div>
    );
  }
  const max = Math.max(...trend, 1);
  return (
    <div className="flex items-end gap-1" style={{ height: 28 }}>
      {trend.map((v, i) => {
        const isLast = i === trend.length - 1;
        const h = Math.max(2, (v / max) * 24);
        return (
          <div key={i} className="flex flex-col items-center gap-0.5" style={{ flex: 1 }}>
            <span
              style={{
                fontSize: 9,
                color: isLast ? color : "var(--text-muted)",
                fontWeight: isLast ? 700 : 400,
                lineHeight: 1,
              }}
            >
              {v}
            </span>
            <div
              style={{
                width: "100%",
                height: h,
                background: isLast ? color : "var(--text-muted)",
                opacity: isLast ? 1 : 0.4,
                borderRadius: "2px 2px 0 0",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function pickItem(brief: ThemeBriefData, anchor: ThemeDialAnchor): ThemeItem | null {
  if (anchor === "leading") return brief.leading[0] ?? null;
  if (anchor === "emerging") return brief.emerging[0] ?? null;
  if (anchor === "fading") return brief.fading[0] ?? null;
  return null;
}

function EvidenceCard({
  spec,
  brief,
  highlight,
}: {
  spec: CardSpec;
  brief: ThemeBriefData;
  highlight: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const Icon = spec.icon;
  const openThemeDetail = useUIStore((s) => s.openThemeDetail);

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
    border: highlight ? `2px solid ${spec.color}` : "1px solid var(--border-color)",
    borderRadius: 4,
    transition: "all 200ms ease",
    boxShadow: highlight ? `0 0 0 4px ${spec.color}22` : "none",
    position: "relative",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    minHeight: 110,
  };

  // next_bet 没有 ThemeItem, 单独处理
  if (spec.anchor === "next_bet") {
    const bet = brief.next_bet;
    const has = !!bet?.name;
    return (
      <button
        ref={(el) => {
          ref.current = el;
        }}
        onClick={() => has && openThemeDetail(bet.name)}
        disabled={!has}
        style={{ ...baseStyle, cursor: has ? "pointer" : "not-allowed" }}
      >
        {highlight && (
          <span
            className="absolute flex items-center gap-1"
            style={{
              top: -10,
              left: 8,
              padding: "1px 6px",
              background: spec.color,
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
            <Icon size={11} style={{ color: spec.color }} />
            {spec.title}
          </span>
        </div>
        {has ? (
          <>
            <div
              className="font-bold mb-1"
              style={{
                fontSize: 14,
                color: spec.color,
                lineHeight: 1.3,
              }}
            >
              {bet.name}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--text-secondary)",
                lineHeight: 1.45,
              }}
            >
              {bet.reason}
            </div>
          </>
        ) : (
          <div
            style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12 }}
          >
            {spec.emptyText}
          </div>
        )}
      </button>
    );
  }

  const item = pickItem(brief, spec.anchor);
  if (!item) {
    return (
      <div
        ref={(el) => {
          ref.current = el;
        }}
        style={baseStyle}
      >
        {highlight && (
          <span
            className="absolute flex items-center gap-1"
            style={{
              top: -10,
              left: 8,
              padding: "1px 6px",
              background: spec.color,
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
            <Icon size={11} style={{ color: spec.color }} />
            {spec.title}
          </span>
        </div>
        <div
          style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12 }}
        >
          {spec.emptyText}
        </div>
      </div>
    );
  }

  return (
    <button
      ref={(el) => {
        ref.current = el;
      }}
      onClick={() => openThemeDetail(item.name)}
      style={baseStyle}
    >
      {highlight && (
        <span
          className="absolute flex items-center gap-1"
          style={{
            top: -10,
            left: 8,
            padding: "1px 6px",
            background: spec.color,
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
          <Icon size={11} style={{ color: spec.color }} />
          {spec.title}
        </span>
        {item.today_rank ? (
          <span
            className="inline-flex items-center justify-center font-bold"
            style={{
              padding: "0 5px",
              borderRadius: 2,
              background: spec.color,
              color: "#fff",
              fontSize: 9,
              lineHeight: "14px",
            }}
          >
            #{item.today_rank}
          </span>
        ) : null}
      </div>
      <div
        className="font-bold mb-1 truncate"
        style={{ fontSize: 14, color: spec.color, lineHeight: 1.3 }}
        title={item.name}
      >
        {item.name}
      </div>
      <div
        className="line-clamp-2"
        style={{
          fontSize: 10,
          color: "var(--text-secondary)",
          lineHeight: 1.4,
          marginBottom: 4,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {item.ai_note}
      </div>
      <LuTrendBars trend={item.lu_trend} color={spec.color} />
    </button>
  );
}

export function ThemeEvidenceGrid({ brief, highlight }: Props) {
  if (!brief) {
    return (
      <div
        className="px-3 py-2"
        style={{
          fontSize: "var(--font-xs)",
          color: "var(--text-muted)",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        关键证据加载中…
      </div>
    );
  }

  return (
    <div
      className="px-3 py-3"
      style={{
        background: "var(--bg-tertiary)",
        borderBottom: "1px solid var(--border-color)",
      }}
    >
      <div
        className="flex items-center gap-2 mb-2"
        style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em" }}
      >
        <span style={{ fontWeight: 700 }}>AI 圈定的 4 个题材</span>
        <span>· 主线/新晋/退潮/明日下注 — 与上方仪表盘联动, 点击卡片打开题材详情</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {CARDS.map((spec) => (
          <EvidenceCard
            key={spec.anchor}
            spec={spec}
            brief={brief}
            highlight={highlight === spec.anchor}
          />
        ))}
      </div>
    </div>
  );
}
