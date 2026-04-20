"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  AlertTriangle,
  History,
  ChevronRight,
  Flame,
  Zap,
  X,
  Scale,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import type {
  AiBrief,
  KeyMetric,
  Leader,
  MainLine,
  PlanAvoid,
  PlanFirstBoard,
  PlanPromotion,
  PlanReseal,
  SimilarDay,
  Trend,
  RiskLevel,
  AiGrade,
  AnnotationLevel,
} from "@/types/ai-brief";

const REGIME_COLOR: Record<string, string> = {
  consensus: "var(--accent-red)",
  climax: "var(--accent-orange)",
  diverge: "var(--accent-yellow)",
  repair: "var(--accent-blue)",
};

const RISK_COLOR: Record<RiskLevel, string> = {
  low: "var(--accent-green)",
  medium: "var(--accent-orange)",
  high: "var(--accent-red)",
};

const RISK_LABEL: Record<RiskLevel, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

const GRADE_COLOR: Record<AiGrade, string> = {
  S: "var(--accent-red)",
  A: "var(--accent-orange)",
  B: "var(--accent-yellow)",
  C: "var(--text-muted)",
};

const GRADE_LABEL: Record<AiGrade, string> = {
  S: "罕见龙头",
  A: "典型龙头",
  B: "标准龙头",
  C: "偏弱",
};

const GRADE_DESC: Record<AiGrade, string> = {
  S: "罕见龙头 — 高度+空间+人气三要素齐备, 主线核心位置",
  A: "典型龙头 — 题材主升, 高度领先, 资金共识强",
  B: "标准龙头 — 跟随主线, 中规中矩, 缺少超预期",
  C: "偏弱 — 题材边缘 / 高位炸板风险大 / 量能不济",
};

const ANNO_COLOR: Record<AnnotationLevel, string> = {
  info: "var(--accent-blue)",
  positive: "var(--accent-red)",
  warning: "var(--accent-orange)",
  negative: "var(--accent-green)",
};

function TrendIcon({ trend, size = 12 }: { trend: Trend; size?: number }) {
  if (trend === "up") return <TrendingUp size={size} style={{ color: "var(--accent-red)" }} />;
  if (trend === "down") return <TrendingDown size={size} style={{ color: "var(--accent-green)" }} />;
  return <Minus size={size} style={{ color: "var(--text-muted)" }} />;
}

function AiTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 font-bold"
      style={{
        padding: "2px 6px",
        borderRadius: 3,
        background: "rgba(139,92,246,0.16)",
        color: "var(--accent-purple)",
        border: "1px solid rgba(139,92,246,0.32)",
        fontSize: 10,
        letterSpacing: "0.04em",
      }}
    >
      <Sparkles size={9} />
      {children}
    </span>
  );
}

function SectionHeader({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {icon}
      <h2 className="font-bold" style={{ fontSize: "var(--font-lg)", color: "var(--text-primary)" }}>
        {title}
      </h2>
      {hint && (
        <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>{hint}</span>
      )}
    </div>
  );
}

function HeroBlock({ brief }: { brief: AiBrief }) {
  const openDebate = useUIStore((s) => s.openDebate);
  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, rgba(139,92,246,0.10) 0%, rgba(245,158,11,0.06) 100%)",
        border: "1px solid rgba(139,92,246,0.28)",
        borderRadius: 6,
        padding: "14px 16px",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <AiTag>AI 今日定调</AiTag>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 3,
              background: REGIME_COLOR[brief.regime] ?? "var(--bg-tertiary)",
              color: "#fff",
              fontSize: "var(--font-xs)",
              fontWeight: 700,
            }}
          >
            {brief.regime_label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openDebate("market", undefined, "今日大盘")}
            className="flex items-center gap-1 px-2 py-1 rounded font-bold transition-colors"
            style={{
              background: "var(--accent-purple)",
              color: "#fff",
              fontSize: 11,
              border: "none",
              cursor: "pointer",
            }}
            title="多头/空头/裁判 三方 AI 多空辩论"
          >
            <Scale size={11} />
            AI 辩论
          </button>
          <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
            {brief.trade_date} · 模型 {brief.model} · 生成于{" "}
            {brief.generated_at.slice(11, 16)}
          </span>
        </div>
      </div>

      <div
        className="font-bold"
        style={{
          fontSize: "var(--font-hero)",
          color: "var(--text-primary)",
          lineHeight: 1.4,
          letterSpacing: "0.01em",
        }}
      >
        {brief.tagline}
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {brief.key_metrics.map((m) => (
          <MetricBadge key={m.label} metric={m} />
        ))}
      </div>
    </div>
  );
}

