"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Plus, Trash2, Search, Target, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { WatchlistAiCard } from "@/components/market/WatchlistAiCard";
import { StockCapitalChip } from "@/components/market/StockCapitalChip";
import { useUIStore } from "@/stores/ui-store";
import { useImportCenterStore } from "@/stores/import-center-store";

interface WatchlistItem {
  id: number;
  stock_code: string;
  note: string | null;
  ai_reason: string | null;
  created_at: string;
}

export function WatchlistPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const requestPlanFor = useUIStore((s) => s.requestPlanFor);
  const setAnomalyFilterCode = useUIStore((s) => s.setAnomalyFilterCode);
  const openAuthModal = useUIStore((s) => s.openAuthModal);
  const openImportCenter = useImportCenterStore((s) => s.open);

  const [addCode, setAddCode] = useState("");
  const [addNote, setAddNote] = useState("");

  useEffect(() => {
    const syncLoginState = () => {
      api.restoreToken();
      setLoggedIn(api.isLoggedIn());
    };
    syncLoginState();
    if (typeof window !== "undefined") {
      window.addEventListener("app:auth-changed", syncLoginState);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("app:auth-changed", syncLoginState);
      }
    };
  }, []);

  const fetchList = useCallback(async () => {
    if (!api.isLoggedIn()) return;
    setLoading(true);
    try {
      const data = await api.getWatchlist();
      setItems(data);
      setError("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "加载失败";
      if (msg.includes("401") || msg.includes("Not authenticated")) {
        api.logout();
        setLoggedIn(false);
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) fetchList();
  }, [loggedIn, fetchList]);

  const handleAdd = async () => {
    if (!addCode.trim()) return;
    try {
      await api.addToWatchlist(addCode.trim(), addNote.trim() || undefined);
      setAddCode("");
      setAddNote("");
      fetchList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "添加失败");
    }
  };

  const handleRemove = async (code: string) => {
    try {
      await api.removeFromWatchlist(code);
      fetchList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  if (!loggedIn) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <div className="w-full max-w-sm p-6 rounded-xl" style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}>
          <h2 className="text-lg font-semibold mb-2 text-center" style={{ color: "var(--text-primary)" }}>
            我的自选
          </h2>
          <p className="text-sm text-center" style={{ color: "var(--text-muted)" }}>
            登录后可管理自选并查看 AI 一句话定调
          </p>
          <button
            onClick={openAuthModal}
            className="w-full mt-4 py-2 rounded-lg text-sm font-medium"
            style={{
              background: "var(--accent-purple)",
              color: "white",
            }}
          >
            立即登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="我的自选"
        subtitle={`${items.length} 只`}
        actions={
          <>
            <button
              onClick={() => openImportCenter("holdings")}
              className="rounded transition-colors"
              style={{
                padding: "4px 10px",
                background: "rgba(245,158,11,0.14)",
                color: "var(--accent-orange)",
                fontSize: "var(--font-sm)",
                border: "1px solid var(--accent-orange)",
              }}
            >
              📷 截图导入
            </button>
            <button
              onClick={() => { api.logout(); setLoggedIn(false); setItems([]); }}
              className="rounded transition-colors"
              style={{
                padding: "4px 10px",
                background: "var(--bg-tertiary)",
                color: "var(--text-muted)",
                fontSize: "var(--font-sm)",
                border: "1px solid var(--border-color)",
              }}
            >
              退出登录
            </button>
          </>
        }
      />

      {/* Add stock form */}
      <div className="px-4 py-3">
        <div className="flex gap-2">
          <input
            value={addCode}
            onChange={(e) => setAddCode(e.target.value)}
            placeholder="股票代码，如 600519"
            className="flex-1 max-w-[200px] px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border-color)" }}
          />
          <input
            value={addNote}
            onChange={(e) => setAddNote(e.target.value)}
            placeholder="备注（可选）"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1 max-w-[200px] px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border-color)" }}
          />
          <button
            onClick={handleAdd}
            className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1"
            style={{ background: "var(--accent-orange)", color: "white" }}
          >
            <Plus size={14} />添加
          </button>
        </div>
      </div>

      {error && <p className="px-4 text-xs mb-2" style={{ color: "var(--accent-red)" }}>{error}</p>}

      {/* AI 一句话定调 — P3-D */}
      <div className="px-4">
        <WatchlistAiCard itemCount={items.length} />
      </div>

      {/* Watchlist table */}
      <div className="px-4 pb-6">
        {items.length === 0 && !loading ? (
          <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
            自选股列表为空，添加股票代码开始跟踪
          </div>
        ) : (
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-color)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--bg-tertiary)" }}>
                  <th className="px-4 py-2.5 text-left font-medium" style={{ color: "var(--text-muted)" }}>股票代码</th>
                  <th className="px-4 py-2.5 text-left font-medium" style={{ color: "var(--text-muted)" }}>资金动向</th>
                  <th className="px-4 py-2.5 text-left font-medium" style={{ color: "var(--text-muted)" }}>备注</th>
                  <th className="px-4 py-2.5 text-left font-medium" style={{ color: "var(--text-muted)" }}>AI 理由</th>
                  <th className="px-4 py-2.5 text-left font-medium" style={{ color: "var(--text-muted)" }}>添加时间</th>
                  <th className="px-4 py-2.5 text-center font-medium" style={{ color: "var(--text-muted)", width: 180 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr
                    key={item.id}
                    style={{ borderTop: "1px solid var(--border-color)", background: idx % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-primary)" }}
                  >
                    <td
                      className="px-4 py-2.5 font-medium cursor-pointer hover:opacity-80"
                      style={{ color: "var(--accent-orange)" }}
                      onClick={() => openStockDetail(item.stock_code)}
                      title="点击打开个股详情"
                    >
                      {item.stock_code}
                    </td>
                    <td className="px-4 py-2.5">
                      <StockCapitalChip code={item.stock_code} variant="compact" silent />
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-secondary)" }}>{item.note || "-"}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: "var(--accent-purple)" }}>{item.ai_reason || "-"}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-muted)" }}>{item.created_at.slice(0, 10)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          onClick={() => openStockDetail(item.stock_code)}
                          title="个股详情"
                          className="p-1 rounded transition-colors"
                          style={{ color: "var(--accent-blue)" }}
                        >
                          <Search size={13} />
                        </button>
                        <button
                          onClick={() => requestPlanFor(item.stock_code, item.note || undefined)}
                          title="为这只股建一条计划 (跳到我的计划并预填)"
                          className="p-1 rounded transition-colors"
                          style={{ color: "var(--accent-purple)" }}
                        >
                          <Target size={13} />
                        </button>
                        <button
                          onClick={() => setAnomalyFilterCode(item.stock_code)}
                          title="只看这只股的盘中异动"
                          className="p-1 rounded transition-colors"
                          style={{ color: "var(--accent-orange)" }}
                        >
                          <AlertTriangle size={13} />
                        </button>
                        <button
                          onClick={() => handleRemove(item.stock_code)}
                          title="移出自选"
                          className="p-1 rounded hover:opacity-70"
                          style={{ color: "var(--accent-red)" }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {loading && (
        <div className="fixed bottom-4 right-4 px-3 py-1.5 rounded text-xs" style={{ background: "var(--bg-card)", color: "var(--text-muted)" }}>
          加载中...
        </div>
      )}
    </div>
  );
}
