"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Clock,
  Layers,
  Library,
  Search,
  Sparkles,
  X as XIcon,
} from "lucide-react";
import {
  api,
  type MethodologyDetail,
  type MethodologyFoundationSubcatStat,
  type MethodologyMeta,
  type MethodologySystem,
} from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { useUIStore } from "@/stores/ui-store";

/**
 * 方法论文库 (两层架构: 投资体系 + 基础知识库).
 *
 * 顶层视图:
 *   - systems     (默认): 投资体系卡片墙, 点入体系详情, 详情挂接基础知识 + 战法
 *   - foundations         : 基础知识词典视图, 4 子分类侧栏 + 搜索
 *
 * 详情视图 ArticleDetailView 根据 kind 三态自适应:
 *   - kind=system     : 体系信息卡 + 必读基础知识 grid + 配套战法 grid
 *   - kind=foundation : 底部 referenced_by_systems (在哪些体系里被引用)
 *   - kind=tactic     : 顶部所属体系面包屑
 */
export function MethodologyPage() {
  const [view, setView] = useState<"systems" | "foundations">("systems");
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [navStack, setNavStack] = useState<string[]>([]);

  const openSlug = (slug: string) => {
    if (activeSlug && activeSlug !== slug) {
      setNavStack((s) => [...s, activeSlug]);
    }
    setActiveSlug(slug);
  };

  const goBack = () => {
    if (navStack.length > 0) {
      const prev = navStack[navStack.length - 1];
      setNavStack((s) => s.slice(0, -1));
      setActiveSlug(prev);
    } else {
      setActiveSlug(null);
    }
  };

  if (activeSlug) {
    return <ArticleDetailView slug={activeSlug} onBack={goBack} onOpen={openSlug} />;
  }

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <PageHeader
        title="方法论文库"
        subtitle={
          view === "systems"
            ? "投资体系 · 选一个适合你的风格"
            : "基础知识库 · 客观工具与概念词典"
        }
        actions={<ViewSwitcher view={view} onChange={setView} />}
      />
      {view === "systems" ? (
        <SystemsView onOpen={openSlug} />
      ) : (
        <FoundationsView onOpen={openSlug} />
      )}
    </div>
  );
}

// ============= 顶部视图切换 =============

