"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronRight, MoreHorizontal, TrendingUp, TrendingDown, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemeAiCard } from "@/components/market/ThemeAiCard";

// P0 改造: 默认只显示近 7 天题材热力, 历史 60 天改为用户主动展开,
// 移除原"内容未撑满即自动追加"和"横向滚轮自动加载"两个静默副作用
const PAGE_SIZE = 7;
const MAX_DAYS = 60;
const COL_WIDTH = 150;
/** 每列展示的强势行业/题材条数 */
const ROWS = 22;

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

// P1: ThemeAiCard 已判定的 AI 主线/退潮/新晋, 在网格 cell 上叠 1 个小角标,
// 让用户不用扫文字就知道 AI 怎么看这条题材
type AiThemeKind = "leading" | "fading" | "emerging";

const AI_KIND_META: Record<AiThemeKind, { label: string; color: string }> = {
  leading: { label: "主线", color: "var(--accent-red)" },
  fading: { label: "退潮", color: "var(--accent-green)" },
  emerging: { label: "新晋", color: "var(--accent-orange)" },
};

interface ThemeBriefItem {
  name: string;
  ai_note: string;
}

interface ThemeBrief {
  leading: ThemeBriefItem[];
  fading: ThemeBriefItem[];
  emerging: ThemeBriefItem[];
}

type SnapshotRow = { trade_date: string; data: Record<string, unknown> };

interface IndustryItem {
  name: string;
  change_pct: number;
  lead_stock: string;
}

function unknownString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function unknownNumber(v: unknown): number | undefined {
  return typeof v === "number" && !Number.isNaN(v) ? v : undefined;
}

function parseIndustryItems(data: Record<string, unknown>): IndustryItem[] {
  const top = data.top;
  if (!Array.isArray(top)) return [];
  const out: IndustryItem[] = [];
  for (const item of top) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = unknownString(o.name)?.trim();
    if (!name) continue;
    const pct = unknownNumber(o.change_pct);
    if (pct === undefined) continue;
    out.push({
      name,
      change_pct: pct,
      lead_stock: unknownString(o.lead_stock) ?? "",
    });
  }
  return out;
}

const META_CONCEPT_RE =
  /^(昨日|近期|破净|高送转|高股息|次新股|大型股|中型股|小型股|微型股|融资融券|股权激励|参股|MSCI|沪股通|深股通|北向资金|预增|预减)/;

function filterMetaConcepts(items: IndustryItem[]): IndustryItem[] {
  return items.filter((x) => {
    if (!x.name) return false;
    if (META_CONCEPT_RE.test(x.name)) return false;
    if (x.name.includes("_含一字")) return false;
    if (x.name.includes("打二板")) return false;
    if (x.name.includes("打首板")) return false;
    return true;
  });
}

/** 题材染色: 涨跌幅深浅 */
function themeBg(chg: number): string {
  if (chg >= 8) return "var(--cell-red-5)";
  if (chg >= 5) return "var(--cell-red-4)";
  if (chg >= 3) return "var(--cell-red-3)";
  if (chg >= 1.5) return "var(--cell-red-2)";
  if (chg >= 0) return "var(--cell-red-1)";
  if (chg > -1.5) return "var(--cell-green-1)";
  if (chg > -3) return "var(--cell-green-2)";
  if (chg > -5) return "var(--cell-green-3)";
  return "var(--cell-green-4)";
}

function leadStockShort(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return [...t].slice(0, 4).join("");
}

