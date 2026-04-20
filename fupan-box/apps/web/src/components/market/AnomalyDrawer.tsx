"use client";

import { useCallback, useEffect, useState } from "react";
import { X, AlertTriangle, TrendingUp, TrendingDown, Unlock, Lock, Sparkles, RefreshCw, CheckCheck } from "lucide-react";
import { api, type Anomaly } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";

const TYPE_META: Record<string, { color: string; icon: typeof TrendingUp }> = {
  surge: { color: "#ff5252", icon: TrendingUp },
  plunge: { color: "#3f8aff", icon: TrendingDown },
  break: { color: "#ffaa33", icon: Unlock },
  seal: { color: "#22c55e", icon: Lock },
  theme_burst: { color: "#a855f7", icon: AlertTriangle },
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso.slice(11, 19);
  }
}

export function AnomalyDrawer() {
  const open = useUIStore((s) => s.anomalyDrawerOpen);
  const close = useUIStore((s) => s.closeAnomalyDrawer);
  const openStockDetail = useUIStore((s) => s.openStockDetail);

  const [items, setItems] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "surge" | "plunge" | "break" | "seal">("all");
  const [briefLoading, setBriefLoading] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listAnomalies(80, 1);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const askAiBrief = useCallback(async (id: number) => {
    setBriefLoading(id);
    try {
      const d = await api.getAnomalyDetail(id);
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ai_brief: d.ai_brief } : it)));
    } finally {
      setBriefLoading(null);
    }
  }, []);

  const markAllSeen = useCallback(async () => {
    await api.markAnomaliesSeen(undefined, true);
    setItems((prev) => prev.map((it) => ({ ...it, seen: true })));
  }, []);

  const filtered = filter === "all" ? items : items.filter((it) => it.anomaly_type === filter);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={close}
      />
      <div
        className="fixed top-0 right-0 z-50 h-full overflow-y-auto"
        style={{
          width: 420,
          background: "var(--bg-primary)",
          borderLeft: "1px solid var(--border-color)",
          boxShadow: "-4px 0 16px rgba(0,0,0,0.3)",
        }}
      >
        <div
          className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
          style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)" }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} style={{ color: "#ff5252" }} />
            <span className="font-bold" style={{ color: "var(--text-primary)" }}>盘中异动</span>
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{filtered.length} 条</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              title="刷新"
              className="p-1.5 rounded hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={markAllSeen}
              title="全部已读"
              className="p-1.5 rounded hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
            >
              <CheckCheck size={14} />
            </button>
            <button
              onClick={close}
              className="p-1.5 rounded hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-4 py-2 flex gap-1 overflow-x-auto" style={{ borderBottom: "1px solid var(--border-color)" }}>
          {([
            ["all", "全部"],
            ["surge", "急拉"],
            ["plunge", "闪崩"],
            ["break", "炸板"],
            ["seal", "封板"],
          ] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className="px-2.5 py-1 rounded-full"
              style={{
                fontSize: 11,
                background: filter === k ? "var(--accent)" : "var(--bg-tertiary)",
                color: filter === k ? "#fff" : "var(--text-secondary)",
                border: "1px solid var(--border-color)",
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {filtered.length === 0 && !loading && (
          <div className="p-8 text-center" style={{ color: "var(--text-muted)" }}>
            暂无异动 · 9:30 - 15:00 自动扫描
          </div>
        )}

        <div className="px-2 py-2 space-y-2">
          {filtered.map((it) => {
            const meta = TYPE_META[it.anomaly_type] ?? TYPE_META.surge;
            const Icon = meta.icon;
            return (
              <div
                key={it.id}
                className="rounded-md p-3"
                style={{
                  background: it.seen ? "var(--bg-secondary)" : "var(--bg-tertiary)",
                  border: `1px solid ${it.seen ? "var(--border-color)" : meta.color + "55"}`,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon size={14} style={{ color: meta.color, flexShrink: 0 }} />
                    <span className="font-semibold" style={{ color: meta.color, fontSize: 12 }}>
                      {it.anomaly_label}
                    </span>
                    {it.code && (
                      <button
                        onClick={() => openStockDetail(it.code!, it.name ?? undefined)}
                        className="font-medium truncate hover:underline"
                        style={{ color: "var(--text-primary)", fontSize: 13 }}
                      >
                        {it.name ?? it.code}
                        <span style={{ color: "var(--text-muted)", marginLeft: 4, fontSize: 11 }}>{it.code}</span>
                      </button>
                    )}
                  </div>
                  <span style={{ color: "var(--text-muted)", fontSize: 10, flexShrink: 0 }}>
                    {formatTime(it.detected_at)}
                  </span>
                </div>

                <div className="flex items-center gap-3 mt-2" style={{ fontSize: 12 }}>
                  {it.change_pct != null && (
                    <span style={{ color: it.change_pct >= 0 ? "#ff5252" : "#3f8aff" }}>
                      {it.change_pct >= 0 ? "+" : ""}{it.change_pct.toFixed(2)}%
                    </span>
                  )}
                  {it.delta_5m_pct != null && (
                    <span style={{ color: "var(--text-secondary)" }}>
                      5min: {it.delta_5m_pct >= 0 ? "+" : ""}{it.delta_5m_pct.toFixed(1)}%
                    </span>
                  )}
                  {it.price != null && (
                    <span style={{ color: "var(--text-muted)" }}>¥{it.price.toFixed(2)}</span>
                  )}
                  {it.volume_yi != null && (
                    <span style={{ color: "var(--text-muted)" }}>{it.volume_yi.toFixed(1)}亿</span>
                  )}
                  <span
                    style={{
                      marginLeft: "auto",
                      color: it.severity >= 4 ? "#ff5252" : "var(--text-muted)",
                      fontSize: 10,
                    }}
                  >
                    SEV {it.severity}
                  </span>
                </div>

                {it.ai_brief ? (
                  <div
                    className="mt-2 p-2 rounded flex items-start gap-1.5"
                    style={{
                      background: "rgba(168, 85, 247, 0.08)",
                      border: "1px solid rgba(168, 85, 247, 0.3)",
                      fontSize: 11,
                      color: "var(--text-primary)",
                      lineHeight: 1.5,
                    }}
                  >
                    <Sparkles size={11} style={{ color: "#a855f7", flexShrink: 0, marginTop: 2 }} />
                    <span>{it.ai_brief}</span>
                  </div>
                ) : (
                  <button
                    onClick={() => askAiBrief(it.id)}
                    disabled={briefLoading === it.id}
                    className="mt-2 px-2 py-1 rounded inline-flex items-center gap-1"
                    style={{
                      fontSize: 10,
                      background: "rgba(168, 85, 247, 0.12)",
                      color: "#c084fc",
                      border: "1px solid rgba(168, 85, 247, 0.3)",
                    }}
                  >
                    <Sparkles size={10} />
                    {briefLoading === it.id ? "解读中..." : "AI 解读"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
