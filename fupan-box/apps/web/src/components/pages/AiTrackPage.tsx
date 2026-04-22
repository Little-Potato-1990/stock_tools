"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  RefreshCw,
  Sparkles,
  Award,
  Target,
  Scale,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  Clock,
  History,
  Stethoscope,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { FeedbackStatsPanel } from "./FeedbackStatsPanel";

type Stats = Awaited<ReturnType<typeof api.getAiTrackStats>>;
type Diagnosis = Awaited<ReturnType<typeof api.getAiTrackDiagnosis>>;
type Mode = "hit_rate" | "feedback" | "diagnosis";

const KIND_META: Record<
  string,
  { label: string; icon: typeof Sparkles; color: string }
> = {
  regime: { label: "大盘势能", icon: Scale, color: "var(--accent-blue)" },
  tilt: { label: "相似日倾向", icon: TrendingUp, color: "var(--accent-purple)" },
  promotion: { label: "晋级候选", icon: Award, color: "var(--accent-red)" },
  first_board: {
    label: "首板低吸",
    icon: Target,
    color: "var(--accent-orange)",
  },
  avoid: { label: "风险规避", icon: TrendingDown, color: "var(--accent-green)" },
};

const KIND_ORDER = ["regime", "tilt", "promotion", "first_board", "avoid"];

