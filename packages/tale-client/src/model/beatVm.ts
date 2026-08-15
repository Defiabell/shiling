/**
 * [交锋节奏] 逐拍演出的视图模型（纯）。
 *
 * ## 这一层唯一的职责：把引擎给的 `CombatTurn.beats` 翻成「屏幕上一拍是什么样」
 * 引擎给的是结构（谁、什么招、打掉多少、打完剩多少血），措辞与呈现决定归这里：
 * 招牌怎么念（「咬喉」「重击」「回合末」）、飘字往哪边飞、血条从哪儿动到哪儿、
 * 这一拍该停多久。**这里不重算任何伤害或概率** —— 与 `combatVm` 同一条纪律。
 *
 * ## 为什么血条要「起点 ＋ 终点」两个值
 * `renderPlay` 每回合整棵重建 DOM，于是 CSS `transition` 在新节点上**不会播**
 * （新节点一出生就是终点值，没有「变化」可过渡）。只有 `@keyframes from → to` 会。
 * 所以每一拍都带着 `fromPercent`／`toPercent`，样式表照它跑一段动画。
 * 这一条是这个项目第二次栽在「整棵重建」上（第一次是入场动画重放），写在这儿备忘。
 *
 * ## 停顿时长归这里而不是归 app
 * 「一拍停多久」是**呈现决定**（有伤害的那一拍要等血条走完，没伤害的可以快一点），
 * 与「怎么等」（计时器、跳拍、reduced-motion）分开：后者在 app 里，是副作用；
 * 这里给的是一个纯数。引擎那边一个字都不知道有计时器这回事（tale-sim 禁计时器）。
 */

import type {
  BodyPart,
  CombatBeat,
  CombatInitiative,
  CombatTurn,
  EnemyIntentKind,
  Stance,
} from "@shiling/tale-sim";
import { toPercent } from "./format.js";

/** 一拍在屏幕上的样子。 */
export interface BeatVm {
  side: "player" | "enemy" | "round";
  /** 拍头亮出来的那几个字：「咬喉」「重击」「回合末」 */
  moveName: string;
  /** 谁出的这一手（「我」「彼」「场上」）—— 拍头左边那一枚印 */
  actorZi: string;
  /** 这一拍的旁白（引擎原话，一行一句） */
  lines: string[];
  /** 伤害飘字；null ＝ 这一拍没伤到那一边（不飘一个 0） */
  hitEnemy: number | null;
  hitPlayer: number | null;
  /** 这一拍里有一记正中要害 */
  crit: boolean;
  /** 我方在这一拍回了血（技的疗愈）—— 与「挨伤」在屏幕上是两个方向 */
  healPlayer: number | null;
  /** 血条动画：从哪儿到哪儿（百分数） */
  enemyFromPercent: number;
  enemyToPercent: number;
  playerFromPercent: number;
  playerToPercent: number;
  /** 拍末双方的血（数字那一栏） */
  enemyHp: number;
  playerHp: number;
  /** 这一拍演完该停多久（毫秒）—— app 只负责照它等 */
  holdMs: number;
}

/**
 * 逐拍演出的全部：拍序 ＋ 放到第几拍。
 *
 * **先手那一行不在这里** —— 它整合不变，由 `CombatVm.initiativeLabel/Detail` 出
 * （`combatVm.ts` 里那一处直接读 `preview.partNames.leg`，措辞跟着这一头兽走）。
 * 第一版在这里又造了一份，于是同一句话有两个来源，而这一份还得自己去凑那个部位名 ——
 * code-reviewer 抓到它当时是从 `guardLabel` 上剥字符串来的：**它护的不一定是腿**，
 * 于是三分之二的回合会念错部位。一句话只该有一个来源。
 */
export interface ClashPlaybackVm {
  beats: BeatVm[];
  /** 已经放到第几拍（0-based，含正在放的这一拍） */
  index: number;
  /** 拍已经放完了（app 据它决定何时解锁指令区） */
  done: boolean;
}

/**
 * 一拍停多久。**450〜650ms**（计划给的区间）——
 * 有伤害的那一拍要等血条走完，纯文字那一拍可以快一点。
 */
const HOLD_HIT_MS = 620;
const HOLD_QUIET_MS = 470;

/** 招牌读法：三颗咬击。与 `combatVm` 那张 `PART_ACT` 同源（两处必须念同一个词）。 */
const BITE_NAME: Record<BodyPart, string> = { throat: "咬喉", leg: "咬腿", eye: "扑眼" };
const STANCE_NAME: Record<Stance, string> = { low: "伏低", square: "正对", lunge: "扑击" };
/**
 * 它那一拍的招牌。
 *
 * 与 `combatVm.INTENT_KIND_TAG` 同一套字（「重击／出手／守势／要走」）—— 意图预告上写的
 * 是什么，打出来那一拍就该叫什么，否则玩家读不出「它宣告的那件事真的发生了」。
 */
