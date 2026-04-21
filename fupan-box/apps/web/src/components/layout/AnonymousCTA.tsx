"use client";

/**
 * 匿名访客 CTA 浮条
 *
 * 仅在用户未登录时显示, 提示登录可解锁的功能.
 * 出现在右下角, 不挡住主内容; 用户可关闭, 关闭后 24 小时内不再出现.
 */

import { useEffect, useState } from "react";
import { Sparkles, Star, Target, Award, X, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";

const DISMISS_KEY = "anon_cta_dismissed_at";
const DISMISS_HOURS = 24;

export function AnonymousCTA() {
  const [show, setShow] = useState(false);
  const setActiveModule = useUIStore((s) => s.setActiveModule);

  useEffect(() => {
    if (api.isLoggedIn()) {
      setShow(false);
      return;
    }
    if (typeof window === "undefined") return;
    const ts = localStorage.getItem(DISMISS_KEY);
    if (ts) {
      const elapsed = Date.now() - parseInt(ts, 10);
      if (elapsed < DISMISS_HOURS * 3600_000) {
        setShow(false);
        return;
      }
    }
    // 延迟 5 秒出现, 不打扰首屏阅读
    const t = setTimeout(() => setShow(true), 5000);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
    setShow(false);
  };

  return (
    <div
      className="fixed z-40"
      style={{
        right: 16,
        bottom: 16,
        width: 280,
        background: "var(--bg-card)",
        border: "1px solid var(--accent-purple)",
        borderRadius: 6,
        boxShadow: "0 10px 30px rgba(168,85,247,0.25)",
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-1.5"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <Sparkles size={12} style={{ color: "var(--accent-purple)" }} />
        <span className="font-bold" style={{ color: "var(--accent-purple)", fontSize: 11, letterSpacing: 1 }}>
          登录解锁个性化复盘
        </span>
        <button
          onClick={dismiss}
          className="ml-auto p-0.5 transition-opacity hover:opacity-60"
          style={{ color: "var(--text-muted)" }}
          title="24 小时不再提示"
        >
          <X size={11} />
        </button>
      </div>

      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-2" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          <Star size={11} style={{ color: "var(--accent-orange)" }} />
          <span>自选股 AI 一句话点评</span>
        </div>
        <div className="flex items-center gap-2" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          <Target size={11} style={{ color: "var(--accent-red)" }} />
          <span>条件触发的智能交易计划</span>
        </div>
        <div className="flex items-center gap-2" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          <Award size={11} style={{ color: "var(--accent-blue)" }} />
          <span>AI 预测追踪 + 战绩验证</span>
        </div>
      </div>

      <div className="px-3 py-2 flex gap-1.5" style={{ borderTop: "1px solid var(--border-color)" }}>
        <button
          onClick={() => { setActiveModule("account"); dismiss(); }}
          className="flex-1 flex items-center justify-center gap-1 font-bold transition-all"
          style={{
            background: "var(--accent-purple)",
            color: "#fff",
            padding: "6px 10px",
            borderRadius: 4,
            fontSize: 11,
          }}
        >
          立即登录
          <ArrowRight size={11} />
        </button>
        <button
          onClick={dismiss}
          style={{
            color: "var(--text-muted)",
            fontSize: 11,
            padding: "6px 10px",
          }}
        >
          稍后
        </button>
      </div>
    </div>
  );
}
