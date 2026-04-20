import { create } from "zustand";

export type StrongScope = "recent" | "main" | "gem" | "star" | "bj";
export type CapitalScope = "wind" | "industry" | "theme" | "front_volume";
export type LhbScope = "daily" | "office_history" | "hot_money";

export type NavModule =
  | "today"
  | "sentiment"
  | "ladder"
  | "strong"
  | "themes"
  | "industries"
  | "capital"
  | "lhb"
  | "search"
  | "news"
  | "watchlist"
  | "ai_track"
  | "my_review"
  | "account"
  | "dashboard"
  | "bigdata";

/** 浮动徽章里展示的股票 (用户最近聚焦的) */
interface FocusedStock {
  code: string;
  name?: string;
}

/** 用户最近交互痕迹 (供 AI 副驾理解"刚才在看什么") */
export interface RecentInteraction {
  kind: "stock" | "theme" | "ai_explain";
  /** 股票代码 / 题材名 */
  key: string;
  /** 显示名 */
  label?: string;
  ts: number;
}

const RECENT_KEY = "ui:recent_interactions";
const RECENT_MAX = 12;

const loadRecent = (): RecentInteraction[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentInteraction[];
    if (!Array.isArray(arr)) return [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return arr.filter((it) => it && typeof it.ts === "number" && it.ts >= cutoff).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
};

const persistRecent = (arr: RecentInteraction[]) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, RECENT_MAX)));
  } catch {
    /* ignore */
  }
};

interface UIState {
  activeModule: NavModule;
  setActiveModule: (m: NavModule) => void;

  /** 强势股子模块 */
  strongScope: StrongScope;
  setStrongScope: (s: StrongScope) => void;

  /** 资金分析子模块 */
  capitalScope: CapitalScope;
  setCapitalScope: (s: CapitalScope) => void;

  /** 龙虎榜子模块 */
  lhbScope: LhbScope;
  setLhbScope: (s: LhbScope) => void;

  /** 龙虎榜营业部历史搜索预填（从每日榜/游资榜跳转） */
  lhbOfficeQuery: string;
  setLhbOfficeQuery: (q: string) => void;

  aiPanelOpen: boolean;
  toggleAiPanel: () => void;
  openAiPanel: () => void;
  closeAiPanel: () => void;

  selectedModel: string;
  setSelectedModel: (m: string) => void;

  conversationId: number | null;
  setConversationId: (id: number | null) => void;

  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;

  stockDetailCode: string | null;
  openStockDetail: (code: string, name?: string) => void;
  closeStockDetail: () => void;

  themeDetailName: string | null;
  openThemeDetail: (name: string) => void;
  closeThemeDetail: () => void;

  /** 「为什么涨/跌」单股 AI 解读弹层 */
  whyRoseStock: { code: string; name?: string; tradeDate?: string } | null;
  openWhyRose: (code: string, name?: string, tradeDate?: string) => void;
  closeWhyRose: () => void;

  /** 多 Agent 辩论弹层 */
  debateTopic: { type: "market" | "stock" | "theme"; key?: string; label?: string } | null;
  openDebate: (type: "market" | "stock" | "theme", key?: string, label?: string) => void;
  closeDebate: () => void;

  /** 盘中异动抽屉 */
  anomalyDrawerOpen: boolean;
  openAnomalyDrawer: () => void;
  closeAnomalyDrawer: () => void;

  /** 右下角浮动徽章里的股票 */
  focusedStock: FocusedStock | null;
  setFocusedStock: (s: FocusedStock | null) => void;

  /** AI 副驾的预填问题 (从其他模块快捷追问) */
  pendingChatPrompt: string | null;
  askAI: (prompt: string, focusedStock?: FocusedStock | null) => void;
  consumePendingPrompt: () => string | null;

