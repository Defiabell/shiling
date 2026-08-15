/**
 * [交锋节奏] 一合 ＝ 按先手排序的两个半合（宝可梦式对战）。
 *
 * owner 的原话：「我方一回合，对方一回合，类似宝可梦这种对战的机制」。改版前引擎虽是
 * 回合制，但一次 `combatAct` 把双方动作在同一段 `roundLog` 里一起结算完 —— **先手不存在**
 * （永远是我），于是它也不是一件能争的东西。
 *
 * 这份测试守的是这一批的四条铁律，每一条都对着一个「坏了不会有别的测试变红」的形状：
 *
 * 1. **先手可见可解释** —— 按快慢定序，不掷骰；`combatPreview` 出手**之前**就报得出，
 *    且与真跑用的是同一份（预览与结算若各算各的，屏幕上那句「你先动」迟早会说谎）。
 * 2. **打死不还手** —— 先手方收束了整场，后手那半合**真的不发生**（`beats` 里没有那一拍，
 *    而不是「有一拍但内容为空」）。两个方向各一条：我打死它，以及它打死我。
 * 3. **拍序是数据** —— `roundLog` 由 `beats` 派生，血量前后接得上；客户端照拍播的与
 *    日志里存的不可能对不上。
 * 4. **屏幕上写的都算数** —— 它先动的那些合里，咬腿拦不住逃、换姿态这一合不减伤、
 *    这一咬的眼伤赶不上它那一记，`combatPreview` 三处都要跟着翻面；硬受则从「这一下免伤」
 *    变成「挡下它下一记」，两种先手下都要真的挡到东西。
 *
 * ## 为什么另开一个文件
 * 同 `encounter.test.ts` 的理由：fixture 把几个世界尺度的旋钮调成中性，这份测试反过来
 * **显式**把先手那几个旋钮摆到要测的位置（改敌人的 `speed`、改玩家的灵），
 * 于是每一条测的就是那件事本身。
 */

import { describe, expect, it } from "vitest";
import {
  clashOf,
  combatAct,
  combatPreview,
  createLife,
  type CombatAct,
  type CombatBeat,
  type EnemyDef,
  type TaleContent,
  type TaleState,
} from "../src/index.js";
import {
  ENEMY_QIONG_QI,
  FIXTURE_CONTENT,
  FIXTURE_SEED_ID,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  enterCombat,
  organWithSkill,
  withOrgans,
} from "./fixtures.js";

const BITE = (part: "throat" | "leg" | "eye"): CombatAct => ({ kind: "bite", part });

/** 它护眼、这一合要常规咬一口 —— 于是「咬喉」是没被护住的那一咬。 */
const BITING_FACE = {
  guardPart: "eye" as const,
  intent: { kind: "bite" as const, text: "它向前逼了半步。" },
};

/**
 * 一份把先手摆到确定位置的 content：抖动为 0、概率不夹紧、穷奇的 `speed` 由调用方指定。
 *
 * `speed` 是这一批唯一新加的敌人字段，缺省吃 `encounterEnemySpeedDefault`（12）——
 * 所以每一条测先手的断言都显式给它，不去猜缺省值。
 */
function withEnemySpeed(speed: number, tuning: Partial<TaleContent["tuning"]> = {}): TaleContent {
  return contentWithoutEvents({
    tuning: { combatDamageJitter: 0, ...UNCLAMPED_CHANCE, ...tuning },
    enemies: FIXTURE_CONTENT.enemies.map((enemy: EnemyDef) =>
      enemy.id === ENEMY_QIONG_QI ? { ...enemy, speed } : enemy,
    ),
  });
}

/** 把灵钉到某个值 —— 我方的快慢就读它（`encounterSpeedPerLing` 是 1）。 */
function withLing(state: TaleState, ling: number): TaleState {
  return { ...state, stats: { ...state.stats, ling } };
}

