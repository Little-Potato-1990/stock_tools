"use client";

import { create } from "zustand";
import { api, type SkillOption } from "@/lib/api";

/**
 * 全局激活体系 (Skill) state.
 *
 * - activeRef: 'system:xxx' / 'user:42' / null=中立
 * - source: 当前来源 (system / user / null)
 * - 数据从 /api/skills/active + /api/skills/options 加载，登录后初始化一次
 * - 切换时同步到后端 (写 UserSettings.active_skill_ref)
 *
 * 使用：
 *   const ref = useSkillStore(s => s.activeRef);
 *   await api.streamChat(..., ref);
 */
interface SkillState {
  activeRef: string | null;
  activeName: string | null;
  systemOptions: SkillOption[];
  userOptions: SkillOption[];
  loading: boolean;
  loaded: boolean;

  loadOptions: () => Promise<void>;
  setActiveAndPersist: (ref: string | null) => Promise<void>;
  refreshUserOptions: () => Promise<void>;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  activeRef: null,
  activeName: null,
  systemOptions: [],
  userOptions: [],
  loading: false,
  loaded: false,

  loadOptions: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      if (!api.isLoggedIn()) {
        set({ loading: false, loaded: true });
        return;
      }
      const [opts, active] = await Promise.all([
        api.getSkillOptions().catch(() => ({ system: [], user: [] })),
        api.getActiveSkill().catch(() => ({ ref: null, name: null })),
      ]);
      set({
        systemOptions: opts.system || [],
        userOptions: opts.user || [],
        activeRef: active.ref,
        activeName: active.name,
        loading: false,
        loaded: true,
      });
    } catch {
      set({ loading: false, loaded: true });
    }
  },

  setActiveAndPersist: async (ref) => {
    const previousRef = get().activeRef;
    const previousName = get().activeName;
    let nextName: string | null = null;
    if (ref) {
      const { systemOptions, userOptions } = get();
      const found =
        systemOptions.find((o) => o.ref === ref) || userOptions.find((o) => o.ref === ref);
      nextName = found?.name || ref;
    }
    set({ activeRef: ref, activeName: nextName });
    try {
      await api.setActiveSkill(ref);
    } catch (e) {
      // rollback
      set({ activeRef: previousRef, activeName: previousName });
      throw e;
    }
  },

  refreshUserOptions: async () => {
    if (!api.isLoggedIn()) return;
    try {
      const opts = await api.getSkillOptions();
      set({ systemOptions: opts.system || [], userOptions: opts.user || [] });
    } catch {
      /* ignore */
    }
  },
}));
