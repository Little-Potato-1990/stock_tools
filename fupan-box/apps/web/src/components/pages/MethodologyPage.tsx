"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Clock,
  Search,
  Sparkles,
  Tag as TagIcon,
  X as XIcon,
} from "lucide-react";
import { api, type MethodologyCategoryStat, type MethodologyDetail, type MethodologyMeta } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { useUIStore } from "@/stores/ui-store";

/**
 * 方法论文库 (Phase 5).
 *
 * 布局: 左侧分类/标签筛选, 中部文章卡片列表, 点击进入详情视图.
 *
 * 详情视图: 顶部 AI 速读卡 (适用场景 / 核心命题 / 阅读时长) + 完整 markdown 正文.
 * Markdown 用本地极简渲染器 (避免新增依赖); 文章里只用了标题/引用/列表/粗体/分割线.
 */
export function MethodologyPage() {
  const [categories, setCategories] = useState<MethodologyCategoryStat[]>([]);
  const [items, setItems] = useState<MethodologyMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState<string>("");
  const [filterTag, setFilterTag] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  // 加载分类
  useEffect(() => {
    let alive = true;
    api
      .getMethodologyCategories()
      .then((res) => {
        if (alive) setCategories(res.categories);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 加载列表 (filter 变化时刷新)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getMethodologyList({ category: filterCat, tag: filterTag, q })
      .then((res) => {
        if (alive) setItems(res.items);
      })
      .catch(() => {
        if (alive) setItems([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filterCat, filterTag, q]);

  if (activeSlug) {
    return (
      <MethodologyDetailView
        slug={activeSlug}
        onBack={() => setActiveSlug(null)}
      />
    );
  }

  const totalCount = useMemo(
    () => categories.reduce((s, c) => s + c.count, 0),
    [categories],
  );

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <PageHeader
        title="方法论文库"
        subtitle={`AI 二次加工 · 价值 / 技术 / 短线 / 宏观 全景 (${totalCount} 篇)`}
        actions={
          <div
            className="flex items-center gap-1.5"
            style={{
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: 4,
              padding: "3px 8px",
            }}
          >
            <Search size={11} color="var(--text-muted)" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜标题/标签..."
              style={{
                background: "transparent",
                outline: "none",
                border: "none",
                color: "var(--text-primary)",
                fontSize: 12,
                width: 160,
              }}
            />
            {q && (
              <button onClick={() => setQ("")} title="清除">
                <XIcon size={11} color="var(--text-muted)" />
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧分类 */}
        <aside
          className="overflow-y-auto"
          style={{
            width: 200,
            borderRight: "1px solid var(--border-color)",
            background: "var(--bg-secondary)",
            padding: "12px 8px",
          }}
        >
          <SectionLabel>分类</SectionLabel>
          <CategoryButton
            label="全部"
            active={!filterCat}
            count={totalCount}
            onClick={() => {
              setFilterCat("");
              setFilterTag("");
            }}
          />
          {categories.map((c) => (
            <CategoryButton
              key={c.key}
              label={c.label}
              count={c.count}
              color={c.color}
              active={filterCat === c.key}
              desc={c.desc}
              onClick={() => {
                setFilterCat(filterCat === c.key ? "" : c.key);
                setFilterTag("");
              }}
            />
          ))}

          {filterCat && (
            <>
              <SectionLabel>该分类高频标签</SectionLabel>
              <div className="flex flex-wrap gap-1 px-1">
                {(categories.find((c) => c.key === filterCat)?.top_tags || []).map(
                  (t) => (
                    <TagChip
                      key={t.tag}
                      label={`${t.tag} ${t.count}`}
                      active={filterTag === t.tag}
                      onClick={() =>
                        setFilterTag(filterTag === t.tag ? "" : t.tag)
                      }
                    />
                  ),
                )}
              </div>
            </>
          )}
        </aside>

        {/* 主区列表 */}
        <main className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
          {filterTag && (
            <div
              className="flex items-center gap-2 mb-3"
              style={{ fontSize: 11, color: "var(--text-secondary)" }}
            >
              <TagIcon size={11} color="var(--accent-orange)" />
              <span>
                已按标签过滤: <b style={{ color: "var(--accent-orange)" }}>{filterTag}</b>
              </span>
              <button
                onClick={() => setFilterTag("")}
                className="text-xs underline"
                style={{ color: "var(--text-muted)" }}
              >
                清除
              </button>
            </div>
          )}

          {loading ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 24 }}>
              加载中...
            </div>
          ) : items.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 24 }}>
              没有匹配的方法论. 试试清除筛选条件或换个关键词.
            </div>
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}
            >
              {items.map((it) => (
                <ArticleCard
                  key={it.slug}
                  meta={it}
                  catColor={
                    categories.find((c) => c.key === it.category)?.color ||
                    "var(--text-secondary)"
                  }
                  onOpen={() => setActiveSlug(it.slug)}
                  onTagClick={(t) => setFilterTag(t)}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ============= 列表卡片 =============

function ArticleCard({
  meta,
  catColor,
  onOpen,
  onTagClick,
}: {
  meta: MethodologyMeta;
  catColor: string;
  onOpen: () => void;
  onTagClick: (tag: string) => void;
}) {
  return (
    <article
      onClick={onOpen}
      className="cursor-pointer transition-colors flex flex-col"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 6,
        padding: 14,
        gap: 8,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-card-hover)";
        e.currentTarget.style.borderColor = "var(--border-color-strong)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--bg-card)";
        e.currentTarget.style.borderColor = "var(--border-color)";
      }}
    >
      {/* 顶部: 分类标签 + 阅读时长 */}
      <header className="flex items-center justify-between" style={{ fontSize: 10 }}>
        <span
          className="font-bold"
          style={{
            padding: "2px 6px",
            borderRadius: 3,
            background: `${catColor}22`,
            color: catColor,
            letterSpacing: "0.04em",
          }}
        >
          {meta.category_label}
        </span>
        <span
          className="flex items-center gap-1"
          style={{ color: "var(--text-muted)" }}
        >
          <Clock size={10} />
          {meta.estimated_read_min} 分钟
        </span>
      </header>

      {/* 标题 */}
      <h3
        className="font-bold"
        style={{
          color: "var(--text-primary)",
          fontSize: "var(--font-md)",
          lineHeight: 1.4,
        }}
      >
        {meta.title}
      </h3>

      {/* 摘要 */}
      {meta.summary && (
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 11.5,
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {meta.summary}
        </p>
      )}

      {/* 灵感来源 */}
      {meta.inspired_by && (
        <div
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          源自: {meta.inspired_by}
        </div>
      )}

      {/* 标签 */}
      <div className="flex flex-wrap gap-1 mt-auto pt-1">
        {meta.tags.slice(0, 5).map((t) => (
          <button
            key={t}
            onClick={(e) => {
              e.stopPropagation();
              onTagClick(t);
            }}
            style={{
              fontSize: 9.5,
              padding: "1px 5px",
              borderRadius: 3,
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-color)",
            }}
          >
            #{t}
          </button>
        ))}
      </div>
    </article>
  );
}

// ============= 侧栏小组件 =============

function SectionLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 9,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        fontWeight: 700,
        padding: "10px 8px 4px",
      }}
    >
      {children}
    </div>
  );
}

