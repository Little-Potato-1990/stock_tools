"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { PageHeader } from "@/components/layout/PageHeader";

interface BoardItem {
  name: string;
  code: string;
  change_pct: number;
}
interface BoardGroup {
  letter: string;
  items: BoardItem[];
}

interface StockResult {
  stock_code: string;
  stock_name: string;
  change_pct: number;
  close: number;
  amount: number;
  turnover_rate: number;
  is_limit_up: boolean;
  is_limit_down: boolean;
}

type Tab = "concept" | "industry" | "stock";

const TABS: { key: Tab; label: string }[] = [
  { key: "concept", label: "概念分类" },
  { key: "industry", label: "行业分类" },
  { key: "stock", label: "个股查询" },
];

function BoardGrid({ kind }: { kind: "concept" | "industry" }) {
  const [groups, setGroups] = useState<BoardGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const openThemeDetail = useUIStore((s) => s.openThemeDetail);

  useEffect(() => {
    setLoading(true);
    api
      .getAllBoards(kind)
      .then((res) => setGroups((res as { groups: BoardGroup[] }).groups))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [kind]);

  if (loading) {
    return (
      <div className="px-4 py-3 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse" style={{ background: "var(--bg-card)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-y-auto" style={{ height: "calc(100vh - 132px)" }}>
      <div className="px-4 py-3 space-y-3">
        {groups.map((g) => (
          <div key={g.letter}>
            <div
              className="font-bold mb-1.5 sticky top-0 py-1"
              style={{
                color: "var(--text-secondary)",
                fontSize: "var(--font-md)",
                background: "var(--bg-primary)",
                zIndex: 5,
              }}
            >
              {g.letter}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((b) => (
                <button
                  key={b.code || b.name}
                  onClick={() => openThemeDetail(b.name)}
                  className="rounded transition-colors"
                  style={{
                    padding: "5px 10px",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-primary)",
                    fontSize: "var(--font-sm)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-card-hover)";
                    e.currentTarget.style.borderColor = "var(--accent-orange)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--bg-card)";
                    e.currentTarget.style.borderColor = "var(--border-color)";
                  }}
                >
                  <span>{b.name}</span>
                  {b.change_pct !== 0 && (
                    <span
                      className="ml-1.5 tabular-nums font-bold"
                      style={{
                        fontSize: 10,
                        color: b.change_pct >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                      }}
                    >
                      {b.change_pct >= 0 ? "+" : ""}
                      {b.change_pct.toFixed(2)}%
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface StockDetail {
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

function StockSearchTab() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const setFocusedStock = useUIStore((s) => s.setFocusedStock);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const openThemeDetail = useUIStore((s) => s.openThemeDetail);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await api.searchStocks(query.trim());
      setResults(res as unknown as StockResult[]);
      // 单条结果直接打开内联详情
      const arr = res as unknown as StockResult[];
      if (arr.length === 1) {
        loadDetail(arr[0].stock_code, arr[0].stock_name);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadDetail = useCallback(
    async (code: string, name?: string) => {
      setDetailLoading(true);
      setActiveTheme(null);
      setFocusedStock({ code, name });
      try {
        const res = await api.getStockDetail(code);
        setDetail(res as unknown as StockDetail);
      } catch (e) {
        console.error(e);
      } finally {
        setDetailLoading(false);
      }
    },
    [setFocusedStock]
  );

  return (
    <div>
      {/* 搜索栏 */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="输入股票代码或名称, 如 000001 / 茅台 / 300750..."
              className="w-full pl-8 pr-3 py-2 rounded text-sm bg-transparent outline-none"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-color)",
              }}
            />
          </div>
          <button
            onClick={doSearch}
            className="px-4 py-2 rounded text-xs font-bold"
            style={{ background: "var(--accent-orange)", color: "#1a1d28" }}
          >
            搜索
          </button>
        </div>
      </div>

      {/* 多结果列表 */}
      {!detail && results.length > 1 && (
        <div className="px-4 space-y-1">
          {results.map((s) => (
            <div
              key={s.stock_code}
              onClick={() => loadDetail(s.stock_code, s.stock_name)}
              className="flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: 4,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-card-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-card)";
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="font-bold"
                  style={{
                    color: "var(--text-primary)",
                    fontSize: "var(--font-md)",
                  }}
                >
                  {s.stock_name}
                </span>
                <span
                  style={{ color: "var(--text-muted)", fontSize: 10 }}
                >
                  {s.stock_code}
                </span>
                {s.is_limit_up && (
                  <span
                    className="px-1 py-0.5 rounded"
                    style={{
                      background: "rgba(239,68,68,0.15)",
                      color: "var(--accent-red)",
                      fontSize: 9,
                    }}
                  >
                    涨停
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span
                  className="font-bold tabular-nums"
                  style={{
                    color: "var(--text-primary)",
                    fontSize: "var(--font-md)",
                  }}
                >
                  {s.close.toFixed(2)}
                </span>
                <span
                  className="font-bold tabular-nums min-w-16 text-right"
                  style={{
                    color:
                      s.change_pct >= 0
                        ? "var(--accent-red)"
                        : "var(--accent-green)",
                    fontSize: "var(--font-md)",
                  }}
                >
                  {s.change_pct >= 0 ? "+" : ""}
                  {s.change_pct.toFixed(2)}%
                </span>
                <ExternalLink size={12} style={{ color: "var(--text-muted)" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 内联详情 */}
      {detail && (
        <div className="px-4 pb-6">
          <StockDetailInline
            detail={detail}
            loading={detailLoading}
            activeTheme={activeTheme}
            onThemeClick={(name) =>
              setActiveTheme(activeTheme === name ? null : name)
            }
            onThemeOpen={(name) => openThemeDetail(name)}
            onOpenDrawer={() =>
              openStockDetail(detail.stock_code, detail.stock_name)
            }
          />
        </div>
      )}

      {/* 空态 */}
      {!detail && results.length === 0 && (
        <div
          className="py-12 text-center"
          style={{ color: "var(--text-muted)", fontSize: "var(--font-md)" }}
        >
          {searched ? "未找到相关股票" : "输入股票代码或名称搜索"}
        </div>
      )}
    </div>
  );
}

function StockDetailInline({
  detail,
  loading,
  activeTheme,
  onThemeClick,
  onThemeOpen,
  onOpenDrawer,
}: {
  detail: StockDetail;
  loading: boolean;
  activeTheme: string | null;
  onThemeClick: (name: string) => void;
  onThemeOpen: (name: string) => void;
  onOpenDrawer: () => void;
}) {
  const themes = detail.all_themes ?? [];
  return (
    <div className="space-y-4">
      {/* 标题 + 跳转抽屉 */}
      <div className="flex items-center justify-between mt-2">
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
        <button
          onClick={onOpenDrawer}
          className="font-semibold transition-colors"
          style={{
            background: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
            padding: "4px 10px",
            borderRadius: 4,
            fontSize: "var(--font-sm)",
            border: "1px solid var(--border-color)",
          }}
        >
          打开行情面板
        </button>
      </div>

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
          <div
            key={i}
            className="contents"
          >
            <div
              style={{
                padding: "8px 12px",
                background: "var(--bg-tertiary)",
                color: "var(--text-muted)",
                borderBottom:
                  i < 3 ? "1px solid var(--border-color)" : "none",
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
                borderBottom:
                  i < 3 ? "1px solid var(--border-color)" : "none",
                borderRight: i % 3 < 2 ? "1px solid var(--border-color)" : "none",
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
                onClick={() => onThemeClick(t)}
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
            <span style={{ color: "var(--text-muted)" }}>
              已选概念:{" "}
            </span>
            <span className="font-bold">{activeTheme}</span>
          </span>
          <button
            onClick={() => onThemeOpen(activeTheme)}
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

      {/* 涨停原因 / 题材标签 (来自最近涨停) */}
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
                      style={{ padding: "6px 8px", color: "var(--text-primary)" }}
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
                      style={{ padding: "6px 8px", color: "var(--text-primary)" }}
                    >
                      {q.high.toFixed(2)}
                    </td>
                    <td
                      className="tabular-nums"
                      style={{ padding: "6px 8px", color: "var(--text-primary)" }}
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

      {loading && (
        <div
          className="text-center"
          style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
        >
          加载中...
        </div>
      )}
    </div>
  );
}

export function StockSearchPage() {
  const [tab, setTab] = useState<Tab>("concept");

  return (
    <div>
      <PageHeader
        title="个股检索"
        subtitle={TABS.find((t) => t.key === tab)?.label}
      />

      <div
        className="flex items-center px-3"
        style={{
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
          height: 36,
        }}
      >
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="font-medium transition-colors relative"
            style={{
              padding: "0 14px",
              height: 36,
              fontSize: "var(--font-md)",
              color: tab === key ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {label}
            {tab === key && (
              <div
                className="absolute bottom-0 left-2 right-2"
                style={{ height: 2, background: "var(--accent-orange)" }}
              />
            )}
          </button>
        ))}
      </div>

      {tab === "concept" && <BoardGrid kind="concept" />}
      {tab === "industry" && <BoardGrid kind="industry" />}
      {tab === "stock" && <StockSearchTab />}
    </div>
  );
}
