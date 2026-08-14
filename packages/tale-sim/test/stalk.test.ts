/**
 * 追猎状态机（M1-P1）。
 *
 * ## 这份测试真正在守什么
 * 追猎的设计前提是「**所有决策变量对玩家可见，且预览不骗人**」—— 玩家按按钮上写的数
 * 做跨回合计划（绕上风 → 潜三步 → 屏息一次 → 扑），如果预览与实际结算差一点点，那些计划
 * 就会在第三步对不上账，而玩家只会得出「这游戏是随机的」这个结论 —— 也就是退回 M0 的翻牌。
 * 所以这里最要紧的一组断言是「`stalkPreview` 报的数 ＝ 真跑一步之后的数」（见「预览不骗人」）。
 *
 * 其余三组：状态机边界（警觉满／体力尽／跟丢／距离夹紧）、命中率公式逐项、
 * 器官 tag 对**信息精度**的影响（build 差异第一次直接改操作层手感）。
 */

import { describe, expect, it } from "vitest";
import {
  STALK_MESSAGES,
  createLife,
  performAction,
  stalkAct,
  stalkPreview,
  type StalkAct,
  type TaleContent,
  type TaleState,
  type WindDir,
} from "../src/index.js";
import {
  ALWAYS_POUNCE,
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  FIXTURE_SEED_ID,
  NEVER_POUNCE,
  ORGAN_GOU_CHI,
  ORGAN_JI_ZU,
  ORGAN_WU_MU,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  enterStalk,
  withOrgans,
} from "./fixtures.js";

/** 追猎测试的基线 content：不抽事件（否则狩猎那一季可能撞上事件而不起追）。 */
const QUIET = contentWithoutEvents();

/** 造一个「正在追野雉」的状态，四个量随手可覆写。 */
function stalking(
  overrides: Parameters<typeof enterStalk>[2] = {},
  content: TaleContent = QUIET,
  seed = 7,
): TaleState {
  return enterStalk(createLife(seed, FIXTURE_SEED_ID, content), ENEMY_YE_ZHI, overrides, content);
}

function act(state: TaleState, action: StalkAct, content: TaleContent = QUIET) {
  return stalkAct(state, action, content);
}

describe("起追", () => {
  it("四个量都落在 tuning／EnemyDef 声明的范围内", () => {
    const t = QUIET.tuning;
    for (let seed = 0; seed < 60; seed += 1) {
      const { state } = performAction(createLife(seed, FIXTURE_SEED_ID, QUIET), "hunt", QUIET);
      const stalk = state.stalk;
      expect(stalk).not.toBeNull();
      if (!stalk) return;
      // fixture 野雉：startDistance 24、wariness 18
      expect(stalk.distance).toBeGreaterThanOrEqual(24 - t.stalkStartDistanceJitter);
      expect(stalk.distance).toBeLessThanOrEqual(24 + t.stalkStartDistanceJitter);
      expect(stalk.alertness).toBeGreaterThanOrEqual(18 - t.stalkStartAlertJitter);
      expect(stalk.alertness).toBeLessThanOrEqual(18 + t.stalkStartAlertJitter);
      expect(stalk.stamina).toBe(t.stalkStamina);
    }
  });

  it("三种风向都会出现（否则「绕至上风」是个没用的按钮）", () => {
    const winds = new Set<WindDir>();
    for (let seed = 0; seed < 60; seed += 1) {
      const { state } = performAction(createLife(seed, FIXTURE_SEED_ID, QUIET), "hunt", QUIET);
      if (state.stalk) winds.add(state.stalk.wind);
    }
    expect(winds).toEqual(new Set<WindDir>(["into", "cross", "with"]));
  });

  it("起追旁白进 stalk.log，且不是同一句复读", () => {
    const openings = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      const { state } = performAction(createLife(seed, FIXTURE_SEED_ID, QUIET), "hunt", QUIET);
      const first = state.stalk?.log[0];
      if (first) openings.add(first);
    }
    // fixture 野雉没写 begin 槽 → 走引擎兜底池，三条变体都该出现
    expect(openings.size).toBe(STALK_MESSAGES.begin.length);
  });
});

