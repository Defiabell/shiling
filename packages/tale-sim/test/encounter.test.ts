/**
 * [M2-B1] 遭遇统一 ＋ 战斗加深。
 *
 * 这份测试守的是 B1 那五项交付线各自的**结构**，而不是某一个数：
 *
 * 1. **统一遭遇流程** —— 三条来路（起追／遇袭／事件冲突）进同一个状态位、同一条日志；
 *    接近转交锋是**换阶段**而不是另起一场（势、部位伤、日志一路带过去）。
 * 2. **势** —— 每合自涨、乘隙与不挨伤各多涨一点；技与决杀是它唯一的去处。
 * 3. **部位伤整场累积** —— 断腿／废眼是一劳永逸的事，不随回合衰减。
 * 4. **敌人多段行为与弱点** —— 血线换打法（当场宣告）；弱点三条识破路径，识破后无视守备。
 * 5. **四属性可见落点** —— `encounterPreview().stats` 逐项给得出数（界面照它念）。
 *
 * ## 为什么这些不能写在 `combat.test.ts` 里
 * fixture 把五个**世界尺度**的旋钮调成了中性（见 `FIXTURE_TUNING` 的注释），好让那两百多条
 * 既有断言测的是它们要测的公式。这份测试反过来：每一条都**显式**把要测的那个旋钮打开，
 * 于是它测的就是那个旋钮本身。
 */

import { describe, expect, it } from "vitest";
import {
  approachOf,
  clashOf,
  combatAct,
  combatPreview,
  createLife,
  encounterPreview,
  performAction,
  stalkAct,
  type CombatAct,
  type EnemyDef,
  type TaleContent,
  type TaleState,
} from "../src/index.js";
import {
  ALWAYS_POUNCE,
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  ORGAN_JI_ZU,
  FIXTURE_CONTENT,
  FIXTURE_SEED_ID,
  NEVER_POUNCE,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  enterCombat,
  organWithSkill,
  enterStalk,
  makeContent,
} from "./fixtures.js";

const BITE = (part: "throat" | "leg" | "eye"): CombatAct => ({ kind: "bite", part });
const FINISH: CombatAct = { kind: "finisher" };

/** 关掉事件、抖动为 0、意图钉成「守」（它不出手 → 只量我方那一半）。 */
function calm(tuning: Partial<TaleContent["tuning"]> = {}): TaleContent {
  return contentWithoutEvents({
    tuning: { combatDamageJitter: 0, ...tuning },
    enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
      ...enemy,
      intentBias: { pounce: 0, bite: 0, guard: 1, flee: 0 },
    })),
  });
}

/**
 * 摆一场交锋。缺省它**在守**（不出手）—— 于是每一条断言量的是我方那一半，
 * 不必先在脑子里减掉它这一下（要它出手的测试各自显式传 intent）。
 */
function fighting(
  content: TaleContent,
  clash: Parameters<typeof enterCombat>[3] = {},
  shell: Parameters<typeof enterCombat>[4] = {},
  seed = 1,
): TaleState {
  return enterCombat(
    createLife(seed, FIXTURE_SEED_ID, content),
    ENEMY_QIONG_QI,
    content,
    { enemyHp: 400, guardPart: "eye", intent: { kind: "guard", text: "守。" }, ...clash },
    shell,
  );
}

/** 探索必遇袭的 content —— 「远地」是 fixture 里唯一有 `denizens` 的去处（要疾足才进得去）。 */
function ambushEverywhere(base: TaleContent): TaleContent {
  return makeContent({
    ...base,
    tuning: {
      ...base.tuning,
      explorePeril: {
        calm: { ambushChance: 1, travelCost: 0, eventMul: 1 },
        wary: { ambushChance: 1, travelCost: 6, eventMul: 1 },
        grim: { ambushChance: 1, travelCost: 12, eventMul: 1 },
      },
    },
  });
}

/** 带疾足（远地的门槛器官）降世 —— 遇袭测试都从这儿出发。 */
function scout(content: TaleContent, seed = 5, extra: { loreEnemyIds?: string[] } = {}): TaleState {
  const born = createLife(seed, FIXTURE_SEED_ID, content, extra);
  return { ...born, organIds: [...born.organIds, ORGAN_JI_ZU] };
}

// ===== 一、统一遭遇流程 =====

