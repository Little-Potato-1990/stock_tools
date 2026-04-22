import { create } from "zustand";

/**
 * 用户级显示偏好 (持久化到 localStorage):
 * - colorPref: 涨跌色规则
 *     red-up   = 红涨绿跌 (A 股默认)
 *     green-up = 绿涨红跌 (美股 / 部分用户偏好)
 *
 * - density: 信息密度 (预留, 当前仅影响顶部状态条)
 *
 * 实现技巧: globals.css 里通过 `:root[data-color-pref="green-up"]` 重新覆盖
 * `--accent-red / --accent-green / --cell-red-* / --cell-green-*` 这几个变量,
 * 因此现存所有 "红=涨/绿=跌" 的硬编码 var() 不需要改一行代码.
 */

export type ColorPref = "red-up" | "green-up";
export type Density = "compact" | "comfortable";

const COLOR_KEY = "ui:color_pref";
const DENSITY_KEY = "ui:density";

const loadColorPref = (): ColorPref => {
  if (typeof window === "undefined") return "red-up";
  const v = localStorage.getItem(COLOR_KEY);
  return v === "green-up" ? "green-up" : "red-up";
};

const loadDensity = (): Density => {
  if (typeof window === "undefined") return "comfortable";
  const v = localStorage.getItem(DENSITY_KEY);
  return v === "compact" ? "compact" : "comfortable";
};

interface ThemeState {
  colorPref: ColorPref;
  setColorPref: (p: ColorPref) => void;

  density: Density;
  setDensity: (d: Density) => void;

  /** 把 store 当前值同步到 <html> 的 data-* 属性, 触发 CSS 变量切换 */
  applyToDocument: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  colorPref: loadColorPref(),
  setColorPref: (p) => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(COLOR_KEY, p);
      } catch {
        /* ignore quota */
      }
    }
    set({ colorPref: p });
    get().applyToDocument();
  },

  density: loadDensity(),
  setDensity: (d) => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(DENSITY_KEY, d);
      } catch {
        /* ignore */
      }
    }
    set({ density: d });
    get().applyToDocument();
  },

  applyToDocument: () => {
    if (typeof document === "undefined") return;
    const { colorPref, density } = get();
    document.documentElement.setAttribute("data-color-pref", colorPref);
    document.documentElement.setAttribute("data-density", density);
  },
}));
