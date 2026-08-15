/**
 * [交锋节奏] 逐拍演出的视图模型（`model/beatVm.ts`）＋ 交锋屏上那一行先手标记。
 *
 * 这一组守的是「引擎给的结构真的变成了屏幕上一拍一拍的东西」，四件事：
 *
 * 1. **一拍是一拍**：招牌、旁白、飘字、血条起止各就各位，且血条的**起点**必须来自
 *    上一拍的终点（`renderPlay` 整棵重建，动画只能靠数据带起止值 —— 见 beatVm 头注）。
 * 2. **它那一拍念的是它宣告过的那个词**（重击／出手／守势／要走）——
 *    意图预告与打出来那一拍若各说各的，玩家读不出「它宣告的事真的发生了」。
 * 3. **先手可解释**：那一行不写「因为它速度高」，写两个可以直接比的数；
 *    它被拆过腿时**单独把那一笔说出来**（那正是玩家能动手改的地方）。
 * 4. **跳拍是纯函数**：推进与一跳到底都不碰时间、不碰 DOM（计时器只活在 app 里）。
 */

import { describe, expect, it } from "vitest";
import { combatAct, combatPreview, type CombatAct, type TaleState } from "@shiling/tale-sim";
import {
  advanceBeats,
  buildPlaybackVm,
  initiativeText,
  skipToLastBeat,
} from "../src/model/beatVm.js";
import { buildCombatVm } from "../src/model/combatVm.js";
import { FIXTURE_CONTENT, fightingState, makeContent, newState, type ClashPatch } from "./helpers.js";

const BITE: CombatAct = { kind: "bite", part: "throat" };

/** 一份可以把先手摆到两边的 content（野雉是 fixture 里那头，缺省没有 `speed`）。 */
function content(speed: number) {
  return makeContent({
    tuning: { combatDamageJitter: 0, minChance: 0, maxChance: 1 },
    enemies: FIXTURE_CONTENT.enemies.map((enemy) =>
      enemy.id === "ye-zhi" ? { ...enemy, speed, hp: 60 } : enemy,
    ),
  });
}

function ling(state: TaleState, value: number): TaleState {
  return { ...state, stats: { ...state.stats, ling: value } };
}

function playbackOf(speed: number, lingValue: number, patch: ClashPatch = {}) {
  const c = content(speed);
  const state = fightingState(ling(newState(), lingValue), {
    enemyHp: 60,
    playerHp: 40,
    guardPart: "eye",
    intent: { kind: "bite", text: "它向前逼了半步。" },
    ...patch,
  });
  const turn = combatAct(state, BITE, c);
  const combat = buildCombatVm(state, state.encounter!.clash!, c);
  return {
    turn,
    playback: buildPlaybackVm(turn, {
      enemyHpMax: combat.enemyHpMax,
      playerHpMax: combat.playerHpMax,
    }),
  };
}

describe("[交锋节奏] 拍：一拍在屏幕上是什么样", () => {
  it("我先动 → 第一拍是我的那一手，招牌是那颗按钮上的字", () => {
    const { playback } = playbackOf(6, 20);
    expect(playback.beats[0]?.side).toBe("player");
    expect(playback.beats[0]?.actorZi).toBe("我");
    expect(playback.beats[0]?.moveName).toBe("咬喉");
    expect(playback.index).toBe(0);
    expect(playback.done).toBe(false);
  });

  it("它那一拍念的是**它宣告过的那个词**（与意图预告同一套字）", () => {
    const { playback } = playbackOf(30, 10, { intent: { kind: "pounce", text: "它压低身子。" } });
    expect(playback.beats[0]?.side).toBe("enemy");
    expect(playback.beats[0]?.actorZi).toBe("彼");
    expect(playback.beats[0]?.moveName).toBe("重击");
  });

  it("伤害飘字只在真的打掉血时出现（不飘一个 0）", () => {
    const { playback } = playbackOf(6, 20);
    const mine = playback.beats[0];
    expect(mine?.hitEnemy).toBeGreaterThan(0);
    expect(mine?.hitPlayer).toBeNull();
  });

  it("血条的**起点来自上一拍的终点** —— 整棵重建之后动画只能靠数据带起止值", () => {
    const { playback } = playbackOf(6, 20);
    expect(playback.beats.length).toBeGreaterThan(1);
    playback.beats.forEach((beat, i) => {
      const prev = playback.beats[i - 1];
      if (prev) {
        expect(beat.enemyFromPercent).toBe(prev.enemyToPercent);
        expect(beat.playerFromPercent).toBe(prev.playerToPercent);
      }
      expect(beat.enemyToPercent).toBeGreaterThanOrEqual(0);
      expect(beat.enemyToPercent).toBeLessThanOrEqual(100);
    });
  });

  it("一拍的停顿落在 450〜650ms（计划给的区间；有伤害的那一拍长一点）", () => {
    const { playback } = playbackOf(6, 20);
    for (const beat of playback.beats) {
      expect(beat.holdMs).toBeGreaterThanOrEqual(450);
      expect(beat.holdMs).toBeLessThanOrEqual(650);
    }
    const hit = playback.beats.find((beat) => beat.hitEnemy !== null || beat.hitPlayer !== null);
    const quiet = playback.beats.find((beat) => beat.hitEnemy === null && beat.hitPlayer === null);
    if (hit && quiet) expect(hit.holdMs).toBeGreaterThan(quiet.holdMs);
  });

  it("**一招打死它 → 只有一拍**（引擎那边就没有它那一拍，这里也不该凭空补一个）", () => {
    const { turn, playback } = playbackOf(6, 20, { enemyHp: 1 });
    expect(turn.over).toBe("win");
    expect(playback.beats.map((beat) => beat.side)).toEqual(["player"]);
    expect(playback.done).toBe(true);
  });

  it("血条不缩到负宽（「超杀」那一记引擎的血是负数）", () => {
    const { playback } = playbackOf(6, 20, { enemyHp: 1 });
    expect(playback.beats[0]?.enemyToPercent).toBe(0);
    expect(playback.beats[0]?.enemyHp).toBe(0);
  });
});