describe("[M2-B1] 统一遭遇流程：一个状态位、一个入口、两个阶段", () => {
  it("三条来路都落进同一个 `encounter`，各自带着自己的 origin", () => {
    // ① 起追（hunt）
    const hunting = performAction(
      createLife(3, FIXTURE_SEED_ID, contentWithoutEvents()),
      "hunt",
      contentWithoutEvents(),
    ).state;
    expect(hunting.encounter?.origin).toBe("hunt");
    expect(hunting.encounter?.phase).toBe("approach");

    // ② 事件冲突（event）：fixture 里有一条 startCombat 的事件路径，这里直接用状态构造断言形状
    const evented = enterCombat(createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT), ENEMY_QIONG_QI);
    expect(evented.encounter?.origin).toBe("event");
    expect(evented.encounter?.phase).toBe("clash");

    // ③ 遇袭（ambush）：探索必遇袭的 content
    const ambushy = ambushEverywhere(contentWithoutEvents());
    const jumped = performAction(scout(ambushy), "explore", ambushy, {
      destinationId: "dest-far",
    }).state;
    expect(jumped.encounter?.origin).toBe("ambush");
    expect(jumped.encounter?.phase).toBe("clash");
  });

  it("被扑个正着（ambush）要扣起手势 —— 「它先动的手」落在数上", () => {
    const make = (penalty: number): TaleContent =>
      ambushEverywhere(
        contentWithoutEvents({
          tuning: {
            encounterMomentumStartPerLing: 1,
            encounterAmbushMomentumPenalty: penalty,
            encounterMomentumBase: 99,
          },
        }),
      );
    /*
     * 两边都走**真的入口**（`performAction → rollAmbush → beginEncounter`）：只把罚金拨掉。
     * 拿 fixture 手搭的 event 遭遇去对比是不作数的 —— 那一份的 momentum 是测试自己写死的 0。
     */
    const withToll = make(2);
    const noToll = make(0);
    const jumped = performAction(scout(withToll), "explore", withToll, {
      destinationId: "dest-far",
    }).state;
    const free = performAction(scout(noToll), "explore", noToll, {
      destinationId: "dest-far",
    }).state;
    expect(jumped.encounter?.origin).toBe("ambush");
    expect(free.encounter?.momentum).toBe(free.stats.ling);
    expect(jumped.encounter?.momentum).toBe(Math.max(0, jumped.stats.ling - 2));
  });

  it("接近转交锋是**换阶段**：同一个 encounter，日志接着写、部位伤与势带过去", () => {
    const content = contentWithoutEvents({
      tuning: { ...NEVER_POUNCE, encounterApproachMomentumPerAlert: 10 },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) =>
        enemy.id === ENEMY_YE_ZHI ? { ...enemy, retaliates: true } : enemy,
      ),
    });
    const before = enterStalk(
      createLife(1, FIXTURE_SEED_ID, content),
      ENEMY_YE_ZHI,
      { distance: 0, alertness: 0 },
      content,
    );
    const logBefore = before.encounter?.log.length ?? 0;
    const turn = stalkAct(before, "pounce", content);
    expect(turn.over).toBe("combat");
    const after = turn.state.encounter;
    // 还是同一场遭遇（没有被置 null 再新建），只是 phase 换了
    expect(after?.enemyId).toBe(ENEMY_YE_ZHI);
    expect(after?.origin).toBe("hunt");
    expect(after?.phase).toBe("clash");
    expect(after?.approach).toBeNull();
    expect(after?.clash).not.toBeNull();
    // 日志是同一条：接近那几息还在，后面接着写
    expect(after?.log.length).toBeGreaterThan(logBefore);
    // 警觉 0（潜到极近才失手）→ 结转满额的势
    expect(after?.momentum).toBeGreaterThan(0);
    expect(after?.log.join("")).toContain("还留着一股势");
  });

  it("潜得越糟，转交锋时带的势越少（接近的取舍**真的**影响交锋）", () => {
    const content = contentWithoutEvents({
      tuning: { ...NEVER_POUNCE, encounterApproachMomentumPerAlert: 20 },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) =>
        enemy.id === ENEMY_YE_ZHI ? { ...enemy, retaliates: true } : enemy,
      ),
    });
    const momentumAfterPounce = (alertness: number): number => {
      const state = enterStalk(
        createLife(1, FIXTURE_SEED_ID, content),
        ENEMY_YE_ZHI,
        { distance: 0, alertness },
        content,
      );
      return stalkAct(state, "pounce", content).state.encounter?.momentum ?? -1;
    };
    expect(momentumAfterPounce(0)).toBeGreaterThan(momentumAfterPounce(80));
  });

  it("遭遇未收束时 performAction 一律拒绝，且报得出卡在哪个阶段", () => {
    const content = contentWithoutEvents();
    const hunting = performAction(createLife(3, FIXTURE_SEED_ID, content), "hunt", content).state;
    expect(() => performAction(hunting, "rest", content)).toThrow(/approach/);
    const clash = enterCombat(createLife(1, FIXTURE_SEED_ID, content), ENEMY_QIONG_QI, content);
    expect(() => performAction(clash, "rest", content)).toThrow(/clash/);
  });

  it("死亡清掉整场遭遇（两个阶段一起），不留半场悬空的架", () => {
    const content = calm({ ...UNCLAMPED_CHANCE, combatIntentDamageMul: { pounce: 99, bite: 99, guard: 99, flee: 0 } });
    const state = fighting(content, { playerHp: 1, intent: { kind: "bite", text: "咬。" } });
    const turn = combatAct(state, BITE("throat"), content);
    expect(turn.over).toBe("dead");
    expect(turn.state.encounter).toBeNull();
  });
});

