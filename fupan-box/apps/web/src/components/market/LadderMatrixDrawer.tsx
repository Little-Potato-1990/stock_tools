"use client";

import { useEffect } from "react";
import { X, Layers } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { LadderMatrix } from "./LadderMatrix";

export function LadderMatrixDrawer() {
  const open = useUIStore((s) => s.ladderMatrixOpen);
  const close = useUIStore((s) => s.closeLadderMatrix);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.5)" }}
        onClick={close}
      />
      <div
        className="fixed top-0 right-0 z-50 h-full overflow-y-auto flex flex-col"
        style={{
          width: "min(90vw, 1600px)",
          minWidth: 1100,
          background: "var(--bg-primary)",
          borderLeft: "1px solid var(--border-color)",
          boxShadow: "-4px 0 16px rgba(0,0,0,0.4)",
        }}
      >
        <div
          className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between flex-shrink-0"
          style={{
            background: "var(--bg-secondary)",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Layers size={16} style={{ color: "var(--accent-orange)" }} />
            <span
              className="font-bold"
              style={{ color: "var(--text-primary)", fontSize: "var(--font-lg)" }}
            >
              连板矩阵 · 多日追踪
            </span>
            <span
              style={{
                color: "var(--text-muted)",
                fontSize: 11,
                marginLeft: 4,
              }}
            >
              默认 7 天 · 向左滚动加载更早
            </span>
          </div>
          <button
            onClick={close}
            className="p-1 rounded transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            title="关闭 (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0">
          <LadderMatrix />
        </div>
      </div>
    </>
  );
}
