"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useUIStore, type LhbScope } from "@/stores/ui-store";
import { PageHeader } from "@/components/layout/PageHeader";
import { LhbAiCard } from "@/components/market/LhbAiCard";
import { api } from "@/lib/api";

const SUB_TABS: { key: LhbScope; label: string }[] = [
  { key: "daily", label: "每日龙虎榜" },
  { key: "office_history", label: "营业部历史" },
  { key: "hot_money", label: "游资追踪" },
];

const OFFICE_DAY_OPTIONS = [30, 60, 90, 120] as const;

// —— 金额 / 数字展示 ——

function fmtAmount(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${sign}${(a / 1e4).toFixed(0)}万`;
  return `${sign}${a.toFixed(0)}`;
}

function fmtPctChange(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function fmtAmountRate(rate: number): string {
  return `${rate.toFixed(1)}%`;
}

// —— snapshot 解析 ——

interface LhbInstRow {
  stock_code: string;
  exalter: string;
  is_inst: boolean;
  side: number;
  buy: number;
  buy_rate: number;
  sell: number;
  sell_rate: number;
  net_buy: number;
  reason: string;
}

interface LhbStockRow {
  stock_code: string;
  stock_name: string;
  close: number;
  pct_change: number;
  turnover_rate: number;
  amount: number;
  lhb_buy: number;
  lhb_sell: number;
  lhb_amount: number;
  net_amount: number;
  net_rate: number;
  amount_rate: number;
  float_values: number;
  reason: string;
}

interface LhbSnapshotData {
  stock_count: number;
  inst_count: number;
  stocks: LhbStockRow[];
  insts_by_code: Record<string, LhbInstRow[]>;
}

function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asBool(v: unknown): boolean {
  return v === true;
}

function parseLhbSnapshot(raw: unknown): LhbSnapshotData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const stocksRaw = o.stocks;
  if (!Array.isArray(stocksRaw)) return null;

  const stocks: LhbStockRow[] = stocksRaw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      stock_code: asStr(r.stock_code),
      stock_name: asStr(r.stock_name),
      close: asNum(r.close),
      pct_change: asNum(r.pct_change),
      turnover_rate: asNum(r.turnover_rate),
      amount: asNum(r.amount),
      lhb_buy: asNum(r.lhb_buy),
      lhb_sell: asNum(r.lhb_sell),
      lhb_amount: asNum(r.lhb_amount),
      net_amount: asNum(r.net_amount),
      net_rate: asNum(r.net_rate),
      amount_rate: asNum(r.amount_rate),
      float_values: asNum(r.float_values),
      reason: asStr(r.reason),
    };
  });

  const insts_by_code: Record<string, LhbInstRow[]> = {};
  const ibc = o.insts_by_code;
  if (ibc && typeof ibc === "object" && !Array.isArray(ibc)) {
    for (const [code, arr] of Object.entries(ibc as Record<string, unknown>)) {
      if (!Array.isArray(arr)) continue;
      insts_by_code[code] = arr.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          stock_code: asStr(r.stock_code),
          exalter: asStr(r.exalter),
          is_inst: asBool(r.is_inst),
          side: asNum(r.side),
          buy: asNum(r.buy),
          buy_rate: asNum(r.buy_rate),
          sell: asNum(r.sell),
          sell_rate: asNum(r.sell_rate),
          net_buy: asNum(r.net_buy),
          reason: asStr(r.reason),
        };
      });
    }
  }

  return {
    stock_count: asNum(o.stock_count, stocks.length),
    inst_count: asNum(o.inst_count),
    stocks,
    insts_by_code,
  };
}

function getInstsForStock(
  instsByCode: Record<string, LhbInstRow[]>,
  stockCode: string,
): LhbInstRow[] {
  if (instsByCode[stockCode]?.length) return instsByCode[stockCode];
  const d = stockCode.replace(/\D/g, "");
  const six = d.length >= 6 ? d.slice(-6) : d.padStart(6, "0");
  if (instsByCode[six]?.length) return instsByCode[six];
  for (const [k, arr] of Object.entries(instsByCode)) {
    const kd = k.replace(/\D/g, "");
    if (kd.endsWith(six) || six.endsWith(kd)) return arr;
  }
  return [];
}

function sortByAbsNetBuy(a: LhbInstRow, b: LhbInstRow): number {
  return Math.abs(b.net_buy) - Math.abs(a.net_buy);
}

// —— 样式小件 ——

function mutedEmpty(text: string) {
  return (
    <div className="text-center" style={{ color: "var(--text-muted)", fontSize: 12, padding: "24px 0" }}>
      {text}
    </div>
  );
}

function InstBadge({ isInst, label }: { isInst: boolean; label: string }) {
  if (isInst || label === "机构专用") {
    return (
      <span
        style={{
          background: "var(--accent-purple)",
          color: "#fff",
          padding: "1px 6px",
          borderRadius: 3,
          fontSize: 10,
          marginRight: 4,
          verticalAlign: "middle",
        }}
      >
        机构
      </span>
    );
  }
  return null;
}

function SideTag({ side }: { side: number }) {
  const buyer = side === 0;
  return (
    <span
      style={{
        background: buyer ? "var(--accent-green)" : "var(--accent-red)",
        color: "#fff",
        padding: "1px 6px",
        borderRadius: 3,
        fontSize: 10,
      }}
    >
      {buyer ? "买方" : "卖方"}
    </span>
  );
}

function HitChip({ count, days }: { count: number; days: number }) {
  if (count < 2) return null; // 只出现 1 次（即只今日）就不展示，减少噪音
  // 频度高的着色提示：≥10 橙、5-9 黄、2-4 灰
  let bg = "rgba(255,255,255,0.10)";
  let color = "var(--text-secondary)";
  if (count >= 10) {
    bg = "rgba(245,158,11,0.22)";
    color = "var(--accent-orange)";
  } else if (count >= 5) {
    bg = "rgba(234,179,8,0.18)";
    color = "#eab308";
  }
  return (
    <span
      className="tabular-nums"
      style={{
        background: bg,
        color,
        padding: "0 5px",
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 600,
        marginLeft: 4,
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
      title={`近 ${days} 日上榜 ${count} 次`}
    >
      {days}日 {count}次
    </span>
  );
}

// —— Tab: 每日龙虎榜 ——

function LhbDailyTab() {
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const setLhbScope = useUIStore((s) => s.setLhbScope);
  const setLhbOfficeQuery = useUIStore((s) => s.setLhbOfficeQuery);

  const [rows, setRows] = useState<Array<{ trade_date: string; data: LhbSnapshotData }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api
      .getSnapshotRange("lhb", 30)
      .then((raw) => {
        if (cancel) return;
        const parsed: Array<{ trade_date: string; data: LhbSnapshotData }> = [];
        for (const r of raw) {
          const data = parseLhbSnapshot(r.data);
          if (data) parsed.push({ trade_date: r.trade_date, data });
        }
        parsed.sort((a, b) => (a.trade_date < b.trade_date ? 1 : a.trade_date > b.trade_date ? -1 : 0));
        setRows(parsed);
        if (parsed.length > 0) {
          setSelectedDate((d) => d ?? parsed[0].trade_date);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const dateIndex = useMemo(() => {
    if (!selectedDate || rows.length === 0) return -1;
    return rows.findIndex((r) => r.trade_date === selectedDate);
  }, [rows, selectedDate]);

  const current = dateIndex >= 0 ? rows[dateIndex] : null;

  const sortedStocks = useMemo(() => {
    if (!current) return [];
    return [...current.data.stocks].sort(
      (a, b) => Math.abs(b.net_amount) - Math.abs(a.net_amount),
    );
  }, [current]);

  const STATS_WINDOW = 30;

  const stockHitsMap = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    if (dateIndex < 0) return m;
    const end = Math.min(rows.length, dateIndex + STATS_WINDOW);
    for (let i = dateIndex; i < end; i++) {
      const seenInDay = new Set<string>();
      for (const s of rows[i].data.stocks) {
        if (!s.stock_code || seenInDay.has(s.stock_code)) continue;
        seenInDay.add(s.stock_code);
        m.set(s.stock_code, (m.get(s.stock_code) ?? 0) + 1);
      }
    }
    return m;
  }, [rows, dateIndex]);

  const exalterHitsMap = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    if (dateIndex < 0) return m;
    const end = Math.min(rows.length, dateIndex + STATS_WINDOW);
    for (let i = dateIndex; i < end; i++) {
      const seenInDay = new Set<string>();
      for (const arr of Object.values(rows[i].data.insts_by_code)) {
        for (const inst of arr) {
          if (!inst.exalter || seenInDay.has(inst.exalter)) continue;
          seenInDay.add(inst.exalter);
          m.set(inst.exalter, (m.get(inst.exalter) ?? 0) + 1);
        }
      }
    }
    return m;
  }, [rows, dateIndex]);

  const totalNet = useMemo(() => {
    if (!current) return 0;
    return current.data.stocks.reduce((s, x) => s + x.net_amount, 0);
  }, [current]);

  const goPrevDate = useCallback(() => {
    if (dateIndex < 0 || dateIndex >= rows.length - 1) return;
    setSelectedDate(rows[dateIndex + 1].trade_date);
  }, [dateIndex, rows]);

  const goNextDate = useCallback(() => {
    if (dateIndex <= 0) return;
    setSelectedDate(rows[dateIndex - 1].trade_date);
  }, [dateIndex, rows]);

  const jumpToOffice = useCallback(
    (exalter: string) => {
      setLhbOfficeQuery(exalter);
      setLhbScope("office_history");
    },
    [setLhbOfficeQuery, setLhbScope],
  );

  if (loading) {
    return (
      <div className="p-3 space-y-2">
        <div className="h-10 animate-pulse rounded" style={{ background: "var(--bg-card)" }} />
        <div className="h-64 animate-pulse rounded" style={{ background: "var(--bg-card)" }} />
      </div>
    );
  }

  if (rows.length === 0 || !current) {
    return mutedEmpty("暂无龙虎榜快照数据");
  }

  return (
    <div className="p-3" style={{ background: "var(--bg-primary)" }}>
      {/* 摘要栏 */}
      <div
        className="flex items-center gap-2 mb-2 px-2 py-2 rounded"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          fontSize: 13,
        }}
      >
        <button
          type="button"
          className="px-2 py-0.5 rounded tabular-nums"
          style={{
            border: "1px solid var(--border-color)",
            color: "var(--text-secondary)",
            fontSize: 12,
          }}
          onClick={goPrevDate}
          disabled={dateIndex < 0 || dateIndex >= rows.length - 1}
        >
          ‹
        </button>
        <select
          className="tabular-nums flex-1 min-w-0"
          style={{
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 13,
          }}
          value={selectedDate ?? ""}
          onChange={(e) => setSelectedDate(e.target.value)}
        >
          {rows.map((r) => (
            <option key={r.trade_date} value={r.trade_date}>
              {r.trade_date.replace(/-/g, "")}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="px-2 py-0.5 rounded tabular-nums"
          style={{
            border: "1px solid var(--border-color)",
            color: "var(--text-secondary)",
            fontSize: 12,
          }}
          onClick={goNextDate}
          disabled={dateIndex <= 0}
        >
          ›
        </button>
        <div className="shrink-0 tabular-nums" style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          上榜{" "}
          <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{current.data.stocks.length}</span>{" "}
          只
        </div>
        <div className="shrink-0 tabular-nums" style={{ fontSize: 12 }}>
          <span style={{ color: "var(--text-muted)" }}>净买入 </span>
          <span
            style={{
              color: totalNet >= 0 ? "var(--accent-red)" : "var(--accent-green)",
              fontWeight: 700,
            }}
          >
            {fmtAmount(totalNet)}
          </span>
        </div>
      </div>

      {/* 表头 */}
      <div
        className="flex items-stretch px-2 py-1.5 tabular-nums"
        style={{
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-color)",
          fontSize: 12,
          fontWeight: 700,
          color: "var(--text-secondary)",
        }}
      >
        <div style={{ flex: "1.2 1 0", minWidth: 0 }}>名称 / 代码</div>
        <div className="text-right" style={{ flex: "0.6 1 0", minWidth: 56 }}>
          涨跌幅
        </div>
        <div className="text-right" style={{ flex: "0.85 1 0", minWidth: 72 }}>
          净买入
        </div>
        <div className="text-right" style={{ flex: "0.65 1 0", minWidth: 56 }}>
          占成交
        </div>
        <div style={{ flex: "1.4 1 0", minWidth: 0, paddingLeft: 8 }}>上榜原因</div>
      </div>

      <div style={{ border: "1px solid var(--border-color)", borderTop: "none", borderRadius: "0 0 6px 6px" }}>
        {sortedStocks.length === 0
          ? mutedEmpty("当日无上榜个股")
          : sortedStocks.map((stock) => {
              const code = stock.stock_code;
              const isOpen = expanded === code;
              const insts = getInstsForStock(current.data.insts_by_code, code);
              const buyers = insts.filter((i) => i.side === 0).sort(sortByAbsNetBuy);
              const sellers = insts.filter((i) => i.side === 1).sort(sortByAbsNetBuy);
              const chgColor =
                stock.pct_change >= 0 ? "var(--accent-red)" : "var(--accent-green)";
              const netColor =
                stock.net_amount >= 0 ? "var(--accent-red)" : "var(--accent-green)";

              return (
                <div
                  key={code}
                  style={{
                    borderBottom: "1px solid var(--border-color)",
                    background: "var(--bg-card)",
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex items-start px-2 py-2 cursor-pointer select-none"
                    style={{ fontSize: 13 }}
                    onClick={() => setExpanded((c) => (c === code ? null : code))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpanded((c) => (c === code ? null : code));
                      }
                    }}
                  >
                    <div style={{ flex: "1.2 1 0", minWidth: 0 }}>
                      <span className="inline-flex items-center">
                        <button
                          type="button"
                          className="text-left font-medium"
                          style={{ color: "var(--text-primary)" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openStockDetail(code, stock.stock_name);
                          }}
                        >
                          {stock.stock_name}
                        </button>
                        <HitChip count={stockHitsMap.get(code) ?? 0} days={STATS_WINDOW} />
                      </span>
                      <button
                        type="button"
                        className="block tabular-nums"
                        style={{ color: "var(--text-muted)", fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          openStockDetail(code, stock.stock_name);
                        }}
                      >
                        {code}
                      </button>
                    </div>
                    <div className="text-right tabular-nums font-medium" style={{ flex: "0.6 1 0", color: chgColor }}>
                      {fmtPctChange(stock.pct_change)}
                    </div>
                    <div className="text-right tabular-nums font-bold" style={{ flex: "0.85 1 0", color: netColor }}>
                      {fmtAmount(stock.net_amount)}
                    </div>
                    <div
                      className="text-right tabular-nums"
                      style={{ flex: "0.65 1 0", color: "var(--text-secondary)" }}
                    >
                      {fmtAmountRate(stock.amount_rate)}
                    </div>
                    <div style={{ flex: "1.4 1 0", minWidth: 0, paddingLeft: 8, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                      {stock.reason}
                    </div>
                  </div>

                  {isOpen && (
                    <div
                      className="px-2 pb-2"
                      style={{ background: "var(--bg-tertiary)", borderTop: "1px dashed var(--border-color)" }}
                    >
                      <div className="flex gap-2 pt-2">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            className="mb-1 font-bold"
                            style={{ fontSize: 12, color: "var(--accent-green)" }}
                          >
                            买方席位
                          </div>
                          {buyers.length === 0 ? (
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>无</div>
                          ) : (
                            buyers.map((row, idx) => {
                              const nc = row.net_buy >= 0 ? "var(--accent-red)" : "var(--accent-green)";
                              return (
                                <div
                                  key={`b-${idx}-${row.exalter}`}
                                  className="flex items-start justify-between gap-1 py-1"
                                  style={{ fontSize: 11, borderBottom: "1px solid var(--border-color)" }}
                                >
                                  <button
                                    type="button"
                                    className="text-left"
                                    style={{ color: "var(--text-primary)", lineHeight: 1.35 }}
                                    onClick={() => jumpToOffice(row.exalter)}
                                  >
                                    <InstBadge isInst={row.is_inst} label={row.exalter} />
                                    <span>{row.exalter}</span>
                                    <HitChip count={exalterHitsMap.get(row.exalter) ?? 0} days={STATS_WINDOW} />
                                  </button>
                                  <span className="tabular-nums shrink-0 font-medium" style={{ color: nc }}>
                                    {fmtAmount(row.net_buy)}
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            className="mb-1 font-bold"
                            style={{ fontSize: 12, color: "var(--accent-red)" }}
                          >
                            卖方席位
                          </div>
                          {sellers.length === 0 ? (
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>无</div>
                          ) : (
                            sellers.map((row, idx) => {
                              const nc = row.net_buy >= 0 ? "var(--accent-red)" : "var(--accent-green)";
                              return (
                                <div
                                  key={`s-${idx}-${row.exalter}`}
                                  className="flex items-start justify-between gap-1 py-1"
                                  style={{ fontSize: 11, borderBottom: "1px solid var(--border-color)" }}
                                >
                                  <button
                                    type="button"
                                    className="text-left"
                                    style={{ color: "var(--text-primary)", lineHeight: 1.35 }}
                                    onClick={() => jumpToOffice(row.exalter)}
                                  >
                                    <InstBadge isInst={row.is_inst} label={row.exalter} />
                                    <span>{row.exalter}</span>
                                    <HitChip count={exalterHitsMap.get(row.exalter) ?? 0} days={STATS_WINDOW} />
                                  </button>
                                  <span className="tabular-nums shrink-0 font-medium" style={{ color: nc }}>
                                    {fmtAmount(row.net_buy)}
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
      </div>
    </div>
  );
}

// —— Tab: 营业部历史 ——

function LhbOfficeHistoryTab() {
  const scope = useUIStore((s) => s.lhbScope);
  const openStockDetail = useUIStore((s) => s.openStockDetail);

  const [officeInput, setOfficeInput] = useState("");
  const [days, setDays] = useState<(typeof OFFICE_DAY_OPTIONS)[number]>(30);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.getLhbOfficeHistory>> | null>(null);
  const prevScopeRef = useRef<LhbScope>(scope);

  useLayoutEffect(() => {
    if (scope === "office_history" && prevScopeRef.current !== "office_history") {
      setOfficeInput(useUIStore.getState().lhbOfficeQuery);
    }
    prevScopeRef.current = scope;
  }, [scope]);

  const runQuery = useCallback(() => {
    const q = officeInput.trim();
    if (!q) {
      setResult(null);
      return;
    }
    setLoading(true);
    api
      .getLhbOfficeHistory(q, days)
      .then(setResult)
      .catch((e) => {
        console.error(e);
        setResult(null);
      })
      .finally(() => setLoading(false));
  }, [officeInput, days]);

  const sortedRecords = useMemo(() => {
    if (!result?.records) return [];
    return [...result.records].sort((a, b) => (a.trade_date < b.trade_date ? 1 : -1));
  }, [result]);

  const distinctStocks = useMemo(() => {
    if (!result?.records) return 0;
    return new Set(result.records.map((r) => r.stock_code)).size;
  }, [result]);

  return (
    <div className="p-3" style={{ background: "var(--bg-primary)" }}>
      <div
        className="flex flex-wrap items-center gap-2 mb-2 px-2 py-2 rounded"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
        }}
      >
        <input
          type="text"
          placeholder="输入营业部名称"
          className="flex-1 min-w-[200px] px-2 py-1.5 rounded"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            color: "var(--text-primary)",
            fontSize: 13,
          }}
          value={officeInput}
          onChange={(e) => setOfficeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runQuery();
          }}
        />
        <select
          className="tabular-nums px-2 py-1.5 rounded"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            color: "var(--text-primary)",
            fontSize: 12,
          }}
          value={days}
          onChange={(e) => setDays(Number(e.target.value) as (typeof OFFICE_DAY_OPTIONS)[number])}
        >
          {OFFICE_DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              回溯 {d} 天
            </option>
          ))}
        </select>
        <button
          type="button"
          className="px-3 py-1.5 rounded font-medium"
          style={{
            background: "var(--accent-orange)",
            color: "#fff",
            fontSize: 13,
          }}
          onClick={runQuery}
        >
          查询
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-8 animate-pulse rounded" style={{ background: "var(--bg-card)" }} />
          <div className="h-48 animate-pulse rounded" style={{ background: "var(--bg-card)" }} />
        </div>
      ) : result ? (
        <>
          <div
            className="mb-2 px-2 tabular-nums"
            style={{ color: "var(--text-secondary)", fontSize: 12 }}
          >
            上榜{" "}
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{result.appearance}</span> 次 / 累计净买入{" "}
            <span
              style={{
                color: result.total_net_buy >= 0 ? "var(--accent-red)" : "var(--accent-green)",
                fontWeight: 700,
              }}
            >
              {fmtAmount(result.total_net_buy)}
            </span>{" "}
            / 涉及{" "}
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{distinctStocks}</span> 只股票
          </div>

          <div
            className="flex items-stretch px-2 py-1.5 tabular-nums"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderBottom: "none",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ flex: "0.75 1 0", minWidth: 72 }}>日期</div>
            <div style={{ flex: "1.1 1 0", minWidth: 0 }}>股票</div>
            <div className="text-right" style={{ flex: "0.55 1 0", minWidth: 56 }}>
              涨跌幅
            </div>
            <div style={{ flex: "0.5 1 0", minWidth: 48, textAlign: "center" }}>方向</div>
            <div className="text-right" style={{ flex: "0.7 1 0", minWidth: 64 }}>
              净买入
            </div>
            <div style={{ flex: "1.2 1 0", minWidth: 0, paddingLeft: 6 }}>上榜原因</div>
          </div>
          <div style={{ border: "1px solid var(--border-color)", borderRadius: "0 0 6px 6px" }}>
            {sortedRecords.length === 0
              ? mutedEmpty("无历史记录")
              : sortedRecords.map((rec, i) => {
                  const chgColor =
                    rec.pct_change >= 0 ? "var(--accent-red)" : "var(--accent-green)";
                  const netColor =
                    rec.net_buy >= 0 ? "var(--accent-red)" : "var(--accent-green)";
                  return (
                    <div
                      key={`${rec.trade_date}-${rec.stock_code}-${i}`}
                      className="flex items-start px-2 py-1.5 tabular-nums"
                      style={{
                        fontSize: 13,
                        borderBottom: "1px solid var(--border-color)",
                        background: "var(--bg-card)",
                      }}
                    >
                      <div style={{ flex: "0.75 1 0", color: "var(--text-secondary)", fontSize: 12, minWidth: 72 }}>
                        {rec.trade_date.replace(/-/g, "")}
                      </div>
                      <div style={{ flex: "1.1 1 0", minWidth: 0 }}>
                        <button
                          type="button"
                          className="text-left font-medium"
                          style={{ color: "var(--text-primary)" }}
                          onClick={() => openStockDetail(rec.stock_code, rec.stock_name)}
                        >
                          {rec.stock_name}
                        </button>
                        <button
                          type="button"
                          className="block"
                          style={{ color: "var(--text-muted)", fontSize: 11 }}
                          onClick={() => openStockDetail(rec.stock_code, rec.stock_name)}
                        >
                          {rec.stock_code}
                        </button>
                      </div>
                      <div className="text-right font-medium" style={{ flex: "0.55 1 0", color: chgColor, minWidth: 56 }}>
                        {fmtPctChange(rec.pct_change)}
                      </div>
                      <div style={{ flex: "0.5 1 0", minWidth: 48, display: "flex", justifyContent: "center" }}>
                        <SideTag side={rec.side} />
                      </div>
                      <div className="text-right font-bold" style={{ flex: "0.7 1 0", color: netColor, minWidth: 64 }}>
                        {fmtAmount(rec.net_buy)}
                      </div>
                      <div style={{ flex: "1.2 1 0", minWidth: 0, paddingLeft: 6, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.35 }}>
                        {rec.reason}
                      </div>
                    </div>
                  );
                })}
          </div>
        </>
      ) : officeInput.trim() === "" ? (
        mutedEmpty(
          "在上方输入营业部名称查询历史记录，例如：机构专用、国泰海通证券股份有限公司上海分公司",
        )
      ) : result === null && !loading ? (
        mutedEmpty("点击「查询」加载营业部历史")
      ) : null}
    </div>
  );
}

// —— Tab: 游资追踪 ——

function LhbHotMoneyTab() {
  const setLhbScope = useUIStore((s) => s.setLhbScope);
  const setLhbOfficeQuery = useUIStore((s) => s.setLhbOfficeQuery);

  const [days, setDays] = useState<(typeof OFFICE_DAY_OPTIONS)[number]>(30);
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof api.getLhbHotMoney>> | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api
      .getLhbHotMoney(days, 50)
      .then((d) => {
        if (!cancel) setPayload(d);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [days]);

  const rankSorted = useMemo(() => {
    if (!payload?.rank) return [];
    return [...payload.rank].sort((a, b) => b.net_buy_total - a.net_buy_total);
  }, [payload]);

  const jumpToOffice = useCallback(
    (exalter: string) => {
      setLhbOfficeQuery(exalter);
      setLhbScope("office_history");
    },
    [setLhbOfficeQuery, setLhbScope],
  );

  if (loading) {
    return (
      <div className="p-3 space-y-2">
        <div className="h-10 animate-pulse rounded" style={{ background: "var(--bg-card)" }} />
        <div className="h-64 animate-pulse rounded" style={{ background: "var(--bg-card)" }} />
      </div>
    );
  }

  if (!payload || rankSorted.length === 0) {
    return mutedEmpty("暂无游资榜数据");
  }

  return (
    <div className="p-3" style={{ background: "var(--bg-primary)" }}>
      <div
        className="flex flex-wrap items-center gap-3 mb-2 px-2 py-2 rounded"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          fontSize: 13,
        }}
      >
        <select
          className="tabular-nums px-2 py-1.5 rounded"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            color: "var(--text-primary)",
            fontSize: 12,
          }}
          value={days}
          onChange={(e) => setDays(Number(e.target.value) as (typeof OFFICE_DAY_OPTIONS)[number])}
        >
          {OFFICE_DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              回溯 {d} 天
            </option>
          ))}
        </select>
        <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          累计{" "}
          <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{rankSorted.length}</span>{" "}
          个游资席位
        </div>
      </div>

      <div
        className="flex items-stretch px-2 py-1.5 tabular-nums"
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderBottom: "none",
          fontSize: 12,
          fontWeight: 700,
          color: "var(--text-secondary)",
        }}
      >
        <div className="text-right" style={{ width: 36 }}>
          排名
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>营业部</div>
        <div className="text-right" style={{ flex: "0.55 1 0", minWidth: 56 }}>
          上榜次数
        </div>
        <div className="text-right" style={{ flex: "0.45 1 0", minWidth: 44 }}>
          涉及股
        </div>
        <div className="text-right" style={{ flex: "0.75 1 0", minWidth: 72 }}>
          累计净买入
        </div>
      </div>
      <div style={{ border: "1px solid var(--border-color)", borderRadius: "0 0 6px 6px" }}>
        {rankSorted.map((row, idx) => {
          const netColor =
            row.net_buy_total >= 0 ? "var(--accent-red)" : "var(--accent-green)";
          return (
            <div
              key={row.exalter}
              className="flex items-start px-2 py-1.5 tabular-nums"
              style={{
                fontSize: 13,
                borderBottom: "1px solid var(--border-color)",
                background: "var(--bg-card)",
              }}
            >
              <div className="text-right font-bold" style={{ width: 36, color: "var(--text-primary)" }}>
                {idx + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>
                <button
                  type="button"
                  className="text-left"
                  style={{ color: "var(--text-primary)", lineHeight: 1.35, wordBreak: "break-all" }}
                  onClick={() => jumpToOffice(row.exalter)}
                >
                  {row.exalter}
                </button>
              </div>
              <div className="text-right" style={{ flex: "0.55 1 0", color: "var(--text-secondary)", minWidth: 56 }}>
                {row.appearance}
              </div>
              <div className="text-right" style={{ flex: "0.45 1 0", color: "var(--text-secondary)", minWidth: 44 }}>
                {row.stock_count}
              </div>
              <div className="text-right font-bold" style={{ flex: "0.75 1 0", color: netColor, minWidth: 72 }}>
                {fmtAmount(row.net_buy_total)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LhbPage() {
  const scope = useUIStore((s) => s.lhbScope);
  const setScope = useUIStore((s) => s.setLhbScope);

  return (
    <div>
      <PageHeader
        title="龙虎榜分析"
        subtitle={SUB_TABS.find((t) => t.key === scope)?.label}
      />

      {/* P1: AI 资金面拆解卡 — 跨所有 tab 始终展示, 让"游资意图"先进入视野 */}
      <LhbAiCard />

      <div
        className="flex items-center px-3"
        style={{
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
          height: 36,
        }}
      >
        {SUB_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setScope(key)}
            className="font-medium transition-colors relative"
            style={{
              padding: "0 14px",
              height: 36,
              fontSize: "var(--font-md)",
              color:
                scope === key ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {label}
            {scope === key && (
              <div
                className="absolute bottom-0 left-2 right-2"
                style={{ height: 2, background: "var(--accent-orange)" }}
              />
            )}
          </button>
        ))}
      </div>

      {scope === "daily" && <LhbDailyTab />}
      {scope === "office_history" && <LhbOfficeHistoryTab />}
      {scope === "hot_money" && <LhbHotMoneyTab />}
    </div>
  );
}