const ENEMY_MOVE_NAME: Record<EnemyIntentKind, string> = {
  pounce: "重击",
  bite: "出手",
  guard: "守势",
  flee: "要走",
};

const ACTOR_ZI = { player: "我", enemy: "彼", round: "场" } as const;

function moveNameOf(beat: CombatBeat): string {
  switch (beat.move.kind) {
    case "bite":
      return BITE_NAME[beat.move.part];
    case "finisher":
      return "决杀";
    case "stance":
      return STANCE_NAME[beat.move.to];
    case "skill":
      return beat.move.name;
    case "flee":
      return "遁走";
    case "enemyAct":
      return ENEMY_MOVE_NAME[beat.move.intent];
    case "round":
      return "回合末";
  }
}

function buildBeat(beat: CombatBeat, enemyHpMax: number, playerHpMax: number): BeatVm {
  const heal = beat.playerHp > beat.playerHpBefore ? beat.playerHp - beat.playerHpBefore : null;
  return {
    side: beat.side,
    moveName: moveNameOf(beat),
    actorZi: ACTOR_ZI[beat.side],
    lines: [...beat.lines],
    hitEnemy: beat.toEnemy > 0 ? beat.toEnemy : null,
    hitPlayer: beat.toPlayer > 0 ? beat.toPlayer : null,
    crit: beat.crit,
    healPlayer: heal,
    // 血条夹到 [0,100]：引擎的血可以是负数（「超杀」那一记），血条不该缩到负宽
    enemyFromPercent: toPercent(Math.max(0, beat.enemyHpBefore) / enemyHpMax),
    enemyToPercent: toPercent(Math.max(0, beat.enemyHp) / enemyHpMax),
    playerFromPercent: toPercent(Math.max(0, beat.playerHpBefore) / playerHpMax),
    playerToPercent: toPercent(Math.max(0, beat.playerHp) / playerHpMax),
    enemyHp: Math.max(0, beat.enemyHp),
    playerHp: Math.max(0, beat.playerHp),
    holdMs: beat.toEnemy > 0 || beat.toPlayer > 0 ? HOLD_HIT_MS : HOLD_QUIET_MS,
  };
}

/**
 * 先手那一句 —— **「谁先动」与「为什么」各一行**。
 *
 * 「为什么」不写「因为速度高」这种同义反复，而写两个可以直接比的数（灵 vs 它的快慢），
 * 并在它被拆过腿／被迟滞时把**那一笔**单独说出来 —— 那正是玩家能动手改的地方
 * （咬腿的第三样用处），不写出来就没人会去咬。
 */
export function initiativeText(
  init: CombatInitiative,
  legWord: string,
): { initiativeLabel: string; initiativeDetail: string } {
  const label = init.first === "player" ? "你先动" : "它先动";
  const tolls: string[] = [];
  if (init.enemyLegPenalty > 0) tolls.push(`${legWord}伤 −${init.enemyLegPenalty}`);
  if (init.enemySlowPenalty > 0) tolls.push(`迟滞 −${init.enemySlowPenalty}`);
  const enemyPart =
    tolls.length > 0
      ? `它 ${init.enemyBaseSpeed} → ${init.enemySpeed}（${tolls.join("、")}）`
      : `它 ${init.enemySpeed}`;
  const verb =
    init.playerSpeed === init.enemySpeed
      ? "同快慢 —— 同速归你"
      : init.first === "player"
        ? "快过它"
        : "慢过它";
  return {
    initiativeLabel: label,
    initiativeDetail: `灵 ${init.playerSpeed} ${verb}　${enemyPart}`,
  };
}

/**
 * 把一次 `combatAct` 的结果翻成逐拍演出。
 *
 * `index` 由 app 推进（它管计时器）；这里只造出「第 0 拍的样子」，
 * 换拍时 app 拿 `advanceBeats` 造下一帧 —— 两者都是纯函数。
 */
export function buildPlaybackVm(
  turn: Pick<CombatTurn, "beats">,
  opts: { enemyHpMax: number; playerHpMax: number },
): ClashPlaybackVm {
  const beats = turn.beats.map((beat) =>
    buildBeat(beat, Math.max(1, opts.enemyHpMax), Math.max(1, opts.playerHpMax)),
  );
  return { beats, index: 0, done: beats.length <= 1 };
}

/** 推到下一拍（纯）。已经在最后一拍时只把 `done` 置真。 */
export function advanceBeats(playback: ClashPlaybackVm): ClashPlaybackVm {
  const next = Math.min(playback.index + 1, Math.max(0, playback.beats.length - 1));
  return { ...playback, index: next, done: next >= playback.beats.length - 1 };
}

/** 一跳到底（「略过」那一颗，以及 `prefers-reduced-motion` 走的那条路）。 */
export function skipToLastBeat(playback: ClashPlaybackVm): ClashPlaybackVm {
  return {
    ...playback,
    index: Math.max(0, playback.beats.length - 1),
    done: true,
  };
}
