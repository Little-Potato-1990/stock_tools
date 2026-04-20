"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Clock, XCircle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";

type Health = Awaited<ReturnType<typeof api.getDataHealth>>;

const STATUS_META: Record<
  Health["status"],
  { label: string; color: string; bg: string; icon: typeof CheckCircle2 }
> = {
  ok: {
    label: "数据已就绪",
    color: "var(--accent-green)",
    bg: "rgba(34,197,94,0.12)",
    icon: CheckCircle2,
  },
  stale: {
    label: "数据非今日",
    color: "var(--accent-yellow)",
    bg: "rgba(234,179,8,0.12)",
    icon: Clock,
  },
  partial: {
    label: "数据不齐",
    color: "var(--accent-orange)",
    bg: "rgba(249,115,22,0.14)",
    icon: AlertCircle,
  },
  empty: {
    label: "暂无数据",
    color: "var(--accent-red)",
    bg: "rgba(239,68,68,0.14)",
    icon: XCircle,
  },
};

function formatStale(min: number | null): string {
  if (min == null) return "未知";
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

export function DataHealthChip() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.getDataHealth();
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) {
    return (
      <div
        className="rounded text-center"
        style={{
          padding: "7px 6px",
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border-color)",
          color: "var(--text-muted)",
          fontSize: 10,
        }}
      >
        正在检查数据...
      </div>
    );
  }

  if (!data) {
    return (
      <button
        onClick={load}
        className="rounded w-full text-center transition-opacity hover:opacity-80"
        style={{
          padding: "7px 6px",
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.4)",
          color: "var(--accent-red)",
          fontSize: 10,
        }}
      >
        数据状态获取失败 · 点击重试
      </button>
    );
  }

  const meta = STATUS_META[data.status];
  const Icon = meta.icon;
  const dateShort = data.latest_trade_date
    ? data.latest_trade_date.slice(5).replace("-", ".")
    : "—";

  return (
    <div className="relative">
      <button
        onClick={load}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="rounded w-full transition-colors"
        style={{
          padding: "6px 8px",
          background: meta.bg,
          border: `1px solid ${meta.color}40`,
          textAlign: "left",
        }}
        title="点击刷新"
      >
        <div
          className="flex items-center gap-1.5 font-bold"
          style={{ color: meta.color, fontSize: "var(--font-sm)" }}
        >
          <Icon size={12} />
          <span className="truncate flex-1">{meta.label}</span>
          {loading && <RefreshCw size={10} className="animate-spin" />}
        </div>
        <div
          className="mt-0.5 flex items-center gap-1"
          style={{ color: "var(--text-muted)", fontSize: 10 }}
        >
          <span>{dateShort}</span>
          <span>·</span>
          <span>{formatStale(data.stale_minutes)}</span>
        </div>
      </button>

      {hover && (
        <div
          className="absolute z-50"
          style={{
            left: "100%",
            bottom: 0,
            marginLeft: 8,
            width: 240,
            padding: "8px 10px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            fontSize: "var(--font-xs)",
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          <div className="font-bold mb-1" style={{ color: meta.color }}>
            {meta.label}
          </div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>最新交易日: </span>
            <span style={{ color: "var(--text-primary)" }}>
              {data.latest_trade_date ?? "无"}
            </span>
          </div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>系统日期: </span>
            <span style={{ color: "var(--text-primary)" }}>{data.today}</span>
          </div>
          {data.snapshot_types.length > 0 && (
            <div>
              <span style={{ color: "var(--text-muted)" }}>已就绪: </span>
              <span style={{ color: "var(--accent-green)" }}>
                {data.snapshot_types.join(", ")}
              </span>
            </div>
          )}
          {data.missing.length > 0 && (
            <div>
              <span style={{ color: "var(--text-muted)" }}>缺失: </span>
              <span style={{ color: "var(--accent-red)" }}>
                {data.missing.join(", ")}
              </span>
            </div>
          )}
          {data.last_pipeline?.finished_at && (
            <div>
              <span style={{ color: "var(--text-muted)" }}>上次管线: </span>
              <span style={{ color: "var(--text-primary)" }}>
                {new Date(data.last_pipeline.finished_at).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          )}
          {data.last_failure && (
            <div className="mt-1 pt-1" style={{ borderTop: "1px solid var(--border-color)" }}>
              <span style={{ color: "var(--accent-red)", fontWeight: 700 }}>
                最近失败:
              </span>
              <div className="truncate" title={data.last_failure.error_message ?? ""}>
                {data.last_failure.trade_date} · {data.last_failure.step}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
