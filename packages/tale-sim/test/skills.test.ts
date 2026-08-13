/**
 * S1「技能组合」的引擎机制。
 *
 * 需求正本：`docs/plans/shiling/2026-08-13-liezhuan-build-depth-plan.md` 的「S1 技能组合」节。
 * 分工：`combat.test.ts` 守 M1-P2 那套（部位／守备／意图／姿态／既有四档效果），这里守 S1
 * 新加的四件事 —— **技能池**（不再是 `.find` 只取一件）、**代价**、**六档新效果**、
 * **组合技与它的发现差集**，外加**血脉**（`createLife` 的起手器官）与**推荐链的安全阀**。
 *
 * 手算基数（与 combat.test.ts 同一套，别改）：
 * - 我方 meng 10、ti 20（灵蕴神种 ling +3）→ 基础伤害 3 + floor(10/8) = **4**。
 * - 穷奇幼崽 meng 30 hp 40 → 它常规一口 6、扑 13；野雉 meng 4 hp 6。
 */

import { describe, expect, it } from "vitest";
import {
  SYNERGY_SKILL_PREFIX,
  boonCost,
  combatAct,
  combatPreview,
  combatSkills,
  createLife,
  ownedSynergies,
  performAction,
  recommendCombatAct,
  resolveChoice,
  type CombatAct,
  type CombatSkillDef,
  type TaleContent,
  type TaleEvent,
  type TaleState,
  type TaleTuning,
} from "../src/index.js";
import {
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  FIXTURE_CONTENT,
  FIXTURE_SEED_ID,
  NEVER_COUNTER,
  ORGAN_GOU_CHI,
  ORGAN_JI_ZU,
  ORGAN_LIN_JIA,
  ORGAN_WU_MU,
  contentWithoutEvents,
  enterCombat,
  makeContent,
  makeSynergy,
  organWithSkill,
  withOrgans,
} from "./fixtures.js";

const SKILL = (skillId: string): CombatAct => ({ kind: "skill", skillId });
const BITE = (part: "throat" | "leg" | "eye"): CombatAct => ({ kind: "bite", part });

/** 意图锁成某一种 ＋ 关抖动 ＋ 不反击：跨回合的账才算得清（同 combat.test.ts 的 pinIntent）。 */
function pinned(kind: "pounce" | "bite" | "guard", tuning: Partial<TaleTuning> = {}): TaleContent {
  return contentWithoutEvents({
    tuning: { combatDamageJitter: 0, ...NEVER_COUNTER, ...tuning },
    enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
      ...enemy,
      intentBias: { pounce: 0, bite: 0, guard: 0, flee: 0, [kind]: 1 },
    })),
  });
}

/** 造一份带某个自定义技的 content（器官 id ＝ `probe`）。 */
function withProbeSkill(skill: CombatSkillDef, tuning: Partial<TaleTuning> = {}): TaleContent {
  return contentWithoutEvents({
    tuning: { combatDamageJitter: 0, ...NEVER_COUNTER, ...tuning },
    organs: [
      ...FIXTURE_CONTENT.organs,
      { id: "probe", name: "试器", slot: "gut", affinity: { meng: 0.5 }, tags: [], combatSkill: skill, desc: "试。" },
    ],
    enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
      ...enemy,
      intentBias: { pounce: 0, bite: 1, guard: 0, flee: 0 },
    })),
  });
}

/** 摆好「带着 probe 技、正在打某头兽」的局面（缺省穷奇 ＋ 守眼，所以咬喉不吃减半）。 */
function probing(
  content: TaleContent,
  overrides: Parameters<typeof enterCombat>[3] = {},
  patch: Partial<TaleState> = {},
  enemyId: string = ENEMY_QIONG_QI,
): TaleState {
  const born = createLife(1, FIXTURE_SEED_ID, content);
  const armed = withOrgans({ ...born, ...patch }, "probe");
  return enterCombat(armed, enemyId, content, { guardPart: "eye", ...overrides });
}

