"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Layers, Check, ChevronDown } from "lucide-react";
import { useUniverseStore, UNIVERSE_OPTIONS, type Universe } from "@/stores/universe-store";

export function UniverseSwitcher() {
  const universe = useUniverseStore((s) => s.universe);
  const setUniverse = useUniverseStore((s) => s.setUniverse);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = UNIVERSE_OPTIONS.find((o) => o.value === universe) ?? UNIVERSE_OPTIONS[0];

  const onPick = useCallback(
    (u: Universe) => {
      setUniverse(u);
      setOpen(false);
    },
    [setUniverse],
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative w-full" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 rounded border transition-colors hover:opacity-90"
        style={{
          padding: "4px 8px",
          background: "rgba(255,255,255,0.05)",
          borderColor: "var(--border-color)",
          color: "var(--text-secondary)",
          fontSize: 10,
          fontWeight: 600,
        }}
        title="切换标的池 (universe)"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Layers size={12} className="shrink-0 opacity-80" />
        <span className="flex-1 truncate text-left" style={{ color: "var(--text-primary)" }}>
          {current.label}
        </span>
        <ChevronDown
          size={12}
          className="shrink-0 opacity-60"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s" }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 z-[200] mt-1 rounded border shadow-lg overflow-hidden"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border-color)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            maxHeight: "min(70vh, 360px)",
            overflowY: "auto",
          }}
          role="listbox"
        >
          {UNIVERSE_OPTIONS.map((opt, i) => {
            const selected = opt.value === universe;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onPick(opt.value)}
                className="w-full text-left flex gap-2 px-2.5 py-2 transition-colors"
                style={{
                  background: selected ? "rgba(139,92,246,0.12)" : "transparent",
                  borderBottom: i < UNIVERSE_OPTIONS.length - 1 ? "1px solid var(--border-color)" : "none",
                  color: "var(--text-primary)",
                }}
                onMouseEnter={(e) => {
                  if (!selected) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (!selected) e.currentTarget.style.background = "transparent";
                }}
              >
                <span className="shrink-0 pt-0.5" style={{ width: 14, color: "var(--accent-purple)" }}>
                  {selected ? <Check size={12} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <div className="font-bold" style={{ fontSize: 11 }}>
                    {opt.label}
                  </div>
                  <div className="text-[9px] leading-snug mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {opt.hint}
                  </div>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
