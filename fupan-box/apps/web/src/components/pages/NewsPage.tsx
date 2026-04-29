"use client";

import { memo, useCallback, useState, useEffect, useMemo, useRef } from "react";
import { Newspaper, RefreshCw, Sparkles, Filter, Search, X as XIcon, Globe, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { logDevPerf } from "@/lib/dev-perf";
import { useUIStore } from "@/stores/ui-store";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  NewsAiCard,
  type NewsDialAnchor,
  type NewsBriefPayload,
  type NewsBriefThread,
  type NewsBriefBucket,
} from "@/components/market/NewsAiCard";
import {
  NewsItemCard,
  newsItemKey,
} from "@/components/pages/NewsItemCard";
import { HORIZON_META, type NewsHorizon } from "@/components/pages/news-constants";

type NewsItem = Awaited<ReturnType<typeof api.getNews>>[number];

type Filt = "all" | "important" | "watch" | "bullish" | "bearish";

type Horizon = "" | NewsHorizon;

interface ThreadFocus {
  kind: "thread";
  name: string;
  ids: Set<number>;
}
interface BucketFocus {
  kind: "policy" | "shock" | "earnings";
  ids: Set<number>;
}
type Focus = ThreadFocus | BucketFocus | null;

type NewsCounts = {
  all: number;
  important: number;
  watch: number;
  bullish: number;
  bearish: number;
};

function filtToAnchor(f: Filt): NewsDialAnchor | null {
  if (f === "all") return "total";
  if (f === "important") return "important";
  if (f === "watch") return "watch";
  if (f === "bullish" || f === "bearish") return "net_sentiment";
  return null;
}