function MetricBadge({ metric }: { metric: KeyMetric }) {
  return (
    <button
      className="flex items-center gap-2 transition-colors"
      title={metric.anchor ? `点击跳转到 ${metric.anchor}` : undefined}
      style={{
        padding: "6px 10px",
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 4,
        cursor: metric.anchor ? "pointer" : "default",
      }}
    >
      <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
        {metric.label}
      </span>
      <span
        className="font-bold tabular-nums"
        style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
      >
        {metric.value}
      </span>
      <span className="flex items-center gap-0.5">
        <TrendIcon trend={metric.trend} />
        <span
          className="tabular-nums"
          style={{
            fontSize: "var(--font-xs)",
            color:
              metric.trend === "up"
                ? "var(--accent-red)"
                : metric.trend === "down"
                ? "var(--accent-green)"
                : "var(--text-muted)",
          }}
        >
          {metric.delta}
        </span>
      </span>
    </button>
  );
}

function MainLineBlock({ lines }: { lines: MainLine[] }) {
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const max = Math.max(...lines.map((l) => Math.abs(l.change_pct)), 5);

  return (
    <div>
      <SectionHeader
        icon={<Flame size={16} style={{ color: "var(--accent-orange)" }} />}
        title="今日主线"
        hint="AI 综合涨停密度、资金流向、新闻催化判定"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {lines.map((line) => (
          <div
            key={line.name}
            className="flex flex-col"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              borderRadius: 4,
              padding: "10px 12px",
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center justify-center font-bold"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 3,
                    background:
                      line.rank === 1
                        ? "var(--rank-1)"
                        : line.rank === 2
                        ? "var(--rank-2)"
                        : "var(--rank-3)",
                    color: "#1a1d28",
                    fontSize: 10,
                  }}
                >
                  {line.rank}
                </span>
                <span
                  className="font-bold"
                  style={{ fontSize: "var(--font-lg)", color: "var(--text-primary)" }}
                >
                  {line.name}
                </span>
              </div>
              <StatusBadge status={line.status} />
            </div>

            <div className="flex items-center gap-3 mt-2 mb-2">
              <span
                className="font-bold tabular-nums"
                style={{
                  fontSize: "var(--font-lg)",
                  color: line.change_pct >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                }}
              >
                {line.change_pct >= 0 ? "+" : ""}
                {line.change_pct.toFixed(2)}%
              </span>
              <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
                涨停 {line.limit_up_count}
              </span>
              <Sparkbar values={line.recent_lu_counts ?? []} />
            </div>

            <div
              className="rounded overflow-hidden"
              style={{ background: "var(--bg-tertiary)", height: 4 }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.min((Math.abs(line.change_pct) / max) * 100, 100)}%`,
                  background:
                    line.change_pct >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                }}
              />
            </div>

            <div
              className="mt-3 flex gap-2"
              style={{
                background: "rgba(139,92,246,0.08)",
                borderLeft: "2px solid var(--accent-purple)",
                padding: "8px 10px",
                borderRadius: "0 3px 3px 0",
              }}
            >
              <Sparkles
                size={11}
                style={{ color: "var(--accent-purple)", flexShrink: 0, marginTop: 2 }}
              />
              <p
                style={{
                  fontSize: "var(--font-sm)",
                  color: "var(--text-secondary)",
                  lineHeight: 1.55,
                }}
              >
                {line.ai_reason}
              </p>
            </div>

            <button
              onClick={() => openStockDetail(line.leader_code, line.leader_name)}
              className="mt-3 flex items-center justify-between transition-colors"
              style={{
                padding: "6px 8px",
                background: "var(--bg-tertiary)",
                borderRadius: 3,
              }}
            >
              <span className="flex items-center gap-2">
                <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
                  发动机
                </span>
                <span
                  className="font-bold"
                  style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
                >
                  {line.leader_name}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="font-bold tabular-nums"
                  style={{
                    fontSize: "var(--font-md)",
                    color: line.leader_pct >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                  }}
                >
                  {line.leader_pct >= 0 ? "+" : ""}
                  {line.leader_pct.toFixed(2)}%
                </span>
                <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkbar({ values }: { values: number[] }) {
  if (!values || values.length === 0) return null;
  const max = Math.max(...values, 1);
  const last = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const trendUp = last > first;
  const trendFlat = last === first;
  return (
    <span
      className="ml-auto flex items-end gap-1"
      title={`近${values.length}日涨停数: ${values.join(" → ")}`}
    >
      <span className="flex items-end gap-px" style={{ height: 14 }}>
        {values.map((v, i) => (
          <span
            key={i}
            style={{
              display: "inline-block",
              width: 4,
              height: `${Math.max((v / max) * 14, 1)}px`,
              background:
                i === values.length - 1
                  ? "var(--accent-orange)"
                  : "var(--text-muted)",
              opacity: i === values.length - 1 ? 1 : 0.55,
              borderRadius: 1,
            }}
          />
        ))}
      </span>
      <span
        className="tabular-nums"
        style={{
          fontSize: 10,
          color: trendFlat
            ? "var(--text-muted)"
            : trendUp
            ? "var(--accent-red)"
            : "var(--accent-green)",
          lineHeight: 1,
        }}
      >
        {trendFlat ? "→" : trendUp ? "↑" : "↓"}
        {last}
      </span>
    </span>
  );
}

function StatusBadge({ status }: { status: MainLine["status"] }) {
  const map: Record<MainLine["status"], { label: string; color: string }> = {
    rising: { label: "上升", color: "var(--accent-red)" },
    peak: { label: "高潮", color: "var(--accent-orange)" },
    diverge: { label: "分歧", color: "var(--accent-yellow)" },
    fading: { label: "退潮", color: "var(--accent-green)" },
  };
  const s = map[status];
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 2,
        background: s.color,
        color: "#1a1d28",
        fontSize: 10,
        fontWeight: 700,
      }}
    >
      {s.label}
    </span>
  );
}

function LeadersBlock({ leaders }: { leaders: Leader[] }) {
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const openWhyRose = useUIStore((s) => s.openWhyRose);
  return (
    <div>
      <SectionHeader
        icon={<Zap size={16} style={{ color: "var(--accent-orange)" }} />}
        title="高度龙头 + AI 盘口注解"
        hint="时间轴叠加 AI 标记的关键拐点"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {leaders.map((leader) => (
          <div
            key={leader.code}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              borderRadius: 4,
              padding: "12px 14px",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openStockDetail(leader.code, leader.name)}
                  className="font-bold"
                  style={{
                    fontSize: "var(--font-lg)",
                    color: "var(--text-primary)",
                  }}
                >
                  {leader.name}
                </button>
                <span
                  className="font-bold"
                  style={{
                    padding: "1px 6px",
                    borderRadius: 2,
                    background: "var(--accent-orange)",
                    color: "#1a1d28",
                    fontSize: 10,
                  }}
                >
                  {leader.board}板
                </span>
                <span
                  className="font-bold tabular-nums"
                  style={{
                    fontSize: "var(--font-md)",
                    color:
                      leader.change_pct >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                  }}
                >
                  {leader.change_pct >= 0 ? "+" : ""}
                  {leader.change_pct.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1" title={GRADE_DESC[leader.ai_grade]}>
                  <AiTag>AI 评级</AiTag>
                  <span
                    className="font-bold inline-flex items-center justify-center"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 3,
                      background: GRADE_COLOR[leader.ai_grade],
                      color: "#fff",
                      fontSize: "var(--font-md)",
                    }}
                  >
                    {leader.ai_grade}
                  </span>
                  <span
                    className="font-bold"
                    style={{
                      fontSize: "var(--font-xs)",
                      color: GRADE_COLOR[leader.ai_grade],
                    }}
                  >
                    {GRADE_LABEL[leader.ai_grade]}
                  </span>
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openWhyRose(leader.code, leader.name);
                  }}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors"
                  style={{
                    color: "var(--accent-purple)",
                    fontSize: 10,
                    background: "rgba(168,85,247,0.12)",
                    border: "1px solid rgba(168,85,247,0.3)",
                    fontWeight: 600,
                  }}
                  title="AI 解读: 真实驱动 / 卡位 / 高度 / 明日策略"
                >
                  <Zap size={9} />
                  为什么涨
                </button>
              </div>
            </div>

            <p
              style={{
                fontSize: "var(--font-sm)",
                color: "var(--text-secondary)",
                lineHeight: 1.55,
                marginBottom: 10,
              }}
            >
              {leader.ai_summary}
            </p>

            <Timeline annotations={leader.annotations} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Timeline({ annotations }: { annotations: Leader["annotations"] }) {
  if (!annotations.length) return null;
  const startMin = 9 * 60 + 30;
  const endMin = 15 * 60;
  const total = endMin - startMin;
  const toX = (t: string) => {
    const [hh, mm] = t.split(":").map(Number);
    const m = (hh ?? 0) * 60 + (mm ?? 0);
    const ratio = Math.max(0, Math.min(1, (m - startMin) / total));
    return ratio * 100;
  };

  return (
    <div
      style={{
        position: "relative",
        height: 88,
        background: "var(--bg-tertiary)",
        borderRadius: 3,
        padding: "8px 10px",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          top: 44,
          height: 1,
          background: "var(--border-color-strong)",
        }}
      />

      {annotations.map((anno, idx) => {
        const left = toX(anno.time);
        const isAbove = idx % 2 === 0;
        return (
          <div
            key={`${anno.time}-${idx}`}
            style={{
              position: "absolute",
              left: `calc(${left}% + 10px - 4px)`,
              top: isAbove ? 8 : 50,
              maxWidth: 160,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: ANNO_COLOR[anno.level],
                marginLeft: 0,
                marginTop: isAbove ? 28 : 0,
                position: isAbove ? "absolute" : "relative",
                bottom: isAbove ? -34 : undefined,
              }}
            />
            <div
              className="flex items-center gap-1"
              style={{
                fontSize: 10,
                color: "var(--text-secondary)",
                lineHeight: 1.2,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ color: ANNO_COLOR[anno.level], fontWeight: 700 }}>
                {anno.time}
              </span>
              <span>{anno.label}</span>
            </div>
          </div>
        );
      })}

      <div
        style={{
          position: "absolute",
          left: 10,
          bottom: 4,
          fontSize: 9,
          color: "var(--text-muted)",
        }}
      >
        09:30
      </div>
      <div
        style={{
          position: "absolute",
          right: 10,
          bottom: 4,
          fontSize: 9,
          color: "var(--text-muted)",
        }}
      >
        15:00
      </div>
    </div>
  );
}

function PlanBlock({
  plan,
  similar,
  judgment,
  onPickSimilar,
}: {
  plan: AiBrief["tomorrow_plan"];
  similar: SimilarDay[];
  judgment?: AiBrief["similar_judgment"];
  onPickSimilar: (d: SimilarDay) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
      <div className="lg:col-span-2">
        <SectionHeader
          icon={<Target size={16} style={{ color: "var(--accent-purple)" }} />}
          title="明日候选池"
          hint="AI 给出触发条件，盘口直接对照"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <PromotionCard items={plan.promotion} />
          <FirstBoardCard items={plan.first_board} />
          <ResealCard items={plan.reseal} />
          <AvoidCard items={plan.avoid} />
        </div>
      </div>

      <div>
        <SectionHeader
          icon={<History size={16} style={{ color: "var(--accent-blue)" }} />}
          title="历史相似日"
          hint="26 维指纹 + cosine + AI 综合判断"
        />
        {judgment && <SimilarJudgmentCard j={judgment} />}
        <div className="space-y-2">
          {similar.map((d) => (
            <SimilarDayCard key={d.trade_date} day={d} onClick={() => onPickSimilar(d)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SimilarJudgmentCard({ j }: { j: NonNullable<AiBrief["similar_judgment"]> }) {
  const tiltMeta = {
    "延续": { color: "var(--accent-red)", label: "倾向延续" },
    "反转": { color: "var(--accent-green)", label: "倾向反转" },
    "震荡": { color: "var(--accent-orange)", label: "倾向震荡" },
  } as const;
  const meta = tiltMeta[j.tilt] || tiltMeta["震荡"];
  return (
    <div
      className="mb-2"
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${meta.color}55`,
        borderRadius: 4,
        padding: "8px 10px",
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Sparkles size={11} style={{ color: "var(--accent-purple)" }} />
          <span className="font-bold" style={{ fontSize: "var(--font-sm)", color: "var(--text-primary)" }}>
            AI 综合判断
          </span>
        </div>
        <span
          className="font-bold"
          style={{
            fontSize: 18,
            color: meta.color,
            tabularNums: "tabular-nums" as never,
          }}
        >
          {j.probability}%
        </span>
      </div>
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="font-bold"
          style={{
            padding: "1px 7px",
            background: meta.color,
            color: "#fff",
            fontSize: 11,
            borderRadius: 2,
          }}
        >
          {meta.label}
        </span>
        <div
          className="flex-1 h-1.5"
          style={{ background: "var(--bg-tertiary)", borderRadius: 2, overflow: "hidden" }}
        >
          <div style={{ width: `${j.probability}%`, height: "100%", background: meta.color }} />
        </div>
      </div>
      {j.key_risk && (
        <div className="flex items-start gap-1 mt-1.5" style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>
          <AlertTriangle size={10} className="mt-0.5 flex-shrink-0" style={{ color: "var(--accent-orange)" }} />
          <span><span style={{ color: "var(--accent-orange)" }}>风险: </span>{j.key_risk}</span>
        </div>
      )}
      {j.note && (
        <div className="mt-1" style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
          {j.note}
        </div>
      )}
    </div>
  );
}

function PlanCardShell({
  title,
  accent,
  count,
  children,
}: {
  title: string;
  accent: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{
          padding: "6px 10px",
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        <span className="flex items-center gap-2">
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: accent,
              display: "inline-block",
            }}
          />
          <span
            className="font-bold"
            style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
          >
            {title}
          </span>
        </span>
        <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
          {count} 只
        </span>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--border-color)" }}>
        {children}
      </div>
    </div>
  );
}

