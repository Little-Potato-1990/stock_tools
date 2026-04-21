/**
 * 通用格式化工具 — 统一散落在 LhbAiCard / LhbEvidenceGrid / LhbPage / *EvidenceGrid
 * 中各自重复的金额 / 百分比 / 颜色助手.
 */

/**
 * 把金额转为 "亿/万" 短格式 — 仅在负数加 "-", 正数无前缀.
 * 用于"展示当前金额"等中性场景 (LhbEvidenceGrid 仪表盘数字).
 */
export function fmtAmount(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${sign}${(a / 1e4).toFixed(0)}万`;
  return `${sign}${a.toFixed(0)}`;
}

/**
 * 强制 +/- 前缀的金额 — 用于"净买入 / 增量"等需要明确方向的场景.
 * (LhbAiCard.key_offices/key_stocks, LhbPage.LhbDailyTab 净买入栏)
 */
export function fmtSignedAmount(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${sign}${(a / 1e4).toFixed(0)}万`;
  return `${sign}${a.toFixed(0)}`;
}

/**
 * Delta 金额 (强制 +/-, 单位精度更粗一档) — 用于 dial 的"较昨日"增量.
 */
export function fmtDeltaAmount(v: number): string {
  const a = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(1)}亿`;
  if (a >= 1e4) return `${sign}${(a / 1e4).toFixed(0)}万`;
  return `${sign}${a.toFixed(0)}`;
}

/**
 * 拆成 数字 + 单位 — 用于大字号 dial 数字 / 单位 不同字号渲染.
 */
export function fmtAmountParts(v: number): { value: string; unit: string } {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e8) return { value: `${sign}${(a / 1e8).toFixed(2)}`, unit: "亿" };
  if (a >= 1e4) return { value: `${sign}${(a / 1e4).toFixed(0)}`, unit: "万" };
  return { value: `${sign}${a.toFixed(0)}`, unit: "" };
}

/** 涨跌幅: "+1.50%" / "-2.30%" */
export function fmtPctChange(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/** 占比 / 比率: "1.5%" — 不带符号 */
export function fmtAmountRate(rate: number): string {
  return `${rate.toFixed(1)}%`;
}

export type TrendDir = "up" | "down" | "flat";

/**
 * trend → A 股涨绿跌红配色.
 * 注意: 与"积极/消极"语义无关, 仅基于数字大小变化方向.
 * (积极/消极语义在 EvidenceCard.colorOf 中按 spec.positive 分别处理)
 */
export function colorFromTrend(trend: TrendDir): string {
  if (trend === "up") return "var(--accent-red)";
  if (trend === "down") return "var(--accent-green)";
  return "var(--text-muted)";
}