describe("S1 技能池：不再只取第一件带技器官", () => {
  it("身上三件带技器官 → 预览里就有三颗技能按钮，顺序按 organIds", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0 },
      organs: [
        ...FIXTURE_CONTENT.organs,
        organWithSkill("s-b", "乙技"),
        organWithSkill("s-c", "丙技"),
      ],
    });
    const state = enterCombat(
      withOrgans(createLife(1, FIXTURE_SEED_ID, content), ORGAN_GOU_CHI, "s-b", "s-c"),
      ENEMY_QIONG_QI,
      content,
    );
    expect(combatPreview(state, content).skills.map((skill) => skill.skillId)).toEqual([
      ORGAN_GOU_CHI,
      "s-b",
      "s-c",
    ]);
  });

  it("每颗技各自冷却，互不影响（一个 map 一个键）", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, ...NEVER_COUNTER },
      organs: [...FIXTURE_CONTENT.organs, organWithSkill("s-b", "乙技", undefined, 2)],
    });
    const state = enterCombat(
      withOrgans(createLife(1, FIXTURE_SEED_ID, content), ORGAN_GOU_CHI, "s-b"),
      ENEMY_QIONG_QI,
      content,
      { guardPart: "eye" },
    );
    const after = combatAct(state, SKILL("s-b"), content).state;
    expect(after.combat?.skillCooldowns["s-b"]).toBe(2);
    expect(after.combat?.skillCooldowns[ORGAN_GOU_CHI]).toBeUndefined();
    const preview = combatPreview(after, content);
    expect(preview.skills.find((skill) => skill.skillId === ORGAN_GOU_CHI)?.ready).toBe(true);
    expect(preview.skills.find((skill) => skill.skillId === "s-b")?.ready).toBe(false);
  });
});

describe("S1 代价：付得起才是一手，付不起是不可用", () => {
  it("自伤类当场扣血，并在日志里留一行自己的痕", () => {
    const content = withProbeSkill({ name: "自伤技", desc: "。", cost: { kind: "hp", amount: 3 } });
    const { state: next, roundLog } = combatAct(probing(content), SKILL("probe"), content);
    // 20 − 3（自伤）− 6（它常规一口）= 11
    expect(next.combat?.playerHp).toBe(11);
    expect(roundLog.join("")).toContain("自身亦损3");
  });

  it("精气类扣的是**蜕变的本钱**（同一个 essence 池）", () => {
    const content = withProbeSkill({
      name: "精气技",
      desc: "。",
      cost: { kind: "essence", type: "lin", amount: 6 },
    });
    const state = probing(content, {}, { essence: { zu: 0, lin: 10, xue: 0, meng: 0 } });
    const next = combatAct(state, SKILL("probe"), content).state;
    expect(next.essence.lin).toBe(4);
  });

  it("精气不够 → ready 为假、affordable 为假、cooldownLeft 仍是 0（原因分得开）", () => {
    const content = withProbeSkill({
      name: "精气技",
      desc: "。",
      cost: { kind: "essence", type: "lin", amount: 6 },
    });
    const state = probing(content, {}, { essence: { zu: 0, lin: 5, xue: 0, meng: 0 } });
    const shown = combatPreview(state, content).skills[0];
    expect(shown?.ready).toBe(false);
    expect(shown?.affordable).toBe(false);
    expect(shown?.cooldownLeft).toBe(0);
    expect(shown?.cost).toEqual({ kind: "essence", type: "lin", amount: 6 });
    expect(() => combatAct(state, SKILL("probe"), content)).toThrow(/代价此刻付不起/);
  });

  /**
   * 自伤致死的按钮是**陷阱**，不是取舍 —— 所以「付完还活着」是 `affordable` 的判据。
   * 血正好等于代价时也不许放（付完是 0，那就是自杀）。
   */
  it("自伤会把自己弄死时不可用（血 3 而代价 3 也不行）", () => {
    const content = withProbeSkill({ name: "重技", desc: "。", cost: { kind: "hp", amount: 3 } });
    const dying = probing(content, { playerHp: 3 });
    expect(combatPreview(dying, content).skills[0]?.affordable).toBe(false);
    expect(() => combatAct(dying, SKILL("probe"), content)).toThrow(/代价此刻付不起/);
    const ok = probing(content, { playerHp: 4 });
    expect(combatPreview(ok, content).skills[0]?.affordable).toBe(true);
  });
});

