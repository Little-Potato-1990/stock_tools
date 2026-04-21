"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  MessageSquare,
  Building2,
  Wallet,
  Landmark,
  Flame,
  Layers,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { AiCardError, AiCardFooter, AiCardLoading } from "./AiCardChrome";
import { getCacheMeta } from "./CacheMetaBadge";
import { EvidenceBadge } from "./EvidenceBadge";
import { StreamHeadlineControl } from "./StreamHeadlineControl";
import { useStreamingHeadline } from "@/hooks/useStreamingHeadline";
import { Dial } from "./dial/Dial";
import type { DialItem } from "./dial/types";
import { fmtAmountParts, fmtDeltaAmount, fmtSignedAmount } from "@/lib/format";

interface KeyOffice {
  name: string;
  is_inst: boolean;
  tag: string;
  net_buy: number;
  note: string;
}

interface KeyStock {
  code: string;
  name: string;
  net_amount: number;
  tag: string;
  note: string;
}

interface LhbBrief {
  trade_date: string;
  generated_at: string;
  model: string;
  headline: string;
  structure: Array<{ label: string; text: string }>;
  key_offices: KeyOffice[];
  key_stocks: KeyStock[];
  evidence?: string[];
}

const TAG_COLOR: Record<string, string> = {
  "知名游资": "var(--accent-orange)",
  "机构": "var(--accent-purple)",
  "一线席位": "var(--accent-red)",
  "游资接力": "var(--accent-red)",
  "游资": "var(--accent-orange)",
  "游资抢筹": "var(--accent-red)",
  "机构出货": "var(--accent-green)",
  "对手盘激烈": "var(--accent-purple)",
  "资金分歧": "var(--text-muted)",
};

/** L1 dial 锚点 — 与 LhbEvidenceGrid 4 张证据卡及 LhbDailyTab 行高亮规则一一对应 */
export type LhbDialAnchor = "total_net" | "inst_net" | "hot_money" | "stock_count";

export interface LhbTrendPoint {
  date: string;
  total_net: number;     // 上榜净买入合计 (元)
  inst_net: number;      // 机构席位净买入 (元)
  hot_money: number;     // 当日活跃游资席位数
  stock_count: number;   // 上榜股数
}

interface LhbInstMini {
  is_inst?: boolean;
  net_buy?: number;
}
interface LhbStockMini {
  net_amount?: number;
}
interface LhbHotMoneyMini {
  exalter?: string;
}
interface LhbSnapshotRow {
  trade_date: string;
  data: {
    stocks?: LhbStockMini[];
    insts_by_code?: Record<string, LhbInstMini[]>;
    hot_money_top?: LhbHotMoneyMini[];
  };
}

function deriveLhbTrend(rows: LhbSnapshotRow[]): LhbTrendPoint[] {
  return [...rows]
    .reverse()
    .map((r) => {
      const stocks = r.data.stocks ?? [];
      const insts = r.data.insts_by_code ?? {};
      const hot = r.data.hot_money_top ?? [];

      let total_net = 0;
      for (const s of stocks) total_net += s.net_amount ?? 0;

      let inst_net = 0;
      for (const arr of Object.values(insts)) {
        for (const it of arr) {
          if (!it.is_inst) continue;
          inst_net += it.net_buy ?? 0;
        }
      }

      const hotSet = new Set<string>();
      for (const h of hot) {
        if (h.exalter) hotSet.add(h.exalter);
      }

      return {
        date: r.trade_date,
        total_net,
        inst_net,
        hot_money: hotSet.size,
        stock_count: stocks.length,
      };
    });
}

