"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { PageHeader } from "@/components/layout/PageHeader";

const PAGE_SIZE = 7;
const MAX_DAYS = 60;
const SCROLL_THRESHOLD = 140;
const COL_WIDTH = 150;
/** 每列展示的强势行业/题材条数 */
const ROWS = 22;

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
  onClick,
}: {
  it: IndustryItem;
  consecutive: number;
  onClick: () => void;
}) {
  const lead = leadStockShort(it.lead_stock);
  return (
    <div
      onClick={onClick}
      className="stock-card cursor-pointer"
      style={{
        background: themeBg(it.change_pct),
        minHeight: 50,
        padding: "5px 7px",
      }}
    >
      <div className="flex items-center gap-1">
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

  const triggerLoadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setReqDays((d) => (d >= MAX_DAYS ? d : Math.min(d + PAGE_SIZE, MAX_DAYS)));
  }, [hasMore, loadingMore]);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = el.scrollWidth - el.clientWidth - el.scrollLeft;
    if (dist < SCROLL_THRESHOLD) triggerLoadMore();
  }, [triggerLoadMore]);

  /** 内容没占满容器时自动加载下一批 */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || loadingMore || !hasMore) return;
    if (el.scrollWidth <= el.clientWidth + SCROLL_THRESHOLD) {
      const id = setTimeout(triggerLoadMore, 80);
      return () => clearTimeout(id);
    }
  }, [days, hasMore, loadingMore, triggerLoadMore]);

  /** 触控板横向手势 */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!horiz) return;
      const dist = el.scrollWidth - el.clientWidth - el.scrollLeft;
      if (dist < SCROLL_THRESHOLD && e.deltaX > 0) triggerLoadMore();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [triggerLoadMore]);

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
            ? `${d0} 共 ${
                industriesByDate.get(d0)?.length ?? 0
              } 个题材 · 已加载 ${dates.length} 天${
                hasMore ? " · 左划加载更多" : ""
              }`
            : undefined
        }
      />

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
          onScroll={handleScroll}
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
                    {indList.map((it) => (
                      <IndustryCell
                        key={`ind-${day.trade_date}-${it.name}`}
                        it={it}
                        consecutive={consecutiveDays(it.name, dayIdx)}
                        onClick={() => openThemeDetail(it.name)}
                      />
                    ))}
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

            {loadingMore && (
              <div
                className="text-center"
                style={{
                  color: "var(--text-muted)",
                  fontSize: 11,
                  padding: "8px 0",
                }}
              >
                加载更多历史…
              </div>
            )}
            {!hasMore && days.length >= PAGE_SIZE && (
              <div
                className="text-center"
                style={{
                  color: "var(--text-muted)",
                  fontSize: 11,
                  padding: "8px 0",
                }}
              >
                已到最早一天
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
