"use client";

import { useState } from "react";
import { LadderMatrix } from "@/components/market/LadderMatrix";
import {
  LadderAiCard,
  type LadderDialAnchor,
  type LadderTrendPoint,
} from "@/components/market/LadderAiCard";
import { LadderEvidenceGrid } from "@/components/market/LadderEvidenceGrid";
import { PageHeader } from "@/components/layout/PageHeader";

// P0 改造: 砍掉"相关查询/筛选/缩略"3 个冗余 tab,
// 它们的能力已被"个股检索"和首屏 LadderMatrix 覆盖, 实测点击率极低.
// 历史代码可在 git log 中查阅 (commit 120d5ce 之前).

/** L1 dial 锚点 → LadderMatrix 中需要打 "AI 关注" 角标的 row label.
 *  保持与 LadderMatrix.ROWS 的 label 字面一致. */
const ANCHOR_TO_ROW_LABELS: Record<LadderDialAnchor, string[]> = {
  max_level: ["最高板数", "7板+"],
  promo: ["6板 晋级", "5板 晋级", "4板 晋级", "3板 晋级", "2板 晋级"],
  first_board: ["1板", "一字板"],
  broken: ["反包板", "炸板"],
};

const DEFAULT_LADDER_HIGHLIGHT_LABELS = Array.from(
  new Set(Object.values(ANCHOR_TO_ROW_LABELS).flat()),
);

export function LadderPage() {
  const [highlight, setHighlight] = useState<LadderDialAnchor | null>(null);
  const [trend5d, setTrend5d] = useState<LadderTrendPoint[]>([]);

  const handleEvidenceClick = (anchor: LadderDialAnchor) => {
    setHighlight((prev) => (prev === anchor ? null : anchor));
  };

  const matrixHighlightLabels = highlight
    ? ANCHOR_TO_ROW_LABELS[highlight]
    : DEFAULT_LADDER_HIGHLIGHT_LABELS;

  return (
    <div>
      <PageHeader title="连板天梯" />

      {/* L1: AI 主视觉 (headline + 4 仪表盘 + structure + key_stocks) */}
      <LadderAiCard
        hero
        onEvidenceClick={handleEvidenceClick}
        onTrendLoad={setTrend5d}
      />

      {/* L2: AI 引用证据 (4 张精选 sparkline) */}
      <LadderEvidenceGrid trendData={trend5d} highlight={highlight} />

      {/* L3: 详细矩阵 (默认 7 天, AI 关注行已加角标) */}
      <LadderMatrix aiHighlightRowLabels={matrixHighlightLabels} />
    </div>
  );
}
