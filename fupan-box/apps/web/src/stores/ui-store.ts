import { create } from "zustand";

export type StrongScope = "recent" | "main" | "gem" | "star" | "bj";
export type CapitalScope = "wind" | "industry" | "theme" | "front_volume";
export type LhbScope = "daily" | "office_history" | "hot_money";

export type NavModule =
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
  | "dashboard"
  | "bigdata";

/** 浮动徽章里展示的股票 (用户最近聚焦的) */
interface FocusedStock {
  code: string;
  name?: string;
}

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

  /** 右下角浮动徽章里的股票 */
  focusedStock: FocusedStock | null;
  setFocusedStock: (s: FocusedStock | null) => void;
}

const getStoredModel = () => {
  if (typeof window === "undefined") return "deepseek-v3";
  return localStorage.getItem("selectedModel") || "deepseek-v3";
};

export const useUIStore = create<UIState>((set) => ({
  activeModule: "sentiment",
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
  openStockDetail: (code, name) =>
    set({
      stockDetailCode: code,
      focusedStock: { code, name },
    }),
  closeStockDetail: () => set({ stockDetailCode: null }),

  themeDetailName: null,
  openThemeDetail: (name) => set({ themeDetailName: name }),
  closeThemeDetail: () => set({ themeDetailName: null }),

  focusedStock: null,
  setFocusedStock: (s) => set({ focusedStock: s }),
}));