// ===== 二、势 =====

describe("[M2-B1] 势：每合攒、强招花，出招节奏成为决策", () => {
  const T = { encounterMomentumPerRound: 1, encounterMomentumOpenGuard: 1, encounterMomentumUnhurt: 1 };

  it("咬中它**没护着**的地方多攒一点势（乘隙）", () => {
    const content = calm(T);
    const open = combatAct(fighting(content, { guardPart: "eye" }), BITE("throat"), content).state;
    const onGuard = combatAct(fighting(content, { guardPart: "throat" }), BITE("throat"), content).state;
    // 它这一合在守（不出手），所以两边都吃到「没挨伤」那一点；差的就是乘隙那一点
    expect(open.encounter?.momentum).toBe((onGuard.encounter?.momentum ?? 0) + 1);
  });

  it("它伤到我时不给「没挨伤」那一点", () => {
    const hitting = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, ...T },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
        ...enemy,
        intentBias: { pounce: 0, bite: 1, guard: 0, flee: 0 },
      })),
    });
    const hurt = combatAct(
      fighting(hitting, { guardPart: "eye", intent: { kind: "bite", text: "咬。" } }),
      BITE("throat"),
      hitting,
    ).state;
    const safe = combatAct(
      fighting(calm(T), { guardPart: "eye", intent: { kind: "guard", text: "守。" } }),
      BITE("throat"),
      calm(T),
    ).state;
    expect(hurt.encounter?.momentum).toBeLessThan(safe.encounter?.momentum ?? 99);
  });

  it("势有上限，且上限随灵性涨（灵性 build 攒得起更大的一手）", () => {
    const content = calm({ encounterMomentumBase: 4, encounterMomentumMaxPerLing: 10 });
    const base = createLife(1, FIXTURE_SEED_ID, content);
    const dull = enterCombat({ ...base, stats: { ...base.stats, ling: 0 } }, ENEMY_QIONG_QI, content);
    const bright = enterCombat({ ...base, stats: { ...base.stats, ling: 40 } }, ENEMY_QIONG_QI, content);
    expect(encounterPreview(dull, content).momentumMax).toBe(4);
    expect(encounterPreview(bright, content).momentumMax).toBe(8);
    // 攒满之后不再涨（上限是真的）
    let state = enterCombat(
      { ...base, stats: { ...base.stats, ling: 0 } },
      ENEMY_QIONG_QI,
      content,
      { enemyHp: 400, guardPart: "eye" },
    );
    for (let i = 0; i < 8; i += 1) state = combatAct(state, BITE("throat"), content).state;
    expect(state.encounter?.momentum).toBe(4);
  });

  it("势不够时技能不可用，且**原因与冷却／代价分得开**", () => {
    const content = calm({ encounterSkillMomentumCost: 3 });
    const armed = makeContent({
      ...content,
      organs: [...content.organs, organWithSkill("big", "大招", [], 1, { momentum: 3 })],
      tuning: content.tuning,
      enemies: content.enemies,
      events: content.events,
    });
    const base = createLife(1, FIXTURE_SEED_ID, armed);
    const poor = enterCombat(
      { ...base, organIds: [...base.organIds, "big"] },
      ENEMY_QIONG_QI,
      armed,
      { enemyHp: 400, guardPart: "eye" },
      { momentum: 1 },
    );
    const skill = combatPreview(poor, armed).skills.find((entry) => entry.skillId === "big");
    expect(skill?.momentumCost).toBe(3);
    expect(skill?.hasMomentum).toBe(false);
    expect(skill?.ready).toBe(false);
    // 冷却与代价都是好的 —— 不可用的原因只有势这一条
    expect(skill?.cooldownLeft).toBe(0);
    expect(skill?.affordable).toBe(true);
    expect(() => combatAct(poor, { kind: "skill", skillId: "big" }, armed)).toThrow(/势/);

    const rich = enterCombat(
      { ...base, organIds: [...base.organIds, "big"] },
      ENEMY_QIONG_QI,
      armed,
      { enemyHp: 400, guardPart: "eye" },
      { momentum: 3 },
    );
    expect(combatPreview(rich, armed).skills.find((entry) => entry.skillId === "big")?.ready).toBe(true);
    // 放完之后势被扣掉（回合末的自涨照常，所以只断言「比放之前少」）
    const after = combatAct(rich, { kind: "skill", skillId: "big" }, armed).state;
    expect(after.encounter?.momentum).toBeLessThan(3 + 2);
  });

  it("决杀：攒够才出得来，吃掉全部的势，且伤害随攒到的势变重", () => {
    const content = calm({ encounterFinisherMomentum: 4, encounterFinisherMul: 1, encounterFinisherPerMomentum: 0.5 });
    const cold = fighting(content, {}, { momentum: 3, momentumMax: 9 });
    expect(combatPreview(cold, content).finisher.ready).toBe(false);
    expect(() => combatAct(cold, FINISH, content)).toThrow(/势/);

    const damageAt = (momentum: number): number => {
      const state = fighting(content, {}, { momentum, momentumMax: 9 });
      const after = combatAct(state, FINISH, content).state;
      return 400 - (clashOf(after)?.enemyHp ?? 0);
    };
    // 倍率 1 + 0.5×势：4 点 ＝ 3 倍、8 点 ＝ 5 倍，基伤 4 → 12 与 20
    expect(damageAt(4)).toBe(12);
    expect(damageAt(8)).toBe(20);
    // 发完从零攒起（回合末自涨 1 ＋ 乘隙 1 ＋ 没挨伤 1 ＝ 3）
    const spent = combatAct(fighting(content, {}, { momentum: 8, momentumMax: 9 }), FINISH, content).state;
    expect(spent.encounter?.momentum).toBe(3);
  });

  it("决杀**无视守备减伤**（攒够了就不必等破绽）", () => {
    const content = calm({ encounterFinisherMomentum: 4, encounterFinisherMul: 1, encounterFinisherPerMomentum: 0 });
    const damage = (guardPart: "throat" | "eye"): number => {
      const state = fighting(content, { guardPart }, { momentum: 4, momentumMax: 9 });
      return 400 - (clashOf(combatAct(state, FINISH, content).state)?.enemyHp ?? 0);
    };
    expect(damage("throat")).toBe(damage("eye"));
  });
});

