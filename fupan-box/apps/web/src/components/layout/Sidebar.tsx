"use client";

import {
  Activity,
  TrendingUp,
  Layers,
  DollarSign,
  Trophy,
  Search as SearchIcon,
  Newspaper,
  Star,
  Target,
  Bot,
  Sparkles,
  Award,
  BookOpen,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useUIStore, type NavModule } from "@/stores/ui-store";
import { usePrivateStatus } from "@/stores/private-status-store";
import { DataHealthChip } from "./DataHealthChip";

interface NavItem {
  key: NavModule;
  label: string;
  icon: LucideIcon;
  badge?: string;
}

const PUBLIC_NAV: NavItem[] = [
  { key: "today", label: "今日复盘", icon: Sparkles, badge: "AI" },
  { key: "sentiment", label: "大盘情绪", icon: Activity },
  { key: "ladder", label: "连板天梯", icon: TrendingUp },
  { key: "themes", label: "题材追踪", icon: Layers },
  { key: "capital", label: "资金风向标", icon: DollarSign },
  { key: "lhb", label: "龙虎榜分析", icon: Trophy },
  { key: "search", label: "个股检索", icon: SearchIcon },
  { key: "news", label: "财联社要闻", icon: Newspaper },
];

const SETTINGS_NAV: NavItem[] = [
  { key: "account", label: "账户套餐", icon: Wallet },
];

interface PrivateNavItem extends NavItem {
  unlocked: boolean;
  /** 状态文字 (右侧灰色小字, 解锁前为引导, 解锁后为计数) */
  hint: string;
  /** 触发数 > 0 时, 用 highlight 颜色显示数字 */
  highlight?: number;
}

function SectionTitle({
  children,
  hint,
}: {
  children: string;
  hint?: string;
}) {
  return (
    <div
      className="px-3"
      style={{
        marginTop: 12,
        marginBottom: 4,
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          color: "var(--text-tertiary)",
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        {children}
      </div>
      {hint && (
        <div
          style={{
            marginTop: 2,
            fontSize: 9,
            color: "var(--text-muted)",
            opacity: 0.75,
            letterSpacing: 0,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const activeModule = useUIStore((s) => s.activeModule);
  const setActiveModule = useUIStore((s) => s.setActiveModule);
  const aiPanelOpen = useUIStore((s) => s.aiPanelOpen);
  const toggleAi = useUIStore((s) => s.toggleAiPanel);
  const status = usePrivateStatus();

  const privateNav: PrivateNavItem[] = [
    {
      key: "watchlist",
      label: "我的自选",
      icon: Star,
      unlocked: status?.watchlist.unlocked ?? false,
      hint: status?.watchlist.unlocked
        ? `${status.watchlist.count}`
        : "+ 加自选",
    },
    {
      key: "plans",
      label: "我的计划",
      icon: Target,
      unlocked: status?.plans.unlocked ?? false,
      hint: status?.plans.unlocked
        ? status.plans.today_triggers > 0
          ? `${status.plans.today_triggers}`
          : `${status.plans.active + status.plans.triggered}`
        : "+ 建计划",
      highlight: status?.plans.today_triggers ?? 0,
    },
    {
      key: "my_review",
      label: "我的复盘",
      icon: BookOpen,
      badge: "AI",
      unlocked: status?.trades.unlocked ?? false,
      hint: status?.trades.unlocked
        ? `7日 ${status.trades.count_7d}`
        : "+ 记交易",
    },
    {
      key: "ai_track",
      label: "AI 战绩",
      icon: Award,
      badge: "AI",
      unlocked: status?.ai_track.unlocked ?? false,
      hint: status?.ai_track.unlocked
        ? `已验 ${status.ai_track.verified_7d}`
        : "待累计",
    },
  ];

  const renderItem = (item: NavItem, opts?: Partial<PrivateNavItem>) => {
    const Icon = item.icon;
    const isActive = activeModule === item.key;
    const unlocked = opts?.unlocked ?? true;
    const hint = opts?.hint;
    const highlight = (opts?.highlight ?? 0) > 0;
    const dimmed = !isActive && !unlocked;

    return (
      <button
        key={item.key}
        onClick={() => setActiveModule(item.key)}
        className="w-full flex items-center gap-2 transition-colors"
        style={{
          padding: "8px 12px",
          background: isActive ? "var(--accent-orange)" : "transparent",
          color: isActive
            ? "#1a1d28"
            : dimmed
            ? "var(--text-tertiary)"
            : "var(--text-secondary)",
          fontSize: "var(--font-md)",
          fontWeight: isActive ? 700 : 500,
          textAlign: "left",
          opacity: dimmed ? 0.5 : 1,
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
        <span className="flex-1 truncate">{item.label}</span>
        {hint !== undefined && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: isActive
                ? "#1a1d28"
                : highlight
                ? "var(--accent-red)"
                : dimmed
                ? "var(--text-tertiary)"
                : "var(--text-secondary)",
            }}
          >
            {hint}
          </span>
        )}
        {item.badge && hint === undefined && (
          <span
            className="font-bold"
            style={{
              padding: "1px 5px",
              borderRadius: 3,
              fontSize: 9,
              letterSpacing: "0.04em",
              background: isActive
                ? "rgba(26,29,40,0.85)"
                : "var(--accent-purple)",
              color: isActive ? "var(--accent-orange)" : "#fff",
            }}
          >
            {item.badge}
          </span>
        )}
      </button>
    );
  };

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

      {/* 主导航: 三分区 */}
      <nav className="flex-1 overflow-y-auto py-2">
        <SectionTitle>公共复盘</SectionTitle>
        {PUBLIC_NAV.map((item) => renderItem(item))}

        <SectionTitle hint="登录可解锁个性化">可选增强</SectionTitle>
        {privateNav.map((item) =>
          renderItem(item, {
            unlocked: item.unlocked,
            hint: item.hint,
            highlight: item.highlight,
          }),
        )}

        <SectionTitle>设置</SectionTitle>
        {SETTINGS_NAV.map((item) => renderItem(item))}
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

        <DataHealthChip />
      </div>
    </aside>
  );
}
