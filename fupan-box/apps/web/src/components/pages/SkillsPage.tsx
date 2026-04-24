"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Plus,
  Trash2,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Loader2,
  ArrowLeft,
  PencilLine,
  Telescope,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useUIStore } from "@/stores/ui-store";
import { useSkillStore } from "@/stores/skill-store";
import {
  api,
  type UserSkillMeta,
  type UserSkillDetail,
  type SkillCatalog,
} from "@/lib/api";

/**
 * 我的体系 (User Skills) 管理页 — 三视图：
 *   - list   : 我的体系列表 + 新建按钮
 *   - editor : 编辑/新建单个体系 (自由文本 + lint 提示 + derived rules 预览)
 *   - 切到扫描页通过 setActiveModule('skill_scan') 完成
 */
export function SkillsPage() {
  const [view, setView] = useState<"list" | "editor">("list");
  const [editingId, setEditingId] = useState<number | null>(null); // null = 新建
  const setActiveModule = useUIStore((s) => s.setActiveModule);

  const openEditor = (id: number | null) => {
    setEditingId(id);
    setView("editor");
  };

  const back = () => {
    setView("list");
    setEditingId(null);
  };

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <PageHeader
        title="我的体系"
        subtitle="自由文本写一段你自己的投资体系，AI 会按它给你建议、扫股"
        actions={
          view === "list" ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveModule("skill_scan")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-opacity hover:opacity-90"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  fontSize: "var(--font-sm)",
                  border: "1px solid var(--border-color)",
                }}
              >
                <Telescope size={12} />
                体系扫描
              </button>
              <button
                onClick={() => openEditor(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-opacity hover:opacity-90"
                style={{
                  background: "var(--accent-purple)",
                  color: "#fff",
                  fontSize: "var(--font-sm)",
                  fontWeight: 600,
                }}
              >
                <Plus size={12} />
                新建体系
              </button>
            </div>
          ) : (
            <button
              onClick={back}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-opacity hover:opacity-90"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                fontSize: "var(--font-sm)",
              }}
            >
              <ArrowLeft size={12} />
              返回列表
            </button>
          )
        }
      />
      {view === "list" ? (
        <SkillList onOpen={openEditor} />
      ) : (
        <SkillEditor skillId={editingId} onSaved={back} onArchived={back} />
      )}
    </div>
  );
}

// ============================ list ============================

