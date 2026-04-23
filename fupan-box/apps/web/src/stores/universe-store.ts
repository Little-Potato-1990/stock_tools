import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Universe =
  | "default" | "wide" | "active_only" | "st_only" | "delisted_only";

export const UNIVERSE_OPTIONS: Array<{ value: Universe; label: string; hint: string }> = [
  { value: "default",       label: "在市 + ST",     hint: "默认; 含正常上市 + ST/*ST, 不含退市/停牌" },
  { value: "wide",          label: "全 A 含退市",   hint: "5800+; 完整搜索 / 含退市股/历史" },
  { value: "active_only",   label: "仅在市非 ST",   hint: "只看常规上市股" },
  { value: "st_only",       label: "仅 ST/*ST",     hint: "风险警示标的" },
  { value: "delisted_only", label: "仅退市",        hint: "已退市标的, 适合复盘" },
];

interface State {
  universe: Universe;
  setUniverse: (u: Universe) => void;
}

export const useUniverseStore = create<State>()(
  persist(
    (set) => ({
      universe: "default",
      setUniverse: (universe) => set({ universe }),
    }),
    { name: "fupan_universe" }
  )
);
