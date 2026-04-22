"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  Trash2,
  LogIn,
  Zap,
  CheckCircle,
  AlertCircle,
  Pencil,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  api,
  type UserPlanRecord,
  type PlanTriggerRecord,
  type PlanCondition,
  type PlanDirection,
  type PlanConditionType,
  type PlanStatus,
} from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { useUIStore } from "@/stores/ui-store";

const DIRECTION_LABEL: Record<PlanDirection, string> = {
  buy: "买入",
  sell: "卖出",
  add: "加仓",
  reduce: "减仓",
};

const STATUS_LABEL: Record<PlanStatus, string> = {
  active: "监控中",
  triggered: "已触发",
  executed: "已执行",
  expired: "已失效",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<PlanStatus, string> = {
  active: "var(--accent-purple)",
  triggered: "var(--accent-orange)",
  executed: "var(--accent-green)",
  expired: "var(--text-muted)",
  cancelled: "var(--text-muted)",
};

interface ConditionTypeOption {
  type: PlanConditionType;
  label: string;
  needValue: boolean;
  unit?: string;
  hint?: string;
}

const CONDITION_TYPES: ConditionTypeOption[] = [
  { type: "price_above", label: "价格上穿", needValue: true, unit: "元" },
  { type: "price_below", label: "价格跌破", needValue: true, unit: "元" },
  { type: "change_pct_above", label: "涨幅 ≥", needValue: true, unit: "%" },
  { type: "change_pct_below", label: "跌幅 ≤", needValue: true, unit: "%", hint: "填负数, 如 -5" },
  { type: "limit_up", label: "冲到涨停", needValue: false },
  { type: "limit_up_break", label: "涨停打开", needValue: false },
];

const FILTER_TABS: Array<{ key: "all" | PlanStatus; label: string }> = [
  { key: "all", label: "全部" },
  { key: "triggered", label: "已触发" },
  { key: "active", label: "监控中" },
  { key: "executed", label: "已执行" },
  { key: "expired", label: "历史" },
];

interface FormState {
  id?: number;
  code: string;
  name: string;
  direction: PlanDirection;
  trigger_conditions: PlanCondition[];
  invalid_conditions: PlanCondition[];
  stop_loss_pct: string;
  take_profit_pct: string;
  notes: string;
}

function emptyForm(): FormState {
  return {
    code: "",
    name: "",
    direction: "buy",
    trigger_conditions: [{ type: "price_above", value: undefined, label: "" }],
    invalid_conditions: [],
    stop_loss_pct: "",
    take_profit_pct: "",
    notes: "",
  };
}

function planToForm(p: UserPlanRecord): FormState {
  return {
    id: p.id,
    code: p.code,
    name: p.name ?? "",
    direction: p.direction,
    trigger_conditions: p.trigger_conditions ?? [],
    invalid_conditions: p.invalid_conditions ?? [],
    stop_loss_pct: p.stop_loss_pct != null ? String(p.stop_loss_pct) : "",
    take_profit_pct: p.take_profit_pct != null ? String(p.take_profit_pct) : "",
    notes: p.notes ?? "",
  };
}

function describeCondition(c: PlanCondition): string {
  const meta = CONDITION_TYPES.find((t) => t.type === c.type);
  if (!meta) return c.label || c.type;
  if (!meta.needValue) return meta.label;
  const unit = meta.unit ?? "";
  const v = c.value != null ? c.value : "?";
  return `${meta.label} ${v}${unit}`;
}

export function PlansPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [plans, setPlans] = useState<UserPlanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | PlanStatus>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [triggersById, setTriggersById] = useState<Record<number, PlanTriggerRecord[]>>({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const consumePendingPlan = useUIStore((s) => s.consumePendingPlan);
  const pendingPlan = useUIStore((s) => s.pendingPlanForCode);

  useEffect(() => {
    api.restoreToken();
    setLoggedIn(api.isLoggedIn());
  }, []);

  // P1 #6: 从自选/异动/Drawer 跳过来时, 自动打开新建 form 并预填
  useEffect(() => {
    if (!loggedIn || !pendingPlan) return;
    const seed = consumePendingPlan();
    if (!seed) return;
    const f = emptyForm();
    f.code = seed.code;
    f.name = seed.name ?? "";
    setForm(f);
    setShowForm(true);
  }, [loggedIn, pendingPlan, consumePendingPlan]);

  const fetchList = useCallback(async () => {
    if (!api.isLoggedIn()) return;
    setLoading(true);
    try {
      const data = await api.listPlans();
      setPlans(data);
      setError("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "加载失败";
      if (msg.includes("401") || msg.includes("Not authenticated")) {
        api.logout();
        setLoggedIn(false);
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) fetchList();
  }, [loggedIn, fetchList]);

  const filtered = useMemo(() => {
    if (filter === "all") return plans;
    if (filter === "expired")
      return plans.filter((p) => p.status === "expired" || p.status === "cancelled");
    return plans.filter((p) => p.status === filter);
  }, [plans, filter]);

  const counters = useMemo(() => {
    return {
      total: plans.length,
      triggered: plans.filter((p) => p.status === "triggered").length,
      active: plans.filter((p) => p.status === "active").length,
    };
  }, [plans]);

  const openCreate = () => {
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (p: UserPlanRecord) => {
    setForm(planToForm(p));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(emptyForm());
  };

  const handleSubmit = async () => {
    if (!form.code.trim()) {
      setError("请填写股票代码");
      return;
    }
    if (form.trigger_conditions.length === 0) {
      setError("至少添加一个触发条件");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim() || undefined,
        direction: form.direction,
        trigger_conditions: form.trigger_conditions.map((c) => ({
          type: c.type,
          value: c.value != null && c.value !== ("" as unknown) ? Number(c.value) : null,
          label: c.label || null,
        })),
        invalid_conditions: form.invalid_conditions.map((c) => ({
          type: c.type,
          value: c.value != null && c.value !== ("" as unknown) ? Number(c.value) : null,
          label: c.label || null,
        })),
        stop_loss_pct: form.stop_loss_pct ? Number(form.stop_loss_pct) : null,
        take_profit_pct: form.take_profit_pct ? Number(form.take_profit_pct) : null,
        notes: form.notes || null,
      };
      if (form.id) {
        await api.updatePlan(form.id, payload);
      } else {
        await api.createPlan(payload);
      }
      closeForm();
      await fetchList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("删除这条计划?")) return;
    try {
      await api.deletePlan(id);
      await fetchList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleStatus = async (p: UserPlanRecord, next: PlanStatus) => {
    try {
      await api.updatePlan(p.id, { status: next });
      await fetchList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "更新失败");
    }
  };

  const handleExpand = async (p: UserPlanRecord) => {
    if (expandedId === p.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(p.id);
    if (!triggersById[p.id]) {
      try {
        const detail = await api.getPlanDetail(p.id);
        setTriggersById((prev) => ({ ...prev, [p.id]: detail.triggers }));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "加载触发历史失败");
      }
    }
  };

  const handleManualScan = async () => {
    setRefreshing(true);
    try {
      await api.triggerPlanCheckNow();
      await fetchList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "扫描失败");
    } finally {
      setRefreshing(false);
    }
  };

  if (!loggedIn) {
    return (
      <div>
        <PageHeader title="我的计划" subtitle="登录后开始写计划" />
        <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
          <div
            className="w-full max-w-sm p-6 rounded-xl text-center"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              color: "var(--text-secondary)",
              fontSize: "var(--font-md)",
            }}
          >
            <Zap size={28} style={{ color: "var(--accent-purple)" }} className="mx-auto mb-3" />
            <p className="mb-3">写下你的操作计划, AI 盘中替你盯条件</p>
            <p style={{ color: "var(--text-muted)", fontSize: "var(--font-xs)" }}>
              先到「我的自选」登录, 之后回到这里创建计划
            </p>
            <p
              className="mt-4 inline-flex items-center gap-1.5"
              style={{ color: "var(--text-muted)", fontSize: "var(--font-xs)" }}
            >
              <LogIn size={12} /> 自选页面 → 顶部右侧登录
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="我的计划"
        subtitle={`共 ${counters.total} 条 · 监控中 ${counters.active} · 已触发 ${counters.triggered}`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleManualScan}
              disabled={refreshing}
              className="rounded inline-flex items-center gap-1"
              title="立即检查一次触发"
              style={{
                padding: "4px 10px",
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                fontSize: "var(--font-sm)",
                border: "1px solid var(--border-color)",
                opacity: refreshing ? 0.6 : 1,
              }}
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              立即扫描
            </button>
            <button
              onClick={openCreate}
              className="rounded inline-flex items-center gap-1 font-bold"
              style={{
                padding: "4px 10px",
                background: "var(--accent-purple)",
                color: "#fff",
                fontSize: "var(--font-sm)",
              }}
            >
              <Plus size={12} />
              新建计划
            </button>
          </div>
        }
      />

      <div
        className="px-4 pt-3 pb-2 flex gap-1 flex-wrap"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        {FILTER_TABS.map((t) => {
          const active = filter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className="rounded font-semibold transition-colors"
              style={{
                padding: "3px 10px",
                background: active ? "var(--accent-orange)" : "var(--bg-tertiary)",
                color: active ? "#1a1d28" : "var(--text-secondary)",
                fontSize: "var(--font-sm)",
                border: "1px solid var(--border-color)",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="px-4 pt-2 text-xs" style={{ color: "var(--accent-red)" }}>
          {error}
        </p>
      )}

      <div className="p-4 space-y-2">
        {filtered.length === 0 && !loading ? (
          <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
            {plans.length === 0 ? "还没有计划, 点 「新建计划」 开始" : "该状态下暂无计划"}
          </div>
        ) : (
          filtered.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              expanded={expandedId === p.id}
              triggers={triggersById[p.id] || []}
              onExpand={() => handleExpand(p)}
              onEdit={() => openEdit(p)}
              onDelete={() => handleDelete(p.id)}
              onStatus={(s) => handleStatus(p, s)}
            />
          ))
        )}
      </div>

      {showForm && (
        <PlanFormModal
          form={form}
          submitting={submitting}
          onChange={setForm}
          onClose={closeForm}
          onSubmit={handleSubmit}
        />
      )}

      {loading && (
        <div
          className="fixed bottom-4 right-4 px-3 py-1.5 rounded text-xs"
          style={{ background: "var(--bg-card)", color: "var(--text-muted)" }}
        >
          加载中...
        </div>
      )}
    </div>
  );
}

interface PlanCardProps {
  plan: UserPlanRecord;
  expanded: boolean;
  triggers: PlanTriggerRecord[];
  onExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStatus: (s: PlanStatus) => void;
}

function PlanCard({
  plan,
  expanded,
  triggers,
  onExpand,
  onEdit,
  onDelete,
  onStatus,
}: PlanCardProps) {
  const isTriggered = plan.status === "triggered";
  const isFinal =
    plan.status === "executed" || plan.status === "expired" || plan.status === "cancelled";

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: isTriggered
          ? "1px solid var(--accent-orange)"
          : "1px solid var(--border-color)",
        background: "var(--bg-card)",
        boxShadow: isTriggered ? "0 0 14px rgba(247, 147, 26, 0.18)" : undefined,
        opacity: isFinal ? 0.78 : 1,
      }}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-bold"
            style={{ color: "var(--accent-orange)", fontSize: "var(--font-md)" }}
          >
            {plan.code}
          </span>
          <span style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}>
            {plan.name || "—"}
          </span>
          <span
            className="font-semibold rounded"
            style={{
              padding: "1px 6px",
              background:
                plan.direction === "buy" || plan.direction === "add"
                  ? "rgba(255,80,80,0.15)"
                  : "rgba(80,160,255,0.15)",
              color:
                plan.direction === "buy" || plan.direction === "add"
                  ? "var(--accent-red)"
                  : "#5fa8ff",
              fontSize: "var(--font-xs)",
            }}
          >
            {DIRECTION_LABEL[plan.direction]}
          </span>
          <span
            className="font-semibold rounded"
            style={{
              padding: "1px 6px",
              background: "var(--bg-tertiary)",
              color: STATUS_COLOR[plan.status],
              fontSize: "var(--font-xs)",
              border: `1px solid ${STATUS_COLOR[plan.status]}`,
            }}
          >
            {STATUS_LABEL[plan.status]}
          </span>
          {plan.triggered_today_count > 0 && (
            <span
              className="font-bold rounded inline-flex items-center gap-1"
              style={{
                padding: "1px 6px",
                background: "var(--accent-orange)",
                color: "#1a1d28",
                fontSize: "var(--font-xs)",
              }}
              title="今日触发次数"
            >
              <Zap size={10} />今日 {plan.triggered_today_count}
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={onExpand}
            className="p-1 rounded transition-opacity hover:opacity-70"
            title="展开历史"
            style={{ color: "var(--text-muted)" }}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            onClick={onEdit}
            className="p-1 rounded transition-opacity hover:opacity-70"
            title="编辑"
            style={{ color: "var(--text-secondary)" }}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded transition-opacity hover:opacity-70"
            title="删除"
            style={{ color: "var(--accent-red)" }}
          >
            <Trash2 size={13} />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {(plan.trigger_conditions ?? []).map((c, idx) => (
            <span
              key={`t-${idx}`}
              className="rounded inline-flex items-center gap-1"
              style={{
                padding: "2px 7px",
                fontSize: "var(--font-xs)",
                background: "rgba(139,92,246,0.12)",
                color: "var(--accent-purple)",
                border: "1px solid rgba(139,92,246,0.32)",
              }}
              title={c.label || undefined}
            >
              <Zap size={10} />
              {describeCondition(c)}
              {c.label ? ` · ${c.label}` : ""}
            </span>
          ))}
          {(plan.invalid_conditions ?? []).map((c, idx) => (
            <span
              key={`x-${idx}`}
              className="rounded inline-flex items-center gap-1"
              style={{
                padding: "2px 7px",
                fontSize: "var(--font-xs)",
                background: "rgba(255,99,99,0.12)",
                color: "var(--accent-red)",
                border: "1px solid rgba(255,99,99,0.32)",
              }}
              title={c.label || undefined}
            >
              <AlertCircle size={10} />
              失效: {describeCondition(c)}
            </span>
          ))}
        </div>

        {(plan.stop_loss_pct != null ||
          plan.take_profit_pct != null ||
          plan.notes) && (
          <div
            className="mt-2 flex flex-wrap gap-3"
            style={{ color: "var(--text-muted)", fontSize: "var(--font-xs)" }}
          >
            {plan.stop_loss_pct != null && (
              <span>止损 {plan.stop_loss_pct}%</span>
            )}
            {plan.take_profit_pct != null && (
              <span>止盈 {plan.take_profit_pct}%</span>
            )}
            {plan.notes && <span className="italic">备注: {plan.notes}</span>}
          </div>
        )}

        {isTriggered && (
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => onStatus("executed")}
              className="rounded font-semibold inline-flex items-center gap-1"
              style={{
                padding: "3px 8px",
                background: "var(--accent-green)",
                color: "#fff",
                fontSize: "var(--font-xs)",
              }}
            >
              <CheckCircle size={11} />
              已下单
            </button>
            <button
              onClick={() => onStatus("active")}
              className="rounded inline-flex items-center gap-1"
              style={{
                padding: "3px 8px",
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                fontSize: "var(--font-xs)",
                border: "1px solid var(--border-color)",
              }}
            >
              重置监控
            </button>
            <button
              onClick={() => onStatus("cancelled")}
              className="rounded inline-flex items-center gap-1"
              style={{
                padding: "3px 8px",
                background: "var(--bg-tertiary)",
                color: "var(--text-muted)",
                fontSize: "var(--font-xs)",
                border: "1px solid var(--border-color)",
              }}
            >
              放弃
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div
          className="px-3 py-2"
          style={{
            background: "var(--bg-tertiary)",
            borderTop: "1px solid var(--border-color)",
            fontSize: "var(--font-xs)",
          }}
        >
          <div className="font-bold mb-1" style={{ color: "var(--text-secondary)" }}>
            触发历史
          </div>
          {triggers.length === 0 ? (
            <div style={{ color: "var(--text-muted)" }}>暂无触发记录</div>
          ) : (
            <ul className="space-y-1">
              {triggers.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span
                    className="font-semibold rounded"
                    style={{
                      padding: "0 5px",
                      background:
                        t.condition_kind === "invalid"
                          ? "rgba(255,99,99,0.16)"
                          : "rgba(139,92,246,0.16)",
                      color:
                        t.condition_kind === "invalid"
                          ? "var(--accent-red)"
                          : "var(--accent-purple)",
                      fontSize: 10,
                    }}
                  >
                    {t.condition_kind === "invalid" ? "失效" : "触发"}
                  </span>
                  <span>{t.condition_label || t.condition_type}</span>
                  <span style={{ color: "var(--text-muted)" }}>
                    @{t.price ?? "-"} ({t.change_pct != null ? `${t.change_pct.toFixed(2)}%` : "-"})
                  </span>
                  <span className="ml-auto" style={{ color: "var(--text-muted)" }}>
                    {new Date(t.triggered_at).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface PlanFormModalProps {
  form: FormState;
  submitting: boolean;
  onChange: (f: FormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}

function PlanFormModal({ form, submitting, onChange, onClose, onSubmit }: PlanFormModalProps) {
  const updateCond = (
    key: "trigger_conditions" | "invalid_conditions",
    idx: number,
    patch: Partial<PlanCondition>,
  ) => {
    const arr = form[key].map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange({ ...form, [key]: arr });
  };

  const addCond = (key: "trigger_conditions" | "invalid_conditions") => {
    onChange({
      ...form,
      [key]: [...form[key], { type: "price_above", value: undefined, label: "" }],
    });
  };

  const rmCond = (key: "trigger_conditions" | "invalid_conditions", idx: number) => {
    onChange({ ...form, [key]: form[key].filter((_, i) => i !== idx) });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          width: "min(560px, 92vw)",
          maxHeight: "88vh",
        }}
      >
        <div
          className="flex items-center justify-between px-4 flex-shrink-0"
          style={{ height: 44, borderBottom: "1px solid var(--border-color)" }}
        >
          <span className="font-bold" style={{ fontSize: "var(--font-lg)" }}>
            {form.id ? "编辑计划" : "新建计划"}
          </span>
          <button onClick={onClose} className="p-1 hover:opacity-70">
            <X size={16} style={{ color: "var(--text-secondary)" }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <FormField label="股票代码 *">
              <input
                value={form.code}
                onChange={(e) =>
                  onChange({ ...form, code: e.target.value.replace(/\D/g, "").slice(0, 6) })
                }
                placeholder="如 600519"
                className="w-full px-3 py-2 rounded text-sm outline-none"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-color)",
                }}
              />
            </FormField>
            <FormField label="名称 (可选)">
              <input
                value={form.name}
                onChange={(e) => onChange({ ...form, name: e.target.value })}
                placeholder="贵州茅台"
                className="w-full px-3 py-2 rounded text-sm outline-none"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-color)",
                }}
              />
            </FormField>
          </div>

          <FormField label="操作方向">
            <div className="flex gap-1">
              {(Object.keys(DIRECTION_LABEL) as PlanDirection[]).map((d) => (
                <button
                  key={d}
                  onClick={() => onChange({ ...form, direction: d })}
                  className="rounded font-semibold"
                  style={{
                    padding: "5px 10px",
                    background:
                      form.direction === d ? "var(--accent-orange)" : "var(--bg-tertiary)",
                    color: form.direction === d ? "#1a1d28" : "var(--text-secondary)",
                    fontSize: "var(--font-sm)",
                    border: "1px solid var(--border-color)",
                  }}
                >
                  {DIRECTION_LABEL[d]}
                </button>
              ))}
            </div>
          </FormField>

          <ConditionGroup
            title="触发条件 (任一命中即触发)"
            tagColor="var(--accent-purple)"
            conditions={form.trigger_conditions}
            onUpdate={(idx, patch) => updateCond("trigger_conditions", idx, patch)}
            onRemove={(idx) => rmCond("trigger_conditions", idx)}
            onAdd={() => addCond("trigger_conditions")}
          />
          <ConditionGroup
            title="失效条件 (任一命中即放弃)"
            tagColor="var(--accent-red)"
            conditions={form.invalid_conditions}
            onUpdate={(idx, patch) => updateCond("invalid_conditions", idx, patch)}
            onRemove={(idx) => rmCond("invalid_conditions", idx)}
            onAdd={() => addCond("invalid_conditions")}
          />

          <div className="grid grid-cols-2 gap-2">
            <FormField label="止损 % (可选)">
              <input
                value={form.stop_loss_pct}
                onChange={(e) => onChange({ ...form, stop_loss_pct: e.target.value })}
                placeholder="-7"
                className="w-full px-3 py-2 rounded text-sm outline-none"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-color)",
                }}
              />
            </FormField>
            <FormField label="止盈 % (可选)">
              <input
                value={form.take_profit_pct}
                onChange={(e) => onChange({ ...form, take_profit_pct: e.target.value })}
                placeholder="15"
                className="w-full px-3 py-2 rounded text-sm outline-none"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-color)",
                }}
              />
            </FormField>
          </div>

          <FormField label="备注 (你写计划的逻辑)">
            <textarea
              value={form.notes}
              onChange={(e) => onChange({ ...form, notes: e.target.value })}
              placeholder="为什么打算这么做? 触发后想看什么?"
              rows={3}
              className="w-full px-3 py-2 rounded text-sm outline-none resize-none"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-color)",
              }}
            />
          </FormField>
        </div>

        <div
          className="flex items-center justify-end gap-2 px-4 py-2 flex-shrink-0"
          style={{ borderTop: "1px solid var(--border-color)" }}
        >
          <button
            onClick={onClose}
            className="rounded"
            style={{
              padding: "6px 14px",
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              fontSize: "var(--font-sm)",
              border: "1px solid var(--border-color)",
            }}
          >
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="rounded font-bold"
            style={{
              padding: "6px 14px",
              background: "var(--accent-purple)",
              color: "#fff",
              fontSize: "var(--font-sm)",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "保存中..." : form.id ? "保存修改" : "创建计划"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConditionGroupProps {
  title: string;
  tagColor: string;
  conditions: PlanCondition[];
  onUpdate: (idx: number, patch: Partial<PlanCondition>) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
}

function ConditionGroup({
  title,
  tagColor,
  conditions,
  onUpdate,
  onRemove,
  onAdd,
}: ConditionGroupProps) {
  return (
    <div>
      <div
        className="flex items-center justify-between mb-1"
        style={{ color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}
      >
        <span className="font-semibold">{title}</span>
        <button
          onClick={onAdd}
          className="rounded inline-flex items-center gap-1"
          style={{
            padding: "2px 8px",
            background: "var(--bg-tertiary)",
            color: tagColor,
            fontSize: "var(--font-xs)",
            border: `1px solid ${tagColor}`,
          }}
        >
          <Plus size={10} />添加
        </button>
      </div>
      {conditions.length === 0 ? (
        <div
          className="px-2 py-2 rounded text-center"
          style={{
            background: "var(--bg-tertiary)",
            color: "var(--text-muted)",
            fontSize: "var(--font-xs)",
            border: "1px dashed var(--border-color)",
          }}
        >
          (空)
        </div>
      ) : (
        <div className="space-y-1.5">
          {conditions.map((c, idx) => {
            const meta = CONDITION_TYPES.find((t) => t.type === c.type);
            return (
              <div
                key={idx}
                className="flex items-center gap-1.5"
                style={{ fontSize: "var(--font-sm)" }}
              >
                <select
                  value={c.type}
                  onChange={(e) =>
                    onUpdate(idx, { type: e.target.value as PlanConditionType })
                  }
                  className="px-2 py-1.5 rounded outline-none"
                  style={{
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-color)",
                    minWidth: 110,
                  }}
                >
                  {CONDITION_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {meta?.needValue && (
                  <input
                    type="number"
                    step="0.01"
                    value={c.value ?? ""}
                    onChange={(e) =>
                      onUpdate(idx, {
                        value: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                    placeholder={meta.hint || meta.unit}
                    className="px-2 py-1.5 rounded outline-none"
                    style={{
                      background: "var(--bg-tertiary)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-color)",
                      width: 100,
                    }}
                  />
                )}
                <input
                  value={c.label ?? ""}
                  onChange={(e) => onUpdate(idx, { label: e.target.value })}
                  placeholder="备注 (可选)"
                  className="flex-1 px-2 py-1.5 rounded outline-none"
                  style={{
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-color)",
                  }}
                />
                <button
                  onClick={() => onRemove(idx)}
                  className="p-1.5 rounded hover:opacity-70"
                  style={{ color: "var(--accent-red)" }}
                  title="删除"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div
        className="mb-1"
        style={{ color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}
      >
        {label}
      </div>
      {children}
    </label>
  );
}
