"use client";

import { Sidebar } from "./Sidebar";
import { AiPanel } from "./AiPanel";
import { FloatingStockBadge } from "./FloatingStockBadge";
import { StockDetailDrawer } from "@/components/market/StockDetailDrawer";
import { ThemeDetailDrawer } from "@/components/market/ThemeDetailDrawer";
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
      <main className="flex-1 min-h-0 min-w-0 overflow-y-auto">{children}</main>

      <FloatingStockBadge />
      <AiPanel />
      <StockDetailDrawer stockCode={stockDetailCode} onClose={closeStockDetail} />
      <ThemeDetailDrawer themeName={themeDetailName} onClose={closeThemeDetail} />
    </div>
  );
}
