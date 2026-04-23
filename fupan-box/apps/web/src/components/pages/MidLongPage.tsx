"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Telescope,
  TrendingUp,
  Gauge,
  Users,
  Sparkles,
  Search,
  Crown,
  Activity,
  Newspaper,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { useUIStore } from "@/stores/ui-store";
import { useUniverseStore } from "@/stores/universe-store";
import { TierUpgradeBanner } from "@/components/market/TierUpgradeBanner";
import { PerspectiveBriefBar } from "@/components/market/PerspectiveBriefBar";
import { StockQuoteSection } from "@/components/market/StockQuoteSection";
import { NewsTimelineList, type NewsItemLite } from "@/components/market/NewsTimelineList";
import { CacheMetaBadge, getCacheMeta } from "@/components/market/CacheMetaBadge";
import { ShareCardButton } from "@/components/common/ShareCardButton";
import StockStatusBadge from "@/components/common/StockStatusBadge";
import type { StockStatus } from "@/components/common/StockStatusBadge";

type TabId =
  | "quote"
  | "news"
  | "brief"
  | "fundamentals"
  | "valuation"
  | "consensus"
  | "holders";

interface TabSpec {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  desc: string;
}

const TABS: TabSpec[] = [
  { id: "quote", label: "行情盘口", icon: Activity, desc: "基础资料 + 所属概念 + 涨停原因 + 近期行情 (短线主战场)" },
  { id: "news", label: "相关新闻", icon: Newspaper, desc: "近 30 天该股相关新闻时间线 (RAG 召回)" },
  { id: "brief", label: "长线 AI", icon: Sparkles, desc: "5 年财务 + 估值分位 + 一致预期 → 一句话长线判断" },
  { id: "fundamentals", label: "财务面板", icon: TrendingUp, desc: "近 8 季度营收/净利润/ROE 趋势 + 业绩预告" },
  { id: "valuation", label: "估值分位", icon: Gauge, desc: "PE/PB 当日 + 5 年滚动分位" },
  { id: "consensus", label: "一致预期", icon: Users, desc: "目标价 / EPS / 评级分布 (周维度)" },
  { id: "holders", label: "持仓追踪", icon: Crown, desc: "近 4 季度十大股东 + 主力身份变动" },
];

function fmt(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(digits) + suffix;
}

function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function chgColor(v: number | null | undefined): string {
  if (v == null) return "var(--text-secondary)";
  if (v > 0) return "var(--accent-red)";
  if (v < 0) return "var(--accent-green)";
  return "var(--text-secondary)";
}

function pctileColor(v: number | null | undefined): string {
  if (v == null) return "var(--text-secondary)";
  if (v < 0.2) return "var(--accent-green)";
  if (v < 0.4) return "#84cc16";
  if (v < 0.6) return "var(--accent-orange)";
  if (v < 0.8) return "#f97316";
  return "var(--accent-red)";
}

// ============ 顶部 EntityPicker ============