function IndustryCell({
  it,
  consecutive,
  aiKind,
  aiNote,
  onClick,
}: {
  it: IndustryItem;
  consecutive: number;
  aiKind?: AiThemeKind;
  aiNote?: string;
  onClick: () => void;
}) {
  const lead = leadStockShort(it.lead_stock);
  const ai = aiKind ? AI_KIND_META[aiKind] : null;
  const Icon =
    aiKind === "leading" ? TrendingUp : aiKind === "fading" ? TrendingDown : Zap;
  return (
    <div
      onClick={onClick}
      className="stock-card cursor-pointer"
      style={{
        background: themeBg(it.change_pct),
        minHeight: 50,
        padding: "5px 7px",
        border: ai ? `1.5px solid ${ai.color}` : undefined,
        boxShadow: ai ? `0 0 0 1px ${ai.color} inset` : undefined,
        position: "relative",
      }}
      title={ai && aiNote ? `AI ${ai.label}: ${aiNote}` : undefined}
    >
      {ai && (
        <div
          className="absolute"
          style={{
            top: -1,
            right: -1,
            background: ai.color,
            color: "#fff",
            padding: "0 4px",
            borderRadius: "0 2px 0 4px",
            fontSize: 9,
            lineHeight: "13px",
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
            boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
          }}
        >
          <Icon size={9} />
          AI·{ai.label}
        </div>
      )}
      <div className="flex items-center gap-1" style={{ marginTop: ai ? 8 : 0 }}>
        <span
          className="font-bold truncate flex-1"
          style={{ fontSize: 12, color: "#fff" }}
        >
          {it.name}
        </span>
        <span
          className="font-bold tabular-nums"
          style={{ fontSize: 11, flexShrink: 0, color: "#fff" }}
        >
          {it.change_pct >= 0 ? "+" : ""}
          {it.change_pct.toFixed(2)}%
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span
          className="theme-tag"
          style={{
            marginTop: 0,
            fontSize: 9,
            padding: "0px 5px",
            background:
              consecutive >= 2 ? "rgba(0,0,0,0.32)" : "rgba(255,255,255,0.18)",
            fontWeight: 700,
          }}
        >
          {consecutive >= 2 ? `持续上榜 ${consecutive}天` : "新上榜"}
        </span>
        {lead ? (
          <span
            className="truncate tabular-nums"
            style={{ opacity: 0.85, fontSize: 9, color: "#fff", maxWidth: "42%" }}
            title={it.lead_stock}
          >
            {lead}
          </span>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

export function ThemesPage() {
  const [days, setDays] = useState<{ trade_date: string }[]>([]);
  const [industriesByDate, setIndustriesByDate] = useState<
    Map<string, IndustryItem[]>
  >(() => new Map());
  const [reqDays, setReqDays] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const openThemeDetail = useUIStore((s) => s.openThemeDetail);

  // P1: theme-brief 索引 (题材名 -> AI 状态), 仅用于最新一天的 cell 标记
  const [aiByTheme, setAiByTheme] = useState<
    Map<string, { kind: AiThemeKind; note: string }>
  >(() => new Map());

  useEffect(() => {
    let cancel = false;
    fetch(`${API_BASE}/api/ai/theme-brief`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ThemeBrief | null) => {
        if (cancel || !d) return;
        const m = new Map<string, { kind: AiThemeKind; note: string }>();
        // 优先级: leading > emerging > fading (主线/新晋更值得高亮)
        for (const it of d.fading ?? []) {
          if (it.name) m.set(it.name, { kind: "fading", note: it.ai_note ?? "" });
        }
        for (const it of d.emerging ?? []) {
          if (it.name) m.set(it.name, { kind: "emerging", note: it.ai_note ?? "" });
        }
        for (const it of d.leading ?? []) {
          if (it.name) m.set(it.name, { kind: "leading", note: it.ai_note ?? "" });
        }
        setAiByTheme(m);
      })
      .catch(() => {
        /* AI 暂不可用时, 网格照常显示, 无角标 */
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (days.length > 0) setLoadingMore(true);
    else setLoading(true);
    let cancel = false;
    api
      .getSnapshotRange("industries", reqDays)
      .then((rows) => {
        if (cancel) return;
        const arr = rows as SnapshotRow[];
        const iMap = new Map<string, IndustryItem[]>();
        for (const row of arr) {
          iMap.set(row.trade_date, parseIndustryItems(row.data));
        }
        setIndustriesByDate(iMap);
        setDays(arr.map((r) => ({ trade_date: r.trade_date })));
        if (arr.length < reqDays) setHasMore(false);
      })
      .catch(console.error)
      .finally(() => {
        if (cancel) return;
        setLoading(false);
        setLoadingMore(false);
      });
    return () => {
      cancel = true;
    };
  }, [reqDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore7 = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setReqDays((d) => Math.min(d + PAGE_SIZE, MAX_DAYS));
  }, [hasMore, loadingMore]);

  const loadAll60 = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setReqDays(MAX_DAYS);
  }, [hasMore, loadingMore]);

  function consecutiveDays(name: string, dayIdx: number): number {
    let count = 0;
    for (let i = dayIdx; i < days.length; i++) {
      const list = industriesByDate.get(days[i].trade_date) ?? [];
      const filtered = filterMetaConcepts(list).slice(0, ROWS);
      if (filtered.some((x) => x.name === name)) count++;
      else break;
    }
    return count;
  }

  const dates = days.map((d) => d.trade_date);
  const totalWidth = dates.length * COL_WIDTH;
  const d0 = dates[0];

  function columnItems(tradeDate: string): IndustryItem[] {
    const raw = industriesByDate.get(tradeDate) ?? [];
    return filterMetaConcepts(raw).slice(0, ROWS);
  }

  return (
    <div>
      <PageHeader
        title="题材追踪"
        subtitle={
          dates.length > 0
            ? `${d0} 共 ${industriesByDate.get(d0)?.length ?? 0} 个题材 · 已加载 ${dates.length} 天`
            : undefined
        }
      />

      <ThemeAiCard />

      {loading ? (
        <div
          className="px-3 py-3 grid gap-1.5"
          style={{ gridTemplateColumns: "repeat(7, 1fr)" }}
        >
          {Array.from({ length: 5 * 7 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse"
              style={{ background: "var(--bg-card)" }}
            />
          ))}
        </div>
      ) : days.length === 0 ? (
        <div
          className="px-3 py-8 text-center"
          style={{ color: "var(--text-muted)", fontSize: 12 }}
        >
          暂无题材数据
        </div>
      ) : (
        <div
          ref={scrollerRef}
          className="overflow-x-auto"
        >
          <div style={{ width: totalWidth }}>
            {/* 表头 */}
            <div
              className="flex sticky top-0 z-10"
              style={{
                background: "var(--bg-secondary)",
                borderBottom: "1px solid var(--border-color)",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {dates.map((d, i) => {
                const slice = columnItems(d);
                const avgChg =
                  slice.length > 0
                    ? slice.reduce((a, x) => a + x.change_pct, 0) / slice.length
                    : 0;
                return (
                  <div
                    key={d}
                    className="text-center tabular-nums"
                    style={{
                      width: COL_WIDTH,
                      flexShrink: 0,
                      padding: "6px 4px",
                      color:
                        i === 0
                          ? "var(--accent-orange)"
                          : "var(--text-secondary)",
                      background:
                        i === 0 ? "rgba(245,158,11,0.1)" : "transparent",
                      borderRight:
                        i < dates.length - 1
                          ? "1px solid var(--border-color)"
                          : "none",
                    }}
                  >
                    <span>{d.replace(/-/g, "")}</span>
                    <span
                      className="ml-1"
                      style={{
                        color:
                          avgChg >= 0
                            ? "var(--accent-red)"
                            : "var(--accent-green)",
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      {avgChg >= 0 ? "+" : ""}
                      {avgChg.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>

            {/* 题材网格 */}
            <div className="flex">
              {days.map((day, dayIdx) => {
                const indList = columnItems(day.trade_date);
                return (
                  <div
                    key={day.trade_date}
                    className="flex flex-col gap-1 p-1"
                    style={{
                      width: COL_WIDTH,
                      flexShrink: 0,
                      background:
                        dayIdx === 0
                          ? "rgba(245,158,11,0.04)"
                          : "transparent",
                      borderRight:
                        dayIdx < dates.length - 1
                          ? "1px solid var(--border-color)"
                          : "none",
                    }}
                  >
                    {indList.map((it) => {
                      // AI 角标只在最新交易日有意义 (theme-brief 是当天判定)
                      const ai = dayIdx === 0 ? aiByTheme.get(it.name) : undefined;
                      return (
                        <IndustryCell
                          key={`ind-${day.trade_date}-${it.name}`}
                          it={it}
                          consecutive={consecutiveDays(it.name, dayIdx)}
                          aiKind={ai?.kind}
                          aiNote={ai?.note}
                          onClick={() => openThemeDetail(it.name)}
                        />
                      );
                    })}
                    {indList.length === 0 && (
                      <div
                        style={{
                          color: "var(--text-muted)",
                          fontSize: 10,
                          textAlign: "center",
                          padding: "12px 0",
                        }}
                      >
                        无数据
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      )}

      {/* 显式展开历史按钮 (取代静默 auto-load) */}
      {days.length > 0 && hasMore && (
        <div
          className="flex items-center justify-center gap-2 px-4 py-3"
          style={{
            background: "var(--bg-secondary)",
            borderTop: "1px solid var(--border-color)",
          }}
        >
          <button
            onClick={loadMore7}
            disabled={loadingMore}
            className="inline-flex items-center gap-1 rounded transition-opacity hover:opacity-80"
            style={{
              padding: "5px 12px",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              color: "var(--text-secondary)",
              fontSize: 11,
              fontWeight: 600,
              opacity: loadingMore ? 0.5 : 1,
            }}
          >
            <ChevronRight size={11} />
            再加载 7 天
          </button>
          <button
            onClick={loadAll60}
            disabled={loadingMore}
            className="inline-flex items-center gap-1 rounded transition-opacity hover:opacity-80"
            style={{
              padding: "5px 12px",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              color: "var(--text-secondary)",
              fontSize: 11,
              fontWeight: 600,
              opacity: loadingMore ? 0.5 : 1,
            }}
          >
            <MoreHorizontal size={11} />
            展开全部 60 天
          </button>
          {loadingMore && (
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
              加载中…
            </span>
          )}
        </div>
      )}
      {!hasMore && days.length >= PAGE_SIZE && (
        <div
          className="text-center"
          style={{
            color: "var(--text-muted)",
            fontSize: 11,
            padding: "8px 0",
            background: "var(--bg-secondary)",
            borderTop: "1px solid var(--border-color)",
          }}
        >
          已到最早一天 ({days.length} 天)
        </div>
      )}
    </div>
  );
}
