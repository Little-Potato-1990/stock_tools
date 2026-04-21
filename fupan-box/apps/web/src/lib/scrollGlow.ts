/**
 * 通用 scrollIntoView + 紫色 glow 闪烁工具.
 * 用于 dial 点击后定位到证据/区块的视觉反馈.
 */

export interface FlashGlowOptions {
  /** glow 持续时间, ms. 默认 1800. */
  durationMs?: number;
  /** glow 主色 (实体描边色). 默认紫色 rgba(168,85,247,0.55). */
  ringColor?: string;
  /** glow 散光色 (大半径模糊). 默认 rgba(168,85,247,0.35). */
  haloColor?: string;
  /** scrollIntoView 的 block 行为. 默认 "start". */
  block?: ScrollLogicalPosition;
}

/**
 * 滚动到指定 id 的元素并闪烁 glow.
 * 找不到元素时静默返回.
 */
export function flashGlow(id: string, opts: FlashGlowOptions = {}): void {
  const el = document.getElementById(id);
  if (!el) return;
  const {
    durationMs = 1800,
    ringColor = "rgba(168,85,247,0.55)",
    haloColor = "rgba(168,85,247,0.35)",
    block = "start",
  } = opts;
  el.scrollIntoView({ behavior: "smooth", block });
  const prevBox = el.style.boxShadow;
  const prevTrans = el.style.transition;
  el.style.transition = "box-shadow 200ms ease";
  el.style.boxShadow = `0 0 0 3px ${ringColor}, 0 0 32px 4px ${haloColor}`;
  setTimeout(() => {
    el.style.boxShadow = prevBox;
    setTimeout(() => {
      el.style.transition = prevTrans;
    }, 250);
  }, durationMs);
}
