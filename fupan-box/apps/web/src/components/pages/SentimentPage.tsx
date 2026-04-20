"use client";

import { OverviewBar } from "@/components/market/OverviewBar";
import { SentimentChart } from "@/components/market/SentimentChart";
import { SentimentAiCard } from "@/components/market/SentimentAiCard";

export function SentimentPage() {
  return (
    <div>
      <OverviewBar />
      <SentimentAiCard />
      <SentimentChart />
    </div>
  );
}
