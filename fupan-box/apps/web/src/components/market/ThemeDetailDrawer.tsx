"use client";

import { useState, useEffect, useCallback } from "react";
import { X, TrendingUp, TrendingDown } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { StockCapitalChip } from "./StockCapitalChip";

interface ThemeStock {
  stock_code: string;
  stock_name: string;
  change_pct: number;
  amount: number;
  turnover_rate: number;
  is_limit_up: boolean;
  continuous_days: number;
}

interface ThemeDetail {
  total: number;
  all: ThemeStock[];
  limit_up: ThemeStock[];
  hot: ThemeStock[];
  core: ThemeStock[];
  high: ThemeStock[];
}

type SubTab = "limit_up" | "all" | "hot" | "core" | "high";

const SUB_TABS: { key: SubTab; label: string; desc: string }[] = [
  { key: "limit_up", label: "涨停", desc: "当日涨停的成分股" },
  { key: "all", label: "全部", desc: "全部成分股按涨幅排序" },
  { key: "hot", label: "人气", desc: "按成交额排名的高热度股" },
  { key: "core", label: "中军", desc: "市值最大的核心股" },
  { key: "high", label: "高标", desc: "近期涨幅最高的强势股" },
];

interface Props {
  themeName: string | null;
  onClose: () => void;
}

export function ThemeDetailDrawer({ themeName, onClose }: Props) {
  const [detail, setDetail] = useState<ThemeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState<SubTab>("limit_up");
  const openStockDetail = useUIStore((s) => s.openStockDetail);

  const fetchDetail = useCallback(async (name: string) => {
    setLoading(true);
    setSubTab("limit_up");
    try {
      const data = await api.getThemeDetail(name);
      setDetail(data as unknown as ThemeDetail);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (themeName) {
      fetchDetail(themeName);
    } else {
      setDetail(null);
    }
  }, [themeName, fetchDetail]);

  if (!themeName) return null;

  const stocks = detail ? detail[subTab] : [];
  const tabCounts: Record<SubTab, number> = detail
    ? { limit_up: detail.limit_up.length, all: detail.all.length, hot: detail.hot.length, core: detail.core.length, high: detail.high.length }
    : { limit_up: 0, all: 0, hot: 0, core: 0, high: 0 };

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={onClose}
      />
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
        style={{
          width: 400,
          background: "var(--bg-primary)",
          borderLeft: "1px solid var(--border-color)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{
            background: "var(--bg-secondary)",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <div>
            <span className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
              {themeName}
            </span>
            {detail && (
              <span className="ml-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
                共{detail.total}只
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="flex gap-0.5 px-3 py-1"
          style={{ borderBottom: "1px solid var(--border-color)" }}
        >
          {SUB_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSubTab(key)}
              className="px-2 py-1 text-[11px] font-medium transition-colors relative"
              style={{ color: subTab === key ? "var(--text-primary)" : "var(--text-muted)" }}
              title={SUB_TABS.find((t) => t.key === key)?.desc}
            >
              {label}
              <span
                className="ml-0.5 text-[9px]"
                style={{ color: subTab === key ? "var(--accent-orange)" : "var(--text-muted)" }}
              >
                {tabCounts[key]}
              </span>
              {subTab === key && (
                <div
                  className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full"
                  style={{ background: "var(--accent-orange)" }}
                />
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: "var(--bg-card)" }} />
            ))
          ) : stocks.length === 0 ? (
            <div className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              暂无数据
            </div>
          ) : (
            stocks.map((s) => (
              <div
                key={s.stock_code}
                onClick={() => openStockDetail(s.stock_code)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs" style={{ color: "var(--text-primary)" }}>
                      {s.stock_name}
                    </span>
                    <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                      {s.stock_code}
                    </span>
                    {s.continuous_days >= 2 && (
                      <span
                        className="px-1 py-0.5 rounded text-[9px] font-bold"
                        style={{ background: "rgba(239,68,68,0.15)", color: "var(--accent-red)" }}
                      >
                        {s.continuous_days}板
                      </span>
                    )}
                    {s.is_limit_up && s.continuous_days < 2 && (
                      <span
                        className="px-1 py-0.5 rounded text-[9px]"
                        style={{ background: "rgba(239,68,68,0.12)", color: "var(--accent-red)" }}
                      >
                        涨停
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    <span>{(s.amount / 1e8).toFixed(1)}亿</span>
                    <span>换手{s.turnover_rate.toFixed(1)}%</span>
                  </div>
                  <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                    <StockCapitalChip code={s.stock_code} variant="compact" silent />
                  </div>
                </div>
                <span
                  className="font-bold text-xs tabular-nums"
                  style={{
                    color: s.change_pct >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                  }}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {s.change_pct >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {s.change_pct >= 0 ? "+" : ""}{s.change_pct.toFixed(2)}%
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
