"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export type HeadlineKind = "today" | "sentiment" | "theme" | "ladder" | "lhb";

export interface StreamingHeadline {
  /** 实时文本 (可能不完整) */
  text: string;
  isStreaming: boolean;
  error: string | null;
  /** 当前是否处于"已用流式覆盖原 headline"状态 */
  hasOverride: boolean;
  /** 触发一次 stream */
  start: () => Promise<void>;
  /** 撤销 override, 恢复原 headline */
  reset: () => void;
}

/**
 * 5 张 AI 卡片通用 — 调 /api/ai/brief/headline-stream 获取打字机效果.
 * 设计:
 * - 不替换原有的 cached brief, 仅作为"重新生成 headline"的覆盖层
 * - reset() 清空覆盖, 卡片回到原来的 cached headline
 * - AbortController 处理组件卸载/重复点击
 */
export function useStreamingHeadline(
  kind: HeadlineKind,
  tradeDate?: string,
  modelId: string = "deepseek-v3",
): StreamingHeadline {
  const [text, setText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasOverride, setHasOverride] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      ctrlRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setText("");
    setError(null);
    setIsStreaming(false);
    setHasOverride(false);
  }, []);

  const start = useCallback(async () => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setText("");
    setError(null);
    setIsStreaming(true);
    setHasOverride(true);

    try {
      const params = new URLSearchParams({ kind, model: modelId });
      if (tradeDate) params.set("trade_date", tradeDate);
      const res = await fetch(
        `${API_BASE}/api/ai/brief/headline-stream?${params.toString()}`,
        { signal: ctrl.signal, credentials: "include" },
      );
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      // SSE: 分段以 \n\n 结尾, 每段以 "data: " 开头
      // 注意: token 可能跨 chunk, 用 buffer 累积
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() || "";
        for (const ev of events) {
          if (!ev.startsWith("data:")) continue;
          const raw = ev.slice(5).trimStart();
          let payload: { token?: string; done?: boolean; full_text?: string; error?: string; fallback?: string };
          try {
            payload = JSON.parse(raw);
          } catch {
            continue;
          }
          if (payload.error) {
            setError(payload.error);
            if (payload.fallback) {
              setText(payload.fallback);
            }
            continue;
          }
          if (payload.token) {
            setText((t) => t + payload.token);
          }
          if (payload.done && payload.full_text) {
            // 用最终版替换, 避免中间出现 strip 前的引号
            setText(payload.full_text);
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return;
      }
      setError(e instanceof Error ? e.message : "stream failed");
    } finally {
      setIsStreaming(false);
    }
  }, [kind, tradeDate, modelId]);

  return { text, isStreaming, error, hasOverride, start, reset };
}
