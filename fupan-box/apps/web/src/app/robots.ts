import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fupan.ai";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",        // 后端 API 路由
          "/account",     // 账号设置
          "/my_review",   // 个人复盘
          "/plans",       // 私人交易计划
          "/watchlist",   // 自选股 (登录态)
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
