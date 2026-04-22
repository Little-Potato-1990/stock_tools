"use client";

/**
 * 顶部数据状态条 (P0 #1)
 *
 * 一行 22px 的全宽 banner, 钉在主内容区顶部, 让用户进任何页面都立刻知道:
 *   1. 当前展示的是哪一天的数据 (latest_trade_date)
 *   2. 数据离"今"多远 (X 分钟前)
 *   3. 是否完整 (snapshot_types 全部就绪 / 缺哪一类)
 *   4. 上一次管线是否失败
 *
 * 与 Sidebar 中的 DataHealthChip 共用同一个 endpoint, 但定位/语境不同:
 *   - 侧边栏 chip = 静态、补充信息
 *   - 顶部 bar    = 主信息流, 永远在用户视野中
 *
 * 状态色:
 *   ok      → 不显眼的灰底绿点
 *   stale   → 黄底, 提示"非今日"
 *   partial → 橙底, 提示"缺 xxx"
 *   empty   → 红底
 *   failed  → 红底 (网络/接口错)
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Clock, XCircle, RefreshCw, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";

type Health = Awaited<ReturnType<typeof api.getDataHealth>>;

const META: Record<
  Health["status"] | "failed",
  { label: string; bg: string; color: string; icon: typeof CheckCircle2 }
> = {
  ok: {
    label: "数据已就绪",
    bg: "rgba(34,197,94,0.10)",
    color: "var(--accent-green)",
    icon: CheckCircle2,
  },
  stale: {
    label: "非今日数据",
    bg: "rgba(234,179,8,0.14)",
    color: "var(--accent-yellow)",
    icon: Clock,
  },
  partial: {
    label: "数据不齐",
    bg: "rgba(249,115,22,0.16)",
    color: "var(--accent-orange)",
    icon: AlertCircle,
  },
  empty: {
    label: "暂无数据",
    bg: "rgba(239,68,68,0.16)",
    color: "var(--accent-red)",
    icon: XCircle,
  },
  failed: {
    label: "数据状态获取失败",
    bg: "rgba(239,68,68,0.16)",
    color: "var(--accent-red)",
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

export function DataStatusBar() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.getDataHealth();
      setData(d);
      setFailed(false);
    } catch {
      setData(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // 60s 自动刷新, 与侧边栏 chip 一致
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const status: keyof typeof META = failed ? "failed" : data?.status ?? "empty";
  const meta = META[status];
  const Icon = meta.icon;
  const dateShort = data?.latest_trade_date
    ? data.latest_trade_date.slice(5).replace("-", ".")
    : "—";

  const hasDetails =
    data &&
    (data.missing.length > 0 ||
      data.snapshot_types.length > 0 ||
      data.last_pipeline?.finished_at ||
      data.last_failure);

  return (
    <div
      style={{
        flexShrink: 0,
        background: meta.bg,
        borderBottom: `1px solid ${meta.color}33`,
        color: meta.color,
        fontSize: 11,
        lineHeight: 1.3,
      }}
    >
      <div className="flex items-center gap-2 px-3" style={{ height: 24 }}>
        <Icon size={12} style={{ color: meta.color, flexShrink: 0 }} />
        <span className="font-bold" style={{ fontSize: 11 }}>
          {meta.label}
        </span>

        {data && !failed && (
          <>
            <span style={{ color: "var(--text-secondary)", opacity: 0.85 }}>·</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {dateShort}
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
              {formatStale(data.stale_minutes)}
            </span>
            {data.missing.length > 0 && (
              <span
                className="ml-1 px-1 rounded"
                style={{
                  background: "var(--accent-red)",
                  color: "#fff",
                  fontSize: 9,
                  fontWeight: 700,
                }}
                title={`缺失模块: ${data.missing.join(", ")}`}
              >
                缺 {data.missing.length}
              </span>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          {hasDetails && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-0.5 px-1 rounded transition-opacity hover:opacity-80"
              style={{
                fontSize: 10,
                color: "var(--text-secondary)",
                background: "transparent",
              }}
              title="展开详情"
            >
              详情
              <ChevronDown
                size={10}
                style={{
                  transform: expanded ? "rotate(180deg)" : "rotate(0)",
                  transition: "transform 0.15s",
                }}
              />
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="p-0.5 transition-opacity hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
            title="立即刷新"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {expanded && data && (
        <div
          className="px-3 py-1.5 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1"
          style={{
            background: "var(--bg-card)",
            borderTop: `1px solid ${meta.color}22`,
            fontSize: 10,
            color: "var(--text-secondary)",
          }}
        >
          <div>
            <span style={{ color: "var(--text-muted)" }}>系统日期: </span>
            <span style={{ color: "var(--text-primary)" }}>{data.today}</span>
          </div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>最新交易日: </span>
            <span style={{ color: "var(--text-primary)" }}>
              {data.latest_trade_date ?? "无"}
            </span>
          </div>
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
          {data.snapshot_types.length > 0 && (
            <div className="col-span-2 md:col-span-2">
              <span style={{ color: "var(--text-muted)" }}>已就绪: </span>
              <span style={{ color: "var(--accent-green)" }}>
                {data.snapshot_types.join(", ")}
              </span>
            </div>
          )}
          {data.missing.length > 0 && (
            <div className="col-span-2 md:col-span-2">
              <span style={{ color: "var(--text-muted)" }}>缺失: </span>
              <span style={{ color: "var(--accent-red)" }}>{data.missing.join(", ")}</span>
            </div>
          )}
          {data.last_failure && (
            <div className="col-span-2 md:col-span-4">
              <span style={{ color: "var(--accent-red)", fontWeight: 700 }}>最近失败: </span>
              <span style={{ color: "var(--text-secondary)" }}>
                {data.last_failure.trade_date} · {data.last_failure.step}
                {data.last_failure.error_message
                  ? ` · ${data.last_failure.error_message.slice(0, 80)}`
                  : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
