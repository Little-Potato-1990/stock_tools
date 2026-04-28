import { useEffect } from "react";
import { create } from "zustand";
import { api } from "@/lib/api";

type DataHealth = Awaited<ReturnType<typeof api.getDataHealth>>;

interface DataHealthState {
  data: DataHealth | null;
  loading: boolean;
  failed: boolean;
  fetching: boolean;
  lastFetched: number;
  fetch: () => Promise<void>;
}

const POLL_MS = 60_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let subscribers = 0;

export const useDataHealthStore = create<DataHealthState>((set, get) => ({
  data: null,
  loading: true,
  failed: false,
  fetching: false,
  lastFetched: 0,
  fetch: async () => {
    if (get().fetching) return;
    set((s) => ({ fetching: true, loading: s.data == null }));
    try {
      const d = await api.getDataHealth();
      set({
        data: d,
        failed: false,
        loading: false,
        fetching: false,
        lastFetched: Date.now(),
      });
    } catch {
      set({
        failed: true,
        loading: false,
        fetching: false,
      });
    }
  },
}));

function startPollingOnce() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void useDataHealthStore.getState().fetch();
  }, POLL_MS);
}

function stopPollingIfIdle() {
  if (subscribers > 0) return;
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

export function useDataHealth() {
  const data = useDataHealthStore((s) => s.data);
  const loading = useDataHealthStore((s) => s.loading);
  const failed = useDataHealthStore((s) => s.failed);
  const fetching = useDataHealthStore((s) => s.fetching);
  const lastFetched = useDataHealthStore((s) => s.lastFetched);
  const fetch = useDataHealthStore((s) => s.fetch);

  useEffect(() => {
    subscribers += 1;
    startPollingOnce();

    const stale = Date.now() - lastFetched > POLL_MS;
    if (lastFetched === 0 || stale) {
      void fetch();
    }

    return () => {
      subscribers = Math.max(0, subscribers - 1);
      stopPollingIfIdle();
    };
  }, [fetch, lastFetched]);

  return {
    data,
    loading,
    failed,
    fetching,
    refresh: fetch,
  };
}
