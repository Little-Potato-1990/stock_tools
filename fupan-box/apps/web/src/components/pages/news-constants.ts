export type NewsHorizon = "short" | "swing" | "long" | "mixed";

export const HORIZON_META: Record<NewsHorizon, { label: string; color: string; desc: string }> = {
  short: { label: "短线", color: "var(--accent-orange)", desc: "1-5 日盘面催化" },
  swing: { label: "波段", color: "var(--accent-blue)", desc: "5-20 日驱动" },
  long: { label: "长线", color: "var(--accent-purple)", desc: "6 月+ 产业逻辑" },
  mixed: { label: "复合", color: "var(--text-secondary)", desc: "多时间维度" },
};
