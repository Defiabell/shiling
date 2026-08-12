/**
 * 底部行动面板视图模型（纯）。
 *
 * 四个行动恒定显示（不可用时置灰并说明原因），而不是「不可用就不画」——
 * 「蛰伏」是玩家攒精气的目标，藏起来就没有目标感了。可用性一律问引擎的
 * `availableActions`，界面不复刻「任一精气 ≥ 阈值」这条规则。
 */

import {
  availableActions,
  lifeTuning,
  type ActionId,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { moltPreviewText } from "./detailVm.js";

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

const ACTION_GLYPHS: Record<ActionId, { glyph: string; label: string }> = {
  hunt: { glyph: "猎", label: "狩猎" },
  explore: { glyph: "行", label: "探索" },
  rest: { glyph: "息", label: "休憩" },
  dormant: { glyph: "蛰", label: "蛰伏" },
};

/**
 * 四个行动的提示 —— **数字从 tuning 来**，不是风味词。
 *
 * 原文案是「得食与精气，亦可能反被所噬」「稍复饱食」这种：读完仍然不知道该点哪个，
 * 而每季只能点一次，这正是「我该干什么、为什么」的第一现场。调参改了这几个值，
 * 按钮上的字会跟着改。
 */
function actionHint(id: ActionId, state: TaleState, content: TaleContent): string {
  // 这一世生效的调参：大旱之年的「得手 +42」与平年的「+32」是两个不同的账
  const t = lifeTuning(state, content);
  switch (id) {
    case "hunt":
      return `追猎一头猎物　得手 +${t.huntFoodGain} 饱食，另得那一型精气`;
    case "explore":
      return `深入青丘　遇事的机会是别处的 ${t.exploreEventBonus} 倍（抉择才长灵与德）`;
    case "rest":
      return `敛息养神　+${t.restHungerGain} 饱食，病可自愈`;
    default:
      return "以一季精气换一枚新器官";
  }
}

const ACTION_ORDER: readonly ActionId[] = ["hunt", "explore", "rest", "dormant"];

export function buildActionVms(state: TaleState, content: TaleContent): ActionButtonVm[] {
  const available = new Set(availableActions(state, content));

  return ACTION_ORDER.map((id) => {
    const meta = ACTION_GLYPHS[id];
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
        // 差多少 ＋ **攒它干什么** ＋ **怎么攒**：按钮禁用时 hint 被 disabledReason 顶掉，
        // 而「蛰伏＝换器官、这一型靠猎野雉／穴鼠涨」恰恰是新玩家最需要知道的那一句
        // （不然精气条只是四根会涨的柱子）。
        disabledReason = moltPreviewText(state, content);
      } else {
        disabledReason = "此刻不可行";
      }
    }
    return {
      id,
      glyph: meta.glyph,
      label: meta.label,
      // 蛰伏可按时，hint 换成「按下去会发生什么」——追猎屏立的规矩：没有预览的按钮就是翻牌
      hint: id === "dormant" && enabled ? moltPreviewText(state, content) : actionHint(id, state, content),
      enabled,
      disabledReason,
      highlight: id === "dormant" && enabled,
    };
  });
}
