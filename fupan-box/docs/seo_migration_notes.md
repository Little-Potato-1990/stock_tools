# SEO 迁移踩点笔记

> Phase 0 输出，Next.js 16 + React 19 SSR 改造的可行性评估与实施约束。

## 一、当前架构问题

### 致命问题：全 SPA 无 SEO

```ts
// apps/web/src/app/page.tsx
"use client";
import { useUIStore } from "@/stores/ui-store";

export default function Home() {
  const activeModule = useUIStore((s) => s.activeModule);
  switch (activeModule) {
    case "today": return <TodayReviewPage />;
    case "midlong": return <MidLongViewPage />;
    // ... 12 case
  }
}
```

- 整个网站只有 `/` 一个 URL
- 切页面靠 zustand store `activeModule`，**搜索引擎只能索引到首页**
- 个股详情、题材详情都是 Drawer，**没有独立 URL**

### Next.js 16 强制约束

- `apps/web/AGENTS.md` 明确警告："This is NOT the Next.js you know"，要求**写代码前先读 `node_modules/next/dist/docs/`**
- Server Component 不支持 React Context / hooks（zustand 不能用）
- `metadata` 对象 + `generateMetadata` 函数**只能在 Server Component**
- `params` / `searchParams` 现在是 **Promise**（必须 `await`）：
  ```ts
  export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
  }
  ```

## 二、SSR 改造的核心架构变化

### URL 路由结构（建议）

```
/                            首页（今日复盘）
/sentiment                   大盘情绪
/themes                      题材列表
/themes/[name]               单题材（替代 ThemeDetailDrawer）
/capital                     CapitalPage
/capital/[tab]               capital 子 Tab（overview/north/...）
/lhb                         龙虎榜
/news                        新闻列表
/news/[id]                   新闻详情
/stock/[code]                个股详情（替代 StockDetailDrawer）
/midlong                     中长视角
/midlong/[tab]/[?code]       中长视角子 Tab + 实体
/search                      个股检索
/account                     账户（client only, 无需 SEO）
/watchlist                   自选股（client only）
/plans                       计划池（client only）
/ai-track                    AI 追踪（client only）
/my-review                   我的复盘（client only）
```

### 关键模式：Server + Client 混合

```tsx
// app/stock/[code]/page.tsx (Server Component)
import { getStockDetail } from "@/lib/server/stock";
import { StockDetailClient } from "@/components/server/StockDetailClient";

export async function generateMetadata({ params }) {
  const { code } = await params;
  const stock = await getStockDetail(code);
  return {
    title: `${stock.name}(${code}) AI 三视角复盘 - 复盘 AI`,
    description: `${stock.name} 短线/波段/长线 AI 分析 + 主力资金 + 估值分位 + 财报观察`,
  };
}

export default async function Page({ params }) {
  const { code } = await params;
  const initialData = await getStockDetail(code);
  return <StockDetailClient code={code} initialData={initialData} />;
}
```

```tsx
// components/server/StockDetailClient.tsx (Client Component)
"use client";
export function StockDetailClient({ code, initialData }) {
  // useState, useEffect, zustand 都在这里用
  const [tab, setTab] = useState<"short" | "swing" | "long">("short");
  // ...
}
```

## 三、改造工作量评估

### 必改（影响 SEO）

| 页面 | 当前 | 改造方式 | 工作量 |
|---|---|---|---|
| `/` 首页 | use client + store switch | 改 server + 13 个独立 route | 高（架构重排） |
| `/stock/[code]` | StockDetailDrawer (use client) | 新增 server route + drawer 拆分 | 中 |
| `/themes/[name]` | ThemeDetailDrawer (use client) | 新增 server route | 中 |
| `/news/[id]` | NewsPage 内部弹窗 | 新增 server route | 中 |
| `/midlong/[tab]/[code]` | 不存在 | 新建（Phase 3 一起做） | 直接做对 |

### 可保留 client（不影响 SEO）

| 页面 | 原因 |
|---|---|
| `/account` `/watchlist` `/plans` `/ai-track` `/my-review` | 全是登录后功能，不需要 SEO |
| `CapitalPage` 9 Tab 切换 | 内部 Tab 可以用 client state，URL 用 `?tab=overview` |

## 四、Phase 4 实施步骤

### Step 1：1 个 Demo Route 验证

先做 `/stock/[code]` 一条路径打通：