function CategoryButton({
  label,
  count,
  active,
  color,
  desc,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  color?: string;
  desc?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={desc}
      className="w-full flex items-center justify-between transition-colors"
      style={{
        padding: "8px 10px",
        marginBottom: 2,
        borderRadius: 4,
        background: active ? "var(--accent-orange)" : "transparent",
        color: active ? "#1a1d28" : "var(--text-secondary)",
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        textAlign: "left",
        borderLeft: active
          ? "3px solid transparent"
          : `3px solid ${color || "transparent"}`,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span className="truncate">{label}</span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: active ? "#1a1d28" : "var(--text-muted)",
        }}
      >
        {count}
      </span>
    </button>
  );
}

function TagChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 3,
        background: active ? "var(--accent-orange)" : "var(--bg-tertiary)",
        color: active ? "#1a1d28" : "var(--text-secondary)",
        border: "1px solid var(--border-color)",
        fontWeight: active ? 700 : 500,
      }}
    >
      #{label}
    </button>
  );
}

// ============= 详情视图 =============

function MethodologyDetailView({
  slug,
  onBack,
}: {
  slug: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<MethodologyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const askAI = useUIStore((s) => s.askAI);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getMethodologyDetail(slug)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <PageHeader
        title={data?.title || "方法论"}
        subtitle={data?.category_label}
        actions={
          <button
            onClick={onBack}
            className="flex items-center gap-1"
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-color)",
              fontSize: 11,
            }}
          >
            <ArrowLeft size={11} />
            返回列表
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto" style={{ padding: "16px 24px 80px" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {loading ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>加载中...</div>
          ) : !data ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
              加载失败. 文章可能已被移除.
            </div>
          ) : (
            <>
              <AISummaryCard
                meta={data}
                onAsk={() =>
                  askAI(
                    `请基于《${data.title}》这个方法论, 结合当下市场环境, 帮我梳理一遍核心要点和实操注意事项.`,
                  )
                }
              />
              <article style={{ marginTop: 20 }}>
                <MarkdownView source={data.content} />
              </article>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============= AI 速读卡 =============

function AISummaryCard({
  meta,
  onAsk,
}: {
  meta: MethodologyDetail;
  onAsk: () => void;
}) {
  return (
    <section
      style={{
        background:
          "linear-gradient(135deg, rgba(139,92,246,0.10) 0%, rgba(245,158,11,0.06) 100%)",
        border: "1px solid rgba(139,92,246,0.32)",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <header className="flex items-center gap-2 mb-3">
        <Sparkles size={14} color="var(--accent-purple)" />
        <span
          className="font-bold"
          style={{
            color: "var(--accent-purple)",
            fontSize: 12,
            letterSpacing: "0.06em",
          }}
        >
          AI 速读
        </span>
        <span
          style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}
        >
          约 {meta.word_count.toLocaleString()} 字 · {meta.estimated_read_min} 分钟读完
        </span>
      </header>

      {meta.summary && (
        <blockquote
          style={{
            borderLeft: "3px solid var(--accent-orange)",
            padding: "4px 12px",
            color: "var(--text-primary)",
            fontSize: 13,
            lineHeight: 1.7,
            background: "rgba(245,158,11,0.05)",
            borderRadius: "0 4px 4px 0",
            marginBottom: 12,
          }}
        >
          {meta.summary}
        </blockquote>
      )}

      <dl
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
      >
        {meta.applicable_to.length > 0 && (
          <KvBlock label="适用场景" items={meta.applicable_to} color="var(--accent-blue)" />
        )}
        {meta.market_phase.length > 0 && (
          <KvBlock label="适用行情" items={meta.market_phase} color="var(--accent-green)" />
        )}
        {meta.inspired_by && (
          <KvBlock label="思想源头" items={[meta.inspired_by]} color="var(--accent-orange)" />
        )}
      </dl>

      <div
        className="flex items-center justify-between"
        style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--border-color)" }}
      >
        <div className="flex flex-wrap gap-1">
          {meta.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 3,
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-color)",
              }}
            >
              #{t}
            </span>
          ))}
        </div>
        <button
          onClick={onAsk}
          className="flex items-center gap-1 font-bold"
          style={{
            padding: "6px 12px",
            borderRadius: 4,
            background: "var(--accent-purple)",
            color: "#fff",
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          <Sparkles size={11} />
          让 AI 套用到当下行情
        </button>
      </div>
    </section>
  );
}

