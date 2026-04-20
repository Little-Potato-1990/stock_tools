"use client";

/**
 * P2-3 证据链展示徽章.
 *
 * 每个 AI brief 的关键判断旁边挂一个 "看证据" 徽章, 点击/hover 弹出
 * 具体支撑数字. 让用户能一键追溯 AI 结论从哪来, 避免空话.
 *
 * 设计原则:
 * - 极小占位 (icon + 2 字), 不抢主视觉
 * - 点击展开, 弹在 button 下方, 再次点击或点外面关闭
 * - evidence 为空时整个组件不渲染, 不影响布局
 */

import { useEffect, useRef, useState } from "react";
import { BookOpen, X } from "lucide-react";

interface Props {
  evidence: string[] | undefined;
  /** 可选: tooltip 触发色 (默认 purple) */
  accent?: string;
  /** 可选: 尺寸 sm/md, 默认 sm */
  size?: "sm" | "md";
  /** 可选: 标签文字, 默认 "看证据" */
  label?: string;
}

export function EvidenceBadge({
  evidence,
  accent = "var(--accent-purple)",
  size = "sm",
  label = "看证据",
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!evidence || evidence.length === 0) return null;

  const sm = size === "sm";

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1 transition-opacity hover:opacity-80"
        title="展开 AI 判断的数字证据"
        style={{
          padding: sm ? "1px 6px" : "2px 8px",
          background: open ? accent : "transparent",
          color: open ? "#fff" : accent,
          border: `1px solid ${accent}`,
          borderRadius: 3,
          fontSize: sm ? 9 : 11,
          fontWeight: 700,
          lineHeight: sm ? "13px" : "15px",
          cursor: "pointer",
        }}
      >
        <BookOpen size={sm ? 9 : 11} />
        {label}
      </button>

      {open && (
        <div
          className="absolute z-50"
          style={{
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 240,
            maxWidth: 420,
            padding: "8px 10px",
            background: "var(--bg-card)",
            border: `1px solid ${accent}`,
            borderRadius: 4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
            fontSize: "var(--font-xs)",
            color: "var(--text-primary)",
          }}
        >
          <div
            className="flex items-center justify-between mb-1.5"
            style={{ fontWeight: 700, color: accent, fontSize: 10 }}
          >
            <span className="flex items-center gap-1">
              <BookOpen size={10} />
              AI 判断依据 (来自当日真实数字)
            </span>
            <button
              onClick={() => setOpen(false)}
              className="transition-opacity hover:opacity-70"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={10} />
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {evidence.map((e, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5"
                style={{ lineHeight: 1.45 }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    marginTop: 4,
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    background: accent,
                  }}
                />
                <span style={{ color: "var(--text-secondary)" }}>{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