describe("潜行", () => {
  it("按 tuning 拉近距离，且不会拉成负数", () => {
    const t = QUIET.tuning;
    const near = act(stalking({ distance: 5 }), "creep");
    expect(near.state.stalk?.distance).toBe(0);
    const far = act(stalking({ distance: 30 }), "creep");
    expect(far.state.stalk?.distance).toBe(30 - t.stalkCreepDistance);
  });

  it("警觉增益：顺风翻倍、逆风减半（正本的风向表）", () => {
    const gainAt = (wind: WindDir): number => {
      const before = stalking({ distance: 30, alertness: 10, wind });
      return (act(before, "creep").state.stalk?.alertness ?? 0) - 10;
    };
    const cross = gainAt("cross");
    expect(gainAt("into")).toBe(Math.round(cross / 2));
    expect(gainAt("with")).toBe(cross * 2);
  });

  /*
   * 这条守着整套数值里最关键的一条曲线：**最后一步永远是最险的一步**。
   * 没有它，潜行就是匀速逼近，玩家算一次就够了，「什么时候停下来扑」不成为问题。
   */
  it("越近警觉涨得越凶（贴近倍率）", () => {
    const gainAt = (distance: number): number => {
      const before = stalking({ distance, alertness: 10, wind: "cross" });
      return (act(before, "creep").state.stalk?.alertness ?? 0) - 10;
    };
    const far = gainAt(40); // 移动后仍在 stalkNearDistance 之外
    const mid = gainAt(20);
    const close = gainAt(12); // 移动后贴身
    expect(far).toBe(QUIET.tuning.stalkCreepAlert);
    expect(mid).toBeGreaterThan(far);
    expect(close).toBeGreaterThan(mid);
    expect(close).toBe(QUIET.tuning.stalkCreepAlert * QUIET.tuning.stalkNearAlertMul);
  });

  it("疾足 tag 拉得更近，猎手 tag 走得更轻", () => {
    const base = stalking({ distance: 30, alertness: 10, wind: "cross" });
    const plain = act(base, "creep").state.stalk;
    const swift = act(withOrgans(base, ORGAN_JI_ZU), "creep").state.stalk;
    const quiet = act(withOrgans(base, ORGAN_GOU_CHI), "creep").state.stalk;

    expect(swift?.distance).toBe((plain?.distance ?? 0) - QUIET.tuning.stalkCreepSwiftBonus);
    expect(quiet?.alertness).toBeLessThan(plain?.alertness ?? 0);
    // 静步只减警觉，不改距离
    expect(quiet?.distance).toBe(plain?.distance);
  });

  it("每一步都扣一点体力、round 递增、log 累积", () => {
    const first = act(stalking({ distance: 30 }), "creep");
    expect(first.state.stalk?.stamina).toBe(QUIET.tuning.stalkStamina - 1);
    expect(first.state.stalk?.round).toBe(1);
    const second = act(first.state, "creep");
    expect(second.state.stalk?.round).toBe(2);
    expect(second.state.stalk?.log.length).toBe(2);
    expect(second.roundLog).toHaveLength(1);
  });
});