// ===== 三、部位伤整场累积 =====

describe("[M2-B1] 部位伤：整场累积，两条一劳永逸的效果", () => {
  it("腿伤到 `woundLegNoFleeAt` 层，它此后**再也走不掉**（拦逃不再是两回合的事）", () => {
    const fleeing = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, combatFleeIntentHpRatio: 1 },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
        ...enemy,
        // 排除「逃」之后退回「守」（而不是咬）—— 这一条量的是拦逃，不是它打得动打不动
        intentBias: { pounce: 0, bite: 0, guard: 1, flee: 20 },
      })),
    });
    // 没有腿伤：它宣告要走就真的走了
    const naked = fighting(fleeing, { guardPart: "eye", intent: { kind: "flee", text: "走。" } });
    expect(combatAct(naked, BITE("throat"), fleeing).over).toBe("escaped");
    // 腿上有伤：此后每一合它都走不成（不是「这一合被拦住」）
    let state = fighting(
      fleeing,
      { guardPart: "eye", intent: { kind: "flee", text: "走。" } },
      { wounds: { throat: 0, leg: 1, eye: 0 } },
    );
    for (let round = 0; round < 3; round += 1) {
      const turn = combatAct(state, BITE("throat"), fleeing);
      expect(turn.over, `第 ${round + 1} 合`).toBeNull();
      state = turn.state;
    }
  });

  it("眼伤到 `woundEyeNoCounterAt` 层，打它护着的部位也不再招反击", () => {
    const content = calm({ ...UNCLAMPED_CHANCE, combatGuardCounterChance: 1, woundEyeNoCounterAt: 2 });
    const oneEye = fighting(content, { guardPart: "throat" }, { wounds: { throat: 0, leg: 0, eye: 1 } });
    expect(combatPreview(oneEye, content).bites.find((b) => b.part === "throat")?.counterChance).toBe(1);
    const blindEye = fighting(content, { guardPart: "throat" }, { wounds: { throat: 0, leg: 0, eye: 2 } });
    expect(combatPreview(blindEye, content).bites.find((b) => b.part === "throat")?.counterChance).toBe(0);
  });

  it("每层腿伤都压低它的出伤与「扑」的权重（不是一次性开关）", () => {
    const pouncing = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, woundLegDamageMul: 0.5 },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
        ...enemy,
        intentBias: { pounce: 0, bite: 1, guard: 0, flee: 0 },
      })),
    });
    const incoming = (leg: number): number =>
      combatPreview(
        fighting(
          pouncing,
          { guardPart: "eye", intent: { kind: "bite", text: "咬。" } },
          { wounds: { throat: 0, leg, eye: 0 } },
        ),
        pouncing,
      ).incomingDamage.mid;
    expect(incoming(1)).toBeLessThan(incoming(0));
    expect(incoming(2)).toBeLessThan(incoming(1));
  });

  it("每层眼伤都抬高它打空的概率", () => {
    const content = calm({ woundEyeMissChance: 0.25 });
    const miss = (eye: number): number =>
      combatPreview(fighting(content, {}, { wounds: { throat: 0, leg: 0, eye } }), content)
        .incomingMissChance;
    expect(miss(0)).toBe(0);
    expect(miss(1)).toBeCloseTo(0.25, 5);
    expect(miss(2)).toBeCloseTo(0.5, 5);
  });
});

