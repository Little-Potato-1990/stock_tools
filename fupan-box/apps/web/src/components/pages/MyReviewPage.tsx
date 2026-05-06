"use client";

import { useEffect, useState, useCallback } from "react";
import {
  TrendingDown,
  Sparkles,
  Target,
  AlertTriangle,
  Lightbulb,
  BookOpen,
  Wallet,
  Trophy,
  Activity,
  Wand2,
  Save,
} from "lucide-react";
import {
  api,
  type TradeRecord,
  type TradePattern,
  type PlanVersionRecord,
  type PlanReviewLinkRecord,
  type UserHoldingItem,
  type TradeUpdatePayload,
} from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { MyHoldingsPage } from "@/components/pages/MyHoldingsPage";

type AiReview = {
  mode_label: string;
  summary: string;
  strengths: Array<{ label: string; text: string }>;
  weaknesses: Array<{ label: string; text: string }>;
  suggestions: Array<{ label: string; text: string }>;
  model: string;
  evidence?: string[];
};

type DraftPlanItem = {
  code: string;
  direction: "buy" | "sell" | "add" | "reduce";
  content: string;
};

function tomorrowISODate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDraftItems(content: Record<string, unknown> | null | undefined): DraftPlanItem[] {
  const raw = Array.isArray(content?.items) ? content.items : [];
  return raw
    .map((it) => {
      if (!it || typeof it !== "object") return null;
      const row = it as Record<string, unknown>;
      const triggerConditions = Array.isArray(row.trigger_conditions)
        ? row.trigger_conditions
        : [];
      const firstCond = triggerConditions[0] as Record<string, unknown> | undefined;
      const code = String(row.code || "");
      const name = typeof row.name === "string" ? row.name : "";
      const direction =
        row.direction === "sell" || row.direction === "add" || row.direction === "reduce"
          ? row.direction
          : "buy";
      const directionZh =
        direction === "buy" ? "买入" : direction === "add" ? "加仓" : direction === "reduce" ? "减仓" : "卖出";
      const baseText =
        (typeof row.content === "string" && row.content) ||
        (typeof row.instruction === "string" && row.instruction) ||
        (typeof firstCond?.label === "string" && firstCond.label) ||
        (typeof row.notes === "string" && row.notes) ||
        "观察强弱，满足预期再执行";
      const idPrefix = `${name || ""}`.trim();
      const normalizedText =
        idPrefix && !baseText.includes(name)
          ? `${idPrefix} ${directionZh}：${baseText}`
          : baseText;

      return {
        code,
        direction,
        content: normalizedText,
      } as DraftPlanItem;
    })
    .filter((x): x is DraftPlanItem => !!x && !!x.code);
}

function inferPlanMetaFromText(
  text: string,
  fallback: { code: string; direction: "buy" | "sell" | "add" | "reduce" },
) {
  const t = text || "";
  const m = t.match(/\d{6}/);
  const code = m?.[0] || fallback.code || "";
  let direction: "buy" | "sell" | "add" | "reduce" = fallback.direction || "buy";
  if (t.includes("减仓")) direction = "reduce";
  else if (t.includes("加仓")) direction = "add";
  else if (t.includes("卖出") || t.includes("清仓") || t.includes("止盈")) direction = "sell";
  else if (t.includes("买入") || t.includes("低吸") || t.includes("介入")) direction = "buy";
  return { code, direction };
}

