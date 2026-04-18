"use client";

import { useUIStore } from "@/stores/ui-store";
import { Bot } from "lucide-react";

/**
 * 急速复盘风格的右下角浮层：
 *   - 当前关注股票徽章 (红色背景 + 代码 + "行情") — 点击重新打开行情抽屉
 *   - 紫色 AI 入口 — 点击打开 AI 副驾抽屉
 *
 * 当任意右侧抽屉 (行情/题材/AI) 已经展开时, 隐藏浮层避免遮挡。
 */
export function FloatingStockBadge() {
  const focused = useUIStore((s) => s.focusedStock);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const aiOpen = useUIStore((s) => s.aiPanelOpen);
  const toggleAi = useUIStore((s) => s.toggleAiPanel);
  const stockDrawerOpen = useUIStore((s) => !!s.stockDetailCode);
  const themeDrawerOpen = useUIStore((s) => !!s.themeDetailName);

  // 任何右侧抽屉打开时, 隐藏浮层
  const anyDrawerOpen = aiOpen || stockDrawerOpen || themeDrawerOpen;
  if (anyDrawerOpen) return null;

  return (
    <>
      {focused && (
        <button
          className="floating-stock-chip"
          onClick={() => openStockDetail(focused.code, focused.name)}
          title={`查看 ${focused.code} 行情`}
        >
          <span>{focused.code}</span>
          <span className="label">行情</span>
        </button>
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
