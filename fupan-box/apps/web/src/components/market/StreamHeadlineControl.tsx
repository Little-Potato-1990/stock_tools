"use client";

import { Loader2, RotateCcw, Zap } from "lucide-react";

interface Props {
  isStreaming: boolean;
  hasOverride: boolean;
  onStart: () => void;
  onReset: () => void;
  size?: number;
  accent?: string;
  /** hover 提示, 默认 "流式重新生成 headline" */
  title?: string;
}

/** 5 张 AI 卡片复用的 "▶ 流式重新生成 / ↺ 撤销" 二态按钮组. */
export function StreamHeadlineControl({
  isStreaming,
  hasOverride,
  onStart,
  onReset,
  size = 11,
  accent = "var(--accent-purple)",
  title = "流式重新生成",
}: Props) {
  if (isStreaming) {
    return (
      <span
        className="inline-flex items-center gap-1"
        style={{ color: accent, fontSize: 10 }}
        title="生成中…"
      >
        <Loader2 size={size} className="animate-spin" />
      </span>
    );
  }

  if (hasOverride) {
    return (
      <button
        onClick={onReset}
        className="p-1 transition-opacity hover:opacity-70"
        title="撤销 — 恢复缓存版"
        style={{ color: "var(--text-muted)" }}
      >
        <RotateCcw size={size} />
      </button>
    );
  }

  return (
    <button
      onClick={onStart}
      className="p-1 transition-opacity hover:opacity-70"
      title={title}
      style={{ color: accent }}
    >
      <Zap size={size} />
    </button>
  );
}
