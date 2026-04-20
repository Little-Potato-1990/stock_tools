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
  quota: Array<{ action: string; label: string; quota: number }>;
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

  getNews(count = 30, enrich = true) {
    const e = enrich ? 1 : 0;
    return this.get<Array<{
      title: string;
      content: string;
      pub_time: string;
      related_concepts: string[];
      tags?: string[];
      themes?: string[];
      rel_codes?: string[];
      importance?: number;
      sentiment?: "bullish" | "neutral" | "bearish";
    }>>(`/api/market/news?count=${count}&enrich=${e}`);
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
    brief_kind: "today" | "sentiment" | "theme" | "ladder" | "lhb";
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

  getThemeBrief(tradeDate?: string, refresh = false) {
    const params = new URLSearchParams();
    if (tradeDate) params.set("trade_date", tradeDate);
    if (refresh) params.set("refresh", "1");
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
      drivers: Array<{ label: string; text: string }>;
      position: { label: string; text: string };
      height: { label: string; text: string };
      tomorrow: { label: string; text: string };
      verdict: "S" | "A" | "B" | "C";
      verdict_label: string;
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