describe("S1 六档新效果各改一个玩家看得见的量", () => {
  it("blind：给敌人挂致盲（它多半打空）", () => {
    const content = withProbeSkill({ name: "掩明", desc: "。", effects: ["blind"], damageMul: 0.6 });
    const next = combatAct(probing(content), SKILL("probe"), content).state;
    // 2 合挂上、回合末减 1
    expect(next.combat?.blind).toBe(1);
  });

  it("bleed：回合**末**掉血，它守着不动也照掉", () => {
    const content = withProbeSkill(
      { name: "撩爪", desc: "。", effects: ["bleed"], damageMul: 0.8 },
      { combatBleedRounds: 3, combatBleedDamage: 2 },
    );
    // 它这一合只守（不出手）—— 流血仍然要掉
    const guarding = probing(content, { intent: { kind: "guard", text: "它守着。" } });
    const first = combatAct(guarding, SKILL("probe"), content);
    // 伤害 floor(4 × 0.8) = 3，＋回合末流血 2 → 40 − 5 = 35
    expect(first.state.combat?.enemyHp).toBe(35);
    expect(first.roundLog.join("")).toContain("仍在渗血");
    expect(first.state.combat?.bleed).toBe(2);
    // 下一合什么都不做（换姿态）也照掉 2
    const second = combatAct(first.state, { kind: "stance", to: "low" }, content).state;
    expect(second.combat?.enemyHp).toBe(33);
  });

  it("bleed 把它放倒时照样算 win：精气、饱食、夺命数、combat 记录一样不少", () => {
    const content = withProbeSkill(
      { name: "撩爪", desc: "。", effects: ["bleed"], damageMul: 0.8 },
      { combatBleedRounds: 3, combatBleedDamage: 2 },
    );
    // 野雉 hp 6：撩爪伤 3 → 剩 3；下一合再来一次不可能（冷却），靠流血收官
    const state = probing(content, { enemyHp: 2, guardPart: "eye" }, {}, ENEMY_YE_ZHI);
    const turn = combatAct(state, SKILL("probe"), content);
    expect(turn.over).toBe("win");
    expect(turn.state.livesTaken).toBe(1);
    expect(turn.state.records.some((record) => record.kind === "combat")).toBe(true);
    expect(turn.state.essence.zu).toBeGreaterThan(0);
  });

  it("thorns：它命中我方时自伤；它只守（没打中）时不扎", () => {
    const content = withProbeSkill(
      { name: "竖鬃", desc: "。", effects: ["thorns"], damageMul: 0.5 },
      { combatThornsRounds: 3, combatThornsDamage: 2 },
    );
    // 它常规咬一口 → 命中 → 自伤 2；伤害 floor(4×0.5)=2 → 40 − 2 − 2 = 36
    const hit = combatAct(probing(content), SKILL("probe"), content);
    expect(hit.state.combat?.enemyHp).toBe(36);
    expect(hit.roundLog.join("")).toContain("自伤2");
    // 它这一合只守 → 没命中 → 不扎（40 − 2 = 38）
    const held = combatAct(
      probing(content, { intent: { kind: "guard", text: "它守着。" } }),
      SKILL("probe"),
      content,
    );
    expect(held.state.combat?.enemyHp).toBe(38);
  });

  it("brace：这一合它那一手伤害归零（且不留计数器）", () => {
    const content = withProbeSkill({ name: "合鳞", desc: "。", effects: ["brace"], damageMul: 0 });
    const turn = combatAct(probing(content), SKILL("probe"), content);
    expect(turn.state.combat?.playerHp).toBe(20);
    expect(turn.roundLog.join("")).toContain("一分力也没进来");
    // 不出伤：damageMul 0 的技绝不能靠 rollDamage 的 max(1,…) 偷偷打 1 点
    expect(turn.state.combat?.enemyHp).toBe(40);
    expect(combatPreview(probing(content), content).skills[0]?.damage).toEqual({
      mid: 0,
      min: 0,
      max: 0,
    });
  });

  it("brace 挡下的那一下不触发反刺（它没碰到你）", () => {
    const content = withProbeSkill(
      { name: "重甲", desc: "。", effects: ["brace", "thorns"], damageMul: 0 },
      { combatThornsRounds: 3, combatThornsDamage: 2 },
    );
    const turn = combatAct(probing(content), SKILL("probe"), content);
    expect(turn.state.combat?.playerHp).toBe(20);
    expect(turn.state.combat?.enemyHp).toBe(40);
    expect(turn.state.combat?.thorns).toBe(2);
  });

  it("bolt：必定遁走（不掷骰），且什么也拿不到", () => {
    const content = withProbeSkill(
      { name: "掠影", desc: "。", effects: ["bolt"], damageMul: 0 },
      // 逃跑成功率钉成 0：普通的「逃」在这份 content 里必失败，只有 bolt 走得脱
      { fleeBase: 0, minChance: 0, maxChance: 0 },
    );
    expect(combatAct(probing(content), { kind: "flee" }, content).over).toBeNull();
    const turn = combatAct(probing(content), SKILL("probe"), content);
    expect(turn.over).toBe("fled");
    expect(turn.state.combat).toBeNull();
    expect(turn.state.livesTaken).toBe(0);
  });

  it("insight：数合内读得出确切意图，且**不改任何结算**", () => {
    const content = withProbeSkill(
      { name: "垂雾", desc: "。", effects: ["insight"], damageMul: 0 },
      { combatInsightRounds: 3 },
    );
    const before = probing(content);
    expect(combatPreview(before, content).intentKnown).toBe(false);
    const after = combatAct(before, SKILL("probe"), content).state;
    expect(after.combat?.insight).toBe(2);
    expect(combatPreview(after, content).intentKnown).toBe(true);

    /*
     * 「信息不改结算」的双跑对账：同一局面、同一动作，一份带明识一份不带，
     * 除了 `insight` 计数器本身，推进逐字相同（同 M1-P2 那条洞察 tag 的测试）。
     */
    const plain = probing(content);
    const seer = { ...plain, combat: { ...plain.combat!, insight: 3 } };
    const a = combatAct(plain, BITE("throat"), content).state.combat;
    const b = combatAct(seer, BITE("throat"), content).state.combat;
    expect({ ...b, insight: 0, log: [] }).toEqual({ ...a, insight: 0, log: [] });
  });

  it("stat 为 ling 的技按灵算伤害（灵系 build 的输出手）", () => {
    const content = withProbeSkill({ name: "灵犀一点", desc: "。", stat: "ling", damageMul: 1 });
    // ling 40 → 3 + floor(40/8) = 8；meng 10 那一档只有 4
    const state = probing(content, {}, { stats: { meng: 10, ling: 40, ti: 20, de: 5 } });
    expect(combatPreview(state, content).skills[0]?.damage.mid).toBe(8);
    expect(combatAct(state, SKILL("probe"), content).state.combat?.enemyHp).toBe(32);
  });
});

