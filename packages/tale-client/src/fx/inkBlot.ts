/**
 * 死亡满屏墨渍。
 *
 * 七滴墨自不同方位晕开、彼此吞并，最后一层整幅罩死 —— 之后死亡演出（cinematic）
 * 在墨底之上淡入，避免「画面咔地一黑」。
 *
 * 减少动画时：直接给一层不透明墨底，不做晕开（信息不丢，只是不动）。
 */

import { el } from "../dom.js";
import { prefersReducedMotion, sleep } from "./motion.js";

interface BlotSpec {
  x: number;
  y: number;
  size: number;
  delay: number;
  radius: string;
}

/**
 * 位置与大小刻意不均匀：均匀分布会读成「转场特效」，不均匀才像墨。
 *
 * 尺寸拉开到 14〜52vmax 是踩过的坑 —— 早先七滴都是 28〜46vmax，晕开后并成一朵
 * 对称的「四叶草」，像卡通云而不像墨。真正让它像墨的是**大小悬殊 ＋ 足量模糊**
 * （见 CSS 里 `.ink-blot__drop` 的 blur），不是 border-radius 那点不规则。
 */
const BLOTS: BlotSpec[] = [
  { x: 46, y: 52, size: 52, delay: 0, radius: "48% 52% 41% 59% / 55% 44% 56% 45%" },
  { x: 22, y: 34, size: 25, delay: 80, radius: "62% 38% 55% 45% / 40% 62% 38% 60%" },
  { x: 74, y: 28, size: 38, delay: 140, radius: "38% 62% 47% 53% / 60% 40% 60% 40%" },
  { x: 66, y: 76, size: 30, delay: 200, radius: "55% 45% 62% 38% / 43% 57% 43% 57%" },
  { x: 15, y: 80, size: 44, delay: 260, radius: "45% 55% 38% 62% / 62% 41% 59% 38%" },
  { x: 90, y: 60, size: 22, delay: 320, radius: "52% 48% 58% 42% / 46% 55% 45% 54%" },
  { x: 6, y: 14, size: 33, delay: 380, radius: "40% 60% 52% 48% / 58% 42% 58% 42%" },
  { x: 38, y: 8, size: 16, delay: 430, radius: "58% 42% 44% 56% / 48% 60% 40% 52%" },
  { x: 82, y: 92, size: 19, delay: 470, radius: "44% 56% 60% 40% / 55% 42% 58% 45%" },
  { x: 54, y: 30, size: 14, delay: 510, radius: "50% 50% 42% 58% / 60% 45% 55% 40%" },
];

export interface InkBlotHandle {
  el: HTMLElement;
  remove(): void;
}

/**
 * 铺墨。resolve 时屏幕已被墨完全盖住，调用方可以安全地换屏。
 * 返回句柄由调用方在新内容淡入后拆掉。
 */
export async function playInkBlot(host: HTMLElement): Promise<InkBlotHandle> {
  const reduced = prefersReducedMotion();
  const overlay = el("div", { class: "ink-blot", attrs: { "aria-hidden": "true" } });
  if (!reduced) {
    for (const blot of BLOTS) {
      overlay.append(
        el("span", {
          class: "ink-blot__drop",
          style: `left:${blot.x}%;top:${blot.y}%;--blot-size:${blot.size}vmax;--blot-delay:${blot.delay}ms;border-radius:${blot.radius}`,
        }),
      );
    }
  }
  overlay.append(el("span", { class: "ink-blot__wash" }));
  host.append(overlay);
  await sleep(reduced ? 0 : 1150);
  overlay.classList.add("is-full");
  await sleep(reduced ? 0 : 220);
  return {
    el: overlay,
    remove() {
      overlay.classList.add("is-lifting");
      globalThis.setTimeout(() => overlay.remove(), reduced ? 0 : 700);
    },
  };
}
