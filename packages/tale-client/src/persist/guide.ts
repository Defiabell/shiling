/**
 * 首世引导链的「看过了」标记（localStorage）。
 *
 * 与 `bloodline.ts` 同一套 `StorageLike` 注入（单测在 node 里跑、隐私模式下静默降级）。
 *
 * 粒度选择（与 3D 版 `objectives.ts` 一致，是判断不是遗漏）：**全局单一 flag，不按血统／
 * 不按种子**。含义是「同一个浏览器里，只要此前跳过或走完过这条链，就不再出现」——
 * 老玩家不需要每一世重看引导。读写失败一律当作「没看过」，宁可多显示一次也不因存档报错。
 */

import type { StorageLike } from "./bloodline.js";

/** 带版本号：将来链路改了就换 key，旧标记自然失效。 */
export const GUIDE_KEY = "shiling.tale.guide.v1";

export function loadGuideDismissed(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(GUIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 写入失败（配额满／隐私模式）返回 false —— 本次会话内仍生效，只是不跨会话。 */
export function saveGuideDismissed(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(GUIDE_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
