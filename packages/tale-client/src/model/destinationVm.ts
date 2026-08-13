/**
 * [S2] 探索去处的按钮视图模型（纯）。
 *
 * ## 这一屏要回答的问题
 * 「探索」从一颗按钮变成了「往哪走」的一次决定，而**没有预览的按钮＝翻牌**
 * （M1-P1 追猎屏立的铁律）。所以每一颗去处按钮上恒有四项：
 *
 * | 位 | 写什么 | 玩家据它决定什么 |
 * |---|---|---|
 * | 地貌 | `DestinationDef.desc` | 这是个什么地方 |
 * | 遇事 | 「遇事 七成」 | 这一季值不值得花在探上 |
 * | 风险 | 「无事则约三成遇袭 · 此地有玄蟒、山魈」 | 打不打得过、要不要现在去 |
 * | 路费 | 「这一季耗饱食 24」 | 饿着的时候还去不去得起 |
 *
 * 未开启的去处**照样渲染、照样写明缺什么**（欲望展示位，同 M1 的置灰抉择、S1 的置灰技能）：
 * 「尚不得其门 —— 需 鳞甲、浮鳔（缺 浮鳔）」。缺的那几件用**顿号分隔的器官名**，
 * 不是 id，也不是「缺 2 件」—— 「缺 2 件」不构成一个可以去做的事。
 *
 * ## 刻意**不给**推荐（与追猎／搏杀不同）
 * 那两屏有唯一最优解（同一时刻只推荐一手，`recommendStalkAct`／`recommendCombatAct`），
 * 所以金光是信息。而「往哪走」的答案取决于这一世要什么 —— 缺食就走常路，凑门槛就下深处。
 * 给一条金光等于替玩家把这一批唯一的新决定做掉了。
 */

import {
  cnNumeral,
  exploreDestinations,
  organIndex,
  type DestinationPreview,
  type PerilTier,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { chanceCn } from "./format.js";

export interface DestinationButtonVm {
  id: string;
  /** 去处名号（按钮主标题） */
  name: string;
  /** 一句地貌 */
  desc: string;
  enabled: boolean;
  /** 未开启时的原因，写明缺哪几件：「尚不得其门 —— 需 鳞甲、浮鳔（缺 浮鳔）」 */
  disabledReason: string | null;
  /** 「遇事 七成」 —— 恒在，开启与否都写 */
  chanceLine: string;
  /** 「常路 · 几乎无袭」／「绝境 · 无事则约三成遇袭」 —— 恒在 */
  perilLine: string;
  /** 「此地有 玄蟒、山魈」；此地无兽时为 null */
  denizenLine: string | null;
  /** 「这一季耗饱食 24（含路费 12）」 —— 恒在 */
  costLine: string;
  /** 风险档（界面按它上色） */
  peril: PerilTier;
  /** 本世已到过（按钮上给一枚小印，也是「这一世还没去过哪儿」的提示） */
  visited: boolean;
  /** 本世已得此地秘藏 */
  treasureFound: boolean;
}

/** 三档风险的汉字读法。**只在这里写一次**，界面与测试都别自己拼。 */
export const PERIL_LABELS: Record<PerilTier, string> = {
  calm: "常路",
  wary: "险地",
  grim: "绝境",
};

/**
 * 三档风险的一句「它意味着什么」。
 *
 * 写「约三成遇袭」而不是「危险」：M1-P1 那条教训 —— 五档命中率等于没有信息，
 * 玩家做完一个动作看不出有没有变好。档位后面必须跟一个能比较的量。
 *
 * ⚠️ 遇袭是**条件概率**（先要这一季没撞上事件），所以措辞恒为「无事则……」。
 * 写成「三成遇袭」就是界面替引擎许了一个它不保证的诺（legibility 批次那条 Critical）。
 */
function perilLine(preview: DestinationPreview): string {
  const label = PERIL_LABELS[preview.def.peril];
  if (preview.ambushChance <= 0 || preview.ambushEnemies.length === 0) {
    return `${label} · 此地无袭`;
  }
  return `${label} · 无事则约${chanceCn(preview.ambushChance)}遇袭`;
}

function costLine(preview: DestinationPreview, content: TaleContent): string {
  const travel = content.tuning.explorePeril[preview.def.peril].travelCost;
  const base = `这一季耗饱食 ${preview.hungerCost}`;
  return travel > 0 ? `${base}（含路费 ${travel}）` : base;
}

/**
 * 未开启时那一句 —— **缺什么必须写成器官名**。
 *
 * 「需 鳞甲、浮鳔（缺 浮鳔）」：门槛全列 ＋ 还差的单列。只写「缺 浮鳔」看不出这处要几件
 * （凑齐一半的玩家不知道自己已经走到哪儿了），只写「需 鳞甲、浮鳔」又看不出还差哪一件。
 */
function lockReason(preview: DestinationPreview, content: TaleContent): string {
  const index = organIndex(content);
  const nameOf = (id: string): string => index.get(id)?.name ?? id;
  const all = preview.def.requiresOrganIds.map(nameOf).join("、");
  const missing = preview.missingOrganIds.map(nameOf).join("、");
  if (all.length === 0) return "此刻不可行";
  return preview.missingOrganIds.length === preview.def.requiresOrganIds.length
    ? `尚不得其门 —— 需 ${all}`
    : `尚不得其门 —— 需 ${all}（缺 ${missing}）`;
}

function denizenLine(preview: DestinationPreview): string | null {
  if (preview.ambushEnemies.length === 0) return null;
  return `此地有 ${preview.ambushEnemies.map((enemy) => enemy.name).join("、")}`;
}

/**
 * 全部去处的按钮（含未开启的，顺序恒按内容表）。
 *
 * 顺序恒定与 S1 图鉴同一个理由：位置固定，玩家才记得住「第四格还差一件浮鳔」。
 * 若把已开启的排前面，未开启的位置每世都在动，那一排就只是个计数器。
 */
export function buildDestinationVms(
  state: TaleState,
  content: TaleContent,
): DestinationButtonVm[] {
  return exploreDestinations(state, content).map((preview) => ({
    id: preview.def.id,
    name: preview.def.name,
    desc: preview.def.desc,
    enabled: preview.unlocked,
    disabledReason: preview.unlocked ? null : lockReason(preview, content),
    chanceLine: `遇事 ${chanceCn(preview.eventChance)}`,
    perilLine: perilLine(preview),
    denizenLine: denizenLine(preview),
    costLine: costLine(preview, content),
    peril: preview.def.peril,
    visited: preview.visited,
    treasureFound: preview.treasureFound,
  }));
}

/** 「六处已至三处」——行动面板那一行的小标题，顺带告诉玩家还有没去过的地方。 */
export function destinationCaption(vms: readonly DestinationButtonVm[]): string {
  const open = vms.filter((vm) => vm.enabled).length;
  const visited = vms.filter((vm) => vm.visited).length;
  return `往　哪　走　·　可去 ${cnNumeral(open)}／${cnNumeral(vms.length)} 处 · 这一世已至 ${cnNumeral(visited)} 处`;
}
