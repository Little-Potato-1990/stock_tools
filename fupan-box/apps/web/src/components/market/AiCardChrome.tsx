"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { History, Sparkles, ChevronDown } from "lucide-react";
import { FeedbackThumbs, FeedbackKind } from "./FeedbackThumbs";
import { CacheMetaBadge, type CacheMeta } from "./CacheMetaBadge";

/**
 * 5+ 张 AI 卡片共用的"骨架件" — loading / error / footer feedback 三个最重的样板.
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
  /** 后端 brief.__cache_meta__; 传入即自动渲染"X分钟前预热"徽章 */
  cacheMeta?: CacheMeta | null;
  /**
   * #11 事后回看: 传入此回调即在 footer 渲染"历史"下拉 (今日/前1日/前3日/前7日/前30日).
   * 父组件接收 isoDate 字符串后自行重新拉取, 并把新的 trade_date 回填到 brief.
   */
  onPickDate?: (isoDate: string) => void;
}

/** 从 today 起向回数 N 个日历天的 ISO 日期 (粗糙: 不跳过周末/节假日, 只是粗筛, 后端会按"最近交易日"再 resolve). */
function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const HISTORY_OPTIONS: Array<{ label: string; iso: string }> = [
  { label: "今日", iso: offsetDate(0) },
  { label: "昨日", iso: offsetDate(1) },
  { label: "前 3 日", iso: offsetDate(3) },
  { label: "前 7 日", iso: offsetDate(7) },
  { label: "前 30 日", iso: offsetDate(30) },
];

export function HistoryPicker({
  current,
  onPick,
}: {
  current?: string;
  onPick: (iso: string) => void;
}) {
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

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 transition-opacity hover:opacity-80"
        style={{
          padding: "1px 6px",
          background: "var(--bg-tertiary)",
          color: "var(--text-muted)",
          border: "1px solid var(--border-color)",
          borderRadius: 3,
          fontSize: 10,
        }}
        title="看这张 AI 卡过去几天的版本 (事后回看)"
      >
        <History size={10} />
        历史
        <ChevronDown size={9} />
      </button>
      {open && (
        <div
          className="absolute z-50"
          style={{
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 120,
            padding: 4,
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          {HISTORY_OPTIONS.map((opt) => {
            const isCurrent = current === opt.iso;
            return (
              <button
                key={opt.iso}
                onClick={() => {
                  onPick(opt.iso);
                  setOpen(false);
                }}
                className="w-full text-left px-2 py-1 rounded transition-colors hover:bg-white/5"
                style={{
                  fontSize: 11,
                  color: isCurrent ? "var(--accent-purple)" : "var(--text-secondary)",
                  fontWeight: isCurrent ? 700 : 500,
                }}
              >
                <span>{opt.label}</span>
                <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 10 }}>
                  {opt.iso.slice(5)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AiCardFooter({
  kind,
  tradeDate,
  model,
  snapshot,
  extra,
  cacheMeta,
  onPickDate,
}: FooterProps) {
  return (
    <div
      className="mt-2 pt-2 flex items-center gap-2 flex-wrap"
      style={{ borderTop: "1px dashed var(--border-color)" }}
    >
      <FeedbackThumbs kind={kind} tradeDate={tradeDate} model={model} snapshot={snapshot} />
      {cacheMeta ? <CacheMetaBadge meta={cacheMeta} /> : null}
      {onPickDate ? (
        <span className="ml-auto inline-flex items-center gap-1.5">
          {extra}
          <HistoryPicker current={tradeDate} onPick={onPickDate} />
        </span>
      ) : extra ? (
        <span className="ml-auto">{extra}</span>
      ) : null}
    </div>
  );
}
