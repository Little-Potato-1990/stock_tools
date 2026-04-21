import { useEffect } from "react";
import { create } from "zustand";
import { api, type PrivateStatus } from "@/lib/api";

interface State {
  data: PrivateStatus | null;
  lastFetched: number;
  loading: boolean;
  /** 主动拉一次, 已在 loading 中则跳过 */
  fetch: () => Promise<void>;
  reset: () => void;
}

export const usePrivateStatusStore = create<State>((set, get) => ({
  data: null,
  lastFetched: 0,
  loading: false,
  fetch: async () => {
    if (!api.isLoggedIn()) {
      set({ data: null, lastFetched: Date.now() });
      return;
    }
    if (get().loading) return;
    set({ loading: true });
    try {
      const d = await api.getPrivateStatus();
      set({ data: d, lastFetched: Date.now() });
    } catch {
      /* 失败保持上一次数据, 不阻塞 UI */
    } finally {
      set({ loading: false });
    }
  },
  reset: () => set({ data: null, lastFetched: 0 }),
}));

/**
 * 订阅私人状态. 多个组件共享同一份数据 + 一份 setInterval (实现简单, 多 mount 时会有多个轮询,
 * 但 fetch 内部有 loading guard, 不会并发请求).
 */
export function usePrivateStatus(pollMs = 60_000): PrivateStatus | null {
  const data = usePrivateStatusStore((s) => s.data);
  const fetchFn = usePrivateStatusStore((s) => s.fetch);

  useEffect(() => {
    fetchFn();
    const t = setInterval(fetchFn, pollMs);
    return () => clearInterval(t);
  }, [fetchFn, pollMs]);

  return data;
}