function fighting(
  content: TaleContent,
  ling: number,
  clash: Parameters<typeof enterCombat>[3] = {},
  shell: Parameters<typeof enterCombat>[4] = {},
): TaleState {
  const born = withLing(createLife(1, FIXTURE_SEED_ID, content), ling);
  return enterCombat(born, ENEMY_QIONG_QI, content, {
    enemyHp: 400,
    ...BITING_FACE,
    ...clash,
  }, shell);
}

const sides = (beats: readonly CombatBeat[]): string[] => beats.map((beat) => beat.side);

/**
 * 把意图池钉成「恒守」。
 *
 * `intent` 只钉得住**开局那一张脸** —— `rollFace` 每合末重摇一次。要让它连守几合，
 * 得从权重上钉（同 `encounter.test.ts` 的 `calm()`）。
 */
function alwaysGuarding(content: TaleContent): TaleContent {
  return contentWithoutEvents({
    tuning: content.tuning,
    // organs 要原样带过去 —— `contentWithoutEvents` 对没传的字段一律退回 FIXTURE_CONTENT，
    // 而调用方那份 content 里正装着这一条测试要用的技
    organs: content.organs,
    enemies: content.enemies.map((enemy: EnemyDef) => ({
      ...enemy,
      intentBias: { pounce: 0, bite: 0, guard: 1, flee: 0 },
      // 行为段自带 intentBias 覆写 —— 一起清掉，否则血线一降它又开始出手
      ...(enemy.stages ? { stages: undefined } : {}),
    })),
  });
}

// ===== 一、先手：按快慢定序，不掷骰 =====

describe("[交锋节奏] 先手：谁先动，以及为什么", () => {
  it("我更快 → 我先动；它更快 → 它先动（同一状态只差一个 speed）", () => {
    const fast = withEnemySpeed(6);
    const slow = withEnemySpeed(30);
    expect(combatAct(fighting(fast, 20), BITE("throat"), fast).initiative.first).toBe("player");
    expect(combatAct(fighting(slow, 20), BITE("throat"), slow).initiative.first).toBe("enemy");
  });

  it("同速归玩家 —— 取整的好处给有利的那一边（这一条是刻意的，不是巧合）", () => {
    const content = withEnemySpeed(17);
    const turn = combatAct(fighting(content, 17), BITE("throat"), content);
    expect(turn.initiative.playerSpeed).toBe(17);
    expect(turn.initiative.enemySpeed).toBe(17);
    expect(turn.initiative.first).toBe("player");
    expect(sides(turn.beats).slice(0, 2)).toEqual(["player", "enemy"]);
  });

  it("先手**不掷骰**：同一局面连问两次，答案与两个速度都逐字相同", () => {
    const content = withEnemySpeed(19);
    const state = fighting(content, 14);
    const a = combatPreview(state, content).initiative;
    const b = combatPreview(state, content).initiative;
    expect(a).toEqual(b);
    expect(a.first).toBe("enemy");
  });

  it("**拆它的腿就抢得回先手** —— 咬腿的第三样用处，每层压 `encounterSpeedPerLegWound`", () => {
    const content = withEnemySpeed(20);
    const t = content.tuning;
    const bare = combatPreview(fighting(content, 14), content).initiative;
    expect(bare.first).toBe("enemy");
    expect(bare.enemySpeed).toBe(20);

    const oneLeg = combatPreview(
      fighting(content, 14, {}, { wounds: { throat: 0, leg: 1, eye: 0 } }),
      content,
    ).initiative;
    expect(oneLeg.enemySpeed).toBe(20 - t.encounterSpeedPerLegWound);
    expect(oneLeg.enemyLegPenalty).toBe(t.encounterSpeedPerLegWound);
    // 一层还不够（20−4 ＝ 16 > 14），两层就够了 —— 这正是「经营一条线」该有的形状
    expect(oneLeg.first).toBe("enemy");

    const twoLegs = combatPreview(
      fighting(content, 14, {}, { wounds: { throat: 0, leg: 2, eye: 0 } }),
      content,
    ).initiative;
    expect(twoLegs.enemySpeed).toBe(20 - 2 * t.encounterSpeedPerLegWound);
    expect(twoLegs.first).toBe("player");
  });

  it("迟滞也压它的快慢（附毒／咬腿那一档的即时收益）", () => {
    const content = withEnemySpeed(16);
    const t = content.tuning;
    const slowed = combatPreview(fighting(content, 14, { slow: 2 }), content).initiative;
    expect(slowed.enemySlowPenalty).toBe(t.encounterSpeedSlowPenalty);
    expect(slowed.enemySpeed).toBe(16 - t.encounterSpeedSlowPenalty);
    expect(slowed.first).toBe("player");
  });

  it("被拆到走不动也不会归零（下限 1），而报出来的两笔扣减加得起来", () => {
    const content = withEnemySpeed(5);
    const init = combatPreview(
      fighting(content, 30, { slow: 2 }, { wounds: { throat: 0, leg: 3, eye: 0 } }),
      content,
    ).initiative;
    expect(init.enemySpeed).toBe(1);
    expect(init.enemyBaseSpeed - init.enemyLegPenalty - init.enemySlowPenalty).toBe(1);
  });

  it("**预览与真跑是同一份先手**（屏幕上摆着的那个标记就是这一合真的顺序）", () => {
    for (const speed of [4, 12, 18, 26]) {
      const content = withEnemySpeed(speed);
      const state = fighting(content, 15);
      const previewed = combatPreview(state, content).initiative;
      const turn = combatAct(state, BITE("throat"), content);
      expect(turn.initiative).toEqual(previewed);
      expect(turn.beats[0]?.side).toBe(previewed.first);
    }
  });

  it("玩家按哪一颗按钮**不改**先手 —— 屏上那个标记不会被自己的选择推翻", () => {
    const content = withEnemySpeed(24);
    const state = fighting(content, 12);
    const acts: CombatAct[] = [BITE("throat"), BITE("leg"), { kind: "stance", to: "low" }];
    for (const act of acts) {
      expect(combatAct(state, act, content).initiative.first).toBe("enemy");
    }
  });
});

