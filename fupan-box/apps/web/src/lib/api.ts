import type { AiBrief } from "@/types/ai-brief";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ===== Types =====
export interface TradeCreate {
  trade_date: string;
  code: string;
  name?: string;
  buy_price: number;
  sell_price: number;
  qty: number;
  intraday_chg_at_buy?: number;
  holding_minutes?: number;
  reason?: string;
}

export interface TradeRecord extends TradeCreate {
  id: number;
  pnl: number;
  pnl_pct: number;
  created_at: string;
}

export interface TradePattern {
  days: number;
  trade_count: number;
  win_count: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl_pct: number;
  avg_win_pct?: number;
  avg_loss_pct?: number;
  expectation: number;
  max_win: { code: string; name: string; pnl_pct: number; trade_date: string } | null;
  max_loss: { code: string; name: string; pnl_pct: number; trade_date: string } | null;
  chase_rate: number;
  chase_count?: number;
  avg_holding_min: number | null;
  median_holding_min: number | null;
  mode_label: string;
  mode_desc: string;
}

export interface TierMeta {
  tier: "anonymous" | "free" | "monthly" | "yearly" | string;
  valuation_days_cap: number;
  history_cap: {
    consensus_weeks: number;
    fundamentals_periods: number;
    holders_quarters: number;
    screener_limit: number;
  };
  upgrade_hint: string | null;
}

export interface QuotaUsage {
  tier: string;
  tier_label: string;
  tier_price_rmb: number;
  trade_date: string;
  actions: Array<{
    action: string;
    label: string;
    used: number;
    quota: number;
    remaining: number;
    percent: number;
  }>;
}

export interface TierInfo {
  tier: string;
  tier_label: string;
  price_rmb: number;
  features?: string[];
  quota: Array<{ action: string; label: string; quota: number }>;
}

export type PlanDirection = "buy" | "sell" | "add" | "reduce";
export type PlanStatus = "active" | "triggered" | "executed" | "expired" | "cancelled";
export type PlanConditionType =
  | "price_above"
  | "price_below"
  | "change_pct_above"
  | "change_pct_below"
  | "limit_up"
  | "limit_up_break";

export interface PlanCondition {
  type: PlanConditionType | string;
  value?: number | null;
  label?: string | null;
}

export interface UserPlanRecord {
  id: number;
  code: string;
  name: string | null;
  direction: PlanDirection;
  trigger_conditions: PlanCondition[] | null;
  position_plan: Record<string, unknown> | null;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
  invalid_conditions: PlanCondition[] | null;
  notes: string | null;
  status: PlanStatus;
  first_triggered_at: string | null;
  last_checked_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  triggered_today_count: number;
}

export interface PlanTriggerRecord {
  id: number;
  plan_id: number;
  trade_date: string;
  triggered_at: string;
  condition_idx: number;
  condition_kind: "trigger" | "invalid" | string | null;
  condition_type: string | null;
  condition_label: string | null;
  price: number | null;
  change_pct: number | null;
}

export interface PlanCreatePayload {
  code: string;
  name?: string;
  direction: PlanDirection;
  trigger_conditions: PlanCondition[];
  invalid_conditions?: PlanCondition[];
  position_plan?: Record<string, unknown>;
  stop_loss_pct?: number | null;
  take_profit_pct?: number | null;
  notes?: string | null;
  expires_at?: string | null;
}

export type PlanUpdatePayload = Partial<PlanCreatePayload> & { status?: PlanStatus };

export interface PrivateStatus {
  watchlist: { unlocked: boolean; count: number; codes: string[] };
  plans: {
    unlocked: boolean;
    active: number;
    triggered: number;
    today_triggers: number;
    triggered_codes: string[];
  };
  trades: { unlocked: boolean; count_total: number; count_7d: number };
  ai_track: { unlocked: boolean; verified_7d: number };
}

export interface Anomaly {
  id: number;
  trade_date: string;
  detected_at: string;
  anomaly_type: "surge" | "plunge" | "break" | "seal" | "theme_burst";
  anomaly_label: string;
  code: string | null;
  name: string | null;
  theme: string | null;
  price: number | null;
  change_pct: number | null;
  delta_5m_pct: number | null;
  volume_yi: number | null;
  severity: number;
  ai_brief: string | null;
  seen: boolean;
}

class ApiClient {
  private token: string | null = null;

  /** 给原生 fetch / SSE 用 — 拼完整 URL */
  buildUrl(path: string): string {
    return `${API_BASE}${path}`;
  }

