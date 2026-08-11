/**
 * 数值飘字。
 *
 * 锚在状态栏元素上（`data-anchor` 属性），从元素外侧浮起淡出。三条几何纪律是踩过坑的：
 * 1. **不压住控件本身** —— 飘字落在锚元素的外侧（上方或下方），不叠在血条/精气柱上；
 * 2. **顶栏锚点往下飘** —— 状态栏贴着视口上沿，往上飘会被裁掉一半；
 * 3. **同批逐条错开一行** —— 精气柱只有 12px 宽而「足 +12」有 46px，不错开必然横向重叠糊成一团。
 */

import type { FloaterSpec } from "../model/deltaVm.js";
import { prefersReducedMotion } from "./motion.js";
import { ESSENCE_RGB } from "./particles.js";

const LIFETIME_MS = 1500;
const STAGGER_MS = 60;
/** 锚元素上沿高于此值（px）时改为向下飘，免得飘出视口。 */
const TOP_ZONE = 140;
/** 同时在场的飘字上限 —— 连点时不让它们堆成一面墙。 */
const MAX_LIVE = 8;
/** 每条之间的垂直间距（px）。 */
const ROW = 19;

/** 飘字容器：全屏、pointer-events:none，挂在 app 根下。 */
export function createFloaterHost(parent: HTMLElement): HTMLElement {
  const host = document.createElement("div");
  host.className = "fx-floaters";
  host.setAttribute("aria-hidden", "true");
  parent.append(host);
  return host;
}

/**
 * 按 spec 列表放飘字。
 *
 * `resolveAnchor` 把 `stat:meng` 这类锚点键翻成实际元素；找不到锚点就整条跳过
 * （宁可少一条飘字，也不要在屏幕左上角 0,0 处冒出一个孤字）。
 *
 * 减少动画时：仍然显示，但不位移、不错开，停留后直接淡出 —— 数值变化是**信息**，
 * 不能因为关了动画就丢掉。
 */
export function spawnFloaters(
  host: HTMLElement,
  specs: readonly FloaterSpec[],
  resolveAnchor: (anchor: string) => HTMLElement | null,
): void {
  const reduced = prefersReducedMotion();
  const hostRect = host.getBoundingClientRect();
  let index = 0;
  for (const spec of specs) {
    const anchor = resolveAnchor(spec.anchor);
    if (!anchor) continue;
    const rect = anchor.getBoundingClientRect();
    const downward = rect.top < TOP_ZONE;

    const node = document.createElement("span");
    node.className = `floater floater--${spec.tone}`;
    node.textContent = spec.text;
    if (spec.essence) node.style.setProperty("--floater-rgb", ESSENCE_RGB[spec.essence]);

    node.style.left = `${rect.left - hostRect.left + rect.width / 2}px`;
    // 锚元素外侧 6px 起步，再按本批序号逐条让开一行
    const offset = index * ROW;
    node.style.top = downward
      ? `${rect.bottom - hostRect.top + 6 + offset}px`
      : `${rect.top - hostRect.top - 22 - offset}px`;

    const delay = reduced ? 0 : index * STAGGER_MS;
    node.style.animationDelay = `${delay}ms`;
    if (!reduced) {
      const travel = 22 + index * 4;
      node.style.setProperty("--floater-lift", `${downward ? travel : -travel}px`);
    }

    host.append(node);
    globalThis.setTimeout(() => node.remove(), LIFETIME_MS + delay + 200);
    index += 1;
  }

  // 溢出的旧飘字立刻清掉（DOM 顺序即时间顺序，前面的最旧）
  while (host.childElementCount > MAX_LIVE) host.firstElementChild?.remove();
}
