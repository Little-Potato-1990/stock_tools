"use client";

import { useEffect, useState, useMemo } from "react";
import {
  TrendingUp,
  Globe2,
  Layers,
  Building,
  Wallet,
  Lock,
  PieChart,
  FileText,
  Crown,
} from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { CapitalAiCard } from "@/components/market/CapitalAiCard";
import { InstitutionalAiCard } from "@/components/market/InstitutionalAiCard";

type TabId =
  | "overview"
  | "north"
  | "concept"
  | "industry"
  | "stock"
  | "limit"
  | "etf"
  | "announce"
  | "holders";

interface TabSpec {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  desc: string;
}

const TABS: TabSpec[] = [
  { id: "overview", label: "今日资金", icon: TrendingUp, desc: "大盘 / 三大主力 / 国家队 ETF 一句话定调" },
  { id: "north", label: "北向资金", icon: Globe2, desc: "北向当日 + 重仓股名单" },
  { id: "concept", label: "概念资金", icon: Layers, desc: "概念板块主力净流入" },
  { id: "industry", label: "行业资金", icon: Building, desc: "申万行业主力净流入" },
  { id: "stock", label: "个股资金", icon: Wallet, desc: "个股主力净流入排行" },
  { id: "limit", label: "涨停封单", icon: Lock, desc: "题材 / 行业封单金额" },
  { id: "etf", label: "ETF 净申购", icon: PieChart, desc: "国家队宽基 / 行业 / 红利 ETF 份额变动" },
  { id: "announce", label: "公告事件", icon: FileText, desc: "增减持 / 回购 / 举牌" },
  { id: "holders", label: "主力身份", icon: Crown, desc: "汇金 / 社保 / 险资 / 公募 / QFII 季报跟踪" },
];

function formatYi(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return (v / 1e8).toFixed(digits) + "亿";
}

function pct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function chgColor(v: number | null | undefined): string {
  if (v == null) return "var(--text-secondary)";
  if (v > 0) return "var(--accent-red)";
  if (v < 0) return "var(--accent-green)";
  return "var(--text-secondary)";
}

function StockLink({ code, name }: { code: string; name?: string | null }) {
  const open = useUIStore((s) => s.openStockDetail);
  return (
    <button
      onClick={() => open(code, name ?? code)}
      className="hover:underline tabular-nums"
      style={{ color: "var(--text-primary)", textAlign: "left" }}
    >
      <span>{name ?? code}</span>
      <span className="ml-1" style={{ color: "var(--text-muted)", fontSize: 10 }}>{code}</span>
    </button>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline gap-2 mb-2 px-3">
        <span className="font-bold" style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}>
          {title}
        </span>
        {desc && (
          <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
            {desc}
          </span>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="px-3 grid gap-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-7 animate-pulse"
          style={{ background: "var(--bg-card)" }}
        />
      ))}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div
      className="px-3 py-6 text-center"
      style={{ fontSize: "var(--font-sm)", color: "var(--text-muted)" }}
    >
      {text}
    </div>
  );
}

