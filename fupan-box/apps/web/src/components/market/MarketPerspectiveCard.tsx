"use client";

/**
 * 首页三视角速读卡 (Phase 3)
 *
 * 服务于不同投资偏好用户:
 *   - 短线: 直接复用今日 brief 的 tagline + 主线题材
 *   - 波段: 5-20 日趋势 / 中期热度题材 / 持续天数
 *   - 长线: 跳转中长视角页 (估值/景气度/机构持仓)
 *
 * 不发起新 LLM 请求, 只整合现有 brief 数据 + 可视化, 加载零成本.
 */

import { useState } from "react";
import { Activity, Waves, Telescope, ChevronRight, Sparkles } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import type { AiBrief, MainLine } from "@/types/ai-brief";

type PerspectiveTab = "short" | "swing" | "long";

const STATUS_LABEL: Record<string, string> = {
  rising: "上升",
  peak: "高峰",
  diverge: "分化",
  fading: "退潮",
};

const TAB_META: Record<PerspectiveTab, { label: string; icon: React.ComponentType<{ size?: number }>; color: string; horizon: string }> = {
  short: { label: "短线", icon: Activity, color: "var(--accent-orange)", horizon: "1-5 日 · 涨停板/题材轮动" },
  swing: { label: "波段", icon: Waves, color: "var(--accent-blue)", horizon: "5-20 日 · 持续主线/趋势加速" },
  long: { label: "长线", icon: Telescope, color: "var(--accent-purple)", horizon: "6 月+ · 估值修复/景气底" },
};

interface Props {
  brief: AiBrief;
}

export function MarketPerspectiveCard({ brief }: Props) {
  const [tab, setTab] = useState<PerspectiveTab>("short");
  const setActiveModule = useUIStore((s) => s.setActiveModule);

  // 主线 top3 (按当前 main_lines 顺序)
  const topLines: MainLine[] = brief.main_lines.slice(0, 3);
  // 持续主线 (近 5 日涨停均值 >=2 或 status 包含主升 视为波段候选)
  const swingLines = topLines.filter((l) => {
    const recent = l.recent_lu_counts || [];
    if (recent.length >= 3) {
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
      if (avg >= 2) return true;
    }
    return l.status === "rising" || l.status === "peak";
  });
  const luTrend = (l: MainLine): string => {
    const r = l.recent_lu_counts || [];
    if (r.length === 0) return "";
    return r.slice(-5).join("→");
  };

  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(168,85,247,0.06) 0%, var(--bg-card) 60%)",
        border: "1px solid var(--border-color)",
        borderRadius: 6,
      }}
    >
      <div className="px-3 py-2 flex items-center gap-1.5" style={{ borderBottom: "1px solid var(--border-color)" }}>
        <Sparkles size={12} style={{ color: "var(--accent-purple)" }} />
        <span className="font-bold" style={{ color: "var(--accent-purple)", fontSize: 11, letterSpacing: 1 }}>
          三视角速读
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
          根据投资偏好选择视角
        </span>
        <div className="ml-auto flex items-center gap-1">
          {(["short", "swing", "long"] as PerspectiveTab[]).map((t) => {
            const meta = TAB_META[t];
            const Icon = meta.icon;
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex items-center gap-1 px-2 py-0.5 transition-all"
                style={{
                  background: active ? meta.color : "transparent",
                  color: active ? "#fff" : "var(--text-secondary)",
                  border: `1px solid ${active ? meta.color : "var(--border-color)"}`,
                  borderRadius: 3,
                  fontSize: 10,
                  fontWeight: active ? 700 : 500,
                }}
              >
                <Icon size={10} />
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-3 py-2.5" style={{ minHeight: 90 }}>
        <div className="flex items-center gap-1.5 mb-1.5" style={{ fontSize: 10, color: "var(--text-muted)" }}>
          视角周期: {TAB_META[tab].horizon}
        </div>

        {tab === "short" && (
          <div className="space-y-1.5">
            <div className="font-bold leading-snug" style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}>
              {brief.tagline}
            </div>
            {topLines[0] && (
              <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                <span className="font-bold" style={{ color: "var(--accent-orange)" }}>主攻</span>
                ：{topLines[0].name}
                {topLines[0].limit_up_count != null && ` · ${topLines[0].limit_up_count} 板`}
                {topLines[0].ai_reason && ` · ${topLines[0].ai_reason}`}
              </div>
            )}
            {topLines.length > 1 && (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                关注主线: {topLines.slice(1).map((l) => l.name).join(" / ")}
              </div>
            )}
          </div>
        )}

        {tab === "swing" && (
          <div className="space-y-1.5">
            <div className="font-bold leading-snug" style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}>
              {swingLines.length > 0
                ? `${swingLines[0].name} 主线呈持续/扩散态势，关注趋势是否加速或衰竭`
                : "今日主线尚未形成可持续合力，波段宜观望，等待主线确立后顺势介入"}
            </div>
            {swingLines.length > 0 && (
              <div className="space-y-1 mt-1">
                {swingLines.map((l, i) => (
                  <div key={i} className="flex items-center gap-2" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    <span
                      className="font-bold"
                      style={{
                        background: TAB_META.swing.color,
                        color: "#fff",
                        padding: "0 6px",
                        borderRadius: 2,
                        fontSize: 10,
                      }}
                    >
                      {STATUS_LABEL[l.status] || l.status}
                    </span>
                    <span className="font-semibold">{l.name}</span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {l.limit_up_count != null && `· ${l.limit_up_count} 板`}
                      {luTrend(l) && ` · 涨停趋势 ${luTrend(l)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
              波段策略: 主线持续 ≥3 天 + 龙头未滞涨 → 可顺势加仓；主线退潮(继涨股&lt;3) → 撤
            </div>
          </div>
        )}

        {tab === "long" && (
          <div className="space-y-1.5">
            <div className="font-bold leading-snug" style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}>
              长线视角不看单日波动，关注估值底部 + 景气拐点 + 机构持仓变化
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              进入「中长视角」页面查看：
            </div>
            <ul className="space-y-1" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              <li>· 个股财务指标 (ROE/毛利率/营收增速)</li>
              <li>· PE/PB 历史百分位 + 估值偏离</li>
              <li>· 卖方一致预期 + 目标价</li>
              <li>· 十大股东 / 机构进出 / 北向流向</li>
            </ul>
            <button
              onClick={() => setActiveModule("midlong")}
              className="mt-2 inline-flex items-center gap-1 px-2 py-1 font-bold transition-all"
              style={{
                background: TAB_META.long.color,
                color: "#fff",
                borderRadius: 3,
                fontSize: 11,
              }}
            >
              <Telescope size={11} />
              进入中长视角
              <ChevronRight size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
