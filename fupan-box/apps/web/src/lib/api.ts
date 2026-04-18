const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
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

  getSnapshot(type: string, date?: string) {
    const q = date ? `?trade_date=${date}` : "";
    return this.get<{ trade_date: string; type: string; data: Record<string, unknown> }>(
      `/api/snapshot/${type}${q}`
    );
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

  getNews(count = 30) {
    return this.get<Array<Record<string, unknown>>>(`/api/market/news?count=${count}`);
  }

  getBigdataRank(dimension: string) {
    return this.get<Record<string, unknown>>(`/api/market/bigdata-rank?dimension=${encodeURIComponent(dimension)}`);
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

  getIndustriesGrid(days = 7, rows = 20) {
    return this.get<{
      rows: number;
      days: Array<{ trade_date: string; items: Array<Record<string, unknown>> }>;
    }>(`/api/market/industries-grid?days=${days}&rows=${rows}`);
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

  async streamChat(
    message: string,
    modelId: string,
    onToken: (token: string) => void,
    onDone: (conversationId: number) => void,
    onError: (err: string) => void,
    conversationId?: number,
    tradeDate?: string,
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
