/**
 * `prefers-reduced-motion` 的**唯一**裁决点。
 *
 * 所有特效都问这里，不各自 matchMedia：一是行为一致（要么全静要么全动），
 * 二是系统开关中途改变时能一处广播、所有特效同时收到。
 */

const QUERY = "(prefers-reduced-motion: reduce)";

let mediaQuery: MediaQueryList | null = null;
const listeners = new Set<(reduced: boolean) => void>();

function query(): MediaQueryList | null {
  if (mediaQuery) return mediaQuery;
  if (typeof globalThis.matchMedia !== "function") return null;
  mediaQuery = globalThis.matchMedia(QUERY);
  mediaQuery.addEventListener("change", () => {
    const reduced = prefersReducedMotion();
    document.documentElement.classList.toggle("reduced-motion", reduced);
    for (const listener of listeners) listener(reduced);
  });
  return mediaQuery;
}

export function prefersReducedMotion(): boolean {
  return query()?.matches ?? false;
}

export function onMotionPreferenceChange(listener: (reduced: boolean) => void): () => void {
  query();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 把当前偏好写到 `<html>` 上，CSS 侧靠 `.reduced-motion` 做兜底（媒体查询之外的显式钩子）。 */
export function installMotionClass(): void {
  document.documentElement.classList.toggle("reduced-motion", prefersReducedMotion());
}

/**
 * 减少动画时把时长压到 0（但**不改变时序语义**）—— 演出该 await 多久还是多久由调用方定，
 * 这个只用于纯装饰性的过渡时长。
 */
export function motionDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, Math.max(0, ms));
  });
}
