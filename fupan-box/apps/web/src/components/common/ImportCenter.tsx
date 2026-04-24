"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import {
  api,
  type ImportJobDetail,
  type ImportJobMeta,
  type ReconciliationCoverage,
  type ReconciliationRepairResult,
  type ReconciliationStock,
  type ReconciliationSummary,
} from "@/lib/api";
import { useImportCenterStore, type ImportKind } from "@/stores/import-center-store";
import { useUIStore } from "@/stores/ui-store";

interface HoldingsRow {
  code: string;
  name: string;
  shares: number | null;
  cost: number | null;
  price: number | null;
  pnlPct: number | null;
}

interface TradeRow {
  tradeDate: string;
  code: string;
  name: string;
  side: string;
  price: number | null;
  qty: number | null;
  amount: number | null;
}

interface UploadSummary {
  jobId: number;
  warnings: string[];
  parsedCount?: number;
  upserted?: number;
  rawInserted?: number;
  rawSkippedDuplicate?: number;
  pairedTrades?: number;
  reconciliation?: ReconciliationRepairResult | null;
}

const MAX_FILES = 5;
const MAX_FILE_MB = 5;

function prettyDate(dt?: string) {
  if (!dt) return "-";
  return dt.slice(0, 10);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const p = Number(v.replace(/,/g, ""));
    if (Number.isFinite(p)) return p;
  }
  return null;
}

function formatNum(v: number | null, digits = 2) {
  if (v == null) return "-";
  return v.toFixed(digits);
}

function getArrayFromPayload(payload: unknown, candidates: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (!payload || typeof payload !== "object") return [];
  for (const key of candidates) {
    const val = (payload as Record<string, unknown>)[key];
    if (Array.isArray(val)) return val as Array<Record<string, unknown>>;
  }
  return [];
}

function extractHoldingsRows(detail: ImportJobDetail | null): HoldingsRow[] {
  if (!detail) return [];
  const rows = getArrayFromPayload(detail.parsed_payload, ["rows", "items", "holdings", "positions"]);
  return rows.map((r) => ({
    code: String(r.code ?? r.stock_code ?? r.symbol ?? ""),
    name: String(r.name ?? r.stock_name ?? r.stock ?? ""),
    shares: toNumber(r.shares ?? r.qty ?? r.quantity),
    cost: toNumber(r.cost ?? r.cost_price ?? r.avg_cost),
    price: toNumber(r.price ?? r.current_price ?? r.market_price),
    pnlPct: toNumber(r.pnl_pct ?? r.profit_pct ?? r.return_pct),
  }));
}

function extractTradeRows(detail: ImportJobDetail | null): TradeRow[] {
  if (!detail) return [];
  const rows = getArrayFromPayload(detail.parsed_payload, ["rows", "items", "trades", "records"]);
  return rows
    .map((r) => ({
      tradeDate: String(r.trade_date ?? r.date ?? r.time ?? ""),
      code: String(r.code ?? r.stock_code ?? r.symbol ?? ""),
      name: String(r.name ?? r.stock_name ?? ""),
      side: String(r.side ?? r.action ?? r.direction ?? ""),
      price: toNumber(r.price ?? r.deal_price),
      qty: toNumber(r.qty ?? r.quantity ?? r.shares),
      amount: toNumber(r.amount ?? r.turnover ?? r.value),
    }))
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
}

function kindLabel(kind: ImportKind) {
  return kind === "holdings" ? "持仓" : "交易";
}

function statusBadge(status: ReconciliationStock["status"]) {
  switch (status) {
    case "ok":
      return { icon: CheckCircle2, color: "var(--accent-green)", bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.45)", label: "完整" };
    case "gap_before_cutoff":
      return { icon: AlertTriangle, color: "var(--accent-orange)", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.45)", label: "已自动补底仓" };
    case "no_raw_history":
      return { icon: AlertTriangle, color: "var(--accent-orange)", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.45)", label: "全部模拟底仓" };
    case "excess_in_raw":
      return { icon: XCircle, color: "#fca5a5", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.45)", label: "需补卖出截图" };
    case "implied_no_holding":
      return { icon: XCircle, color: "#fca5a5", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.45)", label: "需补持仓截图" };
  }
}

