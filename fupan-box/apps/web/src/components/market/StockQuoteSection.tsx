"use client";

/**
 * 个股「行情盘口」展示块.
 *
 * 内容: 基础资料表 / 所属概念 chips / 最近涨停原因 / 近期行情表.
 * 抽自原 StockSearchPage 的 StockDetailInline, 给「个股深度」页 QuoteTab 复用.
 *
 * 数据自取 (传 code 即可), 调用方无需自己 fetch.
 */

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";

export interface StockQuoteDetail {
  stock_code: string;
  stock_name: string;
  market_label?: string;
  industry?: string;
  list_date?: string;
  is_st?: boolean;
  limit_reason?: string | null;
  continuous_days?: number;
  last_limit_date?: string | null;
  all_themes?: string[];
  recent_quotes?: {
    trade_date: string;
    open: number;
    close: number;
    high: number;
    low: number;
    change_pct: number;
    amount: number;
    is_limit_up: boolean;
    is_limit_down: boolean;
  }[];
}

interface Props {
  code: string;
  /** 可选: 顶部右上角操作区 (例如「打开 Drawer」按钮); 不传则不显示标题行右侧操作 */
  headerActions?: React.ReactNode;
  /** 可选: 「问 AI 为什么涨/跌」按钮 (默认显示) */
  showWhyRose?: boolean;
}

