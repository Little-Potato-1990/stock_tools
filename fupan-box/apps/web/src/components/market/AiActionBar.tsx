"use client";

import { HelpCircle, MessageSquare } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { EvidenceBadge } from "./EvidenceBadge";

interface Props {
  /** 卡片的核心结论 (用于"为什么"按钮 — AI 解释自己的判断依据) */
  summary: string;
  /** 卡片背后的引用证据 (传给 EvidenceBadge 显示原文/数据点) */
  evidence?: string[];
  /** "追问 AI" 点击时预填到 AI 副驾的问题 */
  askPrompt: string;
  /** 强调色 (默认紫色) */
  accent?: string;
  /** 显式给 EvidenceBadge 一个标签 */
  evidenceLabel?: string;
}

/**
 * 统一的 AI 卡片底部 3 按钮组: 为什么 / 看证据 / 追问 AI.
 *
 * - "为什么": 把 summary 转成"请详细解释你为何...", 推到 AI 副驾.
 * - "看证据": 复用现有 EvidenceBadge, 不存在 evidence 时不渲染该按钮.
 * - "追问 AI": 预填用户问题, 直接打开 AI 副驾.
 *
 * 所有 AI 卡都建议挂这个组件, 信息密度统一, 用户操作路径一致.
 */
export function AiActionBar({
  summary,
  evidence,
  askPrompt,
  accent,
  evidenceLabel = "证据",
}: Props) {
  const askAI = useUIStore((s) => s.askAI);
  const acc = accent ?? "var(--accent-purple)";

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() =>
          askAI(`请详细解释你为何这样判断:「${summary}」, 给出具体数字、对比和推理过程。`)
        }
        title="让 AI 解释判断依据"
        className="inline-flex items-center gap-1 transition-colors"
        style={{
          padding: "2px 7px",
          background: "transparent",
          color: acc,
          border: `1px solid ${acc}55`,
          borderRadius: 3,
          fontSize: 10,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        <HelpCircle size={10} />
        为什么
      </button>

      {evidence && evidence.length > 0 && (
        <EvidenceBadge evidence={evidence} accent={acc} label={evidenceLabel} />
      )}

      <button
        onClick={() => askAI(askPrompt)}
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
