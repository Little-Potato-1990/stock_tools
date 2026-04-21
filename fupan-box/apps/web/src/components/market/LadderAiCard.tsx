"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  MessageSquare,
  Flame,
  TrendingUp,
  Layers,
  AlertTriangle,
  Activity,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { AiCardError, AiCardFooter, AiCardLoading } from "./AiCardChrome";
import { EvidenceBadge } from "./EvidenceBadge";
import { StreamHeadlineControl } from "./StreamHeadlineControl";
import { useStreamingHeadline } from "@/hooks/useStreamingHeadline";
import { Dial } from "./dial/Dial";
import type { DialItem } from "./dial/types";

type LadderBrief = Awaited<ReturnType<typeof api.getLadderBrief>>;

const TAG_COLOR: Record<string, string> = {
  "高度龙头": "var(--accent-red)",
  "主线龙头": "var(--accent-orange)",
  "超预期": "var(--accent-purple)",
  "空间股": "var(--accent-red)",
  "梯队跟随": "var(--text-muted)",
};

/** L1 dial 锚点 — 与 LadderMatrix ROWS 一一对应分类 */
export type LadderDialAnchor = "max_level" | "promo" | "first_board" | "broken";

export interface LadderTrendPoint {
  date: string;
  max_level: number;
  promo_rate: number;
  promo_count: number;
  promo_total: number;
  first_board: number;
  broken: number;
}

interface LadderStockMini {
  open_count?: number;
}
interface LadderLevelMini {
  board_level: number;
  stock_count: number;
  promotion_count: number;
  stocks?: LadderStockMini[];
}
interface LadderSnapshotRow {
  trade_date: string;
  data: { levels: LadderLevelMini[] };
}

function maxLevelOf(levels: LadderLevelMini[]): number {
  let m = 0;
  for (const lv of levels) {
    if (lv.stock_count > 0 && lv.board_level > m) m = lv.board_level;
  }
  return m;
}

function brokenOf(levels: LadderLevelMini[]): number {
  let n = 0;
  for (const lv of levels) {
    for (const s of lv.stocks ?? []) {
      if ((s.open_count ?? 0) >= 1) n++;
    }
  }
  return n;
}

function firstBoardOf(levels: LadderLevelMini[]): number {
  return levels.find((l) => l.board_level === 1)?.stock_count ?? 0;
}

/** 整体梯队晋级率: ≥2 板 promotion_count 之和 / ≥2 板 stock_count 之和 */
function promoOf(levels: LadderLevelMini[]): { rate: number; up: number; down: number } {
  let up = 0;
  let down = 0;
  for (const lv of levels) {
    if (lv.board_level < 2) continue;
    up += lv.promotion_count ?? 0;
    down += lv.stock_count ?? 0;
  }
  return { rate: down > 0 ? up / down : 0, up, down };
}

function deriveLadderTrend(rows: LadderSnapshotRow[]): LadderTrendPoint[] {
  // 后端返回是按 trade_date desc, 这里翻转保证从早到晚, 与 SentimentEvidenceGrid sparkline 一致
  return [...rows]
    .reverse()
    .map((r) => {
      const lv = r.data.levels ?? [];
      const promo = promoOf(lv);
      return {
        date: r.trade_date,
        max_level: maxLevelOf(lv),
        promo_rate: promo.rate,
        promo_count: promo.up,
        promo_total: promo.down,
        first_board: firstBoardOf(lv),
        broken: brokenOf(lv),
      };
    });
}