// ===== 二、打死不还手（这一批的灵魂） =====

describe("[交锋节奏] 打死不还手：后手那半合真的不发生", () => {
  it("我一记打死它 → `beats` 里只有我那一拍，它那一拍**不在数组里**", () => {
    const content = withEnemySpeed(6);
    const state = fighting(content, 20, { enemyHp: 1 });
    const turn = combatAct(state, BITE("throat"), content);
    expect(turn.over).toBe("win");
    expect(sides(turn.beats)).toEqual(["player"]);
    expect(turn.beats.every((beat) => beat.move.kind !== "enemyAct")).toBe(true);
  });

  it("它一记打死我 → 只有它那一拍，而**我的动作一点都没结算**（它血一滴没掉）", () => {
    // 它极快（先手在它）、必中必伤；我方血只剩 1 —— 它那一记就收场
    const content = withEnemySpeed(40, { combatDamageJitter: 0 });
    const state = fighting(content, 10, {
      playerHp: 1,
      enemyHp: 400,
      intent: { kind: "pounce", text: "它压低身子。" },
    });
    const turn = combatAct(state, BITE("throat"), content);
    expect(turn.over).toBe("dead");
    expect(sides(turn.beats)).toEqual(["enemy"]);
    // 「不还手」不是「还了手但不算数」：它的血必须与出手前逐字相同
    const before = clashOf(state)?.enemyHp;
    expect(turn.beats[0]?.enemyHp).toBe(before);
    expect(turn.state.alive).toBe(false);
  });

  it("它先动却没能收场 → 两拍都在，顺序是「它、我」", () => {
    const content = withEnemySpeed(40);
    const turn = combatAct(fighting(content, 10), BITE("throat"), content);
    expect(turn.over).toBeNull();
    expect(sides(turn.beats).slice(0, 2)).toEqual(["enemy", "player"]);
  });

  it("它先动把自己走掉了（逃成功）→ 我那一拍也不发生", () => {
    const content = withEnemySpeed(40);
    const state = fighting(content, 10, {
      intent: { kind: "flee", text: "它掉头就走。" },
    });
    const turn = combatAct(state, BITE("leg"), content);
    expect(turn.over).toBe("escaped");
    expect(sides(turn.beats)).toEqual(["enemy"]);
    // 咬腿这一手没有发生 —— 所以它身上也不该多一层腿伤
    expect(turn.state.encounter).toBeNull();
  });

  /*
   * 下面两条锁的是**两位 reviewer 各自独立复现出来的那个 Critical**。
   *
   * 我方半合里唯一能把自己打死的东西是**反咬**（咬中它护着的地方）。改版前它只被敌方
   * 半合「出手」那一支顺手兜住 —— 于是「它守着／要走／打空」的那些合里根本没人问过
   * 我死没死，留下的是一个「活着、血为负、遭遇不收束」的状态。改版把我方半合挪到后面
   * 之后，那条路从边角变成常态。两个方向各锁一条。
   */
  it("反咬把我打死（我先动）→ 它那一拍不发生，且**真的判成死**", () => {
    const content = withEnemySpeed(6, { combatGuardCounterChance: 1 });
    const state = fighting(content, 20, {
      playerHp: 1,
      guardPart: "throat",
      // 它这一合在守 —— 改版前正是这一支把「我被反咬打死」漏了过去
      intent: { kind: "guard", text: "它守。" },
    });
    const turn = combatAct(state, BITE("throat"), content);
    expect(turn.over).toBe("dead");
    expect(sides(turn.beats)).toEqual(["player"]);
    expect(turn.state.alive).toBe(false);
    // 遭遇收束了 —— 不留一个「血为负却还在打」的状态
    expect(turn.state.encounter).toBeNull();
  });

  it("反咬把我打死（**它先动，我是最后一拍**）→ 照样判得出死", () => {
    const content = withEnemySpeed(40, { combatGuardCounterChance: 1 });
    const state = fighting(content, 10, {
      playerHp: 40,
      guardPart: "throat",
      intent: { kind: "guard", text: "它守。" },
    });
    // 它先动（在守，不出伤）→ 我咬它护着的喉 → 反咬。把血压到 1 才走得到那一步
    const low = {
      ...state,
      encounter: { ...state.encounter!, clash: { ...clashOf(state)!, playerHp: 1 } },
    };
    const turn = combatAct(low, BITE("throat"), content);
    expect(sides(turn.beats)).toEqual(["enemy", "player"]);
    expect(turn.over).toBe("dead");
    expect(turn.state.alive).toBe(false);
    expect(turn.state.encounter).toBeNull();
  });

  it("这一咬打死它、而反咬同时把我打空 —— **那也是一场胜**（与改版前逐字相同）", () => {
    const content = withEnemySpeed(6, { combatGuardCounterChance: 1 });
    const state = fighting(content, 20, {
      enemyHp: 1,
      playerHp: 1,
      guardPart: "throat",
      intent: { kind: "guard", text: "它守。" },
    });
    const turn = combatAct(state, BITE("throat"), content);
    expect(turn.over).toBe("win");
    expect(turn.state.alive).toBe(true);
  });

  it("我先动而它要逃 → 咬腿照旧拦得住（改版**没有**削掉咬腿的老用处）", () => {
    const content = withEnemySpeed(6);
    const state = fighting(content, 20, {
      intent: { kind: "flee", text: "它掉头就走。" },
    });
    const turn = combatAct(state, BITE("leg"), content);
    expect(turn.over).toBeNull();
    expect(sides(turn.beats).slice(0, 2)).toEqual(["player", "enemy"]);
    expect(turn.roundLog.join("")).toContain("没走成");
  });
});

