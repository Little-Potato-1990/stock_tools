"use client";

import { MessageSquare } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";

interface Props {
  /** "追问 AI" 点击时预填到 AI 副驾的问题 */
  askPrompt: string;
  /** 强调色 (默认紫色) */
  accent?: string;
}

/**
 * 统一的 AI 卡片操作按钮: 追问 AI.
 * - "追问 AI": 预填用户问题, 直接打开 AI 副驾.
 */
export function AiActionBar({
  askPrompt,
  accent,
}: Props) {
  const askAI = useUIStore((s) => s.askAI);
  const acc = accent ?? "var(--accent-purple)";

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => askAI(askPrompt, undefined, "卡片上下文")}
        title="基于这张卡, 进一步追问 AI"
        className="inline-flex items-center gap-1 transition-colors"
        style={{
          padding: "2px 7px",
          background: acc,
          color: "#fff",
          border: "none",
          borderRadius: 3,
          fontSize: 10,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        <MessageSquare size={10} />
        追问 AI
      </button>
    </div>
  );
}