function deriveLadderDials(trend: LadderTrendPoint[]): DialItem<LadderDialAnchor>[] {
  const t = trend[trend.length - 1];
  const prev = trend.length >= 2 ? trend[trend.length - 2] : null;
  if (!t) {
    return [];
  }

  // 1. 梯队高度
  const maxLv = t.max_level;
  const maxLvPrev = prev?.max_level ?? null;
  const maxLvDelta = maxLvPrev !== null ? maxLv - maxLvPrev : null;
  const maxLvCaption =
    maxLv >= 7 ? "高度突破, 妖股已现"
    : maxLv >= 5 ? "中军到位, 梯队完整"
    : maxLv >= 3 ? "高度未起, 关注首封"
    : "梯队断档, 谨慎参与";
  const maxLvColor =
    maxLv >= 7 ? "var(--accent-red)"
    : maxLv >= 5 ? "var(--accent-orange)"
    : "var(--accent-yellow)";

  // 2. 晋级率
  const promo = Math.round(t.promo_rate * 100);
  const promoPrev = prev ? Math.round(prev.promo_rate * 100) : null;
  const promoDelta = promoPrev !== null ? promo - promoPrev : null;
  const promoCaption =
    promo >= 50 ? `晋级 ${t.promo_count}/${t.promo_total}, 接力顺畅`
    : promo >= 30 ? `晋级 ${t.promo_count}/${t.promo_total}, 接力一般`
    : `晋级 ${t.promo_count}/${t.promo_total}, 接力断档`;
  const promoColor =
    promo >= 50 ? "var(--accent-red)"
    : promo >= 30 ? "var(--accent-orange)"
    : "var(--accent-green)";

  // 3. 首板情绪
  const fb = t.first_board;
  const fbPrev = prev?.first_board ?? null;
  const fbDelta = fbPrev !== null ? fb - fbPrev : null;
  const fbCaption =
    fb >= 50 ? "首板放量, 资金活跃"
    : fb >= 25 ? "首板正常, 资金待选边"
    : "首板冷清, 增量不足";
  const fbColor =
    fb >= 50 ? "var(--accent-red)"
    : fb >= 25 ? "var(--accent-orange)"
    : "var(--accent-green)";

  // 4. 反包/炸板 (越多越偏分歧/退潮 — 用红色警告)
  const bk = t.broken;
  const bkPrev = prev?.broken ?? null;
  const bkDelta = bkPrev !== null ? bk - bkPrev : null;
  const bkCaption =
    bk >= 15 ? "炸板严重, 高位不追"
    : bk >= 8 ? "炸板偏多, 警惕分歧"
    : "炸板可控, 情绪偏稳";
  const bkColor =
    bk >= 15 ? "var(--accent-red)"
    : bk >= 8 ? "var(--accent-orange)"
    : "var(--accent-green)";

  return [
    {
      anchor: "max_level",
      icon: Flame,
      label: "梯队高度",
      value: `${maxLv}`,
      unit: "板",
      trend: maxLvDelta !== null && maxLvDelta > 0 ? "up" : maxLvDelta !== null && maxLvDelta < 0 ? "down" : "flat",
      delta: maxLvDelta !== null ? `${maxLvDelta >= 0 ? "+" : ""}${maxLvDelta}板` : undefined,
      caption: maxLvCaption,
      color: maxLvColor,
    },
    {
      anchor: "promo",
      icon: TrendingUp,
      label: "晋级率",
      value: `${promo}`,
      unit: "%",
      trend: promoDelta !== null && promoDelta > 0 ? "up" : promoDelta !== null && promoDelta < 0 ? "down" : "flat",
      delta: promoDelta !== null ? `${promoDelta >= 0 ? "+" : ""}${promoDelta}pp` : undefined,
      caption: promoCaption,
      color: promoColor,
    },
    {
      anchor: "first_board",
      icon: Layers,
      label: "首板情绪",
      value: `${fb}`,
      unit: "只",
      trend: fbDelta !== null && fbDelta > 0 ? "up" : fbDelta !== null && fbDelta < 0 ? "down" : "flat",
      delta: fbDelta !== null ? `${fbDelta >= 0 ? "+" : ""}${fbDelta}` : undefined,
      caption: fbCaption,
      color: fbColor,
    },
    {
      anchor: "broken",
      icon: AlertTriangle,
      label: "炸板风险",
      value: `${bk}`,
      unit: "只",
      trend: bkDelta !== null && bkDelta > 0 ? "up" : bkDelta !== null && bkDelta < 0 ? "down" : "flat",
      delta: bkDelta !== null ? `${bkDelta >= 0 ? "+" : ""}${bkDelta}` : undefined,
      caption: bkCaption,
      color: bkColor,
    },
  ];
}