describe("绕至上风与屏息等待", () => {
  it("绕行把风向重置为逆风，代价是一点警觉与一点体力", () => {
    const before = stalking({ wind: "with", alertness: 20 });
    const turn = act(before, "circle");
    expect(turn.state.stalk?.wind).toBe("into");
    expect(turn.state.stalk?.alertness).toBe(20 + QUIET.tuning.stalkCircleAlert);
    expect(turn.state.stalk?.stamina).toBe(QUIET.tuning.stalkStamina - 1);
    // 距离不变：绕的是风，不是路
    expect(turn.state.stalk?.distance).toBe(before.stalk?.distance);
  });

  it("绕行的警觉代价按旧风向的账付，收益从下一步起兑现", () => {
    const before = stalking({ distance: 30, alertness: 20, wind: "with" });
    const circled = act(before, "circle").state;
    const creptAfter = act(circled, "creep").state.stalk?.alertness ?? 0;
    // 顺风直接潜行 vs 先绕风再潜行：后者这一步的警觉增益应当只有一半
    const creptDirect = act(before, "creep").state.stalk?.alertness ?? 0;
    expect(creptAfter - (circled.stalk?.alertness ?? 0)).toBeLessThan(creptDirect - 20);
  });

  it("屏息压警觉，且不会压成负数", () => {
    const calm = contentWithoutEvents({ tuning: { stalkWaitMoveChance: 0 } });
    const mid = act(stalking({ alertness: 40 }, calm), "wait", calm);
    expect(mid.state.stalk?.alertness).toBe(40 - calm.tuning.stalkWaitAlertDrop);
    const already = act(stalking({ alertness: 3 }, calm), "wait", calm);
    expect(already.state.stalk?.alertness).toBe(0);
  });

  it("屏息时猎物可能自行挪位（远离或靠近，都在声明的步幅内）", () => {
    const restless = contentWithoutEvents({ tuning: { stalkWaitMoveChance: 1 } });
    const t = restless.tuning;
    const moved = new Set<number>();
    for (let seed = 0; seed < 40; seed += 1) {
      const turn = act(stalking({ distance: 20, alertness: 40 }, restless, seed), "wait", restless);
      const distance = turn.state.stalk?.distance ?? 0;
      moved.add(distance);
      const delta = Math.abs(distance - 20);
      expect(delta).toBeGreaterThanOrEqual(t.stalkWaitMoveMin);
      expect(delta).toBeLessThanOrEqual(t.stalkWaitMoveMax);
    }
    // 两个方向都要出现，否则「等」就是单向免费的
    expect([...moved].some((d) => d > 20)).toBe(true);
    expect([...moved].some((d) => d < 20)).toBe(true);
  });

  it("猎物挪出 stalkLoseDistance 就彻底跟丢", () => {
    const restless = contentWithoutEvents({
      tuning: { stalkWaitMoveChance: 1, stalkWaitMoveAwayChance: 1, stalkLoseDistance: 30 },
    });
    const turn = act(stalking({ distance: 28, alertness: 40 }, restless), "wait", restless);
    expect(turn.over).toBe("escaped");
    expect(turn.state.stalk).toBeNull();
  });
});

describe("扑击", () => {
  /*
   * 期望值是**手算的字面量**，不是把 `pounceChanceAt` 的算式在测试里再抄一遍 ——
   * 抄一遍的写法在系数写错位（比如距离项与警觉项对调）时会跟着一起错，什么也拦不住。
   * 基线：0.95 − 距离×0.035 − 警觉×0.008 + 猛×0.004。
   */
  it("命中率＝正本公式（距离、警觉各自都能把它压死，猛只是微调）", () => {
    const t = QUIET.tuning;
    const chance = (distance: number, alertness: number, meng: number): number => {
      const base = stalking({ distance, alertness });
      return stalkPreview({ ...base, stats: { ...base.stats, meng } }, QUIET).pounceChance;
    };

    // 贴身、警觉 20、猛 10：0.95 − 0 − 0.16 + 0.04
    expect(chance(0, 20, 10)).toBeCloseTo(0.83, 10);
    // 8 步、警觉 30、猛 10：0.95 − 0.28 − 0.24 + 0.04
    expect(chance(8, 30, 10)).toBeCloseTo(0.47, 10);
    // 距离与警觉是两个独立的项：只挪距离 8 步 ＝ −0.28，只挪警觉 10 点 ＝ −0.08
    expect(chance(0, 30, 10) - chance(8, 30, 10)).toBeCloseTo(0.28, 10);
    expect(chance(8, 20, 10) - chance(8, 30, 10)).toBeCloseTo(0.08, 10);
    // 猛只是微调：+10 猛 ＝ +0.04
    expect(chance(8, 30, 20) - chance(8, 30, 10)).toBeCloseTo(0.04, 10);
    // 远距离被 minChance 兜住（「必失手」在界面上是明确警告，不是 0%）
    expect(chance(40, 90, 10)).toBe(t.minChance);
    // 贴身且完全未觉被 maxChance 封顶
    expect(chance(0, 0, 100)).toBe(t.maxChance);
  });

  it("命中：得食＋吞精气，追猎置空", () => {
    const content = contentWithoutEvents({ tuning: ALWAYS_POUNCE });
    const turn = act(stalking({ distance: 2, alertness: 20 }, content), "pounce", content);
    expect(turn.over).toBe("caught");
    expect(turn.state.essence.zu).toBe(12);
    expect(turn.state.stalk).toBeNull();
    // [饥饿节奏批] 得手的三句：扑中 ＋ 进食 ＋ **余粮**（第三句是这一批加的，见 `huntSurplus`）
    expect(turn.roundLog).toHaveLength(3);
    expect(turn.roundLog[2]).toContain("够吃");
  });

  it("失手：小猎物遁走，反扑的猎物转入搏杀（起手血量＝ti、敌人满血）", () => {
    const content = contentWithoutEvents({ tuning: NEVER_POUNCE });
    const small = act(stalking({ distance: 2 }, content), "pounce", content);
    expect(small.over).toBe("escaped");
    expect(small.state.combat).toBeNull();

    const life = createLife(7, FIXTURE_SEED_ID, content);
    const big = stalkAct(enterStalk(life, ENEMY_QIONG_QI, {}, content), "pounce", content);
    expect(big.over).toBe("combat");
    expect(big.state.combat?.enemyId).toBe(ENEMY_QIONG_QI);
    expect(big.state.combat?.enemyHp).toBe(40);
    expect(big.state.combat?.playerHp).toBe(big.state.stats.ti);
    expect(big.state.stalk).toBeNull();
  });

  it("附毒 tag：扑空转搏杀时敌人已带伤入场", () => {
    const content = contentWithoutEvents({
      tuning: { ...NEVER_POUNCE, stalkVenomTag: "night-eye", stalkVenomHpMul: 0.5 },
    });
    const life = withOrgans(createLife(7, FIXTURE_SEED_ID, content), ORGAN_WU_MU);
    const turn = stalkAct(enterStalk(life, ENEMY_QIONG_QI, {}, content), "pounce", content);
    expect(turn.over).toBe("combat");
    expect(turn.state.combat?.enemyHp).toBe(20);
    expect(turn.roundLog.join("")).toContain("腥液");
  });
});

