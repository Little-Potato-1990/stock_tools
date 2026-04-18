"use client";

import { useEffect, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart, BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { api } from "@/lib/api";

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

interface SentimentRow {
  trade_date: string;
  total_amount: number;
  limit_up_count: number;
  limit_down_count: number;
  broken_limit_count: number;
  broken_rate: number;
  max_height: number;
  up_count: number;
  down_count: number;
  up_rate: number | null;
  sh_up_rate?: number | null;
  sz_up_rate?: number | null;
  gem_up_rate?: number | null;
  yesterday_lu_up_rate: number | null;
  yesterday_panic_up_rate?: number | null;
  yesterday_weak_up_rate?: number | null;
  main_lu_open_avg?: number | null;
  main_lu_body_avg?: number | null;
  main_lu_change_avg?: number | null;
  gem_lu_open_avg?: number | null;
  gem_lu_body_avg?: number | null;
  gem_lu_change_avg?: number | null;
  open_limit_down_count?: number;
}

const baseLine = {
  axisLine: { lineStyle: { color: "#2a2d3a" } },
  axisTick: { show: false },
  axisLabel: { color: "#5d6175", fontSize: 9 },
};

const baseLegend = {
  top: 4,
  right: 12,
  textStyle: { color: "#9ca0b0", fontSize: 10 },
  itemWidth: 12,
  itemHeight: 6,
  itemGap: 10,
};

const baseTooltip = {
  trigger: "axis" as const,
  backgroundColor: "rgba(30,33,48,0.95)",
  borderColor: "var(--border-color)",
  textStyle: { color: "#e8e9ed", fontSize: 11 },
};

function ChartCard({
  title,
  option,
  height = 200,
}: {
  title: string;
  option: echarts.EChartsCoreOption;
  height?: number;
}) {
  return (
    <div
      className="rounded"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        padding: "8px 10px",
      }}
    >
      <div
        className="font-bold mb-1"
        style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
      >
        {title}
      </div>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}

