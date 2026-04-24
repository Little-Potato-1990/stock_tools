"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";

const POLL_MS = 60_000; // 60s 轮询

/**
 * 右下角浮动「盘中异动」入口.
 *
 * 位置: 跟 floating-ai-btn 同一列, 在它正上方 (bottom: 64px).
 * 避让: 任意右侧抽屉/弹层打开时隐藏 (与 FloatingStockBadge 一致),
 *       否则 AiPanel/StockDrawer 滑入时会盖住铃铛.
 */
export function AnomalyBell() {
  const [count, setCount] = useState(0);
  const openDrawer = useUIStore((s) => s.openAnomalyDrawer);

  const aiOpen = useUIStore((s) => s.aiPanelOpen);
  const stockDrawerOpen = useUIStore((s) => !!s.stockDetailCode);
  const themeDrawerOpen = useUIStore((s) => !!s.themeDetailName);
  const whyRoseOpen = useUIStore((s) => !!s.whyRoseStock);
  const debateOpen = useUIStore((s) => !!s.debateTopic);
  const anomalyDrawerOpen = useUIStore((s) => s.anomalyDrawerOpen);

  const refresh = useCallback(async () => {
    try {
      const d = await api.getAnomalyUnseenCount();
      setCount(d.unseen || 0);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // refresh 内部走的是 fetch -> await -> setState, setState 并非同步发生在 effect body
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const anyDrawerOpen =
    aiOpen ||
    stockDrawerOpen ||
    themeDrawerOpen ||
    whyRoseOpen ||
    debateOpen ||
    anomalyDrawerOpen;
  if (anyDrawerOpen) return null;

  return (
    <button
      onClick={openDrawer}
      title="盘中异动"
      className="fixed flex items-center justify-center w-10 h-10 rounded-full transition-all"
      style={{
        right: 16,
        bottom: 64,
        zIndex: 35,
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-color)",
        boxShadow:
          count > 0
            ? "0 0 12px rgba(255, 99, 99, 0.5)"
            : "0 1px 4px rgba(0,0,0,0.2)",
      }}
    >
      <Bell size={18} style={{ color: count > 0 ? "#ff6363" : "var(--text-secondary)" }} />
      {count > 0 && (
        <span
          className="absolute -top-1 -right-1 flex items-center justify-center text-white font-bold rounded-full"
          style={{
            background: "#ff3838",
            minWidth: 18,
            height: 18,
            fontSize: 10,
            padding: "0 4px",
            boxShadow: "0 0 0 2px var(--bg-primary)",
          }}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
