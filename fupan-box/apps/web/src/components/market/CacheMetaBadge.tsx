"use client";

import { useMemo } from "react";
import { Clock, Zap } from "lucide-react";

/**
 * 预热时间胶囊 — 读 brief.__cache_meta__.generated_at, 显示 "X 分钟前预热".
 *
 * prewarm 路径: source="prewarm" 用闪电图标; ondemand / 兜底用时钟图标.
 */

type CacheMeta = {
  generated_at?: string | null;
  expires_at?: string | null;
  source?: string | null;
  hit_count?: number;
  cache_key?: string;
};

export function CacheMetaBadge({
  meta,
  size = "xs",
}: {
  meta?: CacheMeta | null;
  size?: "xs" | "sm";
}) {
  const label = useMemo(() => {
    if (!meta?.generated_at) return null;
    const t = new Date(meta.generated_at);
    const now = Date.now();
    const diff = Math.max(0, now - t.getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    return `${days} 天前`;
  }, [meta?.generated_at]);

  if (!label) return null;

  const isPrewarm = meta?.source === "prewarm";
  const Icon = isPrewarm ? Zap : Clock;
  const title = isPrewarm
    ? `盘后预热生成 · ${meta?.generated_at ?? ""}`
    : `点击时生成 · ${meta?.generated_at ?? ""}`;

  const fontSize = size === "xs" ? "10px" : "12px";

  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px]"
      style={{
        fontSize,
        color: isPrewarm ? "var(--accent-purple, #7c3aed)" : "var(--text-muted)",
        background: isPrewarm
          ? "rgba(124, 58, 237, 0.08)"
          : "var(--bg-tertiary, rgba(0,0,0,0.04))",
        lineHeight: 1.4,
      }}
    >
      <Icon size={size === "xs" ? 10 : 12} />
      <span>{label}</span>
    </span>
  );
}

export type { CacheMeta };

/**
 * 安全提取 brief / response 上的 __cache_meta__ 字段, 替代 11 处复制粘贴的
 *   `(data as { __cache_meta__?: CacheMeta }).__cache_meta__`
 */
export function getCacheMeta(obj: unknown): CacheMeta | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const meta = (obj as { __cache_meta__?: unknown }).__cache_meta__;
  return meta as CacheMeta | undefined;
}
