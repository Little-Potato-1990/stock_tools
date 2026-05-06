"use client";

import { useUIStore } from "@/stores/ui-store";
import { Bot } from "lucide-react";

/**
 * 右下角浮层堆栈:
 *   - 🤖 Ai 副驾  (16px)   永远显示, 由本组件管理
 *   - 🔔 异动     (64px)   永远显示, 由 AnomalyBell 组件管理
 *
 * 任意右侧抽屉/弹层展开时隐藏浮层避免遮挡。
 */
export function FloatingStockBadge() {
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
