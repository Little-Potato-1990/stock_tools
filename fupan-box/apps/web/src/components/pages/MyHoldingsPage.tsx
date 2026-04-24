"use client";

/**
 * 我的持仓 (my_holdings)
 *
 * 统一的「个人数据装入」入口, 把原本散落在「账户套餐」里的截图导入功能
 * 提到一级菜单, 配套展示当前持仓表 / 数据完整性体检 / 最近导入历史 / 原始流水。
 *
 * 数据来源 (均与「我的复盘」共用同一份底层数据):
 *   - UserHolding (截图 OCR 写入) → 当前持仓
 *   - UserTradeRaw (截图 OCR 写入) → 原始流水
 *   - UserTrade   (FIFO 配对生成) → 已平仓 round-trip (在「我的复盘」展示)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Camera,
  Coins,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  api,
  type ImportJobMeta,
  type RawTradeItem,
  type ReconciliationResult,
  type UserHoldingItem,
} from "@/lib/api";
import { useImportCenterStore } from "@/stores/import-center-store";
import { useUIStore } from "@/stores/ui-store";
import { DataQualityCard } from "@/components/common/ImportCenter";

const fmtNum = (v: number | null | undefined, digits = 2) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return v.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const fmtInt = (v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return v.toLocaleString("zh-CN");
};

export function MyHoldingsPage() {
  const openImportCenter = useImportCenterStore((s) => s.open);
  const openStockDetail = useUIStore((s) => s.openStockDetail);

  const [holdings, setHoldings] = useState<UserHoldingItem[]>([]);
  const [recon, setRecon] = useState<ReconciliationResult | null>(null);
  const [recentJobs, setRecentJobs] = useState<ImportJobMeta[]>([]);
  const [rawTrades, setRawTrades] = useState<RawTradeItem[]>([]);
  const [rawTotal, setRawTotal] = useState(0);
  const [rawLimit, setRawLimit] = useState(100);
  const [filterCode, setFilterCode] = useState("");

  const [loading, setLoading] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [hres, rres, jobs, traw] = await Promise.all([
        api.listUserHoldings().catch(() => ({ items: [] as UserHoldingItem[] })),
        api.getReconciliation().catch(() => null),
        api.listImportJobs().catch(() => [] as ImportJobMeta[]),
        api
          .listRawTrades({ limit: rawLimit, offset: 0, code: filterCode || undefined })
          .catch(() => ({ total: 0, limit: rawLimit, offset: 0, items: [] as RawTradeItem[] })),
      ]);
      setHoldings(hres.items || []);
      setRecon(rres ?? null);
      setRecentJobs(jobs.slice(0, 8));
      setRawTrades(traw.items);
      setRawTotal(traw.total);
    } finally {
      setLoading(false);
    }
  }, [rawLimit, filterCode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
  }, [loadAll]);

  const handleRevalidate = useCallback(async () => {
    setIsRevalidating(true);
    try {
      await api.repairReconciliation();
      await loadAll();
    } finally {
      setIsRevalidating(false);
    }
  }, [loadAll]);

  const totalMV = useMemo(
    () => holdings.reduce((sum, h) => sum + (h.market_value ?? 0), 0),
    [holdings],
  );
  const totalPnl = useMemo(
    () => holdings.reduce((sum, h) => sum + (h.pnl ?? 0), 0),
    [holdings],
  );

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
          <Coins size={14} style={{ color: "var(--accent-orange)" }} />
          <span
            className="font-bold"
            style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
          >
            我的持仓
          </span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            截图导入持仓 / 交易记录, 自动 OCR + FIFO 配对, 共「我的复盘」「AI 副驾」共用
          </span>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className="p-1 rounded"
          style={{ color: "var(--text-muted)" }}
          title="刷新"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        <ImportEntryCard
          onUploadHoldings={() => openImportCenter("holdings")}
          onUploadTrades={() => openImportCenter("trades")}
        />

        <HoldingsTable
          holdings={holdings}
          totalMV={totalMV}
          totalPnl={totalPnl}
          onClickRow={(code, name) => openStockDetail(code, name ?? undefined)}
        />

        <DataQualityCard
          data={
            recon
              ? {
                  summary: recon.summary,
                  per_stock: recon.per_stock,
                  coverage: recon.coverage,
                }
              : null
          }
          onRevalidate={handleRevalidate}
          isRevalidating={isRevalidating}
        />

        <RecentImportsList jobs={recentJobs} loading={loading} />

        <RawTradesTable
          rows={rawTrades}
          total={rawTotal}
          limit={rawLimit}
          onLimitChange={setRawLimit}
          filterCode={filterCode}
          onFilterCode={setFilterCode}
          onClickRow={(code, name) => openStockDetail(code, name ?? undefined)}
        />
      </div>
    </div>
  );
}

function ImportEntryCard({
  onUploadHoldings,
  onUploadTrades,
}: {
  onUploadHoldings: () => void;
  onUploadTrades: () => void;
}) {
  return (
    <div
      className="rounded p-3"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Camera size={13} style={{ color: "var(--accent-orange)" }} />
        <span
          className="font-semibold"
          style={{ color: "var(--text-primary)", fontSize: "var(--font-sm)" }}
        >
          截图导入 · 同花顺手机版 / 其他主流券商
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
          单次最多 5 张, 自动 OCR + 多张去重
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-2">
        <button
          onClick={onUploadHoldings}
          className="text-xs px-3 py-1.5 rounded transition-opacity hover:opacity-90 flex items-center gap-1"
          style={{
            border: "1px solid rgba(245,158,11,0.5)",
            color: "var(--text-primary)",
            background: "rgba(245,158,11,0.14)",
          }}
        >
          <Upload size={11} /> 上传持仓截图
        </button>
        <button
          onClick={onUploadTrades}
          className="text-xs px-3 py-1.5 rounded transition-opacity hover:opacity-90 flex items-center gap-1"
          style={{
            border: "1px solid rgba(168,85,247,0.5)",
            color: "var(--text-primary)",
            background: "rgba(168,85,247,0.12)",
          }}
        >
          <Upload size={11} /> 上传交易记录截图
        </button>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
        建议先传 <b style={{ color: "var(--text-secondary)" }}>持仓截图</b>(对账锚点),
        再传 <b style={{ color: "var(--text-secondary)" }}>交易记录</b>(尽量从该股最早一笔成交开始, 多截几张, 重叠会自动去重)。
        历史不全也没事, 系统会用 virtual_initial 兜底。
      </div>
    </div>
  );
}

function HoldingsTable({
  holdings,
  totalMV,
  totalPnl,
  onClickRow,
}: {
  holdings: UserHoldingItem[];
  totalMV: number;
  totalPnl: number;
  onClickRow: (code: string, name: string | null) => void;
}) {
  const empty = holdings.length === 0;
  return (
    <div
      className="rounded"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        overflow: "hidden",
      }}
    >
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <div className="flex items-center gap-2">
          <Coins size={13} style={{ color: "var(--accent-orange)" }} />
          <span
            className="font-semibold"
            style={{ color: "var(--text-primary)", fontSize: "var(--font-sm)" }}
          >
            当前持仓 · 共 {holdings.length} 只
          </span>
        </div>
        {!empty && (
          <div className="flex items-center gap-3 tabular-nums" style={{ fontSize: 11 }}>
            <span style={{ color: "var(--text-muted)" }}>
              总市值{" "}
              <span style={{ color: "var(--text-primary)" }}>¥{fmtNum(totalMV, 0)}</span>
            </span>
            <span style={{ color: "var(--text-muted)" }}>
              累计盈亏{" "}
              <span
                style={{
                  color: totalPnl >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                  fontWeight: 700,
                }}
              >
                {totalPnl >= 0 ? "+" : ""}
                {fmtNum(totalPnl, 0)}
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="max-h-[320px] overflow-auto">
        <table className="w-full" style={{ fontSize: "var(--font-sm)" }}>
          <thead>
            <tr style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
              <th className="px-2 py-1.5 text-left">代码 / 名称</th>
              <th className="px-2 py-1.5 text-right">数量</th>
              <th className="px-2 py-1.5 text-right">成本</th>
              <th className="px-2 py-1.5 text-right">现价</th>
              <th className="px-2 py-1.5 text-right">市值</th>
              <th className="px-2 py-1.5 text-right">盈亏</th>
              <th className="px-2 py-1.5 text-right">持仓天数</th>
            </tr>
          </thead>
          <tbody>
            {empty && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center"
                  style={{ color: "var(--text-muted)", fontSize: 12 }}
                >
                  暂无持仓数据 · 请先点击上方&ldquo;上传持仓截图&rdquo;
                </td>
              </tr>
            )}
            {holdings.map((h) => {
              const pnlPositive = (h.pnl ?? 0) >= 0;
              return (
                <tr
                  key={`${h.stock_code}-${h.account_label}`}
                  style={{
                    borderTop: "1px solid var(--border-color)",
                    cursor: "pointer",
                  }}
                  onClick={() => onClickRow(h.stock_code, h.stock_name)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <td className="px-2 py-1.5">
                    <div style={{ color: "var(--accent-orange)" }}>{h.stock_code}</div>
                    <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
                      {h.stock_name || "-"}
                    </div>
                  </td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {fmtInt(h.qty)}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {fmtNum(h.avg_cost, 3)}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {fmtNum(h.market_price, 3)}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {fmtNum(h.market_value, 0)}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums font-bold"
                    style={{
                      color: pnlPositive ? "var(--accent-red)" : "var(--accent-green)",
                    }}
                  >
                    {pnlPositive ? "+" : ""}
                    {fmtNum(h.pnl, 0)}
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: "var(--text-muted)",
                      }}
                    >
                      {h.pnl_pct !== null && h.pnl_pct !== undefined
                        ? `${h.pnl_pct >= 0 ? "+" : ""}${fmtNum(h.pnl_pct, 2)}%`
                        : "-"}
                    </div>
                  </td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {h.holding_days ?? "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecentImportsList({
  jobs,
  loading,
}: {
  jobs: ImportJobMeta[];
  loading: boolean;
}) {
  return (
    <div
      className="rounded"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        overflow: "hidden",
      }}
    >
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <span
          className="font-semibold"
          style={{ color: "var(--text-primary)", fontSize: "var(--font-sm)" }}
        >
          最近导入记录
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
          仅展示最近 8 条
        </span>
      </div>
      <div className="p-2 space-y-1">
        {loading && jobs.length === 0 ? (
          <div
            className="flex items-center gap-1"
            style={{ fontSize: 11, color: "var(--text-muted)" }}
          >
            <Loader2 size={11} className="animate-spin" /> 加载中...
          </div>
        ) : jobs.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>暂无导入记录</div>
        ) : (
          jobs.map((j) => {
            const done = ["done", "success", "succeeded", "completed"].includes(
              String(j.status || "").toLowerCase(),
            );
            const metric =
              j.kind === "trades"
                ? `新增 ${j.raw_inserted ?? 0} / 去重 ${j.raw_skipped_duplicate ?? 0} / 配对 ${j.paired_trades ?? 0}`
                : `识别 ${j.parsed_count ?? 0} / 入库 ${j.upserted ?? 0}`;
            return (
              <div
                key={j.job_id}
                className="px-2 py-1 rounded flex items-center justify-between"
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                }}
              >
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  <span style={{ color: "var(--text-muted)" }}>
                    {String(j.created_at || "").slice(0, 16) || "--"}
                  </span>
                  <span style={{ marginLeft: 8 }}>
                    {j.kind === "trades" ? "交易记录" : "持仓"}
                  </span>
                  <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
                    {metric}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: done ? "var(--accent-green)" : "var(--text-muted)",
                  }}
                >
                  {done ? "✓ 完成" : String(j.status || "-")}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function RawTradesTable({
  rows,
  total,
  limit,
  onLimitChange,
  filterCode,
  onFilterCode,
  onClickRow,
}: {
  rows: RawTradeItem[];
  total: number;
  limit: number;
  onLimitChange: (n: number) => void;
  filterCode: string;
  onFilterCode: (s: string) => void;
  onClickRow: (code: string, name: string | null) => void;
}) {
  const [codeInput, setCodeInput] = useState(filterCode);
  return (
    <div
      className="rounded"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        overflow: "hidden",
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-2"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <span
          className="font-semibold"
          style={{ color: "var(--text-primary)", fontSize: "var(--font-sm)" }}
        >
          原始流水 · 最近 {rows.length} / 共 {total} 条
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
          按时间倒序; 包含双边买/卖单
        </span>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={codeInput}
            onChange={(e) =>
              setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="6位代码筛选"
            className="px-2 py-1 rounded"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              fontSize: 11,
              color: "var(--text-primary)",
              width: 100,
            }}
          />
          <button
            type="button"
            onClick={() => onFilterCode(codeInput)}
            className="px-2 py-1 rounded"
            style={{
              border: "1px solid var(--border-color)",
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              fontSize: 11,
            }}
          >
            筛选
          </button>
          {filterCode && (
            <button
              type="button"
              onClick={() => {
                setCodeInput("");
                onFilterCode("");
              }}
              className="px-2 py-1 rounded"
              style={{
                border: "1px solid var(--border-color)",
                background: "var(--bg-tertiary)",
                color: "var(--text-muted)",
                fontSize: 11,
              }}
            >
              清除
            </button>
          )}
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            className="px-1.5 py-1 rounded"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              fontSize: 11,
              color: "var(--text-secondary)",
            }}
          >
            <option value={50}>显示 50</option>
            <option value={100}>显示 100</option>
            <option value={200}>显示 200</option>
            <option value={500}>显示 500</option>
          </select>
        </div>
      </div>

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full" style={{ fontSize: "var(--font-sm)" }}>
          <thead>
            <tr style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
              <th className="px-2 py-1.5 text-left">日期</th>
              <th className="px-2 py-1.5 text-left">时间</th>
              <th className="px-2 py-1.5 text-left">代码 / 名称</th>
              <th className="px-2 py-1.5 text-center">方向</th>
              <th className="px-2 py-1.5 text-right">价格</th>
              <th className="px-2 py-1.5 text-right">数量</th>
              <th className="px-2 py-1.5 text-right">金额</th>
              <th className="px-2 py-1.5 text-center">配对</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center"
                  style={{ color: "var(--text-muted)", fontSize: 12 }}
                >
                  暂无原始流水
                </td>
              </tr>
            )}
            {rows.map((t) => {
              const isBuy = t.side === "buy" || t.side === "B" || t.side === "买入";
              const sideColor = isBuy ? "var(--accent-red)" : "var(--accent-green)";
              const sideLabel = isBuy ? "买" : "卖";
              return (
                <tr
                  key={t.id}
                  style={{ borderTop: "1px solid var(--border-color)", cursor: "pointer" }}
                  onClick={() => onClickRow(t.stock_code, t.stock_name)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <td
                    className="px-2 py-1 tabular-nums"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {t.trade_date || "-"}
                  </td>
                  <td
                    className="px-2 py-1 tabular-nums"
                    style={{ color: "var(--text-muted)", fontSize: 11 }}
                  >
                    {t.trade_time || "-"}
                  </td>
                  <td className="px-2 py-1">
                    <span style={{ color: "var(--accent-orange)" }}>{t.stock_code}</span>
                    <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 11 }}>
                      {t.stock_name || ""}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <span
                      style={{
                        padding: "1px 6px",
                        borderRadius: 3,
                        background: isBuy
                          ? "rgba(239,68,68,0.18)"
                          : "rgba(34,197,94,0.18)",
                        color: sideColor,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {sideLabel}
                    </span>
                  </td>
                  <td
                    className="px-2 py-1 text-right tabular-nums"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {fmtNum(t.price, 3)}
                  </td>
                  <td
                    className="px-2 py-1 text-right tabular-nums"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {fmtInt(t.qty)}
                  </td>
                  <td
                    className="px-2 py-1 text-right tabular-nums"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {fmtNum(t.amount, 2)}
                  </td>
                  <td
                    className="px-2 py-1 text-center"
                    style={{ fontSize: 11 }}
                  >
                    {t.matched_trade_id ? (
                      <span style={{ color: "var(--accent-green)" }}>已配对</span>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