function KvBlock({
  label,
  items,
  color,
}: {
  label: string;
  items: string[];
  color: string;
}) {
  return (
    <div>
      <dt
        style={{
          fontSize: 9.5,
          color: "var(--text-tertiary)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        {label}
      </dt>
      <dd className="flex flex-wrap gap-1">
        {items.map((it) => (
          <span
            key={it}
            style={{
              fontSize: 10.5,
              padding: "2px 6px",
              borderRadius: 3,
              background: `${color}1f`,
              color,
              fontWeight: 600,
            }}
          >
            {it}
          </span>
        ))}
      </dd>
    </div>
  );
}

// ============= 极简 Markdown 渲染器 =============
//
// 支持: # / ## / ### / #### 标题、`>` 引用、`- ` 列表、`1. ` 有序列表、
//      `**bold**` 粗体、`*italic*` 斜体、`` `code` ``、--- 分割线、空行段落.
// 不支持: 表格、链接 (我们的文章里都没用), 防止依赖膨胀.
function MarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div
      style={{
        color: "var(--text-primary)",
        fontSize: 14,
        lineHeight: 1.8,
      }}
    >
      {blocks.map((b, i) => (
        <MarkdownBlock key={i} block={b} />
      ))}
    </div>
  );
}

type MdBlock =
  | { type: "h"; level: number; text: string }
  | { type: "p"; text: string }
  | { type: "quote"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "hr" }
  | { type: "code"; lang: string; text: string };