function PromotionCard({ items }: { items: PlanPromotion[] }) {
  const open = useUIStore((s) => s.openStockDetail);
  return (
    <PlanCardShell title="高位接力" accent="var(--accent-orange)" count={items.length}>
      {items.map((it) => (
        <div key={it.code} style={{ padding: "8px 10px" }}>
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={() => open(it.code, it.name)}
              className="flex items-center gap-1.5 font-bold"
              style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
            >
              {it.name}
              <span
                className="font-bold"
                style={{
                  padding: "1px 5px",
                  borderRadius: 2,
                  background: "var(--accent-orange)",
                  color: "#1a1d28",
                  fontSize: 10,
                }}
              >
                {it.board}板
              </span>
            </button>
            <RiskTag risk={it.risk} />
          </div>
          <TriggerLine text={it.trigger} />
        </div>
      ))}
    </PlanCardShell>
  );
}

function FirstBoardCard({ items }: { items: PlanFirstBoard[] }) {
  const open = useUIStore((s) => s.openStockDetail);
  return (
    <PlanCardShell title="低位首板" accent="var(--accent-yellow)" count={items.length}>
      {items.map((it) => (
        <div key={it.code} style={{ padding: "8px 10px" }}>
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={() => open(it.code, it.name)}
              className="flex items-center gap-1.5 font-bold"
              style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
            >
              {it.name}
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                · {it.theme}
              </span>
            </button>
            <RiskTag risk={it.risk} />
          </div>
          <TriggerLine text={it.trigger} />
        </div>
      ))}
    </PlanCardShell>
  );
}

