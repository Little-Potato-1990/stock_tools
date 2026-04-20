"use client";

import { useEffect, useState, useCallback } from "react";
import { X, RefreshCw, Sparkles, MessageSquare, ExternalLink, Zap, ChevronRight, AlertTriangle } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { api } from "@/lib/api";

type WhyRose = Awaited<ReturnType<typeof api.getWhyRose>>;

const VERDICT_COLOR: Record<WhyRose["verdict"], string> = {
  S: "var(--accent-purple)",
  A: "var(--accent-red)",
  B: "var(--accent-orange)",
  C: "var(--accent-green)",
};

const VERDICT_DESC: Record<WhyRose["verdict"], string> = {
  S: "罕见龙头 — 高度+空间+人气三要素齐备, 主线核心位置",
  A: "典型龙头 — 题材主升, 高度领先, 资金共识强",
  B: "标准龙头 — 跟随主线, 中规中矩, 缺少超预期",
  C: "偏弱 — 题材边缘 / 高位炸板风险大 / 量能不济",
};

export function WhyRoseModal() {
  const target = useUIStore((s) => s.whyRoseStock);
  const close = useUIStore((s) => s.closeWhyRose);
  const askAI = useUIStore((s) => s.askAI);
  const openStockDetail = useUIStore((s) => s.openStockDetail);

  const [data, setData] = useState<WhyRose | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api.getWhyRose(target.code, target.tradeDate, refresh);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    if (!target) {
      setData(null);
      return;
    }
    load();
  }, [target, load]);

  if (!target) return null;

  const isUp = data?.direction === "rose";
  const accent = isUp ? "var(--accent-red)" : "var(--accent-green)";
  const verdictColor = data ? VERDICT_COLOR[data.verdict] : "var(--text-muted)";

  const handleAsk = () => {
    if (!data) return;
    const driverText = data.drivers.map((d) => `${d.label}: ${d.text}`).join("\n");
    const prompt = [
      `${data.name}(${data.code}) 今日 AI 解读 (verdict: ${data.verdict} ${data.verdict_label}):`,
      data.headline,
      "",
      "驱动:",
      driverText,
      "",
      `卡位: ${data.position.text}`,
      `高度: ${data.height.text}`,
      `明日策略: ${data.tomorrow.text}`,
      "",
      "请进一步给出: (1) 该结论的可证伪点 (2) 同板块对比下的相对优势/劣势 (3) 我应该如何操作 (持仓/观望/规避).",
    ].join("\n");
    askAI(prompt, { code: data.code, name: data.name });
    close();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.55)" }}
        onClick={close}
      />
      <div
        className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 overflow-hidden"
        style={{
          width: 480,
          maxHeight: "85vh",
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: 6,
          boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{
            background: "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={14} style={{ color: "var(--accent-purple)" }} />
            <span
              className="font-bold"
              style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
            >
              {target.name || data?.name || target.code}
            </span>
            <span
              className="tabular-nums"
              style={{ color: "var(--text-muted)", fontSize: 11 }}
            >
              {target.code}
            </span>
            <button
              onClick={() => {
                openStockDetail(target.code, target.name);
                close();
              }}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors"
              style={{
                color: "var(--accent-blue)",
                fontSize: 10,
                background: "rgba(59,130,246,0.1)",
              }}
              title="查看完整行情"
            >
              <ExternalLink size={9} />
              行情
            </button>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="p-1 rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
              title="刷新 AI 结论"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={close}
              className="p-1 rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: "calc(85vh - 102px)" }}>
          {loading && !data ? (
            <div className="px-4 py-10 text-center" style={{ color: "var(--text-muted)" }}>
              <RefreshCw size={22} className="animate-spin mx-auto mb-3" style={{ color: "var(--accent-purple)" }} />
              <div style={{ fontSize: "var(--font-md)", fontWeight: 600, color: "var(--text-secondary)" }}>
                AI 正在分析中…
              </div>
              <div className="mt-1.5" style={{ fontSize: 10 }}>
                首次解读约 30-60 秒, 后续 30 分钟内秒回
              </div>
            </div>
          ) : error ? (
            <div
              className="m-4 px-3 py-2 flex items-start gap-2"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 4,
                color: "var(--accent-red)",
                fontSize: 11,
              }}
            >
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          ) : data ? (
            <div className="px-4 py-3 space-y-3">
              <div className="flex items-start gap-2">
                <span
                  className="font-bold inline-flex items-center justify-center flex-shrink-0"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 4,
                    background: verdictColor,
                    color: "#fff",
                    fontSize: 16,
                  }}
                  title={VERDICT_DESC[data.verdict]}
                >
                  {data.verdict}
                </span>
                <div className="flex-1 min-w-0">
                  <div
                    className="font-bold"
                    style={{
                      color: accent,
                      fontSize: "var(--font-md)",
                      lineHeight: 1.4,
                    }}
                  >
                    {data.headline}
                  </div>
                  <div
                    className="mt-1 flex items-center gap-2"
                    style={{ fontSize: 10, color: "var(--text-muted)" }}
                  >
                    <span style={{ color: verdictColor, fontWeight: 600 }}>
                      {data.verdict_label}
                    </span>
                    <span>·</span>
                    <span>{data.trade_date}</span>
                    <span>·</span>
                    <span>{data.model}</span>
                  </div>
                </div>
              </div>

              <div>
                <div
                  className="flex items-center gap-1 mb-1.5"
                  style={{ color: "var(--text-muted)", fontSize: 10 }}
                >
                  <Zap size={10} />
                  真实驱动
                </div>
                <div className="space-y-1.5">
                  {data.drivers.length === 0 ? (
                    <div
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 11,
                        fontStyle: "italic",
                      }}
                    >
                      未识别到明确驱动
                    </div>
                  ) : (
                    data.drivers.map((d, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 px-2.5 py-1.5"
                        style={{
                          background: "var(--bg-card)",
                          border: "1px solid var(--border-color)",
                          borderRadius: 3,
                        }}
                      >
                        <span
                          className="font-bold flex-shrink-0"
                          style={{
                            padding: "1px 6px",
                            borderRadius: 2,
                            background: "rgba(168,85,247,0.15)",
                            color: "var(--accent-purple)",
                            fontSize: 10,
                          }}
                        >
                          {d.label}
                        </span>
                        <span
                          style={{
                            color: "var(--text-secondary)",
                            fontSize: "var(--font-sm)",
                            lineHeight: 1.45,
                          }}
                        >
                          {d.text}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <FieldCard label={data.position.label} text={data.position.text} accent="var(--accent-blue)" />
              <FieldCard label={data.height.label} text={data.height.text} accent="var(--accent-orange)" />
              <FieldCard label={data.tomorrow.label} text={data.tomorrow.text} accent={accent} />
            </div>
          ) : null}
        </div>

        <div
          className="flex items-center justify-end gap-1.5 px-4 py-2"
          style={{
            background: "var(--bg-secondary)",
            borderTop: "1px solid var(--border-color)",
          }}
        >
          <button
            onClick={close}
            className="px-2.5 py-1 rounded transition-colors"
            style={{
              color: "var(--text-muted)",
              fontSize: "var(--font-xs)",
              background: "transparent",
            }}
          >
            关闭
          </button>
          <button
            onClick={handleAsk}
            disabled={!data}
            className="flex items-center gap-1 px-2.5 py-1 rounded transition-colors"
            style={{
              background: data ? "var(--accent-purple)" : "var(--bg-tertiary)",
              color: data ? "#fff" : "var(--text-muted)",
              fontSize: "var(--font-xs)",
              fontWeight: 600,
            }}
            title="把这个结论作为 prompt 注入 AI 副驾, 进一步追问"
          >
            <MessageSquare size={10} />
            追问 AI
            <ChevronRight size={10} />
          </button>
        </div>
      </div>
    </>
  );
}

function FieldCard({ label, text, accent }: { label: string; text: string; accent: string }) {
  return (
    <div>
      <div
        className="mb-1"
        style={{ color: accent, fontSize: 10, fontWeight: 600 }}
      >
        {label}
      </div>
      <div
        className="px-2.5 py-1.5"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: 3,
          color: "var(--text-secondary)",
          fontSize: "var(--font-sm)",
          lineHeight: 1.5,
        }}
      >
        {text}
      </div>
    </div>
  );
}
