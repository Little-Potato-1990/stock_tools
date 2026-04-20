"use client";

import { LadderMatrix } from "@/components/market/LadderMatrix";
import { LadderAiCard } from "@/components/market/LadderAiCard";
import { PageHeader } from "@/components/layout/PageHeader";

// P0 改造: 砍掉"相关查询/筛选/缩略"3 个冗余 tab,
// 它们的能力已被"个股检索"和首屏 LadderMatrix 覆盖, 实测点击率极低.
// 历史代码可在 git log 中查阅 (commit 120d5ce 之前).

export function LadderPage() {
  return (
    <div>
      <PageHeader title="连板天梯" />
      <LadderAiCard />
      <LadderMatrix />
    </div>
  );
}