describe("S1 组合技（异变）", () => {
  const SYN = makeSynergy("test-syn", [ORGAN_GOU_CHI, ORGAN_WU_MU], {
    name: "试组合",
    desc: "两件凑齐。",
    effects: ["venom", "stun"],
    damageMul: 2.6,
    cost: { kind: "hp", amount: 3 },
  });

  const content = contentWithoutEvents({
    tuning: { combatDamageJitter: 0, ...NEVER_COUNTER },
    synergies: [SYN],
    enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
      ...enemy,
      intentBias: { pounce: 0, bite: 1, guard: 0, flee: 0 },
    })),
  });

  function armedWith(...organIds: string[]): TaleState {
    return enterCombat(
      withOrgans(createLife(1, FIXTURE_SEED_ID, content), ...organIds),
      ENEMY_QIONG_QI,
      content,
      { guardPart: "eye" },
    );
  }

  it("差一件时池子里没有它；凑齐才出现，且带 syn: 前缀与 synergyId", () => {
    expect(ownedSynergies(armedWith(ORGAN_GOU_CHI), content)).toEqual([]);
    const both = armedWith(ORGAN_GOU_CHI, ORGAN_WU_MU);
    const pool = combatPreview(both, content).skills;
    expect(pool.map((skill) => skill.skillId)).toEqual([
      ORGAN_GOU_CHI,
      `${SYNERGY_SKILL_PREFIX}test-syn`,
    ]);
    const combo = pool[1];
    expect(combo?.synergyId).toBe("test-syn");
    expect(combo?.organId).toBeNull();
    expect(combo?.effects).toEqual(["venom", "stun"]);
  });

  it("组合技的**两条效果同时落地** —— 这就是它凭什么比单件器官技强", () => {
    const turn = combatAct(
      armedWith(ORGAN_GOU_CHI, ORGAN_WU_MU),
      SKILL(`${SYNERGY_SKILL_PREFIX}test-syn`),
      content,
    );
    // floor(4 × 2.6) = 10
    expect(turn.state.combat?.enemyHp).toBe(30);
    expect(turn.state.combat?.slow).toBeGreaterThan(0);
    // 顿挫压的是它**下一回合**的意图（已宣告的这一手照打），所以这里看的是下一合的脸
    expect(turn.state.combat?.intent.kind).toBe("guard");
    /*
     * 20 − 3（自伤代价）− 4（它已宣告的那一咬：穷奇 meng 30 → 基础 6，但附毒的迟滞
     * **当回合就生效** → floor(6 × 0.75) = 4）= 13。
     *
     * 这一条顺带钉住了「两条效果都在同一回合内兑现」：若迟滞延到下一合才算，这里会是 11。
     */
    expect(turn.state.combat?.playerHp).toBe(13);
  });

  it("组合技的冷却记在自己的键上，不占器官技的键", () => {
    const after = combatAct(
      armedWith(ORGAN_GOU_CHI, ORGAN_WU_MU),
      SKILL(`${SYNERGY_SKILL_PREFIX}test-syn`),
      content,
    ).state;
    expect(after.combat?.skillCooldowns[`${SYNERGY_SKILL_PREFIX}test-syn`]).toBeGreaterThan(0);
    expect(after.combat?.skillCooldowns[ORGAN_GOU_CHI]).toBeUndefined();
  });

  it("配方里的器官是从哪来的**不影响**判定（血脉带来的也算）", () => {
    const born = createLife(1, FIXTURE_SEED_ID, content, {
      boonOrganIds: [ORGAN_GOU_CHI, ORGAN_WU_MU],
    });
    expect(ownedSynergies(born, content).map((item) => item.id)).toEqual(["test-syn"]);
  });
});

