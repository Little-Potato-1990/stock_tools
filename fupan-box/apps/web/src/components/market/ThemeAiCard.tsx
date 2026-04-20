"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Zap,
  Target,
  MessageSquare,
} from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { EvidenceBadge } from "./EvidenceBadge";

interface ThemeItem {
  name: string;
  ai_note: string;
  today_rank?: number | null;
  lu_trend?: number[];
  chg_today?: number;
}

interface ThemeBrief {
  trade_date: string;
  generated_at: string;
  model: string;
  headline: string;
  leading: ThemeItem[];
  fading: ThemeItem[];
  emerging: ThemeItem[];
  next_bet: { name: string; reason: string };
  evidence?: string[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

function MiniTrend({ trend }: { trend: number[] }) {
  if (!trend || trend.length === 0) return null;
  const max = Math.max(...trend, 1);
  return (
    <span className="inline-flex items-end gap-[2px]" style={{ height: 10 }}>
      {trend.map((v, i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: Math.max(2, (v / max) * 10),
            background:
              i === trend.length - 1
                ? "var(--accent-red)"
                : "var(--text-muted)",
            opacity: i === trend.length - 1 ? 1 : 0.6,
          }}
        />
      ))}
    </span>
  );
}

function ThemeRow({
  item,
  color,
  onAsk,
}: {
  item: ThemeItem;
  color: string;
  onAsk: () => void;
}) {
  return (
    <div
      className="flex items-start gap-1.5 mb-1"
      style={{ fontSize: "var(--font-xs)" }}
    >
      <span
        className="font-bold flex-shrink-0 inline-flex items-center gap-1"
        style={{ color, minWidth: 76 }}
      >
        {item.today_rank ? (
          <span
            className="inline-flex items-center justify-center font-bold"
            style={{
              width: 14,
              height: 14,
              borderRadius: 2,
              background: color,
              color: "#fff",
              fontSize: 9,
            }}
          >
            {item.today_rank}
          </span>
        ) : null}
        <span className="truncate" style={{ maxWidth: 60 }} title={item.name}>
          {item.name}
        </span>
      </span>
      <span
        style={{ color: "var(--text-secondary)", lineHeight: 1.45 }}
        className="flex-1"
      >
        {item.ai_note}
      </span>
      {item.lu_trend && item.lu_trend.length > 0 && (
        <span
          className="flex-shrink-0"
          title={`近 5 日涨停: ${item.lu_trend.join("/")}`}
        >
          <MiniTrend trend={item.lu_trend} />
        </span>
      )}
      <button
        onClick={onAsk}
        className="flex-shrink-0 transition-opacity hover:opacity-80"
        title="问 AI"
        style={{
          padding: "0px 4px",
          background: "var(--accent-purple)",
          color: "#fff",
          borderRadius: 2,
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          fontSize: 9,
          fontWeight: 700,
          height: 14,
        }}
      >
        <MessageSquare size={8} />
        问AI
      </button>
    </div>
  );
}

