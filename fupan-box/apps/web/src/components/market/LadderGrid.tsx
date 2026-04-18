"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useUIStore } from "@/stores/ui-store";
import { api } from "@/lib/api";
import { getBoardLevelColor } from "@/lib/colorScale";

const PAGE_SIZE = 6;
const MAX_DAYS = 60;
const SCROLL_THRESHOLD = 160;

interface LadderStock {
  stock_code: string;
  stock_name?: string;
  first_limit_time: string | null;
  open_count: number;
  limit_reason: string | null;
  theme_names: string[] | null;
  limit_order_amount?: number | null;
  amount?: number | null;
  is_one_word?: boolean;
  /** 注入字段：所属板级 */
  _level?: number;
}

interface LadderLevel {
  board_level: number;
  stock_count: number;
  promotion_count: number;
  promotion_rate: number;
  stocks: LadderStock[];
}

interface DayLadder {
  trade_date: string;
  data: { levels: LadderLevel[] };
}

function formatAmount(v: number | null | undefined): string | null {
  if (!v || v <= 0) return null;
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  return v.toFixed(0);
}

interface Props {
  /** 题材筛选 - 仅显示 theme_names 包含该题材的票 */
  filterTheme?: string | null;
  /** 显示天数 */
  days?: number;
  /** 紧凑模式：每个 cell 只显示「股票名 + 板数」，密度提升 3 倍 */
  compact?: boolean;
  /** 最低板级筛选 - 只显示 >= minLevel 的票 */
  minLevel?: number;
  /** 关键词筛选 - 匹配名称或题材 */
  keyword?: string;
  /** 仅显示一字板 */
  onlyOneWord?: boolean;
}