// === Tab: Overview (CapitalAiCard + summary) ===
function TabOverview() {
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.getCapitalSummary()
      .then((d) => setSummary(d))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div>
      <CapitalAiCard hero />
      <div className="px-3 py-3">
        {loading ? (
          <Loading rows={3} />
        ) : summary ? (
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-2"
            style={{ fontSize: "var(--font-xs)" }}
          >
            {Object.entries(summary).map(([k, v]) => (
              <div
                key={k}
                style={{
                  padding: "8px 10px",
                  background: "var(--bg-card)",
                  borderRadius: 4,
                  border: "1px solid var(--border-color)",
                }}
              >
                <div style={{ color: "var(--text-muted)", fontSize: 10 }}>{k}</div>
                <div className="font-bold tabular-nums" style={{ color: "var(--text-primary)", fontSize: 13, marginTop: 2 }}>
                  {typeof v === "number" ? v.toFixed(2) : String(v ?? "—")}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyHint text="暂无 summary 数据 (需先跑 daily 资金 pipeline)" />
        )}
      </div>
    </div>
  );
}

// === Tab: North (today + holds) ===
function TabNorth() {
  const [series, setSeries] = useState<Array<Record<string, unknown>>>([]);
  const [holds, setHolds] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([api.getCapitalNorth(30), api.getCapitalNorthHolds(undefined, 50)])
      .then(([n, h]) => {
        setSeries(n.items ?? []);
        setHolds(h.items ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <Loading />;
  return (
    <div>
      <Section title="北向资金近 30 日净流入" desc="HSGT / 沪股通 + 深股通合计">
        {series.length === 0 ? <EmptyHint text="暂无北向数据" /> : (
          <div className="px-3 grid grid-cols-2 md:grid-cols-5 gap-1.5">
            {series.slice(0, 10).map((d, i) => {
              const net = (d.net_inflow as number) ?? 0;
              return (
                <div
                  key={i}
                  className="px-2 py-1.5 tabular-nums"
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 3,
                    fontSize: "var(--font-xs)",
                  }}
                >
                  <div style={{ color: "var(--text-muted)", fontSize: 10 }}>
                    {String(d.trade_date ?? "")}
                  </div>
                  <div className="font-bold" style={{ color: chgColor(net) }}>
                    {formatYi(net)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
      <Section title="北向重仓股 TOP50" desc="按持股市值排序">
        {holds.length === 0 ? <EmptyHint text="暂无北向重仓数据" /> : (
          <div className="px-3 overflow-x-auto">
            <table className="w-full" style={{ fontSize: "var(--font-xs)" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", fontSize: 10, textAlign: "left" }}>
                  <th style={{ padding: "4px 8px" }}>排名</th>
                  <th style={{ padding: "4px 8px" }}>股票</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>持股市值</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>持股占比</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>较前日变动</th>
                </tr>
              </thead>
              <tbody>
                {holds.map((h, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border-color)" }}>
                    <td style={{ padding: "4px 8px", color: "var(--text-muted)" }}>{i + 1}</td>
                    <td style={{ padding: "4px 8px" }}>
                      <StockLink code={String(h.stock_code)} name={h.stock_name as string | null} />
                    </td>
                    <td style={{ padding: "4px 8px", textAlign: "right" }} className="tabular-nums">
                      {formatYi(h.hold_value as number)}
                    </td>
                    <td style={{ padding: "4px 8px", textAlign: "right" }} className="tabular-nums">
                      {pct((h.hold_pct_circulating as number) * 100)}
                    </td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: chgColor(h.hold_change as number) }} className="tabular-nums">
                      {formatYi(h.hold_change as number)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

// === Generic concept/industry table ===
function FlowRankList({
  loader,
  emptyText,
}: {
  loader: () => Promise<{ items: Array<Record<string, unknown>> }>;
  emptyText: string;
}) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    loader()
      .then((d) => setItems(d.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loader]);
  if (loading) return <Loading />;
  if (items.length === 0) return <EmptyHint text={emptyText} />;
  return (
    <div className="px-3 overflow-x-auto">
      <table className="w-full" style={{ fontSize: "var(--font-xs)" }}>
        <thead>
          <tr style={{ color: "var(--text-muted)", fontSize: 10, textAlign: "left" }}>
            <th style={{ padding: "4px 8px" }}>名称</th>
            <th style={{ padding: "4px 8px", textAlign: "right" }}>主力净流入</th>
            <th style={{ padding: "4px 8px", textAlign: "right" }}>涨跌幅</th>
            <th style={{ padding: "4px 8px", textAlign: "right" }}>领涨股</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--border-color)" }}>
              <td style={{ padding: "4px 8px", color: "var(--text-primary)", fontWeight: 600 }}>
                {String(it.name)}
              </td>
              <td style={{ padding: "4px 8px", textAlign: "right", color: chgColor(it.main_inflow as number) }} className="tabular-nums">
                {formatYi(it.main_inflow as number)}
              </td>
              <td style={{ padding: "4px 8px", textAlign: "right", color: chgColor(it.change_pct as number) }} className="tabular-nums">
                {pct(it.change_pct as number)}
              </td>
              <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-secondary)" }}>
                {String(it.lead_stock ?? "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabConcept() {
  const loader = useMemo(() => () => api.getCapitalConcept(undefined, 30), []);
  return (
    <Section title="概念板块主力净流入 TOP30">
      <FlowRankList loader={loader} emptyText="暂无概念资金数据" />
    </Section>
  );
}

function TabIndustry() {
  const loader = useMemo(() => () => api.getCapitalIndustry(undefined, 30), []);
  return (
    <Section title="申万行业主力净流入 TOP30">
      <FlowRankList loader={loader} emptyText="暂无行业资金数据" />
    </Section>
  );
}

function TabStock() {
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.getCapitalStockRank(undefined, 50, direction)
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [direction]);
  return (
    <Section title="个股主力净流入排行" desc="作为选股辅助维度, 配合题材/北向使用">
      <div className="px-3 mb-2 flex items-center gap-2">
        {(["in", "out"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className="px-2 py-1"
            style={{
              fontSize: "var(--font-xs)",
              background: direction === d ? "var(--accent-blue)" : "var(--bg-card)",
              color: direction === d ? "#fff" : "var(--text-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: 3,
            }}
          >
            {d === "in" ? "净流入" : "净流出"}
          </button>
        ))}
      </div>
      {loading ? <Loading /> : items.length === 0 ? <EmptyHint text="暂无个股资金数据" /> : (
        <div className="px-3 overflow-x-auto">
          <table className="w-full" style={{ fontSize: "var(--font-xs)" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", fontSize: 10, textAlign: "left" }}>
                <th style={{ padding: "4px 8px" }}>排名</th>
                <th style={{ padding: "4px 8px" }}>股票</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>主力净流入</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>涨跌幅</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border-color)" }}>
                  <td style={{ padding: "4px 8px", color: "var(--text-muted)" }}>{i + 1}</td>
                  <td style={{ padding: "4px 8px" }}>
                    <StockLink code={String(it.stock_code)} name={it.stock_name as string | null} />
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: chgColor(it.main_inflow as number) }} className="tabular-nums">
                    {formatYi(it.main_inflow as number)}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: chgColor(it.change_pct as number) }} className="tabular-nums">
                    {pct(it.change_pct as number)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function TabLimit() {
  const [by, setBy] = useState<"theme" | "industry">("theme");
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.getCapitalLimitOrder(undefined, by)
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [by]);
  return (
    <Section title="涨停封单金额聚合" desc="按题材 / 行业归类, 反映场外资金空军">
      <div className="px-3 mb-2 flex items-center gap-2">
        {(["theme", "industry"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setBy(d)}
            className="px-2 py-1"
            style={{
              fontSize: "var(--font-xs)",
              background: by === d ? "var(--accent-blue)" : "var(--bg-card)",
              color: by === d ? "#fff" : "var(--text-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: 3,
            }}
          >
            {d === "theme" ? "按题材" : "按行业"}
          </button>
        ))}
      </div>
      {loading ? <Loading /> : items.length === 0 ? <EmptyHint text="暂无封单数据 (需 daily pipeline 完成)" /> : (
        <div className="px-3 overflow-x-auto">
          <table className="w-full" style={{ fontSize: "var(--font-xs)" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", fontSize: 10, textAlign: "left" }}>
                <th style={{ padding: "4px 8px" }}>{by === "theme" ? "题材" : "行业"}</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>封单总额</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>涨停股数</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border-color)" }}>
                  <td style={{ padding: "4px 8px", color: "var(--text-primary)", fontWeight: 600 }}>
                    {String(it.name)}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--accent-red)" }} className="tabular-nums">
                    {formatYi(it.order_amount as number)}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }} className="tabular-nums">
                    {String(it.stock_count ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function TabEtf() {
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.getCapitalEtf(undefined, category)
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [category]);
  const cats: Array<{ k: string | undefined; label: string }> = [
    { k: undefined, label: "全部" },
    { k: "national_team_broad", label: "国家队-宽基" },
    { k: "national_team_industry", label: "国家队-行业" },
    { k: "dividend", label: "红利" },
  ];
  return (
    <Section title="ETF 净申购份额变动" desc="国家队动向看国家队-宽基, 资金避险看红利">
      <div className="px-3 mb-2 flex items-center gap-2 flex-wrap">
        {cats.map((c) => (
          <button
            key={String(c.k)}
            onClick={() => setCategory(c.k)}
            className="px-2 py-1"
            style={{
              fontSize: "var(--font-xs)",
              background: category === c.k ? "var(--accent-blue)" : "var(--bg-card)",
              color: category === c.k ? "#fff" : "var(--text-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: 3,
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {loading ? <Loading /> : items.length === 0 ? <EmptyHint text="暂无 ETF 数据" /> : (
        <div className="px-3 overflow-x-auto">
          <table className="w-full" style={{ fontSize: "var(--font-xs)" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", fontSize: 10, textAlign: "left" }}>
                <th style={{ padding: "4px 8px" }}>ETF</th>
                <th style={{ padding: "4px 8px" }}>类别</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>份额变动</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>估算净申购</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border-color)" }}>
                  <td style={{ padding: "4px 8px" }}>
                    <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{String(it.etf_name)}</span>
                    <span className="ml-1" style={{ color: "var(--text-muted)", fontSize: 10 }}>{String(it.etf_code)}</span>
                  </td>
                  <td style={{ padding: "4px 8px", color: "var(--text-muted)" }}>{String(it.category ?? "—")}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: chgColor(it.shares_change as number) }} className="tabular-nums">
                    {((it.shares_change as number ?? 0) / 1e8).toFixed(2)}亿份
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: chgColor(it.inflow_estimate as number) }} className="tabular-nums">
                    {formatYi(it.inflow_estimate as number)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function TabAnnounce() {
  const [eventType, setEventType] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.getCapitalAnnounce(eventType, 14, 100)
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [eventType]);
  const types: Array<{ k: string | undefined; label: string }> = [
    { k: undefined, label: "全部" },
    { k: "increase", label: "增持" },
    { k: "decrease", label: "减持" },
    { k: "repurchase", label: "回购" },
    { k: "placard", label: "举牌" },
  ];
  return (
    <Section title="近 14 日公告事件流" desc="增减持 / 回购 / 举牌">
      <div className="px-3 mb-2 flex items-center gap-2 flex-wrap">
        {types.map((c) => (
          <button
            key={String(c.k)}
            onClick={() => setEventType(c.k)}
            className="px-2 py-1"
            style={{
              fontSize: "var(--font-xs)",
              background: eventType === c.k ? "var(--accent-blue)" : "var(--bg-card)",
              color: eventType === c.k ? "#fff" : "var(--text-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: 3,
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {loading ? <Loading /> : items.length === 0 ? <EmptyHint text="暂无公告事件" /> : (
        <div className="px-3 overflow-x-auto">
          <table className="w-full" style={{ fontSize: "var(--font-xs)" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", fontSize: 10, textAlign: "left" }}>
                <th style={{ padding: "4px 8px" }}>日期</th>
                <th style={{ padding: "4px 8px" }}>类型</th>
                <th style={{ padding: "4px 8px" }}>股票</th>
                <th style={{ padding: "4px 8px" }}>动作方</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>金额/比例</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border-color)" }}>
                  <td style={{ padding: "4px 8px", color: "var(--text-muted)" }}>{String(e.trade_date)}</td>
                  <td style={{ padding: "4px 8px" }}>{String(e.event_type)}</td>
                  <td style={{ padding: "4px 8px" }}>
                    <StockLink code={String(e.stock_code)} name={e.stock_name as string | null} />
                  </td>
                  <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>
                    {String(e.actor ?? "—")}
                    {e.actor_type ? <span className="ml-1" style={{ color: "var(--text-muted)" }}>({String(e.actor_type)})</span> : null}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }} className="tabular-nums">
                    {e.scale != null ? formatYi(e.scale as number) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function TabHolders() {
  return (
    <div>
      <InstitutionalAiCard hero />
    </div>
  );
}

const TAB_RENDERERS: Record<TabId, () => React.ReactNode> = {
  overview: () => <TabOverview />,
  north: () => <TabNorth />,
  concept: () => <TabConcept />,
  industry: () => <TabIndustry />,
  stock: () => <TabStock />,
  limit: () => <TabLimit />,
  etf: () => <TabEtf />,
  announce: () => <TabAnnounce />,
  holders: () => <TabHolders />,
};

export function CapitalPage() {
  const [tab, setTab] = useState<TabId>("overview");
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div>
      <PageHeader title="资金风向标" subtitle={current.desc} />

      <div
        className="flex items-center gap-1 px-3 py-2 overflow-x-auto"
        style={{
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
        }}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 transition-colors flex-shrink-0"
              style={{
                fontSize: "var(--font-xs)",
                fontWeight: active ? 700 : 500,
                color: active ? "#fff" : "var(--text-secondary)",
                background: active ? "var(--accent-blue)" : "transparent",
                border: "1px solid",
                borderColor: active ? "var(--accent-blue)" : "var(--border-color)",
                borderRadius: 3,
              }}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div>{TAB_RENDERERS[tab]()}</div>
    </div>
  );
}