function SkillList({ onOpen }: { onOpen: (id: number | null) => void }) {
  const [rows, setRows] = useState<UserSkillMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refreshUser = useSkillStore((s) => s.refreshUserOptions);
  const activeRef = useSkillStore((s) => s.activeRef);
  const setActiveAndPersist = useSkillStore((s) => s.setActiveAndPersist);

  const load = useCallback(async () => {
    try {
      const res = await api.listUserSkills(false);
      setRows(res?.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    if (!api.isLoggedIn()) {
      setErr("请先登录");
      return;
    }
    load();
  }, [load]);

  const handleArchive = async (id: number) => {
    if (!confirm("归档这个体系？(可在后端恢复)")) return;
    try {
      await api.archiveUserSkill(id);
      await load();
      await refreshUser();
    } catch (e) {
      alert(e instanceof Error ? e.message : "归档失败");
    }
  };

  if (err) {
    return (
      <div className="p-6" style={{ color: "var(--text-muted)" }}>
        {err}
      </div>
    );
  }
  if (rows === null) {
    return (
      <div className="p-6 flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
        <Loader2 size={14} className="animate-spin" />
        加载中…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <Sparkles size={32} style={{ color: "var(--accent-purple)", opacity: 0.6 }} />
        <p
          className="mt-3 font-semibold"
          style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
        >
          你还没有自定义体系
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)", maxWidth: 480 }}>
          写一段你自己的「投资体系」，AI 就会按它的口径给你做选股建议、个股点评、自选股复盘。
          不用一上来全写完，可以先简短描述，系统会提示哪里没说清。
        </p>
        <button
          onClick={() => onOpen(null)}
          className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded transition-opacity hover:opacity-90"
          style={{ background: "var(--accent-purple)", color: "#fff", fontSize: "var(--font-sm)", fontWeight: 600 }}
        >
          <Plus size={12} />
          新建我的第一个体系
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      {rows.map((r) => {
        const isActive = activeRef === r.ref;
        const warnCount = r.completeness_warnings?.length || 0;
        return (
          <div
            key={r.id}
            className="flex items-center gap-3 px-4 py-3 rounded transition-colors hover:brightness-110"
            style={{
              background: "var(--bg-card)",
              border: `1px solid ${isActive ? "var(--accent-purple)" : "var(--border-color)"}`,
            }}
          >
            <button
              onClick={() => onOpen(r.id)}
              className="flex-1 text-left flex items-center gap-3"
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 6,
                  background: isActive ? "var(--accent-purple)" : "var(--bg-tertiary)",
                  color: isActive ? "#fff" : "var(--accent-purple)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                }}
              >
                {r.icon || "🧠"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {r.name}
                  </span>
                  {isActive && (
                    <span
                      style={{
                        padding: "1px 6px",
                        borderRadius: 3,
                        background: "var(--accent-purple)",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      当前激活
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1" style={{ fontSize: "var(--font-xs)", color: "var(--text-muted)" }}>
                  <span>slug: {r.slug}</span>
                  {r.derived_rules ? (
                    <span style={{ color: "var(--accent-blue)" }}>
                      <CheckCircle2 size={10} className="inline mr-0.5" />
                      已生成执行规则
                      {r.rules_user_edited ? "（已手工校对）" : ""}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>暂无执行规则</span>
                  )}
                  {warnCount > 0 && (
                    <span style={{ color: "var(--accent-orange)" }}>
                      <AlertCircle size={10} className="inline mr-0.5" />
                      {warnCount} 项可补充
                    </span>
                  )}
                  {r.updated_at && (
                    <span className="ml-auto">
                      {new Date(r.updated_at).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </div>
            </button>
            <button
              onClick={() => setActiveAndPersist(isActive ? null : r.ref)}
              className="px-2 py-1 rounded text-xs transition-opacity hover:opacity-90"
              style={{
                border: "1px solid var(--border-color)",
                color: isActive ? "var(--text-muted)" : "var(--accent-purple)",
                background: "var(--bg-tertiary)",
              }}
              title={isActive ? "取消激活" : "设为当前激活"}
            >
              {isActive ? "取消激活" : "激活"}
            </button>
            <button
              onClick={() => handleArchive(r.id)}
              className="p-1.5 rounded transition-opacity hover:opacity-70"
              title="归档"
              style={{ color: "var(--text-muted)" }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ============================ editor ============================

const TEMPLATE = `# 我的投资体系

## 选股口径
- (例) 行业属于：新能源 / 半导体 / AI 应用
- (例) PE-TTM ≤ 50，ROE 三年均值 ≥ 12%
- (例) 趋势条件：站稳 60 日均线，且 20/60 日多头排列

## 入场时机
- (例) 突破近 60 日新高 / 回踩 20 日均线缩量企稳
- (例) 不追停板，只做开盘平开/低开后翻红

## 仓位 & 风控
- (例) 单股初仓 5%，最大持仓 15%
- (例) 跌破 20 日均线减半仓，跌破 60 日均线清仓
- (例) 单日亏损 -5% 强制止损

## 卖出 / 止盈
- (例) 涨幅 30% 以上止盈一半，剩余按 20 日均线移动止盈
- (例) 业绩低于预期 / 行业逻辑破坏立即清仓

## 不做什么
- (例) 不做 ST，不做总市值 < 50 亿
- (例) 不做停牌即将复牌的题材股
`;

function SkillEditor({
  skillId,
  onSaved,
  onArchived,
}: {
  skillId: number | null;
  onSaved: () => void;
  onArchived: () => void;
}) {
  const isNew = skillId === null;
  const [detail, setDetail] = useState<UserSkillDetail | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [body, setBody] = useState(isNew ? TEMPLATE : "");
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 'lint' / 'extract'
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const refreshUser = useSkillStore((s) => s.refreshUserOptions);
  const setActiveAndPersist = useSkillStore((s) => s.setActiveAndPersist);
  const activeRef = useSkillStore((s) => s.activeRef);

  useEffect(() => {
    api.getSkillCatalog().then(setCatalog).catch(() => setCatalog(null));
  }, []);

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    api
      .getUserSkill(skillId!)
      .then((d) => {
        setDetail(d);
        setName(d.name);
        setIcon(d.icon || "");
        setBody(d.body_markdown || "");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [isNew, skillId]);

  const refreshDetail = useCallback(async () => {
    if (skillId === null) return;
    try {
      const d = await api.getUserSkill(skillId);
      setDetail(d);
    } catch {
      /* ignore */
    }
  }, [skillId]);

  const handleSave = async () => {
    if (!name.trim()) {
      setErr("请填写体系名");
      return;
    }
    if (body.trim().length < 10) {
      setErr("正文太短，至少描述一下选股 / 风控两件事");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      let savedId = skillId;
      if (isNew) {
        const res = await api.createUserSkill({
          name: name.trim(),
          icon: icon.trim() || undefined,
          body_markdown: body,
        });
        savedId = res.id;
      } else {
        await api.updateUserSkill(skillId!, {
          name: name.trim(),
          icon: icon.trim() || undefined,
          body_markdown: body,
        });
      }
      await refreshUser();
      // 后台 lint+extract 是异步的，用户可以等会再回来看；先返回列表
      if (savedId !== null && isNew) {
        // 新建后顺手询问是否激活
        if (confirm("已保存。是否设为当前激活体系？")) {
          await setActiveAndPersist(`user:${savedId}`);
        }
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleForceLint = async () => {
    if (skillId === null) return;
    setBusy("lint");
    try {
      await api.forceLintSkill(skillId);
      await new Promise((r) => setTimeout(r, 800));
      await refreshDetail();
    } catch (e) {
      alert(e instanceof Error ? e.message : "lint 失败");
    } finally {
      setBusy(null);
    }
  };

  const handleForceExtract = async () => {
    if (skillId === null) return;
    if (detail?.rules_user_edited) {
      if (!confirm("检测到你手工校对过执行规则，重抽会覆盖手工版本。确定继续？")) return;
    }
    setBusy("extract");
    try {
      await api.forceExtractSkill(skillId);
      await new Promise((r) => setTimeout(r, 1500));
      await refreshDetail();
    } catch (e) {
      alert(e instanceof Error ? e.message : "重抽失败");
    } finally {
      setBusy(null);
    }
  };

  const handleArchive = async () => {
    if (skillId === null) return;
    if (!confirm("归档这个体系？")) return;
    try {
      await api.archiveUserSkill(skillId);
      await refreshUser();
      // 如果当前激活的是它，自动取消
      if (activeRef === `user:${skillId}`) {
        await setActiveAndPersist(null);
      }
      onArchived();
    } catch (e) {
      alert(e instanceof Error ? e.message : "归档失败");
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
        <Loader2 size={14} className="animate-spin" />
        加载中…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden grid" style={{ gridTemplateColumns: "1fr 360px", gap: 0 }}>
      {/* 左：编辑区 */}
      <div className="flex flex-col h-full overflow-hidden" style={{ borderRight: "1px solid var(--border-color)" }}>
        <div className="p-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border-color)" }}>
          <span style={{ fontSize: 18 }}>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="🧠"
              maxLength={2}
              style={{
                width: 32,
                textAlign: "center",
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: 4,
                padding: "4px",
              }}
            />
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="体系名 — 比如「我的中线趋势体系」"
            style={{
              flex: 1,
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: 4,
              padding: "6px 10px",
              color: "var(--text-primary)",
              fontSize: "var(--font-md)",
              fontWeight: 600,
            }}
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 rounded transition-opacity hover:opacity-90"
            style={{
              background: "var(--accent-purple)",
              color: "#fff",
              fontSize: "var(--font-sm)",
              fontWeight: 600,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "保存中…" : "保存"}
          </button>
          {!isNew && (
            <button
              onClick={handleArchive}
              className="p-2 rounded transition-opacity hover:opacity-70"
              title="归档"
              style={{ color: "var(--text-muted)" }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
          className="flex-1 p-4 outline-none resize-none"
          style={{
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: "var(--font-sm)",
            lineHeight: 1.6,
          }}
          placeholder="自由文本写你的投资体系（markdown）"
        />
        {err && (
          <div
            className="px-4 py-2 text-sm"
            style={{
              background: "rgba(239,68,68,0.1)",
              color: "var(--accent-red)",
              borderTop: "1px solid var(--border-color)",
            }}
          >
            {err}
          </div>
        )}
      </div>

      {/* 右：lint 提示 + 衍生规则 */}
      <div className="flex flex-col h-full overflow-y-auto" style={{ background: "var(--bg-secondary)" }}>
        <div className="p-3" style={{ borderBottom: "1px solid var(--border-color)" }}>
          <div className="flex items-center gap-2 mb-2">
            <PencilLine size={12} style={{ color: "var(--accent-purple)" }} />
            <span className="font-semibold" style={{ fontSize: "var(--font-sm)", color: "var(--text-primary)" }}>
              完整性提示
            </span>
            {!isNew && (
              <button
                onClick={handleForceLint}
                disabled={busy !== null}
                className="ml-auto p-1 rounded transition-opacity hover:opacity-70"
                title="重新检查"
                style={{ color: "var(--text-muted)" }}
              >
                {busy === "lint" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              </button>
            )}
          </div>
          {isNew ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              保存后系统会自动检查你哪些关键点（选股口径 / 仓位 / 止损 / 卖出 / 不做什么）没说清，会出现在这里。
            </p>
          ) : (detail?.completeness_warnings || []).length === 0 ? (
            <p className="text-xs flex items-center gap-1" style={{ color: "var(--accent-blue)" }}>
              <CheckCircle2 size={11} />
              所有关键点都覆盖了
            </p>
          ) : (
            <ul className="space-y-1.5">
              {(detail?.completeness_warnings || []).map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  <AlertCircle size={11} style={{ color: "var(--accent-orange)", flexShrink: 0, marginTop: 2 }} />
                  <span style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    <span style={{ color: "var(--accent-orange)", fontWeight: 600 }}>
                      [{checkLabel(catalog, w.key)}]
                    </span>{" "}
                    {w.msg}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {catalog && (
            <details className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              <summary className="cursor-pointer">查看完整检查清单</summary>
              <ul className="mt-1 space-y-1">
                {catalog.lint_keys.map((k) => (
                  <li key={k.key}>
                    <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{k.label}</span>
                    <span className="ml-1">{k.desc}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="p-3 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={12} style={{ color: "var(--accent-blue)" }} />
            <span className="font-semibold" style={{ fontSize: "var(--font-sm)", color: "var(--text-primary)" }}>
              衍生执行规则
            </span>
            {!isNew && (
              <button
                onClick={handleForceExtract}
                disabled={busy !== null}
                className="ml-auto p-1 rounded transition-opacity hover:opacity-70"
                title="基于正文重抽规则"
                style={{ color: "var(--text-muted)" }}
              >
                {busy === "extract" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              </button>
            )}
          </div>
          {isNew ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              保存后，系统会从正文里抽出可执行规则（行业/估值/技术/排序…），
              用于「体系扫描」选股。规则可手工校对。
            </p>
          ) : !detail?.derived_rules ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              暂未生成（保存后异步处理；或点击右上刷新按钮强制重抽）。
            </p>
          ) : (
            <DerivedRulesView rules={detail.derived_rules} userEdited={detail.rules_user_edited} />
          )}
        </div>
      </div>
    </div>
  );
}

function checkLabel(catalog: SkillCatalog | null, key: string): string {
  if (!catalog) return key;
  return catalog.lint_keys.find((k) => k.key === key)?.label || key;
}

function DerivedRulesView({
  rules,
  userEdited,
}: {
  rules: Record<string, unknown>;
  userEdited: boolean;
}) {
  const sections = useMemo(() => {
    const out: Array<{ title: string; body: unknown }> = [];
    for (const k of [
      "universe",
      "filters",
      "scorers",
      "limits",
      "unsupported_mentions",
      "rationale",
    ]) {
      if (rules[k] !== undefined) out.push({ title: k, body: rules[k] });
    }
    return out;
  }, [rules]);

  return (
    <div>
      {userEdited && (
        <div
          className="text-xs mb-2 px-2 py-1 rounded"
          style={{
            background: "rgba(168,85,247,0.1)",
            color: "var(--accent-purple)",
          }}
        >
          ✓ 已手工校对（重抽会覆盖）
        </div>
      )}
      {sections.map((s) => (
        <div key={s.title} className="mb-3">
          <div
            className="text-xs font-semibold mb-1"
            style={{ color: "var(--text-secondary)", letterSpacing: 0.5 }}
          >
            {s.title.toUpperCase()}
          </div>
          <pre
            className="text-xs p-2 rounded overflow-x-auto"
            style={{
              background: "var(--bg-card)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-color)",
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            {JSON.stringify(s.body, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}
