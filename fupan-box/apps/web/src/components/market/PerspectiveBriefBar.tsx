"use client";

/**
 * 个股 Drawer 顶部三视角速读条
 *
 * 一次拉 multi_perspective brief, 输出短/波段/长 三个 headline.
 * 用户在 Tab 间切换查看不同时间维度的判断, 「展开详细」按钮:
 *   - short → 触发 props.onOpenShortDetail (现有 WhyRoseModal)
 *   - swing → inline 展开 SwingBriefDetail
 *   - long  → 跳转 midlong page + 锁定到该股
 */

import { useEffect, useState, useCallback } from "react";
import { Sparkles, ChevronRight, RefreshCw, Telescope, Activity, Waves } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { CacheMetaBadge, getCacheMeta } from "./CacheMetaBadge";

type MultiPerspective = Awaited<ReturnType<typeof api.getMultiPerspectiveBrief>>;
type SwingBrief = Awaited<ReturnType<typeof api.getSwingBrief>>;

type PerspectiveTab = "short" | "swing" | "long";

const PERSPECTIVE_META: Record<PerspectiveTab, { label: string; icon: React.ComponentType<{ size?: number }>; color: string; horizon: string }> = {
  short: { label: "短线", icon: Activity, color: "var(--accent-orange)", horizon: "1-5 日" },
  swing: { label: "波段", icon: Waves, color: "var(--accent-blue)", horizon: "5-20 日" },
  long: { label: "长线", icon: Telescope, color: "var(--accent-purple)", horizon: "6 月+" },
};

const STANCE_COLOR: Record<string, string> = {
  bullish: "var(--accent-red)",
  cautious_bull: "var(--accent-orange)",
  neutral: "var(--text-secondary)",
  cautious_bear: "#84cc16",
  bearish: "var(--accent-green)",
};

const STANCE_LABEL: Record<string, string> = {
  bullish: "看多",
  cautious_bull: "偏多",
  neutral: "中性",
  cautious_bear: "偏空",
  bearish: "看空",
};

interface Props {
  stockCode: string;
  stockName?: string;
  /** 短线展开回调 (复用现有 WhyRoseModal) */
  onOpenShortDetail: () => void;
}

