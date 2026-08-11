/**
 * 底部行动面板视图模型（纯）。
 *
 * 四个行动恒定显示（不可用时置灰并说明原因），而不是「不可用就不画」——
 * 「蛰伏」是玩家攒精气的目标，藏起来就没有目标感了。可用性一律问引擎的
 * `availableActions`，界面不复刻「任一精气 ≥ 阈值」这条规则。
 */

import { availableActions, type ActionId, type TaleContent, type TaleState } from "@shiling/tale-sim";
import { ESSENCE_LABELS, ESSENCE_ORDER } from "./format.js";

export interface ActionButtonVm {
  id: ActionId;
  /** 汉字印章 */
  glyph: string;
  label: string;
  hint: string;
  enabled: boolean;
  disabledReason: string | null;
  /** 点亮（蛰伏可用时的金色呼吸） */
  highlight: boolean;
}

const ACTION_META: Record<ActionId, { glyph: string; label: string; hint: string }> = {
  hunt: { glyph: "猎", label: "狩猎", hint: "循迹搏杀。得食与精气，亦可能反被所噬。" },
  explore: { glyph: "行", label: "探索", hint: "深入青丘。遇事的机会最多。" },
  rest: { glyph: "息", label: "休憩", hint: "敛息养神，稍复饱食。" },
  dormant: { glyph: "蛰", label: "蛰伏", hint: "以一季精气换一枚新器官。" },
};

const ACTION_ORDER: readonly ActionId[] = ["hunt", "explore", "rest", "dormant"];

export function buildActionVms(state: TaleState, content: TaleContent): ActionButtonVm[] {
  const available = new Set(availableActions(state, content));
  const threshold = content.tuning.moltThreshold;
  const best = ESSENCE_ORDER.reduce(
    (top, type) => (state.essence[type] > state.essence[top] ? type : top),
    ESSENCE_ORDER[0] ?? "zu",
  );

  return ACTION_ORDER.map((id) => {
    const meta = ACTION_META[id];
    const enabled = available.has(id);
    let disabledReason: string | null = null;
    if (!enabled) {
      // 顺序有讲究：全局原因（已死／战斗中）必须先判。早先把 dormant 的精气提示放在最前，
      // 结果精气已满却在打架时，按钮会写「尚需足之精气 0」——一句自相矛盾的废话。
      if (!state.alive) {
        disabledReason = "已　殁";
      } else if (state.combat) {
        disabledReason = "战事未了";
      } else if (id === "dormant") {
        const need = Math.max(0, threshold - Math.round(state.essence[best]));
        disabledReason = `尚需${ESSENCE_LABELS[best]}之精气 ${need}`;
      } else {
        disabledReason = "此刻不可行";
      }
    }
    return {
      id,
      glyph: meta.glyph,
      label: meta.label,
      hint: meta.hint,
      enabled,
      disabledReason,
      highlight: id === "dormant" && enabled,
    };
  });
}