describe("S1 组合的「新发现」差集", () => {
  const SYN = makeSynergy("mold", [ORGAN_GOU_CHI, ORGAN_LIN_JIA], {
    name: "试组合",
    desc: "。",
    effects: ["stun"],
  });

  it("蛰伏开出最后一件时报出来；下一步不再重复报", () => {
    // 精气钉成只可能开出鳞甲：候选池按 affinity × 精气加权，xue 型只有鳞甲有份量
    const content = makeContent({
      synergies: [SYN],
      tuning: { eventChanceBase: 0, moltThreshold: 10, moltCandidateCount: 1 },
    });
    const base = withOrgans(createLife(7, FIXTURE_SEED_ID, content), ORGAN_GOU_CHI);
    const ready: TaleState = { ...base, essence: { zu: 0, lin: 0, xue: 60, meng: 0 } };
    const first = performAction(ready, "dormant", content);
    expect(first.moltResult?.chosen.id).toBe(ORGAN_LIN_JIA);
    expect(first.newSynergies.map((item) => item.id)).toEqual(["mold"]);
    // 再走一个回合：organIds 没变 → 差集为空（不会每回合重播演出）
    const second = performAction(first.state, "rest", content);
    expect(second.newSynergies).toEqual([]);
  });

  it("事件送的器官（addOrganId）同样报 —— 两条获得路径都要接住", () => {
    const event: TaleEvent = {
      id: "probe-gift",
      trigger: { region: "any", weight: 1 },
      title: "赠",
      body: "。",
      choices: [{ label: "受", outcomes: [{ weight: 1, text: "得之。", effects: { addOrganId: ORGAN_LIN_JIA } }] }],
    };
    const content = makeContent({ synergies: [SYN], events: [event] });
    const state = withOrgans(createLife(3, FIXTURE_SEED_ID, content), ORGAN_GOU_CHI);
    const result = resolveChoice(state, event, 0, content);
    expect(result.newSynergies.map((item) => item.id)).toEqual(["mold"]);
  });

  it("已经凑齐之后再获得别的器官，不会把旧组合又报一遍", () => {
    const content = makeContent({ synergies: [SYN], tuning: { eventChanceBase: 0 } });
    const both = withOrgans(createLife(3, FIXTURE_SEED_ID, content), ORGAN_GOU_CHI, ORGAN_LIN_JIA);
    const event: TaleEvent = {
      id: "probe-gift-2",
      trigger: { region: "any", weight: 1 },
      title: "赠",
      body: "。",
      choices: [{ label: "受", outcomes: [{ weight: 1, text: "得之。", effects: { addOrganId: ORGAN_JI_ZU } }] }],
    };
    expect(resolveChoice(both, event, 0, makeContent({ synergies: [SYN], events: [event] })).newSynergies).toEqual([]);
  });
});

