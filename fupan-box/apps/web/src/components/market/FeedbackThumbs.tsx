"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, CheckCheck, X } from "lucide-react";
import { api } from "@/lib/api";

export type FeedbackKind = "today" | "sentiment" | "theme" | "ladder" | "lhb" | "capital" | "institutional";

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
 * 设计 (v2 #12 chip 化):
 * - 默认极简: 只显示 👍 / 👎
 * - 用户点 👎 后展开"原因 chip" (一键即提交, 不强制写字)
 * - 单次提交后转入只读"已记录"状态, 不再二次提交
 */

const REASON_CHIPS: Array<{ label: string; reason: string; evidence_correct: boolean | null }> = [
  { label: "结论不准", reason: "结论不准", evidence_correct: true },
  { label: "数据有错", reason: "证据/数据有误", evidence_correct: false },
  { label: "太空泛", reason: "太空泛, 没具体信息量", evidence_correct: null },
  { label: "没新意", reason: "都是已知信息, 无增量", evidence_correct: null },
  { label: "跟我相反", reason: "与我判断相反", evidence_correct: null },
  { label: "其他", reason: "", evidence_correct: null },
];

export function FeedbackThumbs({
  kind,
  tradeDate,
  model,
  snapshot,
  showEvidenceCheck = true,
}: Props) {
  void showEvidenceCheck; // 兼容旧调用方; chip 化后不需要单独按钮
  const [state, setState] = useState<State>("idle");
  const [picked, setPicked] = useState<1 | -1 | null>(null);
  const [showChips, setShowChips] = useState(false);
  const [customReason, setCustomReason] = useState("");
  const [showCustom, setShowCustom] = useState(false);
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
      const res = (await api.postFeedback({
        brief_kind: kind,
        trade_date: tradeDate,
        rating,
        model: model || null,
        reason: extra?.reason ?? null,
        evidence_correct: extra?.evidence_correct ?? null,
        snapshot: snapshot ?? null,
      })) as { ok?: boolean; error?: string } | undefined;
      if (res && res.ok === false) {
        setState("error");
        setErrMsg(res.error || "submit failed");
        return;
      }
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
        谢谢, 反馈已记录
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 flex-wrap" style={{ fontSize: 10 }}>
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
          setShowChips(true);
        }}
        title="觉得不准"
        className="p-1 rounded transition-opacity hover:opacity-80"
        style={{
          background: picked === -1 ? "var(--accent-red)" : "transparent",
          color: picked === -1 ? "#fff" : "var(--text-muted)",
        }}
      >
        <ThumbsDown size={11} />
      </button>
      {showChips && picked === -1 && !showCustom && (
        <span className="inline-flex items-center gap-1 ml-1 flex-wrap">
          {REASON_CHIPS.map((c) => (
            <button
              key={c.label}
              onClick={() => {
                if (c.label === "其他") {
                  setShowCustom(true);
                  return;
                }
                submit(-1, { reason: c.reason, evidence_correct: c.evidence_correct });
              }}
              className="px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
              style={{
                fontSize: 10,
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-color)",
              }}
              title={`一键提交: ${c.reason || c.label}`}
            >
              {c.label}
            </button>
          ))}
          <button
            onClick={() => {
              setShowChips(false);
              setPicked(null);
            }}
            className="p-0.5 transition-opacity hover:opacity-80"
            style={{ color: "var(--text-muted)" }}
            title="取消"
          >
            <X size={10} />
          </button>
        </span>
      )}
      {showCustom && picked === -1 && (
        <span className="inline-flex items-center gap-1 ml-1">
          <input
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            placeholder="哪里不准? (可选)"
            maxLength={120}
            autoFocus
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              borderRadius: 3,
              padding: "1px 6px",
              fontSize: 10,
              color: "var(--text-primary)",
              width: 160,
            }}
          />
          <button
            onClick={() => submit(-1, { reason: customReason || "其他", evidence_correct: null })}
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
              setShowCustom(false);
              setShowChips(true);
              setCustomReason("");
            }}
            className="p-0.5 transition-opacity hover:opacity-80"
            style={{ color: "var(--text-muted)" }}
            title="返回"
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
