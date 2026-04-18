"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { TrendingUp, TrendingDown } from "lucide-react";

type Dimension = "fund_flow" | "limit_up_order" | "hot_concept";

const DIMENSIONS: { key: Dimension; label: string; desc: string }[] = [
  { key: "fund_flow", label: "主力净流入", desc: "概念板块主力资金净流入排名" },
  { key: "limit_up_order", label: "涨停封单额", desc: "概念板块涨停股封单总额排名" },
  { key: "hot_concept", label: "人气概念", desc: "综合人气排名 (涨停数+涨幅)" },
];

interface RankItem {
  name: string;
  change_pct?: number;
  main_net_inflow?: number;
  main_net_pct?: number;
  super_big_net?: number;
  big_net?: number;
  order_amount?: number;
  up_count?: number;
  down_count?: number;
  lead_stock?: string;
  lead_stock_pct?: number;
}

interface RankData {
  dimension: string;
  label: string;
  items: RankItem[];
  error?: string;
}

function formatAmount(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return v.toFixed(0);
}

export function BigDataPage() {
  const [dim, setDim] = useState<Dimension>("fund_flow");
  const [data, setData] = useState<RankData | null>(null);
  const [loading, setLoading] = useState(false);
  const openThemeDetail = useUIStore((s) => s.openThemeDetail);

  const fetchData = useCallback(async (dimension: Dimension) => {
    setLoading(true);
    try {
      const res = await api.getBigdataRank(dimension);
      setData(res as unknown as RankData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(dim);
  }, [dim, fetchData]);

  return (
    <div>
      <div className="px-4 pt-3 pb-1">
        <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          大数据
        </h2>
      </div>

      <div
        className="flex gap-0.5 px-4 pt-1 sticky top-0 z-20"
        style={{ borderBottom: "1px solid var(--border-color)", background: "var(--bg-primary)" }}
      >
        {DIMENSIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setDim(key)}
            className="px-3 py-1.5 text-xs font-medium transition-colors relative"
            style={{ color: dim === key ? "var(--text-primary)" : "var(--text-muted)" }}
            title={DIMENSIONS.find((d) => d.key === key)?.desc}
          >
            {label}
            {dim === key && (
              <div
                className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full"
                style={{ background: "var(--accent-orange)" }}
              />
            )}
          </button>
        ))}
      </div>

      <div className="px-4 py-3 space-y-1.5">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "var(--bg-card)" }} />
          ))
        ) : !data || data.items.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {data?.error ? `数据获取失败: ${data.error}` : "暂无数据"}
            </div>
            <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
              部分维度需要交易日盘后数据
            </div>
          </div>
        ) : (
          data.items.map((item, i) => (
            <div
              key={item.name}
              onClick={() => openThemeDetail(item.name)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}
            >
              <span
                className="w-6 text-center text-[10px] font-bold tabular-nums"
                style={{ color: i < 3 ? "var(--accent-orange)" : "var(--text-muted)" }}
              >
                {i + 1}
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>
                    {item.name}
                  </span>
                  {item.up_count != null && (
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      <span style={{ color: "var(--accent-red)" }}>{item.up_count}</span>
                      /{item.down_count ?? 0}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {dim === "fund_flow" && item.main_net_inflow != null && (
                    <>
                      <span>
                        主力{" "}
                        <span style={{
                          color: item.main_net_inflow >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                          fontWeight: 600,
                        }}>
                          {formatAmount(item.main_net_inflow)}
                        </span>
                      </span>
                      {item.super_big_net != null && (
                        <span>
                          超大{" "}
                          <span style={{
                            color: item.super_big_net >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                          }}>
                            {formatAmount(item.super_big_net)}
                          </span>
                        </span>
                      )}
                    </>
                  )}
                  {dim === "limit_up_order" && item.order_amount != null && (
                    <span>
                      封单总额{" "}
                      <span style={{ color: "var(--accent-red)", fontWeight: 600 }}>
                        {formatAmount(item.order_amount)}
                      </span>
                    </span>
                  )}
                  {dim === "hot_concept" && item.lead_stock && (
                    <span>
                      领涨{" "}
                      <span style={{ color: "var(--text-secondary)" }}>{item.lead_stock}</span>
                      <span style={{
                        color: (item.lead_stock_pct ?? 0) >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                      }}>
                        {" "}{(item.lead_stock_pct ?? 0) >= 0 ? "+" : ""}{(item.lead_stock_pct ?? 0).toFixed(1)}%
                      </span>
                    </span>
                  )}
                </div>
              </div>

              {item.change_pct != null && (
                <span
                  className="font-bold text-sm tabular-nums whitespace-nowrap inline-flex items-center gap-0.5"
                  style={{
                    color: item.change_pct >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                  }}
                >
                  {item.change_pct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {item.change_pct >= 0 ? "+" : ""}{item.change_pct.toFixed(2)}%
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