describe("收束边界", () => {
  it("警觉满：小猎物惊走，反扑的猎物回头", () => {
    const t = QUIET.tuning;
    const spooked = act(stalking({ distance: 4, alertness: t.stalkAlertMax - 1, wind: "with" }), "creep");
    expect(spooked.over).toBe("escaped");
    expect(spooked.state.stalk).toBeNull();

    const life = createLife(7, FIXTURE_SEED_ID, QUIET);
    const cornered = stalkAct(
      enterStalk(life, ENEMY_QIONG_QI, { distance: 4, alertness: t.stalkAlertMax - 1, wind: "with" }),
      "creep",
      QUIET,
    );
    expect(cornered.over).toBe("combat");
  });

  it("体力耗尽（最后一点花在非扑击动作上）＝空手而归", () => {
    const turn = act(stalking({ distance: 30, stamina: 1 }), "creep");
    expect(turn.over).toBe("exhausted");
    expect(turn.state.stalk).toBeNull();
    expect(turn.state.hunger).toBeLessThan(60); // 只扣了季消耗，没有收益
    expect(turn.roundLog.join("")).toMatch(/追不动|气力|没能近身/);
  });

  it("最后一点体力用来扑击是合法的（预算含那一扑）", () => {
    const content = contentWithoutEvents({ tuning: ALWAYS_POUNCE });
    const turn = act(stalking({ distance: 2, stamina: 1 }, content), "pounce", content);
    expect(turn.over).toBe("caught");
  });

  it("一场追猎最多消耗 stalkStamina 个动作（不会无限追下去）", () => {
    let state = stalking({ distance: 40 });
    let steps = 0;
    while (state.stalk && steps < 50) {
      state = act(state, "wait").state;
      steps += 1;
    }
    expect(steps).toBeLessThanOrEqual(QUIET.tuning.stalkStamina);
    expect(state.stalk).toBeNull();
  });
});

