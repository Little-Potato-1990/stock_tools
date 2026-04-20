"use client";

import { useState, useEffect } from "react";
import { useUIStore } from "@/stores/ui-store";
import { api } from "@/lib/api";
import { LadderStats } from "@/components/market/LadderStats";
import { LadderGrid } from "@/components/market/LadderGrid";
import { LadderMatrix } from "@/components/market/LadderMatrix";
import { LadderAiCard } from "@/components/market/LadderAiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { Flame, Search } from "lucide-react";

type TabKey = "ladder" | "related" | "filter" | "compact";

const TABS: { key: TabKey; label: string }[] = [
  { key: "ladder", label: "连板天梯" },
  { key: "related", label: "相关个股查询" },
  { key: "filter", label: "筛选" },
  { key: "compact", label: "缩略模式" },
];

interface ThemeAgg {
  name: string;
  count: number;
}

/** 题材 chip 行 */
function ThemeChips({
  themes,
  active,
  onChange,
}: {
  themes: ThemeAgg[];
  active: string | null;
  onChange: (t: string | null) => void;
}) {
  if (themes.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1 px-3 py-2"
      style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-color)",
      }}
    >
      <button
        onClick={() => onChange(null)}
        className="font-semibold transition-colors"
        style={{
          padding: "3px 8px",
          borderRadius: 3,
          fontSize: "var(--font-xs)",
          background: !active ? "var(--accent-orange)" : "var(--bg-tertiary)",
          color: !active ? "#fff" : "var(--text-muted)",
        }}
      >
        全部
      </button>
      {themes.map(({ name, count }) => (
        <button
          key={name}
          onClick={() => onChange(active === name ? null : name)}
          className="inline-flex items-center gap-0.5 transition-colors"
          style={{
            padding: "3px 8px",
            borderRadius: 3,
            fontSize: "var(--font-xs)",
            background:
              active === name ? "var(--accent-red)" : "var(--bg-tertiary)",
            color: active === name ? "#fff" : "var(--text-secondary)",
          }}
        >
          {count >= 5 && <Flame size={10} />}
          {name}
          <span style={{ opacity: 0.75 }}>({count})</span>
        </button>
      ))}
    </div>
  );
}

/** 筛选 tab 用的紧凑筛选条 */
function FilterBar({
  minLevel,
  setMinLevel,
  onlyOneWord,
  setOnlyOneWord,
  keyword,
  setKeyword,
}: {
  minLevel: number;
  setMinLevel: (n: number) => void;
  onlyOneWord: boolean;
  setOnlyOneWord: (v: boolean) => void;
  keyword: string;
  setKeyword: (v: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2"
      style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-color)",
      }}
    >
      <div className="flex items-center gap-1">
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>最低板</span>
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <button
            key={n}
            onClick={() => setMinLevel(n)}
            className="font-semibold"
            style={{
              padding: "2px 8px",
              borderRadius: 3,
              fontSize: 11,
              background:
                minLevel === n ? "var(--accent-orange)" : "var(--bg-tertiary)",
              color: minLevel === n ? "#fff" : "var(--text-secondary)",
            }}
          >
            {n}{n >= 7 ? "+" : ""}
          </button>
        ))}
      </div>

      <div
        style={{
          width: 1,
          height: 16,
          background: "var(--border-color)",
        }}
      />

      <button
        onClick={() => setOnlyOneWord(!onlyOneWord)}
        className="font-semibold"
        style={{
          padding: "2px 10px",
          borderRadius: 3,
          fontSize: 11,
          background: onlyOneWord ? "var(--accent-red)" : "var(--bg-tertiary)",
          color: onlyOneWord ? "#fff" : "var(--text-secondary)",
        }}
      >
        仅一字板
      </button>

      <div
        className="flex items-center gap-1 ml-auto"
        style={{
          background: "var(--bg-tertiary)",
          padding: "2px 8px",
          borderRadius: 3,
          border: "1px solid var(--border-color)",
        }}
      >
        <Search size={11} color="var(--text-muted)" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="股票名 / 代码 / 题材"
          style={{
            background: "transparent",
            outline: "none",
            border: "none",
            color: "var(--text-primary)",
            fontSize: 11,
            width: 200,
          }}
        />
      </div>
    </div>
  );
}

