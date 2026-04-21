"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { getBoardLevelColor } from "@/lib/colorScale";

const PAGE_SIZE = 7;
const MAX_DAYS = 60;
const SCROLL_THRESHOLD = 140;
const COL_WIDTH = 130;
const LABEL_WIDTH = 110;

// P1 改造: 复用 ladder-brief.key_stocks 的 AI 标记叠加到卡片上
// tag 来源 (LLM 输出): 高度龙头 / 主线龙头 / 超预期 / 空间股 / 梯队跟随
const AI_TAG_COLOR: Record<string, string> = {
  "高度龙头": "var(--accent-red)",
  "主线龙头": "var(--accent-orange)",
  "超预期": "var(--accent-purple)",
  "空间股": "var(--accent-red)",
  "梯队跟随": "var(--text-muted)",
};

interface KeyStockAi {
  code: string;
  name: string;
  board: number;
  tag: string;
  note: string;
}
/** 题材行最小高度 (与参考 web 对齐, 让卡片堆从同一 y 开始) */
const THEME_ROW_MIN_H = 220;
/** 卡片固定高度, 用于跨列对齐 */
const CARD_H_NORMAL = 92;
const CARD_H_NO_REASON = 70;

interface LadderStock {
  stock_code: string;
  stock_name?: string;
  is_one_word?: boolean;
  open_count?: number;
  first_limit_time?: string | null;
  limit_order_amount?: number | null;
  amount?: number | null;
  limit_reason?: string | null;
  theme_names?: string[] | null;
  industry?: string | null;
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

type SnapshotRow = { trade_date: string; data: Record<string, unknown> };

interface KplTheme {
  name: string;
  z_t_num: number;
  up_num: number;
}
interface ThemeConsStock {
  stock_code: string;
  stock_name: string;
  desc: string;
  hot_num: number;
}

function unknownString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function unknownNumber(v: unknown): number | undefined {
  return typeof v === "number" && !Number.isNaN(v) ? v : undefined;
}

function parseDayLadder(row: SnapshotRow): DayLadder | null {
  const raw = row.data.levels;
  if (!Array.isArray(raw)) return null;
  return {
    trade_date: row.trade_date,
    data: { levels: raw as LadderLevel[] },
  };
}

function parseKplThemes(data: Record<string, unknown>): KplTheme[] {
  const top = data.top;
  if (!Array.isArray(top)) return [];
  const out: KplTheme[] = [];
  for (const item of top) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = unknownString(o.name)?.trim();
    if (!name) continue;
    out.push({
      name,
      z_t_num: unknownNumber(o.z_t_num) ?? 0,
      up_num: unknownNumber(o.up_num) ?? 0,
    });
  }
  return out;
}

function parseThemeConsByConcept(
  data: Record<string, unknown>
): Record<string, ThemeConsStock[]> {
  const by = data.by_concept;
  if (!by || typeof by !== "object" || Array.isArray(by)) return {};
  const rec = by as Record<string, unknown>;
  const out: Record<string, ThemeConsStock[]> = {};
  for (const [concept, arr] of Object.entries(rec)) {
    if (!Array.isArray(arr)) continue;
    const stocks: ThemeConsStock[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const code = unknownString(o.stock_code)?.trim();
      if (!code) continue;
      stocks.push({
        stock_code: code,
        stock_name: unknownString(o.stock_name) ?? "",
        desc: unknownString(o.desc) ?? "",
        hot_num: unknownNumber(o.hot_num) ?? 0,
      });
    }
    out[concept] = stocks;
  }
  return out;
}

function fmtPct(rate: number): string {
  if (!rate) return "(0%)";
  const v = rate * 100;
  return `(${v >= 100 ? "100" : v.toFixed(2)}%)`;
}
function fmtDate(s: string): string {
  return s.replace(/-/g, "");
}
function fmtAmount(v: number | null | undefined): string | null {
  if (!v || v <= 0) return null;
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  return v.toFixed(0);
}

