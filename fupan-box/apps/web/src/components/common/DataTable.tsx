"use client";

/**
 * 通用大表格组件 (复盘盒子专用风格).
 *
 * 实现的"用户体验"关键点 (#10):
 * 1. 首列 (sticky=true) 横向滚动时固定吸边
 * 2. 表头点击排序 (asc / desc / 取消)
 * 3. 列宽可拖拽, 记忆到 localStorage(key=`table:${name}:state`)
 * 4. 排序状态也一起记忆, 用户下次进同一张表恢复
 * 5. 不带分页 (现有页面都是单日切片小数据, 暂不需要)
 *
 * 设计取舍:
 * - 没有引入 @tanstack/react-table — 当前需求不复杂, 自写更轻 (~6KB)
 * - render 拿到 (row, value) 自由渲染单元格内容
 * - 排序 sortable 的列默认按 row[key] 直接比较;
 *   需要自定义排序键 (如按 amount 排但展示 `xxx 亿`) 用 sortValue
 */

import {
  CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

export type SortDir = "asc" | "desc" | null;

// 单列定义.
// `K` 是 row 的字段联合类型, 但实际我们大部分用 string, 所以用 string 即可.
export interface DataTableColumn<T> {
  key: string;
  label: ReactNode;
  /** 默认列宽 (像素). 用户拖拽后会被 localStorage 覆盖. */
  width?: number;
  /** 最小列宽, 默认 60. 拖拽不能小于这个值. */
  minWidth?: number;
  /** 是否吸左侧, 通常给"代码/名称"列, 一张表一般只用一列设 true. */
  sticky?: boolean;
  /** 文本对齐, 默认按 align 推断: 数字列 right, 其他 left. */
  align?: "left" | "center" | "right";
  /** 是否允许点击表头排序. */
  sortable?: boolean;
  /** 真正用来比较的值. 缺省时用 row[key]. */
  sortValue?: (row: T) => number | string | null | undefined;
  /** 渲染函数. 缺省时直接展示 row[key]. */
  render?: (row: T, value: unknown) => ReactNode;
  /** 单元格 className. */
  cellClassName?: string;
  /** 单元格 style. */
  cellStyle?: CSSProperties | ((row: T) => CSSProperties | undefined);
}

interface Props<T> {
  /** localStorage 持久化命名空间; 不同表用不同 name 避免相互覆盖. */
  name: string;
  columns: DataTableColumn<T>[];
  data: T[];
  /** 行 key, 强烈建议传; 不传时退化用 idx (会触发 React warning). */
  rowKey?: (row: T, idx: number) => string | number;
  /** 整行点击 (个股/题材表常用 → 打开 drawer). */
  onRowClick?: (row: T) => void;
  /** 默认排序; 仅当用户没拖拽过时生效. */
  defaultSort?: { key: string; dir: SortDir };
  /** 容器最大高 (开启吸顶 thead 必须设). */
  maxHeight?: number | string;
  /** 空数据占位. */
  emptyText?: ReactNode;
  /** 表格容器 className. */
  className?: string;
}

interface PersistState {
  widths: Record<string, number>;
  sortKey?: string;
  sortDir?: SortDir;
}

const STORAGE_PREFIX = "table:";

function loadState(name: string): PersistState {
  if (typeof window === "undefined") return { widths: {} };
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + name);
    if (!raw) return { widths: {} };
    const parsed = JSON.parse(raw) as PersistState;
    return { widths: parsed.widths ?? {}, sortKey: parsed.sortKey, sortDir: parsed.sortDir };
  } catch {
    return { widths: {} };
  }
}

function saveState(name: string, state: PersistState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(state));
  } catch {
    /* quota / privacy mode, ignore */
  }
}

function compareValues(a: unknown, b: unknown): number {
  // null/undefined 永远排到末尾
  const aNull = a == null || (typeof a === "number" && Number.isNaN(a));
  const bNull = b == null || (typeof b === "number" && Number.isNaN(b));
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "zh-Hans-CN");
}

