"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MainLayout } from "./MainLayout";
import { UrlModuleSync } from "./UrlModuleSync";
import { AnonymousCTA } from "./AnonymousCTA";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import { api } from "@/lib/api";

export function ClientShell({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const applyTheme = useThemeStore((s) => s.applyToDocument);
  const activeModule = useUIStore((s) => s.activeModule);
  const prefetchedRef = useRef<Set<string>>(new Set());
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    // 首屏立即把存储的颜色偏好写到 <html data-color-pref>, 避免 FOUC.
    applyTheme();
  }, [applyTheme]);

  // 非阻塞预取：仅在空闲/延后时尝试，且每个 key 仅预取一次。
  useEffect(() => {
    const prefetchByModule: Partial<Record<typeof activeModule, Array<{ key: string; run: () => Promise<unknown> }>>> = {
      today: [
        { key: "prefetch:sentiment", run: () => api.getSentiment(20) },
      ],
      sentiment: [
        { key: "prefetch:capital-summary", run: () => api.getCapitalSummary() },
      ],
      capital: [
        { key: "prefetch:lhb-5", run: () => api.getSnapshotRange("lhb", 5) },
      ],
      lhb: [
        { key: "prefetch:news", run: () => api.getNews(40, true, { hours: 24, sort: "time" }) },
      ],
    };
    const tasks = prefetchByModule[activeModule];
    if (!tasks || tasks.length === 0) return;

    const timer = setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      tasks.forEach((t) => {
        if (prefetchedRef.current.has(t.key)) return;
        prefetchedRef.current.add(t.key);
        t.run().catch(() => {
          // 预取失败不影响主流程；允许后续用户真实访问时再走正常加载。
        });
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, [activeModule]);

  if (!hydrated) {
    return (
      <div
        className="h-screen w-screen flex items-center justify-center"
        style={{ background: "var(--bg-primary)", color: "var(--text-muted)" }}
      >
        加载中...
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <UrlModuleSync />
      <MainLayout>{children}</MainLayout>
      <AnonymousCTA />
    </QueryClientProvider>
  );
}
