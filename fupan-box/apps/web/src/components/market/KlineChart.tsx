"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader } from "lucide-react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { CandlestickChart, BarChart, ScatterChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  AxisPointerComponent,
  MarkLineComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { api } from "@/lib/api";
import type { EChartsType } from "echarts/core";

echarts.use([
  CandlestickChart,
  BarChart,
  ScatterChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  AxisPointerComponent,
  MarkLineComponent,
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
  tradeMarks?: Array<{ date: string; side: "buy" | "sell"; price?: number; qty?: number }>;
  variant?: "simple" | "ths";
};

type KlineRow = { d: string; o: number; h: number; l: number; c: number; vol?: number; turnover?: number };
type MainIndicator = "MA" | "EMA" | "BOLL" | "NONE";
type SubIndicator = "VOL" | "AMOUNT" | "MACD" | "KDJ";
type Sub2Indicator = "RSI" | "WR" | "CCI" | "NONE";

function normalizeDateKey(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const m = s.match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}

function mean(values: Array<number | null | undefined>): number | null {
  const arr = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function rollingMean(values: number[], window: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (window <= 1) return values.map((v) => (Number.isFinite(v) ? v : null));
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

function emaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (!values.length) return out;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    ema = i === 0 ? v : v * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function macd(values: number[]): { dif: Array<number | null>; dea: Array<number | null>; hist: Array<number | null> } {
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  const dif = values.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? (ema12[i] as number) - (ema26[i] as number) : null,
  );
  const dea = emaSeries(
    dif.map((v) => (v == null ? 0 : v)),
    9,
  );
  const hist = values.map((_, i) =>
    dif[i] != null && dea[i] != null ? ((dif[i] as number) - (dea[i] as number)) * 2 : null,
  );
  return { dif, dea, hist };
}

function rsi(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function wr(rows: KlineRow[], period = 14): Array<number | null> {
  const out: Array<number | null> = Array(rows.length).fill(null);
  for (let i = period - 1; i < rows.length; i += 1) {
    const slice = rows.slice(i - period + 1, i + 1);
    const hh = Math.max(...slice.map((x) => x.h));
    const ll = Math.min(...slice.map((x) => x.l));
    if (hh === ll) {
      out[i] = 0;
    } else {
      out[i] = ((hh - rows[i].c) / (hh - ll)) * -100;
    }
  }
  return out;
}

function cci(rows: KlineRow[], period = 14): Array<number | null> {
  const tp = rows.map((r) => (r.h + r.l + r.c) / 3);
  const ma = rollingMean(tp, period);
  const out: Array<number | null> = Array(rows.length).fill(null);
  for (let i = period - 1; i < rows.length; i += 1) {
    const winTp = tp.slice(i - period + 1, i + 1);
    const maVal = ma[i];
    if (maVal == null) continue;
    const md = mean(winTp.map((v) => Math.abs(v - maVal)));
    if (!md || md === 0) continue;
    out[i] = (tp[i] - maVal) / (0.015 * md);
  }
  return out;
}

function kdj(rows: KlineRow[], period = 9): { k: Array<number | null>; d: Array<number | null>; j: Array<number | null> } {
  const rsv: Array<number | null> = Array(rows.length).fill(null);
  for (let i = period - 1; i < rows.length; i += 1) {
    const slice = rows.slice(i - period + 1, i + 1);
    const hh = Math.max(...slice.map((x) => x.h));
    const ll = Math.min(...slice.map((x) => x.l));
    rsv[i] = hh === ll ? 50 : ((rows[i].c - ll) / (hh - ll)) * 100;
  }
  const k: Array<number | null> = Array(rows.length).fill(null);
  const d: Array<number | null> = Array(rows.length).fill(null);
  const j: Array<number | null> = Array(rows.length).fill(null);
  let kv = 50;
  let dv = 50;
  for (let i = 0; i < rows.length; i += 1) {
    const rv = rsv[i];
    if (rv == null) continue;
    kv = (2 / 3) * kv + (1 / 3) * rv;
    dv = (2 / 3) * dv + (1 / 3) * kv;
    k[i] = kv;
    d[i] = dv;
    j[i] = 3 * kv - 2 * dv;
  }
  return { k, d, j };
}

function buildSimpleChartOption(
  dates: string[],
  rows: KlineRow[],
  tradeMarks: Array<{ date: string; side: "buy" | "sell"; price?: number; qty?: number }> = [],
): echarts.EChartsCoreOption {
  const candle: [number, number, number, number][] = rows.map((r) => [r.o, r.c, r.l, r.h]);
  const vols: number[] = rows.map((r) => (r.vol != null && Number.isFinite(r.vol) ? r.vol : 0));
  const volColors = rows.map((r) => (r.c >= r.o ? UP : DOWN));
  const rowByDate = new Map(rows.map((r) => [normalizeDateKey(r.d), r]));
  const dateKeyToAxisDate = new Map(rows.map((r) => [normalizeDateKey(r.d), r.d]));
  const sortedDateKeys = Array.from(dateKeyToAxisDate.keys()).sort();
  const resolveAxisDate = (key: string): string | null => {
    const exact = dateKeyToAxisDate.get(key);
    if (exact) return exact;
    // 非交易日回退到最近一个交易日，避免日期口径差导致标记丢失
    for (let i = sortedDateKeys.length - 1; i >= 0; i -= 1) {
      if (sortedDateKeys[i] <= key) {
        return dateKeyToAxisDate.get(sortedDateKeys[i]) ?? null;
      }
    }
    return null;
  };
  const markCountByDate = new Map<string, number>();
  const buyLabelData: Array<[string, number]> = [];
  const sellLabelData: Array<[string, number]> = [];
  const buyLineData: Array<[{ coord: [string, number] }, { coord: [string, number] }]> = [];
  const sellLineData: Array<[{ coord: [string, number] }, { coord: [string, number] }]> = [];
  tradeMarks
    .map((m) => {
      const key = normalizeDateKey(m.date);
      const axisDate = resolveAxisDate(key);
      if (!axisDate) return null;
      const row = rowByDate.get(normalizeDateKey(axisDate));
      const low = row?.l ?? row?.c ?? 0;
      const high = row?.h ?? row?.c ?? 0;
      const base = m.side === "buy" ? low : high;
      const spread = Math.max((high - low) || 0, (row?.c ?? 0) * 0.015, 0.05);
      const idxOnSameDate = markCountByDate.get(key) ?? 0;
      markCountByDate.set(key, idxOnSameDate + 1);
      const offset = spread * (0.9 + idxOnSameDate * 0.7);
      const labelY = m.side === "buy" ? base - offset : base + offset;
      if (m.side === "buy") {
        buyLabelData.push([axisDate, labelY]);
        buyLineData.push([{ coord: [axisDate, base] }, { coord: [axisDate, labelY] }]);
      } else {
        sellLabelData.push([axisDate, labelY]);
        sellLineData.push([{ coord: [axisDate, base] }, { coord: [axisDate, labelY] }]);
      }
      return true;
    })
    .filter(Boolean);

  return {
    backgroundColor: "transparent",
    // 三图模式优先跟手性，关闭更新动画避免蜡烛图拖影延迟
    animation: false,
    animationDuration: 0,
    animationDurationUpdate: 0,
    animationEasingUpdate: "linear",
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
        animation: false,
        animationDuration: 0,
        animationDurationUpdate: 0,
        animationEasingUpdate: "linear",
        progressive: 0,
        progressiveThreshold: 0,
        hoverAnimation: false,
        silent: true,
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
        animation: false,
        animationDuration: 0,
        animationDurationUpdate: 0,
        animationEasingUpdate: "linear",
        progressive: 0,
        progressiveThreshold: 0,
        silent: true,
        itemStyle: {
          color: (params: { dataIndex?: number }) =>
            volColors[params.dataIndex ?? 0] ?? "rgba(156,163,175,0.4)",
        },
        barWidth: "55%",
      },
      {
        name: "买入标记",
        type: "scatter",
        data: buyLabelData,
        xAxisIndex: 0,
        yAxisIndex: 0,
        symbolSize: 14,
        itemStyle: { color: "#60a5fa" },
        label: {
          show: true,
          formatter: "B",
          color: "#ffffff",
          fontSize: 9,
          fontWeight: 700,
          position: "inside",
        },
        markLine: buyLineData.length
          ? {
              symbol: "none",
              silent: true,
              lineStyle: { color: "#60a5fa", width: 1, type: "dashed" },
              data: buyLineData,
            }
          : undefined,
      },
      {
        name: "卖出标记",
        type: "scatter",
        data: sellLabelData,
        xAxisIndex: 0,
        yAxisIndex: 0,
        symbolSize: 14,
        itemStyle: { color: "#f472b6" },
        label: {
          show: true,
          formatter: "S",
          color: "#ffffff",
          fontSize: 9,
          fontWeight: 700,
          position: "inside",
        },
        markLine: sellLineData.length
          ? {
              symbol: "none",
              silent: true,
              lineStyle: { color: "#f472b6", width: 1, type: "dashed" },
              data: sellLineData,
            }
          : undefined,
      },
    ],
  };
}

function buildThsChartOption(
  dates: string[],
  rows: KlineRow[],
  mainIndicator: MainIndicator,
  sub1: SubIndicator,
  sub2: Sub2Indicator,
): echarts.EChartsCoreOption {
  const closes = rows.map((r) => r.c);
  const vols = rows.map((r) => (r.vol != null && Number.isFinite(r.vol) ? r.vol : 0));
  const amounts = rows.map((r) => (r.turnover != null && Number.isFinite(r.turnover) ? r.turnover : 0));
  const volColors = rows.map((r) => (r.c >= r.o ? UP : DOWN));
  const candle: [number, number, number, number][] = rows.map((r) => [r.o, r.c, r.l, r.h]);

  const ma5 = rollingMean(closes, 5);
  const ma10 = rollingMean(closes, 10);
  const ma20 = rollingMean(closes, 20);
  const ma30 = rollingMean(closes, 30);
  const ma60 = rollingMean(closes, 60);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const mid = rollingMean(closes, 20);
  const std20 = closes.map((_, i) => {
    if (i < 19 || mid[i] == null) return null;
    const s = closes.slice(i - 19, i + 1);
    const m = mid[i] as number;
    return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
  });
  const bollUp = closes.map((_, i) => (mid[i] != null && std20[i] != null ? (mid[i] as number) + 2 * (std20[i] as number) : null));
  const bollDn = closes.map((_, i) => (mid[i] != null && std20[i] != null ? (mid[i] as number) - 2 * (std20[i] as number) : null));

  const macdData = macd(closes);
  const kdjData = kdj(rows);
  const rsi14 = rsi(closes, 14);
  const wr14 = wr(rows, 14);
  const cci14 = cci(rows, 14);
  const amountMa5 = rollingMean(amounts, 5);
  const amountMa10 = rollingMean(amounts, 10);
  const volMa5 = rollingMean(vols, 5);
  const volMa10 = rollingMean(vols, 10);

  const series: echarts.SeriesOption[] = [
    {
      name: "K",
      type: "candlestick",
      data: candle,
      xAxisIndex: 0,
      yAxisIndex: 0,
      animation: false,
      animationDuration: 0,
      animationDurationUpdate: 0,
      animationEasingUpdate: "linear",
      progressive: 0,
      progressiveThreshold: 0,
      hoverAnimation: false,
      silent: true,
      itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
    },
  ];

  if (mainIndicator === "MA") {
    series.push(
      { name: "MA5", type: "line", data: ma5, xAxisIndex: 0, yAxisIndex: 0, symbol: "none", lineStyle: { width: 1, color: "#f59e0b" } },
      { name: "MA10", type: "line", data: ma10, xAxisIndex: 0, yAxisIndex: 0, symbol: "none", lineStyle: { width: 1, color: "#3b82f6" } },
      { name: "MA20", type: "line", data: ma20, xAxisIndex: 0, yAxisIndex: 0, symbol: "none", lineStyle: { width: 1, color: "#d946ef" } },
      { name: "MA30", type: "line", data: ma30, xAxisIndex: 0, yAxisIndex: 0, symbol: "none", lineStyle: { width: 1, color: "#22d3ee" } },
      { name: "MA60", type: "line", data: ma60, xAxisIndex: 0, yAxisIndex: 0, symbol: "none", lineStyle: { width: 1, color: "#f97316" } },
    );
  } else if (mainIndicator === "EMA") {
    series.push(
      { name: "EMA12", type: "line", data: ema12, xAxisIndex: 0, yAxisIndex: 0, symbol: "none", lineStyle: { width: 1, color: "#22d3ee" } },
      { name: "EMA26", type: "line", data: ema26, xAxisIndex: 0, yAxisIndex: 0, symbol: "none", lineStyle: { width: 1, color: "#f97316" } },
    );
  } else if (mainIndicator === "BOLL") {
    series.push(
      { name: "BOLL", type: "line", data: mid, xAxisIndex: 0, yAxisIndex: 0, symbol: "none", lineStyle: { width: 1, color: "#f59e0b" } },
      { name: "UP", type: "line", data: bollUp, xAxisIndex: 0, yAxisIndex: 0, symbol: "none", lineStyle: { width: 1, color: "#3b82f6" } },
      { name: "DN", type: "line", data: bollDn, xAxisIndex: 0, yAxisIndex: 0, symbol: "none", lineStyle: { width: 1, color: "#10b981" } },
    );
  }

  if (sub1 === "VOL") {
    series.push(
      {
        name: "成交量",
        type: "bar",
        data: vols,
        xAxisIndex: 1,
        yAxisIndex: 1,
        animation: false,
        animationDuration: 0,
        animationDurationUpdate: 0,
        animationEasingUpdate: "linear",
        progressive: 0,
        progressiveThreshold: 0,
        silent: true,
        itemStyle: { color: (p: { dataIndex?: number }) => volColors[p.dataIndex ?? 0] ?? "#94a3b8" },
        barWidth: "55%",
      },
      { name: "VOLMA5", type: "line", data: volMa5, xAxisIndex: 1, yAxisIndex: 1, symbol: "none", lineStyle: { width: 1, color: "#f59e0b" } },
      { name: "VOLMA10", type: "line", data: volMa10, xAxisIndex: 1, yAxisIndex: 1, symbol: "none", lineStyle: { width: 1, color: "#3b82f6" } },
    );
  } else if (sub1 === "AMOUNT") {
    series.push(
      {
        name: "成交额",
        type: "bar",
        data: amounts,
        xAxisIndex: 1,
        yAxisIndex: 1,
        animation: false,
        animationDuration: 0,
        animationDurationUpdate: 0,
        animationEasingUpdate: "linear",
        progressive: 0,
        progressiveThreshold: 0,
        silent: true,
        itemStyle: { color: (p: { dataIndex?: number }) => volColors[p.dataIndex ?? 0] ?? "#94a3b8" },
        barWidth: "55%",
      },
      { name: "额MA5", type: "line", data: amountMa5, xAxisIndex: 1, yAxisIndex: 1, symbol: "none", lineStyle: { width: 1, color: "#f59e0b" } },
      { name: "额MA10", type: "line", data: amountMa10, xAxisIndex: 1, yAxisIndex: 1, symbol: "none", lineStyle: { width: 1, color: "#3b82f6" } },
    );
  } else if (sub1 === "MACD") {
    series.push(
      {
        name: "MACD",
        type: "bar",
        data: macdData.hist,
        xAxisIndex: 1,
        yAxisIndex: 1,
        animation: false,
        animationDuration: 0,
        animationDurationUpdate: 0,
        animationEasingUpdate: "linear",
        progressive: 0,
        progressiveThreshold: 0,
        silent: true,
        itemStyle: { color: (p: { data?: number }) => ((p.data ?? 0) >= 0 ? UP : DOWN) },
        barWidth: "55%",
      },
      { name: "DIF", type: "line", data: macdData.dif, xAxisIndex: 1, yAxisIndex: 1, symbol: "none", lineStyle: { width: 1, color: "#f59e0b" } },
      { name: "DEA", type: "line", data: macdData.dea, xAxisIndex: 1, yAxisIndex: 1, symbol: "none", lineStyle: { width: 1, color: "#3b82f6" } },
    );
  } else if (sub1 === "KDJ") {
    series.push(
      { name: "K", type: "line", data: kdjData.k, xAxisIndex: 1, yAxisIndex: 1, symbol: "none", lineStyle: { width: 1, color: "#f59e0b" } },
      { name: "D", type: "line", data: kdjData.d, xAxisIndex: 1, yAxisIndex: 1, symbol: "none", lineStyle: { width: 1, color: "#3b82f6" } },
      { name: "J", type: "line", data: kdjData.j, xAxisIndex: 1, yAxisIndex: 1, symbol: "none", lineStyle: { width: 1, color: "#d946ef" } },
    );
  }

  if (sub2 === "RSI") {
    series.push({
      name: "RSI14",
      type: "line",
      data: rsi14,
      xAxisIndex: 2,
      yAxisIndex: 2,
      symbol: "none",
      lineStyle: { width: 1, color: "#f59e0b" },
      markLine: {
        symbol: "none",
        silent: true,
        lineStyle: { type: "dashed", color: "rgba(156,163,175,0.45)" },
        data: [{ yAxis: 30 }, { yAxis: 70 }],
      },
    });
  } else if (sub2 === "WR") {
    series.push({
      name: "WR14",
      type: "line",
      data: wr14,
      xAxisIndex: 2,
      yAxisIndex: 2,
      symbol: "none",
      lineStyle: { width: 1, color: "#22d3ee" },
    });
  } else if (sub2 === "CCI") {
    series.push({
      name: "CCI14",
      type: "line",
      data: cci14,
      xAxisIndex: 2,
      yAxisIndex: 2,
      symbol: "none",
      lineStyle: { width: 1, color: "#f97316" },
      markLine: {
        symbol: "none",
        silent: true,
        lineStyle: { type: "dashed", color: "rgba(156,163,175,0.45)" },
        data: [{ yAxis: -100 }, { yAxis: 100 }],
      },
    });
  }

  return {
    backgroundColor: "transparent",
    animation: true,
    grid: [
      { left: 48, right: 16, top: 8, height: "45%" },
      { left: 48, right: 16, top: "58%", height: "16%" },
      { left: 48, right: 16, top: "79%", height: "12%" },
    ],
    axisPointer: { link: [{ xAxisIndex: [0, 1, 2] }] },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: "rgba(30,33,48,0.95)",
      borderColor: "rgba(75,85,99,0.5)",
      textStyle: { color: "#e5e7eb", fontSize: 11 },
    },
    xAxis: [
      { type: "category", data: dates, boundaryGap: true, axisLine: { lineStyle: { color: "#4b5563" } }, axisLabel: { show: false }, splitLine: { show: false }, gridIndex: 0 },
      { type: "category", data: dates, boundaryGap: true, axisLine: { lineStyle: { color: "#4b5563" } }, axisLabel: { show: false }, splitLine: { show: false }, gridIndex: 1 },
      { type: "category", data: dates, boundaryGap: true, axisLine: { lineStyle: { color: "#4b5563" } }, axisLabel: { color: "#9ca3af", fontSize: 10 }, splitLine: { show: false }, gridIndex: 2 },
    ],
    yAxis: [
      { scale: true, gridIndex: 0, splitLine: { lineStyle: { color: "rgba(75,85,99,0.35)" } }, axisLine: { show: false }, axisLabel: { color: "#9ca3af", fontSize: 10 } },
      { scale: true, gridIndex: 1, splitLine: { lineStyle: { color: "rgba(75,85,99,0.25)" } }, axisLine: { show: false }, axisLabel: { color: "#9ca3af", fontSize: 9 } },
      { scale: true, gridIndex: 2, splitLine: { lineStyle: { color: "rgba(75,85,99,0.25)" } }, axisLine: { show: false }, axisLabel: { color: "#9ca3af", fontSize: 9 } },
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: [0, 1, 2],
        start: 70,
        end: 100,
        // ths 交互改为自定义手势:
        // - 横向双指滑动 => 平移
        // - 纵向双指滑动 => 页面滚动
        // - 捏合/张开(ctrl+wheel) => 缩放
        zoomOnMouseWheel: false,
        moveOnMouseWheel: false,
        moveOnMouseMove: true,
      },
      {
        type: "slider",
        xAxisIndex: [0, 1, 2],
        start: 70,
        end: 100,
        height: 18,
        bottom: 4,
        textStyle: { color: "#9ca3af", fontSize: 10 },
        dataBackground: { lineStyle: { color: "#374151" }, areaStyle: { color: "rgba(55,65,81,0.35)" } },
        borderColor: "#4b5563",
        fillerColor: "rgba(59, 130, 246, 0.2)",
        handleStyle: { color: "#6b7280" },
      },
    ],
    series,
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

function KlineChartInner({
  code,
  defaultLod = "month",
  height = 380,
  tradeMarks = [],
  variant = "simple",
}: KlineChartProps) {
  const [lod, setLod] = useState<KlineLod>(defaultLod);
  const [mainIndicator, setMainIndicator] = useState<MainIndicator>("MA");
  const [sub1Indicator, setSub1Indicator] = useState<SubIndicator>("VOL");
  const [sub2Indicator, setSub2Indicator] = useState<Sub2Indicator>("RSI");
  const manualRef = useRef(false);
  const chartRef = useRef<EChartsType | null>(null);
  const zoomTRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const datesRef = useRef<string[]>([]);
  const lodRef = useRef(lod);
  const [autoHint, setAutoHint] = useState<string | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomStateRef = useRef<{ start: number; end: number }>({ start: 70, end: 100 });
  const gestureLockRef = useRef<{ axis: "x" | "y" | "pinch" | null; lastTs: number }>({
    axis: null,
    lastTs: 0,
  });
  const containerHoverRef = useRef(false);

  const start = undefined as string | undefined;
  const end = undefined as string | undefined;

  useEffect(() => {
    lodRef.current = lod;
  }, [lod]);

  const queryKey = useMemo(
    () => ["kline", code, lod, start ?? "", end ?? "", variant, sub1Indicator] as const,
    [code, lod, start, end, variant, sub1Indicator],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      api.getKline(code, {
        lod,
        start,
        end,
        fields: variant === "ths" || sub1Indicator === "AMOUNT" ? "ohlc,vol,turnover" : "ohlc,vol",
      }),
    enabled: code.length > 0,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
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
    if (variant === "ths") {
      return buildThsChartOption(dates, rows, mainIndicator, sub1Indicator, sub2Indicator);
    }
    return buildSimpleChartOption(dates, rows, tradeMarks);
  }, [dates, rows, tradeMarks, variant, mainIndicator, sub1Indicator, sub2Indicator]);

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
      const r = extractDataZoomPercent(ev);
      if (!r) return;
      if (variant === "ths") {
        zoomStateRef.current = { start: r.start, end: r.end };
        return;
      }
      if (manualRef.current) return;
      const span = visibleSpanDays(datesRef.current, r.start, r.end);
      const next = targetAutoLod(span);
      if (next === lodRef.current) return;
      showAutoHint(next);
      setLod(next);
    },
    [showAutoHint, variant],
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

  const onContainerWheelCapture = useCallback(
    () => {
      // ths 模式由 window capture 统一处理
      // simple 模式保留默认行为
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (variant !== "ths") return;

    const clampWindow = (start: number, end: number) => {
      let s = start;
      let e = end;
      const span = Math.max(1, e - s);
      if (s < 0) {
        e -= s;
        s = 0;
      }
      if (e > 100) {
        s -= e - 100;
        e = 100;
      }
      s = Math.max(0, Math.min(s, 100 - span));
      e = Math.min(100, Math.max(e, span));
      return { start: s, end: e };
    };

    const onGlobalWheel = (we: WheelEvent) => {
      if (!containerHoverRef.current) return;
      const chart = chartRef.current;
      if (!chart) return;

      const { start, end } = zoomStateRef.current;
      const span = Math.max(1, end - start);
      const dx = we.deltaX;
      const dy = we.deltaY;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const now = performance.now();

      const lock = gestureLockRef.current;
      if (now - lock.lastTs > 120) {
        lock.axis = null;
      }
      lock.lastTs = now;

      const isPinch = (we.ctrlKey || we.metaKey) && ay > 0.01;
      if (isPinch) lock.axis = "pinch";
      else if (!lock.axis) lock.axis = ax > ay ? "x" : "y";

      const applyZoom = (nextStart: number, nextEnd: number) => {
        zoomStateRef.current = { start: nextStart, end: nextEnd };
        chart.dispatchAction({ type: "dataZoom", dataZoomIndex: 0, start: nextStart, end: nextEnd });
        chart.dispatchAction({ type: "dataZoom", dataZoomIndex: 1, start: nextStart, end: nextEnd });
      };

      if (lock.axis === "pinch") {
        const zoomFactor = dy > 0 ? 1.06 : 0.94;
        const center = (start + end) / 2;
        const nextSpan = Math.max(2, Math.min(100, span * zoomFactor));
        const next = clampWindow(center - nextSpan / 2, center + nextSpan / 2);
        applyZoom(next.start, next.end);
        we.preventDefault();
        we.stopPropagation();
        return;
      }

      if (lock.axis === "x") {
        // 大幅提高平移灵敏度，确保不是“微微动一点点”
        const shift = (dx / 120) * span;
        const next = clampWindow(start + shift, end + shift);
        applyZoom(next.start, next.end);
        // 在 window capture 阶段拦截，避免浏览器前进/后退手势
        we.preventDefault();
        we.stopPropagation();
        return;
      }

      // y 轴：不处理，让页面滚动
    };

    // Safari 下防止捏合触发页面缩放
    const onGesture = (e: Event) => {
      if (!containerHoverRef.current) return;
      e.preventDefault();
    };

    window.addEventListener("wheel", onGlobalWheel, { capture: true, passive: false });
    window.addEventListener("gesturestart", onGesture, { capture: true, passive: false } as AddEventListenerOptions);
    window.addEventListener("gesturechange", onGesture, { capture: true, passive: false } as AddEventListenerOptions);

    return () => {
      window.removeEventListener("wheel", onGlobalWheel, { capture: true } as EventListenerOptions);
      window.removeEventListener("gesturestart", onGesture, { capture: true } as EventListenerOptions);
      window.removeEventListener("gesturechange", onGesture, { capture: true } as EventListenerOptions);
    };
  }, [variant]);

  return (
    <div
      className="relative rounded-lg border border-gray-700 bg-gray-900 text-gray-200"
      style={{ minHeight: height, overscrollBehaviorX: "none" }}
      onWheelCapture={onContainerWheelCapture}
      onMouseEnter={() => {
        containerHoverRef.current = true;
      }}
      onMouseLeave={() => {
        containerHoverRef.current = false;
        gestureLockRef.current.axis = null;
      }}
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

      <div className="relative px-1 pb-1" style={{ height }}>
        {variant === "ths" && (
          <>
            <div
              className="absolute left-2 z-10 flex items-center gap-1 rounded border border-gray-600/80 bg-gray-900/90 px-1.5 py-0.5"
              style={{ top: 8 }}
            >
              <span className="text-[10px] text-gray-400">主图</span>
              <select
                value={mainIndicator}
                onChange={(e) => setMainIndicator(e.target.value as MainIndicator)}
                className="rounded border border-gray-600 bg-gray-800 px-1 py-0.5 text-xs text-gray-200"
              >
                <option value="MA">均线</option>
                <option value="BOLL">BOLL</option>
                <option value="EMA">EMA</option>
                <option value="NONE">无</option>
              </select>
            </div>
            <div
              className="absolute left-2 z-10 flex items-center gap-1 rounded border border-gray-600/80 bg-gray-900/90 px-1.5 py-0.5"
              style={{ top: "58%" }}
            >
              <span className="text-[10px] text-gray-400">附图1</span>
              <select
                value={sub1Indicator}
                onChange={(e) => setSub1Indicator(e.target.value as SubIndicator)}
                className="rounded border border-gray-600 bg-gray-800 px-1 py-0.5 text-xs text-gray-200"
              >
                <option value="VOL">VOL</option>
                <option value="AMOUNT">成交额</option>
                <option value="MACD">MACD</option>
                <option value="KDJ">KDJ</option>
              </select>
            </div>
            <div
              className="absolute left-2 z-10 flex items-center gap-1 rounded border border-gray-600/80 bg-gray-900/90 px-1.5 py-0.5"
              style={{ top: "79%" }}
            >
              <span className="text-[10px] text-gray-400">附图2</span>
              <select
                value={sub2Indicator}
                onChange={(e) => setSub2Indicator(e.target.value as Sub2Indicator)}
                className="rounded border border-gray-600 bg-gray-800 px-1 py-0.5 text-xs text-gray-200"
              >
                <option value="RSI">RSI</option>
                <option value="WR">W&amp;R</option>
                <option value="CCI">CCI</option>
                <option value="NONE">无</option>
              </select>
            </div>
          </>
        )}
        {rows.length > 0 && Object.keys(option).length > 0 ? (
          <ReactEChartsCore
            echarts={echarts}
            option={option}
            style={{ width: "100%", height: "100%" }}
            opts={{ renderer: "canvas", useDirtyRect: true }}
            notMerge
            lazyUpdate
            onChartReady={(c) => {
              chartRef.current = c as unknown as EChartsType;
              if (variant === "ths") {
                const opt = (chartRef.current.getOption?.() ?? {}) as {
                  dataZoom?: Array<{ start?: number; end?: number }>;
                };
                const dz = opt.dataZoom?.[0] ?? {};
                zoomStateRef.current = {
                  start: typeof dz.start === "number" ? dz.start : 70,
                  end: typeof dz.end === "number" ? dz.end : 100,
                };
              }
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
  const { code, defaultLod = "month", tradeMarks, variant = "simple" } = props;
  return <KlineChartInner key={`${code}:${defaultLod}:${variant}:${tradeMarks?.length ?? 0}`} {...props} />;
}
