"use client";

import { OverviewBar } from "@/components/market/OverviewBar";
import { SentimentChart } from "@/components/market/SentimentChart";

export function SentimentPage() {
  return (
    <div>
      <OverviewBar />
      <SentimentChart />
    </div>
  );
}