export function DataTable<T extends Record<string, unknown>>({
  name,
  columns,
  data,
  rowKey,
  onRowClick,
  defaultSort,
  maxHeight,
  emptyText = "暂无数据",
  className,
}: Props<T>) {
  // ---- persistent state ----
  const initial = useMemo(() => loadState(name), [name]);
  const [widths, setWidths] = useState<Record<string, number>>(initial.widths);
  const [sortKey, setSortKey] = useState<string | undefined>(
    initial.sortKey ?? defaultSort?.key,
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    initial.sortDir ?? defaultSort?.dir ?? null,
  );

  // 写回 storage (debounce 不必要, change 频次极低)
  useEffect(() => {
    saveState(name, { widths, sortKey, sortDir });
  }, [name, widths, sortKey, sortDir]);

  // ---- sort ----
  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return data;
    const get = col.sortValue
      ? (r: T) => col.sortValue!(r)
      : (r: T) => r[sortKey] as unknown;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => compareValues(get(a), get(b)) * dir);
  }, [data, columns, sortKey, sortDir]);

  const handleSort = (key: string, sortable?: boolean) => {
    if (!sortable) return;
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir(null);
      setSortKey(undefined);
    } else {
      setSortDir("desc");
    }
  };

  // ---- column resize ----
  const dragRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const col = columns.find((c) => c.key === key);
    const currentW = widths[key] ?? col?.width ?? 100;
    dragRef.current = { key, startX: e.clientX, startW: currentW };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { key, startX, startW } = dragRef.current;
    const delta = e.clientX - startX;
    const col = columns.find((c) => c.key === key);
    const min = col?.minWidth ?? 60;
    const w = Math.max(min, startW + delta);
    setWidths((prev) => ({ ...prev, [key]: w }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
    document.body.style.cursor = "";
  };

  const colWidth = useCallback(
    (col: DataTableColumn<T>) => widths[col.key] ?? col.width ?? 100,
    [widths],
  );

  return (
    <div
      className={className}
      style={{
        position: "relative",
        overflow: "auto",
        maxHeight,
        border: "1px solid var(--border-color)",
        borderRadius: 4,
      }}
    >
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "max-content", minWidth: "100%" }}>
        <thead>
          <tr>
            {columns.map((col) => {
              const w = colWidth(col);
              const isCurrentSort = sortKey === col.key;
              const align = col.align ?? "left";
              return (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key, col.sortable)}
                  style={{
                    width: w,
                    minWidth: w,
                    maxWidth: w,
                    height: 32,
                    padding: "0 8px",
                    textAlign: align,
                    background: "var(--bg-secondary)",
                    color: "var(--text-secondary)",
                    fontWeight: 600,
                    fontSize: "var(--font-sm)",
                    borderBottom: "1px solid var(--border-color)",
                    position: col.sticky ? "sticky" : "sticky",
                    top: 0,
                    left: col.sticky ? 0 : undefined,
                    zIndex: col.sticky ? 6 : 5,
                    cursor: col.sortable ? "pointer" : "default",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={col.sortable ? "点击排序" : undefined}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      width: "100%",
                      justifyContent:
                        align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
                    }}
                  >
                    {col.label}
                    {col.sortable &&
                      (isCurrentSort && sortDir === "desc" ? (
                        <ChevronDown size={11} style={{ color: "var(--accent-orange)" }} />
                      ) : isCurrentSort && sortDir === "asc" ? (
                        <ChevronUp size={11} style={{ color: "var(--accent-orange)" }} />
                      ) : (
                        <ChevronsUpDown size={10} style={{ color: "var(--text-muted)", opacity: 0.5 }} />
                      ))}
                  </span>
                  {/* resize handle, 4px 宽, 全高, 拖动调整列宽 */}
                  <span
                    onClick={(ev) => ev.stopPropagation()}
                    onPointerDown={(ev) => onPointerDown(ev, col.key)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: 6,
                      cursor: "col-resize",
                      background: "transparent",
                      touchAction: "none",
                    }}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: 28,
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: "var(--font-sm)",
                }}
              >
                {emptyText}
              </td>
            </tr>
          )}
          {sorted.map((row, idx) => {
            const k = rowKey ? rowKey(row, idx) : idx;
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{
                  cursor: onRowClick ? "pointer" : "default",
                  background: idx % 2 === 0 ? "var(--bg-primary)" : "var(--bg-secondary)",
                }}
                onMouseEnter={(e) => {
                  if (onRowClick)
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (onRowClick)
                    (e.currentTarget as HTMLElement).style.background =
                      idx % 2 === 0 ? "var(--bg-primary)" : "var(--bg-secondary)";
                }}
              >
                {columns.map((col) => {
                  const w = colWidth(col);
                  const align = col.align ?? "left";
                  const value = (row as Record<string, unknown>)[col.key];
                  const cellStyleOverride =
                    typeof col.cellStyle === "function" ? col.cellStyle(row) : col.cellStyle;
                  return (
                    <td
                      key={col.key}
                      className={col.cellClassName}
                      style={{
                        width: w,
                        minWidth: w,
                        maxWidth: w,
                        padding: "6px 8px",
                        textAlign: align,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        borderBottom: "1px solid var(--border-color)",
                        color: "var(--text-primary)",
                        fontSize: "var(--font-md)",
                        position: col.sticky ? "sticky" : undefined,
                        left: col.sticky ? 0 : undefined,
                        background: col.sticky
                          ? idx % 2 === 0
                            ? "var(--bg-primary)"
                            : "var(--bg-secondary)"
                          : undefined,
                        zIndex: col.sticky ? 3 : undefined,
                        ...cellStyleOverride,
                      }}
                    >
                      {col.render ? col.render(row, value) : (value as ReactNode) ?? "-"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
