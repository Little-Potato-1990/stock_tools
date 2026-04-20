"use client";

import { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { FeedbackThumbs, FeedbackKind } from "./FeedbackThumbs";

/**
 * 5 张 AI 卡片共用的"骨架件" — loading / error / footer feedback 三个最重的样板.
 *
 * 每张卡的标题栏 + 正文各有差异 (颜色/icon/排版), 不强行抽,
 * 只把"100% 一致的"loading / error placeholder + feedback row 收敛在这里.
 */

export function AiCardLoading({ message = "AI 正在生成..." }: { message?: string }) {
  return (
    <div
      className="px-3 py-2 flex items-center gap-2"
      style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-color)",
        fontSize: "var(--font-sm)",
        color: "var(--text-muted)",
      }}
    >
      <Sparkles size={14} style={{ color: "var(--accent-purple)" }} />
      {message}
    </div>
  );
}

export function AiCardError({ error }: { error?: string | null }) {
  return (
    <div
      className="px-3 py-2"
      style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-color)",
        fontSize: "var(--font-sm)",
        color: "var(--accent-red)",
      }}
    >
      AI 旁白暂不可用 {error ? `(${error})` : ""}
    </div>
  );
}

interface FooterProps {
  kind: FeedbackKind;
  tradeDate?: string;
  model?: string;
  snapshot?: Record<string, unknown>;
  /** 额外提示信息, 比如"AI 命中率 / 数据来源", 可选 */
  extra?: ReactNode;
}

export function AiCardFooter({ kind, tradeDate, model, snapshot, extra }: FooterProps) {
  return (
    <div
      className="mt-2 pt-2 flex items-center gap-2"
      style={{ borderTop: "1px dashed var(--border-color)" }}
    >
      <FeedbackThumbs kind={kind} tradeDate={tradeDate} model={model} snapshot={snapshot} />
      {extra ? <span className="ml-auto">{extra}</span> : null}
    </div>
  );
}