export function SentimentChart() {
  const [data, setData] = useState<SentimentRow[]>([]);

  useEffect(() => {
    api
      .getSentiment(20)
      .then((res) => {
        // 后端返回按 trade_date desc (最新在前), 与上方表格保持一致 -> 不反转
        setData(res as unknown as SentimentRow[]);
      })
      .catch(console.error);
  }, []);

  if (data.length === 0) {
    return (
      <div className="px-3 py-3 space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-44 rounded animate-pulse"
            style={{ background: "var(--bg-card)" }}
          />
        ))}
      </div>
    );
  }

  const dates = data.map((d) => d.trade_date.slice(5).replace("-", "/"));

  const pctTooltip = {
    ...baseTooltip,
    formatter: (params: unknown) => {
      const items = params as Array<{
        seriesName: string;
        value: number;
        marker: string;
        axisValue: string;
      }>;
      if (!Array.isArray(items) || items.length === 0) return "";
      let html = `<div style="font-size:11px">${items[0].axisValue}<br/>`;
      for (const p of items) {
        html += `${p.marker} ${p.seriesName}: <b>${(p.value * 100).toFixed(2)}%</b><br/>`;
      }
      return html + "</div>";
    },
  };

  const pctYAxis = {
    type: "value" as const,
    axisLabel: {
      color: "#5d6175",
      fontSize: 9,
      formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
    },
    splitLine: { lineStyle: { color: "rgba(42,45,58,0.6)" } },
    axisLine: { show: false },
    min: 0,
    max: 1,
  };

  const lineSeries = (
    name: string,
    color: string,
    values: Array<number | null>
  ) => ({
    name,
    type: "line" as const,
    data: values.map((v) => v ?? 0),
    lineStyle: { color, width: 1.6 },
    itemStyle: { color },
    symbol: "circle" as const,
    symbolSize: 4,
    smooth: true,
  });

  // ===== 情绪周期: 多曲线对比 (8 条上涨率) =====
  const cycleOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    grid: { top: 36, right: 16, bottom: 24, left: 40, containLabel: false },
    tooltip: pctTooltip,
    legend: { ...baseLegend, type: "scroll", width: "70%" },
    xAxis: { type: "category", data: dates, ...baseLine },
    yAxis: pctYAxis,
    series: [
      lineSeries("收盘上涨率", "#3b82f6", data.map((d) => d.up_rate)),
      lineSeries("上日强势票上涨率", "#f59e0b", data.map((d) => d.yesterday_lu_up_rate)),
      lineSeries("上日妖股上涨率", "#ef4444", data.map((d) => d.yesterday_panic_up_rate ?? null)),
      lineSeries("上日弱势票上涨率", "#22c55e", data.map((d) => d.yesterday_weak_up_rate ?? null)),
      lineSeries("上证上涨率", "#8b5cf6", data.map((d) => d.sh_up_rate ?? null)),
      lineSeries("深证上涨率", "#06b6d4", data.map((d) => d.sz_up_rate ?? null)),
      lineSeries("创业板上涨率", "#ec4899", data.map((d) => d.gem_up_rate ?? null)),
    ],
  };

  // ===== 赚钱效应专用: -5%~+5% 涨跌幅 Y 轴 =====
  const earnPctTooltip = {
    ...baseTooltip,
    formatter: (params: unknown) => {
      const items = params as Array<{
        seriesName: string;
        value: number;
        marker: string;
        axisValue: string;
      }>;
      if (!Array.isArray(items) || items.length === 0) return "";
      let html = `<div style="font-size:11px">${items[0].axisValue}<br/>`;
      for (const p of items) {
        const isCoeff = p.seriesName.includes("最高板系数");
        html += `${p.marker} ${p.seriesName}: <b>${
          isCoeff ? p.value.toFixed(0) : `${(p.value * 100).toFixed(2)}%`
        }</b><br/>`;
      }
      return html + "</div>";
    },
  };

  const earnYAxisPct = {
    type: "value" as const,
    name: "涨幅",
    nameTextStyle: { color: "#5d6175", fontSize: 9 },
    axisLabel: {
      color: "#5d6175",
      fontSize: 9,
      formatter: (v: number) => `${(v * 100).toFixed(1)}%`,
    },
    splitLine: { lineStyle: { color: "rgba(42,45,58,0.6)" } },
    axisLine: { show: false },
  };

  const earnYAxisCoeff = {
    type: "value" as const,
    name: "板",
    nameTextStyle: { color: "#5d6175", fontSize: 9 },
    axisLabel: {
      color: "#5d6175",
      fontSize: 9,
      formatter: (v: number) => v.toFixed(0),
    },
    splitLine: { show: false },
    axisLine: { show: false },
    min: 0,
  };

  // 主板赚钱效应: 平均涨幅 + 实体涨幅(赚钱效应) + 开盘平均 + 主板最高板系数
  const mainEarnOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    grid: { top: 36, right: 50, bottom: 24, left: 50, containLabel: false },
    tooltip: earnPctTooltip,
    legend: baseLegend,
    xAxis: { type: "category", data: dates, ...baseLine },
    yAxis: [earnYAxisPct, earnYAxisCoeff],
    series: [
      {
        name: "主板上日涨停平均涨幅",
        type: "line",
        data: data.map((d) => d.main_lu_change_avg ?? 0),
        lineStyle: { color: "#ef4444", width: 2 },
        itemStyle: { color: "#ef4444" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
      },
      {
        name: "主板赚钱效应",
        type: "line",
        data: data.map((d) => d.main_lu_body_avg ?? 0),
        lineStyle: { color: "#3b82f6", width: 2 },
        itemStyle: { color: "#3b82f6" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
        areaStyle: { color: "rgba(59,130,246,0.15)" },
      },
      {
        name: "主板上日涨停开盘平均",
        type: "line",
        data: data.map((d) => d.main_lu_open_avg ?? 0),
        lineStyle: { color: "#e8e9ed", width: 1.5 },
        itemStyle: { color: "#e8e9ed" },
        symbol: "circle",
        symbolSize: 4,
        smooth: true,
      },
      {
        name: "主板最高板系数",
        type: "line",
        yAxisIndex: 1,
        data: data.map((d) => d.max_height),
        lineStyle: { color: "#ec4899", width: 1.5, type: "dashed" },
        itemStyle: { color: "#ec4899" },
        symbol: "circle",
        symbolSize: 4,
        smooth: true,
      },
    ],
  };

  // 创业板赚钱效应: 平均涨幅 + 实体涨幅(赚钱效应) + 开盘平均
  const gemEarnOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    grid: { top: 36, right: 16, bottom: 24, left: 50, containLabel: false },
    tooltip: earnPctTooltip,
    legend: baseLegend,
    xAxis: { type: "category", data: dates, ...baseLine },
    yAxis: earnYAxisPct,
    series: [
      {
        name: "创业板上日涨停平均涨幅",
        type: "line",
        data: data.map((d) => d.gem_lu_change_avg ?? 0),
        lineStyle: { color: "#ef4444", width: 2 },
        itemStyle: { color: "#ef4444" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
      },
      {
        name: "创业板赚钱效应",
        type: "line",
        data: data.map((d) => d.gem_lu_body_avg ?? 0),
        lineStyle: { color: "#3b82f6", width: 2 },
        itemStyle: { color: "#3b82f6" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
        areaStyle: { color: "rgba(59,130,246,0.15)" },
      },
      {
        name: "创业板上日涨停开盘平均",
        type: "line",
        data: data.map((d) => d.gem_lu_open_avg ?? 0),
        lineStyle: { color: "#e8e9ed", width: 1.5 },
        itemStyle: { color: "#e8e9ed" },
        symbol: "circle",
        symbolSize: 4,
        smooth: true,
      },
    ],
  };

  const volumeOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    grid: { top: 36, right: 50, bottom: 24, left: 50, containLabel: false },
    tooltip: {
      ...baseTooltip,
      formatter: (params: unknown) => {
        const items = params as Array<{
          seriesName: string;
          value: number;
          marker: string;
          axisValue: string;
        }>;
        if (!Array.isArray(items) || items.length === 0) return "";
        let html = `<div style="font-size:11px">${items[0].axisValue}<br/>`;
        for (const p of items) {
          const isAmount = p.seriesName.includes("成交");
          html += `${p.marker} ${p.seriesName}: <b>${
            isAmount
              ? `${(p.value / 1e8).toFixed(0)}亿`
              : `${(p.value * 100).toFixed(2)}%`
          }</b><br/>`;
        }
        return html + "</div>";
      },
    },
    legend: baseLegend,
    xAxis: { type: "category", data: dates, ...baseLine },
    yAxis: [
      {
        type: "value",
        name: "成交亿",
        nameTextStyle: { color: "#5d6175", fontSize: 9 },
        axisLabel: {
          color: "#5d6175",
          fontSize: 9,
          formatter: (v: number) => `${(v / 1e8).toFixed(0)}亿`,
        },
        splitLine: { lineStyle: { color: "rgba(42,45,58,0.6)" } },
        axisLine: { show: false },
      },
      {
        type: "value",
        name: "上涨率",
        nameTextStyle: { color: "#5d6175", fontSize: 9 },
        axisLabel: {
          color: "#5d6175",
          fontSize: 9,
          formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
        },
        splitLine: { show: false },
        axisLine: { show: false },
        min: 0,
        max: 1,
      },
    ],
    series: [
      {
        name: "大盘成交额",
        type: "bar",
        data: data.map((d) => d.total_amount),
        itemStyle: { color: "rgba(239,68,68,0.55)", borderRadius: [2, 2, 0, 0] },
        barWidth: "40%",
      },
      {
        name: "收盘上涨率",
        type: "line",
        yAxisIndex: 1,
        data: data.map((d) => d.up_rate ?? 0),
        lineStyle: { color: "#3b82f6", width: 2 },
        itemStyle: { color: "#3b82f6" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
      },
      {
        name: "上日强势票上涨率",
        type: "line",
        yAxisIndex: 1,
        data: data.map((d) => d.yesterday_lu_up_rate ?? 0),
        lineStyle: { color: "#f59e0b", width: 2 },
        itemStyle: { color: "#f59e0b" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
      },
    ],
  };

  // ===== 亏钱效应: 开跌系数 + 收跌系数 + 主板最高板系数 =====
  const lossOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    grid: { top: 36, right: 16, bottom: 24, left: 40, containLabel: false },
    tooltip: baseTooltip,
    legend: baseLegend,
    xAxis: { type: "category", data: dates, ...baseLine },
    yAxis: {
      type: "value",
      axisLabel: { color: "#5d6175", fontSize: 9 },
      splitLine: { lineStyle: { color: "rgba(42,45,58,0.6)" } },
      axisLine: { show: false },
      min: 0,
    },
    series: [
      {
        name: "开盘跌停系数",
        type: "line",
        data: data.map((d) => d.open_limit_down_count ?? 0),
        lineStyle: { color: "#06b6d4", width: 2 },
        itemStyle: { color: "#06b6d4" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
      },
      {
        name: "收盘跌停系数",
        type: "line",
        data: data.map((d) => d.limit_down_count),
        lineStyle: { color: "#eab308", width: 2 },
        itemStyle: { color: "#eab308" },
        areaStyle: { color: "rgba(234,179,8,0.18)" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
      },
      {
        name: "主板最高板系数",
        type: "line",
        data: data.map((d) => d.max_height),
        lineStyle: { color: "#ec4899", width: 1.5, type: "dashed" },
        itemStyle: { color: "#ec4899" },
        symbol: "circle",
        symbolSize: 4,
        smooth: true,
      },
    ],
  };

  // 强势&反包系数 (后端字段缺失时, 用现有数据近似计算)
  const strongOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    grid: { top: 36, right: 16, bottom: 24, left: 40, containLabel: false },
    tooltip: {
      ...baseTooltip,
      formatter: (params: unknown) => {
        const items = params as Array<{
          seriesName: string;
          value: number;
          marker: string;
          axisValue: string;
        }>;
        if (!Array.isArray(items) || items.length === 0) return "";
        let html = `<div style="font-size:11px">${items[0].axisValue}<br/>`;
        for (const p of items) {
          html += `${p.marker} ${p.seriesName}: <b>${p.value.toFixed(2)}</b><br/>`;
        }
        return html + "</div>";
      },
    },
    legend: baseLegend,
    xAxis: { type: "category", data: dates, ...baseLine },
    yAxis: {
      type: "value",
      axisLabel: {
        color: "#5d6175",
        fontSize: 9,
        formatter: (v: number) => v.toFixed(0),
      },
      splitLine: { lineStyle: { color: "rgba(42,45,58,0.6)" } },
      axisLine: { show: false },
      min: 0,
      max: 100,
    },
    series: [
      {
        name: "强势系数",
        type: "line",
        data: data.map((d) => (d.yesterday_lu_up_rate ?? 0) * 100),
        lineStyle: { color: "#ef4444", width: 2 },
        itemStyle: { color: "#ef4444" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
      },
      {
        name: "妖股系数",
        type: "line",
        data: data.map((d) => Math.min(d.max_height * 8, 100)),
        lineStyle: { color: "#f59e0b", width: 2 },
        itemStyle: { color: "#f59e0b" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
      },
      {
        name: "反包系数",
        type: "line",
        data: data.map((d) => (1 - (d.broken_rate ?? 0)) * 100),
        lineStyle: { color: "#8b5cf6", width: 2 },
        itemStyle: { color: "#8b5cf6" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
      },
      {
        name: "前排效应",
        type: "line",
        data: data.map((d) =>
          d.up_count > 0
            ? Math.min((d.limit_up_count / d.up_count) * 100, 100)
            : 0
        ),
        lineStyle: { color: "#3b82f6", width: 2 },
        itemStyle: { color: "#3b82f6" },
        symbol: "circle",
        symbolSize: 5,
        smooth: true,
      },
    ],
  };

  return (
    <div className="p-3 space-y-2">
      <ChartCard title="情绪周期" option={cycleOption} height={220} />
      <ChartCard title="主板赚钱效应" option={mainEarnOption} />
      <ChartCard title="创业板赚钱效应" option={gemEarnOption} />
      <ChartCard title="亏钱效应" option={lossOption} />
      <ChartCard title="大盘量价" option={volumeOption} />
      <ChartCard title="强势 & 反包系数 (近似)" option={strongOption} />
    </div>
  );
}