/**
 * DataQualityCard 通用展示数据契约.
 * 同时支持:
 *   - import 完成 (ReconciliationRepairResult): 展开 after.summary / after.per_stock 即可
 *   - 我的持仓页 (ReconciliationResult): 直接 summary / per_stock / coverage
 */
export interface DataQualityCardData {
  summary: ReconciliationSummary;
  per_stock: ReconciliationStock[];
  coverage?: ReconciliationCoverage;
  /** 本次新注入的 virtual_initial 笔数 (无则 0) */
  injected?: number;
  /** 已配对 round-trip 总数 (无则 undefined, 不展示) */
  round_trips_total?: number;
}

interface DataQualityCardProps {
  data: DataQualityCardData | null;
  onRevalidate: () => void;
  isRevalidating: boolean;
}

export function DataQualityCard({ data, onRevalidate, isRevalidating }: DataQualityCardProps) {
  if (!data) return null;
  const sum = data.summary;
  const perStock = data.per_stock;
  const totalStocks = perStock.length;
  const injected = data.injected ?? 0;
  const greens = sum.ok;
  const oranges = sum.gap_before_cutoff + sum.no_raw_history;
  const reds = sum.excess_in_raw + sum.implied_no_holding;
  const midGapStocks = sum.with_mid_gaps ?? 0;
  const cov = data.coverage;
  const roundTripsTotal = data.round_trips_total;
  return (
    <div
      className="rounded"
      style={{
        border: "1px solid rgba(245,158,11,0.45)",
        background: "rgba(245,158,11,0.06)",
        overflow: "hidden",
      }}
    >
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(245,158,11,0.3)" }}
      >
        <div className="flex items-center gap-2" style={{ fontSize: "var(--font-sm)", fontWeight: 600, color: "var(--text-primary)" }}>
          <CheckCircle2 size={14} style={{ color: "var(--accent-orange)" }} />
          数据完整性体检 · 共 {totalStocks} 只持仓股
        </div>
        <button
          type="button"
          onClick={onRevalidate}
          disabled={isRevalidating}
          className="px-2 py-1 rounded text-xs flex items-center gap-1 disabled:opacity-60"
          style={{
            border: "1px solid var(--border-color)",
            background: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
          }}
        >
          {isRevalidating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          重新校验
        </button>
      </div>

      <div className="px-3 py-2 flex flex-wrap gap-2" style={{ fontSize: 11 }}>
        <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(34,197,94,0.16)", color: "var(--accent-green)" }}>
          ✓ 完整 {greens}
        </span>
        {oranges > 0 && (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(245,158,11,0.16)", color: "var(--accent-orange)" }}>
            ⚠ 已补底仓 {oranges}
          </span>
        )}
        {reds > 0 && (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(239,68,68,0.16)", color: "#fca5a5" }}>
            ✗ 异常 {reds}
          </span>
        )}
        {midGapStocks > 0 && (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(245,158,11,0.16)", color: "var(--accent-orange)" }} title="该股交易序列中存在 >30 天的连续无成交段, 可能漏传中段">
            ⚠ 中段疑似缺口 × {midGapStocks}
          </span>
        )}
        {injected > 0 && (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
            本次注入 virtual_initial × {injected}
          </span>
        )}
        {roundTripsTotal !== undefined && (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
            已配对 round-trip × {roundTripsTotal}
          </span>
        )}
      </div>

      {cov && cov.real_trade_count > 0 && (
        <div
          className="px-3 py-1.5"
          style={{ borderTop: "1px solid rgba(245,158,11,0.2)", color: "var(--text-secondary)", fontSize: 11 }}
        >
          <span style={{ color: "var(--text-muted)" }}>已收录交易: </span>
          <span style={{ color: "var(--text-primary)" }}>
            {cov.earliest_real_date} → {cov.latest_real_date}
          </span>
          <span style={{ color: "var(--text-muted)" }}>
            {" "}· 跨度 {cov.span_days} 天 · 真实成交 {cov.real_trade_count} 笔
            {cov.virtual_count > 0 ? ` · 模拟底仓 ${cov.virtual_count} 笔` : ""}
          </span>
        </div>
      )}

      <div className="max-h-[260px] overflow-auto">
        <table className="w-full" style={{ fontSize: "var(--font-sm)" }}>
          <thead>
            <tr style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
              <th className="px-2 py-1.5 text-left">代码 / 名称</th>
              <th className="px-2 py-1.5 text-right">截图持仓</th>
              <th className="px-2 py-1.5 text-right">流水反推</th>
              <th className="px-2 py-1.5 text-left">覆盖区间</th>
              <th className="px-2 py-1.5 text-left">状态</th>
            </tr>
          </thead>
          <tbody>
            {perStock.map((s) => {
              const b = statusBadge(s.status);
              const Icon = b.icon;
              const hasMidGap = (s.mid_gaps?.length ?? 0) > 0;
              return (
                <tr key={`${s.code}-${s.account_label}`} style={{ borderTop: "1px solid var(--border-color)" }}>
                  <td className="px-2 py-1.5">
                    <div style={{ color: "var(--accent-orange)" }}>{s.code}</div>
                    <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{s.name || "-"}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right" style={{ color: "var(--text-primary)" }}>{s.ground_truth_qty}</td>
                  <td className="px-2 py-1.5 text-right" style={{ color: "var(--text-primary)" }}>{s.implied_qty}</td>
                  <td className="px-2 py-1.5" style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                    {s.earliest_real_date ? (
                      <>
                        <div>
                          {s.earliest_real_date} → {s.latest_real_date || "-"}
                        </div>
                        <div style={{ color: "var(--text-muted)" }}>
                          {s.coverage_days ? `${s.coverage_days} 天` : "-"}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>无</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
                      style={{ background: b.bg, color: b.color, border: `1px solid ${b.border}`, fontSize: 11 }}
                      title={s.note}
                    >
                      <Icon size={11} />
                      {b.label}
                    </span>
                    <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>
                      {s.note}
                    </div>
                    {hasMidGap && (
                      <div
                        className="mt-1 px-2 py-1 rounded"
                        style={{
                          background: "rgba(245,158,11,0.1)",
                          border: "1px dashed rgba(245,158,11,0.4)",
                          color: "var(--accent-orange)",
                          fontSize: 11,
                        }}
                      >
                        ⚠ 检测到中段无成交区间:
                        <ul style={{ marginLeft: 12, marginTop: 2 }}>
                          {(s.mid_gaps ?? []).map((g) => (
                            <li key={`${g.from}-${g.to}`}>
                              {g.from} → {g.to} (空 {g.gap_days} 天)
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {perStock.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center" style={{ color: "var(--text-muted)", fontSize: 11 }}>
                  尚无持仓数据。请先上传&ldquo;持仓截图&rdquo;。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div
        className="px-3 py-2"
        style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.7 }}
      >
        <div>
          <span style={{ color: "var(--accent-green)" }}>● 起点不全 (常见)</span>:
          截图只覆盖近期,
          截图前的底仓自动用 virtual_initial 兜底——这是&ldquo;只想从某天开始分析&rdquo;的合理场景, 不影响近期决策复盘。
        </div>
        <div>
          <span style={{ color: "var(--accent-orange)" }}>● 中段缺口 (需注意)</span>:
          表格里出现&ldquo;⚠ 检测到中段无成交区间&rdquo;时, 若你确实在该段没操作可忽略;
          若有交易请补传该区间截图——否则 FIFO 配对均价/盈亏会有偏差。
        </div>
        <div>
          想提升完整性? 滚动到该股最早一笔成交多截几张, 重叠也没事(自动去重)。
        </div>
      </div>
    </div>
  );
}

export function ImportCenter() {
  const isOpen = useImportCenterStore((s) => s.isOpen);
  const kind = useImportCenterStore((s) => s.kind);
  const open = useImportCenterStore((s) => s.open);
  const close = useImportCenterStore((s) => s.close);
  const setActiveModule = useUIStore((s) => s.setActiveModule);

  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [jobDetail, setJobDetail] = useState<ImportJobDetail | null>(null);
  const [progressIdx, setProgressIdx] = useState(1);
  const [expandedRecent, setExpandedRecent] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentJobs, setRecentJobs] = useState<ImportJobMeta[]>([]);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetUpload = useCallback(() => {
    setFiles([]);
    setError("");
    setUploadSummary(null);
    setJobDetail(null);
    setProgressIdx(1);
  }, []);

  const handleRevalidate = useCallback(async () => {
    setIsRevalidating(true);
    try {
      const recon = await api.repairReconciliation();
      setUploadSummary((prev) => (prev ? { ...prev, reconciliation: recon } : prev));
    } catch (e) {
      console.error("repair reconciliation failed", e);
    } finally {
      setIsRevalidating(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [isOpen, close]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      resetUpload();
      setExpandedRecent(false);
      setRecentJobs([]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, kind, resetUpload]);

  const onSelectFiles = (picked: FileList | null) => {
    if (!picked) return;
    const pickedFiles = Array.from(picked);
    const merged = [...files, ...pickedFiles].slice(0, MAX_FILES);
    const invalidLarge = merged.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (invalidLarge) {
      setError(`单张图片不能超过 ${MAX_FILE_MB}MB：${invalidLarge.name}`);
      return;
    }
    const invalidType = merged.find((f) => !f.type.startsWith("image/"));
    if (invalidType) {
      setError(`仅支持图片文件：${invalidType.name}`);
      return;
    }
    setError("");
    setFiles(merged);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const fetchJobWithRetry = useCallback(async (jobId: number) => {
    const doneStates = ["done", "success", "succeeded", "completed", "failed", "error"];
    for (let i = 0; i < 10; i += 1) {
      const detail = await api.getImportJob(jobId);
      const status = String(detail.status || "").toLowerCase();
      if (!status || doneStates.includes(status)) return detail;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    return api.getImportJob(jobId);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!files.length) {
      setError("请先上传至少 1 张截图");
      return;
    }
    setError("");
    setIsUploading(true);
    setUploadSummary(null);
    setJobDetail(null);
    setProgressIdx(1);

    const ticker = window.setInterval(() => {
      setProgressIdx((v) => (v >= files.length ? files.length : v + 1));
    }, 1800);

    try {
      if (kind === "holdings") {
        const result = await api.importHoldingsScreenshots(files);
        const detail = await fetchJobWithRetry(result.job_id);
        setUploadSummary({
          jobId: result.job_id,
          warnings: result.warnings || [],
          parsedCount: result.parsed_count,
          upserted: result.upserted,
          reconciliation: result.reconciliation ?? null,
        });
        setJobDetail(detail);
      } else {
        const result = await api.importTradesScreenshots(files);
        const detail = await fetchJobWithRetry(result.job_id);
        setUploadSummary({
          jobId: result.job_id,
          warnings: result.warnings || [],
          rawInserted: result.raw_inserted,
          rawSkippedDuplicate: result.raw_skipped_duplicate,
          pairedTrades: result.paired_trades,
          reconciliation: result.reconciliation ?? null,
        });
        setJobDetail(detail);
      }
    } catch (e: unknown) {
      const err = e as Error & { code?: string };
      if (err.code === "REQUIRES_LOGIN") {
        setError("请先登录账户");
      } else if (err.code === "RATE_LIMITED") {
        setError("今日 OCR 配额已用完，明天再来");
      } else {
        setError(err.message || "上传失败，请稍后重试");
      }
    } finally {
      window.clearInterval(ticker);
      setIsUploading(false);
    }
  }, [files, kind, fetchJobWithRetry]);

  const loadRecentJobs = useCallback(async () => {
    setRecentLoading(true);
    try {
      const list = await api.listImportJobs();
      setRecentJobs(list.slice(0, 5));
    } catch {
      setRecentJobs([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  const mergedWarnings = useMemo(() => {
    const fromSummary = uploadSummary?.warnings || [];
    const fromDetail = jobDetail?.warnings || [];
    return Array.from(new Set([...fromSummary, ...fromDetail]));
  }, [uploadSummary, jobDetail]);

  const previewUrls = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );
  useEffect(
    () => () => {
      previewUrls.forEach((p) => URL.revokeObjectURL(p.url));
    },
    [previewUrls],
  );

  const holdingsRows = useMemo(() => extractHoldingsRows(jobDetail), [jobDetail]);
  const tradeRows = useMemo(() => extractTradeRows(jobDetail), [jobDetail]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70]" style={{ background: "rgba(0,0,0,0.56)" }} onClick={close} />
      <div
        role="dialog"
        aria-label="截图导入中心"
        className="fixed left-1/2 top-[8vh] z-[70] -translate-x-1/2 w-[92vw] max-w-[960px]"
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: 10,
          boxShadow: "0 24px 60px rgba(0,0,0,0.56)",
          maxHeight: "84vh",
          overflow: "hidden",
        }}
      >
        <div
          className="flex items-center justify-between px-4"
          style={{ height: 48, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)" }}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => open("holdings")}
              className="px-3 py-1.5 rounded text-sm"
              style={{
                border: "1px solid var(--border-color)",
                background: kind === "holdings" ? "rgba(245,158,11,0.16)" : "var(--bg-tertiary)",
                color: kind === "holdings" ? "var(--accent-orange)" : "var(--text-secondary)",
              }}
            >
              持仓导入
            </button>
            <button
              type="button"
              onClick={() => open("trades")}
              className="px-3 py-1.5 rounded text-sm"
              style={{
                border: "1px solid var(--border-color)",
                background: kind === "trades" ? "rgba(168,85,247,0.14)" : "var(--bg-tertiary)",
                color: kind === "trades" ? "var(--accent-purple)" : "var(--text-secondary)",
              }}
            >
              交易记录导入
            </button>
          </div>
          <button type="button" onClick={close} className="p-1 rounded" style={{ color: "var(--text-muted)" }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto" style={{ maxHeight: "calc(84vh - 48px)" }}>
          <div
            className="rounded-lg p-4"
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(false);
              onSelectFiles(e.dataTransfer.files);
            }}
            style={{
              border: `1px dashed ${dragActive ? "var(--accent-orange)" : "var(--border-color)"}`,
              background: "var(--bg-secondary)",
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => onSelectFiles(e.target.files)}
            />
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Upload size={15} style={{ color: "var(--accent-orange)" }} />
              <span style={{ color: "var(--text-primary)", fontSize: "var(--font-sm)" }}>
                拖拽截图到这里，或点击选择（1-5 张，每张 ≤ 5MB）
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="px-3 py-1.5 rounded text-sm"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border-color)" }}
              >
                选择图片
              </button>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="px-3 py-1.5 rounded text-sm flex items-center gap-1"
                style={{ background: "rgba(245,158,11,0.15)", color: "var(--accent-orange)", border: "1px solid var(--accent-orange)" }}
              >
                <Camera size={13} />
                手机拍照
              </button>
            </div>

            {files.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {previewUrls.map(({ file, url }, idx) => (
                  <div
                    key={`${file.name}-${idx}`}
                    className="px-2 py-1.5 rounded flex items-center gap-2"
                    style={{ border: "1px solid var(--border-color)", background: "var(--bg-primary)" }}
                  >
                    <Image
                      src={url}
                      alt={file.name}
                      width={42}
                      height={42}
                      unoptimized
                      style={{ objectFit: "cover", borderRadius: 4, border: "1px solid var(--border-color)" }}
                    />
                    <span style={{ color: "var(--text-secondary)", fontSize: 11, maxWidth: 200 }} className="truncate">
                      {file.name}
                    </span>
                    <button type="button" onClick={() => removeFile(idx)} style={{ color: "var(--text-muted)" }}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={isUploading}
              onClick={handleUpload}
              className="px-4 py-2 rounded text-sm font-medium flex items-center gap-2 disabled:opacity-60"
              style={{
                background: kind === "holdings" ? "var(--accent-orange)" : "var(--accent-purple)",
                color: "#fff",
              }}
            >
              {isUploading && <Loader2 size={14} className="animate-spin" />}
              上传并识别
            </button>
            {isUploading && (
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                正在调用 GPT-4o Vision 识别，第 {Math.min(progressIdx, files.length)}/{Math.max(files.length, 1)} 张...
              </span>
            )}
          </div>

          {error && (
            <div
              className="mt-3 px-3 py-2 rounded flex items-center gap-2"
              style={{ border: "1px solid rgba(239,68,68,0.55)", background: "rgba(239,68,68,0.12)", color: "#fecaca" }}
            >
              <AlertTriangle size={14} />
              <span style={{ fontSize: 12 }}>{error}</span>
              {error === "请先登录账户" && (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setActiveModule("watchlist");
                  }}
                  className="ml-auto px-2 py-1 rounded text-xs"
                  style={{ border: "1px solid rgba(255,255,255,0.24)", color: "#fff" }}
                >
                  去登录
                </button>
              )}
            </div>
          )}

          {uploadSummary && (
            <div className="mt-4 space-y-2">
              {mergedWarnings.length > 0 && (
                <div
                  className="px-3 py-2 rounded"
                  style={{
                    border: "1px solid rgba(245,158,11,0.45)",
                    background: "rgba(245,158,11,0.12)",
                    color: "#fcd34d",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>OCR 提醒</div>
                  <ul style={{ fontSize: 11, marginTop: 4 }}>
                    {mergedWarnings.map((w) => (
                      <li key={w}>- {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {uploadSummary.reconciliation && (
                <DataQualityCard
                  data={{
                    summary: uploadSummary.reconciliation.after.summary,
                    per_stock: uploadSummary.reconciliation.after.per_stock,
                    coverage: uploadSummary.reconciliation.after.coverage,
                    injected: uploadSummary.reconciliation.injected.injected,
                    round_trips_total: uploadSummary.reconciliation.round_trips_total,
                  }}
                  onRevalidate={handleRevalidate}
                  isRevalidating={isRevalidating}
                />
              )}

              <div
                className="rounded"
                style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", overflow: "hidden" }}
              >
                <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border-color)" }}>
                  <span style={{ color: "var(--text-primary)", fontSize: "var(--font-sm)", fontWeight: 600 }}>
                    识别结果 · Job #{uploadSummary.jobId}
                  </span>
                  {kind === "holdings" ? (
                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                      识别 {uploadSummary.parsedCount ?? 0} 项，已入库 {uploadSummary.upserted ?? 0} 项
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                      新增 {uploadSummary.rawInserted ?? 0} 条，去重 {uploadSummary.rawSkippedDuplicate ?? 0} 条，已配对 {uploadSummary.pairedTrades ?? 0} 组
                    </span>
                  )}
                </div>

                {kind === "holdings" ? (
                  <div className="overflow-x-auto">
                    <table className="w-full" style={{ tableLayout: "fixed", fontSize: "var(--font-sm)" }}>
                      <thead>
                        <tr style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
                          <th className="px-2 py-2 text-left">代码</th>
                          <th className="px-2 py-2 text-left">名称</th>
                          <th className="px-2 py-2 text-right">股数</th>
                          <th className="px-2 py-2 text-right">成本</th>
                          <th className="px-2 py-2 text-right">市价</th>
                          <th className="px-2 py-2 text-right">盈亏%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {holdingsRows.slice(0, 30).map((r, idx) => (
                          <tr key={`${r.code}-${idx}`} style={{ borderTop: "1px solid var(--border-color)" }}>
                            <td className="px-2 py-1.5" style={{ color: "var(--accent-orange)" }}>{r.code || "-"}</td>
                            <td className="px-2 py-1.5" style={{ color: "var(--text-secondary)" }}>{r.name || "-"}</td>
                            <td className="px-2 py-1.5 text-right" style={{ color: "var(--text-primary)" }}>{formatNum(r.shares, 0)}</td>
                            <td className="px-2 py-1.5 text-right" style={{ color: "var(--text-primary)" }}>{formatNum(r.cost)}</td>
                            <td className="px-2 py-1.5 text-right" style={{ color: "var(--text-primary)" }}>{formatNum(r.price)}</td>
                            <td className="px-2 py-1.5 text-right" style={{ color: "var(--text-primary)" }}>
                              {r.pnlPct == null ? "-" : `${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(2)}%`}
                            </td>
                          </tr>
                        ))}
                        {holdingsRows.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-3 py-4 text-center" style={{ color: "var(--text-muted)" }}>
                              暂无可展示的解析明细，仍可确认入库。
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="max-h-[280px] overflow-auto">
                    <table className="w-full" style={{ tableLayout: "fixed", fontSize: "var(--font-sm)" }}>
                      <thead>
                        <tr style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
                          <th className="px-2 py-2 text-left">日期</th>
                          <th className="px-2 py-2 text-left">代码/名称</th>
                          <th className="px-2 py-2 text-left">方向</th>
                          <th className="px-2 py-2 text-right">价格</th>
                          <th className="px-2 py-2 text-right">数量</th>
                          <th className="px-2 py-2 text-right">成交额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tradeRows.slice(0, 40).map((r, idx) => (
                          <tr key={`${r.tradeDate}-${r.code}-${idx}`} style={{ borderTop: "1px solid var(--border-color)" }}>
                            <td className="px-2 py-1.5" style={{ color: "var(--text-secondary)" }}>{r.tradeDate || "-"}</td>
                            <td className="px-2 py-1.5" style={{ color: "var(--accent-purple)" }}>
                              {r.code || "-"} {r.name ? `· ${r.name}` : ""}
                            </td>
                            <td className="px-2 py-1.5" style={{ color: "var(--text-secondary)" }}>{r.side || "-"}</td>
                            <td className="px-2 py-1.5 text-right" style={{ color: "var(--text-primary)" }}>{formatNum(r.price)}</td>
                            <td className="px-2 py-1.5 text-right" style={{ color: "var(--text-primary)" }}>{formatNum(r.qty, 0)}</td>
                            <td className="px-2 py-1.5 text-right" style={{ color: "var(--text-primary)" }}>{formatNum(r.amount)}</td>
                          </tr>
                        ))}
                        {tradeRows.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-3 py-4 text-center" style={{ color: "var(--text-muted)" }}>
                              暂无可展示的解析明细，仍可确认入库。
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="px-3 py-1.5 rounded text-sm"
                  style={{ background: "var(--accent-green)", color: "#fff" }}
                >
                  确认入库
                </button>
                <button
                  type="button"
                  onClick={resetUpload}
                  className="px-3 py-1.5 rounded text-sm"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border-color)" }}
                >
                  重传
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border-color)" }}>
            <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
              数据来源：你上传的截图。识别可能有误差，请核对后确认入库。
            </div>

            <button
              type="button"
              className="mt-2 flex items-center gap-1"
              onClick={() => {
                const next = !expandedRecent;
                setExpandedRecent(next);
                if (next && isOpen) loadRecentJobs();
              }}
              style={{ color: "var(--text-secondary)", fontSize: 12 }}
            >
              最近导入记录
              <ChevronDown size={13} style={{ transform: expandedRecent ? "rotate(180deg)" : "none" }} />
            </button>

            {expandedRecent && (
              <div className="mt-2 rounded" style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)" }}>
                {recentLoading ? (
                  <div className="px-3 py-2" style={{ color: "var(--text-muted)", fontSize: 11 }}>
                    加载中...
                  </div>
                ) : recentJobs.length ? (
                  recentJobs.map((job) => (
                    <div
                      key={job.job_id}
                      className="px-3 py-2 flex items-center justify-between"
                      style={{ borderTop: "1px solid var(--border-color)" }}
                    >
                      <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                        {prettyDate(job.created_at)} · {kindLabel((job.kind === "trades" ? "trades" : "holdings") as ImportKind)}
                      </span>
                      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                        {String(job.status || "-")}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-2" style={{ color: "var(--text-muted)", fontSize: 11 }}>
                    暂无导入记录
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
