"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Telescope,
  Loader2,
  Square,
  ArrowLeft,
  Sparkles,
  History as HistoryIcon,
  ChevronDown,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useUIStore } from "@/stores/ui-store";
import { useSkillStore } from "@/stores/skill-store";
import {
  api,
  type SkillScanCandidate,
  type SkillScanFilter,
  type SkillScanMeta,
  type SkillScanRunMeta,
  type SkillScanRunDetail,
} from "@/lib/api";

/**
 * 体系扫描页：选 universe + top_n + skill → SSE 跑扫描 → 实时输出候选 → 展示总结
 *
 * 视图：
 *   - run     : 配置 + 实时扫描结果
 *   - history : 历史扫描列表
 *   - detail  : 历史扫描详情 (复用候选展示)
 */

const UNIVERSE_OPTIONS: Array<{ value: string; label: string; desc: string }> = [
  { value: "hs300", label: "沪深 300", desc: "蓝筹基本盘" },
  { value: "watchlist", label: "我的自选", desc: "只在自选里筛" },
  { value: "all", label: "全市场", desc: "覆盖最广（耗时最久 / 成本最高）" },
  { value: "industry:电子", label: "行业 · 电子", desc: "示例" },
  { value: "industry:医药生物", label: "行业 · 医药生物", desc: "示例" },
];

export function SkillScanPage() {
  const [view, setView] = useState<"run" | "history" | "detail">("run");
  const [detailId, setDetailId] = useState<number | null>(null);
  const setActiveModule = useUIStore((s) => s.setActiveModule);

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <PageHeader
        title="体系扫描"
        subtitle="按你的当前激活体系，从指定股票池里筛 + 排 + 点评"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveModule("skills")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-opacity hover:opacity-90"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                fontSize: "var(--font-sm)",
                border: "1px solid var(--border-color)",
              }}
            >
              <ArrowLeft size={12} />
              我的体系
            </button>
            {view === "run" ? (
              <button
                onClick={() => setView("history")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-opacity hover:opacity-90"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  fontSize: "var(--font-sm)",
                  border: "1px solid var(--border-color)",
                }}
              >
                <HistoryIcon size={12} />
                历史扫描
              </button>
            ) : (
              <button
                onClick={() => {
                  setView("run");
                  setDetailId(null);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-opacity hover:opacity-90"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  fontSize: "var(--font-sm)",
                  border: "1px solid var(--border-color)",
                }}
              >
                <ArrowLeft size={12} />
                返回扫描
              </button>
            )}
          </div>
        }
      />
      {view === "run" && <ScanRunner />}
      {view === "history" && (
        <HistoryView
          onPick={(id) => {
            setDetailId(id);
            setView("detail");
          }}
        />
      )}
      {view === "detail" && detailId !== null && (
        <HistoryDetail id={detailId} onBack={() => setView("history")} />
      )}
    </div>
  );
}

// ============================ runner ============================

