"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, CheckCheck, X } from "lucide-react";
import { api } from "@/lib/api";

export type FeedbackKind = "today" | "sentiment" | "theme" | "ladder" | "lhb";

interface Props {
  kind: FeedbackKind;
  tradeDate?: string;
  model?: string;
  /** 反馈瞬间的卡片快照, 后端会原样存到 jsonb */
  snapshot?: Record<string, unknown>;
  /** 是否启用 evidence 真实性回检按钮 (默认 true) */
  showEvidenceCheck?: boolean;
}

type State = "idle" | "submitting" | "ok" | "error";

/**
 * 通用反馈条 - 5 张 AI 卡片复用.
 * 设计:
 * - 默认极简: 只显示 👍 / 👎
 * - 用户点 👎 后展开理由输入框 + evidence 校验按钮 (有用/有错)
 * - 单次提交后转入只读"已记录"状态, 不再二次提交
 */
export function FeedbackThumbs({
  kind,
  tradeDate,
  model,
  snapshot,
  showEvidenceCheck = true,
}: Props) {
  const [state, setState] = useState<State>("idle");
  const [picked, setPicked] = useState<1 | -1 | null>(null);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const [evidenceCorrect, setEvidenceCorrect] = useState<boolean | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const submit = async (
    rating: 1 | -1,
    extra?: { reason?: string; evidence_correct?: boolean | null },
  ) => {
    if (!tradeDate) {
      setErrMsg("缺少 trade_date");
      return;
    }
    setState("submitting");
    setErrMsg(null);
    try {
      await api.postFeedback({
        brief_kind: kind,
        trade_date: tradeDate,
        rating,
        model: model || null,
        reason: extra?.reason ?? reason ?? null,
        evidence_correct: extra?.evidence_correct ?? evidenceCorrect ?? null,
        snapshot: snapshot ?? null,
      });
      setState("ok");
    } catch (e) {
      setState("error");
      setErrMsg(e instanceof Error ? e.message : "submit failed");
    }
  };

  if (state === "ok") {
    return (
      <span
        className="inline-flex items-center gap-1"
        style={{ fontSize: 10, color: "var(--accent-green)" }}
      >
        <CheckCheck size={11} />
        已记录反馈
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1" style={{ fontSize: 10 }}>
      <span style={{ color: "var(--text-muted)" }}>这条 AI 判断:</span>
      <button
        disabled={state === "submitting"}
        onClick={() => {
          setPicked(1);
          submit(1);
        }}
        title="觉得有用"
        className="p-1 rounded transition-opacity hover:opacity-80"
        style={{
          background: picked === 1 ? "var(--accent-green)" : "transparent",
          color: picked === 1 ? "#fff" : "var(--text-muted)",
        }}
      >
        <ThumbsUp size={11} />
      </button>
      <button
        disabled={state === "submitting"}
        onClick={() => {
          setPicked(-1);
          setShowReason(true);
        }}
        title="觉得不准, 给个理由"
        className="p-1 rounded transition-opacity hover:opacity-80"
        style={{
          background: picked === -1 ? "var(--accent-red)" : "transparent",
          color: picked === -1 ? "#fff" : "var(--text-muted)",
        }}
      >
        <ThumbsDown size={11} />
      </button>
      {showReason && picked === -1 && (
        <span className="inline-flex items-center gap-1 ml-1">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="哪里不准?  (可选)"
            maxLength={120}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              borderRadius: 3,
              padding: "1px 6px",
              fontSize: 10,
              color: "var(--text-primary)",
              width: 140,
            }}
          />
          {showEvidenceCheck && (
            <>
              <button
                onClick={() => setEvidenceCorrect(false)}
                title="证据本身就不真实"
                className="p-1 rounded transition-opacity hover:opacity-80"
                style={{
                  background: evidenceCorrect === false ? "var(--accent-orange)" : "transparent",
                  color: evidenceCorrect === false ? "#fff" : "var(--text-muted)",
                  fontSize: 9,
                }}
              >
                证据有错
              </button>
              <button
                onClick={() => setEvidenceCorrect(true)}
                title="证据没问题, 只是结论不对"
                className="p-1 rounded transition-opacity hover:opacity-80"
                style={{
                  background: evidenceCorrect === true ? "var(--accent-blue)" : "transparent",
                  color: evidenceCorrect === true ? "#fff" : "var(--text-muted)",
                  fontSize: 9,
                }}
              >
                证据没错
              </button>
            </>
          )}
          <button
            onClick={() => submit(-1, { reason, evidence_correct: evidenceCorrect })}
            disabled={state === "submitting"}
            className="px-1.5 py-0.5 rounded font-bold transition-opacity hover:opacity-80"
            style={{
              background: "var(--accent-red)",
              color: "#fff",
              fontSize: 10,
              border: "none",
            }}
          >
            提交
          </button>
          <button
            onClick={() => {
              setShowReason(false);
              setPicked(null);
              setReason("");
              setEvidenceCorrect(null);
            }}
            className="p-0.5 transition-opacity hover:opacity-80"
            style={{ color: "var(--text-muted)" }}
            title="取消"
          >
            <X size={10} />
          </button>
        </span>
      )}
      {state === "error" && errMsg && (
        <span style={{ color: "var(--accent-red)", marginLeft: 4 }}>
          {errMsg}
        </span>
      )}
    </span>
  );
}