function EntityPicker({
  code,
  onPick,
}: {
  code: string | null;
  onPick: (code: string, name?: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    Array<{ code: string; name: string; status?: StockStatus | null; board?: string | null }>
  >([]);
  const [open, setOpen] = useState(false);
  const universe = useUniverseStore((s) => s.universe);
  const recent = useUIStore((s) => s.recentInteractions).filter((x) => x.kind === "stock").slice(0, 6);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const arr = await api.searchStocks(q.trim(), universe);
        if (!alive) return;
        setResults(
          arr
            .slice(0, 10)
            .map((r) => ({
              code: String(r.stock_code || ""),
              name: String(r.stock_name || ""),
              status: r.status,
              board: r.board ?? null,
            }))
            .filter((x) => x.code),
        );
      } catch {
        setResults([]);
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, universe]);

  return (
    <div style={{ position: "relative", width: 320 }}>
      <div className="flex items-center gap-2 px-2" style={{
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border-color)",
        borderRadius: 6,
        height: 30,
      }}>
        <Search size={12} color="var(--text-muted)" />
        <input
          type="text"
          value={q}
          placeholder={code ? `当前: ${code} (输入新代码切换)` : "输入股票代码或名称…"}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text-primary)",
            flex: 1,
            fontSize: 12,
          }}
        />
      </div>
      {open && (results.length > 0 || recent.length > 0) && (
        <div
          style={{
            position: "absolute",
            top: 34,
            left: 0,
            right: 0,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: 6,
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 50,
            boxShadow: "0 6px 18px rgba(0,0,0,0.32)",
          }}
        >
          {results.length === 0 && recent.length > 0 && (
            <div className="px-2 py-1" style={{ fontSize: 10, color: "var(--text-muted)" }}>
              最近浏览
            </div>
          )}
          {(results.length
            ? results
            : recent.map((r) => ({
                code: r.key,
                name: r.label || r.key,
                status: null as StockStatus | null,
                board: null as string | null,
              }))
          ).map((s) => (
            <button
              key={s.code}
              type="button"
              onMouseDown={() => onPick(s.code, s.name)}
              className="w-full text-left px-2 py-1 hover:bg-white/5 flex items-center gap-2"
              style={{ fontSize: 12, color: "var(--text-primary)" }}
            >
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate">{s.name}</span>
                <StockStatusBadge status={s.status} board={s.board} size="sm" />
              </span>
              <span className="tabular-nums flex-shrink-0" style={{ color: "var(--text-muted)", fontSize: 10 }}>
                {s.code}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 财务面板 Tab ============

function FundamentalsTab({ code }: { code: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getMidlongFundamentals>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getMidlongFundamentals(code, 8)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [code]);

  if (loading) return <div className="px-4 py-2" style={{ color: "var(--text-muted)", fontSize: 12 }}>加载中…</div>;
  if (!data || data.quarterly.length === 0) {
    return <div className="px-4 py-4" style={{ color: "var(--text-muted)", fontSize: 12 }}>
      暂无 {code} 的财务数据 (Tushare ETL 尚未跑或股票不在覆盖范围)
    </div>;
  }

  const q = data.quarterly;

  return (
    <div className="px-4 py-2 space-y-4">
      <TierUpgradeBanner tierMeta={data.tier_meta} currentCount={q.length} scope="fundamentals" />
      <div>
        <div className="font-bold mb-2" style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}>
          近 {q.length} 季度核心指标
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs" style={{ color: "var(--text-secondary)", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-color)", color: "var(--text-tertiary)" }}>
                <th className="text-left px-2 py-1">报告期</th>
                <th className="text-right px-2 py-1">营收同比</th>
                <th className="text-right px-2 py-1">净利同比</th>
                <th className="text-right px-2 py-1">ROE</th>
                <th className="text-right px-2 py-1">毛利率</th>
                <th className="text-right px-2 py-1">净利率</th>
                <th className="text-right px-2 py-1">资产负债率</th>
                <th className="text-right px-2 py-1">EPS</th>
              </tr>
            </thead>
            <tbody>
              {q.map((r) => (
                <tr key={r.report_date} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td className="px-2 py-1 tabular-nums">{r.report_date}</td>
                  <td className="px-2 py-1 text-right tabular-nums" style={{ color: chgColor(r.revenue_yoy) }}>
                    {pct(r.revenue_yoy)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums" style={{ color: chgColor(r.net_profit_yoy) }}>
                    {pct(r.net_profit_yoy)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.roe, 2, "%")}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.gross_margin, 1, "%")}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.net_margin, 1, "%")}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.debt_ratio, 1, "%")}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.eps, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.forecast.length > 0 && (
        <div>
          <div className="font-bold mb-2" style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}>
            业绩预告 / 快报 (最近 {data.forecast.length} 条)
          </div>
          <div className="space-y-1.5">
            {data.forecast.slice(0, 6).map((f, i) => (
              <div
                key={i}
                className="px-3 py-2"
                style={{
                  background: "var(--bg-tertiary)",
                  borderLeft: `3px solid ${f.nature?.includes("增") ? "var(--accent-red)" : f.nature?.includes("减") || f.nature?.includes("亏") ? "var(--accent-green)" : "var(--text-muted)"}`,
                  borderRadius: 4,
                }}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>{f.ann_date}</span>
                  <span style={{ color: "var(--text-primary)" }}>{f.period} · {f.type === "forecast" ? "预告" : "快报"}</span>
                  <span className="font-bold" style={{ color: f.nature?.includes("增") ? "var(--accent-red)" : "var(--text-secondary)" }}>
                    {f.nature || "—"}
                  </span>
                  {f.change_pct_low !== null && (
                    <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {pct(f.change_pct_low)} ~ {pct(f.change_pct_high)}
                    </span>
                  )}
                </div>
                {f.summary && (
                  <div className="mt-1 text-xs" style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {f.summary.slice(0, 200)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 估值分位 Tab ============

function ValuationTab({ code }: { code: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getMidlongValuation>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getMidlongValuation(code, 250)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [code]);

  if (loading) return <div className="px-4 py-2" style={{ color: "var(--text-muted)", fontSize: 12 }}>加载中…</div>;
  if (!data?.latest) {
    return <div className="px-4 py-4" style={{ color: "var(--text-muted)", fontSize: 12 }}>暂无估值数据</div>;
  }

  const l = data.latest;

  const Cell = ({ label, value, suffix = "" }: { label: string; value: number | null; suffix?: string }) => (
    <div style={{ background: "var(--bg-tertiary)", borderRadius: 4, padding: "8px 10px" }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</div>
      <div className="font-bold tabular-nums" style={{ fontSize: "var(--font-lg)", color: "var(--text-primary)" }}>
        {fmt(value, 2, suffix)}
      </div>
    </div>
  );

  const PctileCell = ({ label, value }: { label: string; value: number | null }) => (
    <div style={{ background: "var(--bg-tertiary)", borderRadius: 4, padding: "8px 10px" }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</div>
      <div className="font-bold tabular-nums" style={{ fontSize: "var(--font-lg)", color: pctileColor(value) }}>
        {value == null ? "—" : `${(value * 100).toFixed(1)}%`}
      </div>
      <div style={{ fontSize: 9, color: "var(--text-tertiary)" }}>
        {value == null ? "" : value < 0.3 ? "低估区间" : value < 0.7 ? "中性" : "高估区间"}
      </div>
    </div>
  );

  return (
    <div className="px-4 py-2 space-y-4">
      <TierUpgradeBanner tierMeta={data.tier_meta} currentCount={data.count} scope="valuation" />
      <div>
        <div className="font-bold mb-2" style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}>
          当日估值 ({l.trade_date})
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Cell label="PE (TTM)" value={l.pe_ttm} />
          <Cell label="PB" value={l.pb} />
          <Cell label="PS (TTM)" value={l.ps_ttm} />
          <Cell label="股息率 TTM" value={l.dv_ttm == null ? null : l.dv_ttm} suffix="%" />
        </div>
      </div>

      <div>
        <div className="font-bold mb-2" style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}>
          历史滚动分位 (越低越便宜, 5y/3y)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <PctileCell label="PE 5 年分位" value={l.pe_pct_5y} />
          <PctileCell label="PE 3 年分位" value={l.pe_pct_3y} />
          <PctileCell label="PB 5 年分位" value={l.pb_pct_5y} />
          <PctileCell label="PB 3 年分位" value={l.pb_pct_3y} />
        </div>
      </div>

      <div>
        <div className="font-bold mb-2" style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}>
          市值
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Cell label="总市值 (万)" value={l.total_mv} />
          <Cell label="流通市值 (万)" value={l.circ_mv} />
        </div>
      </div>

      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        历史序列共 {data.count} 条, 跨越 {data.series[0]?.trade_date} 至 {data.series.at(-1)?.trade_date}
      </div>
    </div>
  );
}

// ============ 卖方一致预期 Tab ============

function ConsensusTab({ code }: { code: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getMidlongConsensus>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getMidlongConsensus(code, 26)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [code]);

  if (loading) return <div className="px-4 py-2" style={{ color: "var(--text-muted)", fontSize: 12 }}>加载中…</div>;
  if (!data?.latest) {
    return <div className="px-4 py-4" style={{ color: "var(--text-muted)", fontSize: 12 }}>
      暂无 {code} 的卖方一致预期 (覆盖度有限, 主要是机构覆盖度高的股票)
    </div>;
  }

  const l = data.latest;
  const totalRating = l.rating.buy + l.rating.outperform + l.rating.hold + l.rating.underperform + l.rating.sell;
  const bullishRatio = totalRating === 0 ? 0 : (l.rating.buy + l.rating.outperform) / totalRating;

  return (
    <div className="px-4 py-2 space-y-4">
      <TierUpgradeBanner tierMeta={data.tier_meta} currentCount={data.count} scope="consensus" />
      <div>
        <div className="font-bold mb-2" style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}>
          当周一致预期 ({l.week_end} · {l.report_count ?? 0} 份研报 · {l.institution_count ?? 0} 家机构)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { l: "目标价 (均值)", v: fmt(l.target_price_avg, 2) },
            { l: "目标价 (中位)", v: fmt(l.target_price_median, 2) },
            { l: "目标价 4 周变化", v: pct(l.target_price_chg_4w_pct), c: chgColor(l.target_price_chg_4w_pct) },
            { l: "EPS FY1 4 周变化", v: pct(l.eps_fy1_chg_4w_pct), c: chgColor(l.eps_fy1_chg_4w_pct) },
            { l: "EPS FY1", v: fmt(l.eps_fy1, 3) },
            { l: "EPS FY2", v: fmt(l.eps_fy2, 3) },
            { l: "EPS FY3", v: fmt(l.eps_fy3, 3) },
            { l: "目标价区间", v: `${fmt(l.target_price_min, 1)} ~ ${fmt(l.target_price_max, 1)}` },
          ].map((c, i) => (
            <div key={i} style={{ background: "var(--bg-tertiary)", borderRadius: 4, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{c.l}</div>
              <div className="font-bold tabular-nums" style={{ fontSize: "var(--font-md)", color: c.c || "var(--text-primary)" }}>{c.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="font-bold mb-2" style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}>
          评级分布 (看多比例 {(bullishRatio * 100).toFixed(0)}%)
        </div>
        <div className="space-y-1">
          {[
            { l: "买入", v: l.rating.buy, c: "var(--accent-red)" },
            { l: "增持", v: l.rating.outperform, c: "var(--accent-orange)" },
            { l: "中性", v: l.rating.hold, c: "var(--text-secondary)" },
            { l: "减持", v: l.rating.underperform, c: "#84cc16" },
            { l: "卖出", v: l.rating.sell, c: "var(--accent-green)" },
          ].map((r) => {
            const w = totalRating ? (r.v / totalRating) * 100 : 0;
            return (
              <div key={r.l} className="flex items-center gap-2 text-xs">
                <span style={{ width: 36, color: "var(--text-secondary)" }}>{r.l}</span>
                <div style={{ flex: 1, background: "var(--bg-tertiary)", height: 14, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${w}%`, height: "100%", background: r.c }} />
                </div>
                <span className="tabular-nums" style={{ width: 30, textAlign: "right", color: "var(--text-secondary)" }}>{r.v}</span>
              </div>
            );
          })}
        </div>
      </div>

      {data.series.length > 1 && (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          历史序列共 {data.series.length} 周, 跨越 {data.series[0]?.week_end} 至 {data.series.at(-1)?.week_end}
        </div>
      )}
    </div>
  );
}

// ============ 持仓追踪 Tab ============

function HoldersTab({ code }: { code: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getMidlongHolders>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getMidlongHolders(code, 4)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [code]);

  if (loading) return <div className="px-4 py-2" style={{ color: "var(--text-muted)", fontSize: 12 }}>加载中…</div>;
  if (!data || data.by_period.length === 0) {
    return <div className="px-4 py-4" style={{ color: "var(--text-muted)", fontSize: 12 }}>暂无 {code} 的股东数据</div>;
  }

  const HOLDER_TYPE_LABEL: Record<string, string> = {
    sovereign: "汇金/中投",
    social: "社保",
    insurance: "险资",
    fund: "公募",
    qfii: "QFII",
    exec: "高管",
    central_soe: "央企",
    other: "其他",
  };

  const CHG_COLOR: Record<string, string> = {
    new: "var(--accent-red)",
    add: "var(--accent-orange)",
    reduce: "#84cc16",
    exit: "var(--accent-green)",
  };
  const CHG_LABEL: Record<string, string> = { new: "新进", add: "增持", reduce: "减持", exit: "退出" };

  return (
    <div className="px-4 py-2 space-y-4">
      <TierUpgradeBanner tierMeta={data.tier_meta} currentCount={data.by_period?.length} scope="holders" />
      {data.latest_summary && (
        <div className="grid grid-cols-4 gap-2">
          {[
            ["new", "新进"],
            ["add", "增持"],
            ["reduce", "减持"],
            ["exit", "退出"],
          ].map(([k, label]) => (
            <div key={k} style={{ background: "var(--bg-tertiary)", borderRadius: 4, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>当季{label}</div>
              <div className="font-bold tabular-nums" style={{ fontSize: "var(--font-xl)", color: CHG_COLOR[k] }}>
                {data.latest_summary![k as keyof typeof data.latest_summary]}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.by_period.map((p) => (
        <div key={p.report_date}>
          <div className="font-bold mb-2" style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}>
            {p.report_date} 十大股东 ({p.holders.length})
          </div>
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-color)", color: "var(--text-tertiary)" }}>
                <th className="text-left px-2 py-1" style={{ width: 30 }}>#</th>
                <th className="text-left px-2 py-1">股东名称</th>
                <th className="text-left px-2 py-1" style={{ width: 80 }}>类型</th>
                <th className="text-left px-2 py-1" style={{ width: 60 }}>变动</th>
              </tr>
            </thead>
            <tbody>
              {p.holders.slice(0, 20).map((h, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td className="px-2 py-1 tabular-nums" style={{ color: "var(--text-muted)" }}>{h.rank ?? "—"}</td>
                  <td className="px-2 py-1" style={{ color: "var(--text-primary)" }}>
                    {h.canonical_name || h.holder_name}
                    {h.fund_company && (
                      <span className="ml-1" style={{ color: "var(--text-muted)", fontSize: 10 }}>· {h.fund_company}</span>
                    )}
                  </td>
                  <td className="px-2 py-1" style={{ color: "var(--text-secondary)" }}>{HOLDER_TYPE_LABEL[h.holder_type] || h.holder_type}</td>
                  <td className="px-2 py-1 font-bold" style={{ color: h.change_type ? CHG_COLOR[h.change_type] || "var(--text-secondary)" : "var(--text-muted)" }}>
                    {h.change_type ? CHG_LABEL[h.change_type] || h.change_type : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ============ AI 长线 brief Tab ============

function BriefTab({ code }: { code: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getLongTermBrief>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async (refresh = false) => {
    setLoading(true);
    setErr(null);
    try {
      const d = await api.getLongTermBrief(code, { refresh });
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI 分析暂不可用");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    api
      .getLongTermBrief(code)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "AI 分析暂不可用"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [code]);

  if (loading) {
    return <div className="px-4 py-4" style={{ color: "var(--text-muted)", fontSize: 12 }}>AI 长线分析生成中… (首次约 8s, 后续走 7 天缓存)</div>;
  }
  if (err) {
    return <div className="px-4 py-4 text-xs" style={{ color: "var(--accent-red)" }}>{err}</div>;
  }
  if (!data) return null;

  return (
    <div className="px-4 py-2 space-y-4">
      <div
        className="p-3"
        style={{
          background: "linear-gradient(135deg, rgba(139,92,246,0.10), rgba(59,130,246,0.06))",
          border: "1px solid rgba(139,92,246,0.32)",
          borderRadius: 6,
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Telescope size={14} color="var(--accent-purple)" />
          <span className="font-bold" style={{ color: "var(--accent-purple)", fontSize: 11, letterSpacing: "0.06em" }}>
            长线 AI 评估
          </span>
          <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>{data.trade_date}</span>
          {getCacheMeta(data) && (
            <CacheMetaBadge meta={getCacheMeta(data)} />
          )}
          <button
            onClick={() => load(true)}
            className="text-xs px-2 py-0.5 rounded"
            style={{ background: "rgba(139,92,246,0.18)", color: "var(--accent-purple)" }}
          >
            刷新
          </button>
          <ShareCardButton
            title={code}
            subtitle={`长线 AI 评估 · ${data.trade_date}`}
            verdict="长线视角"
            verdictColor="#a855f7"
            headline={data.headline}
            sections={[
              { label: "核心论点", text: data.thesis },
              ...(data.strengths.slice(0, 2).map((s, i) => ({ label: `优势 ${i + 1}`, text: s }))),
              ...(data.risks.slice(0, 2).map((s, i) => ({ label: `风险 ${i + 1}`, text: s }))),
              { label: "估值看法", text: data.valuation_view },
              { label: "建议持有周期", text: data.time_horizon },
            ]}
            variant="chip"
            buttonLabel="分享"
          />
        </div>
        <div className="font-bold mb-2" style={{ fontSize: "var(--font-lg)", color: "var(--text-primary)", lineHeight: 1.5 }}>
          {data.headline}
        </div>
        <div className="text-xs" style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
          {data.thesis}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="font-bold mb-1.5" style={{ color: "var(--accent-red)", fontSize: 12 }}>核心优势</div>
          <ul className="space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            {data.strengths.map((s, i) => (
              <li key={i} className="pl-3" style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 0, color: "var(--accent-red)" }}>·</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="font-bold mb-1.5" style={{ color: "var(--accent-green)", fontSize: 12 }}>主要风险</div>
          <ul className="space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            {data.risks.map((s, i) => (
              <li key={i} className="pl-3" style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 0, color: "var(--accent-green)" }}>·</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div style={{ background: "var(--bg-tertiary)", padding: "8px 10px", borderRadius: 4 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>估值看法</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-primary)", lineHeight: 1.5 }}>{data.valuation_view}</div>
        </div>
        <div style={{ background: "var(--bg-tertiary)", padding: "8px 10px", borderRadius: 4 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>建议持有周期</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-primary)", lineHeight: 1.5 }}>{data.time_horizon}</div>
        </div>
      </div>

      {data.evidence.length > 0 && (
        <div>
          <div className="font-bold mb-1.5" style={{ color: "var(--text-secondary)", fontSize: 11 }}>关键证据</div>
          <ul className="space-y-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>
            {data.evidence.map((e, i) => (
              <li key={i}>· {e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============ 行情盘口 Tab (短线主战场) ============

function QuoteTab({ code }: { code: string }) {
  return <StockQuoteSection code={code} showWhyRose={true} />;
}

// ============ 相关新闻 Tab ============

function NewsTab({ code }: { code: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getStockNewsTimeline>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getStockNewsTimeline(code, 30, 80)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [code]);

  if (loading) {
    return <div className="px-4 py-2" style={{ color: "var(--text-muted)", fontSize: 12 }}>加载中…</div>;
  }
  if (!data || data.items.length === 0) {
    return (
      <div className="px-4 py-4" style={{ color: "var(--text-muted)", fontSize: 12 }}>
        近 30 天暂无 {code} 相关新闻
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2">
      <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
        近 {data.days} 天共 {data.count} 条相关新闻 (RAG 召回 + 时间倒序)
      </div>
      <NewsTimelineList items={data.items as NewsItemLite[]} emptyText="近 30 天暂无相关新闻" />
    </div>
  );
}

// ============ 主入口 ============

export function MidLongPage() {
  const [activeTab, setActiveTab] = useState<TabId>("quote");
  const focused = useUIStore((s) => s.focusedStock);
  const setFocused = useUIStore((s) => s.setFocusedStock);
  const pushInteraction = useUIStore((s) => s.pushInteraction);
  const openWhyRose = useUIStore((s) => s.openWhyRose);
  const [code, setCode] = useState<string | null>(focused?.code ?? null);

  const handlePick = (c: string, name?: string) => {
    setCode(c);
    setFocused({ code: c, name });
    pushInteraction({ kind: "stock", key: c, label: name });
  };

  const tabSpec = useMemo(() => TABS.find((t) => t.id === activeTab)!, [activeTab]);

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <PageHeader
        title="个股深度"
        subtitle="围绕一只股票看短/中/长线全维度 — 盘口 / 新闻 / 财务 / 估值 / 一致预期 / 持仓"
        actions={<EntityPicker code={code} onPick={handlePick} />}
      />

      {/* 顶部三视角速读 (锁定股票后才有意义) */}
      {code && (
        <PerspectiveBriefBar
          stockCode={code}
          stockName={focused?.name}
          onOpenShortDetail={() => openWhyRose(code, focused?.name)}
        />
      )}

      {/* Tab 切换 */}
      <div
        className="flex items-center gap-1 px-3"
        style={{
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-color)",
          height: 38,
          overflowX: "auto",
        }}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1 transition-colors flex-shrink-0"
              style={{
                background: isActive ? "var(--accent-purple)" : "transparent",
                color: isActive ? "#fff" : "var(--text-secondary)",
                fontSize: 12,
                fontWeight: isActive ? 700 : 500,
                borderRadius: 4,
              }}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab desc */}
      <div className="px-4 py-1.5" style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-color)",
        fontSize: 11,
        color: "var(--text-muted)",
      }}>
        {tabSpec.desc}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {!code && (
          <div className="px-4 py-12 text-center" style={{ color: "var(--text-muted)" }}>
            <Search size={32} style={{ margin: "0 auto 8px", opacity: 0.4 }} />
            <div className="text-sm mb-1">先在右上角搜索一只股票</div>
            <div className="text-xs">个股深度分析需要锁定到具体个股 — 支持代码/名称模糊检索</div>
          </div>
        )}
        {code && activeTab === "quote" && <QuoteTab code={code} />}
        {code && activeTab === "news" && <NewsTab code={code} />}
        {code && activeTab === "brief" && <BriefTab code={code} />}
        {code && activeTab === "fundamentals" && <FundamentalsTab code={code} />}
        {code && activeTab === "valuation" && <ValuationTab code={code} />}
        {code && activeTab === "consensus" && <ConsensusTab code={code} />}
        {code && activeTab === "holders" && <HoldersTab code={code} />}
      </div>
    </div>
  );
}
