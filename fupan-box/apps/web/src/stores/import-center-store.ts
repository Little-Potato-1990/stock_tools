import { create } from "zustand";

export type ImportKind = "holdings" | "trades";

interface ImportCenterState {
  isOpen: boolean;
  kind: ImportKind;
  open: (k: ImportKind) => void;
  close: () => void;
}

export const useImportCenterStore = create<ImportCenterState>((set) => ({
  isOpen: false,
  kind: "holdings",
  open: (k) => set({ isOpen: true, kind: k }),
  close: () => set({ isOpen: false }),
}));