interface Props {
  hero?: boolean;
  onEvidenceClick?: (anchor: LadderDialAnchor) => void;
  onTrendLoad?: (trend: LadderTrendPoint[]) => void;
}

export function LadderAiCard({ hero = false, onEvidenceClick, onTrendLoad }: Props = {}) {
  const [data, setData] = useState<LadderBrief | null>(null);
  const [trend, setTrend] = useState<LadderTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const askAI = useUIStore((s) => s.askAI);
  const aiStyle = useUIStore((s) => s.aiStyle);
  const stream = useStreamingHeadline("ladder", data?.trade_date, data?.model);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      // 并行: AI brief + 5 日 ladder snapshot
      const [brief, snap] = await Promise.all([
        api.getLadderBrief(undefined, refresh),
        api.getSnapshotRange("ladder", 5) as unknown as Promise<LadderSnapshotRow[]>,
      ]);
      setData(brief);
      const tr = deriveLadderTrend(snap);
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

  if (loading) return <AiCardLoading message="AI 正在拆解梯队..." />;
  if (error || !data) return <AiCardError error={error} />;

  const dials = deriveLadderDials(trend);

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
        <Sparkles
          size={hero ? 16 : 14}
          style={{ color: "var(--accent-purple)" }}
        />
        <span
          className="font-bold"
          style={{
            color: "var(--accent-purple)",
            fontSize: hero ? "var(--font-md)" : "var(--font-sm)",
            letterSpacing: 1,
          }}
        >
          AI 梯队拆解
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

      {/* L1.B: AI 结构 (高度 / 中军 / 跟风 等 LLM 自由分类的 3 段) */}
      {aiStyle !== "headline" && data.structure.length > 0 && (
        <div
          className="grid gap-1.5 mb-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
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

      {/* L1.C: AI 圈定的 key_stocks (concise & detailed 都展示) */}
      {aiStyle !== "headline" && data.key_stocks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {data.key_stocks.map((s) => (
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
                <span
                  className="font-bold"
                  style={{ color: TAG_COLOR[s.tag] || "var(--text-muted)" }}
                >
                  {s.tag}
                </span>
                <span style={{ color: "var(--text-primary)" }}>{s.name}</span>
                <span
                  className="font-bold tabular-nums"
                  style={{
                    background: "var(--accent-red)",
                    color: "#fff",
                    padding: "1px 5px",
                    borderRadius: 2,
                    fontSize: 10,
                  }}
                >
                  {s.board}板
                </span>
                <span
                  style={{ color: "var(--text-muted)", maxWidth: 200 }}
                  className="truncate"
                >
                  {s.note}
                </span>
              </button>
              <button
                onClick={() =>
                  askAI(
                    `${s.name}(${s.code}) 当前 ${s.board} 板, AI 标记为「${s.tag}」: ${s.note}\n请深入拆解这只票后续的关键看点和风险点。`,
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
          ))}
        </div>
      )}

      {/* L1.D: 5 日趋势条 (仅 detailed 模式) */}
      {aiStyle === "detailed" && trend.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <Activity size={10} style={{ color: "var(--text-muted)" }} />
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>近 5 日:</span>
          <div className="flex items-end gap-2 flex-1">
            {trend.map((p) => (
              <div
                key={p.date}
                className="flex flex-col items-center"
                title={`${p.date} 最高 ${p.max_level} 板 / 晋级率 ${(p.promo_rate * 100).toFixed(0)}%`}
              >
                <span
                  className="font-bold tabular-nums"
                  style={{
                    fontSize: 10,
                    color: p.max_level >= 5 ? "var(--accent-red)" : "var(--accent-orange)",
                  }}
                >
                  {p.max_level}板
                </span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
                  {p.date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AiCardFooter
        kind="ladder"
        tradeDate={data.trade_date}
        model={data.model}
        snapshot={{ headline: data.headline, evidence: data.evidence, key_stocks: data.key_stocks }}
      />
    </div>
  );
}
