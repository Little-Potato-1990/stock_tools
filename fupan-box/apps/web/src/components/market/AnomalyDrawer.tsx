"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Unlock,
  Lock,
  Sparkles,
  RefreshCw,
  CheckCheck,
  Star,
  Target,
  Layers,
  List,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
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

type GroupKey = string; // theme name 或 "无主线"

export function AnomalyDrawer() {
  const open = useUIStore((s) => s.anomalyDrawerOpen);
  const close = useUIStore((s) => s.closeAnomalyDrawer);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const requestPlanFor = useUIStore((s) => s.requestPlanFor);
  const filterCode = useUIStore((s) => s.anomalyFilterCode);
  const setFilterCode = useUIStore((s) => s.setAnomalyFilterCode);

  const [items, setItems] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "surge" | "plunge" | "break" | "seal">("all");
  const [briefLoading, setBriefLoading] = useState<number | null>(null);
  /** P2 #13 视图模式: 平铺 / 按主线归并 */
  const [viewMode, setViewMode] = useState<"flat" | "grouped">(() => {
    if (typeof window === "undefined") return "grouped";
    return (localStorage.getItem("anomaly_view_mode") as "flat" | "grouped") || "grouped";
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GroupKey>>(new Set());
  /** 已加自选缓存, 仅用于按钮置灰提示 (不持久化) */
  const [watchedCodes, setWatchedCodes] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    if (!open || !api.isLoggedIn()) return;
    api
      .getWatchlist()
      .then((list) => {
        setWatchedCodes(new Set((list as Array<{ stock_code: string }>).map((w) => w.stock_code)));
      })
      .catch(() => setWatchedCodes(new Set()));
  }, [open]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("anomaly_view_mode", viewMode);
    }
  }, [viewMode]);

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

  const handleAddWatch = useCallback(async (code: string) => {
    if (!api.isLoggedIn()) {
      alert("请先到「我的自选」登录后再加自选");
      return;
    }
    try {
      await api.addToWatchlist(code);
      setWatchedCodes((prev) => new Set(prev).add(code));
    } catch (e) {
      alert(`加自选失败: ${(e as Error).message}`);
    }
  }, []);

  const filteredByType = filter === "all" ? items : items.filter((it) => it.anomaly_type === filter);
  const filtered = filterCode ? filteredByType.filter((it) => it.code === filterCode) : filteredByType;

  /**
   * P2 #13 主线归并:
   *   - theme_burst 类型直接以 anomaly.theme 为 key (一定有 theme)
   *   - 个股异动有 theme → 落到该主线
   *   - 个股异动无 theme → 落到 "无主线"
   * 组内按 detected_at 倒序; 组之间按 max severity 倒序排.
   */
  const groups = useMemo(() => {
    const map = new Map<GroupKey, Anomaly[]>();
    filtered.forEach((it) => {
      const k: GroupKey = it.theme || "其他·无主线";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    });
    const arr = Array.from(map.entries()).map(([key, list]) => ({
      key,
      list: list.sort((a, b) => (a.detected_at < b.detected_at ? 1 : -1)),
      maxSeverity: list.reduce((m, x) => Math.max(m, x.severity), 0),
      count: list.length,
    }));
    arr.sort((a, b) => {
      if (a.key === "其他·无主线") return 1;
      if (b.key === "其他·无主线") return -1;
      if (b.maxSeverity !== a.maxSeverity) return b.maxSeverity - a.maxSeverity;
      return b.count - a.count;
    });
    return arr;
  }, [filtered]);

  const toggleGroup = (k: GroupKey) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  if (!open) return null;

  const renderItem = (it: Anomaly) => {
    const meta = TYPE_META[it.anomaly_type] ?? TYPE_META.surge;
    const Icon = meta.icon;
    const isWatched = it.code ? watchedCodes.has(it.code) : false;
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

        {/* P1 #6 联动: 加自选 / 建计划 一键直达 */}
        {it.code && (
          <div className="mt-2 flex items-center gap-1">
            <button
              onClick={() => handleAddWatch(it.code!)}
              disabled={isWatched}
              className="px-2 py-1 rounded inline-flex items-center gap-1 transition-opacity"
              title={isWatched ? "已在自选" : "加入自选股"}
              style={{
                fontSize: 10,
                background: isWatched ? "var(--bg-tertiary)" : "rgba(245,158,11,0.14)",
                color: isWatched ? "var(--text-muted)" : "var(--accent-orange)",
                border: `1px solid ${isWatched ? "var(--border-color)" : "rgba(245,158,11,0.4)"}`,
                opacity: isWatched ? 0.6 : 1,
              }}
            >
              <Star size={10} />
              {isWatched ? "已自选" : "加自选"}
            </button>
            <button
              onClick={() => {
                requestPlanFor(it.code!, it.name ?? undefined);
                close();
              }}
              className="px-2 py-1 rounded inline-flex items-center gap-1 transition-opacity hover:opacity-80"
              title="为此股建一条计划"
              style={{
                fontSize: 10,
                background: "rgba(168,85,247,0.14)",
                color: "var(--accent-purple)",
                border: "1px solid rgba(168,85,247,0.4)",
              }}
            >
              <Target size={10} />
              建计划
            </button>
          </div>
        )}
      </div>
    );
  };

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
          width: 440,
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
            {/* P2 #13 平铺/归并切换 */}
            <button
              onClick={() => setViewMode((v) => (v === "flat" ? "grouped" : "flat"))}
              title={viewMode === "grouped" ? "切到平铺" : "按主线归并"}
              className="px-2 py-1 rounded inline-flex items-center gap-1 hover:bg-white/5"
              style={{
                fontSize: 10,
                color: "var(--text-secondary)",
                background: viewMode === "grouped" ? "rgba(168,85,247,0.12)" : "transparent",
                border: "1px solid var(--border-color)",
              }}
            >
              {viewMode === "grouped" ? <Layers size={11} /> : <List size={11} />}
              {viewMode === "grouped" ? "归并" : "平铺"}
            </button>
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

        {/* P1 #6: 当前按 code 过滤的提示 */}
        {filterCode && (
          <div
            className="px-4 py-2 flex items-center justify-between"
            style={{
              background: "rgba(168,85,247,0.08)",
              borderBottom: "1px solid rgba(168,85,247,0.3)",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              仅看 <span style={{ color: "var(--accent-orange)", fontWeight: 700 }}>{filterCode}</span> 的异动
            </span>
            <button
              onClick={() => setFilterCode(null)}
              className="px-2 py-0.5 rounded text-xs"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-color)",
              }}
            >
              清除
            </button>
          </div>
        )}

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

        {viewMode === "flat" ? (
          <div className="px-2 py-2 space-y-2">{filtered.map(renderItem)}</div>
        ) : (
          <div className="px-2 py-2 space-y-2">
            {groups.map((g) => {
              const collapsed = collapsedGroups.has(g.key);
              return (
                <div
                  key={g.key}
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 6,
                    overflow: "hidden",
                  }}
                >
                  <button
                    onClick={() => toggleGroup(g.key)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 transition-colors"
                    style={{
                      background:
                        g.key === "其他·无主线"
                          ? "var(--bg-tertiary)"
                          : "linear-gradient(90deg, rgba(168,85,247,0.18), transparent 70%)",
                      borderBottom: collapsed ? "none" : "1px solid var(--border-color)",
                    }}
                  >
                    {collapsed ? (
                      <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />
                    ) : (
                      <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
                    )}
                    <Layers
                      size={12}
                      style={{
                        color:
                          g.key === "其他·无主线" ? "var(--text-muted)" : "var(--accent-purple)",
                      }}
                    />
                    <span
                      className="font-bold truncate"
                      style={{
                        color: "var(--text-primary)",
                        fontSize: 12,
                      }}
                    >
                      {g.key}
                    </span>
                    <span
                      className="px-1.5 rounded ml-auto tabular-nums"
                      style={{
                        background: "var(--bg-card)",
                        color: "var(--text-secondary)",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {g.count}
                    </span>
                    {g.maxSeverity >= 4 && (
                      <span
                        className="px-1.5 rounded"
                        style={{
                          background: "var(--accent-red)",
                          color: "#fff",
                          fontSize: 9,
                          fontWeight: 700,
                        }}
                        title="最高严重度 ≥ 4"
                      >
                        SEV {g.maxSeverity}
                      </span>
                    )}
                  </button>
                  {!collapsed && (
                    <div className="p-2 space-y-2">{g.list.map(renderItem)}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
