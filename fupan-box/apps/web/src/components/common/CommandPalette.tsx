"use client";

/**
 * 全局 Command Palette (Cmd+K / Ctrl+K).
 *
 * 设计思路 (#5):
 *   一个键唤出, 一个键到任何地方. 让用户告别"先点侧栏再搜索"的两步操作.
 *
 * 内容分组 (按相关性优先级):
 *   1. 搜索结果      - 输入 ≥1 字符时, 走 api.searchStocks
 *      (后端按 stock_code contains 查; 中文名搜不到, 用户应输代码)
 *   2. 自选股        - 已登录用户的自选 list (本地缓存, 输入时本地 fuzzy 过滤名/代码)
 *   3. 最近交互      - ui-store.recentInteractions (近 12 条)
 *   4. 快捷操作      - 跳模块、AI 入口、计划/异动
 *
 * 键位:
 *   Cmd/Ctrl+K      唤出
 *   ↑ ↓             选择
 *   Enter           执行
 *   Esc             关闭
 *
 * 不依赖 cmdk / kbar, 自己写 ~250 行能解决, 减少第三方包风险.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Search,
  X,
  Star,
  Clock,
  ArrowRight,
  Activity,
  Layers,
  DollarSign,
  Trophy,
  Newspaper,
  Bot,
  Target,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  Zap,
  Scale,
  Search as SearchIcon,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore, type NavModule } from "@/stores/ui-store";
import { UNIVERSE_OPTIONS, useUniverseStore } from "@/stores/universe-store";
import StockStatusBadge from "@/components/common/StockStatusBadge";

type CommandKind = "stock" | "recent" | "action" | "watchlist";

interface Command {
  id: string;
  kind: CommandKind;
  icon: LucideIcon;
  iconColor?: string;
  title: string;
  /** 副标题 (代码、上下文) */
  subtitle?: string;
  /** 右侧标签 (热键、状态) */
  tag?: string;
  /** 搜索命中的状态 / 板块 (仅 kind=stock) */
  searchMeta?: { status?: SearchHit["status"]; board?: string | null };
  /** keywords 用于本地过滤 */
  keywords: string[];
  run: () => void;
}

interface SearchHit {
  stock_code: string;
  stock_name: string;
  change_pct?: number;
  status?: "listed_active" | "st" | "star_st" | "suspended" | "delisted";
  board?: string;
  close?: number;
  amount?: number;
}

