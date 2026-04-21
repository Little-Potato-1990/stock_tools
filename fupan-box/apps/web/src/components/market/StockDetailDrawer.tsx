"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ExternalLink, Star, Zap, Sparkles, ChevronRight, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { getCellColor } from "@/lib/colorScale";
import { useUIStore } from "@/stores/ui-store";
import { StockCapitalChip } from "./StockCapitalChip";

interface StockDetail {
  stock_code: string;
  stock_name: string;
  limit_reason: string | null;
  theme_names: string[];
  all_themes: string[];
  continuous_days: number;
  last_limit_date: string | null;
  recent_quotes: Array<{
    trade_date: string;
    open: number;
    close: number;
    high: number;
    low: number;
    change_pct: number;
    amount: number;
    is_limit_up: boolean;
    is_limit_down: boolean;
  }>;
}

type WhyRose = Awaited<ReturnType<typeof api.getWhyRose>>;

const VERDICT_COLOR: Record<WhyRose["verdict"], string> = {
  S: "var(--accent-purple)",
  A: "var(--accent-red)",
  B: "var(--accent-orange)",
  C: "var(--accent-green)",
};

interface Props {
  stockCode: string | null;
  onClose: () => void;
}

export function StockDetailDrawer({ stockCode, onClose }: Props) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [isWatchlisted, setIsWatchlisted] = useState(false);
  const [aiSummary, setAiSummary] = useState<WhyRose | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const openWhyRose = useUIStore((s) => s.openWhyRose);

  const fetchDetail = useCallback(async (code: string) => {
    setLoading(true);
    try {
      const data = await api.getStockDetail(code);
      setDetail(data as unknown as StockDetail);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAiSummary = useCallback(async (code: string) => {
    setAiLoading(true);
    setAiError(null);
    try {
      const d = await api.getWhyRose(code);
      setAiSummary(d);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI 解读暂不可用");
      setAiSummary(null);
    } finally {
      setAiLoading(false);
    }
  }, []);

  useEffect(() => {
    if (stockCode) {
      fetchDetail(stockCode);
      fetchAiSummary(stockCode);
    } else {
      setDetail(null);
      setAiSummary(null);
      setAiError(null);
    }
  }, [stockCode, fetchDetail, fetchAiSummary]);

  if (!stockCode) return null;

  const eastMoneyUrl = `https://quote.eastmoney.com/${
    stockCode.startsWith("6") ? "sh" : "sz"
  }${stockCode}.html`;

  const latest = detail?.recent_quotes?.[0];
  const isUp = latest ? latest.change_pct >= 0 : true;
  const accent = isUp ? "var(--accent-red)" : "var(--accent-green)";

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.45)" }}
        onClick={onClose}
      />
      <div
        className="fixed right-0 top-0 bottom-0 z-50 overflow-y-auto"
        style={{
          width: 380,
          background: "var(--bg-primary)",
          borderLeft: "1px solid var(--border-color)",
        }}
      >
        {/* 顶栏 */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-3"
          style={{
            height: 44,
            background: "var(--bg-secondary)",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className="font-bold truncate"
              style={{ color: "var(--text-primary)", fontSize: "var(--font-lg)" }}
            >
              {detail?.stock_name || stockCode}
            </span>
            <span
              className="tabular-nums"
              style={{ color: "var(--text-muted)", fontSize: 11 }}
            >
              {stockCode}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => stockCode && openWhyRose(stockCode, detail?.stock_name)}
              className="flex items-center gap-0.5 px-1.5 py-1 rounded transition-colors"
              style={{
                color: "var(--accent-purple)",
                fontSize: 10,
                background: "rgba(168,85,247,0.1)",
                border: "1px solid rgba(168,85,247,0.3)",
              }}
              title="AI 解读: 为什么涨/跌 / 卡位 / 高度 / 明日策略"
            >
              <Zap size={11} />
              为什么{detail?.recent_quotes?.[0]?.change_pct && detail.recent_quotes[0].change_pct >= 0 ? "涨" : "跌"}
            </button>
            <button
              onClick={async () => {
                if (!api.isLoggedIn() || !stockCode) return;
                try {
                  if (isWatchlisted) {
                    await api.removeFromWatchlist(stockCode);
                    setIsWatchlisted(false);
                  } else {
                    await api.addToWatchlist(stockCode);
                    setIsWatchlisted(true);
                  }
                } catch {
                  /* ignore */
                }
              }}
              className="p-1.5 rounded transition-colors"
              style={{
                color: isWatchlisted ? "var(--accent-orange)" : "var(--text-muted)",
              }}
              title={isWatchlisted ? "取消收藏" : "加入自选"}
            >
              <Star size={14} fill={isWatchlisted ? "var(--accent-orange)" : "none"} />
            </button>
            <a
              href={eastMoneyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded transition-colors"
              style={{ color: "var(--accent-blue)" }}
              title="东方财富"
            >
              <ExternalLink size={14} />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 价格条 (整条染色) */}
        {latest && (
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{
              background: isUp
                ? "linear-gradient(90deg, rgba(239,68,68,0.18), rgba(239,68,68,0.02))"
                : "linear-gradient(90deg, rgba(34,197,94,0.18), rgba(34,197,94,0.02))",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            <div>
              <div
                className="font-bold tabular-nums"
                style={{ color: accent, fontSize: 26, lineHeight: 1 }}
              >
                {latest.close.toFixed(2)}
              </div>
              <div
                className="font-bold tabular-nums mt-1"
                style={{ color: accent, fontSize: "var(--font-md)" }}
              >
                {latest.change_pct >= 0 ? "+" : ""}
                {latest.change_pct.toFixed(2)}%
                {latest.is_limit_up && (
                  <span className="ml-2 badge-pill" style={{ background: accent, color: "#fff" }}>
                    涨停
                  </span>
                )}
                {latest.is_limit_down && (
                  <span className="ml-2 badge-pill" style={{ background: accent, color: "#fff" }}>
                    跌停
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-right">
              <div style={{ color: "var(--text-muted)", fontSize: 10 }}>开</div>
              <div
                className="tabular-nums font-semibold"
                style={{ color: "var(--text-primary)", fontSize: 11 }}
              >
                {latest.open.toFixed(2)}
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: 10 }}>高</div>
              <div
                className="tabular-nums font-semibold"
                style={{ color: "var(--accent-red)", fontSize: 11 }}
              >
                {latest.high.toFixed(2)}
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: 10 }}>低</div>
              <div
                className="tabular-nums font-semibold"
                style={{ color: "var(--accent-green)", fontSize: 11 }}
              >
                {latest.low.toFixed(2)}
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: 10 }}>额</div>
              <div
                className="tabular-nums font-semibold"
                style={{ color: "var(--text-primary)", fontSize: 11 }}
              >
                {(latest.amount / 1e8).toFixed(2)}亿
              </div>
            </div>
          </div>
        )}

        {/* 资金面 chip - 主力 / 北向 / 主力身份 一行紧凑展示 */}
        {stockCode && (
          <div
            className="px-3 py-2"
            style={{
              borderBottom: "1px solid var(--border-color)",
              background: "var(--bg-secondary)",
            }}
          >
            <StockCapitalChip code={stockCode} variant="full" />
          </div>
        )}

        {/* AI 一句话总结 (P0 改造) - 放在价格之下, 用户首屏第二眼必看 */}
        <div
          className="px-3 py-2.5"
          style={{
            background:
              "linear-gradient(135deg, rgba(168,85,247,0.08) 0%, var(--bg-secondary) 70%)",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles size={12} style={{ color: "var(--accent-purple)" }} />
            <span
              className="font-bold"
              style={{
                color: "var(--accent-purple)",
                fontSize: 10,
                letterSpacing: 1,
              }}
            >
              AI 一句话解读
            </span>
            {aiSummary && (
              <span
                className="font-bold flex items-center justify-center"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 3,
                  background: VERDICT_COLOR[aiSummary.verdict],
                  color: "#fff",
                  fontSize: 10,
                }}
                title={aiSummary.verdict_label}
              >
                {aiSummary.verdict}
              </span>
            )}
            <button
              onClick={() => stockCode && fetchAiSummary(stockCode)}
              disabled={aiLoading}
              className="ml-auto p-0.5 transition-opacity hover:opacity-70"
              title="重新解读"
              style={{ color: "var(--text-muted)" }}
            >
              <RefreshCw size={10} className={aiLoading ? "animate-spin" : ""} />
            </button>
          </div>
          {aiLoading && !aiSummary ? (
            <div
              style={{
                color: "var(--text-muted)",
                fontSize: "var(--font-sm)",
                fontStyle: "italic",
              }}
            >
              AI 正在解读…首次约 30 秒, 之后秒回
            </div>
          ) : aiError ? (
            <div
              className="flex items-center justify-between"
              style={{ color: "var(--text-muted)", fontSize: 11 }}
            >
              <span>AI 解读暂不可用 ({aiError})</span>
              <button
                onClick={() => stockCode && fetchAiSummary(stockCode)}
                style={{ color: "var(--accent-blue)", fontSize: 11 }}
              >
                重试
              </button>
            </div>
          ) : aiSummary ? (
            <button
              onClick={() => openWhyRose(stockCode!, detail?.stock_name)}
              className="w-full text-left flex items-start gap-1 group"
              style={{ color: "var(--text-primary)" }}
              title="点击查看完整 AI 解读 (驱动 / 卡位 / 高度 / 明日策略)"
            >
              <span
                className="flex-1 font-bold leading-snug"
                style={{ fontSize: "var(--font-md)", lineHeight: 1.45 }}
              >
                {aiSummary.headline}
              </span>
              <ChevronRight
                size={12}
                className="flex-shrink-0 mt-0.5 transition-transform group-hover:translate-x-0.5"
                style={{ color: "var(--accent-purple)" }}
              />
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="px-3 py-3 space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse"
                style={{ background: "var(--bg-card)" }}
              />
            ))}
          </div>
        ) : detail ? (
          <div className="px-3 py-3 space-y-3">
            {detail.continuous_days > 0 && (
              <div
                className="flex items-center justify-between px-3 py-2"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 4,
                }}
              >
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                  当前连板高度
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className="badge-pill font-bold"
                    style={{ background: "var(--accent-red)", color: "#fff", fontSize: 11 }}
                  >
                    {detail.continuous_days}板
                  </span>
                  {detail.last_limit_date && (
                    <span
                      className="tabular-nums"
                      style={{ color: "var(--text-muted)", fontSize: 10 }}
                    >
                      {detail.last_limit_date}
                    </span>
                  )}
                </span>
              </div>
            )}

            {detail.limit_reason && (
              <div>
                <div
                  className="font-medium mb-1"
                  style={{ color: "var(--text-muted)", fontSize: 11 }}
                >
                  涨停原因
                </div>
                <div
                  className="px-3 py-2 leading-relaxed"
                  style={{
                    background: "var(--bg-card)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 4,
                    fontSize: "var(--font-sm)",
                  }}
                >
                  {detail.limit_reason}
                </div>
              </div>
            )}

            {detail.all_themes.length > 0 && (
              <div>
                <div
                  className="font-medium mb-1.5"
                  style={{ color: "var(--text-muted)", fontSize: 11 }}
                >
                  所属概念 ({detail.all_themes.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {detail.all_themes.map((t) => {
                    const isPrimary = detail.theme_names.includes(t);
                    return (
                      <span
                        key={t}
                        className="rounded"
                        style={{
                          padding: "2px 7px",
                          background: isPrimary
                            ? "rgba(245,158,11,0.18)"
                            : "var(--bg-tertiary)",
                          color: isPrimary
                            ? "var(--accent-orange)"
                            : "var(--text-secondary)",
                          fontSize: 10,
                          border: isPrimary
                            ? "1px solid rgba(245,158,11,0.4)"
                            : "1px solid var(--border-color)",
                        }}
                      >
                        {t}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {detail.recent_quotes.length > 0 && (
              <div>
                <div
                  className="font-medium mb-1.5"
                  style={{ color: "var(--text-muted)", fontSize: 11 }}
                >
                  近期走势
                </div>
                <div className="overflow-x-auto" style={{ border: "1px solid var(--border-color)" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>日期</th>
                        <th>收盘</th>
                        <th>涨跌</th>
                        <th>成交</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.recent_quotes.map((q) => {
                        const cell = getCellColor(q.change_pct, "change");
                        return (
                          <tr key={q.trade_date}>
                            <td
                              className="tabular-nums"
                              style={{ color: "var(--text-secondary)", fontSize: 11 }}
                            >
                              {q.trade_date.slice(5)}
                            </td>
                            <td
                              className="tabular-nums font-bold"
                              style={{ color: "var(--text-primary)", fontSize: 11 }}
                            >
                              {q.close.toFixed(2)}
                            </td>
                            <td
                              className="cell-num"
                              style={{
                                background: cell.background,
                                color: cell.color,
                                fontSize: 11,
                              }}
                            >
                              {q.change_pct >= 0 ? "+" : ""}
                              {q.change_pct.toFixed(2)}%
                            </td>
                            <td
                              className="tabular-nums"
                              style={{ color: "var(--text-muted)", fontSize: 11 }}
                            >
                              {(q.amount / 1e8).toFixed(1)}亿
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            className="px-4 py-8 text-center"
            style={{ color: "var(--text-muted)", fontSize: "var(--font-md)" }}
          >
            暂无数据
          </div>
        )}
      </div>
    </>
  );
}
