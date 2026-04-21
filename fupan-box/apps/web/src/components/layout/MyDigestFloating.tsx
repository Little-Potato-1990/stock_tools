"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Star,
  Target,
  BookOpen,
  Award,
  ChevronRight,
  X,
  Newspaper,
  TrendingUp,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { usePrivateStatus } from "@/stores/private-status-store";
import { useUIStore, type NavModule } from "@/stores/ui-store";
import { api } from "@/lib/api";

type NewsDigest = Awaited<ReturnType<typeof api.getMyNewsDigest>>;
type NewsDigestItem = NewsDigest["items"][number];

/**
 * 右上角"我的速览"浮动面板.
 *
 * - 默认 40x40 圆形按钮 + 今日触发徽章, 与 AnomalyBell (right-3) 并排, 放在它左侧.
 * - 点开后展开 360px 面板, 显示自选 / 计划 / 复盘 / AI 战绩 4 段, 未解锁的段不显示.
 * - 4 段都未解锁时, 完全不渲染 (避免对纯复盘党造成视觉负担).
 */
export function MyDigestFloating() {
  const status = usePrivateStatus();
  const [open, setOpen] = useState(false);
  const setActiveModule = useUIStore((s) => s.setActiveModule);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const wlOk = status?.watchlist.unlocked ?? false;
  const planOk = status?.plans.unlocked ?? false;
  const tradeOk = status?.trades.unlocked ?? false;
  const aiOk = status?.ai_track.unlocked ?? false;
  const totalUnlocked = [wlOk, planOk, tradeOk, aiOk].filter(Boolean).length;

  // 个人化新闻速报: 仅在 watchlist 解锁 + 面板打开时拉
  const [digest, setDigest] = useState<NewsDigest | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const fetchedAtRef = useRef<number>(0);
  useEffect(() => {
    if (!open || !wlOk) return;
    // 5 分钟内复用缓存, 避免反复开关浮窗时打 API
    if (Date.now() - fetchedAtRef.current < 5 * 60 * 1000 && digest != null) return;
    setDigestLoading(true);
    api.getMyNewsDigest({ hours: 24, topK: 6 })
      .then((d) => {
        setDigest(d);
        fetchedAtRef.current = Date.now();
      })
      .catch((e) => {
        console.warn("[my-news-digest]", e);
      })
      .finally(() => setDigestLoading(false));
  }, [open, wlOk, digest]);

  if (totalUnlocked === 0) return null;

  const todayTriggers = status?.plans.today_triggers ?? 0;
  const watchAlerts = digest?.items.filter((it) => (it.importance || 0) >= 3 || it.sentiment === "bullish" || it.sentiment === "bearish").length ?? 0;
  const totalBadge = todayTriggers + watchAlerts;

  const goto = (m: NavModule) => {
    setActiveModule(m);
    setOpen(false);
  };

  const gotoNewsItem = (id: number) => {
    setActiveModule("news");
    setOpen(false);
    if (typeof window !== "undefined") {
      window.location.hash = `#/news?focus=${id}`;
    }
  };

  return (
    <div className="fixed top-3 z-40" style={{ right: 60 }} ref={ref}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          title="我的数据速览"
          className="relative flex items-center justify-center w-10 h-10 rounded-full transition-all"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            boxShadow:
              todayTriggers > 0
                ? "0 0 12px rgba(255, 170, 51, 0.5)"
                : "0 1px 4px rgba(0,0,0,0.2)",
          }}
        >
          <Star
            size={18}
            style={{
              color:
                totalBadge > 0 ? "#ffaa33" : "var(--text-secondary)",
            }}
          />
          {totalBadge > 0 && (
            <span
              className="absolute -top-1 -right-1 flex items-center justify-center text-white font-bold rounded-full"
              style={{
                background: "#ffaa33",
                minWidth: 18,
                height: 18,
                fontSize: 10,
                padding: "0 4px",
                boxShadow: "0 0 0 2px var(--bg-primary)",
              }}
              title={
                todayTriggers > 0
                  ? `今日触发 ${todayTriggers} · 自选要闻 ${watchAlerts}`
                  : `自选要闻 ${watchAlerts}`
              }
            >
              {totalBadge > 99 ? "99+" : totalBadge}
            </span>
          )}
        </button>
      ) : (
        <div
          className="overflow-hidden"
          style={{
            width: 360,
            maxHeight: "70vh",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: 8,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}
        >
          <div
            className="flex items-center justify-between px-3"
            style={{
              height: 40,
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            <span
              style={{
                fontSize: "var(--font-md)",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              我的速览
            </span>
            <button
              onClick={() => setOpen(false)}
              style={{ color: "var(--text-secondary)" }}
            >
              <X size={16} />
            </button>
          </div>
          <div
            className="overflow-y-auto"
            style={{ maxHeight: "calc(70vh - 40px)" }}
          >
            {wlOk && status && (
              <Section
                icon={Star}
                title="自选"
                hint={`${status.watchlist.count} 只`}
                onClick={() => goto("watchlist")}
              >
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--text-secondary)",
                  }}
                >
                  点击查看自选股今日表现 / 异动 / 触发计划
                </p>
              </Section>
            )}

            {wlOk && (
              <NewsDigestSection
                digest={digest}
                loading={digestLoading}
                onGotoNews={() => goto("news")}
                onGotoItem={gotoNewsItem}
              />
            )}

            {planOk && status && (
              <Section
                icon={Target}
                title="计划"
                hint={
                  status.plans.today_triggers > 0
                    ? `今日触发 ${status.plans.today_triggers}`
                    : `${status.plans.active} 活跃 / ${status.plans.triggered} 已触发`
                }
                highlight={status.plans.today_triggers > 0}
                onClick={() => goto("plans")}
              >
                {status.plans.triggered_codes.length > 0 ? (
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                    }}
                  >
                    涉及标的:{" "}
                    {status.plans.triggered_codes.slice(0, 6).join(" · ")}
                  </p>
                ) : (
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                    }}
                  >
                    暂无新触发
                  </p>
                )}
              </Section>
            )}

            {tradeOk && status && (
              <Section
                icon={BookOpen}
                title="我的复盘"
                hint={`7日 ${status.trades.count_7d} / 累计 ${status.trades.count_total}`}
                onClick={() => goto("my_review")}
              >
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--text-secondary)",
                  }}
                >
                  点击查看交易记录 + AI 自动复盘
                </p>
              </Section>
            )}

            {aiOk && status && (
              <Section
                icon={Award}
                title="AI 战绩"
                hint={`已验 ${status.ai_track.verified_7d}`}
                onClick={() => goto("ai_track")}
              >
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--text-secondary)",
                  }}
                >
                  AI 7 日内已验证的预测条数
                </p>
              </Section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  highlight,
  onClick,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  highlight?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left transition-colors"
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid var(--border-color)",
        display: "block",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        className="flex items-center gap-2"
        style={{ marginBottom: 4 }}
      >
        <Icon
          size={14}
          style={{
            color: highlight ? "#ffaa33" : "var(--text-secondary)",
          }}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text-primary)",
            flex: 1,
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: highlight ? "#ffaa33" : "var(--text-secondary)",
          }}
        >
          {hint}
        </span>
        <ChevronRight
          size={12}
          style={{ color: "var(--text-tertiary)" }}
        />
      </div>
      {children}
    </button>
  );
}