function countOneWord(levels: LadderLevel[]): number {
  let n = 0;
  for (const lv of levels)
    for (const s of lv.stocks ?? []) if (s.is_one_word) n++;
  return n;
}
function countBroken(levels: LadderLevel[]): number {
  let n = 0;
  for (const lv of levels)
    for (const s of lv.stocks ?? []) if ((s.open_count ?? 0) >= 1) n++;
  return n;
}
function countFanbao(levels: LadderLevel[]): number {
  let n = 0;
  for (const lv of levels) {
    if (lv.board_level < 2) continue;
    for (const s of lv.stocks ?? []) if ((s.open_count ?? 0) >= 1) n++;
  }
  return n;
}
function maxLevel(levels: LadderLevel[]): number {
  let m = 0;
  for (const lv of levels)
    if (lv.stock_count > 0 && lv.board_level > m) m = lv.board_level;
  return m;
}
type StockWithLevel = LadderStock & { _level: number };
/** 一天的所有股票, 按板级降序排 */
function flattenStocks(levels: LadderLevel[]): StockWithLevel[] {
  const all: StockWithLevel[] = [];
  for (const lv of levels)
    for (const s of lv.stocks ?? []) all.push({ ...s, _level: lv.board_level });
  all.sort((a, b) => b._level - a._level);
  return all;
}

interface RowDef {
  label: string;
  /** 解析 label 中带的 N 板 -> 取对应 LadderLevel */
  levelKey?: number;
  get: (lv: LadderLevel | undefined, day: DayLadder) => {
    primary: string | number;
    secondary?: string;
    color?: "red" | null;
  };
}

const ROWS: RowDef[] = [
  {
    label: "最高板数",
    get: (_lv, day) => {
      const m = maxLevel(day.data.levels);
      return { primary: m, color: m >= 5 ? "red" : null };
    },
  },
  {
    label: "7板+",
    levelKey: 7,
    get: (lv) => {
      const c = lv?.stock_count ?? 0;
      const r = lv?.promotion_rate ?? 0;
      return {
        primary: c,
        secondary: c > 0 ? fmtPct(r) : undefined,
        color: c > 0 ? "red" : null,
      };
    },
  },
  ...[6, 5, 4, 3, 2].map((lvNum) => ({
    label: `${lvNum}板 晋级`,
    levelKey: lvNum,
    get: (lv: LadderLevel | undefined) => {
      const c = lv?.stock_count ?? 0;
      const r = lv?.promotion_rate ?? 0;
      return {
        primary: c,
        secondary: c > 0 ? fmtPct(r) : "(0%)",
        color: c > 0 ? ("red" as const) : null,
      };
    },
  })),
  {
    label: "1板",
    levelKey: 1,
    get: (lv) => ({
      primary: lv?.stock_count ?? 0,
      color: (lv?.stock_count ?? 0) > 30 ? "red" : null,
    }),
  },
  {
    label: "一字板",
    get: (_lv, day) => ({ primary: countOneWord(day.data.levels) }),
  },
  {
    label: "反包板",
    get: (_lv, day) => ({ primary: countFanbao(day.data.levels) }),
  },
  {
    label: "炸板",
    get: (_lv, day) => ({ primary: countBroken(day.data.levels) }),
  },
];

/** 顶部连板梯队 / 首板统计 (从所有日期里第一天的 levels 算) */
function HeaderStats({ levels }: { levels: LadderLevel[] }) {
  let promoUp = 0;
  let promoDown = 0;
  let firstUp = 0;
  for (const lv of levels) {
    if (lv.board_level === 1) {
      firstUp += lv.stock_count;
    } else {
      promoUp += lv.promotion_count ?? 0;
      promoDown += lv.stock_count ?? 0;
    }
  }
  // 简单聚合: 连板梯队晋级数 / 总数, 首板数 / (1板+2板首封?) 这里用近似
  const promoTotal = promoDown;
  const promoRate = promoTotal > 0 ? promoUp / promoTotal : 0;
  const firstTotal = firstUp + (levels.find((l) => l.board_level === 2)?.stock_count ?? 0);
  const firstRate = firstTotal > 0 ? firstUp / firstTotal : 0;
  const fmt = (n: number) => `${(n * 100).toFixed(1)}%`;
  return (
    <div
      className="flex items-center gap-4"
      style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-color)",
        padding: "8px 12px",
        fontSize: 12,
        color: "var(--text-secondary)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span>连板梯队</span>
        <span
          className="font-bold tabular-nums"
          style={{ color: "var(--text-primary)" }}
        >
          {promoUp}/{promoTotal}
        </span>
        <span
          className="font-bold tabular-nums"
          style={{
            background: "var(--accent-red)",
            color: "#fff",
            padding: "1px 6px",
            borderRadius: 3,
          }}
        >
          {fmt(promoRate)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span>首板</span>
        <span
          className="font-bold tabular-nums"
          style={{ color: "var(--text-primary)" }}
        >
          {firstUp}/{firstTotal}
        </span>
        <span
          className="font-bold tabular-nums"
          style={{
            background: "var(--accent-red)",
            color: "#fff",
            padding: "1px 6px",
            borderRadius: 3,
          }}
        >
          {fmt(firstRate)}
        </span>
      </div>
    </div>
  );
}