describe("[交锋节奏] 跳拍：纯函数，不碰时间也不碰 DOM", () => {
  it("推一拍就往前走一格，走到末拍即 `done`", () => {
    const { playback } = playbackOf(6, 20);
    let cursor = playback;
    for (let i = 1; i < playback.beats.length; i += 1) {
      cursor = advanceBeats(cursor);
      expect(cursor.index).toBe(i);
    }
    expect(cursor.done).toBe(true);
    // 末拍之后再推不越界（「略过」与计时器可能撞在一起）
    expect(advanceBeats(cursor).index).toBe(playback.beats.length - 1);
  });

  it("「略过」一跳到底（`prefers-reduced-motion` 走的也是这条）", () => {
    const { playback } = playbackOf(6, 20);
    const end = skipToLastBeat(playback);
    expect(end.index).toBe(playback.beats.length - 1);
    expect(end.done).toBe(true);
  });
});

describe("[交锋节奏] 先手那一行：可见，且解释得出为什么", () => {
  it("写的是两个可以直接比的数，不是「速度更高」这种同义反复", () => {
    const { initiativeLabel, initiativeDetail } = initiativeText(
      {
        first: "player",
        playerSpeed: 17,
        enemySpeed: 12,
        enemyBaseSpeed: 12,
        enemyLegPenalty: 0,
        enemySlowPenalty: 0,
      },
      "后腿",
    );
    expect(initiativeLabel).toBe("你先动");
    expect(initiativeDetail).toContain("灵 17");
    expect(initiativeDetail).toContain("它 12");
  });

  it("**拆过腿就把那一笔单独说出来**（那是玩家能动手改的地方，不写就没人会去咬）", () => {
    const { initiativeDetail } = initiativeText(
      {
        first: "player",
        playerSpeed: 14,
        enemySpeed: 12,
        enemyBaseSpeed: 20,
        enemyLegPenalty: 8,
        enemySlowPenalty: 0,
      },
      "翼根",
    );
    expect(initiativeDetail).toContain("20 → 12");
    // 措辞跟着这一头兽走（同 `EnemyDef.legWord`：一条长着鸟翼的鱼没有后腿）
    expect(initiativeDetail).toContain("翼根伤 −8");
  });

  it("同速那一档明说「同速归你」—— 一条刻意的规则，不该读成巧合", () => {
    const { initiativeLabel, initiativeDetail } = initiativeText(
      {
        first: "player",
        playerSpeed: 12,
        enemySpeed: 12,
        enemyBaseSpeed: 12,
        enemyLegPenalty: 0,
        enemySlowPenalty: 0,
      },
      "后腿",
    );
    expect(initiativeLabel).toBe("你先动");
    expect(initiativeDetail).toContain("同速归你");
  });

  it("交锋屏出手**之前**就摆着这一行，且与引擎真跑用的先手是同一个", () => {
    const c = content(30);
    const state = fightingState(ling(newState(), 10), {
      enemyHp: 60,
      guardPart: "eye",
      intent: { kind: "bite", text: "它向前逼了半步。" },
    });
    const view = buildCombatVm(state, state.encounter!.clash!, c);
    expect(view.initiativeSide).toBe("enemy");
    expect(view.initiativeLabel).toBe("它先动");
    expect(view.initiativeDetail).toContain("慢过它");
    expect(view.initiativeSide).toBe(combatPreview(state, c).initiative.first);
    expect(view.initiativeSide).toBe(combatAct(state, BITE, c).initiative.first);
  });

  it("硬受那一枚状态牌明说「挡下它下一记」（不写「N 合」—— 它挡的是一记）", () => {
    const c = content(6);
    const state = fightingState(ling(newState(), 20), {
      enemyHp: 60,
      guardPart: "eye",
      brace: 2,
      intent: { kind: "bite", text: "它向前逼了半步。" },
    });
    const view = buildCombatVm(state, state.encounter!.clash!, c);
    expect(view.marks).toContain("硬受 · 挡下它下一记");
  });
});
