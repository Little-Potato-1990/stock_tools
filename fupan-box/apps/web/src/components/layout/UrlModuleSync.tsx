"use client";

/**
 * 同步 URL ?m=xxx ↔ useUIStore.activeModule
 *
 * 让 SPA 模块切换可以被 sitemap / 分享链接 / 浏览器后退前进识别.
 * 必须在 Suspense 内, 因为 useSearchParams 需要 Suspense 边界.
 */

import { useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useUIStore, type NavModule } from "@/stores/ui-store";

const VALID_MODULES: NavModule[] = [
  "today", "sentiment", "themes", "capital", "midlong",
  "lhb", "search", "news", "watchlist", "plans",
  "ai_track", "my_review", "account",
];

function UrlSyncInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeModule = useUIStore((s) => s.activeModule);
  const setActiveModule = useUIStore((s) => s.setActiveModule);
  const lastUrlRef = useRef<string | null>(null);

  // 1) 启动 / URL 变化 → 同步到 store
  useEffect(() => {
    const m = searchParams.get("m");
    if (m && VALID_MODULES.includes(m as NavModule) && m !== activeModule) {
      setActiveModule(m as NavModule);
    }
    // 仅当 URL 来自外部跳转时触发, 内部 store 变化在下个 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // 2) Store 变化 → 同步到 URL (浅替换, 不触发页面刷新)
  useEffect(() => {
    const target = activeModule === "today" ? pathname : `${pathname}?m=${activeModule}`;
    if (lastUrlRef.current === target) return;
    lastUrlRef.current = target;
    router.replace(target, { scroll: false });
  }, [activeModule, pathname, router]);

  return null;
}

export function UrlModuleSync() {
  return (
    <Suspense fallback={null}>
      <UrlSyncInner />
    </Suspense>
  );
}
