/**
 * 战斗界面视图模型（纯）。
 *
 * 血条比率、器官技按钮是否点亮、四个按钮的说明文案都在这里定死 ——
 * 尤其「器官技」：引擎在没有 combatSkill 器官时 `combatAct(…, "organ", …)` 直接抛错，
 * 所以按钮的 enabled 必须由 `combatSkillOrgan` 而不是界面自己的猜测决定。
 */

import {
  combatSkillOrgan,
  type CombatState,
  type EnemyDef,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { toPercent } from "./format.js";

export type CombatActId = "fight" | "flee" | "feint" | "organ";

export interface CombatActionVm {
  id: CombatActId;
  label: string;
  hint: string;
  enabled: boolean;
  /** 未点亮的原因（器官技专用），点亮时为 null */
  disabledReason: string | null;
}

export interface CombatVm {
  enemyName: string;
  enemyDesc: string;
  enemyTags: string[];
  enemyHp: number;
  enemyHpMax: number;
  enemyPercent: number;
  playerHp: number;
  playerHpMax: number;
  playerPercent: number;
  /** 玩家血量低于三成 → 界面转朱砂告急 */
  playerCritical: boolean;
  round: number;
  /** 引擎累积的回合日志（战斗结束那一刻 state.combat 会被置 null，届时由调用方保留副本） */
  log: string[];
  actions: CombatActionVm[];
  /** 上一次「诈」成功，本次出手伤害翻倍 —— 值得在界面上明说 */
  primed: boolean;
}

const SYS_FLAG_FEINT_PRIMED = "sys:feint-primed";

export function buildCombatVm(
  state: TaleState,
  combat: CombatState,
  content: TaleContent,
): CombatVm {
  const enemy: EnemyDef | undefined = content.enemies.find(
    (candidate) => candidate.id === combat.enemyId,
  );
  const enemyHpMax = enemy?.hp ?? Math.max(1, combat.enemyHp);
  const playerHpMax = Math.max(1, state.stats.ti);
  const skillOrgan = combatSkillOrgan(state, content);
  const primed = state.flags.includes(SYS_FLAG_FEINT_PRIMED);

  // hint 一律压在一行十字以内：这四个按钮并排只有 ~150px 宽，长句会折成三行糊掉。
  const actions: CombatActionVm[] = [
    { id: "fight", label: "战", hint: "以爪牙决胜负", enabled: true, disabledReason: null },
    { id: "flee", label: "逃", hint: "凭灵性觑隙遁走", enabled: true, disabledReason: null },
    {
      id: "feint",
      label: "诈",
      hint: "伪死免伤，下击倍之",
      enabled: true,
      disabledReason: null,
    },
    {
      id: "organ",
      label: skillOrgan?.combatSkill?.name ?? "器官技",
      hint: skillOrgan?.combatSkill?.desc ?? "尚无可施之技。",
      enabled: skillOrgan !== null,
      disabledReason: skillOrgan ? null : "未蜕生带战技的器官",
    },
  ];

  return {
    enemyName: enemy?.name ?? combat.enemyId,
    enemyDesc: enemy?.desc ?? "",
    enemyTags: enemy?.tags ?? [],
    enemyHp: Math.max(0, combat.enemyHp),
    enemyHpMax,
    enemyPercent: toPercent(combat.enemyHp / enemyHpMax),
    playerHp: Math.max(0, combat.playerHp),
    playerHpMax,
    playerPercent: toPercent(combat.playerHp / playerHpMax),
    playerCritical: combat.playerHp / playerHpMax < 0.3,
    round: combat.round,
    log: combat.log,
    actions,
    primed,
  };
}
