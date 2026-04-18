"use client";

import {
  Activity,
  TrendingUp,
  Layers,
  Factory,
  DollarSign,
  Trophy,
  Search as SearchIcon,
  Newspaper,
  Star,
  Bot,
  type LucideIcon,
} from "lucide-react";
import { useUIStore, type NavModule } from "@/stores/ui-store";

interface NavItem {
  key: NavModule;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { key: "sentiment", label: "大盘情绪", icon: Activity },
  { key: "ladder", label: "连板天梯", icon: TrendingUp },
  { key: "strong", label: "强势股追踪", icon: TrendingUp },
  { key: "themes", label: "题材追踪", icon: Layers },
  { key: "industries", label: "行业追踪", icon: Factory },
  { key: "capital", label: "资金分析", icon: DollarSign },
  { key: "lhb", label: "龙虎榜分析", icon: Trophy },
  { key: "search", label: "个股检索", icon: SearchIcon },
  { key: "news", label: "财联社要闻", icon: Newspaper },
  { key: "watchlist", label: "我的自选", icon: Star },
];

export function Sidebar() {
  const activeModule = useUIStore((s) => s.activeModule);
  const setActiveModule = useUIStore((s) => s.setActiveModule);
  const aiPanelOpen = useUIStore((s) => s.aiPanelOpen);
  const toggleAi = useUIStore((s) => s.toggleAiPanel);

  return (
    <aside
      className="h-full flex flex-col flex-shrink-0"
      style={{
        width: 168,
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border-color)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2 px-3"
        style={{ height: 56, borderBottom: "1px solid var(--border-color)" }}
      >
        <span className="brand-logo-mark">
          <TrendingUp size={14} color="#fff" strokeWidth={2.5} />
        </span>
        <span
          className="font-bold tracking-wide"
          style={{
            background: "linear-gradient(90deg,#ef4444,#f97316)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            fontSize: "var(--font-lg)",
          }}
        >
          复盘盒子
        </span>
      </div>

      {/* 主导航 */}
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = activeModule === item.key;

          return (
            <div key={item.key}>
              <button
                onClick={() => setActiveModule(item.key)}
                className="w-full flex items-center gap-2 transition-colors"
                style={{
                  padding: "8px 12px",
                  background: isActive ? "var(--accent-orange)" : "transparent",
                  color: isActive ? "#1a1d28" : "var(--text-secondary)",
                  fontSize: "var(--font-md)",
                  fontWeight: isActive ? 700 : 500,
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon size={14} strokeWidth={isActive ? 2.4 : 1.8} />
                <span className="flex-1">{item.label}</span>
              </button>
            </div>
          );
        })}
      </nav>

      {/* 用户中心 / AI 入口 (急速复盘的底部卡片样式) */}
      <div
        className="px-3 py-2 space-y-2"
        style={{ borderTop: "1px solid var(--border-color)" }}
      >
        <button
          onClick={toggleAi}
          className="w-full flex items-center justify-center gap-1.5 font-bold transition-colors"
          style={{
            padding: "7px 10px",
            background: aiPanelOpen
              ? "var(--accent-purple)"
              : "rgba(139,92,246,0.14)",
            color: aiPanelOpen ? "#fff" : "var(--accent-purple)",
            border: "1px solid rgba(139,92,246,0.32)",
            borderRadius: 4,
            fontSize: "var(--font-sm)",
          }}
        >
          <Bot size={14} />
          AI 副驾
        </button>

        <div
          className="rounded text-center"
          style={{
            padding: "7px 6px",
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-color)",
          }}
        >
          <div
            className="font-bold flex items-center justify-center gap-1"
            style={{ color: "var(--text-primary)", fontSize: "var(--font-sm)" }}
          >
            👤 用户中心
          </div>
          <div
            className="mt-0.5"
            style={{ color: "var(--text-muted)", fontSize: 10 }}
          >
            本地模式 · 数据实时
          </div>
        </div>
      </div>
    </aside>
  );
}