// ===== 四、行为段与弱点 =====

/** 造一头带两段行为与一处弱点的兽（fixture 的敌人都是单段无弱点的）。 */
function stagedContent(extra: Partial<TaleContent["tuning"]> = {}): TaleContent {
  const staged: EnemyDef[] = FIXTURE_CONTENT.enemies.map((enemy) =>
    enemy.id === ENEMY_QIONG_QI
      ? {
          ...enemy,
          hp: 100,
          intentBias: { pounce: 0, bite: 0, guard: 1, flee: 0 },
          stages: [
            // 第一段只护眼 → 咬喉恒是「没被护住」的那一咬，血线推得准（测的是换段不是守备掷骰）
            { at: 1, name: "戏弄", text: "", guardBias: { throat: 0, leg: 0, eye: 1 } },
            {
              at: 0.5,
              name: "暴怒",
              text: "它啼声一变 —— 不再把你当玩物了。",
              guardBias: { throat: 1, leg: 0, eye: 0 },
              damageMul: 2,
            },
          ],
          weakness: { part: "leg", name: "膝后的筋", text: "看清了：它的膝后有一道旧伤。" },
        }
      : { ...enemy, intentBias: { pounce: 0, bite: 0, guard: 1, flee: 0 } },
  );
  return contentWithoutEvents({ tuning: { combatDamageJitter: 0, ...extra }, enemies: staged });
}

describe("[M2-B1] 行为段：血线换打法，且当场宣告", () => {
  it("血过阈值进下一段，日志写出内容给的那句，段名上屏", () => {
    const content = stagedContent();
    // 100 血，阈值 0.5 → 打到 50 以下才换段
    let state = fighting(content, { enemyHp: 60, guardPart: "eye" });
    expect(encounterPreview(state, content).stageName).toBe("戏弄");
    const turn = combatAct(state, BITE("throat"), content); // 咬喉 6 → 54，还没过
    state = turn.state;
    expect(state.encounter?.stage).toBe(0);
    const second = combatAct(state, BITE("throat"), content); // 54 → 48，过了
    expect(second.state.encounter?.stage).toBe(1);
    expect(second.roundLog.join("")).toContain("不再把你当玩物");
    expect(encounterPreview(second.state, content).stageName).toBe("暴怒");
  });

  it("换段之后守备偏好真的换了（不是只换了个名字）", () => {
    const content = stagedContent();
    const guards = new Set<string>();
    for (let seed = 0; seed < 20; seed += 1) {
      const state = fighting(content, { enemyHp: 40, guardPart: "eye" }, { stage: 1 }, seed);
      const next = combatAct(state, BITE("throat"), content).state;
      const clash = clashOf(next);
      if (clash) guards.add(clash.guardPart);
    }
    // 第二段的 guardBias 把 leg／eye 压成 0 —— 二十个种子只摇得出咽喉
    expect([...guards]).toEqual(["throat"]);
  });

  it("段的 `damageMul` 真的落在受伤上", () => {
    const hitting = stagedContent();
    const biting = makeContent({
      ...hitting,
      enemies: hitting.enemies.map((enemy) =>
        enemy.id === ENEMY_QIONG_QI
          ? { ...enemy, intentBias: { pounce: 0, bite: 1, guard: 0, flee: 0 } }
          : enemy,
      ),
      tuning: hitting.tuning,
      events: hitting.events,
      organs: hitting.organs,
    });
    const incoming = (stage: number): number =>
      combatPreview(
        fighting(biting, { enemyHp: 40, guardPart: "eye", intent: { kind: "bite", text: "咬。" } }, { stage }),
        biting,
      ).incomingDamage.mid;
    expect(incoming(1)).toBe(incoming(0) * 2);
  });
});

