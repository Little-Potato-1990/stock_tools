import type { LucideIcon } from "lucide-react";

export type TrendDir = "up" | "down" | "flat";

/**
 * 通用 dial 数据项.
 * @template TAnchor — 调用方自定义的锚点字符串字面量, 与点击回调一一对应.
 */
export interface DialItem<TAnchor extends string = string> {
  anchor: TAnchor;
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  trend: TrendDir;
  delta?: string;
  caption: string;
  color: string;
}

/**
 * 通用证据卡 spec — 描述一张 sparkline 卡的取数 / 渲染规则.
 * @template TAnchor — 与 DialItem 共享同一锚点字面量, 实现 L1↔L2 联动.
 * @template TPoint  — 5 日趋势点的具体形状 (Lhb / Sentiment / Ladder 各不相同).
 */
export interface CardSpec<
  TAnchor extends string = string,
  TPoint = unknown,
> {
  anchor: TAnchor;
  icon: LucideIcon;
  title: string;
  /** 从趋势点中取出本卡片对应的 1 个数值 */
  pick: (p: TPoint) => number;
  /** 把"今日值"渲染成展示文案 */
  fmt: (v: number) => string;
  /** high = 越高越积极 (用红色), low = 越低越积极 — colorOf 会真翻转 */
  positive: "high" | "low";
  /** 一句话描述 (会显示在卡片底部) */
  describe: (vals: number[], today: number, p?: TPoint) => string;
}
