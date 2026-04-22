"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Newspaper, RefreshCw, Star, TrendingUp, TrendingDown, Minus, Sparkles, Filter, Zap, Search, X as XIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  NewsAiCard,
  type NewsDialAnchor,
  type NewsBriefPayload,
  type NewsBriefThread,
  type NewsBriefBucket,
} from "@/components/market/NewsAiCard";

type NewsItem = Awaited<ReturnType<typeof api.getNews>>[number];

type Filt = "all" | "important" | "watch" | "bullish" | "bearish";

type Horizon = "" | "short" | "swing" | "long" | "mixed";

const HORIZON_META: Record<Exclude<Horizon, "">, { label: string; color: string; desc: string }> = {
  short: { label: "短线", color: "var(--accent-orange)", desc: "1-5 日盘面催化" },
  swing: { label: "波段", color: "var(--accent-blue)", desc: "5-20 日驱动" },
  long: { label: "长线", color: "var(--accent-purple)", desc: "6 月+ 产业逻辑" },
  mixed: { label: "复合", color: "var(--text-secondary)", desc: "多时间维度" },
};

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

function filtToAnchor(f: Filt): NewsDialAnchor | null {
  if (f === "all") return "total";
  if (f === "important") return "important";
  if (f === "watch") return "watch";
  if (f === "bullish" || f === "bearish") return "net_sentiment";
  return null;
}

const SENTIMENT_META: Record<NonNullable<NewsItem["sentiment"]>, { label: string; color: string; icon: typeof TrendingUp }> = {
  bullish: { label: "利好", color: "var(--accent-red)", icon: TrendingUp },
  bearish: { label: "利空", color: "var(--accent-green)", icon: TrendingDown },
  neutral: { label: "中性", color: "var(--text-muted)", icon: Minus },
};