function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push({ type: "p", text: para.join(" ").trim() });
      para = [];
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }

    // hr
    if (/^---+$/.test(line.trim())) {
      flushPara();
      out.push({ type: "hr" });
      i++;
      continue;
    }

    // headings
    const hMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hMatch) {
      flushPara();
      out.push({ type: "h", level: hMatch[1].length, text: hMatch[2].trim() });
      i++;
      continue;
    }

    // fenced code
    if (/^```/.test(line)) {
      flushPara();
      const lang = line.replace(/^```/, "").trim();
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push({ type: "code", lang, text: buf.join("\n") });
      continue;
    }

    // blockquote (连续 `>` 行合并为一段)
    if (/^>\s?/.test(line)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push({ type: "quote", text: buf.join(" ") });
      continue;
    }

    // unordered list
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push({ type: "ul", items });
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      out.push({ type: "ol", items });
      continue;
    }

    // 普通段落: 折叠多行成一段
    para.push(line.trim());
    i++;
  }
  flushPara();
  return out;
}

function MarkdownBlock({ block }: { block: MdBlock }) {
  if (block.type === "h") {
    const sizes = [22, 19, 16, 14, 13, 12];
    const top = [28, 24, 20, 16, 12, 12];
    const fs = sizes[Math.min(block.level - 1, sizes.length - 1)];
    const mt = top[Math.min(block.level - 1, top.length - 1)];
    return (
      <h2
        style={{
          fontSize: fs,
          fontWeight: 700,
          color: "var(--text-primary)",
          marginTop: mt,
          marginBottom: 10,
          paddingBottom: block.level <= 2 ? 6 : 0,
          borderBottom:
            block.level === 1
              ? "2px solid var(--accent-orange)"
              : block.level === 2
              ? "1px solid var(--border-color-strong)"
              : "none",
        }}
      >
        <InlineSpan text={block.text} />
      </h2>
    );
  }
  if (block.type === "p") {
    return (
      <p style={{ margin: "10px 0", color: "var(--text-secondary)" }}>
        <InlineSpan text={block.text} />
      </p>
    );
  }
  if (block.type === "quote") {
    return (
      <blockquote
        style={{
          borderLeft: "3px solid var(--accent-orange)",
          padding: "8px 14px",
          margin: "12px 0",
          background: "rgba(245,158,11,0.06)",
          borderRadius: "0 4px 4px 0",
          color: "var(--text-primary)",
          fontSize: 13.5,
          lineHeight: 1.75,
        }}
      >
        <InlineSpan text={block.text} />
      </blockquote>
    );
  }
  if (block.type === "ul") {
    return (
      <ul
        style={{
          margin: "8px 0 8px 18px",
          color: "var(--text-secondary)",
          listStyle: "disc",
        }}
      >
        {block.items.map((it, i) => (
          <li key={i} style={{ margin: "4px 0" }}>
            <InlineSpan text={it} />
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === "ol") {
    return (
      <ol
        style={{
          margin: "8px 0 8px 22px",
          color: "var(--text-secondary)",
          listStyle: "decimal",
        }}
      >
        {block.items.map((it, i) => (
          <li key={i} style={{ margin: "4px 0" }}>
            <InlineSpan text={it} />
          </li>
        ))}
      </ol>
    );
  }
  if (block.type === "hr") {
    return (
      <hr
        style={{
          border: "none",
          borderTop: "1px dashed var(--border-color)",
          margin: "20px 0",
        }}
      />
    );
  }
  if (block.type === "code") {
    return (
      <pre
        style={{
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border-color)",
          borderRadius: 4,
          padding: 12,
          overflowX: "auto",
          fontSize: 12,
          lineHeight: 1.6,
          color: "var(--text-primary)",
          margin: "12px 0",
        }}
      >
        <code>{block.text}</code>
      </pre>
    );
  }
  return null;
}

/**
 * 极简 inline 渲染: 处理 **bold** / *italic* / `code`.
 * 文章里没有 [text](url), 不做 link 渲染.
 */
function InlineSpan({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  // 用一个轻量正则切片: **bold** | *italic* | `code`
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(text.slice(lastIndex, m.index));
    }
    const seg = m[0];
    if (seg.startsWith("**")) {
      nodes.push(
        <strong
          key={key++}
          style={{ color: "var(--text-primary)", fontWeight: 700 }}
        >
          {seg.slice(2, -2)}
        </strong>,
      );
    } else if (seg.startsWith("`")) {
      nodes.push(
        <code
          key={key++}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-color)",
            padding: "0 5px",
            borderRadius: 3,
            fontSize: 12,
            color: "var(--accent-orange)",
          }}
        >
          {seg.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <em key={key++} style={{ color: "var(--text-primary)", fontStyle: "italic" }}>
          {seg.slice(1, -1)}
        </em>,
      );
    }
    lastIndex = m.index + seg.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return <>{nodes}</>;
}