function ViewSwitcher({
  view,
  onChange,
}: {
  view: "systems" | "foundations";
  onChange: (v: "systems" | "foundations") => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border-color)",
        borderRadius: 6,
        padding: 2,
      }}
    >
      <SegBtn
        active={view === "systems"}
        onClick={() => onChange("systems")}
        icon={<Layers size={11} />}
        label="投资体系"
      />
      <SegBtn
        active={view === "foundations"}
        onClick={() => onChange("foundations")}
        icon={<Library size={11} />}
        label="基础知识库"
      />
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 transition-colors"
      style={{
        padding: "5px 12px",
        borderRadius: 4,
        background: active ? "var(--accent-orange)" : "transparent",
        color: active ? "#1a1d28" : "var(--text-secondary)",
        fontSize: 11,
        fontWeight: active ? 700 : 500,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ============= systems 视图: 体系卡片墙 =============

function SystemsView({ onOpen }: { onOpen: (slug: string) => void }) {
  const [data, setData] = useState<MethodologySystem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getMethodologySystems()
      .then((res) => {
        if (alive) setData(res.systems);
      })
      .catch(() => {
        if (alive) setData([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: 20 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <SystemsIntro count={data.length} />
        {loading ? (
          <SkeletonGrid />
        ) : data.length === 0 ? (
          <EmptyHint text="还没有投资体系总览。请检查 content/methodology/system-*.md。" />
        ) : (
          <div
            className="grid gap-3 mt-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))" }}
          >
            {data.map((sys) => (
              <SystemCard key={sys.slug} sys={sys} onOpen={() => onOpen(sys.slug)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SystemsIntro({ count }: { count: number }) {
  return (
    <section
      style={{
        background:
          "linear-gradient(135deg, rgba(245,158,11,0.10) 0%, rgba(139,92,246,0.06) 100%)",
        border: "1px solid rgba(245,158,11,0.32)",
        borderRadius: 8,
        padding: "14px 18px",
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <Sparkles size={18} color="var(--accent-orange)" style={{ marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text-primary)",
            marginBottom: 4,
          }}
        >
          没有"最好的"体系, 只有"最适合你的"体系
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          {`下面 ${count} 个体系是各类投资风格的总览, 包括周期、风险偏好、所需基本面 / 技术能力。`}
          <br />
          每个体系都明确告诉你: <b>必读哪些基础知识</b>、<b>配套用哪些战法</b>、<b>什么时候这套会失效</b>。
          先选风格, 再深入工具。
        </div>
      </div>
    </section>
  );
}

function SystemCard({
  sys,
  onOpen,
}: {
  sys: MethodologySystem;
  onOpen: () => void;
}) {
  const color = sys.system_color || "var(--accent-purple)";
  return (
    <article
      onClick={onOpen}
      className="cursor-pointer transition-all flex flex-col"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderTop: `3px solid ${color}`,
        borderRadius: 6,
        padding: 16,
        gap: 10,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-card-hover)";
        e.currentTarget.style.borderColor = "var(--border-color-strong)";
        e.currentTarget.style.borderTopColor = color;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--bg-card)";
        e.currentTarget.style.borderColor = "var(--border-color)";
        e.currentTarget.style.borderTopColor = color;
      }}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: 10,
              padding: "2px 7px",
              borderRadius: 3,
              background: `${color}22`,
              color,
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}
          >
            投资体系
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {sys.system_horizon}
          </span>
        </div>
        <span
          style={{
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 3,
            border: "1px solid var(--border-color)",
            color: "var(--text-secondary)",
          }}
        >
          风险 {sys.system_risk}
        </span>
      </header>

      <h3
        style={{
          color: "var(--text-primary)",
          fontSize: 16,
          fontWeight: 700,
          lineHeight: 1.35,
        }}
      >
        {sys.system_label || sys.title}
      </h3>

      {sys.system_tagline && (
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          {sys.system_tagline}
        </p>
      )}

      <div
        className="flex flex-wrap gap-1 mt-1"
        style={{ borderTop: "1px dashed var(--border-color)", paddingTop: 8 }}
      >
        {(sys.tags || []).slice(0, 4).map((t) => (
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

      <footer
        className="flex items-center justify-between mt-auto pt-2"
        style={{ fontSize: 11, color: "var(--text-muted)" }}
      >
        <span>
          必读 <b style={{ color: "var(--accent-blue)" }}>{sys.related_foundations_meta?.length || 0}</b>{" "}
          · 战法 <b style={{ color: "var(--accent-orange)" }}>{sys.related_tactics_meta?.length || 0}</b>
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {sys.estimated_read_min} 分钟
          <ChevronRight size={12} />
        </span>
      </footer>
    </article>
  );
}

// ============= foundations 视图: 词典式 =============

function FoundationsView({ onOpen }: { onOpen: (slug: string) => void }) {
  const [subcats, setSubcats] = useState<MethodologyFoundationSubcatStat[]>([]);
  const [items, setItems] = useState<MethodologyMeta[]>([]);
  const [activeSubcat, setActiveSubcat] = useState<string>("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .getMethodologyFoundations()
      .then((res) => {
        if (alive) setSubcats(res.subcategories);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getMethodologyFoundationsList({ subcat: activeSubcat, q })
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
  }, [activeSubcat, q]);

  const totalCount = useMemo(
    () => subcats.reduce((s, c) => s + c.count, 0),
    [subcats],
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside
        className="overflow-y-auto"
        style={{
          width: 220,
          borderRight: "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
          padding: "12px 8px",
        }}
      >
        <SectionLabel>子分类</SectionLabel>
        <SubcatBtn
          label="全部"
          count={totalCount}
          active={!activeSubcat}
          onClick={() => setActiveSubcat("")}
        />
        {subcats.map((c) => (
          <SubcatBtn
            key={c.key}
            label={c.label}
            count={c.count}
            color={c.color}
            desc={c.desc}
            active={activeSubcat === c.key}
            onClick={() => setActiveSubcat(activeSubcat === c.key ? "" : c.key)}
          />
        ))}

        <SectionLabel>搜索</SectionLabel>
        <div
          className="flex items-center gap-1.5"
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
            padding: "5px 8px",
            margin: "0 4px",
          }}
        >
          <Search size={11} color="var(--text-muted)" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="标题 / 标签..."
            style={{
              background: "transparent",
              outline: "none",
              border: "none",
              color: "var(--text-primary)",
              fontSize: 11,
              width: "100%",
            }}
          />
          {q && (
            <button onClick={() => setQ("")} title="清除">
              <XIcon size={11} color="var(--text-muted)" />
            </button>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
        {loading ? (
          <SkeletonGrid />
        ) : items.length === 0 ? (
          <EmptyHint text="没有匹配的基础知识。换个子分类或清空搜索看看。" />
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}
          >
            {items.map((it) => (
              <ArticleCard key={it.slug} meta={it} onOpen={() => onOpen(it.slug)} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ============= 共用: 文章卡片 (foundation / tactic) =============

function ArticleCard({
  meta,
  onOpen,
}: {
  meta: MethodologyMeta;
  onOpen: () => void;
}) {
  // 顶部小标签按 kind 智能选择
  let topLabel = meta.category_label;
  let topColor: string = "var(--text-secondary)";
  if (meta.kind === "foundation") {
    topLabel = meta.foundation_subcategory_label || meta.category_label;
    topColor = meta.foundation_subcategory_color || "var(--accent-blue)";
  } else if (meta.kind === "tactic") {
    topLabel = "战法";
    topColor = "var(--accent-orange)";
  }

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
      <header className="flex items-center justify-between" style={{ fontSize: 10 }}>
        <span
          className="font-bold"
          style={{
            padding: "2px 6px",
            borderRadius: 3,
            background: `${topColor}22`,
            color: topColor,
            letterSpacing: "0.04em",
          }}
        >
          {topLabel}
        </span>
        <span className="flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
          <Clock size={10} />
          {meta.estimated_read_min} 分钟
        </span>
      </header>

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

      {meta.inspired_by && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>
          源自: {meta.inspired_by}
        </div>
      )}

      <div className="flex flex-wrap gap-1 mt-auto pt-1">
        {meta.tags.slice(0, 5).map((t) => (
          <span
            key={t}
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
          </span>
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

function SubcatBtn({
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
        borderLeft: active ? "3px solid transparent" : `3px solid ${color || "transparent"}`,
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

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 24 }}>{text}</div>
  );
}

function SkeletonGrid() {
  return (
    <div
      className="grid gap-3 mt-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: 6,
            height: 140,
            opacity: 0.5,
          }}
        />
      ))}
    </div>
  );
}

// ============= 详情视图 (按 kind 自适应) =============

function ArticleDetailView({
  slug,
  onBack,
  onOpen,
}: {
  slug: string;
  onBack: () => void;
  onOpen: (slug: string) => void;
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

  // 监听 markdown 内 [text](slug) 链接的点击事件, 跳转本库其他文章.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ slug: string }>).detail;
      if (detail?.slug) onOpen(detail.slug);
    };
    window.addEventListener("methodology:open", handler);
    return () => window.removeEventListener("methodology:open", handler);
  }, [onOpen]);

  const subtitle = useMemo(() => {
    if (!data) return "";
    if (data.kind === "system") return data.system_tagline || data.category_label;
    if (data.kind === "foundation")
      return `基础知识 · ${data.foundation_subcategory_label || data.category_label}`;
    if (data.kind === "tactic") return `战法 · ${data.category_label}`;
    return data.category_label;
  }, [data]);

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <PageHeader
        title={data?.title || "方法论"}
        subtitle={subtitle}
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
            返回
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto" style={{ padding: "16px 24px 80px" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          {loading ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>加载中...</div>
          ) : !data ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
              加载失败. 文章可能已被移除.
            </div>
          ) : (
            <>
              {/* tactic 顶部面包屑 */}
              {data.kind === "tactic" && (data.belongs_to_systems_meta?.length ?? 0) > 0 && (
                <Breadcrumb
                  systems={data.belongs_to_systems_meta || []}
                  onJump={onOpen}
                />
              )}

              {/* AI 速读 / 体系信息卡 */}
              {data.kind === "system" ? (
                <SystemHeaderCard
                  meta={data}
                  onAsk={() =>
                    askAI(
                      `请基于《${data.title}》这个投资体系, 结合当下市场环境, 帮我判断这套体系现在适不适合用, 主要风险点是什么.`,
                    )
                  }
                />
              ) : (
                <AISummaryCard
                  meta={data}
                  onAsk={() =>
                    askAI(
                      `请基于《${data.title}》, 结合当下市场环境, 帮我梳理一遍核心要点和实操注意事项.`,
                    )
                  }
                />
              )}

              {/* 正文 */}
              <article style={{ marginTop: 20 }}>
                <MarkdownView source={data.content} />
              </article>

              {/* kind=system: 必读基础知识 + 配套战法 */}
              {data.kind === "system" && (
                <RelatedSections
                  foundations={data.related_foundations_meta || []}
                  tactics={data.related_tactics_meta || []}
                  onOpen={onOpen}
                />
              )}

              {/* kind=foundation: 反向引用 (在哪些体系里被用到) */}
              {data.kind === "foundation" &&
                (data.referenced_by_systems?.length ?? 0) > 0 && (
                  <ReferencedBySection
                    systems={data.referenced_by_systems || []}
                    onOpen={onOpen}
                  />
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============= 详情子组件 =============

function Breadcrumb({
  systems,
  onJump,
}: {
  systems: MethodologyMeta[];
  onJump: (slug: string) => void;
}) {
  return (
    <div
      className="flex items-center flex-wrap gap-1.5 mb-3"
      style={{ fontSize: 11, color: "var(--text-secondary)" }}
    >
      <span style={{ color: "var(--text-muted)" }}>所属体系:</span>
      {systems.map((s) => (
        <button
          key={s.slug}
          onClick={() => onJump(s.slug)}
          className="flex items-center gap-1 transition-colors"
          style={{
            padding: "2px 8px",
            borderRadius: 3,
            background: `${s.system_color || "var(--accent-purple)"}22`,
            color: s.system_color || "var(--accent-purple)",
            fontWeight: 700,
            fontSize: 11,
          }}
        >
          <Layers size={10} />
          {s.system_label || s.title}
        </button>
      ))}
    </div>
  );
}

function SystemHeaderCard({
  meta,
  onAsk,
}: {
  meta: MethodologyDetail;
  onAsk: () => void;
}) {
  const color = meta.system_color || "var(--accent-purple)";
  return (
    <section
      style={{
        background: `linear-gradient(135deg, ${color}1f 0%, rgba(245,158,11,0.06) 100%)`,
        border: `1px solid ${color}55`,
        borderRadius: 8,
        padding: 18,
      }}
    >
      <header className="flex items-center gap-2 mb-3">
        <Layers size={14} color={color} />
        <span
          className="font-bold"
          style={{ color, fontSize: 12, letterSpacing: "0.06em" }}
        >
          投资体系
        </span>
        <span
          style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}
        >
          约 {meta.word_count.toLocaleString()} 字 · {meta.estimated_read_min} 分钟读完
        </span>
      </header>

      <h2
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--text-primary)",
          marginBottom: 6,
        }}
      >
        {meta.system_label || meta.title}
      </h2>

      {meta.system_tagline && (
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            lineHeight: 1.6,
            marginBottom: 12,
          }}
        >
          {meta.system_tagline}
        </p>
      )}

      <dl
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
      >
        {meta.system_horizon && (
          <KvBlock label="目标周期" items={[meta.system_horizon]} color="var(--accent-blue)" />
        )}
        {meta.system_risk && (
          <KvBlock label="风险等级" items={[meta.system_risk]} color={color} />
        )}
        {meta.applicable_to.length > 0 && (
          <KvBlock label="适用场景" items={meta.applicable_to} color="var(--accent-green)" />
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
            background: color,
            color: "#fff",
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          <Sparkles size={11} />
          让 AI 评估当下适不适用
        </button>
      </div>
    </section>
  );
}

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
          style={{ color: "var(--accent-purple)", fontSize: 12, letterSpacing: "0.06em" }}
        >
          AI 速读
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>
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

// ============= 体系详情下的 related 区块 =============

function RelatedSections({
  foundations,
  tactics,
  onOpen,
}: {
  foundations: MethodologyMeta[];
  tactics: MethodologyMeta[];
  onOpen: (slug: string) => void;
}) {
  return (
    <div style={{ marginTop: 32 }}>
      {foundations.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <SectionTitle
            icon={<Library size={14} color="var(--accent-blue)" />}
            label="必读基础知识"
            count={foundations.length}
            color="var(--accent-blue)"
          />
          <div
            className="grid gap-3 mt-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
          >
            {foundations.map((f) => (
              <ArticleCard key={f.slug} meta={f} onOpen={() => onOpen(f.slug)} />
            ))}
          </div>
        </section>
      )}

      {tactics.length > 0 && (
        <section>
          <SectionTitle
            icon={<BookOpen size={14} color="var(--accent-orange)" />}
            label="配套战法"
            count={tactics.length}
            color="var(--accent-orange)"
          />
          <div
            className="grid gap-3 mt-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
          >
            {tactics.map((t) => (
              <ArticleCard key={t.slug} meta={t} onOpen={() => onOpen(t.slug)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionTitle({
  icon,
  label,
  count,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: string;
}) {
  return (
    <header
      className="flex items-center gap-2"
      style={{
        paddingBottom: 8,
        borderBottom: `1px solid ${color}55`,
      }}
    >
      {icon}
      <h3
        style={{
          color: "var(--text-primary)",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </h3>
      <span
        style={{
          fontSize: 10,
          padding: "1px 7px",
          borderRadius: 10,
          background: `${color}22`,
          color,
          fontWeight: 700,
        }}
      >
        {count}
      </span>
    </header>
  );
}

function ReferencedBySection({
  systems,
  onOpen,
}: {
  systems: MethodologyMeta[];
  onOpen: (slug: string) => void;
}) {
  return (
    <section
      style={{
        marginTop: 28,
        padding: "14px 16px",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-color)",
        borderRadius: 6,
      }}
    >
      <header className="flex items-center gap-2 mb-2">
        <Layers size={13} color="var(--accent-purple)" />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-secondary)",
            letterSpacing: "0.08em",
          }}
        >
          在以下投资体系里被引用
        </span>
      </header>
      <div className="flex flex-wrap gap-2">
        {systems.map((s) => {
          const c = s.system_color || "var(--accent-purple)";
          return (
            <button
              key={s.slug}
              onClick={() => onOpen(s.slug)}
              className="flex items-center gap-1 transition-colors"
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                background: `${c}1f`,
                color: c,
                fontWeight: 700,
                fontSize: 11.5,
                border: `1px solid ${c}55`,
              }}
            >
              <Layers size={11} />
              {s.system_label || s.title}
              <ChevronRight size={11} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ============= 极简 Markdown 渲染器 (保留原实现) =============
//
// 支持: # / ## / ### / #### 标题、`>` 引用、`- ` 列表、`1. ` 有序列表、
//      `**bold**` 粗体、`*italic*` 斜体、`` `code` ``、--- 分割线、空行段落、
//      [text](slug) 链接 (仅 slug 形式, 点击跳本库其他文章).
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
  | { type: "code"; lang: string; text: string }
  | { type: "table"; rows: string[][]; align: ("l" | "r" | "c")[] };

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

  const isTableSep = (s: string) =>
    /^\s*\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(s);

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushPara();
      out.push({ type: "hr" });
      i++;
      continue;
    }

    const hMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hMatch) {
      flushPara();
      out.push({ type: "h", level: hMatch[1].length, text: hMatch[2].trim() });
      i++;
      continue;
    }

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

    // table: 当前行是 | x | y | 格式, 下一行是 |---|---| 分隔行
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      const splitRow = (s: string) =>
        s
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((c) => c.trim());
      const headers = splitRow(line);
      const align: ("l" | "r" | "c")[] = splitRow(lines[i + 1]).map((c) => {
        const left = c.startsWith(":");
        const right = c.endsWith(":");
        if (left && right) return "c";
        if (right) return "r";
        return "l";
      });
      const rows: string[][] = [headers];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push({ type: "table", rows, align });
      continue;
    }

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
  if (block.type === "table") {
    const [head, ...body] = block.rows;
    return (
      <div style={{ overflowX: "auto", margin: "12px 0" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12.5,
            border: "1px solid var(--border-color)",
          }}
        >
          <thead>
            <tr style={{ background: "var(--bg-tertiary)" }}>
              {head?.map((h, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: block.align[i] === "r" ? "right" : block.align[i] === "c" ? "center" : "left",
                    padding: "6px 10px",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-primary)",
                    fontWeight: 700,
                  }}
                >
                  <InlineSpan text={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>
                {row.map((c, ci) => (
                  <td
                    key={ci}
                    style={{
                      textAlign:
                        block.align[ci] === "r"
                          ? "right"
                          : block.align[ci] === "c"
                          ? "center"
                          : "left",
                      padding: "6px 10px",
                      border: "1px solid var(--border-color)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <InlineSpan text={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

/**
 * 极简 inline 渲染:
 *   - **bold** / *italic* / `code`
 *   - [text](slug) 链接: 只支持 slug 形式 (不带 http), 点击通过 window event 跳转
 */
function InlineSpan({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  // 优先匹配链接, 然后 bold/italic/code
  const pattern = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(text.slice(lastIndex, m.index));
    }
    const seg = m[0];
    if (seg.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(seg);
      if (linkMatch) {
        const label = linkMatch[1];
        const target = linkMatch[2].trim();
        const isExternal = /^https?:\/\//.test(target);
        if (isExternal) {
          nodes.push(
            <a
              key={key++}
              href={target}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent-blue)", textDecoration: "underline" }}
            >
              {label}
            </a>,
          );
        } else {
          // slug 链接: 通过自定义 event 让 ArticleDetailView 监听跳转
          nodes.push(
            <a
              key={key++}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                window.dispatchEvent(
                  new CustomEvent("methodology:open", { detail: { slug: target } }),
                );
              }}
              style={{ color: "var(--accent-orange)", textDecoration: "underline" }}
            >
              {label}
            </a>,
          );
        }
      } else {
        nodes.push(seg);
      }
    } else if (seg.startsWith("**")) {
      nodes.push(
        <strong key={key++} style={{ color: "var(--text-primary)", fontWeight: 700 }}>
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
