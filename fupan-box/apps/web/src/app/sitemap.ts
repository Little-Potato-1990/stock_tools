import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fupan.ai";

/**
 * 当前 SPA 仅一个根路径, 所以 sitemap 暂时只包含主页 + 主要功能模块的 hash 链接.
 * 待 Phase 4 后期 url-based 路由迁移后再扩展为真正的多页 sitemap.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const modules = [
    { path: "", changeFrequency: "daily" as const, priority: 1.0 },     // 首页 = 今日复盘
    { path: "?m=themes", changeFrequency: "daily" as const, priority: 0.9 },
    { path: "?m=capital", changeFrequency: "daily" as const, priority: 0.9 },
    { path: "?m=midlong", changeFrequency: "weekly" as const, priority: 0.85 },
    { path: "?m=lhb", changeFrequency: "daily" as const, priority: 0.85 },
    { path: "?m=news", changeFrequency: "hourly" as const, priority: 0.85 },
    { path: "?m=sentiment", changeFrequency: "daily" as const, priority: 0.8 },
    { path: "?m=ai_track", changeFrequency: "weekly" as const, priority: 0.7 },
  ];

  return modules.map((m) => ({
    url: `${SITE_URL}/${m.path}`,
    lastModified: now,
    changeFrequency: m.changeFrequency,
    priority: m.priority,
  }));
}