export function PerspectiveBriefBar({ stockCode, stockName, onOpenShortDetail }: Props) {
  const [activeTab, setActiveTab] = useState<PerspectiveTab>("short");
  const [data, setData] = useState<MultiPerspective | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 波段详细 (按需加载)
  const [swingDetail, setSwingDetail] = useState<SwingBrief | null>(null);
  const [swingLoading, setSwingLoading] = useState(false);
  const [swingExpanded, setSwingExpanded] = useState(false);

  const setActiveModule = useUIStore((s) => s.setActiveModule);
  const setFocused = useUIStore((s) => s.setFocusedStock);

  const fetchAll = useCallback(async (refresh = false) => {
    setLoading(true);
    setErr(null);
    try {
      const d = await api.getMultiPerspectiveBrief(stockCode, { refresh });
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI 速读暂不可用");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [stockCode]);

  useEffect(() => {
    setData(null);
    setSwingDetail(null);
    setSwingExpanded(false);
    setActiveTab("short");
    fetchAll();
  }, [fetchAll]);

  const handleSwingExpand = async () => {
    setSwingExpanded((v) => !v);
    if (!swingDetail && !swingLoading) {
      setSwingLoading(true);
      try {
        const d = await api.getSwingBrief(stockCode);
        setSwingDetail(d);
      } catch {
        setSwingDetail(null);
      } finally {
        setSwingLoading(false);
      }
    }
  };

  const handleLongJump = () => {
    setFocused({ code: stockCode, name: stockName });
    setActiveModule("midlong");
  };

  const handleExpand = () => {
    if (activeTab === "short") onOpenShortDetail();
    else if (activeTab === "swing") handleSwingExpand();
    else if (activeTab === "long") handleLongJump();
  };

  const current = data?.perspectives[activeTab];
  const meta = PERSPECTIVE_META[activeTab];

  return (
    <div
      className="px-3 py-2"
      style={{
        background: "linear-gradient(135deg, rgba(168,85,247,0.08) 0%, var(--bg-secondary) 70%)",
        borderBottom: "1px solid var(--border-color)",
      }}
    >
      {/* Tab 行 */}
      <div className="flex items-center gap-1 mb-1.5">
        <Sparkles size={11} style={{ color: "var(--accent-purple)" }} />
        <span
          className="font-bold mr-2"
          style={{ color: "var(--accent-purple)", fontSize: 9, letterSpacing: 1 }}
        >
          AI 三视角速读
        </span>
        {(["short", "swing", "long"] as PerspectiveTab[]).map((t) => {
          const m = PERSPECTIVE_META[t];
          const Icon = m.icon;
          const isActive = activeTab === t;
          return (
            <button
              key={t}
              onClick={() => { setActiveTab(t); setSwingExpanded(false); }}
              className="flex items-center gap-1 px-2 py-0.5 transition-all"
              style={{
                background: isActive ? m.color : "transparent",
                color: isActive ? "#fff" : "var(--text-secondary)",
                border: `1px solid ${isActive ? m.color : "var(--border-color)"}`,
                borderRadius: 3,
                fontSize: 10,
                fontWeight: isActive ? 700 : 500,
              }}
            >
              <Icon size={10} />
              {m.label}
            </button>
          );
        })}
        <button
          onClick={() => fetchAll(true)}
          disabled={loading}
          className="ml-auto p-0.5 transition-opacity hover:opacity-70"
          title="刷新三视角速读"
          style={{ color: "var(--text-muted)" }}
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* 当前 tab 内容 */}
      {loading && !data ? (
        <div style={{ color: "var(--text-muted)", fontSize: 11, fontStyle: "italic" }}>
          AI 正在生成三视角速读… (首次约 5s)
        </div>
      ) : err ? (
        <div className="flex items-center justify-between" style={{ color: "var(--text-muted)", fontSize: 11 }}>
          <span>AI 速读暂不可用 ({err})</span>
          <button onClick={() => fetchAll()} style={{ color: "var(--accent-blue)", fontSize: 11 }}>
            重试
          </button>
        </div>
      ) : current ? (
        <>
          <button
            onClick={handleExpand}
            className="w-full text-left flex items-start gap-1.5 group"
            style={{ color: "var(--text-primary)" }}
            title={
              activeTab === "short" ? "点击查看完整解读 (驱动/卡位/高度/明日策略)"
              : activeTab === "swing" ? "点击展开波段详细 (驱动/风险)"
              : "点击跳转中长视角页 (财务/估值/一致预期)"
            }
          >
            <span
              className="flex items-center justify-center flex-shrink-0 mt-0.5 font-bold"
              style={{
                background: STANCE_COLOR[current.stance] || "var(--text-secondary)",
                color: "#fff",
                width: 26,
                height: 14,
                fontSize: 9,
                borderRadius: 2,
              }}
              title={`立场: ${STANCE_LABEL[current.stance] || current.stance}`}
            >
              {STANCE_LABEL[current.stance] || current.stance}
            </span>
            <span
              className="flex-1 font-bold leading-snug"
              style={{ fontSize: "var(--font-md)", lineHeight: 1.45 }}
            >
              {current.headline}
            </span>
            <ChevronRight
              size={12}
              className="flex-shrink-0 mt-0.5 transition-transform group-hover:translate-x-0.5"
              style={{ color: meta.color }}
            />
          </button>

          {/* 时间维度提示 */}
          <div className="flex items-center gap-2 mt-1" style={{ fontSize: 9, color: "var(--text-muted)" }}>
            <span>视角周期: {meta.horizon}</span>
            {current.evidence && current.evidence.length > 0 && (
              <span>· 关键证据 {current.evidence.length} 条</span>
            )}
            {getCacheMeta(data) && (
              <span className="ml-auto">
                <CacheMetaBadge meta={getCacheMeta(data)} />
              </span>
            )}
          </div>

          {/* 波段视角的 inline 展开 */}
          {activeTab === "swing" && swingExpanded && (
            <div
              className="mt-2 p-2"
              style={{
                background: "rgba(59,130,246,0.06)",
                border: "1px solid rgba(59,130,246,0.24)",
                borderRadius: 4,
              }}
            >
              {swingLoading ? (
                <div style={{ color: "var(--text-muted)", fontSize: 11 }}>波段详细加载中…</div>
              ) : swingDetail ? (
                <>
                  <div className="text-xs mb-1.5" style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {swingDetail.headline}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="font-bold" style={{ color: "var(--accent-red)", fontSize: 10 }}>驱动</div>
                      <ul className="mt-0.5 space-y-0.5" style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                        {swingDetail.drivers.slice(0, 3).map((d, i) => (
                          <li key={i}>· {d}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="font-bold" style={{ color: "var(--accent-green)", fontSize: 10 }}>风险</div>
                      <ul className="mt-0.5 space-y-0.5" style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                        {swingDetail.risks.slice(0, 3).map((d, i) => (
                          <li key={i}>· {d}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="mt-1.5 text-xs flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                    <span>建议持有: {swingDetail.time_horizon}</span>
                    {getCacheMeta(swingDetail) && (
                      <span className="ml-auto">
                        <CacheMetaBadge meta={getCacheMeta(swingDetail)} />
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ color: "var(--text-muted)", fontSize: 11 }}>波段详细暂不可用</div>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