// ===== 三、拍序是数据：日志由它派生，血量接得上 =====

describe("[交锋节奏] 拍序：客户端照它逐拍播，日志由它派生", () => {
  it("`roundLog` 逐字等于 `beats` 的旁白拼接（一条日志只有一个来源）", () => {
    const content = withEnemySpeed(30);
    let state = fighting(content, 14);
    for (let i = 0; i < 6; i += 1) {
      const turn = combatAct(state, BITE("throat"), content);
      expect(turn.roundLog).toEqual(turn.beats.flatMap((beat) => beat.lines));
      if (turn.over !== null) break;
      state = turn.state;
    }
  });

  it("每一拍带得出招牌：我方那一拍是我按的那颗，它那一拍是它宣告过的意图", () => {
    const content = withEnemySpeed(6);
    const state = fighting(content, 20, {
      intent: { kind: "pounce", text: "它压低身子。" },
    });
    const turn = combatAct(state, BITE("leg"), content);
    expect(turn.beats[0]?.move).toEqual({ kind: "bite", part: "leg" });
    expect(turn.beats[1]?.move).toEqual({ kind: "enemyAct", intent: "pounce" });
  });

  it("技那一拍带着招名（客户端要拿它做招牌，不许去解析日志字符串）", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, ...UNCLAMPED_CHANCE, encounterSkillMomentumCost: 0 },
      organs: [...FIXTURE_CONTENT.organs, organWithSkill("po-jia", "破甲", [])],
    });
    const state = withOrgans(fighting(content, 20), "po-jia");
    const turn = combatAct(state, { kind: "skill", skillId: "po-jia" }, content);
    expect(turn.beats[0]?.move).toEqual({ kind: "skill", skillId: "po-jia", name: "破甲" });
  });

  it("血量前后接得上：上一拍的终点就是下一拍的起点（血条动画的起止值）", () => {
    const content = withEnemySpeed(30);
    let state = fighting(content, 14);
    for (let round = 0; round < 5; round += 1) {
      const turn = combatAct(state, BITE("throat"), content);
      const clash = clashOf(state);
      expect(turn.beats[0]?.enemyHpBefore).toBe(clash?.enemyHp);
      expect(turn.beats[0]?.playerHpBefore).toBe(clash?.playerHp);
      turn.beats.forEach((beat, i) => {
        const prev = turn.beats[i - 1];
        if (prev) {
          expect(beat.enemyHpBefore).toBe(prev.enemyHp);
          expect(beat.playerHpBefore).toBe(prev.playerHp);
        }
        expect(beat.toEnemy).toBe(Math.max(0, beat.enemyHpBefore - beat.enemyHp));
        expect(beat.toPlayer).toBe(Math.max(0, beat.playerHpBefore - beat.playerHp));
      });
      if (turn.over !== null) break;
      state = turn.state;
    }
  });

  it("`over` 只落在最后一拍上（收束之后不该再有拍）", () => {
    const content = withEnemySpeed(6);
    const turn = combatAct(fighting(content, 20, { enemyHp: 1 }), BITE("throat"), content);
    expect(turn.beats.at(-1)?.over).toBe("win");
    expect(turn.beats.slice(0, -1).every((beat) => beat.over === null)).toBe(true);
  });

  it("被护住招来的反咬记在**我方那一拍**里（那是这一咬的后果，不是它的半合）", () => {
    const content = withEnemySpeed(6, { combatGuardCounterChance: 1 });
    const state = fighting(content, 20, {
      guardPart: "throat",
      intent: { kind: "guard", text: "它守。" },
    });
    const turn = combatAct(state, BITE("throat"), content);
    expect(turn.beats[0]?.side).toBe("player");
    expect(turn.beats[0]?.toPlayer).toBeGreaterThan(0);
    // 它那一拍是「守」—— 它没有伤到我，伤我的是反咬
    expect(turn.beats[1]?.move).toEqual({ kind: "enemyAct", intent: "guard" });
    expect(turn.beats[1]?.toPlayer).toBe(0);
  });

  it("回合末那一拍**有事才有**：平平无事的一合只有两拍，流血那一合多一拍", () => {
    const calm = withEnemySpeed(6);
    expect(sides(combatAct(fighting(calm, 20), BITE("throat"), calm).beats)).toEqual([
      "player",
      "enemy",
    ]);

    const bleeding = withEnemySpeed(6);
    const turn = combatAct(fighting(bleeding, 20, { bleed: 3 }), BITE("throat"), bleeding);
    expect(sides(turn.beats)).toEqual(["player", "enemy", "round"]);
    expect(turn.beats[2]?.move).toEqual({ kind: "round" });
    expect(turn.beats[2]?.toEnemy).toBeGreaterThan(0);
  });
});

