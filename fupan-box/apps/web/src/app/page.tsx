"use client";

import { useUIStore } from "@/stores/ui-store";
import { TodayReviewPage } from "@/components/pages/TodayReviewPage";
import { SentimentPage } from "@/components/pages/SentimentPage";
import { LadderPage } from "@/components/pages/LadderPage";
import { ThemesPage } from "@/components/pages/ThemesPage";
import { IndustriesPage } from "@/components/pages/IndustriesPage";
import { WatchlistPage } from "@/components/pages/WatchlistPage";
import { StrongStocksPage } from "@/components/pages/StrongStocksPage";
import { CapitalPage } from "@/components/pages/CapitalPage";
import { LhbPage } from "@/components/pages/LhbPage";
import { StockSearchPage } from "@/components/pages/StockSearchPage";
import { NewsPage } from "@/components/pages/NewsPage";
import { BigDataPage } from "@/components/pages/BigDataPage";
import { AiTrackPage } from "@/components/pages/AiTrackPage";
import { MyReviewPage } from "@/components/pages/MyReviewPage";
import { AccountPage } from "@/components/pages/AccountPage";
import { PlaceholderPage } from "@/components/pages/PlaceholderPage";

export default function Home() {
  const activeModule = useUIStore((s) => s.activeModule);

  switch (activeModule) {
    case "today":
      return <TodayReviewPage />;
    case "sentiment":
      return <SentimentPage />;
    case "ladder":
      return <LadderPage />;
    case "themes":
      return <ThemesPage />;
    case "industries":
      return <IndustriesPage />;
    case "watchlist":
      return <WatchlistPage />;
    case "strong":
      return <StrongStocksPage />;
    case "bigdata":
      return <BigDataPage />;
    case "capital":
      return <CapitalPage />;
    case "lhb":
      return <LhbPage />;
    case "search":
      return <StockSearchPage />;
    case "news":
      return <NewsPage />;
    case "ai_track":
      return <AiTrackPage />;
    case "my_review":
      return <MyReviewPage />;
    case "account":
      return <AccountPage />;
    case "dashboard":
      return <PlaceholderPage title="自定义看板" description="拖拽组件自由排列，布局自动保存" />;
    default:
      return <TodayReviewPage />;
  }
}