/** 模块跳转快捷动作 - 与 Sidebar 同步 */
const MODULE_ACTIONS: Array<{ key: NavModule; label: string; icon: LucideIcon }> = [
  { key: "today", label: "跳到 · 今日复盘", icon: Sparkles },
  { key: "sentiment", label: "跳到 · 大盘情绪", icon: Activity },
  { key: "themes", label: "跳到 · 题材追踪", icon: Layers },
  { key: "capital", label: "跳到 · 资金风向标", icon: DollarSign },
  { key: "midlong", label: "跳到 · 个股深度", icon: SearchIcon },
  { key: "lhb", label: "跳到 · 龙虎榜", icon: Trophy },
  { key: "news", label: "跳到 · 财经要闻", icon: Newspaper },
  { key: "watchlist", label: "跳到 · 我的自选", icon: Star },
  { key: "plans", label: "跳到 · 我的计划", icon: Target },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [watchlist, setWatchlist] = useState<Array<{ stock_code: string; note?: string | null }>>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);

  const setActiveModule = useUIStore((s) => s.setActiveModule);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const openWhyRose = useUIStore((s) => s.openWhyRose);
  const openDebate = useUIStore((s) => s.openDebate);
  const openAnomalyDrawer = useUIStore((s) => s.openAnomalyDrawer);
  const toggleAiPanel = useUIStore((s) => s.toggleAiPanel);
  const recent = useUIStore((s) => s.recentInteractions);
  const universe = useUniverseStore((s) => s.universe);

  // ---- 全局热键 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 打开时拉自选 (登录用户)
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    if (api.isLoggedIn()) {
      api
        .getWatchlist()
        .then((list) =>
          setWatchlist(
            (list as Array<{ stock_code: string; note?: string | null }>).slice(0, 60),
          ),
        )
        .catch(() => setWatchlist([]));
    }
  }, [open]);

  // 输入触发搜索 (debounce 200ms)
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.searchStocks(q, universe);
        setHits(r.slice(0, 12));
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open, universe]);

  const close = useCallback(() => setOpen(false), []);

  const runStock = useCallback(
    (code: string, name?: string) => {
      openStockDetail(code, name);
      close();
    },
    [openStockDetail, close],
  );

  // 构建命令列表 (按当前 query / 上下文动态)
  const commands: Command[] = useMemo(() => {
    const out: Command[] = [];
    const q = query.trim().toLowerCase();

    // 1. 搜索命中
    hits.forEach((h) => {
      const upDown = (h.change_pct ?? 0) >= 0;
      out.push({
        id: `stock:${h.stock_code}`,
        kind: "stock",
        icon: SearchIcon,
        iconColor: "var(--accent-orange)",
        title: h.stock_name || h.stock_code,
        subtitle: `${h.stock_code}${h.change_pct != null ? `  ${upDown ? "+" : ""}${h.change_pct.toFixed(2)}%` : ""}`,
        searchMeta: { status: h.status, board: h.board ?? null },
        keywords: [h.stock_code, h.stock_name ?? ""],
        run: () => runStock(h.stock_code, h.stock_name),
      });
    });

    // 2. 自选股 (本地 fuzzy 过滤)
    watchlist
      .filter(
        (w) =>
          !q ||
          w.stock_code.toLowerCase().includes(q) ||
          (w.note ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8)
      .forEach((w) => {
        if (out.find((c) => c.id === `stock:${w.stock_code}`)) return;
        out.push({
          id: `watch:${w.stock_code}`,
          kind: "watchlist",
          icon: Star,
          iconColor: "var(--accent-orange)",
          title: w.stock_code,
          subtitle: w.note || "我的自选",
          tag: "自选",
          keywords: [w.stock_code, w.note ?? ""],
          run: () => runStock(w.stock_code),
        });
      });

    // 3. 最近交互 (无 query 时优先, 有 query 时按 keyword 过滤)
    recent
      .filter((r) => !q || r.key.toLowerCase().includes(q) || (r.label ?? "").toLowerCase().includes(q))
      .slice(0, 6)
      .forEach((r) => {
        const id = `recent:${r.kind}:${r.key}`;
        if (out.find((c) => c.id === id)) return;
        const isStock = r.kind === "stock" || r.kind === "ai_explain";
        out.push({
          id,
          kind: "recent",
          icon: Clock,
          iconColor: "var(--text-muted)",
          title: r.label || r.key,
          subtitle: r.kind === "theme" ? "题材" : "最近查看",
          tag: "最近",
          keywords: [r.key, r.label ?? ""],
          run: () => {
            if (isStock) runStock(r.key, r.label);
            else close();
          },
        });
      });

    // 4. 快捷动作 (始终展示, 由 query 过滤)
    MODULE_ACTIONS.forEach((m) => {
      if (q && !m.label.toLowerCase().includes(q)) return;
      out.push({
        id: `nav:${m.key}`,
        kind: "action",
        icon: m.icon,
        iconColor: "var(--accent-purple)",
        title: m.label,
        keywords: [m.label, m.key],
        run: () => {
          setActiveModule(m.key);
          close();
        },
      });
    });

    // 5. AI 副驾 / 异动 / 辩论 等全局工具
    const toolActions: Command[] = [
      {
        id: "tool:ai-panel",
        kind: "action",
        icon: Bot,
        iconColor: "var(--accent-purple)",
        title: "打开 AI 副驾",
        keywords: ["ai", "副驾", "聊天", "chat"],
        run: () => {
          toggleAiPanel();
          close();
        },
      },
      {
        id: "tool:anomaly",
        kind: "action",
        icon: AlertTriangle,
        iconColor: "var(--accent-red)",
        title: "打开盘中异动列表",
        keywords: ["异动", "anomaly", "急拉", "闪崩"],
        run: () => {
          openAnomalyDrawer();
          close();
        },
      },
      {
        id: "tool:debate-market",
        kind: "action",
        icon: Scale,
        iconColor: "var(--accent-purple)",
        title: "AI 多空辩论 · 大盘",
        keywords: ["debate", "辩论", "多空", "大盘"],
        run: () => {
          openDebate("market", undefined, "今日大盘");
          close();
        },
      },
    ];

    // 给"对当前查询股"配一个一键 WhyRose 的快捷动作
    if (/^\d{6}$/.test(query.trim())) {
      const code = query.trim();
      toolActions.unshift({
        id: `quick-whyrose:${code}`,
        kind: "action",
        icon: Zap,
        iconColor: "var(--accent-orange)",
        title: `AI 解读 · 为什么涨/跌 ${code}`,
        keywords: [code],
        run: () => {
          openWhyRose(code);
          close();
        },
      });
    }
    toolActions.forEach((t) => {
      if (q && !t.title.toLowerCase().includes(q) && !t.keywords.some((k) => k.toLowerCase().includes(q))) return;
      out.push(t);
    });

    return out;
  }, [
    hits,
    watchlist,
    recent,
    query,
    runStock,
    setActiveModule,
    close,
    toggleAiPanel,
    openAnomalyDrawer,
    openDebate,
    openWhyRose,
  ]);

  const universeLabel = useMemo(
    () => UNIVERSE_OPTIONS.find((o) => o.value === universe)?.label ?? universe,
    [universe],
  );

  const useVirtualList = commands.length > 30;
  // TanStack Virtual is intentionally not React Compiler–memoization-friendly; list is correct at runtime.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: commands.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 36,
    overscan: 8,
  });

  const rowVRef = useRef(rowVirtualizer);
  rowVRef.current = rowVirtualizer;
  useEffect(() => {
    if (!useVirtualList || commands.length === 0) return;
    rowVRef.current.scrollToIndex(active, { align: "auto" });
  }, [active, useVirtualList, commands.length]);

  // 切组时把 active 拉回 0
  useEffect(() => {
    setActive(0);
  }, [query]);

  const onKeyDownInput = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(commands.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = commands[active];
      if (cmd) cmd.run();
    }
  };

  const renderCommandRow = (i: number) => {
    const cmd = commands[i];
    if (!cmd) return null;
    const Icon = cmd.icon;
    const isActive = i === active;
    return (
      <button
        key={cmd.id}
        type="button"
        onClick={cmd.run}
        onMouseEnter={() => setActive(i)}
        className="w-full flex items-center gap-2 px-3 rounded transition-colors"
        style={{
          height: 36,
          background: isActive ? "rgba(168,85,247,0.12)" : "transparent",
          borderLeft: isActive ? "2px solid var(--accent-purple)" : "2px solid transparent",
          textAlign: "left",
        }}
      >
        <Icon size={14} style={{ color: cmd.iconColor || "var(--text-muted)", flexShrink: 0 }} />
        <div className="flex items-center gap-1 min-w-0 max-w-[46%] flex-shrink-0">
          <span
            className="font-medium truncate"
            style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
          >
            {cmd.title}
          </span>
          {cmd.searchMeta && (
            <StockStatusBadge status={cmd.searchMeta.status} board={cmd.searchMeta.board} size="sm" />
          )}
        </div>
        {cmd.subtitle && (
          <span
            className="truncate flex-1 min-w-0"
            style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 6 }}
          >
            {cmd.subtitle}
          </span>
        )}
        {cmd.tag && (
          <span
            className="ml-auto px-1.5 rounded flex-shrink-0"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-muted)",
              fontSize: 9,
              fontWeight: 700,
            }}
          >
            {cmd.tag}
          </span>
        )}
        {!cmd.tag && isActive && (
          <ChevronRight
            size={12}
            className="ml-auto flex-shrink-0"
            style={{ color: "var(--accent-purple)" }}
          />
        )}
        {!cmd.tag && !isActive && <span className="ml-auto flex-shrink-0" style={{ width: 12 }} />}
      </button>
    );
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        style={{ background: "rgba(0,0,0,0.55)" }}
        onClick={close}
      />
      <div
        role="dialog"
        aria-label="命令面板"
        className="fixed left-1/2 z-[60] -translate-x-1/2"
        style={{
          top: "12vh",
          width: 640,
          maxWidth: "92vw",
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: 8,
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          overflow: "hidden",
        }}
      >
        <div
          className="flex items-center gap-2 px-3"
          style={{
            height: 44,
            borderBottom: "1px solid var(--border-color)",
            background: "var(--bg-secondary)",
          }}
        >
          <Search size={14} style={{ color: "var(--text-muted)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDownInput}
            placeholder="搜股票代码 / 跳转模块 / AI 解读 (按 ↑ ↓ 选, Enter 执行)"
            autoFocus
            className="flex-1 bg-transparent outline-none"
            style={{
              color: "var(--text-primary)",
              fontSize: "var(--font-md)",
            }}
          />
          {searching && (
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>搜索中...</span>
          )}
          <kbd
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 3,
              background: "var(--bg-tertiary)",
              color: "var(--text-muted)",
              border: "1px solid var(--border-color)",
            }}
          >
            Esc
          </kbd>
          <button
            onClick={close}
            className="p-1 rounded transition-opacity hover:opacity-80"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </div>

        <div
          ref={listScrollRef}
          style={{
            maxHeight: "60vh",
            overflowY: "auto",
            padding: 4,
          }}
        >
          {query.trim() && hits.length > 0 && (
            <div className="px-3 py-1" style={{ fontSize: 10, color: "var(--text-muted)" }}>
              搜索结果 · {universeLabel}
            </div>
          )}
          {commands.length === 0 && (
            <div
              className="px-4 py-8 text-center"
              style={{ color: "var(--text-muted)", fontSize: 12 }}
            >
              {query.trim() ? "没有匹配项" : "试试: 输入股票代码 / 跳模块 / 'ai'"}
            </div>
          )}
          {commands.length > 0 && !useVirtualList && commands.map((_, i) => renderCommandRow(i))}
          {commands.length > 0 && useVirtualList && (
            <div
              style={{
                height: rowVirtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => (
                <div
                  key={virtualRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {renderCommandRow(virtualRow.index)}
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className="flex items-center gap-3 px-3"
          style={{
            height: 24,
            background: "var(--bg-secondary)",
            borderTop: "1px solid var(--border-color)",
            color: "var(--text-muted)",
            fontSize: 10,
          }}
        >
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1 rounded" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }}>↑↓</kbd>
            选择
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1 rounded" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }}>Enter</kbd>
            执行
          </span>
          <span className="inline-flex items-center gap-1 ml-auto">
            <ArrowRight size={9} />
            按代码搜或选 Action
          </span>
        </div>
      </div>
    </>
  );
}