export function LadderGrid({
  filterTheme,
  days = PAGE_SIZE,
  compact = false,
  minLevel = 1,
  keyword,
  onlyOneWord = false,
}: Props) {
  const [data, setData] = useState<DayLadder[]>([]);
  const [loading, setLoading] = useState(true);
  const [reqDays, setReqDays] = useState(days);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const openStockDetail = useUIStore((s) => s.openStockDetail);

  // props.days 变了 (sub-tab 切换), 重置分页
  useEffect(() => {
    setReqDays(days);
    setHasMore(true);
  }, [days]);

  useEffect(() => {
    let cancelled = false;
    if (data.length === 0) setLoading(true);
    else setLoadingMore(true);
    api
      .getSnapshotRange("ladder", reqDays)
      .then((res) => {
        if (cancelled) return;
        const arr = res as unknown as DayLadder[];
        setData(arr);
        if (arr.length < reqDays) setHasMore(false);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadingMore(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reqDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerLoadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setReqDays((d) => (d >= MAX_DAYS ? d : Math.min(d + PAGE_SIZE, MAX_DAYS)));
  }, [hasMore, loadingMore]);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceToRight = el.scrollWidth - el.clientWidth - el.scrollLeft;
    if (distanceToRight < SCROLL_THRESHOLD) triggerLoadMore();
  }, [triggerLoadMore]);

  // Auto-fill: 数据加载完后若容器仍未溢出, 继续加载直到溢出或耗尽
  useEffect(() => {
    if (data.length === 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    const id = window.setTimeout(() => {
      const overflow = el.scrollWidth - el.clientWidth;
      if (overflow < SCROLL_THRESHOLD && hasMore && !loadingMore) {
        triggerLoadMore();
      }
    }, 80);
    return () => window.clearTimeout(id);
  }, [data, hasMore, loadingMore, triggerLoadMore]);

  // 监听 wheel 横向手势, 即使容器未溢出也能触发加载
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX);
      const dy = Math.abs(e.deltaY);
      if (dx <= dy) return;
      if (e.deltaX <= 0) return;
      acc += e.deltaX;
      if (acc > 60) {
        acc = 0;
        triggerLoadMore();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [triggerLoadMore]);

  if (loading || data.length === 0) {
    return (
      <div
        className="grid gap-2 p-3"
        style={{ gridTemplateColumns: `repeat(${days}, 1fr)` }}
      >
        {Array.from({ length: days * 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse"
            style={{ background: "var(--bg-card)" }}
          />
        ))}
      </div>
    );
  }

  // 每天合并所有板级的票, 按板级降序排, 应用筛选
  const kw = (keyword || "").trim().toLowerCase();
  const cols = data.map((d) => {
    const all: LadderStock[] = [];
    for (const lv of d.data.levels) {
      if (lv.board_level < minLevel) continue;
      for (const s of lv.stocks ?? []) {
        if (filterTheme && !(s.theme_names ?? []).includes(filterTheme)) continue;
        if (onlyOneWord && !s.is_one_word) continue;
        if (kw) {
          const hay = `${s.stock_name ?? ""}${s.stock_code}${(s.theme_names ?? []).join(",")}${s.limit_reason ?? ""}`.toLowerCase();
          if (!hay.includes(kw)) continue;
        }
        all.push({ ...s, _level: lv.board_level });
      }
    }
    all.sort((a, b) => (b._level ?? 0) - (a._level ?? 0));
    return { date: d.trade_date, stocks: all };
  });

  const colCount = cols.length;
  const minColW = compact ? 120 : 180;

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      className="overflow-x-auto relative"
      style={{ background: "var(--bg-primary)" }}
    >
      {(loadingMore || !hasMore) && (
        <div
          className="absolute"
          style={{
            top: 6,
            right: 8,
            zIndex: 10,
            fontSize: 10,
            color: "var(--text-muted)",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            padding: "2px 6px",
            borderRadius: 3,
          }}
        >
          {loadingMore
            ? "加载更多..."
            : `已显示 ${colCount} 天 (无更多)`}
        </div>
      )}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${colCount}, minmax(${minColW}px, 1fr))`,
        }}
      >
        {/* 日期表头 */}
        {cols.map((c, i) => (
          <div
            key={`h-${c.date}`}
            className="text-center font-bold tabular-nums"
            style={{
              background: "var(--bg-secondary)",
              color: i === 0 ? "var(--accent-orange)" : "var(--text-primary)",
              fontSize: "var(--font-md)",
              padding: "8px 12px",
              borderBottom: "1px solid var(--border-color)",
              borderRight:
                i === colCount - 1 ? "none" : "1px solid var(--border-color)",
              position: "sticky",
              top: 0,
              zIndex: 5,
            }}
          >
            {c.date.replace(/-/g, "")}
            <span
              className="ml-2 font-normal"
              style={{
                color: "var(--text-muted)",
                fontSize: "var(--font-xs)",
              }}
            >
              {c.stocks.length}只
            </span>
          </div>
        ))}

        {/* 各列股票卡片 */}
        {cols.map((c, i) => (
          <div
            key={`c-${c.date}`}
            className={compact ? "space-y-0.5" : "space-y-1.5"}
            style={{
              padding: compact ? "4px" : "8px",
              borderRight:
                i === colCount - 1 ? "none" : "1px solid var(--border-color)",
              minHeight: 240,
            }}
          >
            {c.stocks.map((s) => {
              const lvl = s._level ?? 1;
              const color = getBoardLevelColor(lvl);
              const lvlLabel = lvl >= 7 ? "7+板" : `${lvl}板`;
              const amt = formatAmount(s.amount);
              const seal = formatAmount(s.limit_order_amount);

              // 紧凑模式: 一行式 - 名字 + 板数徽章 + 一字标
              if (compact) {
                return (
                  <button
                    key={`${c.date}-${s.stock_code}`}
                    onClick={() => openStockDetail(s.stock_code, s.stock_name)}
                    className="ladder-card flex items-center gap-1"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-color)",
                      borderLeft: `3px solid ${color}`,
                      borderRadius: 3,
                      padding: "2px 5px",
                      cursor: "pointer",
                      height: 22,
                    }}
                  >
                    <span
                      className="font-semibold truncate flex-1"
                      style={{
                        color: "var(--text-primary)",
                        fontSize: "var(--font-sm)",
                      }}
                    >
                      {s.stock_name || s.stock_code.slice(-6)}
                    </span>
                    <span
                      className="font-bold flex-shrink-0"
                      style={{
                        background: color,
                        color: "#fff",
                        padding: "0 4px",
                        borderRadius: 2,
                        fontSize: 9,
                        lineHeight: "14px",
                      }}
                    >
                      {lvlLabel}
                    </span>
                    {s.is_one_word && (
                      <span
                        className="flex-shrink-0"
                        style={{
                          background: "var(--accent-red)",
                          color: "#fff",
                          padding: "0 3px",
                          borderRadius: 2,
                          fontSize: 9,
                          fontWeight: 700,
                          lineHeight: "14px",
                        }}
                      >
                        一字
                      </span>
                    )}
                  </button>
                );
              }
              return (
                <button
                  key={`${c.date}-${s.stock_code}`}
                  onClick={() => openStockDetail(s.stock_code, s.stock_name)}
                  className="ladder-card"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-color)",
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 4,
                    padding: "6px 8px",
                    display: "block",
                    cursor: "pointer",
                  }}
                >
                  {/* row1: 名字 + 板级徽章 + (一字) */}
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className="font-bold truncate"
                      style={{
                        color: "var(--text-primary)",
                        fontSize: "var(--font-md)",
                      }}
                    >
                      {s.stock_name || s.stock_code}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span
                        className="font-bold"
                        style={{
                          background: color,
                          color: "#fff",
                          padding: "1px 5px",
                          borderRadius: 2,
                          fontSize: "var(--font-xs)",
                        }}
                      >
                        {lvlLabel}
                      </span>
                      {s.is_one_word && (
                        <span
                          style={{
                            background: "var(--accent-red)",
                            color: "#fff",
                            padding: "1px 4px",
                            borderRadius: 2,
                            fontSize: "var(--font-xs)",
                            fontWeight: 700,
                          }}
                        >
                          一字
                        </span>
                      )}
                    </div>
                  </div>

                  {/* row2: 代码 + 时间封板 / 开 */}
                  <div
                    className="flex items-center gap-2 tabular-nums"
                    style={{
                      fontSize: "var(--font-xs)",
                      color: "var(--text-muted)",
                      marginTop: 3,
                    }}
                  >
                    <span>{s.stock_code.slice(-6)}</span>
                    {s.first_limit_time && (
                      <span>
                        {s.first_limit_time.slice(0, 5)}
                        {s.open_count === 0 && (
                          <span
                            style={{
                              color: "var(--accent-red)",
                              fontWeight: 700,
                              marginLeft: 2,
                            }}
                          >
                            封板
                          </span>
                        )}
                      </span>
                    )}
                    {s.open_count > 0 && (
                      <span
                        style={{
                          background: "var(--accent-orange)",
                          color: "#fff",
                          padding: "0 4px",
                          borderRadius: 2,
                          fontWeight: 700,
                        }}
                      >
                        开{s.open_count}
                      </span>
                    )}
                  </div>

                  {/* row3: 成交 + 封单 */}
                  {(amt || seal) && (
                    <div
                      className="flex items-center gap-2 tabular-nums"
                      style={{
                        fontSize: "var(--font-xs)",
                        color: "var(--text-secondary)",
                        marginTop: 2,
                      }}
                    >
                      {amt && <span>{amt}成交</span>}
                      {seal && <span>{seal}封单</span>}
                    </div>
                  )}

                  {/* row4: 题材标签 */}
                  {s.limit_reason && (
                    <div
                      className="truncate"
                      style={{
                        marginTop: 4,
                        fontSize: "var(--font-xs)",
                        background: "var(--accent-purple)",
                        color: "#fff",
                        padding: "1px 5px",
                        borderRadius: 2,
                        display: "inline-block",
                        maxWidth: "100%",
                        fontWeight: 600,
                      }}
                    >
                      {s.limit_reason}
                    </div>
                  )}
                </button>
              );
            })}
            {c.stocks.length === 0 && (
              <div
                className="text-center"
                style={{
                  color: "var(--text-muted)",
                  fontSize: "var(--font-sm)",
                  padding: 12,
                }}
              >
                {filterTheme ? "无相关连板" : "无连板"}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