export function NewsPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filt, setFilt] = useState<Filt>("all");
  const [horizon, setHorizon] = useState<Horizon>("");
  const [watch, setWatch] = useState<Set<string>>(new Set());

  // Phase 2: brief + SSE headline
  const [brief, setBrief] = useState<NewsBriefPayload | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefStreaming, setBriefStreaming] = useState<string>("");
  const [focus, setFocus] = useState<Focus>(null);
  const sseRef = useRef<EventSource | null>(null);
  const firstNewsLoadDoneRef = useRef(false);
  const [renderCount, setRenderCount] = useState(20);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const perfRunIdRef = useRef(0);

  const openThemeDetail = useUIStore((s) => s.openThemeDetail);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const askAI = useUIStore((s) => s.askAI);

  const fetchNews = async (refresh = false, watchOverride?: Set<string>, signal?: AbortSignal) => {
    if (!firstNewsLoadDoneRef.current || refresh) {
      setLoading(true);
    }
    try {
      const watchSet = watchOverride ?? watch;
      const watchCsv = watchSet.size > 0 ? Array.from(watchSet).join(",") : undefined;
      const res = await api.getNews(80, true, {
        hours: 24,
        sort: "smart",
        watch: watchCsv,
        impact_horizon: horizon || undefined,
      }, { signal });
      setNews(res);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error(e);
    } finally {
      firstNewsLoadDoneRef.current = true;
      setLoading(false);
    }
    void refresh;
  };

  const fetchBrief = async (refresh = false) => {
    if (!api.isLoggedIn()) {
      setBrief(null);
      setBriefStreaming("");
      return;
    }
    setBriefLoading(true);
    try {
      const b = await api.getNewsBrief({ hours: 24, refresh });
      setBrief(b);
    } catch (e) {
      // 匿名态/弱网都允许降级为仅新闻流，不冒泡到错误层。
      console.warn("[news-brief] fallback to news-only mode", e);
      setBrief(null);
    } finally {
      setBriefLoading(false);
    }
  };

  const startStream = () => {
    if (sseRef.current) {
      try { sseRef.current.close(); } catch { /* noop */ }
      sseRef.current = null;
    }
    setBriefStreaming("");
    try {
      const url = api.newsBriefStreamUrl({ hours: 24 });
      const es = new EventSource(url, { withCredentials: false });
      sseRef.current = es;
      let acc = "";
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.token) {
            acc += data.token;
            setBriefStreaming(acc);
          } else if (data.full_text) {
            setBriefStreaming(data.full_text);
          } else if (data.fallback) {
            setBriefStreaming(data.fallback);
          }
          if (data.done || data.error) {
            es.close();
            sseRef.current = null;
          }
        } catch { /* noop */ }
      };
      es.onerror = () => {
        es.close();
        sseRef.current = null;
      };
    } catch (e) {
      console.error("[news-stream]", e);
    }
  };

  // RAG 语义检索 (Phase 4)
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<NewsItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const runSearch = async () => {
    const q = searchQ.trim();
    if (q.length < 2) return;
    setSearching(true);
    setSearchErr(null);
    try {
      const rows = await api.searchNews({ q, limit: 30, hours: 24 * 14 });
      setSearchResults(rows as unknown as NewsItem[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "检索失败";
      setSearchErr(msg);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQ("");
    setSearchResults(null);
    setSearchErr(null);
  };

  // 跨页携带的 focus=ID (如 ThemeAiCard 点了某条新闻跳过来)
  const [focusId, setFocusId] = useState<number | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const parseHash = () => {
      const m = window.location.hash.match(/focus=(\d+)/);
      setFocusId(m ? Number(m[1]) : null);
    };
    parseHash();
    window.addEventListener("hashchange", parseHash);
    return () => window.removeEventListener("hashchange", parseHash);
  }, []);

  // focus 变化 → 滚到对应新闻
  useEffect(() => {
    if (focusId == null) return;
    const id = `news-item-${focusId}`;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.transition = "background 1.5s ease";
      const orig = el.style.background;
      el.style.background = "rgba(168,85,247,0.18)";
      setTimeout(() => {
        el.style.background = orig;
      }, 1800);
    }
  }, [focusId, news]);

  // 1) 首屏加载:
  // - 登录态: 先拿 watchlist, 再按命中排序拉新闻, 避免首屏后二次重排.
  // - 匿名态: 直接拉新闻.
  useEffect(() => {
    const loggedIn = api.isLoggedIn();
    const controller = new AbortController();
    let newsTimer: ReturnType<typeof setTimeout> | null = null;
    if (!loggedIn) {
      newsTimer = setTimeout(() => {
        void fetchNews(false, new Set(), controller.signal);
      }, 0);
    }

    let briefTimer: ReturnType<typeof setTimeout> | null = null;
    const runBriefIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void fetchBrief();
    };
    briefTimer = setTimeout(runBriefIfVisible, 300);
    const onVisible = () => {
      runBriefIfVisible();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      if (briefTimer) {
        clearTimeout(briefTimer);
        briefTimer = null;
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }

    if (loggedIn) {
      api.getWatchlist({ signal: controller.signal })
        .then((rows) => {
          const next = new Set(rows.map((r) => r.stock_code));
          setWatch(next);
          void fetchNews(false, next, controller.signal);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          const empty = new Set<string>();
          setWatch(empty);
          void fetchNews(false, empty, controller.signal);
        });
    }
    return () => {
      controller.abort();
      if (newsTimer) clearTimeout(newsTimer);
      if (briefTimer) clearTimeout(briefTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      if (sseRef.current) {
        try { sseRef.current.close(); } catch { /* noop */ }
        sseRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) 视角过滤变化时，基于当前自选集合刷新新闻。
  useEffect(() => {
    if (!firstNewsLoadDoneRef.current) return;
    const controller = new AbortController();
    void fetchNews(false, undefined, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon]);

  const handleRefresh = async () => {
    startStream();             // 先启 SSE 拉打字机 headline
    await Promise.all([fetchNews(true), fetchBrief(true)]);
  };

  const decorated = useMemo(() => {
    const base = searchResults != null ? searchResults : news;
    return base.map((it) => {
      const watchCodes = new Set((it.rel_codes || []).filter((c) => watch.has(c)));
      return { ...it, _watchHit: watchCodes.size > 0, _watchCodes: watchCodes };
    });
  }, [news, searchResults, watch]);

  const sortedDecorated = useMemo(() => {
    if (searchResults != null) return decorated;
    return decorated.slice().sort((a, b) => {
      if (a._watchHit !== b._watchHit) return a._watchHit ? -1 : 1;
      return (b.importance || 0) - (a.importance || 0);
    });
  }, [decorated, searchResults]);

  const filtered = useMemo(() => {
    // 检索模式: 按相关度 (后端返回顺序), 跳过本地 filt/focus
    if (searchResults != null) return decorated;
    let arr = sortedDecorated;
    if (horizon) {
      // 前端兜底过滤: 即便后端缓存/排序导致结果接近, 点击后也有稳定反馈。
      arr = arr.filter((it) => it.impact_horizon === horizon);
    }
    if (focus) {
      arr = arr.filter((it) => it.id != null && focus.ids.has(it.id as number));
    } else {
      if (filt === "important") arr = arr.filter((it) => (it.importance || 0) >= 3);
      else if (filt === "watch") arr = arr.filter((it) => it._watchHit);
      else if (filt === "bullish") arr = arr.filter((it) => it.sentiment === "bullish");
      else if (filt === "bearish") arr = arr.filter((it) => it.sentiment === "bearish");
    }
    return arr;
  }, [decorated, filt, focus, horizon, searchResults, sortedDecorated]);

  const counts = useMemo(() => {
    let important = 0;
    let watchHit = 0;
    let bullish = 0;
    let bearish = 0;
    for (const it of decorated) {
      if ((it.importance || 0) >= 3) important += 1;
      if (it._watchHit) watchHit += 1;
      if (it.sentiment === "bullish") bullish += 1;
      if (it.sentiment === "bearish") bearish += 1;
    }
    return {
      all: decorated.length,
      important,
      watch: watchHit,
      bullish,
      bearish,
    };
  }, [decorated]);
  const horizonCounts = useMemo(() => {
    const out: Record<NewsHorizon, number> = {
      short: 0,
      swing: 0,
      long: 0,
      mixed: 0,
    };
    for (const it of decorated) {
      const h = it.impact_horizon;
      if (h === "short" || h === "swing" || h === "long" || h === "mixed") {
        out[h] += 1;
      }
    }
    return out;
  }, [decorated]);

  const subtitle = decorated.length > 0
    ? `${decorated.length} 条 · ${brief?.model || "AI"} 已总结 · 命中自选 ${counts.watch}`
    : undefined;

  const markNewsInteraction = useCallback((name: string) => {
    if (typeof window === "undefined" || typeof performance === "undefined") return;
    const runId = ++perfRunIdRef.current;
    const start = performance.now();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ms = performance.now() - start;
        // 开发态可开关统计交互到绘制耗时。
        logDevPerf("news-perf", name, ms, {
          runId,
          filtered: filtered.length,
          visible: Math.min(renderCount, filtered.length),
          horizon,
          filt,
          hasFocus: !!focus,
        });
      });
    });
  }, [filtered.length, renderCount, horizon, filt, focus]);

  const handleDialClick = (anchor: NewsDialAnchor) => {
    setFocus(null);  // 清掉 main_thread 聚焦
    if (anchor === "total") setFilt("all");
    else if (anchor === "important") setFilt((p) => (p === "important" ? "all" : "important"));
    else if (anchor === "watch") setFilt((p) => (p === "watch" ? "all" : "watch"));
    else if (anchor === "net_sentiment") {
      const tilt = counts.bullish >= counts.bearish ? "bullish" : "bearish";
      setFilt((p) => (p === tilt ? "all" : tilt));
    }
    markNewsInteraction(`dial:${anchor}`);
  };

  const handleThreadClick = (t: NewsBriefThread) => {
    if (focus?.kind === "thread" && focus.name === t.name) {
      setFocus(null);
      markNewsInteraction("thread:clear");
      return;
    }
    setFilt("all");
    setFocus({ kind: "thread", name: t.name, ids: new Set(t.news_ids) });
    markNewsInteraction(`thread:${t.name}`);
  };

  const handleBucketClick = (kind: "policy" | "shock" | "earnings", b: NewsBriefBucket) => {
    if (focus?.kind === kind && areSetsEqual(focus.ids, new Set(b.news_ids))) {
      setFocus(null);
      markNewsInteraction(`${kind}:clear`);
      return;
    }
    setFilt("all");
    setFocus({ kind, ids: new Set(b.news_ids) });
    markNewsInteraction(`${kind}:set`);
  };

  const activeAnchor = filtToAnchor(filt);
  const focusLabel = focus?.kind === "thread"
    ? `主线: ${focus.name}`
    : focus?.kind === "policy" ? "政策聚焦"
    : focus?.kind === "shock" ? "突发风险聚焦"
    : focus?.kind === "earnings" ? "业绩/公告聚焦"
    : null;
  const setFilterWithClearFocus = useCallback((next: Filt) => {
    setFocus(null);
    setFilt(next);
    markNewsInteraction(`filter:${next}`);
  }, [markNewsInteraction]);
  const clearFocusOnly = useCallback(() => {
    setFocus(null);
    markNewsInteraction("focus:clear");
  }, [markNewsInteraction]);
  const resetHorizon = useCallback(() => {
    setHorizon("");
    markNewsInteraction("horizon:all");
  }, [markNewsInteraction]);
  const toggleHorizon = useCallback((next: Exclude<Horizon, "">) => {
    setHorizon((prev) => (prev === next ? "" : next));
    markNewsInteraction(`horizon:${next}`);
  }, [markNewsInteraction]);
  const visibleNews = useMemo(() => filtered.slice(0, renderCount), [filtered, renderCount]);
  const hasMoreNews = filtered.length > visibleNews.length;

  useEffect(() => {
    const t = setTimeout(() => {
      setRenderCount(20);
    }, 0);
    return () => clearTimeout(t);
  }, [filtered]);

  useEffect(() => {
    if (!hasMoreNews) return;
    const target = loadMoreRef.current;
    if (!target) return;
    const ob = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (!hit) return;
        setRenderCount((prev) => {
          if (prev >= filtered.length) return prev;
          return Math.min(filtered.length, prev + 20);
        });
      },
      { root: null, rootMargin: "240px 0px", threshold: 0.01 },
    );
    ob.observe(target);
    return () => ob.disconnect();
  }, [filtered.length, hasMoreNews]);

  return (
    <div>
      <PageHeader
        title="财经要闻"
        subtitle={subtitle}
        actions={
          <button
            onClick={handleRefresh}
            disabled={loading || briefLoading}
            className="rounded transition-colors flex items-center gap-1"
            style={{
              padding: "4px 10px",
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              fontSize: "var(--font-sm)",
              border: "1px solid var(--border-color)",
            }}
            title="刷新 + 重跑 AI brief"
          >
            <RefreshCw size={12} className={loading || briefLoading ? "animate-spin" : ""} />
            刷新
          </button>
        }
      />

      <NewsAiCard
        hero
        news={decorated}
        brief={brief}
        briefLoading={briefLoading}
        briefStreaming={briefStreaming}
        watchHits={counts.watch}
        loading={loading}
        activeAnchor={focus ? null : activeAnchor}
        onDialClick={handleDialClick}
        onThreadClick={handleThreadClick}
        onBucketClick={handleBucketClick}
        onCodeClick={openStockDetail}
        onThemeClick={openThemeDetail}
      />

      {brief?.global_signals && (brief.global_signals as GlobalSignal[]).length > 0 && (
        <GlobalSignalsPanel
          signals={brief.global_signals as GlobalSignal[]}
          onCodeClick={openStockDetail}
        />
      )}

      <div className="px-3 pt-2 space-y-1.5">
        {/* RAG 语义检索条 */}
        <div
          className="flex items-center gap-1.5 px-2 py-1.5"
          style={{
            background: "var(--bg-card)",
            border: `1px solid ${searchResults != null ? "rgba(168,85,247,0.45)" : "var(--border-color)"}`,
            borderRadius: 4,
          }}
        >
          <Search size={12} style={{ color: searchResults != null ? "var(--accent-purple)" : "var(--text-muted)" }} />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
              if (e.key === "Escape") clearSearch();
            }}
            placeholder="语义检索 14 天内新闻 (例如: 算力、固态电池量产、中东局势, ↵)"
            className="flex-1 bg-transparent outline-none"
            style={{
              fontSize: "var(--font-sm)",
              color: "var(--text-primary)",
            }}
          />
          {searching && <RefreshCw size={11} className="animate-spin" style={{ color: "var(--accent-purple)" }} />}
          {searchResults != null && (
            <button
              onClick={clearSearch}
              className="flex items-center gap-0.5 rounded transition-colors"
              style={{
                padding: "2px 6px",
                fontSize: 10,
                background: "rgba(168,85,247,0.14)",
                color: "var(--accent-purple)",
                border: "1px solid rgba(168,85,247,0.35)",
              }}
              title="退出检索"
            >
              <XIcon size={9} />
              退出检索
            </button>
          )}
          <button
            onClick={runSearch}
            disabled={searching || searchQ.trim().length < 2}
            className="rounded transition-colors"
            style={{
              padding: "2px 8px",
              fontSize: 11,
              background: "var(--accent-purple)",
              color: "#fff",
              border: "1px solid var(--accent-purple)",
              opacity: searching || searchQ.trim().length < 2 ? 0.5 : 1,
              fontWeight: 600,
            }}
            title="语义检索 (pgvector)"
          >
            检索
          </button>
        </div>

        {searchErr && (
          <div
            className="px-2 py-1"
            style={{
              fontSize: 10,
              color: "var(--accent-red)",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 4,
            }}
          >
            检索失败: {searchErr}
          </div>
        )}

        <NewsFilterStrip
          disabled={searchResults != null}
          filt={filt}
          counts={counts}
          hasFocus={!!focus}
          focusLabel={focusLabel}
          filteredLen={filtered.length}
          onSetFilt={setFilterWithClearFocus}
          onClearFocus={clearFocusOnly}
        />

        {/* Phase 2: 影响时间维度过滤 (impact_horizon) - 给短/中/长视角投资者用 */}
        <NewsHorizonStrip
          disabled={searchResults != null}
          horizon={horizon}
          counts={horizonCounts}
          onReset={resetHorizon}
          onToggle={toggleHorizon}
        />
      </div>

      <div className="px-3 pb-3 space-y-1">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="px-3 py-2 space-y-2 rounded animate-pulse"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}
            >
              <div className="flex items-center gap-1.5">
                <div
                  className="h-4 rounded"
                  style={{ width: 56, background: "var(--bg-tertiary)" }}
                />
                <div
                  className="h-4 rounded"
                  style={{ width: 42, background: "var(--bg-tertiary)" }}
                />
                <div
                  className="h-4 rounded"
                  style={{ width: 38, background: "var(--bg-tertiary)" }}
                />
              </div>
              <div
                className="h-4 rounded"
                style={{ width: "82%", background: "var(--bg-tertiary)" }}
              />
              <div
                className="h-3 rounded"
                style={{ width: "96%", background: "var(--bg-tertiary)" }}
              />
              <div
                className="h-3 rounded"
                style={{ width: "70%", background: "var(--bg-tertiary)" }}
              />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-3">
            <div
              className="w-14 h-14 rounded flex items-center justify-center"
              style={{ background: "var(--bg-tertiary)" }}
            >
              <Newspaper size={24} style={{ color: "var(--accent-blue)" }} />
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "var(--font-md)" }}>
              当前筛选无数据
            </div>
          </div>
        ) : (
          visibleNews.map((item) => (
            <NewsItemCard
              key={newsItemKey(item)}
              item={item}
              openThemeDetail={openThemeDetail}
              openStockDetail={openStockDetail}
              askAI={askAI}
            />
          ))
        )}
        {!loading && hasMoreNews && (
          <div ref={loadMoreRef} className="pt-1 flex justify-center">
            <button
              onClick={() => setRenderCount((prev) => Math.min(filtered.length, prev + 30))}
              className="rounded transition-colors"
              style={{
                padding: "4px 12px",
                fontSize: 12,
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-color)",
              }}
            >
              加载更多 ({visibleNews.length}/{filtered.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface GlobalSignal {
  news_id?: number;
  title: string;
  pub_time?: string | null;
  importance: number;
  sentiment?: string | null;
  overseas_event: string;
  transmission: string;
  beneficiary_codes: string[];
  confidence: "high" | "medium" | "low";
}

const CONF_COLOR: Record<string, string> = {
  high: "var(--accent-red)",
  medium: "var(--accent-orange)",
  low: "var(--text-muted)",
};

function GlobalSignalsPanel({
  signals,
  onCodeClick,
}: {
  signals: GlobalSignal[];
  onCodeClick: (code: string, name?: string) => void;
}) {
  if (!signals.length) return null;
  return (
    <div className="mx-3 mt-2">
      <div
        className="rounded-lg overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.05))",
          border: "1px solid rgba(59,130,246,0.28)",
        }}
      >
        <div
          className="px-3 py-2 flex items-center gap-2"
          style={{ borderBottom: "1px solid rgba(59,130,246,0.18)" }}
        >
          <Globe size={13} style={{ color: "var(--accent-blue)" }} />
          <span className="font-bold" style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}>
            海外事件 → A 股映射
          </span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {signals.length} 条全球信号
          </span>
        </div>
        <div className="px-3 py-2 space-y-2">
          {signals.map((s, i) => (
            <div
              key={i}
              className="px-2.5 py-2 rounded"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}
            >
              <div className="flex items-start gap-2 mb-1.5">
                <span
                  className="flex-shrink-0 font-bold px-1 py-0.5 rounded"
                  style={{
                    fontSize: 9,
                    background: `${CONF_COLOR[s.confidence]}22`,
                    color: CONF_COLOR[s.confidence],
                    border: `1px solid ${CONF_COLOR[s.confidence]}`,
                  }}
                >
                  {s.confidence === "high" ? "强关联" : s.confidence === "medium" ? "间接" : "情绪"}
                </span>
                <span
                  className="font-bold flex-1"
                  style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.4 }}
                >
                  {s.overseas_event}
                </span>
                {s.pub_time && (
                  <span className="tabular-nums flex-shrink-0" style={{ fontSize: 9, color: "var(--text-muted)" }}>
                    {s.pub_time.slice(5, 16)}
                  </span>
                )}
              </div>
              <div
                className="flex items-center gap-1 mb-1.5 px-1.5 py-1 rounded"
                style={{
                  background: "rgba(59,130,246,0.06)",
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                <ArrowRight size={10} style={{ color: "var(--accent-blue)", flexShrink: 0 }} />
                {s.transmission}
              </div>
              {s.beneficiary_codes.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>受益标的:</span>
                  {s.beneficiary_codes.map((c) => (
                    <button
                      key={c}
                      onClick={() => onCodeClick(c)}
                      className="tabular-nums rounded transition-colors"
                      style={{
                        padding: "1px 5px",
                        fontSize: 10,
                        background: "rgba(245,158,11,0.14)",
                        color: "var(--accent-orange)",
                        border: "1px solid rgba(245,158,11,0.3)",
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  icon,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: string;
  accent?: "orange" | "red" | "green";
}) {
  const accentColor =
    accent === "orange" ? "var(--accent-orange)" :
    accent === "red" ? "var(--accent-red)" :
    accent === "green" ? "var(--accent-green)" :
    "var(--accent-blue)";
  return (
    <button
      onClick={onClick}
      className="rounded transition-colors"
      style={{
        padding: "2px 8px",
        fontSize: 11,
        background: active ? accentColor : "transparent",
        color: active ? "#fff" : "var(--text-secondary)",
        border: active ? `1px solid ${accentColor}` : "1px solid var(--border-color)",
        fontWeight: active ? 700 : 500,
      }}
    >
      {icon && <span className="mr-0.5">{icon}</span>}
      {label}
    </button>
  );
}

const NewsFilterStrip = memo(function NewsFilterStrip({
  disabled,
  filt,
  counts,
  hasFocus,
  focusLabel,
  filteredLen,
  onSetFilt,
  onClearFocus,
}: {
  disabled: boolean;
  filt: Filt;
  counts: NewsCounts;
  hasFocus: boolean;
  focusLabel: string | null;
  filteredLen: number;
  onSetFilt: (next: Filt) => void;
  onClearFocus: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-1.5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 4,
        opacity: disabled ? 0.45 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
      title={disabled ? "检索模式下,本地筛选已停用" : undefined}
    >
      <Filter size={11} style={{ color: "var(--text-muted)" }} />
      <FilterChip active={!hasFocus && filt === "all"} onClick={() => onSetFilt("all")} label={`全部 ${counts.all}`} />
      <FilterChip active={!hasFocus && filt === "important"} onClick={() => onSetFilt("important")} label={`重磅 ${counts.important}`} icon="⭐" />
      <FilterChip active={!hasFocus && filt === "watch"} onClick={() => onSetFilt("watch")} label={`命中自选 ${counts.watch}`} accent="orange" />
      <FilterChip active={!hasFocus && filt === "bullish"} onClick={() => onSetFilt("bullish")} label={`利好 ${counts.bullish}`} accent="red" />
      <FilterChip active={!hasFocus && filt === "bearish"} onClick={() => onSetFilt("bearish")} label={`利空 ${counts.bearish}`} accent="green" />
      {hasFocus && focusLabel && (
        <FilterChip
          active={true}
          onClick={onClearFocus}
          label={`${focusLabel} (${filteredLen}) ✕`}
          accent="orange"
        />
      )}
      <span className="ml-auto flex items-center gap-1" style={{ fontSize: 10, color: "var(--text-muted)" }}>
        <Sparkles size={9} style={{ color: "var(--accent-purple)" }} />
        点 AI 主线下钻
      </span>
    </div>
  );
});

const NewsHorizonStrip = memo(function NewsHorizonStrip({
  disabled,
  horizon,
  counts,
  onReset,
  onToggle,
}: {
  disabled: boolean;
  horizon: Horizon;
  counts: Record<NewsHorizon, number>;
  onReset: () => void;
  onToggle: (next: Exclude<Horizon, "">) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-1.5 mt-1.5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 4,
        opacity: disabled ? 0.45 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
      title="按 AI 判定的「影响时间维度」过滤新闻"
    >
      <span style={{ fontSize: 10, color: "var(--text-muted)", marginRight: 4 }}>视角</span>
      <FilterChip
        active={horizon === ""}
        onClick={onReset}
        label="全部"
      />
      {(["short", "swing", "long", "mixed"] as const).map((h) => {
        const meta = HORIZON_META[h];
        return (
          <button
            key={h}
            onClick={() => onToggle(h)}
            className="flex items-center gap-1 px-2 py-0.5 transition-all"
            style={{
              background: horizon === h ? meta.color : "transparent",
              color: horizon === h ? "#fff" : meta.color,
              border: `1px solid ${meta.color}`,
              borderRadius: 3,
              fontSize: 10,
              fontWeight: horizon === h ? 700 : 500,
            }}
            title={meta.desc}
          >
            {meta.label}
          </button>
        );
      })}
      <span className="ml-auto" style={{ fontSize: 10, color: "var(--text-muted)" }}>
        {horizon === ""
          ? `适合所有投资者 · 共 ${Object.values(counts).reduce((s, n) => s + n, 0)} 条`
          : `${HORIZON_META[horizon].desc} · ${counts[horizon]} 条`}
      </span>
    </div>
  );
});

function areSetsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
