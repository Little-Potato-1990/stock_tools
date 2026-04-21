import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { TrendDir } from "./types";

/**
 * 通用趋势箭头 — 上箭头 / 下箭头 / 横线.
 * 替代 5 个 AiCard 中重复的本地实现.
 */
export function TrendArrow({
  trend,
  size = 10,
}: {
  trend: TrendDir;
  size?: number;
}) {
  const Icon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  return <Icon size={size} />;
}
