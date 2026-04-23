"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader } from "lucide-react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { CandlestickChart, BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  AxisPointerComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { api } from "@/lib/api";
import type { EChartsType } from "echarts/core";

echarts.use([
  CandlestickChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  AxisPointerComponent,
  CanvasRenderer,
]);

const UP = "#ef4444";
const DOWN = "#10b981";

const ONE_MONTH_DAYS = 32;
const SIX_MONTH_DAYS = 186;

const THROTTLE_MS = 200;

export type KlineLod = "day" | "week" | "month";

export type KlineChartProps = {
  code: string;
  defaultLod?: KlineLod;
  height?: number;
};

type KlineRow = { d: string; o: number; h: number; l: number; c: number; vol?: number };

function buildChartOption(dates: string[], rows: KlineRow[]): echarts.EChartsCoreOption {
  const candle: [number, number, number, number][] = rows.map((r) => [r.o, r.c, r.l, r.h]);
  const vols: number[] = rows.map((r) => (r.vol != null && Number.isFinite(r.vol) ? r.vol : 0));
  const volColors = rows.map((r) => (r.c >= r.o ? UP : DOWN));

  return {
    backgroundColor: "transparent",
    animation: true,
    grid: [
      { left: 48, right: 16, top: 8, height: "58%" },
      { left: 48, right: 16, top: "68%", height: "20%" },
    ],
    axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: "rgba(30,33,48,0.95)",
      borderColor: "rgba(75,85,99,0.5)",
      textStyle: { color: "#e5e7eb", fontSize: 11 },
    },
    xAxis: [
      {
        type: "category",
        data: dates,
        boundaryGap: true,
        axisLine: { lineStyle: { color: "#4b5563" } },
        axisLabel: { color: "#9ca3af", fontSize: 10, show: false },
        splitLine: { show: false },
        gridIndex: 0,
      },
      {
        type: "category",
        data: dates,
        boundaryGap: true,
        gridIndex: 1,
        axisLine: { lineStyle: { color: "#4b5563" } },
        axisLabel: { color: "#9ca3af", fontSize: 10 },
      },
    ],
    yAxis: [
      {
        scale: true,
        gridIndex: 0,
        splitLine: { lineStyle: { color: "rgba(75,85,99,0.4)" } },
        axisLine: { show: false },
        axisLabel: { color: "#9ca3af", fontSize: 10 },
      },
      {
        scale: true,
        gridIndex: 1,
        name: "量",
        nameTextStyle: { color: "#6b7280", fontSize: 10 },
        splitLine: { show: false },
        axisLine: { show: false },
        axisLabel: {
          color: "#9ca3af",
          fontSize: 9,
          formatter: (v: number) => {
            if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
            if (v >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
            return String(Math.round(v));
          },
        },
      },
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: [0, 1],
        start: 70,
        end: 100,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
      },
      {
        type: "slider",
        xAxisIndex: [0, 1],
        start: 70,
        end: 100,
        height: 18,
        bottom: 4,
        textStyle: { color: "#9ca3af", fontSize: 10 },
        dataBackground: {
          lineStyle: { color: "#374151" },
          areaStyle: { color: "rgba(55,65,81,0.35)" },
        },
        borderColor: "#4b5563",
        fillerColor: "rgba(59, 130, 246, 0.2)",
        handleStyle: { color: "#6b7280" },
        emphasis: { handleStyle: { color: "#9ca3af" } },
      },
    ],
    series: [
      {
        name: "K",
        type: "candlestick",
        data: candle,
        gridIndex: 0,
        xAxisIndex: 0,
        yAxisIndex: 0,
        itemStyle: {
          color: UP,
          color0: DOWN,
          borderColor: UP,
          borderColor0: DOWN,
        },
      },
      {
        name: "成交量",
        type: "bar",
        data: vols,
        gridIndex: 1,
        xAxisIndex: 1,
        yAxisIndex: 1,
        itemStyle: {
          color: (params: { dataIndex?: number }) =>
            volColors[params.dataIndex ?? 0] ?? "rgba(156,163,175,0.4)",
        },
        barWidth: "55%",
      },
    ],
  };
}

function extractDataZoomPercent(ev: unknown): { start: number; end: number } | null {
  const p = ev as { batch?: Array<{ start?: number; end?: number }>; start?: number; end?: number };
  if (p.batch?.length) {
    const b = p.batch[0];
    if (typeof b.start === "number" && typeof b.end === "number") {
      return { start: b.start, end: b.end };
    }
  }
  if (typeof p.start === "number" && typeof p.end === "number") {
    return { start: p.start, end: p.end };
  }
  return null;
}

function visibleSpanDays(dates: string[], startPct: number, endPct: number): number {
  if (dates.length < 2) return 0;
  const n = dates.length;
  const i0 = Math.max(0, Math.floor((startPct / 100) * n));
  const i1 = Math.min(n - 1, Math.max(i0, Math.ceil((endPct / 100) * n) - 1));
  const t0 = Date.parse(dates[i0]);
  const t1 = Date.parse(dates[i1]);
  if (Number.isNaN(t0) || Number.isNaN(t1)) return 0;
  return Math.max(0, (t1 - t0) / 86400000);
}