// ===== 四、屏幕上写的都算数（预览跟着先手翻面） =====

describe("[交锋节奏] 它先动的那些合里，三处预览必须跟着翻面", () => {
  it("咬腿**拦不住**它先动那一合的逃 —— 那句「拦住它」不许出现", () => {
    const fleeFace = { intent: { kind: "flee" as const, text: "它掉头就走。" } };
    const mine = withEnemySpeed(6);
    const theirs = withEnemySpeed(40);
    const legOf = (content: TaleContent, ling: number) =>
      combatPreview(fighting(content, ling, fleeFace), content).bites.find(
        (bite) => bite.part === "leg",
      );
    expect(legOf(mine, 20)?.stopsFlee).toBe(true);
    expect(legOf(theirs, 10)?.stopsFlee).toBe(false);
  });

  it("换姿态在它先动的合里**这一合不减伤** —— 按钮上那个数按现在的架势给", () => {
    const content = withEnemySpeed(40);
    const preview = combatPreview(fighting(content, 10), content);
    const current = preview.stances.find((item) => item.current);
    for (const item of preview.stances) {
      expect(item.incomingIfSwitch).toEqual(current?.incomingIfSwitch);
    }
    // 对照：我先动时它们必须**分得开**（否则上面那条测的是「三个数恒相等」这件蠢事）
    const mine = withEnemySpeed(6);
    const ours = combatPreview(fighting(mine, 20), mine);
    const spread = new Set(ours.stances.map((item) => item.incomingIfSwitch.mid));
    expect(spread.size).toBeGreaterThan(1);
  });

  it("这一咬留下的眼伤在它先动的合里赶不上它那一记（打空率不许预支）", () => {
    const content = withEnemySpeed(40, { woundEyeMissChance: 0.3 });
    const preview = combatPreview(fighting(content, 10), content);
    const eye = preview.bites.find((bite) => bite.part === "eye");
    expect(eye?.woundLands).toBe(true);
    expect(eye?.incomingAfterMissChance).toBe(preview.incomingMissChance);

    const mine = withEnemySpeed(6, { woundEyeMissChance: 0.3 });
    const ours = combatPreview(fighting(mine, 20), mine);
    const eyeMine = ours.bites.find((bite) => bite.part === "eye");
    expect(eyeMine?.incomingAfterMissChance).toBeGreaterThan(ours.incomingMissChance);
  });
});