/** 相关个股查询 - 用户搜索/选股 → 列出相关股票 */
function RelatedQuery() {
  const focusedStock = useUIStore((s) => s.focusedStock);
  const openStockDetail = useUIStore((s) => s.openStockDetail);
  const [keyword, setKeyword] = useState("");

  return (
    <div className="p-3 space-y-3">
      {/* 搜索栏 */}
      <div
        className="flex items-center gap-2 rounded"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          padding: "8px 10px",
        }}
      >
        <Search size={14} color="var(--text-muted)" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="输入股票名 / 代码 / 题材, 查询近期所有相关连板个股"
          className="flex-1"
          style={{
            background: "transparent",
            outline: "none",
            border: "none",
            color: "var(--text-primary)",
            fontSize: 12,
          }}
        />
        {focusedStock && (
          <button
            onClick={() => openStockDetail(focusedStock.code, focusedStock.name)}
            className="font-semibold"
            style={{
              background: "var(--accent-orange)",
              color: "#1a1d28",
              padding: "3px 10px",
              borderRadius: 3,
              fontSize: 11,
            }}
          >
            打开 {focusedStock.name || focusedStock.code} →
          </button>
        )}
      </div>

      <div
        className="text-center"
        style={{
          color: "var(--text-muted)",
          fontSize: "var(--font-sm)",
          padding: "12px 0",
        }}
      >
        输入关键词后, 下方网格自动过滤匹配的连板个股
      </div>

      {/* 复用 LadderGrid + keyword 过滤 */}
      <LadderGrid days={6} keyword={keyword} />
    </div>
  );
}

export function LadderPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("ladder");
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [themes, setThemes] = useState<ThemeAgg[]>([]);

  // 筛选 tab 的 state
  const [filterMinLevel, setFilterMinLevel] = useState(2);
  const [filterOneWord, setFilterOneWord] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState("");

  useEffect(() => {
    api
      .getSnapshot("ladder")
      .then((res) => {
        const data = res.data as {
          levels?: { stocks?: { theme_names?: string[] | null }[] }[];
        };
        const counts: Record<string, number> = {};
        for (const lv of data.levels ?? []) {
          for (const s of lv.stocks ?? []) {
            for (const t of s.theme_names ?? []) {
              if (t) counts[t] = (counts[t] || 0) + 1;
            }
          }
        }
        setThemes(
          Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([name, count]) => ({ name, count }))
        );
      })
      .catch(console.error);
  }, []);

  return (
    <div>
      <PageHeader
        title="连板天梯"
        subtitle={TABS.find((t) => t.key === activeTab)?.label}
      />

      {/* tabs */}
      <div
        className="flex items-center px-3"
        style={{
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
          height: 36,
        }}
      >
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className="font-medium transition-colors relative"
            style={{
              padding: "0 14px",
              height: 36,
              fontSize: "var(--font-md)",
              color:
                activeTab === key
                  ? "var(--text-primary)"
                  : "var(--text-muted)",
            }}
          >
            {label}
            {activeTab === key && (
              <div
                className="absolute bottom-0 left-2 right-2"
                style={{ height: 2, background: "var(--accent-orange)" }}
              />
            )}
          </button>
        ))}
      </div>

      {activeTab === "ladder" && (
        <>
          <LadderAiCard />
          <LadderMatrix />
        </>
      )}

      {activeTab === "related" && <RelatedQuery />}

      {activeTab === "filter" && (
        <div>
          <FilterBar
            minLevel={filterMinLevel}
            setMinLevel={setFilterMinLevel}
            onlyOneWord={filterOneWord}
            setOnlyOneWord={setFilterOneWord}
            keyword={filterKeyword}
            setKeyword={setFilterKeyword}
          />
          <LadderGrid
            days={6}
            minLevel={filterMinLevel}
            onlyOneWord={filterOneWord}
            keyword={filterKeyword}
          />
        </div>
      )}

      {activeTab === "compact" && (
        <div>
          <ThemeChips
            themes={themes}
            active={activeTheme}
            onChange={setActiveTheme}
          />
          <LadderGrid filterTheme={activeTheme} days={8} compact />
        </div>
      )}
    </div>
  );
}
