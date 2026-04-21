"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Star,
  Target,
  BookOpen,
  Award,
  ChevronRight,
  X,
  type LucideIcon,
} from "lucide-react";
import { usePrivateStatus } from "@/stores/private-status-store";
import { useUIStore, type NavModule } from "@/stores/ui-store";

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

  if (totalUnlocked === 0) return null;

  const todayTriggers = status?.plans.today_triggers ?? 0;

  const goto = (m: NavModule) => {
    setActiveModule(m);
    setOpen(false);
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
                todayTriggers > 0 ? "#ffaa33" : "var(--text-secondary)",
            }}
          />
          {todayTriggers > 0 && (
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
            >
              {todayTriggers > 99 ? "99+" : todayTriggers}
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