  /** 给原生 fetch / SSE 用 — 拿带 token 的 headers */
  authHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(extra || {}) };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string>),
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (!res.ok) {
      // 401: 匿名访问受保护接口 -> 抛 NotLoggedInError, 调用方应静默处理 (展示登录 CTA 而非弹错误)
      if (res.status === 401) {
        // token 过期: 清掉本地 token, 让 UI 切回匿名态
        if (this.token) {
          this.token = null;
          if (typeof window !== "undefined") localStorage.removeItem("token");
        }
        const err = new Error("requires_login") as Error & { code?: string; status?: number };
        err.code = "REQUIRES_LOGIN";
        err.status = 401;
        throw err;
      }
      // 429: 匿名访问触发限流
      if (res.status === 429) {
        const err = new Error("rate_limited") as Error & { code?: string; status?: number };
        err.code = "RATE_LIMITED";
        err.status = 429;
        throw err;
      }
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `API error: ${res.status}`);
    }
    return res.json();
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: "POST", body: JSON.stringify(body) });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }

  getSnapshotRange(type: string, days = 5) {
    return this.get<Array<{ trade_date: string; data: Record<string, unknown> }>>(
      `/api/snapshot/${type}/range?days=${days}`
    );
  }

  getSentiment(days = 5) {
    return this.get<Array<Record<string, unknown>>>(`/api/market/sentiment?days=${days}`);
  }

  async login(username: string, password: string) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || "登录失败");
    }
    const data = await res.json();
    this.token = data.access_token;
    if (typeof window !== "undefined") localStorage.setItem("token", data.access_token);
    return data;
  }

  async register(username: string, email: string, password: string) {
    const data = await this.post<{ access_token: string }>("/api/auth/register", { username, email, password });
    this.token = data.access_token;
    if (typeof window !== "undefined") localStorage.setItem("token", data.access_token);
    return data;
  }

  restoreToken() {
    if (typeof window !== "undefined") {
      const t = localStorage.getItem("token");
      if (t) this.token = t;
    }
  }

  logout() {
    this.token = null;
    if (typeof window !== "undefined") localStorage.removeItem("token");
  }

  isLoggedIn() {
    return !!this.token;
  }

  getWatchlist() {
    return this.get<Array<{ id: number; stock_code: string; note: string | null; ai_reason: string | null; created_at: string }>>("/api/watchlist/");
  }

  addToWatchlist(stock_code: string, note?: string) {
    return this.post<{ id: number; stock_code: string }>("/api/watchlist/", { stock_code, note });
  }

  removeFromWatchlist(stock_code: string) {
    return this.delete(`/api/watchlist/${stock_code}`);
  }

  searchStocks(q: string) {
    return this.get<Array<Record<string, unknown>>>(`/api/market/search?q=${encodeURIComponent(q)}`);
  }

  getNews(count = 50, enrich = true, params?: {
    hours?: number;
    min_importance?: number;
    sources?: string;
    sentiment?: "bullish" | "neutral" | "bearish";
    impact_horizon?: "short" | "swing" | "long" | "mixed";
    code?: string;
    theme?: string;
    sort?: "default" | "time" | "smart";
    watch?: string;        // sort=smart: 自选股代码列表(逗号分隔)
    hot_themes?: string;   // sort=smart: 当前热点题材
    debug_score?: boolean;
  }) {
    void enrich; // 兼容旧签名: 后端总是返回打标后字段
    const sp = new URLSearchParams();
    sp.set("count", String(count));
    if (params?.hours) sp.set("hours", String(params.hours));
    if (params?.min_importance) sp.set("min_importance", String(params.min_importance));
    if (params?.sources) sp.set("sources", params.sources);
    if (params?.sentiment) sp.set("sentiment", params.sentiment);
    if (params?.impact_horizon) sp.set("impact_horizon", params.impact_horizon);
    if (params?.code) sp.set("code", params.code);
    if (params?.theme) sp.set("theme", params.theme);
    if (params?.sort) sp.set("sort", params.sort);
    if (params?.watch) sp.set("watch", params.watch);
    if (params?.hot_themes) sp.set("hot_themes", params.hot_themes);
    if (params?.debug_score) sp.set("debug_score", "1");
    return this.get<Array<{
      id?: number;
      title: string;
      content: string;
      pub_time: string;
      source?: string;
      source_url?: string | null;
      source_urls?: Record<string, string>;
      related_concepts?: string[];
      tags?: string[];
      themes?: string[];
      rel_codes?: string[];
      raw_tags?: string[];
      importance?: number;
      sentiment?: "bullish" | "neutral" | "bearish";
      impact_horizon?: "short" | "swing" | "long" | "mixed";
    }>>(`/api/market/news?${sp.toString()}`);
  }

  getNewsBrief(opts?: { tradeDate?: string; hours?: number; refresh?: boolean }) {
    const sp = new URLSearchParams();
    if (opts?.tradeDate) sp.set("trade_date", opts.tradeDate);
    if (opts?.hours) sp.set("hours", String(opts.hours));
    if (opts?.refresh) sp.set("refresh", "1");
    const q = sp.toString();
    return this.get<{
      trade_date: string;
      generated_at: string;
      model: string;
      stats: { total: number; important: number; bullish: number; bearish: number; neutral: number; watch: number };
      headline: string;
      main_threads: Array<{
        name: string;
        summary: string;
        themes?: string[];
        stock_codes: string[];
        news_ids: number[];
        sentiment: "bullish" | "neutral" | "bearish";
      }>;
      policy: Array<{ summary: string; news_ids: number[] }>;
      shock: Array<{ summary: string; news_ids: number[] }>;
      earnings: Array<{ summary: string; news_ids: number[] }>;
      tomorrow_brief: string;
      watchlist_alerts?: Array<{
        news_id: number; title: string; codes: string[];
        importance: number; sentiment: string; pub_time: string;
      }>;
    }>(`/api/ai/news-brief${q ? `?${q}` : ""}`);
  }

  newsBriefStreamUrl(opts?: { tradeDate?: string; hours?: number }) {
    const sp = new URLSearchParams();
    if (opts?.tradeDate) sp.set("trade_date", opts.tradeDate);
    if (opts?.hours) sp.set("hours", String(opts.hours));
    return `${API_BASE}/api/ai/news-brief/stream${sp.toString() ? `?${sp.toString()}` : ""}`;
  }

  // ===== Phase 4 RAG =====

  searchNews(opts: {
    q: string;
    limit?: number;
    hours?: number;
    min_importance?: number;
    sentiment?: "bullish" | "neutral" | "bearish";
    code?: string;
    theme?: string;
  }) {
    const sp = new URLSearchParams();
    sp.set("q", opts.q);
    if (opts.limit) sp.set("limit", String(opts.limit));
    if (opts.hours) sp.set("hours", String(opts.hours));
    if (opts.min_importance) sp.set("min_importance", String(opts.min_importance));
    if (opts.sentiment) sp.set("sentiment", opts.sentiment);
    if (opts.code) sp.set("code", opts.code);
    if (opts.theme) sp.set("theme", opts.theme);
    return this.get<Array<{
      id: number;
      title: string;
      content: string;
      pub_time: string;
      source?: string;
      sentiment?: "bullish" | "neutral" | "bearish";
      importance?: number;
      tags?: string[];
      themes?: string[];
      rel_codes?: string[];
      _distance: number;
      _score: number;
    }>>(`/api/news/search?${sp.toString()}`);
  }

  getStockNewsTimeline(code: string, days = 30, limit = 80) {
    const sp = new URLSearchParams({ code, days: String(days), limit: String(limit) });
    return this.get<{
      code: string; days: number; count: number;
      items: Array<{
        id: number; title: string; content: string; pub_time: string;
        source?: string; importance?: number; sentiment?: "bullish" | "neutral" | "bearish";
        themes?: string[]; rel_codes?: string[]; tags?: string[];
      }>;
    }>(`/api/news/timeline?${sp.toString()}`);
  }

  getThemeNewsTimeline(theme: string, days = 30, limit = 80) {
    const sp = new URLSearchParams({ theme, days: String(days), limit: String(limit) });
    return this.get<{
      theme: string; days: number; count: number;
      items: Array<{
        id: number; title: string; content: string; pub_time: string;
        source?: string; importance?: number; sentiment?: "bullish" | "neutral" | "bearish";
        themes?: string[]; rel_codes?: string[]; tags?: string[];
      }>;
    }>(`/api/news/theme-timeline?${sp.toString()}`);
  }

  getNewsDetail(newsId: number, related = 5) {
    return this.get<{
      detail: {
        id: number; title: string; content: string; pub_time: string;
        source?: string; importance?: number; sentiment?: "bullish" | "neutral" | "bearish";
        themes?: string[]; rel_codes?: string[]; tags?: string[]; source_urls?: Record<string, string>;
      };
      related: Array<{ id: number; title: string; pub_time: string; _distance: number; importance?: number; sentiment?: string }>;
    }>(`/api/news/${newsId}?related=${related}`);
  }

  /** 个人化新闻速报 (MyDigestFloating 浮窗用). 围绕用户自选股, 三段加权排序. */
  getMyNewsDigest(opts?: { hours?: number; topK?: number }) {
    const sp = new URLSearchParams();
    if (opts?.hours) sp.set("hours", String(opts.hours));
    if (opts?.topK) sp.set("top_k", String(opts.topK));
    const q = sp.toString();
    return this.get<{
      generated_at: string;
      hours: number;
      watch_count: number;
      stats: {
        total: number;
        important: number;
        bullish: number;
        bearish: number;
        neutral: number;
        watch_hits: number;
      };
      items: Array<{
        id: number;
        title: string;
        source?: string;
        sentiment?: "bullish" | "neutral" | "bearish";
        importance: number;
        pub_time: string;
        rel_codes: string[];
        themes: string[];
        watch_codes_hit: string[];
        score?: number;
      }>;
    }>(`/api/me/news-digest${q ? `?${q}` : ""}`);
  }

  getThemeDetail(name: string) {
    return this.get<Record<string, unknown>>(`/api/market/theme-detail?name=${encodeURIComponent(name)}`);
  }

  getStockDetail(code: string) {
    return this.get<Record<string, unknown>>(`/api/market/stock-detail?code=${encodeURIComponent(code)}`);
  }

  getLadderTrack(days = 8) {
    return this.get<{ dates: string[]; stocks: Array<Record<string, unknown>> }>(
      `/api/market/ladder-track?days=${days}`
    );
  }

  getAllBoards(kind: "concept" | "industry") {
    return this.get<{
      kind: string;
      groups: Array<{ letter: string; items: Array<{ name: string; code: string; change_pct: number }> }>;
    }>(`/api/market/all-boards?kind=${kind}`);
  }

  getStrongStocksGrid(scope: string = "recent", days = 8, rows = 5) {
    return this.get<{
      dates: string[];
      rows: number;
      cells: Record<string, Array<Record<string, unknown>>>;
    }>(`/api/market/strong-stocks-grid?scope=${scope}&days=${days}&rows=${rows}`);
  }

  getLhbOfficeHistory(exalter: string, days = 30) {
    return this.get<{
      exalter: string;
      days: number;
      appearance: number;
      total_buy: number;
      total_sell: number;
      total_net_buy: number;
      records: Array<{
        trade_date: string;
        stock_code: string;
        stock_name: string;
        pct_change: number;
        side: number;
        buy: number;
        sell: number;
        net_buy: number;
        reason: string;
      }>;
    }>(`/api/snapshot/lhb/office-history?exalter=${encodeURIComponent(exalter)}&days=${days}`);
  }

  getLhbHotMoney(days = 30, limit = 50) {
    return this.get<{
      days: number;
      limit: number;
      rank: Array<{
        exalter: string;
        days_active: number;
        appearance: number;
        buy_total: number;
        sell_total: number;
        net_buy_total: number;
        stock_count: number;
      }>;
    }>(`/api/snapshot/lhb/hot-money?days=${days}&limit=${limit}`);
  }

  getAiModels() {
    return this.get<Array<{ id: string; name: string; provider: string; tag: string }>>("/api/ai/models");
  }

  getAiBrief(tradeDate?: string) {
    const q = tradeDate ? `?trade_date=${tradeDate}` : "";
    return this.get<AiBrief>(`/api/ai/brief${q}`);
  }

  postFeedback(payload: {
    brief_kind: "today" | "sentiment" | "theme" | "ladder" | "lhb" | "news" | "capital" | "institutional";
    trade_date: string;
    rating: 1 | -1;
    model?: string | null;
    reason?: string | null;
    evidence_correct?: boolean | null;
    snapshot?: Record<string, unknown> | null;
  }) {
    return this.post<{ ok: boolean; id: number; created_at: string }>(
      "/api/ai/feedback",
      payload,
    );
  }

  getFeedbackStats(days = 30) {
    return this.get<{
      days: number;
      by_kind: Record<string, {
        up: number; down: number; total: number;
        evidence_yes: number; evidence_no: number;
        up_rate: number; evidence_correct_rate: number | null;
      }>;
      overall: {
        total: number; up: number; down: number;
        up_rate: number; evidence_correct_rate: number | null;
      };
      recent: Array<{
        kind: string; rating: number; trade_date: string;
        model: string | null; reason: string | null;
        evidence_correct: boolean | null; headline: string | null;
        created_at: string;
      }>;
    }>(`/api/ai/feedback/stats?days=${days}`);
  }

  getThemeBriefSummary(tradeDate?: string) {
    const q = tradeDate ? `?trade_date=${tradeDate}` : "";
    return this.get<{
      trade_date: string;
      generated_at: string;
      model: string;
      leading: Array<{ name: string; ai_note: string }>;
      fading: Array<{ name: string; ai_note: string }>;
      emerging: Array<{ name: string; ai_note: string }>;
    }>(`/api/ai/theme-brief${q}`);
  }

  getWatchlistBrief(tradeDate?: string, refresh = false) {
    const params = new URLSearchParams();
    if (tradeDate) params.set("trade_date", tradeDate);
    if (refresh) params.set("refresh", "1");
    const q = params.toString() ? `?${params.toString()}` : "";
    return this.get<{
      trade_date: string;
      model: string;
      stocks_count: number;
      found: number;
      headline: string;
      focus: { code: string; reason: string };
      summary: {
        total: number;
        found: number;
        missing: number;
        limit_up: number;
        limit_down: number;
        avg_change_pct: number | null;
        winners: Array<{ code: string; name: string; change_pct: number }>;
        losers: Array<{ code: string; name: string; change_pct: number }>;
      };
      per_stock: Array<{ code: string; tag: string; note: string }>;
      evidence: string[];
    }>(`/api/ai/watchlist-brief${q}`);
  }

  getLadderBrief(tradeDate?: string, refresh = false) {
    const params = new URLSearchParams();
    if (tradeDate) params.set("trade_date", tradeDate);
    if (refresh) params.set("refresh", "1");
    const q = params.toString() ? `?${params}` : "";
    return this.get<{
      trade_date: string;
      generated_at: string;
      model: string;
      headline: string;
      structure: Array<{ label: string; text: string }>;
      key_stocks: Array<{ code: string; name: string; board: number; tag: string; note: string }>;
      evidence?: string[];
    }>(`/api/ai/ladder-brief${q}`);
  }

  getSentimentBrief(tradeDate?: string, refresh = false) {
    const params = new URLSearchParams();
    if (tradeDate) params.set("trade_date", tradeDate);
    if (refresh) params.set("refresh", "1");
    const q = params.toString() ? `?${params}` : "";
    return this.get<Record<string, unknown>>(`/api/ai/sentiment-brief${q}`);
  }

  getThemeBrief(tradeDate?: string, refresh = false, perspective: "short" | "swing" | "long" = "short") {
    const params = new URLSearchParams();
    if (tradeDate) params.set("trade_date", tradeDate);
    if (refresh) params.set("refresh", "1");
    if (perspective !== "short") params.set("perspective", perspective);
    const q = params.toString() ? `?${params}` : "";
    return this.get<Record<string, unknown>>(`/api/ai/theme-brief${q}`);
  }

  getLhbBrief(tradeDate?: string, refresh = false) {
    const params = new URLSearchParams();
    if (tradeDate) params.set("trade_date", tradeDate);
    if (refresh) params.set("refresh", "1");
    const q = params.toString() ? `?${params}` : "";
    return this.get<Record<string, unknown>>(`/api/ai/lhb-brief${q}`);
  }

  getCapitalBrief(tradeDate?: string, refresh = false) {
    const params = new URLSearchParams();
    if (tradeDate) params.set("trade_date", tradeDate);
    if (refresh) params.set("refresh", "1");
    const q = params.toString() ? `?${params}` : "";
    return this.get<Record<string, unknown>>(`/api/ai/capital-brief${q}`);
  }

  getInstitutionalBrief(tradeDate?: string, refresh = false) {
    const params = new URLSearchParams();
    if (tradeDate) params.set("trade_date", tradeDate);
    if (refresh) params.set("refresh", "1");
    const q = params.toString() ? `?${params}` : "";
    return this.get<Record<string, unknown>>(`/api/ai/institutional-brief${q}`);
  }

  // ===== L3a Capital module =====
  getCapitalMarket(tradeDate?: string) {
    const q = tradeDate ? `?trade_date=${tradeDate}` : "";
    return this.get<Record<string, unknown>>(`/api/market/capital/market${q}`);
  }

  getCapitalNorth(days = 30) {
    return this.get<{ items: Array<Record<string, unknown>> }>(
      `/api/market/capital/north?days=${days}`,
    );
  }

  getCapitalNorthHolds(tradeDate?: string, top = 50) {
    const params = new URLSearchParams({ top: String(top) });
    if (tradeDate) params.set("trade_date", tradeDate);
    return this.get<{ items: Array<Record<string, unknown>> }>(
      `/api/market/capital/north/holds?${params}`,
    );
  }

  getCapitalConcept(tradeDate?: string, top = 30) {
    const params = new URLSearchParams({ top: String(top) });
    if (tradeDate) params.set("trade_date", tradeDate);
    return this.get<{ items: Array<Record<string, unknown>> }>(
      `/api/market/capital/concept?${params}`,
    );
  }

  getCapitalIndustry(tradeDate?: string, top = 30) {
    const params = new URLSearchParams({ top: String(top) });
    if (tradeDate) params.set("trade_date", tradeDate);
    return this.get<{ items: Array<Record<string, unknown>> }>(
      `/api/market/capital/industry?${params}`,
    );
  }

  getCapitalStockRank(
    tradeDate?: string,
    top = 50,
    direction: "inflow" | "outflow" = "inflow",
  ) {
    const params = new URLSearchParams({ top: String(top), direction });
    if (tradeDate) params.set("trade_date", tradeDate);
    return this.get<{ items: Array<Record<string, unknown>> }>(
      `/api/market/capital/stock-rank?${params}`,
    );
  }

  getCapitalLimitOrder(tradeDate?: string) {
    // 后端按 (题材+行业) 混合归集, 不区分 by; UI 也只展示一个聚合.
    const params = new URLSearchParams();
    if (tradeDate) params.set("trade_date", tradeDate);
    const q = params.toString() ? `?${params}` : "";
    return this.get<{ items: Array<Record<string, unknown>> }>(
      `/api/market/capital/limit-order${q}`,
    );
  }

  getCapitalEtf(tradeDate?: string, category?: string) {
    const params = new URLSearchParams();
    if (tradeDate) params.set("trade_date", tradeDate);
    if (category) params.set("category", category);
    const q = params.toString() ? `?${params}` : "";
    return this.get<{ items: Array<Record<string, unknown>> }>(`/api/market/capital/etf${q}`);
  }

  getCapitalAnnounce(eventType?: string, days = 14, top = 100) {
    const params = new URLSearchParams({ days: String(days), top: String(top) });
    if (eventType) params.set("event_type", eventType);
    return this.get<{ items: Array<Record<string, unknown>> }>(
      `/api/market/capital/announce?${params}`,
    );
  }

  getCapitalHolders(reportDate?: string, holderType?: string, top = 100) {
    const params = new URLSearchParams({ top: String(top) });
    if (reportDate) params.set("report_date", reportDate);
    if (holderType) params.set("holder_type", holderType);
    return this.get<{ items: Array<Record<string, unknown>> }>(
      `/api/market/capital/holders?${params}`,
    );
  }

  getCapitalMovements(
    canonicalName?: string,
    top = 100,
    changeType: "new" | "add" | "cut" | "exit" | "unchanged" = "add",
    reportDate?: string,
  ) {
    // 后端按 report_date(季度快照) + canonical/change_type 过滤, 没有 days 概念.
    const params = new URLSearchParams({ top: String(top), change_type: changeType });
    if (canonicalName) params.set("canonical", canonicalName);
    if (reportDate) params.set("report_date", reportDate);
    return this.get<{ items: Array<Record<string, unknown>> }>(
      `/api/market/capital/movements?${params}`,
    );
  }

  getCapitalSummary(tradeDate?: string) {
    const q = tradeDate ? `?trade_date=${tradeDate}` : "";
    return this.get<Record<string, unknown>>(`/api/market/capital/summary${q}`);
  }

  getStockContext(code: string) {
    return this.get<Record<string, unknown>>(
      `/api/stock/context/${encodeURIComponent(code)}`,
    );
  }

  getStockContextBatch(codes: string[]) {
    return this.post<Record<string, Record<string, unknown>>>(`/api/stock/context/batch`, {
      codes,
    });
  }

  getWhyRose(code: string, tradeDate?: string, refresh = false) {
    const params = new URLSearchParams({ code });
    if (tradeDate) params.set("trade_date", tradeDate);
    if (refresh) params.set("refresh", "1");
    return this.get<{
      code: string;
      name: string;
      trade_date: string;
      generated_at: string;
      model: string;
      direction: "rose" | "fell" | "unknown";
      headline: string;
      drivers: Array<{ label: string; text: string; news_ids?: number[] }>;
      position: { label: string; text: string };
      height: { label: string; text: string };
      tomorrow: { label: string; text: string };
      verdict: "S" | "A" | "B" | "C";
      verdict_label: string;
      news_refs?: Array<{
        id: number;
        title: string;
        sentiment?: "bullish" | "neutral" | "bearish" | null;
        importance?: number;
        pub_time?: string | null;
        match?: "code" | "theme";
      }>;
    }>(`/api/ai/why-rose?${params.toString()}`);
  }

  getDebate(
    topicType: "market" | "stock" | "theme" = "market",
    topicKey?: string,
    tradeDate?: string,
    refresh = false,
  ) {
    const params = new URLSearchParams({ topic_type: topicType });
    if (topicKey) params.set("topic_key", topicKey);
    if (tradeDate) params.set("trade_date", tradeDate);
    if (refresh) params.set("refresh", "1");
    return this.get<{
      topic_type: "market" | "stock" | "theme";
      topic_key: string | null;
      topic_label: string;
      trade_date: string;
      model: string;
      bull: {
        headline: string;
        reasons: Array<{ label: string; text: string }>;
        trigger: string;
        confidence: number;
      };
      bear: {
        headline: string;
        reasons: Array<{ label: string; text: string }>;
        trigger: string;
        confidence: number;
      };
      judge: {
        verdict: "看多" | "看空" | "分歧" | "观望";
        winner_side: "bull" | "bear" | "tie";
        win_margin: number;
        summary: string;
        key_variable: string;
        next_step: string;
      };
    }>(`/api/ai/debate?${params.toString()}`);
  }

  getAiTrackStats(days = 30) {
    return this.get<{
      window_days: number;
      from_date: string;
      to_date: string;
      overall: { verified: number; hits: number; hit_rate: number | null };
      by_kind: Record<
        string,
        {
          total: number;
          verified: number;
          hits: number;
          hit_rate: number | null;
          avg_score: number | null;
        }
      >;
      recent: Array<{
        trade_date: string;
        kind: string;
        key: string;
        model: string;
        payload: Record<string, unknown>;
        verify_payload: Record<string, unknown> | null;
        hit: boolean | null;
        score: number | null;
        verified_at: string | null;
      }>;
    }>(`/api/ai/track/stats?days=${days}`);
  }

  triggerAiTrackVerify(horizon = 3) {
    return this.post<{
      checked: number;
      hit: number;
      miss: number;
      skip: number;
    }>(`/api/ai/track/verify?horizon=${horizon}`, {});
  }

  // ===== P0 我的交易复盘 =====
  listTrades(days = 30) {
    return this.get<Array<TradeRecord>>(`/api/trades/?days=${days}`);
  }

  createTrade(t: TradeCreate) {
    return this.post<TradeRecord>("/api/trades/", t);
  }

  deleteTrade(id: number) {
    return this.delete<{ ok: boolean }>(`/api/trades/${id}`);
  }

  getTradePattern(days = 30) {
    return this.get<TradePattern>(`/api/trades/pattern?days=${days}`);
  }

  getTradeAiReview(days = 30, model = "deepseek-v3") {
    return this.post<{
      pattern: TradePattern;
      review: {
        mode_label: string;
        summary: string;
        strengths: Array<{ label: string; text: string }>;
        weaknesses: Array<{ label: string; text: string }>;
        suggestions: Array<{ label: string; text: string }>;
        model: string;
      };
    }>(`/api/trades/ai-review?days=${days}&model=${model}`, {});
  }

  // ===== P1 商业化分层 + 配额 =====
  getQuotaUsage() {
    return this.get<QuotaUsage>("/api/quota/usage");
  }

  getTiers() {
    return this.get<TierInfo[]>("/api/quota/tiers");
  }

  // ===== P2 盘中异动 =====
  listAnomalies(limit = 50, minSeverity = 1) {
    return this.get<Anomaly[]>(`/api/intraday/anomalies?limit=${limit}&min_severity=${minSeverity}`);
  }

  getAnomalyUnseenCount() {
    return this.get<{ trade_date: string; unseen: number }>("/api/intraday/anomalies/unseen-count");
  }

  getAnomalyDetail(id: number, refresh = false) {
    return this.get<Anomaly & { context?: Record<string, unknown> }>(
      `/api/intraday/anomalies/${id}${refresh ? "?refresh_brief=1" : ""}`
    );
  }

  markAnomaliesSeen(ids?: number[], allToday = false) {
    return this.post<{ ok: boolean }>("/api/intraday/anomalies/seen", { ids, all_today: allToday });
  }

  // ===== P0 我的计划池 =====
  listPlans(params?: { status?: PlanStatus; code?: string }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.code) qs.set("code", params.code);
    const q = qs.toString() ? `?${qs.toString()}` : "";
    return this.get<UserPlanRecord[]>(`/api/plans/${q}`);
  }

  getPlanDetail(id: number) {
    return this.get<{ plan: UserPlanRecord; triggers: PlanTriggerRecord[] }>(
      `/api/plans/${id}`,
    );
  }

  createPlan(payload: PlanCreatePayload) {
    return this.post<UserPlanRecord>("/api/plans/", payload);
  }

  updatePlan(id: number, payload: PlanUpdatePayload) {
    return this.request<UserPlanRecord>(`/api/plans/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  deletePlan(id: number) {
    return this.delete<{ ok: boolean }>(`/api/plans/${id}`);
  }

  getPlanBadge() {
    return this.get<{
      active: number;
      triggered: number;
      today_triggers: number;
      triggered_codes: string[];
    }>("/api/plans/badge");
  }

  getPlanTriggersToday() {
    return this.get<PlanTriggerRecord[]>("/api/plans/triggers/today");
  }

  triggerPlanCheckNow() {
    return this.post<{ status: string; checked: number; new_triggers: number; new_invalids: number; plans_status_changed: number }>(
      "/api/plans/check-triggers",
      {},
    );
  }

  // 私人维度聚合 — 给 Sidebar 解锁判断 + MyDigestFloating 用
  getPrivateStatus() {
    return this.get<PrivateStatus>("/api/me/private-status");
  }

  getDataHealth() {
    return this.get<{
      status: "ok" | "stale" | "partial" | "empty";
      latest_trade_date: string | null;
      today: string;
      today_ready: boolean;
      ready: boolean;
      snapshot_types: string[];
      missing: string[];
      last_pipeline: {
        trade_date: string | null;
        finished_at: string | null;
        records_count: number;
      } | null;
      last_failure: {
        trade_date: string;
        step: string;
        started_at: string;
        error_message: string | null;
      } | null;
      stale_minutes: number | null;
    }>(`/api/snapshot/status/health`);
  }

  // ===== Phase 2/3: 中长视角 (Mid-Long Perspective) =====

  /** 个股近 N 季度财务指标 + 业绩预告事件 */
  getMidlongFundamentals(code: string, periods = 8) {
    return this.get<{
      stock_code: string;
      quarterly: Array<{
        report_date: string;
        revenue: number | null;
        revenue_yoy: number | null;
        net_profit: number | null;
        net_profit_yoy: number | null;
        gross_margin: number | null;
        net_margin: number | null;
        roe: number | null;
        roa: number | null;
        debt_ratio: number | null;
        eps: number | null;
        bps: number | null;
        ann_date: string | null;
      }>;
      forecast: Array<{
        ann_date: string;
        period: string;
        type: string;
        nature: string | null;
        change_pct_low: number | null;
        change_pct_high: number | null;
        summary: string | null;
      }>;
      count: number;
      tier_meta?: TierMeta;
    }>(`/api/midlong/fundamentals/${code}?periods=${periods}`);
  }

  /** 个股估值时序 + 5y/3y 分位 */
  getMidlongValuation(code: string, days = 250) {
    return this.get<{
      stock_code: string;
      series: Array<{
        trade_date: string;
        pe: number | null;
        pe_ttm: number | null;
        pb: number | null;
        ps_ttm: number | null;
        dv_ttm: number | null;
        total_mv: number | null;
        circ_mv: number | null;
      }>;
      latest: {
        trade_date: string;
        pe: number | null;
        pe_ttm: number | null;
        pb: number | null;
        ps_ttm: number | null;
        dv_ttm: number | null;
        pe_pct_5y: number | null;
        pe_pct_3y: number | null;
        pb_pct_5y: number | null;
        pb_pct_3y: number | null;
        total_mv: number | null;
        circ_mv: number | null;
      } | null;
      count: number;
      tier_meta?: TierMeta;
    }>(`/api/midlong/valuation/${code}?days=${days}`);
  }

  /** 个股卖方一致预期 (周维度) */
  getMidlongConsensus(code: string, weeks = 26) {
    return this.get<{
      stock_code: string;
      series: Array<{
        week_end: string;
        target_price_avg: number | null;
        target_price_median: number | null;
        target_price_chg_4w_pct: number | null;
        eps_fy1: number | null;
        eps_fy1_chg_4w_pct: number | null;
        report_count: number | null;
      }>;
      latest: {
        week_end: string;
        target_price_avg: number | null;
        target_price_median: number | null;
        target_price_min: number | null;
        target_price_max: number | null;
        target_price_chg_4w_pct: number | null;
        eps_fy1: number | null;
        eps_fy2: number | null;
        eps_fy3: number | null;
        eps_fy1_chg_4w_pct: number | null;
        rating: { buy: number; outperform: number; hold: number; underperform: number; sell: number };
        report_count: number | null;
        institution_count: number | null;
      } | null;
      count: number;
      tier_meta?: TierMeta;
    }>(`/api/midlong/consensus/${code}?weeks=${weeks}`);
  }

  /** 个股近 N 季度十大股东 + 当季变动汇总 */
  getMidlongHolders(code: string, quarters = 4) {
    return this.get<{
      stock_code: string;
      by_period: Array<{
        report_date: string;
        holders: Array<{
          holder_name: string;
          canonical_name: string | null;
          holder_type: string;
          fund_company: string | null;
          is_free_float: boolean;
          rank: number | null;
          change_type: string | null;
        }>;
      }>;
      latest_summary: { new: number; add: number; reduce: number; exit: number } | null;
      tier_meta?: TierMeta;
    }>(`/api/midlong/holders/${code}?quarters=${quarters}`);
  }

  /** AI 长线 brief (7 天缓存) */
  getLongTermBrief(code: string, opts?: { tradeDate?: string; refresh?: boolean }) {
    const sp = new URLSearchParams();
    if (opts?.tradeDate) sp.set("trade_date", opts.tradeDate);
    if (opts?.refresh) sp.set("refresh", "1");
    const qs = sp.toString();
    return this.get<{
      stock_code: string;
      trade_date: string;
      headline: string;
      thesis: string;
      strengths: string[];
      risks: string[];
      valuation_view: string;
      time_horizon: string;
      evidence: string[];
    }>(`/api/midlong/long-brief/${code}${qs ? `?${qs}` : ""}`);
  }

  /** 估值/财务筛选榜 */
  getMidlongScreener(opts?: {
    metric?: "low_pe_pct_5y" | "low_pb_pct_5y" | "high_total_mv" | "high_dv_ttm";
    limit?: number;
    minTotalMv?: number;
  }) {
    const sp = new URLSearchParams();
    if (opts?.metric) sp.set("metric", opts.metric);
    if (opts?.limit) sp.set("limit", String(opts.limit));
    if (opts?.minTotalMv) sp.set("min_total_mv", String(opts.minTotalMv));
    return this.get<{
      items: Array<{
        stock_code: string;
        trade_date: string;
        pe_ttm: number | null;
        pb: number | null;
        pe_pct_5y: number | null;
        pb_pct_5y: number | null;
        dv_ttm: number | null;
        total_mv: number | null;
      }>;
      tier_meta?: TierMeta;
    }>(`/api/midlong/screener?${sp.toString()}`);
  }

  /** 三视角一句话速读 (短/波段/长线) */
  getMultiPerspectiveBrief(code: string, opts?: { tradeDate?: string; refresh?: boolean }) {
    const sp = new URLSearchParams();
    if (opts?.tradeDate) sp.set("trade_date", opts.tradeDate);
    if (opts?.refresh) sp.set("refresh", "1");
    const qs = sp.toString();
    return this.get<{
      stock_code: string;
      trade_date: string;
      perspectives: {
        short: { headline: string; stance: string; evidence: string[] };
        swing: { headline: string; stance: string; evidence: string[] };
        long: { headline: string; stance: string; evidence: string[] };
      };
    }>(`/api/ai/multi-perspective/${code}${qs ? `?${qs}` : ""}`);
  }

  /** 波段 brief */
  getSwingBrief(code: string, opts?: { tradeDate?: string; refresh?: boolean }) {
    const sp = new URLSearchParams();
    if (opts?.tradeDate) sp.set("trade_date", opts.tradeDate);
    if (opts?.refresh) sp.set("refresh", "1");
    const qs = sp.toString();
    return this.get<{
      stock_code: string;
      trade_date: string;
      headline: string;
      bias: "bullish" | "neutral" | "bearish";
      time_horizon: string;
      drivers: string[];
      risks: string[];
      evidence: string[];
    }>(`/api/ai/swing-brief/${code}${qs ? `?${qs}` : ""}`);
  }

  listAiConversations() {
    return this.get<
      Array<{ id: number; title: string; trade_date: string | null; updated_at: string }>
    >(`/api/ai/conversations`);
  }

  getAiConversationMessages(convId: number) {
    return this.get<
      Array<{ id: number; role: "user" | "assistant"; content: string; created_at: string }>
    >(`/api/ai/conversations/${convId}/messages`);
  }

  async streamChat(
    message: string,
    modelId: string,
    onToken: (token: string) => void,
    onDone: (conversationId: number) => void,
    onError: (err: string) => void,
    conversationId?: number,
    tradeDate?: string,
    context?: Record<string, unknown> | null,
  ) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    const res = await fetch(`${API_BASE}/api/ai/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        model_id: modelId,
        conversation_id: conversationId || undefined,
        trade_date: tradeDate || undefined,
        context: context || undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      onError(body.detail || `Error ${res.status}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { onError("No stream"); return; }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.token) onToken(data.token);
          if (data.error) onError(data.error);
          if (data.done) onDone(data.conversation_id);
        } catch { /* skip malformed */ }
      }
    }
  }
}

export const api = new ApiClient();
