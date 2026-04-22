"use client";

import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw,
  Crown,
  CheckCircle2,
  Sparkles,
  Star,
  Zap,
  ArrowUp,
  Wallet,
} from "lucide-react";
import { api, type QuotaUsage, type TierInfo } from "@/lib/api";
import { SkillChip } from "@/components/skill/SkillChip";
import { useUIStore } from "@/stores/ui-store";

const TIER_META: Record<string, { color: string; icon: typeof Crown; tagline: string }> = {
  free: { color: "var(--text-muted)", icon: Sparkles, tagline: "试水版, 看看 AI 啥水平" },
  monthly: { color: "var(--accent-blue)", tagline: "盘后复盘 + 自选股 AI 解读够用", icon: Star },
  yearly: { color: "var(--accent-orange)", tagline: "高频游资专享, 配额几乎用不完", icon: Crown },
};

export function AccountPage() {
  const [usage, setUsage] = useState<QuotaUsage | null>(null);
  const [tiers, setTiers] = useState<TierInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, ts] = await Promise.all([api.getQuotaUsage(), api.getTiers()]);
      setUsage(u);
      setTiers(ts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
        }}
      >
        <div className="flex items-center gap-2">
          <Wallet size={14} style={{ color: "var(--accent-orange)" }} />
          <span
            className="font-bold"
            style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
          >
            我的账户 · 套餐
          </span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            按动作分别计算 quota, 缓存命中也计数 (避免高频白嫖 LLM)
          </span>
        </div>
        <button onClick={load} disabled={loading} className="p-1 rounded" style={{ color: "var(--text-muted)" }}>
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {usage && <CurrentTier usage={usage} />}
        {usage && <UsageBreakdown usage={usage} />}
        <DefaultSkillSetting />
        <Tiers list={tiers} currentTier={usage?.tier} />
      </div>
    </div>
  );
}

function DefaultSkillSetting() {
  const setActiveModule = useUIStore((s) => s.setActiveModule);
  return (
    <div
      className="rounded p-3"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={12} style={{ color: "var(--accent-purple)" }} />
        <span className="font-semibold" style={{ color: "var(--text-primary)", fontSize: "var(--font-sm)" }}>
          默认 AI 体系
        </span>
      </div>
      <p className="text-xs mb-2" style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
        所有 AI 输出（自选股复盘 / 个股三视角速读 / 副驾对话）都会按当前激活体系给意见，AI 输出会带【XX视角】标签。中立 = 不绑定任何体系。
      </p>
      <div className="flex items-center gap-2">
        <SkillChip onManageClick={() => setActiveModule("skills")} />
        <button
          onClick={() => setActiveModule("skills")}
          className="text-xs px-2 py-1 rounded transition-opacity hover:opacity-90"
          style={{
            border: "1px solid var(--border-color)",
            color: "var(--text-secondary)",
            background: "var(--bg-tertiary)",
          }}
        >
          管理我的体系
        </button>
        <button
          onClick={() => setActiveModule("skill_scan")}
          className="text-xs px-2 py-1 rounded transition-opacity hover:opacity-90"
          style={{
            border: "1px solid var(--border-color)",
            color: "var(--text-secondary)",
            background: "var(--bg-tertiary)",
          }}
        >
          体系扫描
        </button>
      </div>
    </div>
  );
}