export function StockQuoteSection({ code, headerActions, showWhyRose = true }: Props) {
  const [detail, setDetail] = useState<StockQuoteDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const openThemeDetail = useUIStore((s) => s.openThemeDetail);
  const openWhyRose = useUIStore((s) => s.openWhyRose);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setActiveTheme(null);
    api
      .getStockDetail(code)
      .then((d) => alive && setDetail(d as unknown as StockQuoteDetail))
      .catch(() => alive && setDetail(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [code]);

  if (loading && !detail) {
    return (
      <div
        className="px-4 py-6 text-center"
        style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
      >
        加载中…
      </div>
    );
  }
  if (!detail) {
    return (
      <div
        className="px-4 py-6 text-center"
        style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
      >
        暂无 {code} 的行情数据
      </div>
    );
  }

  const themes = detail.all_themes ?? [];

  return (
    <div className="px-4 py-2 space-y-4">
      {/* 标题行 (仅在有 headerActions 或 showWhyRose 时渲染) */}
      {(headerActions || showWhyRose) && (
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-baseline gap-2">
            <span
              className="font-bold"
              style={{ color: "var(--text-primary)", fontSize: "var(--font-xl)" }}
            >
              {detail.stock_name}
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
              {detail.stock_code}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {showWhyRose && (
              <button
                onClick={() => openWhyRose(detail.stock_code, detail.stock_name)}
                className="flex items-center gap-1 font-semibold transition-colors"
                style={{
                  background: "rgba(168,85,247,0.12)",
                  color: "var(--accent-purple)",
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: "var(--font-sm)",
                  border: "1px solid rgba(168,85,247,0.32)",
                }}
                title="AI 解读今日涨跌原因"
              >
                <Sparkles size={11} />
                为什么涨/跌
              </button>
            )}
            {headerActions}
          </div>
        </div>
      )}

      {/* 基础资料表 */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: "auto 1fr auto 1fr auto 1fr",
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        {[
          ["股票代码", detail.stock_code],
          ["交易所", detail.market_label || "-"],
          ["上市日期", detail.list_date || "-"],
          [
            "行业",
            <span key="ind">
              {detail.industry || "-"}
              {detail.is_st && (
                <span
                  className="ml-1.5 inline-block"
                  style={{
                    background: "var(--accent-orange)",
                    color: "#1a1d28",
                    fontSize: 9,
                    padding: "0 4px",
                    borderRadius: 2,
                    fontWeight: 700,
                  }}
                >
                  ST
                </span>
              )}
            </span>,
          ],
          [
            "最近涨停",
            detail.last_limit_date
              ? `${detail.last_limit_date} (${detail.continuous_days || 0}板)`
              : "-",
          ],
          ["全称", detail.stock_name],
        ].map(([label, val], i) => (
          <div key={i} className="contents">
            <div
              style={{
                padding: "8px 12px",
                background: "var(--bg-tertiary)",
                color: "var(--text-muted)",
                borderBottom: i < 3 ? "1px solid var(--border-color)" : "none",
                borderRight: "1px solid var(--border-color)",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </div>
            <div
              style={{
                padding: "8px 12px",
                color: "var(--text-primary)",
                borderBottom: i < 3 ? "1px solid var(--border-color)" : "none",
                borderRight:
                  i % 3 < 2 ? "1px solid var(--border-color)" : "none",
                fontWeight: 600,
              }}
            >
              {val}
            </div>
          </div>
        ))}
      </div>

      {/* 所属概念 chips */}
      <div>
        <div
          className="font-bold mb-2"
          style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
        >
          所属概念
        </div>
        {themes.length === 0 ? (
          <div
            style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
          >
            暂无概念数据
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {themes.map((t) => (
              <button
                key={t}
                onClick={() => setActiveTheme(activeTheme === t ? null : t)}
                className="font-semibold transition-colors"
                style={{
                  padding: "4px 10px",
                  borderRadius: 3,
                  fontSize: "var(--font-sm)",
                  background:
                    activeTheme === t
                      ? "var(--accent-orange)"
                      : "var(--bg-card)",
                  color:
                    activeTheme === t ? "#1a1d28" : "var(--text-secondary)",
                  border: `1px solid ${
                    activeTheme === t
                      ? "var(--accent-orange)"
                      : "var(--border-color)"
                  }`,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 选中题材 → 详情链接 */}
      {activeTheme && (
        <div
          className="flex items-center justify-between px-3 py-2 rounded"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
          }}
        >
          <span style={{ color: "var(--text-primary)" }}>
            <span style={{ color: "var(--text-muted)" }}>已选概念: </span>
            <span className="font-bold">{activeTheme}</span>
          </span>
          <button
            onClick={() => openThemeDetail(activeTheme)}
            className="font-semibold transition-colors"
            style={{
              background: "var(--accent-orange)",
              color: "#1a1d28",
              padding: "3px 10px",
              borderRadius: 3,
              fontSize: "var(--font-sm)",
            }}
          >
            查看相关个股 →
          </button>
        </div>
      )}

      {/* 涨停原因 */}
      {detail.limit_reason && (
        <div>
          <div
            className="font-bold mb-2"
            style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
          >
            最近涨停原因
          </div>
          <div
            className="px-3 py-2 rounded"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              color: "var(--text-secondary)",
              fontSize: "var(--font-sm)",
              lineHeight: 1.6,
            }}
          >
            {detail.limit_reason}
          </div>
        </div>
      )}

      {/* 近期行情表 */}
      {detail.recent_quotes && detail.recent_quotes.length > 0 && (
        <div>
          <div
            className="font-bold mb-2"
            style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
          >
            近期行情
          </div>
          <div
            className="overflow-x-auto rounded"
            style={{ border: "1px solid var(--border-color)" }}
          >
            <table className="w-full" style={{ fontSize: 11 }}>
              <thead>
                <tr style={{ background: "var(--bg-tertiary)" }}>
                  {["日期", "开", "收", "高", "低", "涨跌幅", "成交"].map(
                    (h) => (
                      <th
                        key={h}
                        className="font-semibold"
                        style={{
                          padding: "6px 8px",
                          color: "var(--text-muted)",
                          textAlign: "left",
                        }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {detail.recent_quotes.map((q, idx) => (
                  <tr
                    key={q.trade_date}
                    style={{
                      borderTop:
                        idx > 0 ? "1px solid var(--border-color)" : "none",
                      background:
                        idx % 2 === 0
                          ? "transparent"
                          : "rgba(255,255,255,0.015)",
                    }}
                  >
                    <td
                      className="tabular-nums"
                      style={{
                        padding: "6px 8px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {q.trade_date}
                    </td>
                    <td
                      className="tabular-nums"
                      style={{
                        padding: "6px 8px",
                        color: "var(--text-primary)",
                      }}
                    >
                      {q.open.toFixed(2)}
                    </td>
                    <td
                      className="tabular-nums font-bold"
                      style={{
                        padding: "6px 8px",
                        color:
                          q.change_pct >= 0
                            ? "var(--accent-red)"
                            : "var(--accent-green)",
                      }}
                    >
                      {q.close.toFixed(2)}
                    </td>
                    <td
                      className="tabular-nums"
                      style={{
                        padding: "6px 8px",
                        color: "var(--text-primary)",
                      }}
                    >
                      {q.high.toFixed(2)}
                    </td>
                    <td
                      className="tabular-nums"
                      style={{
                        padding: "6px 8px",
                        color: "var(--text-primary)",
                      }}
                    >
                      {q.low.toFixed(2)}
                    </td>
                    <td
                      className="tabular-nums font-bold"
                      style={{
                        padding: "6px 8px",
                        color:
                          q.change_pct >= 0
                            ? "var(--accent-red)"
                            : "var(--accent-green)",
                      }}
                    >
                      {q.change_pct >= 0 ? "+" : ""}
                      {q.change_pct.toFixed(2)}%
                    </td>
                    <td
                      className="tabular-nums"
                      style={{
                        padding: "6px 8px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {(q.amount / 1e8).toFixed(2)}亿
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
