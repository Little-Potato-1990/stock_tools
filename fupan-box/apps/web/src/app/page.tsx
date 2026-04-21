"use client";

import { useUIStore } from "@/stores/ui-store";
import { TodayReviewPage } from "@/components/pages/TodayReviewPage";
import { SentimentPage } from "@/components/pages/SentimentPage";
import { LadderPage } from "@/components/pages/LadderPage";
import { ThemesPage } from "@/components/pages/ThemesPage";
import { WatchlistPage } from "@/components/pages/WatchlistPage";
import { PlansPage } from "@/components/pages/PlansPage";
import { CapitalPage } from "@/components/pages/CapitalPage";
import { LhbPage } from "@/components/pages/LhbPage";
import { StockSearchPage } from "@/components/pages/StockSearchPage";
import { NewsPage } from "@/components/pages/NewsPage";
import { AiTrackPage } from "@/components/pages/AiTrackPage";
import { MyReviewPage } from "@/components/pages/MyReviewPage";
import { AccountPage } from "@/components/pages/AccountPage";

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
    case "watchlist":
      return <WatchlistPage />;
    case "plans":
      return <PlansPage />;
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
    default:
      return <TodayReviewPage />;
  }
}