function deriveLhbDials(trend: LhbTrendPoint[]): DialItem<LhbDialAnchor>[] {
  const t = trend[trend.length - 1];
  const prev = trend.length >= 2 ? trend[trend.length - 2] : null;
  if (!t) return [];

  // 1. 上榜净买入合计 — 反映今日资金面方向
  const tn = fmtAmountParts(t.total_net);
  const tnDelta = prev ? t.total_net - prev.total_net : null;
  const tnCaption =
    t.total_net >= 5e8 ? "净流入显著, 资金做多"
    : t.total_net >= 1e8 ? "净流入温和, 偏多"
    : t.total_net >= -1e8 ? "多空平衡, 观望为主"
    : t.total_net >= -5e8 ? "净流出, 资金谨慎"
    : "净流出显著, 资金撤离";
  const tnColor =
    t.total_net >= 1e8 ? "var(--accent-red)"
    : t.total_net <= -1e8 ? "var(--accent-green)"
    : "var(--text-muted)";

  // 2. 机构席位净买入 — 反映机构态度
  const inst = fmtAmountParts(t.inst_net);
  const instDelta = prev ? t.inst_net - prev.inst_net : null;
  const instCaption =
    t.inst_net >= 3e8 ? "机构大幅买入, 中线信号"
    : t.inst_net >= 5e7 ? "机构小幅净买, 关注卡位"
    : t.inst_net >= -5e7 ? "机构进出基本平衡"
    : t.inst_net >= -3e8 ? "机构净卖, 警惕筹码松动"
    : "机构大幅出货, 风险偏高";
  const instColor =
    t.inst_net >= 5e7 ? "var(--accent-red)"
    : t.inst_net <= -5e7 ? "var(--accent-green)"
    : "var(--text-muted)";

  // 3. 游资席位数 — 反映游资活跃度
  const hm = t.hot_money;
  const hmDelta = prev ? t.hot_money - prev.hot_money : null;
  const hmCaption =
    hm >= 30 ? "游资全面活跃, 情绪火爆"
    : hm >= 15 ? "游资正常活跃, 接力可观察"
    : hm >= 5 ? "游资偏谨慎, 接力有限"
    : "游资基本缺席, 题材冷清";
  const hmColor =
    hm >= 30 ? "var(--accent-red)"
    : hm >= 15 ? "var(--accent-orange)"
    : "var(--accent-yellow)";

  // 4. 上榜股数 — 反映题材广度
  const sc = t.stock_count;
  const scDelta = prev ? t.stock_count - prev.stock_count : null;
  const scCaption =
    sc >= 80 ? "上榜面广, 题材发散"
    : sc >= 40 ? "上榜数正常, 主线集中"
    : sc >= 20 ? "上榜偏少, 行情清淡"
    : "上榜稀少, 资金沉寂";
  const scColor =
    sc >= 80 ? "var(--accent-orange)"
    : sc >= 40 ? "var(--accent-red)"
    : sc >= 20 ? "var(--accent-yellow)"
    : "var(--accent-green)";

  return [
    {
      anchor: "total_net",
      icon: Wallet,
      label: "上榜净买入",
      value: tn.value,
      unit: tn.unit,
      trend: tnDelta == null ? "flat" : tnDelta > 0 ? "up" : tnDelta < 0 ? "down" : "flat",
      delta: tnDelta == null ? undefined : fmtDeltaAmount(tnDelta),
      caption: tnCaption,
      color: tnColor,
    },
    {
      anchor: "inst_net",
      icon: Landmark,
      label: "机构净买",
      value: inst.value,
      unit: inst.unit,
      trend: instDelta == null ? "flat" : instDelta > 0 ? "up" : instDelta < 0 ? "down" : "flat",
      delta: instDelta == null ? undefined : fmtDeltaAmount(instDelta),
      caption: instCaption,
      color: instColor,
    },
    {
      anchor: "hot_money",
      icon: Flame,
      label: "游资席位",
      value: `${hm}`,
      unit: "席",
      trend: hmDelta == null ? "flat" : hmDelta > 0 ? "up" : hmDelta < 0 ? "down" : "flat",
      delta: hmDelta == null ? undefined : `${hmDelta >= 0 ? "+" : ""}${hmDelta}`,
      caption: hmCaption,
      color: hmColor,
    },
    {
      anchor: "stock_count",
      icon: Layers,
      label: "上榜股数",
      value: `${sc}`,
      unit: "只",
      trend: scDelta == null ? "flat" : scDelta > 0 ? "up" : scDelta < 0 ? "down" : "flat",
      delta: scDelta == null ? undefined : `${scDelta >= 0 ? "+" : ""}${scDelta}`,
      caption: scCaption,
      color: scColor,
    },
  ];
}