function ScanRunner() {
  const activeRef = useSkillStore((s) => s.activeRef);
  const activeName = useSkillStore((s) => s.activeName);
  const systemOptions = useSkillStore((s) => s.systemOptions);
  const userOptions = useSkillStore((s) => s.userOptions);
  const setActiveAndPersist = useSkillStore((s) => s.setActiveAndPersist);
  const loadOptions = useSkillStore((s) => s.loadOptions);
  const loaded = useSkillStore((s) => s.loaded);

  const [universe, setUniverse] = useState<string>("");
  const [topN, setTopN] = useState(20);
  const [running, setRunning] = useState(false);
  const [meta, setMeta] = useState<SkillScanMeta | null>(null);
  const [filterStat, setFilterStat] = useState<SkillScanFilter | null>(null);
  const [candidates, setCandidates] = useState<SkillScanCandidate[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!loaded) loadOptions();
  }, [loaded, loadOptions]);

  useEffect(() => {
    return () => {
      stopRef.current?.();
    };
  }, []);

  const allOptions = useMemo(
    () => [...systemOptions, ...userOptions],
    [systemOptions, userOptions]
  );

  const startScan = useCallback(() => {
    if (!activeRef) {
      setErr("请先在右上角选一个体系");
      return;
    }
    if (!universe) {
      setErr("请选 universe");
      return;
    }
    setErr(null);
    setMeta(null);
    setFilterStat(null);
    setCandidates([]);
    setSummary("");
    setRunning(true);

    const stop = api.streamSkillScan(
      { skill_ref: activeRef, universe, top_n: topN },
      {
        onMeta: (m) => setMeta(m),
        onFilter: (f) => setFilterStat(f),
        onScore: (s) => {
          // 初始 score 列表（无 review）
          setCandidates(s.candidates);
        },
        onCandidate: (c) => {
          // 单只 review 流式补充
          setCandidates((prev) => {
            const idx = prev.findIndex((p) => p.code === c.code);
            if (idx === -1) return [...prev, c];
            const next = [...prev];
            next[idx] = { ...next[idx], ...c };
            return next;
          });
        },
        onSummary: (s) => setSummary(s.text),
        onDone: () => setRunning(false),
        onError: (m) => {
          setErr(m);
          setRunning(false);
        },
      }
    );
    Promise.resolve(stop).then((fn) => {
      stopRef.current = fn;
    });
  }, [activeRef, universe, topN]);

  const stopScan = () => {
    stopRef.current?.();
    setRunning(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* 配置区 */}
      <div
        className="rounded-lg p-4 mb-4"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}
      >
        <div className="flex flex-wrap items-end gap-3">
          {/* Skill picker */}
          <div className="flex-1 min-w-[200px] relative">
            <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>
              体系（必选）
            </label>
            <button
              onClick={() => setPickerOpen((v) => !v)}
              disabled={running}
              className="w-full flex items-center gap-2 px-3 py-2 rounded transition-opacity hover:opacity-90"
              style={{
                background: "var(--bg-tertiary)",
                color: activeName ? "var(--accent-purple)" : "var(--text-muted)",
                border: "1px solid var(--border-color)",
                fontSize: "var(--font-sm)",
              }}
            >
              <Sparkles size={12} />
              <span className="flex-1 text-left truncate">{activeName || "未选择"}</span>
              <ChevronDown size={12} />
            </button>
            {pickerOpen && (
              <div
                className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto rounded"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-color)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                }}
              >
                {allOptions.length === 0 ? (
                  <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    暂无可选体系
                  </div>
                ) : (
                  allOptions.map((o) => (
                    <button
                      key={o.ref}
                      onClick={async () => {
                        await setActiveAndPersist(o.ref);
                        setPickerOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:brightness-125"
                      style={{
                        background: activeRef === o.ref ? "var(--bg-tertiary)" : "transparent",
                        color: activeRef === o.ref ? "var(--accent-purple)" : "var(--text-primary)",
                        fontSize: "var(--font-sm)",
                      }}
                    >
                      {o.icon ? `${o.icon} ` : ""}
                      {o.name}
                      <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                        ({o.source === "system" ? "内置" : "我的"})
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Universe */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>
              股票池（每次选）
            </label>
            <select
              value={universe}
              onChange={(e) => setUniverse(e.target.value)}
              disabled={running}
              className="w-full px-3 py-2 rounded"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-color)",
                fontSize: "var(--font-sm)",
              }}
            >
              <option value="">— 请选 —</option>
              {UNIVERSE_OPTIONS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label} ({u.desc})
                </option>
              ))}
            </select>
          </div>

          {/* topN */}
          <div className="w-24">
            <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>
              候选 N
            </label>
            <input
              type="number"
              min={5}
              max={50}
              value={topN}
              onChange={(e) => setTopN(Math.max(5, Math.min(50, Number(e.target.value) || 20)))}
              disabled={running}
              className="w-full px-3 py-2 rounded"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-color)",
                fontSize: "var(--font-sm)",
              }}
            />
          </div>

          {/* run / stop */}
          {running ? (
            <button
              onClick={stopScan}
              className="flex items-center gap-1.5 px-4 py-2 rounded transition-opacity hover:opacity-90"
              style={{ background: "var(--accent-red)", color: "#fff", fontSize: "var(--font-sm)", fontWeight: 600 }}
            >
              <Square size={12} />
              停止
            </button>
          ) : (
            <button
              onClick={startScan}
              className="flex items-center gap-1.5 px-4 py-2 rounded transition-opacity hover:opacity-90"
              style={{ background: "var(--accent-purple)", color: "#fff", fontSize: "var(--font-sm)", fontWeight: 600 }}
            >
              <Telescope size={12} />
              开始扫描
            </button>
          )}
        </div>

        {err && (
          <div className="mt-3 text-sm" style={{ color: "var(--accent-red)" }}>
            {err}
          </div>
        )}

        {(meta || filterStat) && (
          <div
            className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {meta && (
              <>
                <div>体系: {meta.skill_name}</div>
                <div>股票池: {meta.universe}</div>
                <div>候选 N: {meta.top_n}</div>
              </>
            )}
            {filterStat && (
              <>
                <div>池内股票数: {filterStat.universe_size}</div>
                <div>硬过滤后: {filterStat.pre_filter_count}</div>
                <div>最终入选: {filterStat.final_count}</div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 候选区 */}
      {candidates.length > 0 && (
        <div className="space-y-2 mb-4">
          {candidates.map((c) => (
            <CandidateCard key={c.code} c={c} />
          ))}
        </div>
      )}

      {/* 总结 */}
      {summary && (
        <div
          className="rounded p-4"
          style={{
            background: "linear-gradient(135deg, rgba(139,92,246,0.10), rgba(59,130,246,0.06))",
            border: "1px solid rgba(139,92,246,0.30)",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={12} style={{ color: "var(--accent-purple)" }} />
            <span className="font-semibold" style={{ color: "var(--text-primary)", fontSize: "var(--font-sm)" }}>
              本轮扫描总结
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {summary}
          </p>
        </div>
      )}

      {!running && candidates.length === 0 && !err && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Telescope size={32} style={{ color: "var(--text-muted)", opacity: 0.6 }} />
          <p className="mt-3" style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}>
            选好体系和股票池，点「开始扫描」
          </p>
        </div>
      )}
    </div>
  );
}

function CandidateCard({ c }: { c: SkillScanCandidate }) {
  const setFocused = useUIStore((s) => s.setFocusedStock);
  const tier = c.tier || (c.score >= 80 ? "S" : c.score >= 60 ? "A" : "B");
  const tierColor =
    tier === "S"
      ? "var(--accent-red)"
      : tier === "A"
      ? "var(--accent-orange)"
      : "var(--accent-blue)";

  return (
    <div
      className="rounded p-3 flex gap-3"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
      }}
    >
      <div
        className="flex flex-col items-center justify-center flex-shrink-0"
        style={{
          width: 48,
          height: 48,
          borderRadius: 4,
          background: tierColor,
          color: "#fff",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800 }}>{tier}</div>
        <div style={{ fontSize: 10 }}>{c.score.toFixed(0)}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFocused({ code: c.code, name: c.name })}
            className="font-bold hover:underline"
            style={{ color: "var(--accent-orange)", fontSize: "var(--font-md)" }}
          >
            {c.code}
          </button>
          <span style={{ color: "var(--text-primary)", fontSize: "var(--font-sm)" }}>{c.name}</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {c.industry}
          </span>
        </div>
        {c.review ? (
          <div className="mt-1 text-sm" style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
            <span style={{ color: "var(--accent-blue)", fontWeight: 600 }}>看好: </span>
            {c.review.reason}
            <br />
            <span style={{ color: "var(--accent-orange)", fontWeight: 600 }}>注意: </span>
            {c.review.watchout}
          </div>
        ) : (
          <div className="mt-1 text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={10} className="animate-spin" />
            AI 点评生成中…
          </div>
        )}
        {c.factor_hits && c.factor_hits.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {c.factor_hits.slice(0, 6).map((f, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded text-xs"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  fontSize: 10,
                }}
                title={`权重 ${f.weight} · 贡献 ${f.contrib?.toFixed(2)}`}
              >
                {f.label || f.factor}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================ history ============================

function HistoryView({ onPick }: { onPick: (id: number) => void }) {
  const [rows, setRows] = useState<SkillScanRunMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSkillScanRuns(50)
      .then((r) => setRows(r.items))
      .catch((e) => setErr(e instanceof Error ? e.message : "加载失败"));
  }, []);

  if (err) return <div className="p-6" style={{ color: "var(--text-muted)" }}>{err}</div>;
  if (rows === null)
    return (
      <div className="p-6 flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
        <Loader2 size={14} className="animate-spin" />
        加载中…
      </div>
    );
  if (rows.length === 0)
    return <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>暂无历史扫描</div>;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      {rows.map((r) => (
        <button
          key={r.id}
          onClick={() => onPick(r.id)}
          className="w-full text-left rounded p-3 transition-colors hover:brightness-110"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {r.skill_name}
            </span>
            <span
              className="px-1.5 rounded text-xs"
              style={{
                background:
                  r.status === "done"
                    ? "rgba(59,130,246,0.15)"
                    : r.status === "failed"
                    ? "rgba(239,68,68,0.15)"
                    : "rgba(168,85,247,0.15)",
                color:
                  r.status === "done"
                    ? "var(--accent-blue)"
                    : r.status === "failed"
                    ? "var(--accent-red)"
                    : "var(--accent-purple)",
              }}
            >
              {r.status}
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {r.universe} · top {r.top_n} · 入选 {r.final_count ?? "-"}
            </span>
            {r.created_at && (
              <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
                {new Date(r.created_at).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
          {r.summary && (
            <p
              className="mt-1 text-xs truncate"
              style={{ color: "var(--text-muted)" }}
            >
              {r.summary}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}

function HistoryDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [data, setData] = useState<SkillScanRunDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getSkillScanRun(id).then(setData).catch((e) => setErr(e instanceof Error ? e.message : "加载失败"));
  }, [id]);

  if (err) return <div className="p-6" style={{ color: "var(--text-muted)" }}>{err}</div>;
  if (!data)
    return (
      <div className="p-6 flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
        <Loader2 size={14} className="animate-spin" />
        加载中…
      </div>
    );

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-opacity hover:opacity-90"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}
        >
          <ArrowLeft size={12} />
          返回历史列表
        </button>
        <h2 className="font-bold" style={{ color: "var(--text-primary)" }}>
          {data.skill_name}
        </h2>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {data.universe} · top {data.top_n}
        </span>
      </div>

      {data.summary && (
        <div
          className="rounded p-3 mb-3"
          style={{
            background: "rgba(139,92,246,0.08)",
            border: "1px solid rgba(139,92,246,0.30)",
          }}
        >
          <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
            {data.summary}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {(data.candidates || []).map((c) => (
          <CandidateCard key={c.code} c={c} />
        ))}
      </div>
    </div>
  );
}