  /** 最近 12 条用户交互痕迹 */
  recentInteractions: RecentInteraction[];
  /** 推入一条交互记录, 自动去重 + 截断 */
  pushInteraction: (it: Omit<RecentInteraction, "ts">) => void;
  clearInteractions: () => void;
}

const getStoredModel = () => {
  if (typeof window === "undefined") return "deepseek-v3";
  return localStorage.getItem("selectedModel") || "deepseek-v3";
};

export const useUIStore = create<UIState>((set) => ({
  activeModule: "today",
  setActiveModule: (m) => set({ activeModule: m }),

  strongScope: "recent",
  setStrongScope: (s) => set({ strongScope: s }),

  capitalScope: "wind",
  setCapitalScope: (s) => set({ capitalScope: s }),

  lhbScope: "daily",
  setLhbScope: (s) => set({ lhbScope: s }),

  lhbOfficeQuery: "",
  setLhbOfficeQuery: (q) => set({ lhbOfficeQuery: q }),

  aiPanelOpen: false,
  toggleAiPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
  openAiPanel: () => set({ aiPanelOpen: true }),
  closeAiPanel: () => set({ aiPanelOpen: false }),

  selectedModel: getStoredModel(),
  setSelectedModel: (m) => {
    if (typeof window !== "undefined") localStorage.setItem("selectedModel", m);
    set({ selectedModel: m });
  },

  conversationId: null,
  setConversationId: (id) => set({ conversationId: id }),

  isStreaming: false,
  setIsStreaming: (v) => set({ isStreaming: v }),

  stockDetailCode: null,
  openStockDetail: (code, name) => {
    set({ stockDetailCode: code, focusedStock: { code, name } });
    useUIStore.getState().pushInteraction({ kind: "stock", key: code, label: name });
  },
  closeStockDetail: () => set({ stockDetailCode: null }),

  themeDetailName: null,
  openThemeDetail: (name) => {
    set({ themeDetailName: name });
    useUIStore.getState().pushInteraction({ kind: "theme", key: name, label: name });
  },
  closeThemeDetail: () => set({ themeDetailName: null }),

  whyRoseStock: null,
  openWhyRose: (code, name, tradeDate) => {
    set({ whyRoseStock: { code, name, tradeDate }, focusedStock: { code, name } });
    useUIStore.getState().pushInteraction({ kind: "ai_explain", key: code, label: name });
  },
  closeWhyRose: () => set({ whyRoseStock: null }),

  debateTopic: null,
  openDebate: (type, key, label) => {
    set({ debateTopic: { type, key, label } });
    if (type === "stock" && key) {
      useUIStore.getState().pushInteraction({ kind: "ai_explain", key, label });
    }
  },
  closeDebate: () => set({ debateTopic: null }),

  anomalyDrawerOpen: false,
  openAnomalyDrawer: () => set({ anomalyDrawerOpen: true }),
  closeAnomalyDrawer: () => set({ anomalyDrawerOpen: false }),

  focusedStock: null,
  setFocusedStock: (s) => set({ focusedStock: s }),

  pendingChatPrompt: null,
  askAI: (prompt, focusedStock) =>
    set((s) => ({
      pendingChatPrompt: prompt,
      aiPanelOpen: true,
      focusedStock: focusedStock ?? s.focusedStock,
    })),
  consumePendingPrompt: () => {
    let val: string | null = null;
    set((s) => {
      val = s.pendingChatPrompt;
      return { pendingChatPrompt: null };
    });
    return val;
  },

  recentInteractions: loadRecent(),
  pushInteraction: (it) => {
    set((s) => {
      const next: RecentInteraction[] = [
        { ...it, ts: Date.now() },
        ...s.recentInteractions.filter((r) => !(r.kind === it.kind && r.key === it.key)),
      ].slice(0, RECENT_MAX);
      persistRecent(next);
      return { recentInteractions: next };
    });
  },
  clearInteractions: () => {
    persistRecent([]);
    set({ recentInteractions: [] });
  },
}));