/** 可见区 < 约 1 个月 → 日K；< 6 个月 → 周K；否则月K。 */
function targetAutoLod(spanDays: number): KlineLod {
  if (spanDays < ONE_MONTH_DAYS) return "day";
  if (spanDays < SIX_MONTH_DAYS) return "week";
  return "month";
}

const lodLabel: Record<KlineLod, string> = { day: "日K", week: "周K", month: "月K" };

function KlineChartInner({ code, defaultLod = "month", height = 380 }: KlineChartProps) {
  const [lod, setLod] = useState<KlineLod>(defaultLod);
  const manualRef = useRef(false);
  const chartRef = useRef<EChartsType | null>(null);
  const zoomTRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const datesRef = useRef<string[]>([]);
  const lodRef = useRef(lod);
  const [autoHint, setAutoHint] = useState<string | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = undefined as string | undefined;
  const end = undefined as string | undefined;

  useEffect(() => {
    lodRef.current = lod;
  }, [lod]);

  const queryKey = useMemo(
    () => ["kline", code, lod, start ?? "", end ?? ""] as const,
    [code, lod, start, end],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      api.getKline(code, {
        lod,
        start,
        end,
        fields: "ohlc,vol",
      }),
    enabled: code.length > 0,
  });

  const rows = useMemo(() => {
    const r = data?.rows ?? [];
    return [...r].sort((a, b) => Date.parse(a.d) - Date.parse(b.d));
  }, [data?.rows]);

  const dates = useMemo(() => rows.map((x) => x.d), [rows]);

  useEffect(() => {
    datesRef.current = dates;
  }, [dates]);

  const option = useMemo(() => {
    if (rows.length === 0) return {} as echarts.EChartsCoreOption;
    return buildChartOption(dates, rows);
  }, [dates, rows]);

  useEffect(() => {
    const ch = chartRef.current;
    if (!ch) return;
    if (isFetching) {
      ch.showLoading("default", { text: "加载中…", color: "#9ca3af", textColor: "#e5e7eb" });
    } else {
      ch.hideLoading();
    }
  }, [isFetching]);

  const showAutoHint = useCallback((next: KlineLod) => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    setAutoHint(`已切换到${lodLabel[next]}`);
    hintTimerRef.current = setTimeout(() => setAutoHint(null), 2500);
  }, []);

  const onDataZoom = useCallback(
    (ev: unknown) => {
      if (manualRef.current) return;
      const r = extractDataZoomPercent(ev);
      if (!r) return;
      const span = visibleSpanDays(datesRef.current, r.start, r.end);
      const next = targetAutoLod(span);
      if (next === lodRef.current) return;
      showAutoHint(next);
      setLod(next);
    },
    [showAutoHint],
  );

  const onDataZoomDebounced = useCallback(
    (ev: unknown) => {
      if (zoomTRef.current) clearTimeout(zoomTRef.current);
      zoomTRef.current = setTimeout(() => {
        zoomTRef.current = null;
        onDataZoom(ev);
      }, THROTTLE_MS);
    },
    [onDataZoom],
  );

  useEffect(
    () => () => {
      if (zoomTRef.current) clearTimeout(zoomTRef.current);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    },
    [],
  );

  const onToggle = (next: KlineLod) => {
    manualRef.current = true;
    setLod(next);
  };

  return (
    <div
      className="relative rounded-lg border border-gray-700 bg-gray-900 text-gray-200"
      style={{ minHeight: height }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-700 px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded-md border border-gray-600 bg-gray-800/80 p-0.5">
          {(["day", "week", "month"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onToggle(k)}
              className={
                lod === k
                  ? "rounded bg-gray-700 px-2 py-0.5 text-xs font-medium text-white"
                  : "rounded px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200"
              }
            >
              {lodLabel[k]}
            </button>
          ))}
        </div>
        {(isLoading || isFetching) && (
          <Loader className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
        )}
        {autoHint && (
          <span className="text-xs text-amber-400/90" role="status">
            {autoHint}
          </span>
        )}
      </div>

      {isError && (
        <div className="flex items-center justify-between gap-2 border-b border-red-900/50 bg-red-950/40 px-2 py-1 text-xs text-red-300">
          <span>加载失败 {error instanceof Error ? error.message : ""}</span>
          <button
            type="button"
            className="shrink-0 rounded border border-red-500/60 px-2 py-0.5 text-red-200 hover:bg-red-900/50"
            onClick={() => void refetch()}
          >
            重试
          </button>
        </div>
      )}

      <div className="px-1 pb-1" style={{ height }}>
        {rows.length > 0 && Object.keys(option).length > 0 ? (
          <ReactEChartsCore
            echarts={echarts}
            option={option}
            style={{ width: "100%", height: "100%" }}
            notMerge
            lazyUpdate
            onChartReady={(c) => {
              chartRef.current = c as unknown as EChartsType;
            }}
            onEvents={{
              dataZoom: onDataZoomDebounced,
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            {isLoading || isFetching ? "加载中…" : "暂无数据"}
          </div>
        )}
      </div>
    </div>
  );
}

export function KlineChart(props: KlineChartProps) {
  const { code, defaultLod = "month" } = props;
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <KlineChartInner key={`${code}:${defaultLod}`} {...props} />
    </QueryClientProvider>
  );
}