export function AiTrackPage() {
  const [mode, setMode] = useState<Mode>("hit_rate");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [days, setDays] = useState(30);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const openWhyRose = useUIStore((s) => s.openWhyRose);

  const loadDiagnosis = useCallback(async () => {
    setDiagLoading(true);
    try {
      const d = await api.getAiTrackDiagnosis(days);
      setDiag(d);
    } catch {
      setDiag(null);
    } finally {
      setDiagLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (mode === "diagnosis" && !diag) loadDiagnosis();
  }, [mode, diag, loadDiagnosis]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.getAiTrackStats(days);
      setStats(d);
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      await api.triggerAiTrackVerify(3);
      await load();
    } finally {
      setVerifying(false);
    }
  };

  const filteredRecent = useMemo(() => {
    if (!stats) return [];
    if (kindFilter === "all") return stats.recent;
    return stats.recent.filter((r) => r.kind === kindFilter);
  }, [stats, kindFilter]);

  const overall = stats?.overall;
  const overallRate = overall?.hit_rate;
  const overallColor =
    overallRate == null
      ? "var(--text-muted)"
      : overallRate >= 0.5
      ? "var(--accent-red)"
      : overallRate >= 0.35
      ? "var(--accent-orange)"
      : "var(--accent-green)";

  return (
    <div>
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
        }}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: "var(--accent-purple)" }} />
          <span
            className="font-bold"
            style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}
          >
            AI 战绩看板
          </span>
          <div
            className="ml-3 flex items-center"
            style={{
              background: "var(--bg-tertiary)",
              borderRadius: 4,
              padding: 2,
            }}
          >
            {[
              { id: "hit_rate" as Mode, label: "T+3 命中率" },
              { id: "diagnosis" as Mode, label: "策略诊断" },
              { id: "feedback" as Mode, label: "用户反馈" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setMode(t.id)}
                className="px-2 py-0.5 rounded font-bold transition-colors"
                style={{
                  background: mode === t.id ? "var(--accent-purple)" : "transparent",
                  color: mode === t.id ? "#fff" : "var(--text-secondary)",
                  fontSize: 11,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {mode === "hit_rate"
              ? "把 AI 给出的判断留个底, 几天后回头看准不准, 形成自我进化闭环"
              : mode === "diagnosis"
              ? "6 项自查: 趋势/大盘势失败/个股偏差/校准/衰减/模型对比"
              : "用户对 5 张 AI 卡片的 👍 / 👎, 用来反向修正 prompt"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {[7, 14, 30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="px-2 py-1 rounded font-bold transition-colors"
              style={{
                background:
                  days === d ? "var(--accent-purple)" : "var(--bg-tertiary)",
                color: days === d ? "#fff" : "var(--text-secondary)",
                fontSize: 11,
                border: "none",
                cursor: "pointer",
              }}
            >
              {d}天
            </button>
          ))}
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="flex items-center gap-1 px-2 py-1 rounded font-bold"
            style={{
              background: "var(--accent-orange)",
              color: "#fff",
              fontSize: 11,
              border: "none",
              opacity: verifying ? 0.6 : 1,
              cursor: verifying ? "not-allowed" : "pointer",
            }}
            title="校验所有 verified_at IS NULL 且 trade_date <= 今日-3 的预测"
          >
            <RefreshCw size={11} className={verifying ? "animate-spin" : ""} />
            触发 T+3 校验
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="p-1 rounded"
            style={{ color: "var(--text-muted)" }}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3" style={{ display: mode === "hit_rate" ? undefined : "none" }}>
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-3 px-3 py-3"
          style={{
            background:
              "linear-gradient(135deg, rgba(139,92,246,0.10) 0%, rgba(245,158,11,0.06) 100%)",
            border: "1px solid rgba(139,92,246,0.28)",
            borderRadius: 6,
          }}
        >
          <OverallCard
            label="总命中率"
            value={overallRate}
            color={overallColor}
            sub={`${overall?.hits ?? 0} / ${overall?.verified ?? 0} 条已验证`}
          />
          <OverallCard
            label="累计验证"
            value={overall?.verified ?? 0}
            color="var(--text-primary)"
            isPlain
            sub={`窗口 ${stats?.from_date} ~ ${stats?.to_date}`}
          />
          <OverallCard
            label="累计命中"
            value={overall?.hits ?? 0}
            color="var(--accent-red)"
            isPlain
            sub="hit=True 且已验证"
          />
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {KIND_ORDER.map((k) => {
              const meta = KIND_META[k];
              const v = stats.by_kind[k];
              if (!meta) return null;
              const KindIcon = meta.icon;
              const rate = v?.hit_rate;
              return (
                <button
                  key={k}
                  onClick={() => setKindFilter(kindFilter === k ? "all" : k)}
                  style={{
                    background:
                      kindFilter === k ? "var(--bg-card)" : "var(--bg-secondary)",
                    border:
                      kindFilter === k
                        ? `1px solid ${meta.color}`
                        : "1px solid var(--border-color)",
                    borderRadius: 4,
                    padding: "8px 10px",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1">
                      <KindIcon size={11} style={{ color: meta.color }} />
                      <span
                        className="font-bold"
                        style={{
                          fontSize: 11,
                          color: "var(--text-primary)",
                        }}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <span
                      className="tabular-nums"
                      style={{
                        fontSize: 9,
                        color: "var(--text-muted)",
                      }}
                    >
                      {v?.verified ?? 0}/{v?.total ?? 0}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="font-bold tabular-nums"
                      style={{
                        fontSize: 22,
                        color:
                          rate == null
                            ? "var(--text-muted)"
                            : rate >= 0.5
                            ? "var(--accent-red)"
                            : rate >= 0.3
                            ? "var(--accent-orange)"
                            : "var(--accent-green)",
                      }}
                    >
                      {rate == null ? "—" : `${(rate * 100).toFixed(0)}%`}
                    </span>
                    <span
                      style={{ fontSize: 10, color: "var(--text-muted)" }}
                    >
                      命中率
                    </span>
                  </div>
                  <div
                    className="mt-1 h-1.5"
                    style={{
                      background: "var(--bg-tertiary)",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: rate == null ? "0%" : `${Math.min(100, rate * 100)}%`,
                        height: "100%",
                        background: meta.color,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
          }}
        >
          <div
            className="px-3 py-2 flex items-center justify-between"
            style={{ borderBottom: "1px solid var(--border-color)" }}
          >
            <div className="flex items-center gap-1.5">
              <History size={12} style={{ color: "var(--accent-blue)" }} />
              <span
                className="font-bold"
                style={{ fontSize: "var(--font-sm)", color: "var(--text-primary)" }}
              >
                最近预测明细
              </span>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {filteredRecent.length} 条
                {kindFilter !== "all" && (
                  <button
                    onClick={() => setKindFilter("all")}
                    className="ml-1.5 px-1 py-0.5 rounded"
                    style={{
                      background: "var(--bg-tertiary)",
                      color: "var(--text-secondary)",
                      fontSize: 9,
                    }}
                  >
                    清除筛选
                  </button>
                )}
              </span>
            </div>
          </div>
          {loading && !stats ? (
            <div
              className="text-center py-10"
              style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
            >
              加载中…
            </div>
          ) : filteredRecent.length === 0 ? (
            <div
              className="text-center py-10"
              style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
            >
              暂无预测记录
            </div>
          ) : (
            <table
              className="w-full"
              style={{ fontSize: "var(--font-xs)", borderCollapse: "collapse" }}
            >
              <thead>
                <tr
                  style={{
                    background: "var(--bg-tertiary)",
                    color: "var(--text-muted)",
                  }}
                >
                  <th className="px-3 py-1.5 text-left" style={{ width: 90 }}>
                    日期
                  </th>
                  <th className="px-2 py-1.5 text-left" style={{ width: 90 }}>
                    类型
                  </th>
                  <th className="px-2 py-1.5 text-left" style={{ width: 110 }}>
                    标的
                  </th>
                  <th className="px-2 py-1.5 text-left">预测内容</th>
                  <th className="px-2 py-1.5 text-left" style={{ width: 200 }}>
                    校验结果
                  </th>
                  <th
                    className="px-2 py-1.5 text-center"
                    style={{ width: 80 }}
                  >
                    判定
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRecent.map((r) => {
                  const meta = KIND_META[r.kind];
                  const KIcon = meta?.icon;
                  const isStock = ["promotion", "first_board", "avoid"].includes(r.kind);
                  const stockName = (r.payload?.name as string) || "";
                  const reason = (r.payload?.reason as string) || (r.payload?.tagline as string) || "";
                  const tilt = (r.payload?.tilt as string) || "";
                  const regime = (r.payload?.regime as string) || "";
                  const summary = isStock ? reason : tilt || regime || reason;
                  const verifyStr = r.verify_payload
                    ? Object.entries(r.verify_payload)
                        .filter(([k]) => k !== "reason")
                        .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(2) : v}`)
                        .join("  ")
                    : (r.verify_payload as { reason?: string } | null)?.reason || "—";
                  return (
                    <tr
                      key={`${r.trade_date}-${r.kind}-${r.key}`}
                      style={{
                        borderTop: "1px solid var(--border-color)",
                      }}
                    >
                      <td
                        className="px-3 py-1.5 tabular-nums"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {r.trade_date}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded font-bold"
                          style={{
                            background: meta ? `${meta.color}22` : "var(--bg-tertiary)",
                            color: meta?.color || "var(--text-secondary)",
                            fontSize: 10,
                          }}
                        >
                          {KIcon && <KIcon size={9} />}
                          {meta?.label || r.kind}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        {isStock ? (
                          <button
                            onClick={() => openStockDetail(r.key, stockName)}
                            className="font-bold tabular-nums hover:underline"
                            style={{
                              color: "var(--accent-blue)",
                              fontSize: 11,
                            }}
                            title={`查看 ${r.key} 行情`}
                          >
                            {r.key} {stockName}
                          </button>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>大盘</span>
                        )}
                      </td>
                      <td
                        className="px-2 py-1.5"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {summary}
                      </td>
                      <td
                        className="px-2 py-1.5 tabular-nums"
                        style={{
                          color: "var(--text-secondary)",
                          fontSize: 10,
                        }}
                      >
                        {verifyStr}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {r.verified_at == null ? (
                          <span
                            className="inline-flex items-center gap-0.5 font-bold"
                            style={{
                              color: "var(--text-muted)",
                              fontSize: 10,
                            }}
                            title="尚未到 T+3 校验时间"
                          >
                            <Clock size={10} />
                            等待
                          </span>
                        ) : r.hit ? (
                          <span
                            className="inline-flex items-center gap-0.5 font-bold"
                            style={{
                              color: "var(--accent-red)",
                              fontSize: 11,
                            }}
                          >
                            <CheckCircle2 size={11} />
                            命中
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-0.5 font-bold"
                            style={{
                              color: "var(--accent-green)",
                              fontSize: 11,
                            }}
                          >
                            <XCircle size={11} />
                            未中
                          </span>
                        )}
                        {isStock && (
                          <button
                            onClick={() => openWhyRose(r.key, stockName)}
                            className="ml-1 px-1 py-0.5 rounded"
                            style={{
                              background: "rgba(245,158,11,0.14)",
                              color: "var(--accent-orange)",
                              fontSize: 9,
                              border: "none",
                              cursor: "pointer",
                            }}
                            title="AI 复盘"
                          >
                            复盘
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {mode === "diagnosis" && (
        <DiagnosisPanel diag={diag} loading={diagLoading} onRefresh={loadDiagnosis} />
      )}

      {mode === "feedback" && (
        <div className="p-3">
          <FeedbackStatsPanel days={days} />
        </div>
      )}
    </div>
  );
}

function OverallCard({
  label,
  value,
  color,
  sub,
  isPlain,
}: {
  label: string;
  value: number | null | undefined;
  color: string;
  sub: string;
  isPlain?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        className="font-bold tabular-nums"
        style={{
          fontSize: 32,
          color,
          lineHeight: 1.1,
        }}
      >
        {value == null
          ? "—"
          : isPlain
          ? value.toLocaleString()
          : `${(value * 100).toFixed(1)}%`}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
        {sub}
      </div>
    </div>
  );
}


function DiagnosisPanel({
  diag,
  loading,
  onRefresh,
}: {
  diag: Diagnosis | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading && !diag) {
    return (
      <div className="p-3 text-center" style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}>
        策略诊断计算中…
      </div>
    );
  }
  if (!diag) {
    return (
      <div className="p-3 text-center" style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}>
        暂无诊断数据
      </div>
    );
  }

  const { items, summary, total_verified, window_days } = diag;
  const trend = items.hit_rate_trend || [];
  const regimeFailures = items.regime_failures || [];
  const stockBias = items.stock_bias || {};
  const calibration = items.high_conf_calibration;
  const timeDecay = items.time_decay || [];
  const modelComp = items.model_comparison || {};

  const BIAS_LABELS: Record<string, string> = {
    promotion: "晋级候选",
    first_board: "首板低吸",
    avoid: "风险规避",
  };

  return (
    <div className="p-3 space-y-3">
      <div
        className="px-3 py-2.5 rounded"
        style={{
          background: "linear-gradient(135deg, rgba(139,92,246,0.10), rgba(59,130,246,0.05))",
          border: "1px solid rgba(139,92,246,0.28)",
        }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <Stethoscope size={14} style={{ color: "var(--accent-purple)" }} />
            <span className="font-bold" style={{ fontSize: "var(--font-md)", color: "var(--text-primary)" }}>
              策略诊断总结
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {total_verified} 条已验证 · {window_days} 天窗口
            </span>
          </div>
          <button onClick={onRefresh} className="p-1 rounded" style={{ color: "var(--text-muted)" }}>
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        <div style={{ fontSize: "var(--font-sm)", color: "var(--text-primary)", lineHeight: 1.5 }}>
          {summary}
        </div>
      </div>

      {trend.length > 0 && (
        <DiagCard title="命中率趋势" subtitle="7 天滑动窗口">
          <div className="flex items-end gap-1" style={{ height: 60 }}>
            {trend.map((w, i) => {
              const rate = w.hit_rate;
              const h = Math.max(4, rate * 56);
              const color = rate >= 0.5 ? "var(--accent-red)" : rate >= 0.3 ? "var(--accent-orange)" : "var(--accent-green)";
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${w.start}~${w.end}: ${(rate*100).toFixed(0)}% (${w.hits}/${w.total})`}>
                  <div style={{ width: "100%", height: h, background: color, borderRadius: 2, minWidth: 8 }} />
                  <span style={{ fontSize: 8, color: "var(--text-muted)" }}>{(rate*100).toFixed(0)}</span>
                </div>
              );
            })}
          </div>
        </DiagCard>
      )}

      {Object.keys(stockBias).length > 0 && (
        <DiagCard title="个股预测偏差" subtitle="promotion / first_board / avoid">
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(stockBias).map(([kind, info]) => {
              const rate = info.hit_rate;
              const color = rate == null ? "var(--text-muted)" : rate >= 0.5 ? "var(--accent-red)" : rate >= 0.3 ? "var(--accent-orange)" : "var(--accent-green)";
              return (
                <div key={kind} className="text-center">
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>
                    {BIAS_LABELS[kind] || kind}
                  </div>
                  <div className="font-bold tabular-nums" style={{ fontSize: 20, color }}>
                    {rate == null ? "—" : `${(rate*100).toFixed(0)}%`}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)" }}>
                    {info.hits}/{info.total}
                  </div>
                </div>
              );
            })}
          </div>
        </DiagCard>
      )}

      {calibration && (
        <DiagCard title="置信度校准" subtitle="高分 (|score|≥0.5) vs 低分">
          <div className="grid grid-cols-2 gap-3">
            {(["high_score", "low_score"] as const).map((key) => {
              const b = calibration[key];
              const rate = b.hit_rate;
              const label = key === "high_score" ? "高置信度" : "低置信度";
              const warn = key === "high_score" && calibration.low_score.hit_rate != null && rate != null && rate < calibration.low_score.hit_rate;
              return (
                <div key={key} className="text-center">
                  <div className="flex items-center justify-center gap-1" style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>
                    {label}
                    {warn && <AlertTriangle size={10} style={{ color: "var(--accent-orange)" }} />}
                  </div>
                  <div className="font-bold tabular-nums" style={{ fontSize: 20, color: rate == null ? "var(--text-muted)" : rate >= 0.5 ? "var(--accent-red)" : "var(--accent-orange)" }}>
                    {rate == null ? "—" : `${(rate*100).toFixed(0)}%`}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{b.hits}/{b.total}</div>
                </div>
              );
            })}
          </div>
        </DiagCard>
      )}

      {timeDecay.length > 0 && (
        <DiagCard title="时间衰减" subtitle="按远/中/近三等分">
          <div className="flex items-center gap-2">
            {timeDecay.map((seg, i) => {
              const rate = seg.hit_rate;
              const color = rate >= 0.5 ? "var(--accent-red)" : rate >= 0.3 ? "var(--accent-orange)" : "var(--accent-green)";
              const segLabel = seg.segment === "early" ? "早期" : seg.segment === "middle" ? "中期" : "近期";
              return (
                <div key={seg.segment} className="flex items-center gap-2">
                  {i > 0 && <ArrowRight size={10} style={{ color: "var(--text-muted)" }} />}
                  <div className="text-center">
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{segLabel}</div>
                    <div className="font-bold tabular-nums" style={{ fontSize: 16, color }}>
                      {(rate*100).toFixed(0)}%
                    </div>
                    <div style={{ fontSize: 8, color: "var(--text-muted)" }}>{seg.hits}/{seg.total}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </DiagCard>
      )}

      {Object.keys(modelComp).length > 1 && (
        <DiagCard title="模型对比" subtitle="不同 LLM 的命中率">
          <div className="space-y-1.5">
            {Object.entries(modelComp).map(([model, info]) => (
              <div key={model} className="flex items-center gap-2">
                <span className="font-mono" style={{ fontSize: 11, color: "var(--text-secondary)", minWidth: 100 }}>{model}</span>
                <div className="flex-1 h-2 rounded" style={{ background: "var(--bg-tertiary)", overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, info.hit_rate * 100)}%`, height: "100%", background: info.hit_rate >= 0.5 ? "var(--accent-red)" : "var(--accent-orange)", borderRadius: 2 }} />
                </div>
                <span className="tabular-nums font-bold" style={{ fontSize: 11, color: "var(--text-primary)", minWidth: 40 }}>
                  {(info.hit_rate*100).toFixed(0)}%
                </span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{info.hits}/{info.total}</span>
              </div>
            ))}
          </div>
        </DiagCard>
      )}

      {regimeFailures.length > 0 && (
        <DiagCard title="大盘势失败案例" subtitle={`最近 ${regimeFailures.length} 条`}>
          <div className="space-y-1">
            {regimeFailures.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-2 py-1 rounded"
                style={{ background: "var(--bg-tertiary)", fontSize: 11 }}
              >
                <span className="tabular-nums" style={{ color: "var(--text-muted)", minWidth: 80 }}>{f.trade_date}</span>
                <span style={{ color: "var(--accent-orange)", fontWeight: 600 }}>{f.kind}</span>
                <span style={{ color: "var(--text-secondary)" }}>预测: {f.predicted || "—"}</span>
                <span style={{ color: "var(--text-muted)" }}>实际: {f.actual ? JSON.stringify(f.actual).slice(0, 50) : "—"}</span>
              </div>
            ))}
          </div>
        </DiagCard>
      )}
    </div>
  );
}


function DiagCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 4,
      }}
    >
      <div
        className="px-3 py-1.5 flex items-center gap-1.5"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <span className="font-bold" style={{ fontSize: "var(--font-sm)", color: "var(--text-primary)" }}>
          {title}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{subtitle}</span>
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}
