/**
 * 底部行动面板视图模型（纯）。
 *
 * 行动恒定显示（不可用时置灰并说明原因），而不是「不可用就不画」——
 * 「蛰伏」是玩家攒精气的目标，藏起来就没有目标感了。可用性一律问引擎的
 * `availableActions`，界面不复刻「任一精气 ≥ 阈值」这条规则。
 *
 * ## [S2] 「探索」不在这一排里
 * 它拆成了**一排去处按钮**（`destinationVm.ts`）：点哪一处就是这一季的探索。
 * 拆开而不是「先点探索再选去处」是纪律要求 —— **不得增加每回合必点次数**
 * （M1 的裁决，S1 的技能池也照这条办）。所以这一排与去处那一排平级，一次点击落定一季。
 *
 * ## [饥饿节奏批] 狩猎拆成两颗按钮：追猎／速猎
 * 同一条纪律的第二次应用：**不是**「先点狩猎再选打法」（那会给每一季的狩猎多加一次点击，
 * 而这一批的全部目的正是减少点击），而是两颗平级的按钮，点哪颗就是这一季怎么猎。
 *
 * 两颗按钮必须**摊开分别**（M1-P1 追猎屏立的铁律：没有预览的按钮就是翻牌）。
 * 分别有四项，逐项都写在按钮上：
 *
 * | | 追猎 | 速猎 |
 * |---|---|---|
 * | 点击 | 四五息的周旋（进追猎屏） | 一次点击，这一季就了 |
 * | 食 | 得手全额 | 一趟追猎总值的六成（`quickHuntFoodMul`） |
 * | 精气 | 整份 | 半份（`quickHuntEssenceMul`） |
 * | 食余 | 大猎物留下若干季 | **没有** |
 *
 * 表里**刻意不写具体数字**：它们会随调参与天时变（真正的数由 `quickHuntPreview` 现算，
 * 见下面的 `actionHint`）。写死一份就会在下一次调参后变成一张说谎的表 ——
 * 这个项目已经栽过三次（S2 的 `explorePeril` 表、探索权重注、以及这一批的初版）。
 *
 * 速猎另有一件按钮上也写着的事：**得手率一次掷定**（追猎的命中率是自己在那一屏上算出来的）。
 */

import {
  availableActions,
  lifeTuning,
  quickHuntPreview,
  type ActionId,
  type TaleContent,
  type TaleState,
  clashOf,
} from "@shiling/tale-sim";
import { moltPreviewText } from "./detailVm.js";
import { chanceCn } from "./format.js";

/**
 * [饥饿节奏批] 按钮 id ＝ 行动 id ＋ 一颗「速猎」。
 *
 * 它不是第五个 `ActionId`（引擎那一侧速猎是 `hunt` 的一个参数，见 `ActionOptions.huntMode`）——
 * 界面这一层要的是「一颗按钮一个 id」，与去处那一排（`data-dest`）同解：
 * 按钮 id 落到 `App.doAction` 时才翻译成「哪个行动 ＋ 什么参数」。
 */
export type ActionButtonId = ActionId | "hunt-quick";

export interface ActionButtonVm {
  id: ActionButtonId;
  /** 汉字印章 */
  glyph: string;
  label: string;
  hint: string;
  enabled: boolean;
  disabledReason: string | null;
  /** 点亮（蛰伏可用时的金色呼吸） */
  highlight: boolean;
}

const ACTION_GLYPHS: Record<ActionButtonId, { glyph: string; label: string }> = {
  hunt: { glyph: "猎", label: "追猎" },
  "hunt-quick": { glyph: "捕", label: "速猎" },
  explore: { glyph: "行", label: "探索" },
  rest: { glyph: "息", label: "休憩" },
  dormant: { glyph: "蛰", label: "蛰伏" },
};

/**
 * 每颗按钮的提示 —— **数字从 tuning／引擎预览来**，不是风味词。
 *
 * 原文案是「得食与精气，亦可能反被所噬」「稍复饱食」这种：读完仍然不知道该点哪个，
 * 而每季只能点一次，这正是「我该干什么、为什么」的第一现场。调参改了这几个值，
 * 按钮上的字会跟着改。
 *
 * ⚠️ 速猎那一行的两个数（得手率、得手回多少）**不许在这里算** —— 公式在引擎的
 * `quickHuntPreview` 里（客户端零游戏逻辑）。
 */
function actionHint(id: ActionButtonId, state: TaleState, content: TaleContent): string {
  // 这一世生效的调参：大旱之年的得手比平年多（`huntFoodGain` 在天时白名单里），两个账不同
  const t = lifeTuning(state, content);
  switch (id) {
    case "hunt":
      // 食余是这一批的核心，所以它必须与当场那一口并排出现：一次得手真正值多少，是这两笔之和
      return `周旋四五息　得手 +${t.huntFoodGain} 饱食 ＋ 整份精气，大猎物另留食余（每季 +${t.huntSurplusGain}）`;
    case "hunt-quick": {
      const preview = quickHuntPreview(state, content);
      return `一击即走　得手 ${chanceCn(preview.chance)}：+${preview.foodGain} 饱食 ＋ 半份精气，无食余`;
    }
    case "explore":
      // [S2] 这一支已无生产调用点（探索走去处那一排）。留着是因为 `ActionButtonId` 是封闭联合，
      // 少一支 TS 就不给穷尽检查了 —— 而穷尽检查正是「将来加第六颗按钮别忘了写提示」的守卫
      return `深入青丘　遇事的机会是别处的 ${t.exploreEventBonus} 倍（抉择才长灵与德）`;
    case "rest":
      // 净额单列：休憩曾经是「+14 而每季 −12」的陷阱，只写毛额的按钮把那笔账藏了起来
      return `敛息养神　+${t.restHungerGain} 饱食（净 +${t.restHungerGain - t.hungerPerSeason}），病可自愈`;
    default:
      return "以一季精气换一枚新器官";
  }
}

/**
 * [饥饿节奏批] 面板上这一排的顺序 —— **探索不在其中**（它是去处那一排）。
 *
 * 键盘 1〜4 对应这四颗；去处那一排从 5 起（见 `app.onKey`，第 10 颗按 `0`）。
 * 追猎排在速猎前面：它是「正经的那一条路」，也是玩家该先读到的那一份账。
 */
const ACTION_ORDER: readonly ActionButtonId[] = ["hunt", "hunt-quick", "rest", "dormant"];

/** 按钮 id → 引擎行动 id（速猎那一颗落到 `hunt` ＋ `huntMode: "quick"`）。 */
export function actionOfButton(id: ActionButtonId): ActionId {
  return id === "hunt-quick" ? "hunt" : id;
}

export function buildActionVms(state: TaleState, content: TaleContent): ActionButtonVm[] {
  const available = new Set(availableActions(state, content));

  return ACTION_ORDER.map((id) => {
    const meta = ACTION_GLYPHS[id];
    const enabled = available.has(actionOfButton(id));
    let disabledReason: string | null = null;
    if (!enabled) {
      // 顺序有讲究：全局原因（已死／战斗中）必须先判。早先把 dormant 的精气提示放在最前，
      // 结果精气已满却在打架时，按钮会写「尚需足之精气 0」——一句自相矛盾的废话。
      if (!state.alive) {
        disabledReason = "已　殁";
      } else if (clashOf(state)) {
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
