"use client";

/**
 * 中长视角各 Tab 顶部的「升级解锁完整数据」条幅
 *
 * 后端 midlong/* 接口会根据 user.tier 截断历史窗口, 并返回 tier_meta.upgrade_hint.
 * 前端展示该提示, 引导匿名/free 用户升级到 Pro/Master 解锁完整 5 年回看.
 */

import { Telescope, ArrowRight, Lock } from "lucide-react";
import type { TierMeta } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";

interface Props {
  tierMeta?: TierMeta;
  /** 当前已经获取到的数据条数, 用于"已展示 X / 解锁后可达 Y" */
  currentCount?: number;
  /** 要解锁的指标 (用于按 cap 选择对应字段). 默认 valuation. */
  scope?: "valuation" | "consensus" | "fundamentals" | "holders";
}

const SCOPE_META: Record<NonNullable<Props["scope"]>, { label: string; capKey: keyof TierMeta["history_cap"] | "valuation_days_cap"; unit: string; paidCap: number }> = {
  valuation:    { label: "估值历史",    capKey: "valuation_days_cap",       unit: "交易日", paidCap: 1250 },
  consensus:    { label: "一致预期回看", capKey: "consensus_weeks",          unit: "周",     paidCap: 104 },
  fundamentals: { label: "财务季度回看", capKey: "fundamentals_periods",     unit: "季度",   paidCap: 20 },
  holders:      { label: "机构持仓追踪", capKey: "holders_quarters",         unit: "季度",   paidCap: 12 },
};

export function TierUpgradeBanner({ tierMeta, currentCount, scope = "valuation" }: Props) {
  const setActiveModule = useUIStore((s) => s.setActiveModule);

  if (!tierMeta || !tierMeta.upgrade_hint) return null;
  const meta = SCOPE_META[scope];
  const cap = scope === "valuation"
    ? tierMeta.valuation_days_cap
    : tierMeta.history_cap[meta.capKey as keyof TierMeta["history_cap"]];

  return (
    <div
      className="px-3 py-2 flex items-start gap-2"
      style={{
        background: "linear-gradient(135deg, rgba(168,85,247,0.1) 0%, rgba(59,130,246,0.05) 100%)",
        border: "1px solid rgba(168,85,247,0.3)",
        borderRadius: 6,
      }}
    >
      <Lock size={14} className="flex-shrink-0 mt-0.5" style={{ color: "var(--accent-purple)" }} />
      <div className="flex-1 min-w-0">
        <div className="font-bold mb-0.5" style={{ fontSize: 11, color: "var(--accent-purple)", letterSpacing: 1 }}>
          {tierMeta.tier === "anonymous" ? "访客模式" : "免费版"}
          <span style={{ color: "var(--text-muted)", fontWeight: 500, marginLeft: 6, letterSpacing: 0 }}>
            · 当前 {meta.label}最多 {cap} {meta.unit}
            {currentCount != null && ` (已展示 ${currentCount} 条)`}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {tierMeta.upgrade_hint}, 完整 {meta.paidCap} {meta.unit} {meta.label}.
        </div>
      </div>
      <button
        onClick={() => setActiveModule("account")}
        className="flex-shrink-0 flex items-center gap-1 px-2 py-1 font-bold transition-all"
        style={{
          background: "var(--accent-purple)",
          color: "#fff",
          borderRadius: 3,
          fontSize: 11,
        }}
      >
        <Telescope size={11} />
        升级
        <ArrowRight size={11} />
      </button>
    </div>
  );
}