describe("预览不骗人（信息可见性的地基）", () => {
  const cases: readonly { distance: number; alertness: number; wind: WindDir }[] = [
    { distance: 30, alertness: 10, wind: "into" },
    { distance: 18, alertness: 40, wind: "cross" },
    { distance: 12, alertness: 70, wind: "with" },
    { distance: 0, alertness: 55, wind: "cross" },
  ];

  it("creepGain／creepAlertGain 与真跑一步的结果逐字一致", () => {
    for (const shape of cases) {
      for (const organs of [[], [ORGAN_JI_ZU], [ORGAN_GOU_CHI]]) {
        const before = withOrgans(stalking(shape), ...organs);
        const preview = stalkPreview(before, QUIET);
        const after = act(before, "creep").state.stalk;
        if (!after) continue;
        expect(after.distance, JSON.stringify({ shape, organs })).toBe(
          (before.stalk?.distance ?? 0) - preview.creepGain,
        );
        expect(after.alertness, JSON.stringify({ shape, organs })).toBe(
          (before.stalk?.alertness ?? 0) + preview.creepAlertGain,
        );
      }
    }
  });

  it("pounceChanceAfterCreep ＝ 潜行一步之后再问 pounceChance", () => {
    for (const shape of cases) {
      const before = stalking(shape);
      const promised = stalkPreview(before, QUIET).pounceChanceAfterCreep;
      const afterCreep = act(before, "creep").state;
      // 潜行本身可能直接收束（警觉满）——那种情况没有「之后」可比
      if (!afterCreep.stalk) continue;
      expect(stalkPreview(afterCreep, QUIET).pounceChance).toBeCloseTo(promised, 10);
    }
  });

  it("警觉贴近上限时，预览的增量按剩余空间截断（不多报那 1〜2 点）", () => {
    const t = QUIET.tuning;
    const brink = stalking({ distance: 30, alertness: t.stalkAlertMax - 2, wind: "with" });
    const preview = stalkPreview(brink, QUIET);
    expect(preview.creepAlertGain).toBe(2);
    expect(preview.circleAlertGain).toBe(2);
    // 真跑一步：警觉封顶（这一步同时会把猎物惊走，所以只对账警觉本身）
    const after = act(brink, "circle").state;
    expect(after.stalk).toBeNull();
    const calm = stalking({ distance: 30, alertness: t.stalkAlertMax - 2 });
    expect(stalkPreview(calm, QUIET).circleAlertGain).toBe(2);
  });

  it("waitAlertDrop／circleAlertGain 与真跑一致", () => {
    const calm = contentWithoutEvents({ tuning: { stalkWaitMoveChance: 0 } });
    for (const shape of cases) {
      const before = stalking(shape, calm);
      const preview = stalkPreview(before, calm);
      const waited = act(before, "wait", calm).state.stalk;
      expect(waited?.alertness).toBe((before.stalk?.alertness ?? 0) - preview.waitAlertDrop);
      const circled = act(before, "circle", calm).state.stalk;
      expect(circled?.alertness).toBe((before.stalk?.alertness ?? 0) + preview.circleAlertGain);
    }
  });

  it("retaliates／staminaLeft／alreadyUpwind 如实反映当前局面", () => {
    const upwind = stalkPreview(stalking({ wind: "into", stamina: 3 }), QUIET);
    expect(upwind.alreadyUpwind).toBe(true);
    expect(upwind.staminaLeft).toBe(3);
    expect(upwind.retaliates).toBe(false);

    const life = createLife(7, FIXTURE_SEED_ID, QUIET);
    const big = stalkPreview(enterStalk(life, ENEMY_QIONG_QI, { wind: "with" }), QUIET);
    expect(big.retaliates).toBe(true);
    expect(big.alreadyUpwind).toBe(false);
  });

  it("预览是纯函数：连问两次结果恒等，且不动入参", () => {
    const before = stalking({ distance: 18, alertness: 44 });
    const snapshot = structuredClone(before);
    expect(stalkPreview(before, QUIET)).toEqual(stalkPreview(before, QUIET));
    expect(before).toEqual(snapshot);
  });
});