describe("[M2-B1] 弱点：三条识破路径，识破后无视守备", () => {
  it("识破前不显示破绽、也不吃倍率；识破后两者同时生效", () => {
    const content = stagedContent({ weaknessDamageMul: 3, weaknessRevealRounds: 99, weaknessRevealHits: 99 });
    const hidden = fighting(content, { enemyHp: 100, guardPart: "leg" });
    expect(encounterPreview(hidden, content).weaknessFound).toBe(false);
    const hiddenLeg = combatPreview(hidden, content).bites.find((b) => b.part === "leg");
    expect(hiddenLeg?.weakPoint).toBe(false);
    // 守着的腿：伤减半
    const found = fighting(content, { enemyHp: 100, guardPart: "leg" }, { weaknessFound: true });
    const foundLeg = combatPreview(found, content).bites.find((b) => b.part === "leg");
    expect(foundLeg?.weakPoint).toBe(true);
    // 无视守备减伤 ＋ ×3 —— 一定比藏着的时候重
    expect(foundLeg?.damage.mid).toBeGreaterThan(hiddenLeg?.damage.mid ?? 99);
    // 且不再招反击（打的是它护不住的地方）
    expect(foundLeg?.counterChance).toBe(0);
  });

  it("路径一：咬中同一处够次数就试出来（什么器官都没有的 build 也够得着）", () => {
    const content = stagedContent({ weaknessRevealHits: 2, weaknessRevealRounds: 99 });
    let state = fighting(content, { enemyHp: 100, guardPart: "eye" });
    state = combatAct(state, BITE("leg"), content).state;
    expect(state.encounter?.weaknessFound).toBe(false);
    const second = combatAct(state, BITE("leg"), content);
    expect(second.state.encounter?.weaknessFound).toBe(true);
    expect(second.roundLog.join("")).toContain("膝后有一道旧伤");
  });

  it("路径二：打满几合就看出来了，且灵性越高越早", () => {
    const content = stagedContent({ weaknessRevealHits: 99, weaknessRevealRounds: 6, weaknessRevealPerLing: 10 });
    const roundsToSee = (ling: number): number => {
      const base = createLife(1, FIXTURE_SEED_ID, content);
      let state = enterCombat(
        { ...base, stats: { ...base.stats, ling } },
        ENEMY_QIONG_QI,
        content,
        { enemyHp: 400, guardPart: "leg" },
      );
      for (let round = 1; round <= 10; round += 1) {
        state = combatAct(state, BITE("throat"), content).state;
        if (state.encounter?.weaknessFound) return round;
      }
      return 99;
    };
    expect(roundsToSee(0)).toBe(6);
    expect(roundsToSee(30)).toBe(3);
  });

  it("路径三：历代所记（图鉴知识）—— 开场就知道，且开场那一句就写在日志里", () => {
    const content = stagedContent({ weaknessRevealHits: 99, weaknessRevealRounds: 99 });
    const ambushy = ambushEverywhere(content);
    const born = scout(ambushy, 5, { loreEnemyIds: [ENEMY_QIONG_QI] });
    const jumped = performAction(born, "explore", ambushy, { destinationId: "dest-far" }).state;
    expect(jumped.encounter?.enemyId).toBe(ENEMY_QIONG_QI);
    expect(jumped.encounter?.weaknessFound).toBe(true);
    expect(jumped.encounter?.log.join("")).toContain("旧伤");
  });

  it("没有弱点的兽（穷奇的原样）不会凭空识破出一个来", () => {
    const content = calm({ weaknessRevealRounds: 1, weaknessRevealHits: 1 });
    let state = fighting(content);
    for (let i = 0; i < 4; i += 1) state = combatAct(state, BITE("leg"), content).state;
    expect(state.encounter?.weaknessFound).toBe(false);
    expect(encounterPreview(state, content).weaknessPart).toBeNull();
  });
});

// ===== 五、四属性可见落点 =====