/** 对齐 ladder / theme_cons 中股票代码格式 (取末 6 位数字) */
function stockCodeKey(code: string): string {
  const d = code.replace(/\D/g, "");
  if (d.length === 0) return code;
  return d.length > 6 ? d.slice(-6) : d.padStart(6, "0");
}

interface LadderMatrixProps {
  /** 与 LadderAiCard L1 dial 联动 — 命中行 label 旁加紫色 Sparkles 角标 */
  aiHighlightRowLabels?: string[];
}

export function LadderMatrix({
  aiHighlightRowLabels = [],
}: LadderMatrixProps = {}) {
  const [data, setData] = useState<DayLadder[]>([]);
  const highlightSet = useMemo(
    () => new Set(aiHighlightRowLabels),
    [aiHighlightRowLabels],
  );
  const [themesByDate, setThemesByDate] = useState<Map<string, KplTheme[]>>(
    () => new Map()
  );
  const [themeConsByDate, setThemeConsByDate] = useState<
    Map<string, Record<string, ThemeConsStock[]>>
  >(() => new Map());
  const [reqDays, setReqDays] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const openStockDetail = useUIStore((s) => s.openStockDetail);

  /** P1: ladder-brief.key_stocks 索引 (code -> AI tag/note), 仅最新交易日 */
  const [aiByCode, setAiByCode] = useState<Map<string, KeyStockAi>>(
    () => new Map()
  );

  /** 题材交叉高亮 (hover 同名题材) */
  const [hoverTheme, setHoverTheme] = useState<string | null>(null);
  /** 题材弹窗: 选中题材名 + 选中日期 (当前仅 KPL 题材可点开) */
  const [activeTheme, setActiveTheme] = useState<{
    name: string;
    date: string;
  } | null>(null);

  useEffect(() => {
    let cancel = false;
    if (data.length > 0) setLoadingMore(true);
    Promise.all([
      api.getSnapshotRange("ladder", reqDays),
      api.getSnapshotRange("themes", reqDays),
      api.getSnapshotRange("theme_cons", reqDays),
    ])
      .then(([ladderRows, themesRows, themeConsRows]) => {
        if (cancel) return;
        const ladderArr: DayLadder[] = [];
        for (const row of ladderRows as SnapshotRow[]) {
          const parsed = parseDayLadder(row);
          if (parsed) ladderArr.push(parsed);
        }
        setData(ladderArr);

        const tMap = new Map<string, KplTheme[]>();
        for (const row of themesRows as SnapshotRow[]) {
          tMap.set(row.trade_date, parseKplThemes(row.data));
        }
        setThemesByDate(tMap);

        const cMap = new Map<string, Record<string, ThemeConsStock[]>>();
        for (const row of themeConsRows as SnapshotRow[]) {
          cMap.set(row.trade_date, parseThemeConsByConcept(row.data));
        }
        setThemeConsByDate(cMap);

        if (ladderArr.length < reqDays) setHasMore(false);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancel) setLoadingMore(false);
      });
    return () => {
      cancel = true;
    };
  }, [reqDays]); // eslint-disable-line react-hooks/exhaustive-deps

  // P1: 单独拉一次 ladder-brief, 把 key_stocks 索引到 stockCodeKey -> KeyStockAi
  // 后端 PG 缓存命中, 几乎瞬时. 失败时静默跳过, 不影响主网格.
  useEffect(() => {
    let cancel = false;
    api
      .getLadderBrief()
      .then((brief) => {
        if (cancel) return;
        const m = new Map<string, KeyStockAi>();
        for (const ks of brief.key_stocks ?? []) {
          if (!ks.code) continue;
          m.set(stockCodeKey(ks.code), ks);
        }
        setAiByCode(m);
      })
      .catch(() => {
        /* 静默 — AI 暂不可用时, 卡片照样能用 */
      });
    return () => {
      cancel = true;
    };
  }, []);

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

  if (data.length === 0) {
    return (
      <div className="p-3">
        <div
          className="h-96 animate-pulse"
          style={{ background: "var(--bg-card)" }}
        />
      </div>
    );
  }

  const totalWidth = LABEL_WIDTH + COL_WIDTH * data.length;
  const colorMap: Record<string, string> = {
    red: "var(--accent-red)",
  };

  return (
    <div>
      {/* 顶部统计行 */}
      <HeaderStats levels={data[0]?.data.levels ?? []} />

      {/* 横向+纵向滚动区域 - 矩阵+题材+卡片共享同一日期轴; 日期表头 sticky 钉顶 */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="overflow-auto relative"
        style={{
          background: "var(--bg-primary)",
          maxHeight: "calc(100vh - 130px)",
        }}
      >
        {(loadingMore || !hasMore) && (
          <div
            className="absolute"
            style={{
              top: 6,
              right: 8,
              zIndex: 20,
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
              : `已显示 ${data.length} 天 (无更多)`}
          </div>
        )}

        <div style={{ width: totalWidth, minWidth: "100%" }}>
          {/* 日期表头 - sticky 钉在滚动容器顶 */}
          <div
            className="flex"
            style={{
              background: "var(--bg-secondary)",
              position: "sticky",
              top: 0,
              zIndex: 15,
            }}
          >
            <div
              style={{
                width: LABEL_WIDTH,
                flexShrink: 0,
                borderRight: "1px solid var(--border-color)",
                borderBottom: "1px solid var(--border-color)",
                padding: "8px 10px",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              板级
            </div>
            {data.map((d, i) => (
              <div
                key={d.trade_date}
                style={{
                  width: COL_WIDTH,
                  flexShrink: 0,
                  borderRight:
                    i === data.length - 1
                      ? "none"
                      : "1px solid var(--border-color)",
                  borderBottom: "1px solid var(--border-color)",
                  padding: "8px 0",
                  textAlign: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  color:
                    i === 0 ? "var(--accent-orange)" : "var(--text-primary)",
                }}
              >
                {fmtDate(d.trade_date)}
              </div>
            ))}
          </div>

          {/* 板级矩阵行 */}
          {ROWS.map((row) => {
            const isHighlight = highlightSet.has(row.label);
            return (
            <div
              key={row.label}
              className="flex"
              style={{
                borderBottom: "1px solid var(--border-color)",
                background: isHighlight ? "rgba(168,85,247,0.05)" : undefined,
              }}
            >
              <div
                style={{
                  width: LABEL_WIDTH,
                  flexShrink: 0,
                  borderRight: "1px solid var(--border-color)",
                  padding: "8px 10px",
                  fontSize: 12,
                  color: isHighlight
                    ? "var(--accent-purple)"
                    : "var(--text-secondary)",
                  fontWeight: isHighlight ? 700 : undefined,
                }}
                title={
                  isHighlight
                    ? "AI 关注: 这是当前 AI 仪表盘引用的核心证据维度"
                    : undefined
                }
              >
                {isHighlight && (
                  <Sparkles
                    size={9}
                    style={{
                      color: "var(--accent-purple)",
                      marginRight: 3,
                      verticalAlign: "middle",
                    }}
                  />
                )}
                {row.label.includes("晋级") ? (
                  <>
                    {row.label.split(" ")[0]}{" "}
                    <span
                      style={{ color: "var(--text-muted)", fontSize: 10 }}
                    >
                      晋级
                    </span>
                  </>
                ) : (
                  row.label
                )}
              </div>
              {data.map((d, i) => {
                const lv = row.levelKey
                  ? d.data.levels.find((x) => x.board_level === row.levelKey)
                  : undefined;
                const cell = row.get(lv, d);
                const isLast = i === data.length - 1;
                return (
                  <div
                    key={d.trade_date}
                    style={{
                      width: COL_WIDTH,
                      flexShrink: 0,
                      borderRight: isLast
                        ? "none"
                        : "1px solid var(--border-color)",
                      padding: "6px 0",
                      textAlign: "center",
                      background: cell.color
                        ? "rgba(244, 67, 54, 0.18)"
                        : "transparent",
                    }}
                  >
                    <div
                      className="font-bold tabular-nums"
                      style={{
                        fontSize: 14,
                        color: cell.color
                          ? colorMap[cell.color]
                          : "var(--text-primary)",
                        lineHeight: 1.2,
                      }}
                    >
                      {cell.primary}
                    </div>
                    {cell.secondary && (
                      <div
                        className="tabular-nums"
                        style={{
                          fontSize: 10,
                          color:
                            (cell.primary as number) > 0
                              ? "var(--accent-red)"
                              : "var(--accent-green)",
                          lineHeight: 1.2,
                          marginTop: 1,
                        }}
                      >
                        晋{cell.secondary.replace(/[()]/g, "")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            );
          })}

          {/* 热点题材行 — KPL 涨停题材聚合, 点击弹窗, hover 跨日期高亮 */}
          <div
            className="flex"
            style={{
              borderBottom: "1px solid var(--border-color)",
              background: "var(--bg-secondary)",
              minHeight: THEME_ROW_MIN_H,
            }}
          >
            <div
              style={{
                width: LABEL_WIDTH,
                flexShrink: 0,
                borderRight: "1px solid var(--border-color)",
                padding: "8px 10px",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              热点题材
            </div>
            {data.map((d, i) => {
              const kplList = (themesByDate.get(d.trade_date) ?? [])
                .filter((t) => t.z_t_num >= 1)
                .sort((a, b) => b.z_t_num - a.z_t_num)
                .slice(0, 12);
              const hasKpl = kplList.length > 0;
              return (
                <div
                  key={d.trade_date}
                  style={{
                    width: COL_WIDTH,
                    flexShrink: 0,
                    borderRight:
                      i === data.length - 1
                        ? "none"
                        : "1px solid var(--border-color)",
                    padding: "6px 6px",
                  }}
                >
                  {!hasKpl ? (
                    <div
                      style={{ color: "var(--text-muted)", fontSize: 11 }}
                      className="text-center"
                    >
                      -
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {kplList.map((t) => {
                        const hot = hoverTheme === t.name;
                        return (
                          <button
                            key={`kpl-${t.name}`}
                            type="button"
                            onMouseEnter={() => setHoverTheme(t.name)}
                            onMouseLeave={() =>
                              setHoverTheme((cur) =>
                                cur === t.name ? null : cur
                              )
                            }
                            onClick={() =>
                              setActiveTheme({
                                name: t.name,
                                date: d.trade_date,
                              })
                            }
                            className="flex items-center justify-between gap-1 truncate text-left w-full"
                            style={{
                              color: hot
                                ? "var(--text-primary)"
                                : "var(--text-secondary)",
                              background: hot
                                ? "rgba(0,0,0,0.06)"
                                : "transparent",
                              fontSize: 11,
                              lineHeight: "16px",
                              padding: "1px 4px",
                              borderRadius: 2,
                              cursor: "pointer",
                              fontWeight: hot ? 600 : 400,
                              border: "none",
                            }}
                            title={`${t.name} 涨停 ${t.z_t_num} 只 — 点击查看成分`}
                          >
                            <span className="truncate min-w-0 flex-1">
                              {t.name}
                            </span>
                            <span
                              className="flex-shrink-0 tabular-nums"
                              style={{ opacity: 0.75, fontSize: 10 }}
                            >
                              ({t.z_t_num})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 个股卡片行 - 每列一个垂直堆叠的卡片堆 */}
          <div className="flex">
            <div
              style={{
                width: LABEL_WIDTH,
                flexShrink: 0,
                borderRight: "1px solid var(--border-color)",
                padding: "8px 10px",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              个股
            </div>
            {data.map((d, i) => {
              const stocks = flattenStocks(d.data.levels);
              return (
                <div
                  key={d.trade_date}
                  style={{
                    width: COL_WIDTH,
                    flexShrink: 0,
                    borderRight:
                      i === data.length - 1
                        ? "none"
                        : "1px solid var(--border-color)",
                    padding: 6,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {stocks.length === 0 && (
                    <div
                      className="text-center"
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 11,
                        padding: "8px 0",
                      }}
                    >
                      无连板
                    </div>
                  )}
                  {stocks.map((s) => {
                    const color = getBoardLevelColor(s._level);
                    const lvlLabel = s._level >= 7 ? "7+板" : `${s._level}板`;
                    const amt = fmtAmount(s.amount);
                    const seal = fmtAmount(s.limit_order_amount);
                    const hasReason = !!s.limit_reason;
                    // P1: AI 命中只在最新一天 (i === 0) 才叠加, 历史日 AI 没意义
                    const aiHit =
                      i === 0 ? aiByCode.get(stockCodeKey(s.stock_code)) : undefined;
                    const cardH = hasReason
                      ? CARD_H_NORMAL + (aiHit ? 16 : 0)
                      : CARD_H_NO_REASON + (aiHit ? 16 : 0);
                    const indMatch =
                      !!hoverTheme &&
                      (s.industry === hoverTheme ||
                        (s.theme_names ?? []).includes(hoverTheme));
                    const aiBorder = aiHit
                      ? AI_TAG_COLOR[aiHit.tag] || "var(--accent-purple)"
                      : null;
                    return (
                      <button
                        key={`${d.trade_date}-${s.stock_code}`}
                        onClick={() =>
                          openStockDetail(s.stock_code, s.stock_name)
                        }
                        className="ladder-card"
                        style={{
                          width: "100%",
                          height: cardH,
                          flexShrink: 0,
                          textAlign: "left",
                          background: indMatch
                            ? "var(--bg-tertiary)"
                            : "var(--bg-card)",
                          border: indMatch
                            ? `1px solid var(--accent-red)`
                            : aiBorder
                              ? `1px solid ${aiBorder}`
                              : "1px solid var(--border-color)",
                          borderLeft: `3px solid ${color}`,
                          borderRadius: 3,
                          padding: "4px 6px",
                          cursor: "pointer",
                          display: "block",
                          overflow: "hidden",
                          boxShadow: aiHit
                            ? `0 0 0 1px ${aiBorder} inset`
                            : "none",
                        }}
                        title={aiHit ? `AI ${aiHit.tag}: ${aiHit.note}` : undefined}
                      >
                        {aiHit && (
                          <div
                            className="flex items-center gap-1 truncate"
                            style={{
                              fontSize: 9,
                              lineHeight: "14px",
                              marginBottom: 1,
                              color: aiBorder ?? "var(--accent-purple)",
                              fontWeight: 700,
                            }}
                          >
                            <Sparkles size={9} />
                            <span className="truncate">{aiHit.tag}</span>
                            <span
                              className="truncate"
                              style={{
                                color: "var(--text-muted)",
                                fontWeight: 400,
                              }}
                            >
                              · {aiHit.note}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className="font-bold truncate"
                            style={{
                              color: "var(--text-primary)",
                              fontSize: 12,
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
                              fontSize: 10,
                              lineHeight: "14px",
                            }}
                          >
                            {lvlLabel}
                          </span>
                        </div>
                        <div
                          className="flex items-center gap-1.5 tabular-nums"
                          style={{
                            fontSize: 10,
                            color: "var(--text-muted)",
                            marginTop: 2,
                          }}
                        >
                          <span>{s.stock_code.slice(-6)}</span>
                          {s.first_limit_time && (
                            <span>{s.first_limit_time.slice(0, 5)}</span>
                          )}
                          {(s.open_count ?? 0) > 0 && (
                            <span
                              style={{
                                background: "var(--accent-orange)",
                                color: "#fff",
                                padding: "0 3px",
                                borderRadius: 2,
                                fontWeight: 700,
                              }}
                            >
                              开{s.open_count}
                            </span>
                          )}
                          {s.is_one_word && (
                            <span
                              style={{
                                background: "var(--accent-red)",
                                color: "#fff",
                                padding: "0 3px",
                                borderRadius: 2,
                                fontWeight: 700,
                              }}
                            >
                              一字
                            </span>
                          )}
                        </div>
                        {(amt || seal) && (
                          <div
                            className="tabular-nums truncate"
                            style={{
                              fontSize: 10,
                              color: "var(--text-secondary)",
                              marginTop: 1,
                            }}
                          >
                            {amt && <span>{amt}成交</span>}
                            {amt && seal && " "}
                            {seal && <span>{seal}封单</span>}
                          </div>
                        )}
                        {s.limit_reason && (
                          <div
                            className="truncate"
                            style={{
                              marginTop: 3,
                              fontSize: 10,
                              background: "var(--accent-purple)",
                              color: "#fff",
                              padding: "1px 4px",
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
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {activeTheme &&
        (() => {
          const dayData = data.find((d) => d.trade_date === activeTheme.date);
          const ladderAll = dayData
            ? flattenStocks(dayData.data.levels)
            : [];

          const themeCons =
            themeConsByDate.get(activeTheme.date)?.[activeTheme.name] ?? [];
          const consKeys = new Set(
            themeCons.map((s) => stockCodeKey(s.stock_code))
          );
          const ladderStocks = ladderAll.filter((s) =>
            consKeys.has(stockCodeKey(s.stock_code))
          );

          return (
            <ThemeModal
              theme={activeTheme.name}
              date={activeTheme.date}
              themeCons={themeCons}
              ladderStocks={ladderStocks}
              onClose={() => setActiveTheme(null)}
              onPickStock={(code, name) => {
                setActiveTheme(null);
                openStockDetail(code, name);
              }}
            />
          );
        })()}
    </div>
  );
}

/* ============== 题材弹窗 ============== */

interface ThemeModalProps {
  theme: string;
  date: string;
  /** KPL 题材的成分股（来自 theme_cons snapshot） */
  themeCons: ThemeConsStock[];
  /** 当日涨停股（来自 ladder），用于在弹窗顶部高亮 */
  ladderStocks: StockWithLevel[];
  onClose: () => void;
  onPickStock: (code: string, name?: string) => void;
}

function ThemeModalRowLadder({
  s,
  onPick,
}: {
  s: StockWithLevel;
  onPick: (code: string, name?: string) => void;
}) {
  const lvlLabel = s._level >= 7 ? "7+板" : `${s._level}板`;
  const color = getBoardLevelColor(s._level);
  const amt = fmtAmount(s.amount);
  const seal = fmtAmount(s.limit_order_amount);
  return (
    <button
      type="button"
      onClick={() => onPick(s.stock_code, s.stock_name)}
      className="w-full text-left"
      style={{
        display: "block",
        width: "100%",
        padding: "8px 10px 8px 12px",
        marginBottom: 6,
        borderRadius: 4,
        border: "1px solid rgba(244, 67, 54, 0.35)",
        borderLeft: "3px solid var(--accent-red)",
        background: "rgba(244, 67, 54, 0.06)",
        cursor: "pointer",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-bold truncate"
            style={{
              color: "var(--text-primary)",
              fontSize: 13,
            }}
          >
            {s.stock_name || s.stock_code.slice(-6)}
          </span>
          <span
            className="tabular-nums flex-shrink-0"
            style={{
              color: "var(--text-muted)",
              fontSize: 11,
            }}
          >
            {s.stock_code}
          </span>
        </div>
        <span
          className="font-bold flex-shrink-0"
          style={{
            background: color,
            color: "#fff",
            padding: "1px 6px",
            borderRadius: 3,
            fontSize: 11,
          }}
        >
          {lvlLabel}
        </span>
      </div>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums"
        style={{
          marginTop: 4,
          fontSize: 11,
          color: "var(--text-secondary)",
        }}
      >
        {s.first_limit_time && (
          <span>首封 {s.first_limit_time.slice(0, 5)}</span>
        )}
        {(s.open_count ?? 0) > 0 && (
          <span style={{ color: "var(--accent-orange)", fontWeight: 600 }}>
            开{s.open_count}
          </span>
        )}
        {s.is_one_word && (
          <span style={{ color: "var(--accent-red)", fontWeight: 600 }}>
            一字
          </span>
        )}
        {amt && <span>{amt}成交</span>}
        {seal && <span>{seal}封单</span>}
      </div>
      {s.limit_reason && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: "var(--text-muted)",
          }}
          className="truncate"
        >
          {s.limit_reason}
        </div>
      )}
    </button>
  );
}

function ThemeModal({
  theme,
  date,
  themeCons,
  ladderStocks,
  onClose,
  onPickStock,
}: ThemeModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dateCompact = date.replace(/-/g, "");
  const topKeys = new Set(
    ladderStocks.map((s) => stockCodeKey(s.stock_code))
  );
  const restCons = themeCons
    .filter((c) => !topKeys.has(stockCodeKey(c.stock_code)))
    .slice(0, 30);

  const headerTitle = `${theme}·涨停成分`;
  const headerMeta = `${dateCompact} · ${ladderStocks.length}只涨停 / 总${themeCons.length}只`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: 8,
          width: 560,
          maxWidth: "100%",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 48px rgba(0,0,0,0.6)",
        }}
      >
        <div
          className="flex items-center justify-between gap-2"
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent-red)",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span
              className="font-bold truncate"
              style={{
                color: "var(--text-primary)",
                fontSize: 14,
              }}
            >
              {headerTitle}
            </span>
            <span
              className="tabular-nums"
              style={{
                color: "var(--text-muted)",
                fontSize: 11,
                whiteSpace: "nowrap",
              }}
            >
              {headerMeta}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "0 4px",
              flexShrink: 0,
            }}
            aria-label="close"
          >
            ×
          </button>
        </div>

        <div
          style={{
            overflowY: "auto",
            padding: "12px 12px 16px",
          }}
        >
          <div
            style={{
              borderLeft: "3px solid var(--accent-red)",
              paddingLeft: 8,
              marginBottom: 8,
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            当日涨停
          </div>
          {ladderStocks.length === 0 ? (
            <div
              className="text-center"
              style={{
                color: "var(--text-muted)",
                fontSize: 12,
                padding: "12px 0 20px",
              }}
            >
              该日无相关涨停个股
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {ladderStocks.map((s) => (
                <ThemeModalRowLadder
                  key={s.stock_code}
                  s={s}
                  onPick={onPickStock}
                />
              ))}
            </div>
          )}

          {(
            <>
              <div
                style={{
                  borderLeft: "3px solid var(--text-muted)",
                  paddingLeft: 8,
                  marginBottom: 8,
                  marginTop: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                }}
              >
                全部成分股
              </div>
              {restCons.length === 0 ? (
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 12,
                    padding: "8px 0",
                  }}
                >
                  无更多成分股或未收录
                </div>
              ) : (
                restCons.map((c) => {
                  const descShort =
                    c.desc.length > 60 ? `${c.desc.slice(0, 60)}…` : c.desc;
                  return (
                    <button
                      type="button"
                      key={c.stock_code}
                      onClick={() => onPickStock(c.stock_code, c.stock_name)}
                      className="w-full text-left"
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 10px",
                        borderBottom: "1px solid var(--border-color)",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className="font-bold"
                          style={{
                            color: "var(--text-primary)",
                            fontSize: 13,
                          }}
                        >
                          {c.stock_name || c.stock_code}
                        </span>
                        <span
                          className="tabular-nums flex-shrink-0"
                          style={{
                            color: "var(--text-muted)",
                            fontSize: 11,
                          }}
                        >
                          {c.stock_code}
                        </span>
                      </div>
                      {descShort && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 11,
                            color: "var(--text-muted)",
                            lineHeight: 1.45,
                          }}
                        >
                          入选逻辑: {descShort}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
