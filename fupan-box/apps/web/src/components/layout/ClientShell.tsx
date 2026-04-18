"use client";

import { useState, useEffect } from "react";
import { MainLayout } from "./MainLayout";

export function ClientShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  return <MainLayout>{children}</MainLayout>;
}
