/**
 * 色阶工具：把数值映射成"整格背景色 + 白字"的颜色配置。
 * 学急速复盘的视觉方法论：所有展示百分比/涨跌幅的单元格，
 * 不只是改文字色，而是整格背景色按数值深浅渐变。
 */

export type ColorScaleType =
  | "rate"          // 比率类 (上涨率/赚钱效应/晋级率) 0-1, 0.5 为中性
  | "change"        // 涨跌幅 -10~+10%, 0 为中性
  | "count_red"     // 数量类 红色系 (涨停/上涨/最高板)
  | "count_green"   // 数量类 绿色系 (跌停/下跌)
  | "count_orange"  // 数量类 橙色系 (炸板/大低开)
  | "neutral";      // 中性 (成交额等)

interface CellColor {
  background: string;
  color: string;
}

const RED_SCALE = [
  "var(--cell-red-1)",
  "var(--cell-red-2)",
  "var(--cell-red-3)",
  "var(--cell-red-4)",
  "var(--cell-red-5)",
];

const GREEN_SCALE = [
  "var(--cell-green-1)",
  "var(--cell-green-2)",
  "var(--cell-green-3)",
  "var(--cell-green-4)",
  "var(--cell-green-5)",
];

const NEUTRAL_BG = "var(--cell-neutral)";
const TEXT_WHITE = "#fff";
const TEXT_MUTED = "var(--text-muted)";

/**
 * 把 [0, max] 区间的值映射到 0-4 索引(色阶 5 档)
 */
function bucketIdx(value: number, max: number): number {
  const ratio = Math.min(Math.abs(value) / max, 1);
  return Math.min(Math.floor(ratio * 5), 4);
}

/**
 * 比率类色阶: 0-1 之间，0.5 为分界
 * - >= 0.5 红色系，越高越红
 * - < 0.5 绿色系，越低越绿
 */
function rateColor(value: number | null): CellColor {
  if (value == null) return { background: NEUTRAL_BG, color: TEXT_MUTED };
  if (value >= 0.5) {
    const idx = bucketIdx(value - 0.5, 0.5);
    return { background: RED_SCALE[idx], color: TEXT_WHITE };
  } else {
    const idx = bucketIdx(0.5 - value, 0.5);
    return { background: GREEN_SCALE[idx], color: TEXT_WHITE };
  }
}

/**
 * 涨跌幅色阶: -10% ~ +10%, 0 为分界
 */
function changeColor(value: number | null): CellColor {
  if (value == null) return { background: NEUTRAL_BG, color: TEXT_MUTED };
  if (value === 0) return { background: NEUTRAL_BG, color: TEXT_WHITE };
  if (value > 0) {
    const idx = bucketIdx(value, 10);
    return { background: RED_SCALE[idx], color: TEXT_WHITE };
  } else {
    const idx = bucketIdx(value, 10);
    return { background: GREEN_SCALE[idx], color: TEXT_WHITE };
  }
}

/**
 * 数量类色阶: 0~max, 越大越深
 */
function countColor(value: number | null, max: number, scale: string[]): CellColor {
  if (value == null || value === 0) return { background: NEUTRAL_BG, color: TEXT_MUTED };
  const idx = bucketIdx(value, max);
  return { background: scale[idx], color: TEXT_WHITE };
}

/**
 * 主入口：根据类型获取单元格颜色
 */
export function getCellColor(
  value: number | null | undefined,
  type: ColorScaleType,
  options?: { max?: number }
): CellColor {
  const v = value == null ? null : Number(value);

  switch (type) {
    case "rate":
      return rateColor(v);
    case "change":
      return changeColor(v);
    case "count_red":
      return countColor(v, options?.max ?? 100, RED_SCALE);
    case "count_green":
      return countColor(v, options?.max ?? 30, GREEN_SCALE);
    case "count_orange":
      return countColor(v, options?.max ?? 50, [
        "rgba(245,158,11,0.2)",
        "rgba(245,158,11,0.35)",
        "rgba(245,158,11,0.5)",
        "rgba(245,158,11,0.7)",
        "rgba(245,158,11,0.9)",
      ]);
    case "neutral":
    default:
      return { background: NEUTRAL_BG, color: "var(--text-primary)" };
  }
}

/**
 * 板级色: 按板级返回背景色
 */
export function getBoardLevelColor(level: number): string {
  if (level >= 7) return "var(--board-7)";
  if (level === 6) return "var(--board-6)";
  if (level === 5) return "var(--board-5)";
  if (level === 4) return "var(--board-4)";
  if (level === 3) return "var(--board-3)";
  if (level === 2) return "var(--board-2)";
  if (level === 1) return "var(--board-1)";
  return "var(--bg-tertiary)";
}
