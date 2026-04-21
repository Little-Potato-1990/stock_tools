"use client";

/**
 * 板块字母索引网格 (概念 / 行业).
 *
 * 抽自原 StockSearchPage 的 BoardGrid, 给「题材追踪」页的「板块索引」子 Tab 复用.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";

interface BoardItem {
  name: string;
  code: string;
  change_pct: number;
}
interface BoardGroup {
  letter: string;
  items: BoardItem[];
}

interface Props {
  kind: "concept" | "industry";
  /** 容器高度计算用; 调用方给一个 css 高度表达式 (默认整屏减 132px, 兼容 PageHeader+Tab 高度) */
  heightExpr?: string;
}

export function BoardGrid({ kind, heightExpr = "calc(100vh - 132px)" }: Props) {
  const [groups, setGroups] = useState<BoardGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const openThemeDetail = useUIStore((s) => s.openThemeDetail);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getAllBoards(kind)
      .then((res) => {
        if (!alive) return;
        setGroups((res as { groups: BoardGroup[] }).groups);
      })
      .catch(console.error)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [kind]);

  if (loading) {
    return (
      <div className="px-4 py-3 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse"
            style={{ background: "var(--bg-card)" }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-y-auto" style={{ height: heightExpr }}>
      <div className="px-4 py-3 space-y-3">
        {groups.map((g) => (
          <div key={g.letter}>
            <div
              className="font-bold mb-1.5 sticky top-0 py-1"
              style={{
                color: "var(--text-secondary)",
                fontSize: "var(--font-md)",
                background: "var(--bg-primary)",
                zIndex: 5,
              }}
            >
              {g.letter}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((b) => (
                <button
                  key={b.code || b.name}
                  onClick={() => openThemeDetail(b.name)}
                  className="rounded transition-colors"
                  style={{
                    padding: "5px 10px",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-primary)",
                    fontSize: "var(--font-sm)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-card-hover)";
                    e.currentTarget.style.borderColor = "var(--accent-orange)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--bg-card)";
                    e.currentTarget.style.borderColor = "var(--border-color)";
                  }}
                >
                  <span>{b.name}</span>
                  {b.change_pct !== 0 && (
                    <span
                      className="ml-1.5 tabular-nums font-bold"
                      style={{
                        fontSize: 10,
                        color:
                          b.change_pct >= 0
                            ? "var(--accent-red)"
                            : "var(--accent-green)",
                      }}
                    >
                      {b.change_pct >= 0 ? "+" : ""}
                      {b.change_pct.toFixed(2)}%
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
