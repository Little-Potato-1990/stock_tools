"use client";

import { useState, useEffect } from "react";
import { MainLayout } from "./MainLayout";
import { UrlModuleSync } from "./UrlModuleSync";
import { AnonymousCTA } from "./AnonymousCTA";
import { useThemeStore } from "@/stores/theme-store";

export function ClientShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const applyTheme = useThemeStore((s) => s.applyToDocument);

  useEffect(() => {
    // 首屏立即把存储的颜色偏好写到 <html data-color-pref>, 避免 FOUC.
    applyTheme();
    setMounted(true);
  }, [applyTheme]);

  if (!mounted) {
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
    <>
      <UrlModuleSync />
      <MainLayout>{children}</MainLayout>
      <AnonymousCTA />
    </>
  );
}