describe("器官 tag 决定信息精度（build 差异直接改操作层）", () => {
  it("夜瞳／灵犀之类给精确警觉，别的器官不给", () => {
    const bare = stalking();
    expect(stalkPreview(bare, QUIET).alertVisible).toBe(false);
    // fixture 雾目带 night-eye
    expect(stalkPreview(withOrgans(bare, ORGAN_WU_MU), QUIET).alertVisible).toBe(true);
    expect(stalkPreview(withOrgans(bare, ORGAN_GOU_CHI), QUIET).alertVisible).toBe(false);
  });

  it("风向可见性单独由 stalkWindTags 决定（两种信息可以分开给）", () => {
    const content = contentWithoutEvents({
      tuning: { stalkAlertTags: ["night-eye"], stalkWindTags: ["swift"] },
    });
    const bare = stalking({}, content);
    const seer = stalkPreview(withOrgans(bare, ORGAN_WU_MU), content);
    expect([seer.alertVisible, seer.windVisible]).toEqual([true, false]);
    const runner = stalkPreview(withOrgans(bare, ORGAN_JI_ZU), content);
    expect([runner.alertVisible, runner.windVisible]).toEqual([false, true]);
  });

  /*
   * 这一条是实机跑出来的（P1 实验台）：不记「已绕过」的话，读不出风向的 build 会**一圈接一圈
   * 地绕** —— 每次都不敢断定自己已在上风，6 点体力全花在同一件已经做成的事上，得手率从
   * 74% 掉到 53%，而且玩家**无从察觉自己在浪费回合**（界面没法告诉他「你已经在上风了」）。
   */
  it("亲手绕过一圈之后风向就是确知的（自己做的事自己知道）", () => {
    const blind = stalking({ wind: "with" });
    expect(stalkPreview(blind, QUIET).windVisible).toBe(false);

    const circled = act(blind, "circle").state;
    expect(circled.stalk?.windKnown).toBe(true);
    const after = stalkPreview(circled, QUIET);
    expect(after.windVisible).toBe(true);
    expect(after.alreadyUpwind).toBe(true);

    // 确知位一旦立起来就不会掉（此后风向只可能因为再绕一圈而改变，仍是逆风）
    const crept = act(circled, "creep").state;
    expect(crept.stalk?.windKnown).toBe(true);
  });

  it("起追时风向未确知（除非器官读得出）", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const { state } = performAction(createLife(seed, FIXTURE_SEED_ID, QUIET), "hunt", QUIET);
      expect(state.stalk?.windKnown).toBe(false);
    }
  });

  it("信息 tag 不改任何结算（给的是知情权，不是数值）", () => {
    const bare = stalking({ distance: 18, alertness: 30, wind: "cross" });
    // 雾目只带 night-eye（无 swift／hunter），所以四个量的推进必须逐字相同
    const seer = withOrgans(bare, ORGAN_WU_MU);
    const plainAfter = act(bare, "creep").state.stalk;
    const seerAfter = act(seer, "creep").state.stalk;
    expect(seerAfter?.distance).toBe(plainAfter?.distance);
    expect(seerAfter?.alertness).toBe(plainAfter?.alertness);
    expect(stalkPreview(seer, QUIET).pounceChance).toBe(stalkPreview(bare, QUIET).pounceChance);
  });
});