function ResealCard({ items }: { items: PlanReseal[] }) {
  const open = useUIStore((s) => s.openStockDetail);
  return (
    <PlanCardShell title="修复反包" accent="var(--accent-green)" count={items.length}>
      {items.map((it) => (
        <div key={it.code} style={{ padding: "8px 10px" }}>
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={() => open(it.code, it.name)}
              className="font-bold"
              style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
            >
              {it.name}
            </button>
            <RiskTag risk={it.risk} />
          </div>
          <TriggerLine text={it.trigger} />
        </div>
      ))}
    </PlanCardShell>
  );
}

function AvoidCard({ items }: { items: PlanAvoid[] }) {
  return (
    <PlanCardShell title="避雷名单" accent="var(--accent-red)" count={items.length}>
      {items.map((it) => (
        <div key={it.code} style={{ padding: "8px 10px" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={12} style={{ color: "var(--accent-red)" }} />
            <span
              className="font-bold"
              style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
            >
              {it.name}
            </span>
          </div>
          <p
            style={{
              fontSize: "var(--font-sm)",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
              paddingLeft: 18,
            }}
          >
            {it.reason}
          </p>
        </div>
      ))}
    </PlanCardShell>
  );
}

function RiskTag({ risk }: { risk: RiskLevel }) {
  return (
    <span
      style={{
        padding: "1px 5px",
        borderRadius: 2,
        background: "transparent",
        color: RISK_COLOR[risk],
        border: `1px solid ${RISK_COLOR[risk]}`,
        fontSize: 9,
        fontWeight: 700,
      }}
    >
      {RISK_LABEL[risk]}
    </span>
  );
}

function TriggerLine({ text }: { text: string }) {
  return (
    <div
      className="flex gap-1.5"
      style={{
        background: "rgba(139,92,246,0.06)",
        borderLeft: "2px solid var(--accent-purple)",
        padding: "5px 8px",
        borderRadius: "0 2px 2px 0",
      }}
    >
      <Sparkles
        size={10}
        style={{ color: "var(--accent-purple)", flexShrink: 0, marginTop: 3 }}
      />
      <span
        style={{
          fontSize: "var(--font-xs)",
          color: "var(--text-secondary)",
          lineHeight: 1.5,
        }}
      >
        {text}
      </span>
    </div>
  );
}

function SimilarDayCard({ day, onClick }: { day: SimilarDay; onClick: () => void }) {
  const sumNext = day.next_3d.reduce((a, b) => a + b, 0);
  const isPositive = sumNext >= 0;
  return (
    <button
      onClick={onClick}
      className="w-full text-left transition-opacity hover:brightness-110"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 4,
        padding: "10px 12px",
        cursor: "pointer",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="font-bold tabular-nums"
          style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
        >
          {day.trade_date}
        </span>
        <span
          className="font-bold tabular-nums"
          style={{
            fontSize: "var(--font-xs)",
            padding: "1px 6px",
            background: "var(--bg-tertiary)",
            color: "var(--accent-blue)",
            borderRadius: 3,
          }}
        >
          相似度 {(day.similarity * 100).toFixed(0)}%
        </span>
      </div>

      <div className="flex items-center gap-1 mb-2">
        {day.next_3d.map((v, i) => (
          <span
            key={i}
            className="font-bold tabular-nums"
            style={{
              flex: 1,
              padding: "3px 6px",
              borderRadius: 2,
              fontSize: "var(--font-xs)",
              textAlign: "center",
              background: v >= 0 ? "var(--cell-red-2)" : "var(--cell-green-2)",
              color: "#fff",
            }}
          >
            T+{i + 1} {v >= 0 ? "+" : ""}
            {v.toFixed(1)}%
          </span>
        ))}
      </div>

      <p
        className="flex items-start gap-1"
        style={{
          fontSize: "var(--font-xs)",
          color: isPositive ? "var(--accent-red)" : "var(--accent-green)",
          lineHeight: 1.5,
        }}
      >
        <Sparkles size={10} style={{ marginTop: 2, flexShrink: 0 }} />
        {day.summary}
      </p>
      {day.delta && day.delta.length > 0 && (
        <div
          className="mt-1.5 flex flex-wrap gap-1"
          style={{ fontSize: 10 }}
        >
          {day.delta.slice(0, 3).map((d) => {
            const isUp = d.delta > 0;
            return (
              <span
                key={d.name}
                className="tabular-nums"
                style={{
                  padding: "1px 5px",
                  borderRadius: 2,
                  background: isUp ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)",
                  color: isUp ? "var(--accent-red)" : "var(--accent-green)",
                  border: `1px solid ${isUp ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
                }}
                title={`今日 ${d.today} vs 历史 ${d.then}`}
              >
                {d.name} {isUp ? "+" : ""}{d.delta.toFixed(2)}
              </span>
            );
          })}
        </div>
      )}
      <div
        className="mt-1 flex items-center gap-1"
        style={{
          fontSize: 10,
          color: "var(--text-muted)",
        }}
      >
        <ChevronRight size={10} />
        点击对比详情
      </div>
    </button>
  );
}

function CompareModal({
  current,
  similar,
  onClose,
}: {
  current: AiBrief;
  similar: SimilarDay;
  onClose: () => void;
}) {
  const [other, setOther] = useState<AiBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    api
      .getAiBrief(similar.trade_date)
      .then((b) => !aborted && setOther(b))
      .catch((e: Error) => !aborted && setErr(e.message))
      .finally(() => !aborted && setLoading(false));
    return () => {
      aborted = true;
    };
  }, [similar.trade_date]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col"
        style={{
          width: "min(900px, 92vw)",
          maxHeight: "82vh",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <div
          className="flex items-center justify-between px-4"
          style={{
            height: 42,
            borderBottom: "1px solid var(--border-color)",
            background: "var(--bg-tertiary)",
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: "var(--accent-purple)" }} />
            <span className="font-bold" style={{ fontSize: "var(--font-md)" }}>
              历史相似日对比
            </span>
            <span
              style={{
                marginLeft: 8,
                padding: "1px 6px",
                fontSize: "var(--font-xs)",
                background: "var(--bg-secondary)",
                borderRadius: 3,
                color: "var(--accent-blue)",
              }}
            >
              相似度 {(similar.similarity * 100).toFixed(0)}%
            </span>
          </div>
          <button onClick={onClose} className="p-1 transition-opacity hover:opacity-70">
            <X size={16} style={{ color: "var(--text-secondary)" }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}>
              加载 {similar.trade_date} 的复盘…
            </div>
          )}
          {err && (
            <div style={{ color: "var(--accent-red)", fontSize: "var(--font-sm)" }}>
              加载失败: {err}
            </div>
          )}
          {other && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <CompareCol brief={current} title="今日" />
                <CompareCol brief={other} title={similar.trade_date} />
              </div>
              <div
                style={{
                  padding: "8px 10px",
                  background: "var(--bg-card)",
                  borderRadius: 4,
                  border: "1px solid var(--border-color)",
                  fontSize: "var(--font-sm)",
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <History size={12} style={{ color: "var(--accent-orange)" }} />
                  <span className="font-bold" style={{ color: "var(--text-primary)" }}>
                    后续 3 天表现
                  </span>
                </div>
                <div className="flex gap-2">
                  {similar.next_3d.map((v, i) => (
                    <span
                      key={i}
                      className="font-bold tabular-nums"
                      style={{
                        flex: 1,
                        padding: "4px 8px",
                        textAlign: "center",
                        borderRadius: 3,
                        fontSize: "var(--font-xs)",
                        background: v >= 0 ? "var(--cell-red-2)" : "var(--cell-green-2)",
                        color: "#fff",
                      }}
                    >
                      T+{i + 1} {v >= 0 ? "+" : ""}
                      {v.toFixed(1)}%
                    </span>
                  ))}
                </div>
                <div className="mt-2" style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
                  {similar.summary}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CompareCol({ brief, title }: { brief: AiBrief; title: string }) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 4,
        padding: "10px 12px",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold" style={{ fontSize: "var(--font-md)" }}>
          {title}
        </span>
        <span
          className="font-bold"
          style={{
            padding: "1px 6px",
            fontSize: "var(--font-xs)",
            background: REGIME_COLOR[brief.regime] || "var(--accent-blue)",
            color: "#fff",
            borderRadius: 3,
          }}
        >
          {brief.regime_label}
        </span>
      </div>
      <p
        style={{
          fontSize: "var(--font-sm)",
          color: "var(--text-secondary)",
          lineHeight: 1.6,
          minHeight: 36,
        }}
      >
        {brief.tagline}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {brief.key_metrics.slice(0, 4).map((m) => (
          <div
            key={m.label}
            style={{
              padding: "4px 6px",
              background: "var(--bg-tertiary)",
              borderRadius: 3,
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{m.label}</div>
            <div className="font-bold tabular-nums" style={{ fontSize: "var(--font-sm)" }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>
      {brief.main_lines.length > 0 && (
        <div className="mt-2">
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>
            主线
          </div>
          {brief.main_lines.slice(0, 3).map((ml) => (
            <div
              key={ml.name}
              className="flex items-center gap-1 mb-1"
              style={{ fontSize: "var(--font-xs)" }}
            >
              <span
                className="font-bold"
                style={{ color: "var(--accent-orange)", minWidth: 60 }}
              >
                {ml.name}
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                {ml.limit_up_count} 只涨停
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TodayReviewPage() {
  const [brief, setBrief] = useState<AiBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<SimilarDay | null>(null);

  useEffect(() => {
    let aborted = false;
    api
      .getAiBrief()
      .then((b) => {
        if (!aborted) setBrief(b);
      })
      .catch((e: Error) => {
        if (!aborted) setError(e.message);
      });
    return () => {
      aborted = true;
    };
  }, []);

  if (error) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center"
        style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
      >
        <AlertTriangle size={20} style={{ color: "var(--accent-red)", marginBottom: 8 }} />
        加载 AI 复盘失败：{error}
      </div>
    );
  }

  if (!brief) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
      >
        AI 正在生成今日复盘...
      </div>
    );
  }

  return (
    <div
      className="p-3 space-y-3"
      style={{ background: "var(--bg-primary)", minHeight: "100%" }}
    >
      <HeroBlock brief={brief} />
      <MainLineBlock lines={brief.main_lines} />
      <LeadersBlock leaders={brief.leaders} />
      <PlanBlock
        plan={brief.tomorrow_plan}
        similar={brief.similar_days}
        judgment={brief.similar_judgment}
        onPickSimilar={setPicked}
      />
      {picked && (
        <CompareModal
          current={brief}
          similar={picked}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}