export function ThemeAiCard() {
  const [data, setData] = useState<ThemeBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const askAI = useUIStore((s) => s.askAI);
  const openThemeDetail = useUIStore((s) => s.openThemeDetail);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}/api/ai/theme-brief${refresh ? "?refresh=1" : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const d = (await res.json()) as ThemeBrief;
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div
        className="px-3 py-2 flex items-center gap-2"
        style={{
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-color)",
          fontSize: "var(--font-sm)",
          color: "var(--text-muted)",
        }}
      >
        <Sparkles size={14} style={{ color: "var(--accent-purple)" }} />
        AI 正在拆解题材轮动...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="px-3 py-2"
        style={{
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-color)",
          fontSize: "var(--font-sm)",
          color: "var(--accent-red)",
        }}
      >
        AI 题材拆解暂不可用 {error ? `(${error})` : ""}
      </div>
    );
  }

  const askAboutTheme = (theme: string, note: string) => {
    askAI(
      `题材「${theme}」当前 AI 判断为: ${note}\n请深入分析这个题材的核心逻辑、关键龙头股、以及未来 1-3 天可能的走向。`
    );
  };

  return (
    <div
      className="px-3 py-2.5"
      style={{
        background:
          "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)",
        borderBottom: "1px solid var(--border-color)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} style={{ color: "var(--accent-purple)" }} />
        <span
          className="font-bold"
          style={{
            color: "var(--accent-purple)",
            fontSize: "var(--font-sm)",
            letterSpacing: 1,
          }}
        >
          AI 题材轮动拆解
        </span>
        <span
          style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}
        >
          {data.trade_date} · {data.model}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <EvidenceBadge evidence={data.evidence} />
          <button
            onClick={() => load(true)}
            className="p-1 transition-opacity hover:opacity-70"
            title="重新生成"
            style={{ color: "var(--text-muted)" }}
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      <div
        className="font-bold mb-2"
        style={{
          fontSize: "var(--font-md)",
          color: "var(--text-primary)",
          lineHeight: 1.5,
        }}
      >
        {data.headline}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
        {data.leading.length > 0 && (
          <div
            style={{
              padding: "6px 10px",
              background: "var(--bg-card)",
              borderRadius: 4,
              border: "1px solid var(--border-color)",
            }}
          >
            <div
              className="flex items-center gap-1 mb-1.5"
              style={{
                fontSize: 10,
                color: "var(--accent-red)",
                fontWeight: 700,
              }}
            >
              <TrendingUp size={10} />
              主线在位
            </div>
            {data.leading.map((it) => (
              <ThemeRow
                key={`l-${it.name}`}
                item={it}
                color="var(--accent-red)"
                onAsk={() => askAboutTheme(it.name, it.ai_note)}
              />
            ))}
          </div>
        )}

        {data.fading.length > 0 && (
          <div
            style={{
              padding: "6px 10px",
              background: "var(--bg-card)",
              borderRadius: 4,
              border: "1px solid var(--border-color)",
            }}
          >
            <div
              className="flex items-center gap-1 mb-1.5"
              style={{
                fontSize: 10,
                color: "var(--accent-green)",
                fontWeight: 700,
              }}
            >
              <TrendingDown size={10} />
              退潮中
            </div>
            {data.fading.map((it) => (
              <ThemeRow
                key={`f-${it.name}`}
                item={it}
                color="var(--accent-green)"
                onAsk={() => askAboutTheme(it.name, it.ai_note)}
              />
            ))}
          </div>
        )}

        {data.emerging.length > 0 && (
          <div
            style={{
              padding: "6px 10px",
              background: "var(--bg-card)",
              borderRadius: 4,
              border: "1px solid var(--border-color)",
            }}
          >
            <div
              className="flex items-center gap-1 mb-1.5"
              style={{
                fontSize: 10,
                color: "var(--accent-orange)",
                fontWeight: 700,
              }}
            >
              <Zap size={10} />
              新晋热点
            </div>
            {data.emerging.map((it) => (
              <ThemeRow
                key={`e-${it.name}`}
                item={it}
                color="var(--accent-orange)"
                onAsk={() => askAboutTheme(it.name, it.ai_note)}
              />
            ))}
          </div>
        )}
      </div>

      {data.next_bet?.name && (
        <div
          className="flex items-center gap-2"
          style={{
            padding: "6px 10px",
            background:
              "linear-gradient(90deg, rgba(168,85,247,0.12), rgba(168,85,247,0.04))",
            border: "1px solid rgba(168,85,247,0.3)",
            borderRadius: 4,
            fontSize: "var(--font-xs)",
          }}
        >
          <Target size={11} style={{ color: "var(--accent-purple)" }} />
          <span
            className="font-bold"
            style={{ color: "var(--accent-purple)" }}
          >
            明日重点
          </span>
          <button
            onClick={() => openThemeDetail(data.next_bet.name)}
            className="font-bold transition-opacity hover:opacity-80"
            style={{
              color: "var(--text-primary)",
              padding: "0 6px",
              background: "var(--bg-card)",
              borderRadius: 2,
            }}
          >
            {data.next_bet.name}
          </button>
          <span
            style={{ color: "var(--text-secondary)", lineHeight: 1.45 }}
            className="flex-1"
          >
            {data.next_bet.reason}
          </span>
          <button
            onClick={() =>
              askAI(
                `今日 AI 复盘判断: ${data.headline}\n建议明日重点关注题材: ${data.next_bet.name} —— ${data.next_bet.reason}\n请进一步给出可执行的盘前/盘中/盘后操作清单。`
              )
            }
            className="transition-opacity hover:opacity-80 flex-shrink-0"
            title="问 AI"
            style={{
              padding: "3px 8px",
              background: "var(--accent-purple)",
              color: "#fff",
              borderRadius: 3,
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            <MessageSquare size={10} />
            追问 AI
          </button>
        </div>
      )}
    </div>
  );
}