function CurrentTier({ usage }: { usage: QuotaUsage }) {
  const meta = TIER_META[usage.tier] || TIER_META.free;
  const Icon = meta.icon;
  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(139,92,246,0.08) 100%)",
        border: "1px solid rgba(245,158,11,0.30)",
        borderRadius: 6,
        padding: "14px 16px",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={18} style={{ color: meta.color }} />
          <div>
            <div className="font-bold" style={{ fontSize: 16, color: "var(--text-primary)" }}>
              {usage.tier_label}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{meta.tagline}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-bold tabular-nums" style={{ fontSize: 22, color: "var(--accent-orange)" }}>
            ¥{usage.tier_price_rmb}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {usage.tier === "yearly" ? "年" : usage.tier === "monthly" ? "月" : "免费"}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsageBreakdown({ usage }: { usage: QuotaUsage }) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 4,
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-1.5"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <Zap size={12} style={{ color: "var(--accent-blue)" }} />
        <span className="font-bold" style={{ fontSize: "var(--font-sm)" }}>
          今日用量 ({usage.trade_date})
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3">
        {usage.actions.map((a) => {
          const exhausted = a.remaining === 0;
          const warn = a.percent >= 70;
          const color = exhausted ? "var(--accent-green)" : warn ? "var(--accent-orange)" : "var(--accent-blue)";
          return (
            <div
              key={a.action}
              style={{
                background: "var(--bg-secondary)",
                border: `1px solid ${exhausted ? "var(--accent-green)44" : "var(--border-color)"}`,
                borderRadius: 4,
                padding: "10px 12px",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{a.label}</div>
              <div className="flex items-baseline gap-1">
                <span className="font-bold tabular-nums" style={{ fontSize: 22, color, lineHeight: 1.1 }}>
                  {a.used}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>/ {a.quota}</span>
              </div>
              <div className="mt-1.5 h-1.5" style={{ background: "var(--bg-tertiary)", borderRadius: 2, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.min(100, a.percent)}%`,
                    height: "100%",
                    background: color,
                  }}
                />
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                剩余 {a.remaining} 次
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Tiers({ list, currentTier }: { list: TierInfo[]; currentTier?: string }) {
  if (!list.length) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <ArrowUp size={13} style={{ color: "var(--accent-orange)" }} />
        <span className="font-bold" style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}>
          升级方案
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
          支付通道开发中 · 当前展示为方案预览
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {list.map((t) => {
          const meta = TIER_META[t.tier] || TIER_META.free;
          const Icon = meta.icon;
          const isCurrent = currentTier === t.tier;
          return (
            <div
              key={t.tier}
              style={{
                background: isCurrent ? "rgba(245,158,11,0.06)" : "var(--bg-card)",
                border: isCurrent ? `1px solid ${meta.color}` : "1px solid var(--border-color)",
                borderRadius: 6,
                padding: 14,
                position: "relative",
              }}
            >
              {isCurrent && (
                <div
                  style={{
                    position: "absolute",
                    top: -8,
                    right: 12,
                    background: meta.color,
                    color: "#fff",
                    fontSize: 10,
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontWeight: 700,
                  }}
                >
                  当前
                </div>
              )}
              <div className="flex items-center gap-2 mb-2">
                <Icon size={18} style={{ color: meta.color }} />
                <span className="font-bold" style={{ fontSize: 14, color: "var(--text-primary)" }}>
                  {t.tier_label}
                </span>
              </div>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="font-bold tabular-nums" style={{ fontSize: 28, color: meta.color }}>
                  ¥{t.price_rmb}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  /{t.tier === "yearly" ? "年" : t.tier === "monthly" ? "月" : "永久"}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>{meta.tagline}</div>
              <ul className="space-y-1" style={{ fontSize: 11 }}>
                {t.quota.map((q) => (
                  <li key={q.action} className="flex items-center gap-1">
                    <CheckCircle2 size={11} style={{ color: meta.color }} />
                    <span style={{ color: "var(--text-secondary)" }}>{q.label}</span>
                    <span className="font-bold tabular-nums" style={{ color: "var(--text-primary)", marginLeft: "auto" }}>
                      {q.quota}/天
                    </span>
                  </li>
                ))}
              </ul>
              <button
                disabled
                className="mt-3 w-full py-1.5 rounded font-bold"
                style={{
                  background: isCurrent ? "var(--bg-tertiary)" : "var(--bg-tertiary)",
                  color: isCurrent ? "var(--text-muted)" : "var(--text-muted)",
                  fontSize: 12,
                  border: "1px dashed var(--border-color)",
                  cursor: "not-allowed",
                }}
                title={isCurrent ? "已订阅" : "支付通道开发中"}
              >
                {isCurrent ? "已订阅" : "敬请期待"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