1. 新建 `apps/web/src/app/stock/[code]/page.tsx`（server component）
2. 新建 `apps/web/src/lib/server/stock.ts`（server-side fetch，不能用 `lib/api.ts` 的 fetch wrapper）
3. 拆 `StockDetailDrawer.tsx` 为 `StockDetailContent.tsx`（共用）+ `StockDetailDrawer.tsx`（仍用 modal） + `StockDetailPage.tsx`（独立 URL）
4. 验证：`curl http://localhost:3000/stock/000001 | grep "<title>"` 应该看到股票名

### Step 2：批量拆 13 个 page

仿照 Step 1，但 `/account` `/watchlist` `/plans` `/ai-track` `/my-review` 保留 client only：
```tsx
// app/watchlist/page.tsx
"use client";
import { WatchlistPage } from "@/components/pages/WatchlistPage";
export default function Page() { return <WatchlistPage />; }
```

### Step 3：Sidebar 改用 next/link

```tsx
// components/layout/Sidebar.tsx
import Link from "next/link";

const ROUTE_MAP: Record<NavModule, string> = {
  today: "/", sentiment: "/sentiment", themes: "/themes",
  capital: "/capital", lhb: "/lhb", search: "/search",
  news: "/news", midlong: "/midlong", watchlist: "/watchlist",
  plans: "/plans", ai_track: "/ai-track", my_review: "/my-review",
  account: "/account",
};

<Link href={ROUTE_MAP[item.key]}>...</Link>
```

去掉 `useUIStore.activeModule`（或保留但不再决定渲染哪个 page）。

### Step 4：sitemap + robots

```ts
// apps/web/src/app/sitemap.ts
export default async function sitemap() {
  const stocks = await fetchTopStocks(5000); // 调 backend
  const themes = await fetchAllThemes();
  return [
    { url: "https://example.com/", priority: 1 },
    { url: "https://example.com/midlong", priority: 0.9 },
    ...stocks.map(s => ({
      url: `https://example.com/stock/${s.code}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...themes.map(t => ({
      url: `https://example.com/themes/${encodeURIComponent(t.name)}`,
      priority: 0.6,
    })),
  ];
}
```

```ts
// apps/web/src/app/robots.ts
export default function robots() {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/account", "/watchlist", "/plans"] },
    sitemap: "https://example.com/sitemap.xml",
  };
}
```

### Step 5：metadata 全局优化

```ts
// app/layout.tsx
export const metadata: Metadata = {
  title: { default: "复盘 AI · A 股短中长三视角分析", template: "%s | 复盘 AI" },
  description: "AI 驱动的 A 股复盘平台，覆盖短线/波段/长线三视角...",
  keywords: ["A股", "复盘", "AI", "涨停", "题材", "长线", "估值", "机构持仓"],
  openGraph: { type: "website", locale: "zh_CN", siteName: "复盘 AI" },
};
```

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| zustand `activeModule` 改 URL 路由后需要全局清理 | 保留 store 但只用于 Sidebar 高亮，不再决定渲染 |
| ClientShell 强制登录拦截阻止匿名 SSR | Phase 4 重写 ClientShell 取消拦截，改成"按需 CTA"模式 |
| 服务端 fetch backend 需要内部 URL（不是 localhost:3000） | env `BACKEND_INTERNAL_URL=http://localhost:8000`，server-side 用，client 仍用相对路径 |
| Server Component 不能用 zustand 等 client 库 | 严守 server / client 边界，client-only 库只在 `"use client"` 文件 import |
| Drawer 与独立页两套代码维护成本 | 统一抽 `StockDetailContent` 共用组件，Drawer / Page 只做容器 |
| Next.js 16 缓存默认行为变化 | 实施时严格按 `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md` 配置 |

## 六、Phase 4 输出物清单

完成后应有：

- [ ] `app/stock/[code]/page.tsx` + 同模式 12 个 route
- [ ] `lib/server/*.ts` server-side fetch 工具集
- [ ] `components/server/*.tsx` server component 包装层
- [ ] `app/sitemap.ts` + `app/robots.ts`
- [ ] `app/layout.tsx` metadata 全局优化
- [ ] Sidebar 改用 `next/link`
- [ ] `ClientShell` 取消强制登录拦截
- [ ] `AnonymousCTA` 组件
- [ ] curl 验证：每个非登录页都能 SSR 出 `<title>` `<meta description>` `<h1>`

## 七、不做的事（明确边界）

- 不做完整 ISR / ISG（首期没量，无需）
- 不做 next/og 动态 OG 图（二期再加）
- 不做 i18n（A 股网站只面向中文用户）
- 不做 Edge runtime（backend 是 FastAPI，无 edge 需求）
