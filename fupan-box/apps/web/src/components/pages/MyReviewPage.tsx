"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Trash2,
  TrendingDown,
  Sparkles,
  Target,
  AlertTriangle,
  Lightbulb,
  RefreshCw,
  BookOpen,
  Wallet,
  Trophy,
  Activity,
  Upload,
} from "lucide-react";
import { api, type TradeRecord, type TradePattern } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { EvidenceBadge } from "@/components/market/EvidenceBadge";
import { FeedbackThumbs } from "@/components/market/FeedbackThumbs";

type AiReview = {
  mode_label: string;
  summary: string;
  strengths: Array<{ label: string; text: string }>;
  weaknesses: Array<{ label: string; text: string }>;
  suggestions: Array<{ label: string; text: string }>;
  model: string;
  evidence?: string[];
};

export function MyReviewPage() {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [pattern, setPattern] = useState<TradePattern | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReview, setAiReview] = useState<AiReview | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const setActiveModule = useUIStore((s) => s.setActiveModule);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, p] = await Promise.all([api.listTrades(days), api.getTradePattern(days)]);
      setTrades(t);
      setPattern(p);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const removeTrade = async (id: number) => {
    if (!confirm("确认删除该笔交易?")) return;
    await api.deleteTrade(id);
    await load();
  };

  const runAiReview = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const r = await api.getTradeAiReview(days);
      setAiReview(r.review);
      setPattern(r.pattern);
    } catch (e) {
      const msg = (e as Error).message || "AI 复盘失败";
      if (msg.includes("quota_exceeded") || msg.includes("已用")) {
        setAiError("今日 AI 交易复盘配额已用完, 升级 Pro 解锁更多次数");
      } else {
        setAiError(msg);
      }
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div>
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
        }}
      >
        <div className="flex items-center gap-2">
          <BookOpen size={14} style={{ color: "var(--accent-purple)" }} />
          <span
            className="font-bold"
            style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
          >
            我的复盘
          </span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            录入真实交易, AI 帮你诊断追高/胜率/期望, 长期形成你的"个人交易模式画像"
          </span>
        </div>
        <div className="flex items-center gap-2">
          {[7, 14, 30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="px-2 py-1 rounded font-bold transition-colors"
              style={{
                background: days === d ? "var(--accent-purple)" : "var(--bg-tertiary)",
                color: days === d ? "#fff" : "var(--text-secondary)",
                fontSize: 11,
                border: "none",
                cursor: "pointer",
              }}
            >
              {d}天
            </button>
          ))}
          <button
            onClick={() => setActiveModule("my_holdings")}
            className="flex items-center gap-1 px-2 py-1 rounded font-bold"
            style={{
              background: "var(--accent-orange)",
              color: "#1a1d28",
              fontSize: 11,
              border: "none",
              cursor: "pointer",
            }}
            title="数据装入入口已统一到「我的持仓」: 截图导入持仓 / 交易记录, FIFO 自动配对生成已平仓 round-trip"
          >
            <Upload size={11} />
            去导入数据
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="p-1 rounded"
            style={{ color: "var(--text-muted)" }}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {pattern && <PatternCards pattern={pattern} />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <TradeList trades={trades} onDelete={removeTrade} onOpenStock={openStockDetail} />
          </div>
          <div>
            <AiReviewCard
              loading={aiLoading}
              review={aiReview}
              error={aiError}
              onRun={runAiReview}
              empty={trades.length === 0}
            />
          </div>
        </div>
      </div>
    </div>
  );
}


