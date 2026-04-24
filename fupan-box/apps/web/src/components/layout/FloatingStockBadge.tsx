"use client";

import { useUIStore } from "@/stores/ui-store";
import { Bot, Zap, Scale } from "lucide-react";

/**
 * 右下角浮层堆栈 (从下往上, 间距 48px):
 *   - 🤖 Ai 副驾  (16px)   永远显示, 由本组件管理
 *   - 🔔 异动     (64px)   永远显示, 由 AnomalyBell 组件管理
 *   - ⚡ 为什么涨 (112px)  仅 focused 时显示
 *   - ⚖️ 辩论    (160px)  仅 focused 时显示
 *   - 股票徽章    (208px)  仅 focused 时显示
 *
 * 任意右侧抽屉/弹层展开时隐藏浮层避免遮挡。
 */
export function FloatingStockBadge() {
  const focused = useUIStore((s) => s.focusedStock);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const openWhyRose = useUIStore((s) => s.openWhyRose);
  const openDebate = useUIStore((s) => s.openDebate);
  const aiOpen = useUIStore((s) => s.aiPanelOpen);
  const toggleAi = useUIStore((s) => s.toggleAiPanel);
  const stockDrawerOpen = useUIStore((s) => !!s.stockDetailCode);
  const themeDrawerOpen = useUIStore((s) => !!s.themeDetailName);
  const whyRoseOpen = useUIStore((s) => !!s.whyRoseStock);
  const debateOpen = useUIStore((s) => !!s.debateTopic);

  const anyDrawerOpen =
    aiOpen || stockDrawerOpen || themeDrawerOpen || whyRoseOpen || debateOpen;
  if (anyDrawerOpen) return null;

  return (
    <>
      {focused && (
        <>
          <button
            className="floating-stock-chip"
            onClick={() => openStockDetail(focused.code, focused.name)}
            title={`查看 ${focused.code} 行情`}
          >
            <span>{focused.code}</span>
            <span className="label">行情</span>
          </button>
          <button
            onClick={() =>
              openDebate("stock", focused.code, focused.name || focused.code)
            }
            className="floating-debate-btn"
            title={`AI 多空辩论 ${focused.code}`}
          >
            <span className="inline-flex items-center gap-1">
              <Scale size={11} /> 辩论
            </span>
          </button>
          <button
            onClick={() => openWhyRose(focused.code, focused.name)}
            className="floating-whyrose-btn"
            title={`AI 解读 ${focused.code} 为什么涨/跌`}
          >
            <span className="inline-flex items-center gap-1">
              <Zap size={11} /> 为什么涨
            </span>
          </button>
        </>
      )}
      <button
        onClick={toggleAi}
        className="floating-ai-btn"
        title="打开 AI 副驾"
      >
        <span className="inline-flex items-center gap-1">
          <Bot size={12} /> Ai
        </span>
      </button>
    </>
  );
}