describe("[M2-B1] 四属性：每一项都给得出此刻的数（界面照它念，不藏在公式里）", () => {
  it("猛 → 一咬的基伤；体 → 交锋血上限与减伤；灵 → 势与识破与遁走；德 → 闪避、暴击与它的退意", () => {
    const content = calm({
      combatHpPerTi: 2,
      combatToughnessPerTi: 10,
      combatDodgePerDe: 0.01,
      combatCritPerDe: 0.005,
      combatEnemyFleePerDe: 0.1,
      encounterMomentumBase: 3,
      encounterMomentumMaxPerLing: 10,
      encounterMomentumStartPerLing: 10,
      weaknessRevealRounds: 5,
      weaknessRevealPerLing: 10,
    });
    const base = createLife(1, FIXTURE_SEED_ID, content);
    const hero = enterCombat(
      { ...base, stats: { meng: 24, ti: 30, ling: 20, de: 10 } },
      ENEMY_QIONG_QI,
      content,
    );
    const stats = encounterPreview(hero, content).stats;
    // 猛：基伤 = combatDamageBase 3 + floor(24/8) = 6，其中猛给 3
    expect(stats.meng).toBe(24);
    expect(stats.biteBase).toBe(6);
    expect(stats.mengBiteBonus).toBe(3);
    // 体：血 = 30×2 = 60，减伤 = floor(30/10) = 3
    expect(stats.hpMax).toBe(60);
    expect(stats.toughness).toBe(3);
    expect(clashOf(hero)?.playerHp).toBe(60);
    // 灵：势上限 3 + floor(20/10) = 5，起手 floor(20/10) = 2，看破 5 − floor(20/10) = 3 合
    expect(stats.momentumMax).toBe(5);
    expect(stats.momentumStart).toBe(2);
    expect(stats.weaknessRoundsBase).toBe(3);
    expect(stats.fleeChance).toBeGreaterThan(0);
    // 德：闪避 10×0.01、暴击 10×0.005、退意 ×(1 + 10×0.1)
    expect(stats.dodgeChance).toBeCloseTo(0.1, 5);
    expect(stats.critChance).toBeCloseTo(0.05, 5);
    expect(stats.enemyFleeMul).toBeCloseTo(2, 5);
  });

  it("体给的减伤真的落在受伤上（**四个受伤区间都要减**，否则按钮就在骗人）", () => {
    const biting = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, combatToughnessPerTi: 10, combatHpPerTi: 4 },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
        ...enemy,
        intentBias: { pounce: 0, bite: 1, guard: 0, flee: 0 },
      })),
    });
    const base = createLife(1, FIXTURE_SEED_ID, biting);
    const soft = enterCombat({ ...base, stats: { ...base.stats, ti: 10 } }, ENEMY_QIONG_QI, biting, {
      enemyHp: 400,
      guardPart: "eye",
      intent: { kind: "bite", text: "咬。" },
    });
    const tough = enterCombat({ ...base, stats: { ...base.stats, ti: 40 } }, ENEMY_QIONG_QI, biting, {
      enemyHp: 400,
      guardPart: "eye",
      intent: { kind: "bite", text: "咬。" },
    });
    const softView = combatPreview(soft, biting);
    const toughView = combatPreview(tough, biting);
    expect(toughView.toughness).toBe(4);
    expect(toughView.incomingDamage.mid).toBe(softView.incomingDamage.mid - 3);
    // 预览与真跑对账：报的减伤就是真跑少挨的
    const softHp = clashOf(combatAct(soft, BITE("throat"), biting).state)?.playerHp ?? 0;
    const toughHp = clashOf(combatAct(tough, BITE("throat"), biting).state)?.playerHp ?? 0;
    expect((soft.encounter?.clash?.playerHp ?? 0) - softHp).toBe(softView.incomingDamage.mid);
    expect((tough.encounter?.clash?.playerHp ?? 0) - toughHp).toBe(toughView.incomingDamage.mid);
  });

  it("德的闪避是真的：闪避拉满时它一下都伤不到我", () => {
    const dodgy = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, combatDodgePerDe: 1, combatDodgeMax: 1, combatHpPerTi: 4 },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
        ...enemy,
        intentBias: { pounce: 0, bite: 1, guard: 0, flee: 0 },
      })),
    });
    const state = fighting(dodgy, { guardPart: "eye", intent: { kind: "bite", text: "咬。" } });
    const turn = combatAct(state, BITE("throat"), dodgy);
    expect(clashOf(turn.state)?.playerHp).toBe(clashOf(state)?.playerHp);
    expect(turn.roundLog.join("")).toContain("扑了个空");
  });

  it("德的暴击是真的：暴击拉满时这一咬重 `combatCritMul` 倍", () => {
    const lucky = calm({ combatCritPerDe: 1, combatCritMax: 1, combatCritMul: 2 });
    const plain = calm({ combatCritPerDe: 0, combatCritMax: 0, combatCritMul: 2 });
    const dmg = (content: TaleContent): number =>
      400 - (clashOf(combatAct(fighting(content), BITE("throat"), content).state)?.enemyHp ?? 0);
    expect(dmg(lucky)).toBe(dmg(plain) * 2);
  });

  it("德抬高它的退意（凶兽也敬三分）—— 权重真的进了抽取", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, combatEnemyFleePerDe: 0.5, combatFleeIntentHpRatio: 1 },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
        ...enemy,
        intentBias: { pounce: 0, bite: 1, guard: 0, flee: 1 },
      })),
    });
    const base = createLife(1, FIXTURE_SEED_ID, content);
    const fleeShare = (de: number): number => {
      let flees = 0;
      for (let seed = 0; seed < 60; seed += 1) {
        const state = enterCombat(
          { ...createLife(seed, FIXTURE_SEED_ID, content), stats: { ...base.stats, de } },
          ENEMY_QIONG_QI,
          content,
          { enemyHp: 40, guardPart: "eye" },
        );
        const next = combatAct(state, BITE("eye"), content).state;
        if (clashOf(next)?.intent.kind === "flee") flees += 1;
      }
      return flees;
    };
    expect(fleeShare(20)).toBeGreaterThan(fleeShare(0));
  });
});