function PatternCards({ pattern }: { pattern: TradePattern }) {
  const wr = pattern.win_rate;
  const exp = pattern.expectation;
  const chase = pattern.chase_rate;
  const wrColor = wr >= 0.55 ? "var(--accent-red)" : wr >= 0.4 ? "var(--accent-orange)" : "var(--accent-green)";
  const expColor = exp >= 1 ? "var(--accent-red)" : exp >= 0 ? "var(--accent-orange)" : "var(--accent-green)";
  const chaseColor = chase >= 0.4 ? "var(--accent-green)" : "var(--accent-red)";

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-6 gap-2 px-3 py-3"
      style={{
        background:
          "linear-gradient(135deg, rgba(139,92,246,0.10) 0%, rgba(245,158,11,0.06) 100%)",
        border: "1px solid rgba(139,92,246,0.28)",
        borderRadius: 6,
      }}
    >
      <Stat icon={<Activity size={11} style={{ color: "var(--accent-blue)" }} />} label="操作模式" valueText={pattern.mode_label} sub={pattern.mode_desc} colSpan={2} />
      <Stat icon={<Target size={11} style={{ color: wrColor }} />} label="胜率" value={wr * 100} suffix="%" color={wrColor} sub={`${pattern.win_count}/${pattern.trade_count} 笔盈利`} />
      <Stat icon={<Sparkles size={11} style={{ color: expColor }} />} label="单笔期望" value={exp} suffix="%" color={expColor} sub={`赢 +${pattern.avg_win_pct ?? 0}% / 亏 ${pattern.avg_loss_pct ?? 0}%`} />
      <Stat icon={<AlertTriangle size={11} style={{ color: chaseColor }} />} label="追高比例" value={chase * 100} suffix="%" color={chaseColor} sub={`${pattern.chase_count ?? 0} 笔涨幅 >5% 介入`} />
      <Stat icon={<Wallet size={11} style={{ color: pattern.total_pnl >= 0 ? "var(--accent-red)" : "var(--accent-green)" }} />} label="累计盈亏" value={pattern.total_pnl} suffix="元" color={pattern.total_pnl >= 0 ? "var(--accent-red)" : "var(--accent-green)"} sub={`平均持仓 ${pattern.avg_holding_min ?? "—"} 分钟`} />
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  valueText,
  suffix,
  color,
  sub,
  colSpan,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  valueText?: string;
  suffix?: string;
  color?: string;
  sub: string;
  colSpan?: number;
}) {
  return (
    <div className={colSpan ? `col-span-${colSpan}` : ""}>
      <div className="flex items-center gap-1 mb-1">
        {icon}
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</span>
      </div>
      <div
        className="font-bold tabular-nums"
        style={{
          fontSize: valueText ? 15 : 22,
          color: color || "var(--text-primary)",
          lineHeight: 1.1,
        }}
      >
        {valueText ? valueText : value !== undefined ? `${value.toFixed(suffix === "元" ? 0 : 1)}${suffix || ""}` : "—"}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function TradeList({
  trades,
  onDelete,
  onOpenStock,
}: {
  trades: TradeRecord[];
  onDelete: (id: number) => void;
  onOpenStock: (code: string, name?: string) => void;
}) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 4,
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-1.5"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <BookOpen size={12} style={{ color: "var(--accent-blue)" }} />
        <span className="font-bold" style={{ fontSize: "var(--font-sm)" }}>
          交易明细
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{trades.length} 笔</span>
      </div>
      {trades.length === 0 ? (
        <div className="text-center py-10" style={{ color: "var(--text-muted)", fontSize: 12 }}>
          暂无交易, 点右上角"录入交易"开始
        </div>
      ) : (
        <table className="w-full" style={{ fontSize: "var(--font-xs)", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
              <th className="px-2 py-1.5 text-left" style={{ width: 90 }}>日期</th>
              <th className="px-2 py-1.5 text-left" style={{ width: 130 }}>标的</th>
              <th className="px-2 py-1.5 text-right tabular-nums" style={{ width: 80 }}>买/卖价</th>
              <th className="px-2 py-1.5 text-right tabular-nums" style={{ width: 60 }}>数量</th>
              <th className="px-2 py-1.5 text-right tabular-nums" style={{ width: 80 }}>盈亏</th>
              <th className="px-2 py-1.5 text-center tabular-nums" style={{ width: 70 }}>持仓</th>
              <th className="px-2 py-1.5 text-center tabular-nums" style={{ width: 70 }}>介入涨幅</th>
              <th className="px-2 py-1.5 text-left">介入逻辑</th>
              <th className="px-2 py-1.5 text-center" style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => {
              const winColor = t.pnl >= 0 ? "var(--accent-red)" : "var(--accent-green)";
              const isChase = (t.intraday_chg_at_buy ?? 0) > 5;
              return (
                <tr key={t.id} style={{ borderTop: "1px solid var(--border-color)" }}>
                  <td className="px-2 py-1.5" style={{ color: "var(--text-secondary)" }}>{t.trade_date}</td>
                  <td className="px-2 py-1.5">
                    <button
                      onClick={() => onOpenStock(t.code, t.name)}
                      className="font-bold tabular-nums hover:underline"
                      style={{ color: "var(--accent-blue)", fontSize: 11, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      {t.code} {t.name || ""}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {t.buy_price.toFixed(2)} / {t.sell_price.toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{t.qty}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold" style={{ color: winColor }}>
                    {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(0)}
                    <div style={{ fontSize: 10, color: winColor }}>
                      {t.pnl_pct >= 0 ? "+" : ""}{t.pnl_pct.toFixed(2)}%
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {t.holding_minutes != null ? `${t.holding_minutes}m` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums">
                    {t.intraday_chg_at_buy == null ? (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    ) : (
                      <span style={{ color: isChase ? "var(--accent-green)" : "var(--text-secondary)", fontWeight: isChase ? 700 : 400 }}>
                        {t.intraday_chg_at_buy >= 0 ? "+" : ""}{t.intraday_chg_at_buy.toFixed(1)}%
                        {isChase && <span title="追高介入" style={{ marginLeft: 2 }}>!</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: "var(--text-secondary)" }}>{t.reason || "—"}</td>
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => onDelete(t.id)} className="p-1" style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }} title="删除">
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AiReviewCard({
  loading,
  review,
  error,
  onRun,
  empty,
}: {
  loading: boolean;
  review: AiReview | null;
  error: string | null;
  onRun: () => void;
  empty: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 4,
      }}
    >
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <div className="flex items-center gap-1.5">
          <Sparkles size={12} style={{ color: "var(--accent-purple)" }} />
          <span className="font-bold" style={{ fontSize: "var(--font-sm)" }}>
            AI 复盘点评
          </span>
          {review?.model && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{review.model}</span>}
        </div>
        <button
          onClick={onRun}
          disabled={loading || empty}
          className="flex items-center gap-1 px-2 py-1 rounded font-bold"
          style={{
            background: "var(--accent-purple)",
            color: "#fff",
            fontSize: 11,
            border: "none",
            cursor: loading || empty ? "not-allowed" : "pointer",
            opacity: loading || empty ? 0.5 : 1,
          }}
          title={empty ? "先录入交易" : "调 LLM 综合点评 (计入 quota)"}
        >
          <Sparkles size={11} />
          {loading ? "AI 思考中..." : review ? "重新点评" : "AI 复盘"}
        </button>
      </div>
      <div className="p-3 space-y-2" style={{ fontSize: 11 }}>
        {empty && (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
            先录入至少 3 笔交易, 让 AI 给你做模式诊断
          </div>
        )}
        {error && (
          <div
            style={{
              background: "rgba(245,158,11,0.10)",
              border: "1px solid rgba(245,158,11,0.4)",
              color: "var(--accent-orange)",
              padding: 8,
              borderRadius: 3,
              fontSize: 11,
            }}
          >
            {error}
          </div>
        )}
        {!empty && !review && !error && !loading && (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
            点击右上角 "AI 复盘" 让导师给你点评
          </div>
        )}
        {review && (
          <>
            <div
              style={{
                background: "rgba(139,92,246,0.10)",
                border: "1px solid rgba(139,92,246,0.30)",
                borderRadius: 4,
                padding: 8,
              }}
            >
              <div className="flex items-center gap-1 mb-1">
                <Activity size={11} style={{ color: "var(--accent-purple)" }} />
                <span className="font-bold" style={{ fontSize: 11, color: "var(--accent-purple)" }}>
                  {review.mode_label}
                </span>
                {review.evidence && review.evidence.length > 0 && (
                  <span className="ml-auto">
                    <EvidenceBadge evidence={review.evidence} />
                  </span>
                )}
              </div>
              <div style={{ color: "var(--text-primary)", lineHeight: 1.5 }}>{review.summary}</div>
            </div>
            <Section icon={<Trophy size={11} style={{ color: "var(--accent-red)" }} />} title="优势" items={review.strengths} color="var(--accent-red)" />
            <Section icon={<TrendingDown size={11} style={{ color: "var(--accent-green)" }} />} title="短板" items={review.weaknesses} color="var(--accent-green)" />
            <Section icon={<Lightbulb size={11} style={{ color: "var(--accent-orange)" }} />} title="改进建议" items={review.suggestions} color="var(--accent-orange)" />
            <div className="pt-2 mt-2" style={{ borderTop: "1px dashed var(--border-color)" }}>
              <FeedbackThumbs
                kind="today"
                tradeDate={new Date().toISOString().slice(0, 10)}
                model={review.model}
                snapshot={{ headline: review.summary, mode_label: review.mode_label, evidence: review.evidence }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  items,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  items: Array<{ label: string; text: string }>;
  color: string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        {icon}
        <span className="font-bold" style={{ fontSize: 11, color }}>{title}</span>
      </div>
      <ul className="space-y-1 ml-1">
        {items.map((it, i) => (
          <li key={i} style={{ color: "var(--text-primary)", lineHeight: 1.4 }}>
            <span className="font-bold" style={{ color }}>[{it.label}]</span>{" "}
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