function ImportanceStars({ value }: { value: number }) {
  const v = Math.max(0, Math.min(5, value));
  return (
    <span className="inline-flex items-center" title={`重要级 ${v}/5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={9}
          fill={i < v ? "var(--accent-orange)" : "transparent"}
          stroke={i < v ? "var(--accent-orange)" : "var(--border-color)"}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
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

  const openThemeDetail = useUIStore((s) => s.openThemeDetail);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const askAI = useUIStore((s) => s.askAI);

  const fetchNews = async (refresh = false) => {
    setLoading(true);
    try {
      const watchCsv = watch.size > 0 ? Array.from(watch).join(",") : undefined;
      const res = await api.getNews(80, true, {
        hours: 24,
        sort: "smart",
        watch: watchCsv,
        impact_horizon: horizon || undefined,
      });
      setNews(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
    void refresh;
  };

  const fetchBrief = async (refresh = false) => {
    setBriefLoading(true);
    try {
      const b = await api.getNewsBrief({ hours: 24, refresh });
      setBrief(b);
    } catch (e) {
      console.error("[news-brief]", e);
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

  // 1) 首屏加载: brief + 自选 (新闻在 watch 就位后再拉, 走 sort=smart)
  useEffect(() => {
    fetchBrief();
    if (api.isLoggedIn()) {
      api.getWatchlist()
        .then((rows) => setWatch(new Set(rows.map((r) => r.stock_code))))
        .catch(() => setWatch(new Set()));
    } else {
      setWatch(new Set());  // 触发 fetchNews
    }
    return () => {
      if (sseRef.current) {
        try { sseRef.current.close(); } catch { /* noop */ }
        sseRef.current = null;
      }
    };
  }, []);

  // 2) 自选就位 → 拉新闻 (含 smart ranking)
  // watch 是 Set, 用 size+JSON 串触发依赖
  const watchKey = useMemo(() => Array.from(watch).sort().join(","), [watch]);
  const watchInitedRef = useRef(false);
  useEffect(() => {
    if (!watchInitedRef.current) {
      // 第一次 watch 设置 (即使是空 set 也算就位) 后, 才 fetchNews
      watchInitedRef.current = true;
    }
    fetchNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, horizon]);

  const handleRefresh = async () => {
    startStream();             // 先启 SSE 拉打字机 headline
    await Promise.all([fetchNews(true), fetchBrief(true)]);
  };

  const decorated = useMemo(() => {
    const base = searchResults != null ? searchResults : news;
    return base.map((it) => {
      const watchHit = (it.rel_codes || []).some((c) => watch.has(c));
      return { ...it, _watchHit: watchHit };
    });
  }, [news, searchResults, watch]);

  const filtered = useMemo(() => {
    // 检索模式: 按相关度 (后端返回顺序), 跳过本地 filt/focus
    if (searchResults != null) return decorated;
    let arr = decorated;
    if (focus) {
      arr = arr.filter((it) => it.id != null && focus.ids.has(it.id as number));
    } else {
      if (filt === "important") arr = arr.filter((it) => (it.importance || 0) >= 3);
      else if (filt === "watch") arr = arr.filter((it) => it._watchHit);
      else if (filt === "bullish") arr = arr.filter((it) => it.sentiment === "bullish");
      else if (filt === "bearish") arr = arr.filter((it) => it.sentiment === "bearish");
    }
    return arr.slice().sort((a, b) => {
      if (a._watchHit !== b._watchHit) return a._watchHit ? -1 : 1;
      return (b.importance || 0) - (a.importance || 0);
    });
  }, [decorated, filt, focus, searchResults]);

  const counts = useMemo(() => {
    return {
      all: decorated.length,
      important: decorated.filter((i) => (i.importance || 0) >= 3).length,
      watch: decorated.filter((i) => i._watchHit).length,
      bullish: decorated.filter((i) => i.sentiment === "bullish").length,
      bearish: decorated.filter((i) => i.sentiment === "bearish").length,
    };
  }, [decorated]);

  const subtitle = decorated.length > 0
    ? `${decorated.length} 条 · ${brief?.model || "AI"} 已总结 · 命中自选 ${counts.watch}`
    : undefined;

  const handleDialClick = (anchor: NewsDialAnchor) => {
    setFocus(null);  // 清掉 main_thread 聚焦
    if (anchor === "total") setFilt("all");
    else if (anchor === "important") setFilt((p) => (p === "important" ? "all" : "important"));
    else if (anchor === "watch") setFilt((p) => (p === "watch" ? "all" : "watch"));
    else if (anchor === "net_sentiment") {
      const tilt = counts.bullish >= counts.bearish ? "bullish" : "bearish";
      setFilt((p) => (p === tilt ? "all" : tilt));
    }
  };

  const handleThreadClick = (t: NewsBriefThread) => {
    if (focus?.kind === "thread" && focus.name === t.name) {
      setFocus(null);
      return;
    }
    setFilt("all");
    setFocus({ kind: "thread", name: t.name, ids: new Set(t.news_ids) });
  };

  const handleBucketClick = (kind: "policy" | "shock" | "earnings", b: NewsBriefBucket) => {
    if (focus?.kind === kind && areSetsEqual(focus.ids, new Set(b.news_ids))) {
      setFocus(null);
      return;
    }
    setFilt("all");
    setFocus({ kind, ids: new Set(b.news_ids) });
  };

  const activeAnchor = filtToAnchor(filt);
  const focusLabel = focus?.kind === "thread"
    ? `主线: ${focus.name}`
    : focus?.kind === "policy" ? "政策聚焦"
    : focus?.kind === "shock" ? "突发风险聚焦"
    : focus?.kind === "earnings" ? "业绩/公告聚焦"
    : null;

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

        <div
          className="flex items-center gap-1 px-2 py-1.5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
            opacity: searchResults != null ? 0.45 : 1,
            pointerEvents: searchResults != null ? "none" : "auto",
          }}
          title={searchResults != null ? "检索模式下,本地筛选已停用" : undefined}
        >
          <Filter size={11} style={{ color: "var(--text-muted)" }} />
          <FilterChip active={!focus && filt === "all"} onClick={() => { setFocus(null); setFilt("all"); }} label={`全部 ${counts.all}`} />
          <FilterChip active={!focus && filt === "important"} onClick={() => { setFocus(null); setFilt("important"); }} label={`重磅 ${counts.important}`} icon="⭐" />
          <FilterChip active={!focus && filt === "watch"} onClick={() => { setFocus(null); setFilt("watch"); }} label={`命中自选 ${counts.watch}`} accent="orange" />
          <FilterChip active={!focus && filt === "bullish"} onClick={() => { setFocus(null); setFilt("bullish"); }} label={`利好 ${counts.bullish}`} accent="red" />
          <FilterChip active={!focus && filt === "bearish"} onClick={() => { setFocus(null); setFilt("bearish"); }} label={`利空 ${counts.bearish}`} accent="green" />
          {focus && focusLabel && (
            <FilterChip
              active={true}
              onClick={() => setFocus(null)}
              label={`${focusLabel} (${filtered.length}) ✕`}
              accent="orange"
            />
          )}
          <span className="ml-auto flex items-center gap-1" style={{ fontSize: 10, color: "var(--text-muted)" }}>
            <Sparkles size={9} style={{ color: "var(--accent-purple)" }} />
            点 AI 主线下钻
          </span>
        </div>

        {/* Phase 2: 影响时间维度过滤 (impact_horizon) - 给短/中/长视角投资者用 */}
        <div
          className="flex items-center gap-1 px-2 py-1.5 mt-1.5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
            opacity: searchResults != null ? 0.45 : 1,
            pointerEvents: searchResults != null ? "none" : "auto",
          }}
          title="按 AI 判定的「影响时间维度」过滤新闻"
        >
          <span style={{ fontSize: 10, color: "var(--text-muted)", marginRight: 4 }}>视角</span>
          <FilterChip
            active={horizon === ""}
            onClick={() => setHorizon("")}
            label="全部"
          />
          {(["short", "swing", "long", "mixed"] as const).map((h) => {
            const meta = HORIZON_META[h];
            return (
              <button
                key={h}
                onClick={() => setHorizon(horizon === h ? "" : h)}
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
            {horizon === "" ? "适合所有投资者" : HORIZON_META[horizon].desc}
          </span>
        </div>
      </div>

      <div className="px-3 pb-3 space-y-1">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse"
              style={{ background: "var(--bg-card)" }}
            />
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
          filtered.map((item, i) => {
            const sent = item.sentiment ? SENTIMENT_META[item.sentiment] : null;
            const SentIcon = sent?.icon;
            const themesArr = item.themes || item.related_concepts || [];
            return (
              <div
                key={`${item.id ?? item.pub_time}-${i}`}
                id={item.id != null ? `news-item-${item.id}` : undefined}
                className="px-3 py-2"
                style={{
                  background: item._watchHit ? "rgba(245,158,11,0.06)" : "var(--bg-card)",
                  border: item._watchHit ? "1px solid rgba(245,158,11,0.4)" : "1px solid var(--border-color)",
                  borderRadius: 4,
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      {item.source && (
                        <span
                          style={{
                            padding: "1px 5px",
                            background: "var(--bg-tertiary)",
                            color: "var(--text-muted)",
                            fontSize: 10,
                            borderRadius: 2,
                            border: "1px solid var(--border-color)",
                          }}
                          title="新闻源"
                        >
                          {item.source}
                        </span>
                      )}
                      {item._watchHit && (
                        <span
                          className="flex items-center gap-0.5 font-bold"
                          style={{
                            padding: "1px 5px",
                            background: "var(--accent-orange)",
                            color: "#1a1d28",
                            fontSize: 10,
                            borderRadius: 2,
                          }}
                          title="命中你的自选股"
                        >
                          <Star size={9} fill="#1a1d28" />
                          自选
                        </span>
                      )}
                      {sent && SentIcon && (
                        <span
                          className="flex items-center gap-0.5 font-bold"
                          style={{
                            padding: "1px 5px",
                            background: sent.color === "var(--text-muted)" ? "var(--bg-tertiary)" : "transparent",
                            border: `1px solid ${sent.color}`,
                            color: sent.color,
                            fontSize: 10,
                            borderRadius: 2,
                          }}
                        >
                          <SentIcon size={9} />
                          {sent.label}
                        </span>
                      )}
                      {item.impact_horizon && HORIZON_META[item.impact_horizon] && (
                        <span
                          className="font-bold"
                          style={{
                            padding: "1px 5px",
                            background: `${HORIZON_META[item.impact_horizon].color}22`,
                            border: `1px solid ${HORIZON_META[item.impact_horizon].color}`,
                            color: HORIZON_META[item.impact_horizon].color,
                            fontSize: 10,
                            borderRadius: 2,
                          }}
                          title={HORIZON_META[item.impact_horizon].desc}
                        >
                          {HORIZON_META[item.impact_horizon].label}
                        </span>
                      )}
                      {item.tags && item.tags.length > 0 && item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="font-semibold"
                          style={{
                            padding: "1px 5px",
                            background: "rgba(168,85,247,0.14)",
                            color: "var(--accent-purple)",
                            fontSize: 10,
                            borderRadius: 2,
                            border: "1px solid rgba(168,85,247,0.3)",
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                      {(item.importance || 0) > 0 && <ImportanceStars value={item.importance || 0} />}
                    </div>
                    <h3
                      className="font-semibold leading-snug"
                      style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
                    >
                      {item.title}
                    </h3>
                    {item.content && (
                      <p
                        className="mt-1 leading-relaxed line-clamp-2"
                        style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
                      >
                        {item.content}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                      {themesArr.slice(0, 6).map((concept) => (
                        <button
                          key={concept}
                          onClick={() => openThemeDetail(concept)}
                          className="rounded transition-colors"
                          style={{
                            padding: "1px 6px",
                            fontSize: 10,
                            background: "rgba(245,158,11,0.14)",
                            color: "var(--accent-orange)",
                            border: "1px solid rgba(245,158,11,0.3)",
                          }}
                        >
                          {concept}
                        </button>
                      ))}
                      {(item.rel_codes || []).slice(0, 4).map((c) => (
                        <button
                          key={c}
                          onClick={() => openStockDetail(c)}
                          className="rounded transition-colors tabular-nums"
                          style={{
                            padding: "1px 5px",
                            fontSize: 10,
                            background: watch.has(c) ? "rgba(245,158,11,0.18)" : "var(--bg-tertiary)",
                            color: watch.has(c) ? "var(--accent-orange)" : "var(--text-secondary)",
                            border: `1px solid ${watch.has(c) ? "rgba(245,158,11,0.4)" : "var(--border-color)"}`,
                          }}
                          title={watch.has(c) ? "你的自选" : "查看个股"}
                        >
                          {c}
                        </button>
                      ))}
                      <button
                        onClick={() => askAI(`这条新闻: 「${item.title}」\n${item.content || ""}\n\n请帮我判断: (1) 真实利好/利空程度 (2) 涉及哪些 A 股标的最受益/受损 (3) 短线是否值得参与, 给出明日盘前关注点。`)}
                        className="ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors"
                        style={{
                          fontSize: 10,
                          background: "rgba(168,85,247,0.12)",
                          color: "var(--accent-purple)",
                          border: "1px solid rgba(168,85,247,0.3)",
                        }}
                        title="让 AI 拆这条新闻"
                      >
                        <Zap size={9} />
                        问AI
                      </button>
                    </div>
                  </div>
                  {item.pub_time && (
                    <span
                      className="whitespace-nowrap flex-shrink-0 tabular-nums"
                      style={{ color: "var(--text-muted)", fontSize: 10 }}
                    >
                      {item.pub_time.slice(5, 16)}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
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

function areSetsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
