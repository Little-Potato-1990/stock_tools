"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, Send, Sparkles, ChevronDown, LogIn, History } from "lucide-react";
import { useUIStore, type NavModule } from "@/stores/ui-store";
import { api } from "@/lib/api";

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  tag: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const MODULE_LABELS: Record<NavModule, string> = {
  today: "今日复盘",
  sentiment: "大盘情绪",
  themes: "题材",
  capital: "资金分析",
  lhb: "龙虎榜",
  search: "搜索",
  news: "资讯",
  watchlist: "自选股",
  plans: "我的计划",
  ai_track: "AI 预测追踪",
  my_review: "我的复盘",
  account: "账户套餐",
};

export function AiPanel() {
  const open = useUIStore((s) => s.aiPanelOpen);
  const close = useUIStore((s) => s.closeAiPanel);
  const selectedModel = useUIStore((s) => s.selectedModel);
  const setSelectedModel = useUIStore((s) => s.setSelectedModel);
  const conversationId = useUIStore((s) => s.conversationId);
  const setConversationId = useUIStore((s) => s.setConversationId);
  const isStreaming = useUIStore((s) => s.isStreaming);
  const setIsStreaming = useUIStore((s) => s.setIsStreaming);
  const focusedStock = useUIStore((s) => s.focusedStock);
  const activeModule = useUIStore((s) => s.activeModule);
  const themeDetailName = useUIStore((s) => s.themeDetailName);
  const stockDetailCode = useUIStore((s) => s.stockDetailCode);
  const recentInteractions = useUIStore((s) => s.recentInteractions);

  const pendingPrompt = useUIStore((s) => s.pendingChatPrompt);
  const consumePending = useUIStore((s) => s.consumePendingPrompt);

  const [watchlist, setWatchlist] = useState<Array<{ code: string; name?: string }>>([]);
  useEffect(() => {
    if (!api.isLoggedIn()) {
      setWatchlist([]);
      return;
    }
    let alive = true;
    api.getWatchlist()
      .then((rows) => {
        if (!alive) return;
        setWatchlist(rows.map((r) => ({ code: r.stock_code })));
      })
      .catch(() => {
        if (alive) setWatchlist([]);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const aiContext = useMemo(() => {
    const ctx: {
      module: NavModule;
      stockCode?: string;
      stockName?: string;
      theme?: string;
      watchlist?: Array<{ code: string; name?: string }>;
      recent?: Array<{ kind: string; key: string; label?: string; ago_min: number }>;
    } = { module: activeModule };
    if (stockDetailCode) {
      ctx.stockCode = stockDetailCode;
      if (focusedStock?.code === stockDetailCode) ctx.stockName = focusedStock.name;
    } else if (focusedStock) {
      ctx.stockCode = focusedStock.code;
      ctx.stockName = focusedStock.name;
    }
    if (themeDetailName) ctx.theme = themeDetailName;
    if (watchlist.length > 0) ctx.watchlist = watchlist.slice(0, 30);
    if (recentInteractions.length > 0) {
      const now = Date.now();
      ctx.recent = recentInteractions.slice(0, 8).map((it) => ({
        kind: it.kind,
        key: it.key,
        label: it.label,
        ago_min: Math.max(0, Math.round((now - it.ts) / 60000)),
      }));
    }
    return ctx;
  }, [activeModule, focusedStock, themeDetailName, stockDetailCode, watchlist, recentInteractions]);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "你好，我是复盘副驾。可以问我：\n• 今天市场情绪如何？\n• 当前最强的连板梯队怎么样？\n• 哪些题材最近表现强势？",
    },
  ]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [convs, setConvs] = useState<
    Array<{ id: number; title: string; trade_date: string | null; updated_at: string }>
  >([]);
  const [convsLoading, setConvsLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 240);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !pendingPrompt) return;
    const p = consumePending();
    if (p) setInput(p);
  }, [open, pendingPrompt, consumePending]);

  useEffect(() => {
    api.restoreToken();
    setLoggedIn(api.isLoggedIn());
  }, []);

  useEffect(() => {
    api.getAiModels().then(setModels).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadHistory = useCallback(async () => {
    if (!api.isLoggedIn()) {
      setConvs([]);
      return;
    }
    setConvsLoading(true);
    try {
      const list = await api.listAiConversations();
      setConvs(list);
    } catch {
      setConvs([]);
    } finally {
      setConvsLoading(false);
    }
  }, []);

  const handleOpenHistory = useCallback(() => {
    setShowHistory((prev) => {
      const next = !prev;
      if (next) loadHistory();
      return next;
    });
  }, [loadHistory]);

  const handlePickConversation = useCallback(async (convId: number) => {
    setShowHistory(false);
    if (convId === conversationId) return;
    try {
      const msgs = await api.getAiConversationMessages(convId);
      setConversationId(convId);
      setMessages(
        msgs
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ id: String(m.id), role: m.role, content: m.content }))
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : "load failed";
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "assistant", content: `加载历史会话失败: ${err}` },
      ]);
    }
  }, [conversationId, setConversationId]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    if (!api.isLoggedIn()) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: "请先登录后使用 AI 对话功能（顶部导航 → 自选 → 登录）。",
        },
      ]);
      return;
    }

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: input.trim() };
    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "" };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsStreaming(true);

    await api.streamChat(
      userMsg.content,
      selectedModel,
      (token) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + token } : m))
        );
      },
      (convId) => {
        setConversationId(convId);
        setIsStreaming(false);
      },
      (err) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: `错误: ${err}` } : m))
        );
        setIsStreaming(false);
      },
      conversationId ?? undefined,
      undefined,
      aiContext,
    );
  }, [input, isStreaming, selectedModel, conversationId, setConversationId, setIsStreaming, aiContext]);

  const handleNewChat = () => {
    setConversationId(null);
    setMessages([
      { id: "welcome", role: "assistant", content: "新对话已开始。" },
    ]);
  };

  const currentModel = models.find((m) => m.id === selectedModel);
  const groupedModels = models.reduce<Record<string, ModelInfo[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  return (
    <>
      {/* 遮罩层 */}
      <div
        onClick={close}
        className="fixed inset-0 transition-opacity z-40"
        style={{
          background: "rgba(0,0,0,0.4)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
      />

      {/* 抽屉 */}
      <aside
        className="fixed right-0 top-0 h-full flex flex-col z-50 transition-transform"
        style={{
          width: 420,
          maxWidth: "92vw",
          background: "var(--bg-secondary)",
          borderLeft: "1px solid var(--border-color)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          boxShadow: open ? "-12px 0 40px rgba(0,0,0,0.5)" : "none",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 flex-shrink-0"
          style={{
            height: 48,
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={18} style={{ color: "var(--accent-purple)" }} />
            <span className="font-bold" style={{ fontSize: "var(--font-lg)" }}>
              复盘副驾
            </span>
          </div>
          <div className="flex items-center gap-1 relative" ref={historyRef}>
            <button
              onClick={handleOpenHistory}
              className="font-semibold transition-colors flex items-center gap-1"
              title="历史会话"
              style={{
                fontSize: "var(--font-sm)",
                padding: "4px 8px",
                background: showHistory ? "var(--accent-purple)" : "var(--bg-tertiary)",
                color: showHistory ? "#fff" : "var(--text-secondary)",
                borderRadius: 4,
              }}
            >
              <History size={12} />
              历史
            </button>
            <button
              onClick={handleNewChat}
              className="font-semibold transition-colors"
              style={{
                fontSize: "var(--font-sm)",
                padding: "4px 10px",
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                borderRadius: 4,
              }}
            >
              新对话
            </button>
            <button onClick={close} className="p-1.5 transition-opacity hover:opacity-70">
              <X size={16} style={{ color: "var(--text-secondary)" }} />
            </button>

            {showHistory && (
              <div
                className="absolute right-0 top-full mt-1 z-50 max-h-80 overflow-y-auto"
                style={{
                  width: 280,
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 4,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                }}
              >
                {convsLoading ? (
                  <div
                    className="px-3 py-3 text-center"
                    style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
                  >
                    加载中...
                  </div>
                ) : convs.length === 0 ? (
                  <div
                    className="px-3 py-3 text-center"
                    style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
                  >
                    {loggedIn ? "暂无历史会话" : "请先登录"}
                  </div>
                ) : (
                  convs.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handlePickConversation(c.id)}
                      className="w-full text-left px-3 py-2 transition-colors hover:brightness-125"
                      style={{
                        background:
                          c.id === conversationId ? "var(--bg-tertiary)" : "transparent",
                        color: "var(--text-primary)",
                        fontSize: "var(--font-sm)",
                        borderBottom: "1px solid var(--border-color)",
                      }}
                    >
                      <div
                        className="truncate font-semibold"
                        style={{
                          color:
                            c.id === conversationId
                              ? "var(--accent-purple)"
                              : "var(--text-primary)",
                        }}
                      >
                        {c.title || "未命名对话"}
                      </div>
                      <div
                        className="flex items-center gap-2 mt-0.5"
                        style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}
                      >
                        {c.trade_date && <span>{c.trade_date}</span>}
                        <span className="ml-auto">
                          {new Date(c.updated_at).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Context chips */}
        <div
          className="flex items-center gap-1 px-4 py-1.5 flex-wrap flex-shrink-0"
          style={{
            background: "var(--bg-tertiary)",
            borderBottom: "1px solid var(--border-color)",
            fontSize: "var(--font-xs)",
          }}
        >
          <span style={{ color: "var(--text-muted)" }}>上下文:</span>
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 3,
              background: "var(--bg-secondary)",
              color: "var(--accent-purple)",
              border: "1px solid var(--border-color)",
            }}
          >
            {MODULE_LABELS[aiContext.module]}
          </span>
          {aiContext.stockCode && (
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 3,
                background: "var(--bg-secondary)",
                color: "var(--accent-orange)",
                border: "1px solid var(--border-color)",
              }}
            >
              {aiContext.stockName ?? aiContext.stockCode}
            </span>
          )}
          {aiContext.theme && (
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 3,
                background: "var(--bg-secondary)",
                color: "var(--accent-red)",
                border: "1px solid var(--border-color)",
              }}
            >
              {aiContext.theme}
            </span>
          )}
        </div>

        {/* Model selector */}
        <div
          className="relative px-4 py-2 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border-color)" }}
          ref={pickerRef}
        >
          <button
            onClick={() => setShowModelPicker(!showModelPicker)}
            className="flex items-center gap-2 w-full transition-colors"
            style={{
              padding: "6px 10px",
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              borderRadius: 4,
              fontSize: "var(--font-sm)",
            }}
          >
            <span className="flex-1 text-left truncate">
              {currentModel ? currentModel.name : selectedModel}
            </span>
            {currentModel && (
              <span
                className="font-bold"
                style={{
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "var(--accent-purple)",
                  color: "white",
                  fontSize: "var(--font-xs)",
                }}
              >
                {currentModel.tag}
              </span>
            )}
            <ChevronDown size={12} />
          </button>

          {showModelPicker && (
            <div
              className="absolute left-4 right-4 top-full mt-1 z-50 max-h-72 overflow-y-auto"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: 4,
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              }}
            >
              {Object.entries(groupedModels).map(([provider, items]) => (
                <div key={provider}>
                  <div
                    className="px-3 py-1.5 font-bold uppercase tracking-wider"
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "var(--font-xs)",
                    }}
                  >
                    {provider}
                  </div>
                  {items.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setSelectedModel(m.id);
                        setShowModelPicker(false);
                      }}
                      className="w-full px-3 py-2 text-left flex items-center justify-between transition-colors hover:brightness-125"
                      style={{
                        background: m.id === selectedModel ? "var(--bg-tertiary)" : "transparent",
                        color: "var(--text-primary)",
                        fontSize: "var(--font-sm)",
                      }}
                    >
                      <span>{m.name}</span>
                      <span
                        style={{
                          padding: "1px 6px",
                          borderRadius: 3,
                          background: "var(--bg-tertiary)",
                          color: "var(--text-muted)",
                          fontSize: "var(--font-xs)",
                        }}
                      >
                        {m.tag}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className="max-w-[88%] leading-relaxed whitespace-pre-wrap"
                style={{
                  background:
                    msg.role === "user" ? "var(--accent-purple)" : "var(--bg-tertiary)",
                  color: msg.role === "user" ? "#fff" : "var(--text-primary)",
                  padding: "8px 12px",
                  borderRadius: 6,
                  fontSize: "var(--font-md)",
                }}
              >
                {msg.content || (isStreaming ? "思考中..." : "")}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* 快捷提问 - 仅在初始 / 仅有欢迎语时显示 */}
        {messages.length <= 1 && loggedIn && (
          <div
            className="px-3 pb-2 flex flex-wrap gap-1.5 flex-shrink-0"
          >
            {(focusedStock
              ? [
                  `${focusedStock.name ?? focusedStock.code} 最近的资金面如何？`,
                  `${focusedStock.code} 所属题材表现`,
                  `这只票要不要继续持有？`,
                ]
              : [
                  "今天市场情绪如何？",
                  "现在最强的连板梯队",
                  "哪些题材最近最热？",
                ]
            ).map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                className="transition-colors hover:brightness-125"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  fontSize: "var(--font-xs)",
                  padding: "3px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--border-color)",
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div
          className="p-3 flex-shrink-0"
          style={{ borderTop: "1px solid var(--border-color)" }}
        >
          {!loggedIn ? (
            <div
              className="flex items-center gap-2"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-muted)",
                padding: "8px 12px",
                borderRadius: 4,
                fontSize: "var(--font-sm)",
              }}
            >
              <LogIn size={14} />
              <span>登录后使用 AI 对话（自选股页面可登录）</span>
            </div>
          ) : (
            <div
              className="flex items-center gap-2"
              style={{
                background: "var(--bg-tertiary)",
                padding: "6px 10px",
                borderRadius: 4,
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder={
                  focusedStock
                    ? `问点关于 ${focusedStock.name ?? focusedStock.code} 的...`
                    : "问点什么..."
                }
                disabled={isStreaming}
                className="flex-1 bg-transparent outline-none"
                style={{
                  color: "var(--text-primary)",
                  fontSize: "var(--font-md)",
                }}
              />
              <button
                onClick={handleSend}
                disabled={isStreaming || !input.trim()}
                className="p-1.5 transition-opacity"
                style={{
                  background: "var(--accent-purple)",
                  borderRadius: 4,
                  opacity: input.trim() && !isStreaming ? 1 : 0.4,
                }}
              >
                <Send size={14} color="white" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
