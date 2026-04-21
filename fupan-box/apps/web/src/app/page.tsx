"use client";

import { useUIStore } from "@/stores/ui-store";
import { TodayReviewPage } from "@/components/pages/TodayReviewPage";
import { SentimentPage } from "@/components/pages/SentimentPage";
import { ThemesPage } from "@/components/pages/ThemesPage";
import { WatchlistPage } from "@/components/pages/WatchlistPage";
import { PlansPage } from "@/components/pages/PlansPage";
import { CapitalPage } from "@/components/pages/CapitalPage";
import { MidLongPage } from "@/components/pages/MidLongPage";
import { LhbPage } from "@/components/pages/LhbPage";
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
    case "themes":
      return <ThemesPage />;
    case "watchlist":
      return <WatchlistPage />;
    case "plans":
      return <PlansPage />;
    case "capital":
      return <CapitalPage />;
    case "midlong":
      return <MidLongPage />;
    case "lhb":
      return <LhbPage />;
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