// ===== 个人化新闻速报 section =====

const SENT_COLOR: Record<string, { bg: string; fg: string; icon: typeof TrendingUp | null; label: string }> = {
  bullish: { bg: "rgba(239,68,68,0.14)", fg: "var(--accent-red)", icon: TrendingUp, label: "利好" },
  bearish: { bg: "rgba(34,197,94,0.14)", fg: "var(--accent-green)", icon: TrendingDown, label: "利空" },
  neutral: { bg: "rgba(148,163,184,0.14)", fg: "var(--text-secondary)", icon: null, label: "中性" },
};

function NewsDigestSection({
  digest,
  loading,
  onGotoNews,
  onGotoItem,
}: {
  digest: NewsDigest | null;
  loading: boolean;
  onGotoNews: () => void;
  onGotoItem: (id: number) => void;
}) {
  // 没自选 (watch_count===0) 或拉到空 → 不显示, 避免占位
  const hasItems = (digest?.items?.length ?? 0) > 0;
  if (!loading && !hasItems) return null;

  const stats = digest?.stats;
  const headline = stats
    ? `24h ${stats.total} 条 · 重磅 ${stats.important} · 利好 ${stats.bullish} · 利空 ${stats.bearish}`
    : "AI 正在汇总自选要闻…";
  const highlight = (stats?.important ?? 0) > 0 || ((stats?.bullish ?? 0) + (stats?.bearish ?? 0)) >= 3;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid var(--border-color)",
      }}
    >
      <button
        onClick={onGotoNews}
        className="w-full text-left transition-colors"
        style={{ marginBottom: 6 }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
      >
        <div className="flex items-center gap-2">
          <Newspaper size={14} style={{ color: highlight ? "#ffaa33" : "var(--text-secondary)" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>
            自选要闻
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: highlight ? "#ffaa33" : "var(--text-secondary)",
            }}
          >
            {loading ? "加载中…" : `${digest?.items.length ?? 0} 条`}
          </span>
          <ChevronRight size={12} style={{ color: "var(--text-tertiary)" }} />
        </div>
        <p style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
          {headline}
        </p>
      </button>

      {loading && !hasItems && (
        <div className="space-y-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse" style={{ height: 28, background: "var(--bg-tertiary)", borderRadius: 4 }} />
          ))}
        </div>
      )}

      {hasItems && (
        <div className="space-y-1">
          {digest!.items.slice(0, 5).map((it) => (
            <DigestRow key={it.id} item={it} onClick={() => onGotoItem(it.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DigestRow({ item, onClick }: { item: NewsDigestItem; onClick: () => void }) {
  const sent = item.sentiment ? SENT_COLOR[item.sentiment] : null;
  const SentIcon = sent?.icon ?? null;
  const imp = item.importance || 0;
  const hot = imp >= 4;
  const t = item.pub_time ? item.pub_time.slice(11, 16) : "";

  return (
    <button
      onClick={onClick}
      className="w-full text-left transition-colors"
      style={{
        padding: "6px 8px",
        background: hot ? "rgba(255,170,51,0.07)" : "var(--bg-tertiary)",
        border: hot ? "1px solid rgba(255,170,51,0.35)" : "1px solid var(--border-color)",
        borderRadius: 4,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = hot ? "rgba(255,170,51,0.07)" : "var(--bg-tertiary)"; }}
      title={item.title}
    >
      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
        {sent && (
          <span
            className="flex items-center gap-0.5 font-semibold"
            style={{
              padding: "0 4px",
              fontSize: 9,
              color: sent.fg,
              background: sent.bg,
              border: `1px solid ${sent.fg}`,
              borderRadius: 2,
            }}
          >
            {SentIcon && <SentIcon size={8} />}
            {sent.label}
          </span>
        )}
        {imp >= 3 && (
          <span
            className="font-bold"
            style={{
              padding: "0 4px",
              fontSize: 9,
              color: "var(--accent-orange)",
              border: "1px solid var(--accent-orange)",
              borderRadius: 2,
            }}
          >
            ⭐ {imp}
          </span>
        )}
        {item.watch_codes_hit.slice(0, 2).map((c) => (
          <span
            key={c}
            className="font-bold tabular-nums"
            style={{
              padding: "0 4px",
              fontSize: 9,
              color: "#1a1d28",
              background: "var(--accent-orange)",
              borderRadius: 2,
            }}
          >
            {c}
          </span>
        ))}
        {t && (
          <span style={{ fontSize: 9, color: "var(--text-tertiary)", marginLeft: "auto" }}>
            {t}
          </span>
        )}
      </div>
      <div
        className="line-clamp-1"
        style={{
          fontSize: 11,
          color: "var(--text-primary)",
          fontWeight: 500,
          lineHeight: 1.35,
        }}
      >
        {item.title}
      </div>
    </button>
  );
}