interface Props {
  hero?: boolean;
  onEvidenceClick?: (anchor: LhbDialAnchor) => void;
  onTrendLoad?: (trend: LhbTrendPoint[]) => void;
}

export function LhbAiCard({ hero = false, onEvidenceClick, onTrendLoad }: Props = {}) {
  const [data, setData] = useState<LhbBrief | null>(null);
  const [trend, setTrend] = useState<LhbTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const askAI = useUIStore((s) => s.askAI);
  const aiStyle = useUIStore((s) => s.aiStyle);
  const setLhbScope = useUIStore((s) => s.setLhbScope);
  const setLhbOfficeQuery = useUIStore((s) => s.setLhbOfficeQuery);
  const stream = useStreamingHeadline("lhb", data?.trade_date, data?.model);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const [brief, snap] = await Promise.all([
        api.getLhbBrief(undefined, refresh),
        api.getSnapshotRange("lhb", 5) as unknown as Promise<LhbSnapshotRow[]>,
      ]);
      setData(brief as unknown as LhbBrief);
      const tr = deriveLhbTrend(snap);
      setTrend(tr);
      if (onTrendLoad) onTrendLoad(tr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <AiCardLoading message="AI 正在拆解游资动向..." />;
  if (error || !data) return <AiCardError error={error} />;

  const dials = deriveLhbDials(trend);

  const jumpToOffice = (name: string) => {
    setLhbOfficeQuery(name);
    setLhbScope("office_history");
  };

  return (
    <div
      className={hero ? "px-6 py-5" : "px-3 py-2.5"}
      style={{
        background: hero
          ? "linear-gradient(135deg, rgba(168,85,247,0.10) 0%, var(--bg-tertiary) 60%)"
          : "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)",
        borderBottom: "1px solid var(--border-color)",
        borderLeft: hero ? "3px solid var(--accent-purple)" : undefined,
      }}
    >
      <div className={hero ? "flex items-center gap-2 mb-3" : "flex items-center gap-2 mb-2"}>
        <Sparkles size={hero ? 16 : 14} style={{ color: "var(--accent-purple)" }} />
        <span
          className="font-bold"
          style={{
            color: "var(--accent-purple)",
            fontSize: hero ? "var(--font-md)" : "var(--font-sm)",
            letterSpacing: 1,
          }}
        >
          AI 龙虎榜拆解
        </span>
        <span style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
          {data.trade_date} · {data.model}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <EvidenceBadge evidence={data.evidence} />
          <StreamHeadlineControl
            isStreaming={stream.isStreaming}
            hasOverride={stream.hasOverride}
            onStart={stream.start}
            onReset={stream.reset}
            size={hero ? 13 : 11}
          />
          <button
            onClick={() => load(true)}
            className="p-1 transition-opacity hover:opacity-70"
            title="重新生成 (走完整 brief 缓存)"
            style={{ color: "var(--text-muted)" }}
          >
            <RefreshCw size={hero ? 13 : 11} />
          </button>
        </div>
      </div>

      <div
        className={hero ? "font-bold mb-3" : "font-bold mb-2"}
        style={{
          fontSize: hero ? 26 : "var(--font-md)",
          color: "var(--text-primary)",
          lineHeight: hero ? 1.4 : 1.5,
          letterSpacing: hero ? 0.3 : 0,
        }}
      >
        {stream.hasOverride ? (
          <>
            {stream.text || "…"}
            {stream.isStreaming && (
              <span
                className="ml-0.5 inline-block animate-pulse"
                style={{ color: "var(--accent-purple)" }}
              >
                ▍
              </span>
            )}
          </>
        ) : (
          data.headline
        )}
      </div>

      {/* L1.A: 4 仪表盘 */}
      {aiStyle !== "headline" && dials.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {dials.map((d) => (
            <Dial
              key={d.anchor}
              d={d}
              hero={hero}
              onClick={() => onEvidenceClick?.(d.anchor)}
            />
          ))}
        </div>
      )}

      {/* L1.B: AI 结构 (资金方向 / 接力线 / 警示) */}
      {aiStyle !== "headline" && data.structure.length > 0 && (
        <div
          className="grid gap-1.5 mb-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
        >
          {data.structure.map((it, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5"
              style={{
                padding: "6px 10px",
                background: "var(--bg-card)",
                borderLeft: "2px solid var(--accent-orange)",
                borderRadius: "0 3px 3px 0",
                fontSize: "var(--font-xs)",
              }}
            >
              <span
                className="font-bold flex-shrink-0"
                style={{ color: "var(--accent-orange)", width: 30 }}
              >
                {it.label}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>{it.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* L1.C: 核心席位 */}
      {aiStyle !== "headline" && data.key_offices.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {data.key_offices.map((o, i) => {
            const c = TAG_COLOR[o.tag] || (o.is_inst ? "var(--accent-purple)" : "var(--accent-orange)");
            const netColor =
              o.net_buy >= 0 ? "var(--accent-red)" : "var(--accent-green)";
            return (
              <div
                key={`o-${i}-${o.name}`}
                className="flex items-center gap-1.5"
                style={{
                  padding: "4px 8px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 3,
                  fontSize: "var(--font-xs)",
                }}
                title={o.note}
              >
                <button
                  onClick={() => jumpToOffice(o.name)}
                  className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
                >
                  <Building2 size={10} style={{ color: c }} />
                  <span className="font-bold" style={{ color: c }}>
                    {o.tag}
                  </span>
                  <span
                    className="truncate"
                    style={{ color: "var(--text-primary)", maxWidth: 180 }}
                  >
                    {o.name}
                  </span>
                  <span
                    className="font-bold tabular-nums"
                    style={{ color: netColor }}
                  >
                    {fmtSignedAmount(o.net_buy)}
                  </span>
                  <span
                    style={{ color: "var(--text-muted)", maxWidth: 200 }}
                    className="truncate"
                  >
                    · {o.note}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* L1.D: 核心目标股 */}
      {aiStyle !== "headline" && data.key_stocks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {data.key_stocks.map((s) => {
            const c = TAG_COLOR[s.tag] || "var(--text-muted)";
            const netColor =
              s.net_amount >= 0 ? "var(--accent-red)" : "var(--accent-green)";
            return (
              <div
                key={s.code}
                className="flex items-center gap-1.5"
                style={{
                  padding: "4px 8px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 3,
                  fontSize: "var(--font-xs)",
                }}
                title={s.note}
              >
                <button
                  onClick={() => openStockDetail(s.code, s.name)}
                  className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
                >
                  <span className="font-bold" style={{ color: c }}>
                    {s.tag}
                  </span>
                  <span style={{ color: "var(--text-primary)" }}>{s.name}</span>
                  <span
                    className="font-bold tabular-nums"
                    style={{ color: netColor }}
                  >
                    {fmtSignedAmount(s.net_amount)}
                  </span>
                  <span
                    style={{ color: "var(--text-muted)", maxWidth: 200 }}
                    className="truncate"
                  >
                    · {s.note}
                  </span>
                </button>
                <button
                  onClick={() =>
                    askAI(
                      `${s.name}(${s.code}) 今日上龙虎榜, 净 ${fmtSignedAmount(s.net_amount)}, AI 标记「${s.tag}」: ${s.note}\n请帮我深入拆解游资席位的真实意图和后续操作策略。`,
                      { code: s.code, name: s.name }
                    )
                  }
                  className="ml-1 transition-opacity hover:opacity-80"
                  title="问 AI"
                  style={{
                    padding: "1px 4px",
                    background: "var(--accent-purple)",
                    color: "#fff",
                    borderRadius: 2,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 2,
                    fontSize: 10,
                  }}
                >
                  <MessageSquare size={9} />
                  问AI
                </button>
              </div>
            );
          })}
        </div>
      )}

      <AiCardFooter
        kind="lhb"
        tradeDate={data.trade_date}
        model={data.model}
        snapshot={{ headline: data.headline, evidence: data.evidence, key_offices: data.key_offices }}
        cacheMeta={getCacheMeta(data)}
      />
    </div>
  );
}