describe("S1 血脉：起手自带一件器官", () => {
  it("器官在身上、statMods 落账，且**不写 molt 记录**（否则每世白拿一点血统）", () => {
    const plain = createLife(5, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    const boon = createLife(5, FIXTURE_SEED_ID, FIXTURE_CONTENT, { boonOrganIds: [ORGAN_GOU_CHI] });
    expect(boon.organIds).toEqual([...plain.organIds, ORGAN_GOU_CHI]);
    // fixture 狩齿 meng +6
    expect(boon.stats.meng).toBe(plain.stats.meng + 6);
    expect(boon.records.filter((record) => record.kind === "molt")).toHaveLength(0);
    // 抽取序列不受影响：血脉不掷骰，所以同种子的天时／出身与后续剧本一个字都不动
    expect(boon.rngState).toBe(plain.rngState);
    expect(boon.skyId).toBe(plain.skyId);
  });

  it("重复 id 与神种同一件都跳过；未知 id 抛错（脏存档要吵）", () => {
    const twice = createLife(5, FIXTURE_SEED_ID, FIXTURE_CONTENT, {
      boonOrganIds: [ORGAN_GOU_CHI, ORGAN_GOU_CHI],
    });
    expect(twice.organIds.filter((id) => id === ORGAN_GOU_CHI)).toHaveLength(1);
    expect(() =>
      createLife(5, FIXTURE_SEED_ID, FIXTURE_CONTENT, { boonOrganIds: ["ghost-organ"] }),
    ).toThrow(/未知血脉器官/);
  });

  it("血脉带来的技当场就在技能池里（这一世第一场架就用得上）", () => {
    const content = contentWithoutEvents({ tuning: { combatDamageJitter: 0 } });
    const born = createLife(5, FIXTURE_SEED_ID, content, { boonOrganIds: [ORGAN_GOU_CHI] });
    expect(combatSkills(born, content).map((entry) => entry.skillId)).toEqual([ORGAN_GOU_CHI]);
  });

  it("boonCost：进得了开奖池的器官便宜，事件专属器官（affinity 空）翻倍", () => {
    const rare = { ...FIXTURE_CONTENT.organs[0]!, id: "rare-organ", affinity: {} };
    const content = makeContent({ organs: [...FIXTURE_CONTENT.organs, rare] });
    expect(boonCost(ORGAN_GOU_CHI, content)).toBe(content.tuning.bloodlineBoonCost);
    expect(boonCost("rare-organ", content)).toBe(content.tuning.bloodlineBoonRareCost);
    expect(() => boonCost("ghost", content)).toThrow(/未知器官/);
  });
});

describe("S1 推荐链：技能池长了，链不许劝玩家送死", () => {
  it("不到撑不住的时候，不推荐「必定脱身」那一手（逃掉＝没有精气）", () => {
    const content = withProbeSkill({
      name: "掠影",
      desc: "。",
      effects: ["bolt"],
      damageMul: 0,
      cost: { kind: "essence", type: "zu", amount: 4 },
    });
    const healthy = probing(content, { playerHp: 20 }, { essence: { zu: 50, lin: 0, xue: 0, meng: 0 } });
    expect(recommendCombatAct(combatPreview(healthy, content))).not.toEqual(SKILL("probe"));
    // 撑不过两合时它才该出现 —— 而且优先于掷骰的「逃」
    const dying = probing(content, { playerHp: 4 }, { essence: { zu: 50, lin: 0, xue: 0, meng: 0 } });
    expect(recommendCombatAct(combatPreview(dying, content))).toEqual(SKILL("probe"));
  });

  it("自伤过半的技不推荐（`ready` 只保证付完还活着，那不等于该按）", () => {
    const content = withProbeSkill({
      name: "碎骨",
      desc: "。",
      damageMul: 3,
      cost: { kind: "hp", amount: 5 },
    });
    // 血 8：代价 5 ≥ 4（半血）→ 不推荐，但仍然是「可用」的（玩家自己要按就按）
    const thin = probing(content, { playerHp: 8, enemyHp: 40 });
    expect(combatPreview(thin, content).skills[0]?.ready).toBe(true);
    expect(recommendCombatAct(combatPreview(thin, content))).not.toEqual(SKILL("probe"));
    // 血满时它是最重的一手 → 该推荐
    const full = probing(content, { playerHp: 20, enemyHp: 40 });
    expect(recommendCombatAct(combatPreview(full, content))).toEqual(SKILL("probe"));
  });

  it("能一下收官时，技与咬一起比，取真打得死的那一手（自伤过半也认）", () => {
    const content = withProbeSkill({
      name: "碎骨",
      desc: "。",
      damageMul: 3,
      cost: { kind: "hp", amount: 5 },
    });
    // 敌人剩 10：咬喉 6 打不死，碎骨 floor(4×3)=12 打得死
    const state = probing(content, { playerHp: 8, enemyHp: 10 });
    expect(recommendCombatAct(combatPreview(state, content))).toEqual(SKILL("probe"));
  });

  it("读不出意图而买得到明识时，长仗里先买知情权", () => {
    const content = withProbeSkill(
      { name: "垂雾", desc: "。", effects: ["insight"], damageMul: 0 },
      { combatInsightRounds: 3 },
    );
    const state = probing(content, { enemyHp: 40, playerHp: 20 });
    expect(combatPreview(state, content).intentKnown).toBe(false);
    expect(recommendCombatAct(combatPreview(state, content))).toEqual(SKILL("probe"));
  });

  it("持续类已经挂着时不重复挂（那是白费一个回合）", () => {
    const content = withProbeSkill(
      { name: "撩爪", desc: "。", effects: ["bleed"], damageMul: 0.8 },
      { combatBleedRounds: 3, combatBleedDamage: 2 },
    );
    const fresh = probing(content, { enemyHp: 40, playerHp: 20 });
    expect(recommendCombatAct(combatPreview(fresh, content))).toEqual(SKILL("probe"));
    const already = probing(content, { enemyHp: 40, playerHp: 20, bleed: 2 });
    expect(recommendCombatAct(combatPreview(already, content))).not.toEqual(SKILL("probe"));
  });

  /**
   * 「同一时刻只推荐一手」在这一层**没法用一条断言证明**（对同一个 preview 调两次纯函数
   * 必然相等，那是恒真的）。真正 pin 得住它的是客户端那条「恰好一颗按钮发金光」——
   * 见 `tale-client/test/combatVm.test.ts` 的「技能池满员时仍恰好一颗发金光」。
   *
   * 这里改成钉一条链**必须**满足的性质：任何局面下它给的那一手都是**合法的**
   * （`combatAct` 不抛错）—— 推荐一手点下去会崩的按钮，比不推荐更糟。
   */
  it("任何局面下推荐的那一手都是合法指令（点下去不抛错）", () => {
    const content = withProbeSkill(
      { name: "试技", desc: "。", effects: ["venom"], cost: { kind: "essence", type: "lin", amount: 8 } },
      { combatDamageJitter: 1 },
    );
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      for (const patch of [
        {},
        { playerHp: 3 },
        { enemyHp: 2 },
        { skillCooldowns: { probe: 2 } },
        { intent: { kind: "flee" as const, text: "走。" }, enemyHp: 4 },
      ]) {
        const state = probing(
          content,
          { ...patch },
          { essence: { zu: 0, lin: seed % 2 === 0 ? 20 : 0, xue: 0, meng: 0 } },
        );
        const act = recommendCombatAct(combatPreview(state, content));
        expect(() => combatAct(state, act, content), JSON.stringify({ seed, patch, act })).not.toThrow();
      }
    }
  });
});