// ===== 六、一次遭遇的价值（点击账的抵消项） =====

describe("[M2-B1] 打赢一场硬仗留下食余（点击账的抵消项）", () => {
  it("取胜按 `EnemyDef.surplusSeasons × combatWinSurplusMul` 落食余，并写进日志", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, combatWinSurplusMul: 2 },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) =>
        enemy.id === ENEMY_QIONG_QI
          ? { ...enemy, surplusSeasons: 3, intentBias: { pounce: 0, bite: 0, guard: 1, flee: 0 } }
          : enemy,
      ),
    });
    const state = fighting(content, { enemyHp: 1 });
    const turn = combatAct(state, BITE("throat"), content);
    expect(turn.over).toBe("win");
    expect(turn.state.surplusSeasons).toBe(6);
    expect(turn.roundLog.join("")).toContain("够吃");
  });

  it("被打死那一场不留食余（给尸体记余粮只是一个没意义的数）", () => {
    const deadly = contentWithoutEvents({
      tuning: {
        combatDamageJitter: 0,
        combatWinSurplusMul: 2,
        ...UNCLAMPED_CHANCE,
        combatIntentDamageMul: { pounce: 99, bite: 99, guard: 0, flee: 0 },
      },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
        ...enemy,
        surplusSeasons: 3,
        intentBias: { pounce: 0, bite: 1, guard: 0, flee: 0 },
      })),
    });
    const state = fighting(deadly, {
      enemyHp: 400,
      playerHp: 1,
      intent: { kind: "bite", text: "咬。" },
    });
    const turn = combatAct(state, BITE("throat"), deadly);
    expect(turn.over).toBe("dead");
    expect(turn.state.surplusSeasons).toBe(0);
  });
});

// ===== 七、纪律 =====

describe("[M2-B1] 纪律：不可变、确定性、预览不消耗抽取", () => {
  it("combatAct 不改动入参（遭遇外壳的五个可变容器都拷了）", () => {
    const content = calm();
    const state = fighting(content, {}, { momentum: 2, wounds: { throat: 0, leg: 1, eye: 0 } });
    const snapshot = JSON.parse(JSON.stringify(state)) as TaleState;
    combatAct(state, BITE("leg"), content);
    expect(state).toEqual(snapshot);
  });

  it("encounterPreview 不消耗抽取（连调十次 rngState 不动）", () => {
    const content = calm();
    const state = fighting(content);
    for (let i = 0; i < 10; i += 1) encounterPreview(state, content);
    expect(state.rngState).toBe(fighting(content).rngState);
  });

  it("同一状态同一指令恒等（势、部位伤、行为段、弱点都不引入隐藏随机源）", () => {
    const content = stagedContent();
    const state = fighting(content, { enemyHp: 60 }, { momentum: 2, weaknessHits: 1 });
    const a = combatAct(state, BITE("leg"), content);
    const b = combatAct(state, BITE("leg"), content);
    expect(a.state).toEqual(b.state);
    expect(a.roundLog).toEqual(b.roundLog);
  });

  it("JSON 往返之后续跑一致（遭遇是完整自描述的）", () => {
    const content = stagedContent();
    const state = fighting(content, { enemyHp: 60 }, { momentum: 3, wounds: { throat: 0, leg: 2, eye: 1 } });
    const revived = JSON.parse(JSON.stringify(state)) as TaleState;
    expect(combatAct(revived, BITE("throat"), content).state).toEqual(
      combatAct(state, BITE("throat"), content).state,
    );
  });

  it("接近阶段仍是 4 个动作、扑中即得手（捕食那味道没被交锋吃掉）", () => {
    const content = contentWithoutEvents({ tuning: { ...ALWAYS_POUNCE } });
    const state = enterStalk(createLife(1, FIXTURE_SEED_ID, content), ENEMY_YE_ZHI, {}, content);
    expect(approachOf(state)).not.toBeNull();
    const turn = stalkAct(state, "pounce", content);
    expect(turn.over).toBe("caught");
    // 得手不进交锋：一顿肉就是一顿肉，不必再打一架
    expect(turn.state.encounter).toBeNull();
  });
});
