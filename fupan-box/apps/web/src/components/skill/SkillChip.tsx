"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, ChevronDown, Plus, Settings } from "lucide-react";
import { useSkillStore } from "@/stores/skill-store";
import { api } from "@/lib/api";

interface Props {
  /** 紧凑模式 (header / chip 区域) */
  compact?: boolean;
  /** 触发后回调 (用于关闭外层菜单等) */
  onAfterChange?: (ref: string | null) => void;
  /** 在 dropdown 底部展示「编辑/管理」入口 */
  showManageEntry?: boolean;
  /** 用户点击「管理我的体系」的回调 (一般跳转到 SkillEditorPage) */
  onManageClick?: () => void;
  /** 可见前缀 label (默认「体系」) */
  label?: string;
}

/**
 * SkillChip - 全局「当前激活体系」选择器
 *
 * - 中立 (灰底)：默认状态，AI 不强制走任何体系视角
 * - 已选体系 (紫色)：AI 输出会带上【XX视角】标签
 *
 * 挂载点：AiPanel header / 自选股页 / 个股详情页
 */
export function SkillChip({
  compact = false,
  onAfterChange,
  showManageEntry = true,
  onManageClick,
  label = "体系",
}: Props) {
  const activeRef = useSkillStore((s) => s.activeRef);
  const activeName = useSkillStore((s) => s.activeName);
  const systemOptions = useSkillStore((s) => s.systemOptions);
  const userOptions = useSkillStore((s) => s.userOptions);
  const loaded = useSkillStore((s) => s.loaded);
  const loadOptions = useSkillStore((s) => s.loadOptions);
  const setActiveAndPersist = useSkillStore((s) => s.setActiveAndPersist);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loaded) loadOptions();
  }, [loaded, loadOptions]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const isLoggedIn = typeof window !== "undefined" && api.isLoggedIn();
  const display = activeName ?? "中立";
  const colored = !!activeRef;

  const handlePick = async (next: string | null) => {
    setBusy(true);
    try {
      await setActiveAndPersist(next);
      onAfterChange?.(next);
    } catch (e) {
      console.warn("setActiveSkill failed", e);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative" style={{ display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title={
          colored
            ? `当前体系视角：${display}（点击切换或关闭）`
            : "中立模式 — AI 不强制走任何体系视角"
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: compact ? "2px 8px" : "4px 10px",
          borderRadius: 999,
          fontSize: compact ? "var(--font-xs)" : "var(--font-sm)",
          fontWeight: 600,
          border: "1px solid",
          borderColor: colored ? "var(--accent-purple)" : "var(--border-color)",
          background: colored ? "rgba(139, 92, 246, 0.12)" : "var(--bg-tertiary)",
          color: colored ? "var(--accent-purple)" : "var(--text-secondary)",
          cursor: busy ? "wait" : "pointer",
          transition: "all 0.15s",
        }}
      >
        <Sparkles size={compact ? 10 : 12} />
        <span>
          {label}: {display}
        </span>
        <ChevronDown size={compact ? 10 : 12} />
      </button>

      {open && (
        <div
          className="absolute z-50"
          style={{
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 240,
            maxHeight: 360,
            overflowY: "auto",
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            padding: 4,
          }}
        >
          {/* 中立 */}
          <button
            onClick={() => handlePick(null)}
            className="w-full text-left px-2 py-1.5 transition-colors hover:brightness-125"
            style={{
              background: activeRef === null ? "var(--bg-tertiary)" : "transparent",
              color: activeRef === null ? "var(--accent-purple)" : "var(--text-primary)",
              fontSize: "var(--font-sm)",
              borderRadius: 4,
            }}
          >
            <div style={{ fontWeight: 600 }}>中立 (默认)</div>
            <div style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
              AI 不绑定任何体系视角
            </div>
          </button>

          {/* 系统体系 */}
          {systemOptions.length > 0 && (
            <>
              <div
                className="px-2 py-1 mt-1"
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  letterSpacing: 0.5,
                }}
              >
                内置体系
              </div>
              {systemOptions.map((o) => (
                <button
                  key={o.ref}
                  onClick={() => handlePick(o.ref)}
                  className="w-full text-left px-2 py-1.5 transition-colors hover:brightness-125"
                  style={{
                    background: activeRef === o.ref ? "var(--bg-tertiary)" : "transparent",
                    color:
                      activeRef === o.ref ? "var(--accent-purple)" : "var(--text-primary)",
                    fontSize: "var(--font-sm)",
                    borderRadius: 4,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {o.icon ? `${o.icon} ` : ""}
                    {o.name}
                  </div>
                  {o.tagline && (
                    <div style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
                      {o.tagline}
                    </div>
                  )}
                </button>
              ))}
            </>
          )}

          {/* 我的体系 */}
          {isLoggedIn && (
            <>
              <div
                className="px-2 py-1 mt-1 flex items-center justify-between"
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  letterSpacing: 0.5,
                }}
              >
                <span>我的体系</span>
                {showManageEntry && (
                  <button
                    onClick={() => {
                      setOpen(false);
                      onManageClick?.();
                    }}
                    title="新建 / 管理我的体系"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 2,
                      padding: "1px 4px",
                      color: "var(--accent-purple)",
                      fontSize: "var(--font-xs)",
                    }}
                  >
                    <Plus size={10} />
                    新建
                  </button>
                )}
              </div>
              {userOptions.length === 0 ? (
                <div
                  className="px-2 py-2"
                  style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}
                >
                  暂无 — 写一段你自己的投资体系，让 AI 按它给建议
                </div>
              ) : (
                userOptions.map((o) => (
                  <button
                    key={o.ref}
                    onClick={() => handlePick(o.ref)}
                    className="w-full text-left px-2 py-1.5 transition-colors hover:brightness-125"
                    style={{
                      background: activeRef === o.ref ? "var(--bg-tertiary)" : "transparent",
                      color:
                        activeRef === o.ref ? "var(--accent-purple)" : "var(--text-primary)",
                      fontSize: "var(--font-sm)",
                      borderRadius: 4,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {o.icon ? `${o.icon} ` : ""}
                      {o.name}
                    </div>
                  </button>
                ))
              )}
            </>
          )}

          {/* 管理入口 */}
          {showManageEntry && isLoggedIn && (
            <>
              <div style={{ height: 1, background: "var(--border-color)", margin: "4px 0" }} />
              <button
                onClick={() => {
                  setOpen(false);
                  onManageClick?.();
                }}
                className="w-full text-left px-2 py-1.5 transition-colors hover:brightness-125"
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "var(--font-xs)",
                  borderRadius: 4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Settings size={10} />
                管理我的体系
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
