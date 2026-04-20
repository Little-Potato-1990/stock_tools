"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";

const POLL_MS = 60_000; // 60s 轮询

export function AnomalyBell() {
  const [count, setCount] = useState(0);
  const openDrawer = useUIStore((s) => s.openAnomalyDrawer);

  const refresh = useCallback(async () => {
    try {
      const d = await api.getAnomalyUnseenCount();
      setCount(d.unseen || 0);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <button
      onClick={openDrawer}
      title="盘中异动"
      className="fixed top-3 right-3 z-40 flex items-center justify-center w-10 h-10 rounded-full transition-all"
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-color)",
        boxShadow: count > 0 ? "0 0 12px rgba(255, 99, 99, 0.5)" : "0 1px 4px rgba(0,0,0,0.2)",
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