export function MyReviewPage() {
  const ALL_DAYS = 3650;
  const [loggedIn, setLoggedIn] = useState(false);
  const [view, setView] = useState<"review" | "holdings">("review");
  const [reviewTab, setReviewTab] = useState<"trades" | "ai" | "plan">("trades");
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [pattern, setPattern] = useState<TradePattern | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReview, setAiReview] = useState<AiReview | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanVersionRecord | null>(null);
  const [draftItems, setDraftItems] = useState<DraftPlanItem[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSavedMsg, setPlanSavedMsg] = useState<string | null>(null);
  const [holdingPlanNote, setHoldingPlanNote] = useState("");
  const [newPositionPlanNote, setNewPositionPlanNote] = useState("");
  const [planReview, setPlanReview] = useState<PlanReviewLinkRecord | null>(null);
  const [holdingCodes, setHoldingCodes] = useState<string[]>([]);
  const [editingTrade, setEditingTrade] = useState<TradeRecord | null>(null);
  const [editHoldingMinutes, setEditHoldingMinutes] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [highlightTradeId, setHighlightTradeId] = useState<number | null>(null);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const openAuthModal = useUIStore((s) => s.openAuthModal);
  const openMidlongFromReviewTrade = useUIStore((s) => s.openMidlongFromReviewTrade);
  const consumePendingReviewRestore = useUIStore((s) => s.consumePendingReviewRestore);

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

  const load = useCallback(async () => {
    if (!api.isLoggedIn()) return;
    setLoading(true);
    try {
      const [t, p] = await Promise.all([api.listTrades(days), api.getTradePattern(days)]);
      setTrades(t);
      setPattern(p);
    } catch {
      setTrades([]);
      setPattern(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (loggedIn) {
      const timer = window.setTimeout(() => {
        void load();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [load, loggedIn]);

  useEffect(() => {
    if (!loggedIn) return;
    const restore = consumePendingReviewRestore();
    if (!restore) return;
    const timer = window.setTimeout(() => {
      setView("review");
      setReviewTab("trades");
      setDays(restore.days);
      setHighlightTradeId(restore.tradeId);
      const el = document.getElementById(`trade-row-${restore.tradeId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [loggedIn, consumePendingReviewRestore]);

  useEffect(() => {
    if (highlightTradeId == null) return;
    const t = window.setTimeout(() => setHighlightTradeId(null), 2200);
    return () => window.clearTimeout(t);
  }, [highlightTradeId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onImportUpdated = () => {
      if (api.isLoggedIn()) {
        void load();
      }
    };
    window.addEventListener("app:import-updated", onImportUpdated);
    return () => window.removeEventListener("app:import-updated", onImportUpdated);
  }, [load]);

  const saveTradeEdit = async () => {
    if (!editingTrade) return;
    const payload: TradeUpdatePayload = {
      holding_minutes:
        editHoldingMinutes.trim() === "" ? null : Math.round(Number(editHoldingMinutes) * 60 * 24),
    };
    if (payload.holding_minutes != null) {
      if (Number.isNaN(payload.holding_minutes) || payload.holding_minutes < 0) {
        alert("持有天数请输入大于等于 0 的数字");
        return;
      }
      payload.holding_minutes = Math.round(payload.holding_minutes);
    }
    setEditSaving(true);
    try {
      await api.updateTrade(editingTrade.id, payload);
      setEditingTrade(null);
      await load();
    } catch (e) {
      alert((e as Error).message || "更新失败");
    } finally {
      setEditSaving(false);
    }
  };

  const openTradeDeepAnalysis = (t: TradeRecord) => {
    const isBuy = t.buy_price > 0 && t.sell_price <= 0;
    const price = isBuy ? t.buy_price : t.sell_price;
    openMidlongFromReviewTrade({
      tradeId: t.id,
      code: t.code,
      name: t.name || undefined,
      tradeDate: t.trade_date,
      side: isBuy ? "buy" : "sell",
      price,
      qty: t.qty,
      days,
    });
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

  const loadLatestDraft = useCallback(async () => {
    if (!api.isLoggedIn()) return;
    try {
      const latest = await api.getLatestAIDraft();
      setPlanDraft(latest);
      setDraftItems(parseDraftItems(latest?.content_json));
    } catch {
      setPlanDraft(null);
      setDraftItems([]);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) {
      const timer = window.setTimeout(() => {
        void loadLatestDraft();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [loggedIn, loadLatestDraft]);

  const loadPlanReview = useCallback(async () => {
    if (!api.isLoggedIn()) return;
    try {
      const r = await api.getPlanReviewLink();
      setPlanReview(r);
    } catch {
      setPlanReview(null);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) {
      const timer = window.setTimeout(() => {
        void loadPlanReview();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [loggedIn, loadPlanReview]);

  const loadHoldingCodes = useCallback(async () => {
    if (!api.isLoggedIn()) return;
    try {
      const resp = await api.listUserHoldings();
      const items = (resp?.items || []) as UserHoldingItem[];
      const codes = Array.from(
        new Set(
          items
            .map((h) => (h.stock_code || "").trim())
            .filter(Boolean),
        ),
      );
      setHoldingCodes(codes);
    } catch {
      setHoldingCodes([]);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) {
      const timer = window.setTimeout(() => {
        void loadHoldingCodes();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [loggedIn, loadHoldingCodes]);

  const createAiDraft = async () => {
    setDraftLoading(true);
    setPlanError(null);
    setPlanSavedMsg(null);
    try {
      const resp = await api.createAIDraftPlan({ plan_date: tomorrowISODate(), model: "deepseek-v3" });
      setPlanDraft(resp.draft_version);
      setDraftItems(parseDraftItems(resp.draft_version.content_json));
    } catch (e) {
      setPlanError((e as Error).message || "生成草案失败");
    } finally {
      setDraftLoading(false);
    }
  };

  const finalizeDraft = async () => {
    if (!planDraft) return;
    if (draftItems.length === 0) {
      setPlanError("至少保留 1 条计划项");
      return;
    }
    setFinalizing(true);
    setPlanError(null);
    setPlanSavedMsg(null);
    try {
      const prev = (planDraft.content_json || {}) as Record<string, unknown>;
      const payloadItems = draftItems.map((it) => ({
        ...inferPlanMetaFromText(it.content, { code: it.code, direction: it.direction }),
        name: null,
        content: it.content || "观察强弱, 满足预期再执行",
        instruction: it.content || "观察强弱, 满足预期再执行",
        notes: null,
      }));
      const content_json = {
        ...prev,
        items: payloadItems,
      };
      await api.finalizeAIDraft(planDraft.id, {
        content_json,
        user_note: JSON.stringify({
          holding_note: holdingPlanNote.trim() || "",
          new_position_note: newPositionPlanNote.trim() || "",
        }),
      });
      setPlanSavedMsg("已保存为用户计划版本");
    } catch (e) {
      setPlanError((e as Error).message || "确认保存失败");
    } finally {
      setFinalizing(false);
    }
  };

  if (!loggedIn) {
    return (
      <div>
        <div
          className="px-3 py-2"
          style={{
            borderBottom: "1px solid var(--border-color)",
            background: "var(--bg-secondary)",
          }}
        >
          <span className="font-bold" style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}>
            交易复盘
          </span>
        </div>
        <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
          <div
            className="w-full max-w-sm p-6 rounded-xl text-center"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              color: "var(--text-secondary)",
              fontSize: "var(--font-md)",
            }}
          >
            <BookOpen size={28} style={{ color: "var(--accent-purple)" }} className="mx-auto mb-3" />
            <p className="mb-2">登录后查看交易复盘与 AI 点评</p>
            <p style={{ color: "var(--text-muted)", fontSize: "var(--font-xs)" }}>
              你可以直接在这里登录
            </p>
            <button
              onClick={openAuthModal}
              className="mt-3 px-3 py-1.5 rounded text-xs font-semibold transition-opacity hover:opacity-90"
              style={{
                background: "var(--accent-purple)",
                color: "#fff",
              }}
            >
              立即登录
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            交易复盘
          </span>
        </div>
        <div className="flex items-center gap-2">
          {view !== "review" && (
            <button
              onClick={() => setView("review")}
              className="px-2 py-1 rounded font-bold transition-colors"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                fontSize: 11,
                border: "none",
                cursor: "pointer",
              }}
            >
              交易复盘
            </button>
          )}
          {view !== "holdings" && (
            <button
              onClick={() => setView("holdings")}
              className="px-2 py-1 rounded font-bold transition-colors"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                fontSize: 11,
                border: "none",
                cursor: "pointer",
              }}
            >
              持仓与导入
            </button>
          )}
          {view === "review" &&
            [
              { value: 7, label: "7天" },
              { value: 14, label: "14天" },
              { value: 30, label: "30天" },
              { value: 60, label: "60天" },
              { value: ALL_DAYS, label: "全部" },
            ].map((d) => (
            <button
              key={d.value}
              onClick={() => setDays(d.value)}
              className="px-2 py-1 rounded font-bold transition-colors"
              style={{
                background: days === d.value ? "var(--accent-purple)" : "var(--bg-tertiary)",
                color: days === d.value ? "#fff" : "var(--text-secondary)",
                fontSize: 11,
                border: "none",
                cursor: "pointer",
              }}
            >
              {d.label}
            </button>
          ))}
          {view === "review" && loading && (
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>加载中...</span>
          )}
        </div>
      </div>

      {view === "review" && (
        <div
          className="px-3 py-2 flex items-center gap-1.5"
          style={{ borderBottom: "1px solid var(--border-color)", background: "var(--bg-secondary)" }}
        >
          <button
            onClick={() => setReviewTab("trades")}
            className="px-2 py-1 rounded font-bold transition-colors"
            style={{
              background: reviewTab === "trades" ? "var(--accent-purple)" : "var(--bg-tertiary)",
              color: reviewTab === "trades" ? "#fff" : "var(--text-secondary)",
              fontSize: 11,
              border: "none",
              cursor: "pointer",
            }}
          >
            交易明细
          </button>
          <button
            onClick={() => setReviewTab("ai")}
            className="px-2 py-1 rounded font-bold transition-colors"
            style={{
              background: reviewTab === "ai" ? "var(--accent-purple)" : "var(--bg-tertiary)",
              color: reviewTab === "ai" ? "#fff" : "var(--text-secondary)",
              fontSize: 11,
              border: "none",
              cursor: "pointer",
            }}
          >
            AI 复盘
          </button>
          <button
            onClick={() => setReviewTab("plan")}
            className="px-2 py-1 rounded font-bold transition-colors"
            style={{
              background: reviewTab === "plan" ? "var(--accent-purple)" : "var(--bg-tertiary)",
              color: reviewTab === "plan" ? "#fff" : "var(--text-secondary)",
              fontSize: 11,
              border: "none",
              cursor: "pointer",
            }}
          >
            明日计划
          </button>
        </div>
      )}

      {view === "review" ? (
        <div className="p-3 space-y-3">
          {(reviewTab === "trades" || reviewTab === "ai") && pattern && (
            <PatternCards pattern={pattern} days={days} allDays={ALL_DAYS} />
          )}
          {reviewTab === "trades" && (
            <TradeList
              trades={trades}
              onOpenStock={openStockDetail}
              onOpenDeepAnalysis={openTradeDeepAnalysis}
              highlightedTradeId={highlightTradeId}
            />
          )}
          {reviewTab === "ai" && (
            <div className="max-w-3xl space-y-3">
              <AiReviewCard
                loading={aiLoading}
                review={aiReview}
                error={aiError}
                onRun={runAiReview}
                empty={trades.length === 0}
              />
              <YesterdayPlanReviewCard review={planReview} />
            </div>
          )}
          {reviewTab === "plan" && (
            <div className="max-w-6xl">
              <AiTomorrowPlanCard
                draft={planDraft}
                items={draftItems}
                holdingCodes={holdingCodes}
                onItemsChange={setDraftItems}
                loading={draftLoading}
                finalizing={finalizing}
                error={planError}
                savedMsg={planSavedMsg}
                holdingNote={holdingPlanNote}
                newPositionNote={newPositionPlanNote}
                onHoldingNoteChange={setHoldingPlanNote}
                onNewPositionNoteChange={setNewPositionPlanNote}
                onGenerate={createAiDraft}
                onFinalize={finalizeDraft}
              />
            </div>
          )}
        </div>
      ) : (
        <MyHoldingsPage embedded />
      )}
      <TradeEditModal
        trade={editingTrade}
        holdingMinutes={editHoldingMinutes}
        saving={editSaving}
        onHoldingMinutesChange={setEditHoldingMinutes}
        onCancel={() => setEditingTrade(null)}
        onSave={saveTradeEdit}
      />
    </div>
  );
}


function PatternCards({
  pattern,
  days,
  allDays,
}: {
  pattern: TradePattern;
  days: number;
  allDays: number;
}) {
  const wr = pattern.win_rate;
  const exp = pattern.expectation;
  const chase = pattern.chase_rate;
  const periodPnl = pattern.total_pnl;
  const holdingPnl = pattern.holding_pnl ?? 0;
  const closedPnl = pattern.closed_pnl ?? pattern.total_pnl;
  const accountPnl = pattern.account_pnl ?? (closedPnl + holdingPnl);
  const holdingFromInitial = pattern.holding_from_initial_pnl ?? 0;
  const holdingFromNew = pattern.holding_from_new_buys_pnl ?? (holdingPnl - holdingFromInitial);
  const allDiffNote =
    days >= allDays && pattern.account_vs_holdings_diff != null
      ? ` / 与持仓页差值 ${pattern.account_vs_holdings_diff >= 0 ? "+" : ""}${pattern.account_vs_holdings_diff.toFixed(0)}`
      : "";
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
      <Stat
        icon={<Wallet size={11} style={{ color: accountPnl >= 0 ? "var(--accent-red)" : "var(--accent-green)" }} />}
        label="区间总盈亏"
        value={accountPnl}
        suffix="元"
        color={accountPnl >= 0 ? "var(--accent-red)" : "var(--accent-green)"}
        sub={`按右上角时间窗口计算：已平仓 ${periodPnl >= 0 ? "+" : ""}${periodPnl.toFixed(0)} / 起点持仓浮盈 ${holdingFromInitial >= 0 ? "+" : ""}${holdingFromInitial.toFixed(0)} / 区间新开仓浮盈 ${holdingFromNew >= 0 ? "+" : ""}${holdingFromNew.toFixed(0)}${allDiffNote}`}
      />
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
  onOpenStock,
  onOpenDeepAnalysis,
  highlightedTradeId,
}: {
  trades: TradeRecord[];
  onOpenStock: (code: string, name?: string) => void;
  onOpenDeepAnalysis: (trade: TradeRecord) => void;
  highlightedTradeId: number | null;
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
          暂无交易, 点右上角&quot;录入交易&quot;开始
        </div>
      ) : (
        <table className="w-full" style={{ fontSize: "var(--font-xs)", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
              <th className="px-2 py-1.5 text-left" style={{ width: 90 }}>日期</th>
              <th className="px-2 py-1.5 text-left" style={{ width: 130 }}>标的</th>
              <th className="px-2 py-1.5 text-center" style={{ width: 60 }}>方向</th>
              <th className="px-2 py-1.5 text-right tabular-nums" style={{ width: 80 }}>成交价</th>
              <th className="px-2 py-1.5 text-right tabular-nums" style={{ width: 60 }}>数量</th>
              <th className="px-2 py-1.5 text-center" style={{ width: 90 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => {
              const isBuy = t.buy_price > 0 && t.sell_price <= 0;
              const sideLabel = isBuy ? "买" : "卖";
              const sideColor = isBuy ? "var(--accent-red)" : "var(--accent-green)";
              const dealPrice = isBuy ? t.buy_price : t.sell_price;
              return (
                <tr
                  key={t.id}
                  id={`trade-row-${t.id}`}
                  style={{
                    borderTop: "1px solid var(--border-color)",
                    background:
                      highlightedTradeId === t.id
                        ? "rgba(168,85,247,0.16)"
                        : "transparent",
                    transition: "background 0.25s ease",
                  }}
                >
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
                  <td className="px-2 py-1.5 text-center" style={{ color: sideColor, fontWeight: 700 }}>
                    {sideLabel}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {dealPrice.toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{t.qty}</td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      onClick={() => onOpenDeepAnalysis(t)}
                      className="px-2 py-0.5 rounded font-bold"
                      style={{
                        background: "rgba(245,158,11,0.16)",
                        color: "var(--accent-orange)",
                        border: "1px solid rgba(245,158,11,0.4)",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      深度分析
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

function TradeEditModal({
  trade,
  holdingMinutes,
  saving,
  onHoldingMinutesChange,
  onCancel,
  onSave,
}: {
  trade: TradeRecord | null;
  holdingMinutes: string;
  saving: boolean;
  onHoldingMinutesChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (!trade) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
    >
      <div
        className="w-full max-w-lg rounded p-3 space-y-2"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
        }}
      >
        <div className="flex items-center justify-between">
          <div className="font-bold" style={{ fontSize: "var(--font-sm)" }}>
            编辑交易：{trade.code} {trade.name || ""}
          </div>
          <button
            onClick={onCancel}
            style={{
              color: "var(--text-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            关闭
          </button>
        </div>
        <label className="flex flex-col gap-1" style={{ fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>持有天数</span>
          <input
            value={holdingMinutes}
            onChange={(e) => onHoldingMinutesChange(e.target.value)}
            placeholder="例如 1.5"
            className="px-2 py-1 rounded"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }}
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-2 py-1 rounded"
            style={{
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              color: "var(--text-secondary)",
              fontSize: 11,
            }}
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-2 py-1 rounded font-bold"
            style={{
              background: "var(--accent-purple)",
              color: "#fff",
              border: "none",
              fontSize: 11,
              opacity: saving ? 0.6 : 1,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
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
            点击右上角 &quot;AI 复盘&quot; 让导师给你点评
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
              </div>
              <div style={{ color: "var(--text-primary)", lineHeight: 1.5 }}>{review.summary}</div>
            </div>
            <Section icon={<Trophy size={11} style={{ color: "var(--accent-red)" }} />} title="优势" items={review.strengths} color="var(--accent-red)" />
            <Section icon={<TrendingDown size={11} style={{ color: "var(--accent-green)" }} />} title="短板" items={review.weaknesses} color="var(--accent-green)" />
            <Section icon={<Lightbulb size={11} style={{ color: "var(--accent-orange)" }} />} title="改进建议" items={review.suggestions} color="var(--accent-orange)" />
          </>
        )}
      </div>
    </div>
  );
}

function AiTomorrowPlanCard({
  draft,
  items,
  holdingCodes,
  onItemsChange,
  loading,
  finalizing,
  error,
  savedMsg,
  holdingNote,
  newPositionNote,
  onHoldingNoteChange,
  onNewPositionNoteChange,
  onGenerate,
  onFinalize,
}: {
  draft: PlanVersionRecord | null;
  items: DraftPlanItem[];
  holdingCodes: string[];
  onItemsChange: (items: DraftPlanItem[]) => void;
  loading: boolean;
  finalizing: boolean;
  error: string | null;
  savedMsg: string | null;
  holdingNote: string;
  newPositionNote: string;
  onHoldingNoteChange: (v: string) => void;
  onNewPositionNoteChange: (v: string) => void;
  onGenerate: () => void;
  onFinalize: () => void;
}) {
  const updateItem = (idx: number, patch: Partial<DraftPlanItem>) => {
    onItemsChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const holdingSet = new Set(holdingCodes);
  const getItemCode = (it: DraftPlanItem) => {
    const byField = (it.code || "").trim();
    if (byField) return byField;
    const m = (it.content || "").match(/\d{6}/);
    return m?.[0] || "";
  };
  const holdingItems: Array<{ item: DraftPlanItem; idx: number }> = [];
  const newPositionItems: Array<{ item: DraftPlanItem; idx: number }> = [];
  items.forEach((it, idx) => {
    const code = getItemCode(it);
    if (code && holdingSet.has(code)) {
      holdingItems.push({ item: it, idx });
    } else {
      newPositionItems.push({ item: it, idx });
    }
  });

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
          <Wand2 size={12} style={{ color: "var(--accent-orange)" }} />
          <span className="font-bold" style={{ fontSize: "var(--font-sm)" }}>
            AI 明日计划
          </span>
        </div>
        <button
          onClick={onGenerate}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-1 rounded font-bold"
          style={{
            background: "var(--accent-orange)",
            color: "#1a1d28",
            fontSize: 11,
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          <Wand2 size={11} />
          {loading ? "生成中..." : draft ? "重新生成" : "AI 生成明日计划"}
        </button>
      </div>
      <div className="p-3 space-y-2" style={{ fontSize: 11 }}>
        {!draft && !loading && (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
            基于你的交易习惯自动起草 3-5 条明日计划, 你可直接微调后保存
          </div>
        )}
        {draft && (
          <>
            <div style={{ color: "var(--text-muted)", fontSize: 10 }}>
              计划日期: {draft.plan_date} · 状态: {draft.status}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <div
                style={{
                  border: "1px solid rgba(34,197,94,0.35)",
                  borderRadius: 4,
                  padding: 8,
                  background: "rgba(34,197,94,0.06)",
                }}
              >
                <div style={{ color: "var(--accent-green)", fontWeight: 700, fontSize: 11, marginBottom: 6 }}>
                  已有持仓动作（{holdingItems.length}）
                </div>
                {holdingItems.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 10 }}>
                    暂无识别到持仓内标的动作
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {holdingItems.map(({ item: it, idx }) => (
                      <div
                        key={`hold-${it.code}-${idx}`}
                        style={{
                          border: "1px solid var(--border-color)",
                          borderRadius: 4,
                          padding: 8,
                          background: "var(--bg-secondary)",
                        }}
                      >
                        <textarea
                          value={it.content}
                          onChange={(e) => updateItem(idx, { content: e.target.value })}
                          placeholder="用自然语言写持仓动作，例如：贵州茅台若冲高回落，先减仓三成。"
                          rows={3}
                          className="w-full px-2 py-1 rounded resize-none"
                          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <textarea
                    value={holdingNote}
                    onChange={(e) => onHoldingNoteChange(e.target.value)}
                    rows={2}
                    placeholder="持仓计划调整意见"
                    className="w-full px-2 py-1 rounded resize-none"
                    style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }}
                  />
                </div>
              </div>

              <div
                style={{
                  border: "1px solid rgba(245,158,11,0.35)",
                  borderRadius: 4,
                  padding: 8,
                  background: "rgba(245,158,11,0.06)",
                }}
              >
                <div style={{ color: "var(--accent-orange)", fontWeight: 700, fontSize: 11, marginBottom: 6 }}>
                  新开仓计划（{newPositionItems.length}）
                </div>
                {newPositionItems.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 10 }}>
                    暂无识别到新开仓计划
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {newPositionItems.map(({ item: it, idx }) => (
                      <div
                        key={`new-${it.code}-${idx}`}
                        style={{
                          border: "1px solid var(--border-color)",
                          borderRadius: 4,
                          padding: 8,
                          background: "var(--bg-secondary)",
                        }}
                      >
                        <textarea
                          value={it.content}
                          onChange={(e) => updateItem(idx, { content: e.target.value })}
                          placeholder="用自然语言写开仓计划，例如：若光刻胶回流，关注容大感光首阴低吸。"
                          rows={3}
                          className="w-full px-2 py-1 rounded resize-none"
                          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <textarea
                    value={newPositionNote}
                    onChange={(e) => onNewPositionNoteChange(e.target.value)}
                    rows={2}
                    placeholder="新开仓调整意见"
                    className="w-full px-2 py-1 rounded resize-none"
                    style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }}
                  />
                </div>
              </div>
            </div>
            <button
              onClick={onFinalize}
              disabled={finalizing || items.length === 0}
              className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded font-bold"
              style={{
                background: "var(--accent-purple)",
                color: "#fff",
                fontSize: 11,
                border: "none",
                cursor: finalizing || items.length === 0 ? "not-allowed" : "pointer",
                opacity: finalizing || items.length === 0 ? 0.6 : 1,
              }}
            >
              <Save size={11} />
              {finalizing ? "保存中..." : "确认为我的明日计划"}
            </button>
          </>
        )}
        {error && (
          <div style={{ color: "var(--accent-red)", fontSize: 10 }}>
            {error}
          </div>
        )}
        {savedMsg && (
          <div style={{ color: "var(--accent-green)", fontSize: 10 }}>
            {savedMsg}
          </div>
        )}
      </div>
    </div>
  );
}

function YesterdayPlanReviewCard({ review }: { review: PlanReviewLinkRecord | null }) {
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
          <Target size={12} style={{ color: "var(--accent-blue)" }} />
          <span className="font-bold" style={{ fontSize: "var(--font-sm)" }}>
            昨日计划执行回顾
          </span>
        </div>
      </div>
      <div className="p-3" style={{ fontSize: 11 }}>
        {!review ? (
          <div style={{ color: "var(--text-muted)" }}>暂无回顾数据</div>
        ) : !review.has_plan ? (
          <div style={{ color: "var(--text-muted)" }}>
            当日未找到已确认计划；临时交易 {review.summary.unexpected_count} 只。
          </div>
        ) : (
          <div className="space-y-2">
            <div style={{ color: "var(--text-muted)", fontSize: 10 }}>
              计划日: {review.plan_date} · 命中 {review.summary.hit_count}/{review.summary.planned_count}
              · 偏离 {review.summary.unexpected_count}
            </div>
            <div className="space-y-1">
              {review.items.map((it) => (
                <div
                  key={it.code}
                  className="flex items-center gap-2 rounded px-2 py-1"
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: it.hit ? "var(--accent-green)" : "var(--accent-orange)",
                      minWidth: 34,
                    }}
                  >
                    {it.hit ? "命中" : "未做"}
                  </span>
                  <span className="font-bold tabular-nums">{it.code}</span>
                  <span style={{ color: "var(--text-muted)" }}>{it.direction}</span>
                  <span style={{ color: it.net_pnl >= 0 ? "var(--accent-red)" : "var(--accent-green)" }}>
                    {it.net_pnl >= 0 ? "+" : ""}
                    {it.net_pnl.toFixed(0)}
                  </span>
                  <span style={{ color: "var(--text-muted)", marginLeft: "auto" }}>
                    {it.trades_count} 笔
                  </span>
                </div>
              ))}
            </div>
            {review.unexpected_codes.length > 0 && (
              <div style={{ color: "var(--text-muted)", fontSize: 10 }}>
                计划外交易: {review.unexpected_codes.join("、")}
              </div>
            )}
          </div>
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