// ===== 五、硬受：从「这一下免伤」变成「挡下它的下一记」 =====

describe("[交锋节奏] 硬受：两种先手下都要真的挡到东西", () => {
  /** 一件只带 `brace` 的技（零代价、零冷却门槛），好让测试只量硬受这一件事。 */
  function braceContent(speed: number): TaleContent {
    return contentWithoutEvents({
      tuning: {
        combatDamageJitter: 0,
        ...UNCLAMPED_CHANCE,
        encounterSkillMomentumCost: 0,
        // 闪避关掉：这一组量的是「硬受挡没挡到」，不是德那一档
        combatDodgePerDe: 0,
      },
      organs: [...FIXTURE_CONTENT.organs, organWithSkill("he-lin", "合鳞", ["brace"])],
      enemies: FIXTURE_CONTENT.enemies.map((enemy: EnemyDef) =>
        enemy.id === ENEMY_QIONG_QI ? { ...enemy, speed } : enemy,
      ),
    });
  }
  const POUNCE = { intent: { kind: "pounce" as const, text: "它压低身子。" } };
  const BRACE: CombatAct = { kind: "skill", skillId: "he-lin" };

  it("我先动 → 挡的是**这一合**它那一记（与改版前逐字相同）", () => {
    const content = braceContent(6);
    const state = withOrgans(fighting(content, 20, POUNCE), "he-lin");
    const turn = combatAct(state, BRACE, content);
    expect(sides(turn.beats).slice(0, 2)).toEqual(["player", "enemy"]);
    expect(turn.beats[1]?.toPlayer).toBe(0);
    // 挡完就消耗掉 —— 它挡的是一记，不是一段时间
    expect(clashOf(turn.state)?.brace).toBe(0);
  });

  it("它先动 → 这一记已经挨过了，硬受**留着**挡它下一记", () => {
    const content = braceContent(40);
    const state = withOrgans(fighting(content, 10, POUNCE), "he-lin");
    const first = combatAct(state, BRACE, content);
    expect(sides(first.beats).slice(0, 2)).toEqual(["enemy", "player"]);
    // 这一合照样挨了（屏幕上没有许诺挡得住这一记）
    expect(first.beats[0]?.toPlayer).toBeGreaterThan(0);
    // 但它没有白按：盾留到了下一合
    expect(clashOf(first.state)?.brace).toBeGreaterThan(0);

    const next = combatAct(
      { ...first.state, encounter: { ...first.state.encounter!, clash: { ...clashOf(first.state)!, ...POUNCE } } },
      BITE("throat"),
      content,
    );
    const enemyBeat = next.beats.find((beat) => beat.side === "enemy");
    expect(enemyBeat?.toPlayer).toBe(0);
    expect(clashOf(next.state)?.brace).toBe(0);
  });

  it("**它这几合都在守 → 盾一直等着**（有回合预算的那一版会在这里空过期）", () => {
    // 意图池钉成「恒守」—— 否则 `rollFace` 每合重摇，第二合它就出手了，这一条就测不到
    const content = alwaysGuarding(braceContent(6));
    const GUARD = { intent: { kind: "guard" as const, text: "它守。" } };
    let state = withOrgans(fighting(content, 20, GUARD), "he-lin");
    state = combatAct(state, BRACE, content).state;
    expect(clashOf(state)?.brace).toBeGreaterThan(0);
    // 它守三合 —— 盾一记都没挡到，但也一点都没少
    for (let i = 0; i < 3; i += 1) {
      state = combatAct(state, BITE("throat"), content).state;
      expect(clashOf(state)?.brace).toBeGreaterThan(0);
    }
    // 它终于出手那一合，盾才兑现并消耗掉
    const swings = {
      ...state,
      encounter: { ...state.encounter!, clash: { ...clashOf(state)!, ...POUNCE } },
    };
    const turn = combatAct(swings, BITE("throat"), content);
    expect(turn.beats.find((beat) => beat.side === "enemy")?.toPlayer).toBe(0);
    expect(clashOf(turn.state)?.brace).toBe(0);
  });

  it("硬受在预览里读得出来（看不见的状态等于不存在）", () => {
    const content = braceContent(6);
    const state = withOrgans(fighting(content, 20, POUNCE), "he-lin");
    const after = combatAct(state, BRACE, content).state;
    expect(combatPreview(after, content).brace).toBe(clashOf(after)?.brace);
  });
});