describe("旁白变体（不复读）", () => {
  it("猎物写了自己那一槽就用它，没写的槽退回引擎兜底", () => {
    const content = contentWithoutEvents({ tuning: NEVER_POUNCE });
    // fixture 野雉只写了 creep／miss 两槽
    expect(act(stalking({ distance: 30 }, content), "creep", content).roundLog.join("")).toContain("【雉】");
    expect(act(stalking({ distance: 2 }, content), "pounce", content).roundLog.join("")).toContain("【雉】");
    // circle 槽没写 → 兜底池
    const circled = act(stalking({ wind: "with" }, content), "circle", content).roundLog.join("");
    expect(circled).not.toContain("【雉】");
    expect(STALK_MESSAGES.circle as readonly string[]).toContain(circled);
  });

  it("兜底池的每条变体都真的会被抽到（不是摆着好看）", () => {
    const calm = contentWithoutEvents({ tuning: { stalkWaitMoveChance: 0 } });
    const said = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      said.add(act(stalking({ alertness: 40 }, calm, seed), "wait", calm).roundLog[0] ?? "");
    }
    expect(said.size).toBe(STALK_MESSAGES.wait.length);
    expect(said.size).toBeGreaterThanOrEqual(2);
  });

  it("引擎兜底池每一槽都 ≥2 条（一场追猎要潜行三四次，一句到底就是复读）", () => {
    for (const [slot, pool] of Object.entries(STALK_MESSAGES)) {
      if (slot === "venom") continue; // 附毒是一世里罕见的一次，允许一条
      expect((pool as readonly string[]).length, `${slot} 只有一条变体`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("纪律", () => {
  it("不在追猎中调 stalkAct／stalkPreview 直接抛错", () => {
    const life = createLife(1, FIXTURE_SEED_ID, QUIET);
    expect(() => stalkAct(life, "creep", QUIET)).toThrow(/不在追猎中/);
    expect(() => stalkPreview(life, QUIET)).toThrow(/不在追猎中/);
  });

  it("已死亡时调 stalkAct 抛错", () => {
    expect(() => act({ ...stalking(), alive: false }, "creep")).toThrow(/已死亡/);
  });

  it("猎物 id 失效时抛错（内容 bug 要吵）", () => {
    const broken = { ...stalking(), stalk: { ...stalking().stalk!, preyId: "no-such-beast" } };
    expect(() => stalkAct(broken, "creep", QUIET)).toThrow(/未知猎物/);
  });

  it("stalkAct 不改动入参 state，同一 state 反复调结果恒等", () => {
    const before = stalking({ distance: 18, alertness: 30 });
    const snapshot = structuredClone(before);
    const first = act(before, "creep");
    const second = act(before, "creep");
    expect(before).toEqual(snapshot);
    expect(first.state).toEqual(second.state);
    expect(first.roundLog).toEqual(second.roundLog);
  });

  it("rngState 每个动作都推进（旁白变体也走种子）", () => {
    const before = stalking({ distance: 30 });
    expect(act(before, "creep").state.rngState).not.toBe(before.rngState);
    expect(act(before, "circle").state.rngState).not.toBe(before.rngState);
  });

  it("追猎全程 records 只在收束时可能新增（狩猎成败不入列传）", () => {
    const content = contentWithoutEvents({ tuning: ALWAYS_POUNCE });
    const before = stalking({ distance: 2 }, content);
    const mid = act(before, "wait", content);
    expect(mid.state.records).toEqual(before.records);
    const done = act(mid.state, "pounce", content);
    expect(done.over).toBe("caught");
    expect(done.state.records).toEqual(before.records);
  });
});

describe("一场追猎打得通（手感的最小验证）", () => {
  /**
   * 逆风稳扎稳打：绕到上风 → 潜到贴身 → 扑。这一条把「计划可以跨回合执行」变成断言：
   * 若哪天数值改到这套打法赢不了，它必须变红 —— 那意味着「有得算」这个设计目标丢了。
   */
  it("绕上风 → 潜到贴身 → 扑：命中率 ≥0.70", () => {
    let state = stalking({ distance: 24, alertness: 18, wind: "with" });
    state = act(state, "circle").state;
    while ((state.stalk?.distance ?? 0) > 0 && state.stalk) {
      const next = act(state, "creep").state;
      if (!next.stalk) break;
      state = next;
    }
    expect(state.stalk).not.toBeNull();
    expect(stalkPreview(state, QUIET).pounceChance).toBeGreaterThanOrEqual(0.7);
  });

  /** 顺风硬冲：不绕风、一路猛潜到贴身 —— 警觉飙升，命中率必须明显更差。 */
  it("顺风硬冲到贴身：命中率 ≤0.50，且明显低于逆风打法", () => {
    let state = stalking({ distance: 24, alertness: 18, wind: "with" });
    while ((state.stalk?.distance ?? 0) > 0 && state.stalk) {
      const next = act(state, "creep").state;
      if (!next.stalk) break;
      state = next;
    }
    if (!state.stalk) return; // 途中就被惊走也算「硬冲失败」
    expect(stalkPreview(state, QUIET).pounceChance).toBeLessThanOrEqual(0.5);
  });

  /** 屏息必须是**算得清收益**的一步棋，不是浪费回合。 */
  it("贴身而警觉高时，屏息一次能把命中率抬回可搏的档位", () => {
    const calm = contentWithoutEvents({ tuning: { stalkWaitMoveChance: 0 } });
    const before = stalking({ distance: 0, alertness: 72 }, calm);
    const beforeChance = stalkPreview(before, calm).pounceChance;
    const after = act(before, "wait", calm).state;
    const afterChance = stalkPreview(after, calm).pounceChance;
    expect(afterChance - beforeChance).toBeCloseTo(
      calm.tuning.stalkWaitAlertDrop * calm.tuning.stalkPouncePerAlert,
      10,
    );
    expect(afterChance - beforeChance).toBeGreaterThanOrEqual(0.08);
  });
});
