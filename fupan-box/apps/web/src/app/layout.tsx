import type { Metadata } from "next";
import "./globals.css";
import { ClientShell } from "@/components/layout/ClientShell";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fupan.ai";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "复盘 AI - A 股短线/波段/长线 AI 复盘工作台",
    template: "%s | 复盘 AI",
  },
  description:
    "AI 驱动的 A 股复盘工具 — 短线打板、波段趋势、长线估值三视角全覆盖。涨停板、龙虎榜、资金流、机构持仓、卖方一致预期一站式分析，每天免费查看。",
  keywords: [
    "A股复盘", "AI 选股", "涨停板分析", "龙虎榜",
    "波段选股", "长线投资", "估值分析", "卖方一致预期",
    "机构持仓", "短线打板", "题材轮动",
  ],
  authors: [{ name: "复盘 AI 团队" }],
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: SITE_URL,
    siteName: "复盘 AI",
    title: "复盘 AI - A 股短线/波段/长线 AI 复盘工作台",
    description: "AI 驱动的 A 股三视角复盘工具，免费看涨停、主线、资金、估值。",
  },
  twitter: {
    card: "summary_large_image",
    title: "复盘 AI - A 股 AI 复盘",
    description: "短线/波段/长线三视角 AI 复盘",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
