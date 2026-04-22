"use client";

import { Sidebar } from "./Sidebar";
import { AiPanel } from "./AiPanel";
import { FloatingStockBadge } from "./FloatingStockBadge";
import { MyDigestFloating } from "./MyDigestFloating";
import { DataStatusBar } from "./DataStatusBar";
import { StockDetailDrawer } from "@/components/market/StockDetailDrawer";
import { ThemeDetailDrawer } from "@/components/market/ThemeDetailDrawer";
import { WhyRoseModal } from "@/components/market/WhyRoseModal";
import { DebateModal } from "@/components/market/DebateModal";
import { AnomalyBell } from "@/components/market/AnomalyBell";
import { AnomalyDrawer } from "@/components/market/AnomalyDrawer";
import { LadderMatrixDrawer } from "@/components/market/LadderMatrixDrawer";
import { CommandPalette } from "@/components/common/CommandPalette";
import { useUIStore } from "@/stores/ui-store";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const stockDetailCode = useUIStore((s) => s.stockDetailCode);
  const closeStockDetail = useUIStore((s) => s.closeStockDetail);
  const themeDetailName = useUIStore((s) => s.themeDetailName);
  const closeThemeDetail = useUIStore((s) => s.closeThemeDetail);

  return (
    <div
      className="h-screen w-screen flex overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      <Sidebar />
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        <DataStatusBar />
        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto">{children}</main>
      </div>

      <FloatingStockBadge />
      <AnomalyBell />
      <MyDigestFloating />
      <AnomalyDrawer />
      <LadderMatrixDrawer />
      <AiPanel />
      <StockDetailDrawer stockCode={stockDetailCode} onClose={closeStockDetail} />
      <ThemeDetailDrawer themeName={themeDetailName} onClose={closeThemeDetail} />
      <WhyRoseModal />
      <DebateModal />
      <CommandPalette />
    </div>
  );
}
