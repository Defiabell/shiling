import { describe, expect, it } from "vitest";
import {
  combatAct,
  combatPreview,
  createLife,
  type BodyPart,
  type CombatAct,
  type Stance,
  type TaleContent,
  type TaleState,
  type TaleTuning,
  clashOf,
} from "../src/index.js";
import {
  ALWAYS_COUNTER,
  ALWAYS_MISS,
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  FIXTURE_CONTENT,
  FIXTURE_SEED_ID,
  NEVER_COUNTER,
  NEVER_MISS,
  ORGAN_GOU_CHI,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  enterCombat,
  makeContent,
  organWithSkill,
  withOrgans,
} from "./fixtures.js";

/**
 * 关掉伤害抖动，让伤害公式可以精确断言。
 *
 * 手算基数（下面所有字面量都从这两行来，别改）：
 * - 我方 meng 10 → 基础伤害 3 + floor(10/8) = **4**；咬喉 ×1.6 → 6、咬腿 ×0.7 → 2、扑眼 ×0.35 → 1。
 * - 穷奇 meng 30 → 基础伤害 3 + floor(30/8) = **6**；扑 ×2.2 → 13、常规咬 → 6。
 * - 野雉 meng 4 → 3；hp 6，所以一口咬喉（6）正好打死它。
 */
const EXACT = contentWithoutEvents({ tuning: { combatDamageJitter: 0, ...NEVER_COUNTER } });

const BITE = (part: BodyPart): CombatAct => ({ kind: "bite", part });
const STANCE = (to: Stance): CombatAct => ({ kind: "stance", to });
const FLEE: CombatAct = { kind: "flee" };

function fighting(
  enemyId: string,
  content: TaleContent = EXACT,
  overrides: Parameters<typeof enterCombat>[3] = {},
  seed = 1,
  /** [M2-B1] 遭遇外壳（势／部位伤／行为段／弱点）的覆写 */
  shell: Parameters<typeof enterCombat>[4] = {},
): TaleState {
  return enterCombat(createLife(seed, FIXTURE_SEED_ID, content), enemyId, content, overrides, shell);
}

/**
 * 把所有敌人的意图锁成某一种。
 *
 * 跨回合的测试（姿态持续、冷却递减、致盲覆盖两下）必须能控制它**每一回合**打算干什么 ——
 * 否则第二回合摇到「守」就会量到 0 伤害，测试变成掷硬币。只适用于 pounce／bite／guard：
 * 「逃」在血厚时根本不入池（那是设计，见对应测试）。
 */
function pinIntent(
  kind: "pounce" | "bite" | "guard",
  tuning: Partial<TaleTuning> = {},
): TaleContent {
  return contentWithoutEvents({
    tuning: { combatDamageJitter: 0, ...NEVER_COUNTER, ...tuning },
    enemies: FIXTURE_CONTENT.enemies.map((enemy) => ({
      ...enemy,
      intentBias: { pounce: 0, bite: 0, guard: 0, flee: 0, [kind]: 1 },
    })),
  });
}

describe("搏杀：前置校验", () => {
  it("不在交锋阶段时抛错", () => {
    const life = createLife(1, FIXTURE_SEED_ID, EXACT);
    expect(() => combatAct(life, BITE("throat"), EXACT)).toThrow(/不在交锋阶段/);
    expect(() => combatPreview(life, EXACT)).toThrow(/不在交锋阶段/);
  });

  it("已死亡时抛错", () => {
    const state = { ...fighting(ENEMY_YE_ZHI), alive: false };
    expect(() => combatAct(state, BITE("throat"), EXACT)).toThrow(/已死亡/);
  });

  it("敌人 id 失效时抛错", () => {
    const state = fighting(ENEMY_YE_ZHI);
    const broken = { ...state, encounter: { ...state.encounter!, enemyId: "ghost" } };
    expect(() => combatAct(broken, BITE("throat"), EXACT)).toThrow(/未知敌人/);
    expect(() => combatPreview(broken, EXACT)).toThrow(/未知敌人/);
  });

  it("换成当前已在的姿态抛错（那只是白费一回合）", () => {
    const state = fighting(ENEMY_QIONG_QI);
    expect(() => combatAct(state, STANCE("square"), EXACT)).toThrow(/已是/);
  });

  it("未持有的器官／没有战技的器官／还在冷却的技，一律抛错", () => {
    const bare = fighting(ENEMY_QIONG_QI);
    // [S1] 「没有这个技」一句话盖两种情形：技能池是由 combatSkills 算出来的，
    // 「器官不在身上」与「器官没技」都表现为「池子里没有这个 skillId」——
    // 分两句报错等于在客户端之外再维护一份「这个 id 是器官吗」的知识。
    expect(() => combatAct(bare, { kind: "skill", skillId: ORGAN_GOU_CHI }, EXACT)).toThrow(/没有这个技/);
    const noSkill = withOrgans(bare, "wu-mu");
    expect(() => combatAct(noSkill, { kind: "skill", skillId: "wu-mu" }, EXACT)).toThrow(/没有这个技/);
    const cooling = enterCombat(
      withOrgans(createLife(1, FIXTURE_SEED_ID, EXACT), ORGAN_GOU_CHI),
      ENEMY_QIONG_QI,
      EXACT,
      { skillCooldowns: { [ORGAN_GOU_CHI]: 2 } },
    );
    expect(() => combatAct(cooling, { kind: "skill", skillId: ORGAN_GOU_CHI }, EXACT)).toThrow(/还要等2合/);
  });
});

describe("搏杀：三个部位（伤害与附带效果）", () => {
  it("咬喉／咬腿／扑眼的伤害逐字锁定（手算字面量，不抄源码算式）", () => {
    const hp = 40;
    expect(combatAct(fighting(ENEMY_QIONG_QI), BITE("throat"), EXACT).state.encounter?.clash?.enemyHp).toBe(hp - 6);
    // 缺省守备在后腿上，先换个守备位置再量咬腿的裸伤
    const guardEye = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye" });
    expect(combatAct(guardEye, BITE("leg"), EXACT).state.encounter?.clash?.enemyHp).toBe(hp - 2);
    const guardLeg = fighting(ENEMY_QIONG_QI);
    expect(combatAct(guardLeg, BITE("eye"), EXACT).state.encounter?.clash?.enemyHp).toBe(hp - 1);
  });

  it("伤害排序恒为 喉 > 腿 > 眼（低伤那两颗靠附带效果换价值）", () => {
    // 三条都打在未被护住的部位上：把守备挪到不参与比较的那一处
    const damage = (part: BodyPart, guard: BodyPart): number => {
      const state = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: guard });
      return 40 - (combatAct(state, BITE(part), EXACT).state.encounter?.clash?.enemyHp ?? 0);
    };
    expect(damage("throat", "eye")).toBeGreaterThan(damage("leg", "eye"));
    expect(damage("leg", "throat")).toBeGreaterThan(damage("eye", "throat"));
  });

  it("[M2-B1] 咬腿留腿伤、扑眼留眼伤；咬喉不留伤（它是爆发那一档）", () => {
    const guardEye = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye" });
    const legged = combatAct(guardEye, BITE("leg"), EXACT).state.encounter;
    expect(legged?.wounds).toEqual({ throat: 0, leg: 1, eye: 0 });
    const blinded = combatAct(fighting(ENEMY_QIONG_QI), BITE("eye"), EXACT).state.encounter;
    expect(blinded?.wounds).toEqual({ throat: 0, leg: 0, eye: 1 });
    /*
     * 咬喉**不留伤**是这一档的价钱的反面：它伤最高（×1.6），若还白拿一条持续线，
     * 另两颗低伤按钮的低伤就不是价钱而是纯亏 —— 三颗咬击又退化成一颗。
     */
    const throated = combatAct(fighting(ENEMY_QIONG_QI), BITE("throat"), EXACT).state.encounter;
    expect(throated?.wounds).toEqual({ throat: 0, leg: 0, eye: 0 });
  });

  it("附带效果只在它还活着时才落地（打死了不必再瞎）", () => {
    const state = fighting(ENEMY_YE_ZHI); // hp 6，一口咬喉正好打死
    const { over, roundLog } = combatAct(state, BITE("throat"), EXACT);
    expect(over).toBe("win");
    expect(roundLog.join("")).not.toContain("看不清");
  });
});

describe("搏杀：守备与反击", () => {
  it("打中被护部位伤害减半", () => {
    const state = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "throat" });
    // 4 × 1.6 × 0.5 = 3.2 → 3
    expect(combatAct(state, BITE("throat"), EXACT).state.encounter?.clash?.enemyHp).toBe(40 - 3);
  });

  it("它这一回合在守势时，被护部位再减一档", () => {
    const state = fighting(ENEMY_QIONG_QI, EXACT, {
      guardPart: "throat",
      intent: { kind: "guard", text: "它护住要害。" },
    });
    // 4 × 1.6 × 0.5 × 0.5 = 1.6 → 1
    expect(combatAct(state, BITE("throat"), EXACT).state.encounter?.clash?.enemyHp).toBe(40 - 1);
  });

  it("打中被护部位会招来反击（穷奇反击 6）", () => {
    const content = contentWithoutEvents({ tuning: { combatDamageJitter: 0, ...ALWAYS_COUNTER } });
    const state = fighting(ENEMY_QIONG_QI, content, { guardPart: "throat" });
    const { state: next, roundLog } = combatAct(state, BITE("throat"), content);
    // 反击 6 ＋ 它自己那一口 6 = 12
    expect(clashOf(next)?.playerHp).toBe(20 - 12);
    expect(roundLog.join("")).toContain("反");
  });

  it("它已被致盲时不会反击（看不见你，谈不上反口）", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, ...ALWAYS_COUNTER, ...NEVER_MISS },
    });
    const state = fighting(ENEMY_QIONG_QI, content, { guardPart: "throat", blind: 2 });
    // 只挨它自己那一口 6，没有反击
    expect(combatAct(state, BITE("throat"), content).state.encounter?.clash?.playerHp).toBe(20 - 6);
  });

  it("未打在守备处则不会招反击", () => {
    const content = contentWithoutEvents({ tuning: { combatDamageJitter: 0, ...ALWAYS_COUNTER } });
    const state = fighting(ENEMY_QIONG_QI, content, { guardPart: "eye" });
    expect(combatAct(state, BITE("throat"), content).state.encounter?.clash?.playerHp).toBe(20 - 6);
  });
});

describe("搏杀：姿态", () => {
  it("换姿态那一回合不出手，但照样挨它这一下", () => {
    const state = fighting(ENEMY_QIONG_QI);
    const { state: next } = combatAct(state, STANCE("low"), EXACT);
    expect(clashOf(next)?.enemyHp).toBe(40);
    // 伏低受伤 ×0.7：6 × 0.7 = 4.2 → 4
    expect(clashOf(next)?.playerHp).toBe(20 - 4);
    expect(clashOf(next)?.stance).toBe("low");
  });

  it("姿态跨回合持续（不是一次性技）", () => {
    const content = pinIntent("bite");
    let state = combatAct(fighting(ENEMY_QIONG_QI, content), STANCE("lunge"), content).state;
    expect(clashOf(state)?.stance).toBe("lunge");
    // 扑击出伤 ×1.35：4 × 1.6 × 1.35 = 8.64 → 8
    const before = clashOf(state)?.enemyHp ?? 0;
    state = combatAct(state, BITE("throat"), content).state;
    expect(clashOf(state)?.enemyHp).toBe(before - 8);
    expect(clashOf(state)?.stance).toBe("lunge");
  });

  it("扑击姿态受伤也涨（×1.25 → 7）", () => {
    const content = pinIntent("bite");
    const state = combatAct(fighting(ENEMY_QIONG_QI, content), STANCE("lunge"), content).state;
    const hpAfterSwitch = clashOf(state)?.playerHp ?? 0;
    expect(hpAfterSwitch).toBe(20 - 7);
    expect(combatAct(state, BITE("throat"), content).state.encounter?.clash?.playerHp).toBe(hpAfterSwitch - 7);
  });

  it("它这一回合只守时，换姿态是免费的（这就是「守」那一档意图的用处）", () => {
    const state = fighting(ENEMY_QIONG_QI, EXACT, {
      intent: { kind: "guard", text: "它护住要害。" },
    });
    const { state: next } = combatAct(state, STANCE("low"), EXACT);
    expect(clashOf(next)?.playerHp).toBe(20);
    expect(clashOf(next)?.stance).toBe("low");
  });
});

describe("搏杀：敌人意图", () => {
  it("意图＝扑 → 受伤 ×2.2（6 → 13）", () => {
    const state = fighting(ENEMY_QIONG_QI, EXACT, {
      intent: { kind: "pounce", text: "它压低身子。" },
    });
    expect(combatAct(state, BITE("throat"), EXACT).state.encounter?.clash?.playerHp).toBe(20 - 13);
  });

  it("意图＝守 → 它不出手", () => {
    const state = fighting(ENEMY_QIONG_QI, EXACT, {
      intent: { kind: "guard", text: "它护住要害。" },
    });
    expect(combatAct(state, BITE("eye"), EXACT).state.encounter?.clash?.playerHp).toBe(20);
  });

  it("意图＝逃且未被迟滞 → over=escaped，什么也拿不到", () => {
    const state = fighting(ENEMY_QIONG_QI, EXACT, {
      intent: { kind: "flee", text: "它想走。" },
    });
    const { state: next, over, roundLog } = combatAct(state, BITE("throat"), EXACT);
    expect(over).toBe("escaped");
    expect(clashOf(next)).toBeNull();
    expect(next.alive).toBe(true);
    // 没有精气、没有饱食、没有击杀记录 —— 这才是「读错意图」的代价
    expect(next.essence.meng).toBe(0);
    expect(next.hunger).toBe(state.hunger);
    expect(next.records.filter((record) => record.kind === "combat")).toHaveLength(0);
    expect(roundLog.join("")).toMatch(/走|遁/);
  });

  it("咬腿拦得住它的遁走（迟滞 → 它没走成，战斗继续）", () => {
    const state = fighting(ENEMY_QIONG_QI, EXACT, {
      guardPart: "eye",
      intent: { kind: "flee", text: "它想走。" },
    });
    const { state: next, over, roundLog } = combatAct(state, BITE("leg"), EXACT);
    expect(over).toBeNull();
    expect(clashOf(next)).not.toBeNull();
    expect(roundLog.join("")).toContain("没走成");
  });

  it("迟滞期间摇不出「逃」（宣告了做不到的事就是骗人），但「扑」只是变少", () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      const state = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye", enemyHp: 8 }, seed);
      const next = combatAct(state, BITE("leg"), EXACT).state;
      const clash = clashOf(next);
      if (clash) kinds.add(clash.intent.kind);
    }
    expect(kinds.size).toBeGreaterThan(0);
    // 逃**必须**排除：拦得住却宣告要走，屏幕上写的就不算数了
    expect(kinds.has("flee")).toBe(false);
    /*
     * 扑只是权重打折（`combatSlowPounceMul`），不排除 —— 全排除会让「咬腿→咬喉」的轮转
     * 彻底删掉扑这一档，而扑的预告是姿态那一整套决定的前提。实验台实测过全排除的后果：
     * 只会咬腿一手对岩羊胜率 99.5%，三颗咬击按钮退化成一颗。
     */
    expect(kinds.has("pounce")).toBe(true);
  });

  it("迟滞期间「扑」的权重真的被压低了（不是没变）", () => {
    const count = (slow: number): number => {
      let pounces = 0;
      for (let seed = 0; seed < 200; seed += 1) {
        const state = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "leg", slow, enemyHp: 30 }, seed);
        const next = combatAct(state, BITE("throat"), EXACT).state;
        if (clashOf(next)?.intent.kind === "pounce") pounces += 1;
      }
      return pounces;
    };
    expect(count(2)).toBeLessThan(count(0));
  });

  /*
   * [M2-B1] 「不叠加」这条 M1-P2 的规则**被整段换掉了**。
   *
   * 那时咬腿／扑眼是两回合的计数器且不许续，理由是「可无限续的迟滞让只咬腿一手对岩羊
   * 胜率 99.5%」。M2-B1 换成**整场累积、按 `woundCap` 封顶**：每一咬都留一层，
   * 三层封顶。防「一手通吃」的闸门从「不许续」换成「有上限 ＋ 边际递减」，
   * 而每一层要花一个回合、且咬腿咬眼的伤害只有 0.7／0.35 —— 经营那两条线的价钱
   * 就是「这几合我没在放血」。
   */
  it("[M2-B1] 部位伤整场累积，到 woundCap 封顶（封顶之后那一咬只剩伤害）", () => {
    const content = pinIntent("guard");
    const cap = content.tuning.woundCap;
    let state = fighting(ENEMY_QIONG_QI, content, { guardPart: "eye", enemyHp: 400 });
    for (let i = 0; i < cap; i += 1) {
      expect(
        combatPreview(state, content).bites.find((bite) => bite.part === "leg")?.woundLands,
        `第 ${i + 1} 层该落得下来`,
      ).toBe(true);
      state = combatAct(state, BITE("leg"), content).state;
      expect(state.encounter?.wounds.leg).toBe(i + 1);
    }
    // 封顶：预览如实说「这一咬不再留伤」，真跑也确实不再涨
    expect(combatPreview(state, content).bites.find((bite) => bite.part === "leg")?.woundLands).toBe(false);
    const capped = combatAct(state, BITE("leg"), content).state;
    expect(capped.encounter?.wounds.leg).toBe(cap);
  });

  it("[M2-B1] 部位伤**不随回合衰减**（这正是它与 blind/slow 那一族计数器的分界）", () => {
    const content = pinIntent("guard");
    const state = fighting(ENEMY_QIONG_QI, content, { guardPart: "eye", enemyHp: 400 });
    const bitten = combatAct(state, BITE("eye"), content).state;
    expect(bitten.encounter?.wounds.eye).toBe(1);
    // 换个姿态白耗两合，眼伤照旧在
    const idle1 = combatAct(bitten, { kind: "stance", to: "low" }, content).state;
    const idle2 = combatAct(idle1, { kind: "stance", to: "lunge" }, content).state;
    expect(idle2.encounter?.wounds.eye).toBe(1);
  });

  it("[M2-B1] 腿伤到 woundLegNoFleeAt 层，它再也摇不出「逃」", () => {
    const content = pinIntent("guard");
    const need = content.tuning.woundLegNoFleeAt;
    const kinds = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      // 血薄（摇得出逃）＋ 腿伤已满那一层
      const state = fighting(
        ENEMY_QIONG_QI,
        EXACT,
        { guardPart: "throat", enemyHp: 12 },
        seed,
        { wounds: { throat: 0, leg: need, eye: 0 } },
      );
      const clash = clashOf(combatAct(state, BITE("eye"), EXACT).state);
      if (clash) kinds.add(clash.intent.kind);
    }
    expect(kinds.has("flee")).toBe(false);
  });

  it("血还厚时摇不出「逃」（满血遁走会让玩家白挨一顿莫名其妙）", () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      const state = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye" }, seed);
      const next = combatAct(state, BITE("eye"), EXACT).state;
      const clash = clashOf(next);
      if (clash) kinds.add(clash.intent.kind);
    }
    expect(kinds.has("flee")).toBe(false);
  });

  it("血薄时摇得出「逃」（否则「咬腿拦逃」是死机制）", () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      // 血薄但打不死：起手 12（阈值 40×0.5＝20 以下），扑眼只掉 1
      const state = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "throat", enemyHp: 12 }, seed);
      const next = combatAct(state, BITE("eye"), EXACT).state;
      const clash = clashOf(next);
      if (clash) kinds.add(clash.intent.kind);
    }
    expect(kinds.has("flee")).toBe(true);
  });

  it("守备偏好真的进了抽取（guardBias 压死一处则永远护那处）", () => {
    const biased = contentWithoutEvents({
      tuning: { combatDamageJitter: 0 },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) =>
        enemy.id === ENEMY_QIONG_QI ? { ...enemy, guardBias: { throat: 1, leg: 0, eye: 0 } } : enemy,
      ),
    });
    const seen = new Set<BodyPart>();
    for (let seed = 0; seed < 20; seed += 1) {
      const state = fighting(ENEMY_QIONG_QI, biased, { guardPart: "eye" }, seed);
      const next = combatAct(state, BITE("throat"), biased).state;
      const clash = clashOf(next);
      if (clash) seen.add(clash.guardPart);
    }
    expect([...seen]).toEqual(["throat"]);
  });

  it("意图旁白优先用内容的 combatFlavor，缺省退回引擎兜底池", () => {
    // 兜底路（fixture 的穷奇没写 combatFlavor）：文案必须来自引擎池、占位已替换、带敌人名
    const state = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye" });
    const next = combatAct(state, BITE("throat"), EXACT).state;
    expect(clashOf(next)?.intent.text.length).toBeGreaterThan(0);
    expect(clashOf(next)?.intent.text).not.toContain("{{");

    const own = contentWithoutEvents({
      tuning: { combatDamageJitter: 0 },
      enemies: FIXTURE_CONTENT.enemies.map((enemy) =>
        enemy.id === ENEMY_QIONG_QI
          ? {
              ...enemy,
              intentBias: { pounce: 0, bite: 1, guard: 0, flee: 0 },
              combatFlavor: { intent: { bite: ["【穷奇】压上来了。"] } },
            }
          : enemy,
      ),
    });
    const owned = combatAct(fighting(ENEMY_QIONG_QI, own, { guardPart: "eye" }), BITE("throat"), own).state;
    expect(clashOf(owned)?.intent.text).toBe("【穷奇】压上来了。");
  });
});

describe("搏杀：致盲", () => {
  it("致盲期间它会打空（必空档下一点血都不掉）", () => {
    const content = contentWithoutEvents({ tuning: { combatDamageJitter: 0, ...ALWAYS_MISS } });
    const state = fighting(ENEMY_QIONG_QI, content, { guardPart: "eye", blind: 2 });
    const { state: next, roundLog } = combatAct(state, BITE("throat"), content);
    expect(clashOf(next)?.playerHp).toBe(20);
    expect(roundLog.join("")).toMatch(/看不见|空处|没有人/);
  });

  /*
   * [M2-B1] M1-P2 的「致盲覆盖两回合后归零」整段换掉了：扑眼挂的不再是两回合的计数器，
   * 而是一层**整场不消**的眼伤（技能的 `blind` 那一族计数器仍在，见 skills.test.ts）。
   * 于是判据从「两合后失效」变成「此后每一合都还在」——那正是这一批要的东西：
   * 一场 5〜10 合的架里，两回合的效果等于没发生过。
   */
  it("[M2-B1] 眼伤挂上之后，此后每一合都还在（不是两合就长好）", () => {
    const content = pinIntent("bite", { ...ALWAYS_MISS });
    let state = fighting(ENEMY_QIONG_QI, content, { guardPart: "leg" });
    const full = clashOf(state)?.playerHp ?? 0;
    state = combatAct(state, BITE("eye"), content).state;
    expect(state.encounter?.wounds.eye).toBe(1);
    expect(clashOf(state)?.playerHp).toBe(full); // 第一次动作被打空
    for (let round = 0; round < 3; round += 1) {
      state = combatAct(state, BITE("throat"), content).state;
      expect(state.encounter?.wounds.eye, `第 ${round + 2} 合`).toBe(1);
      expect(clashOf(state)?.playerHp, `第 ${round + 2} 合`).toBe(full);
    }
  });

  it("致盲让逃跑更容易（它看不见你往哪去）", () => {
    const content = contentWithoutEvents({ tuning: { ...UNCLAMPED_CHANCE, combatDamageJitter: 0 } });
    const seeing = combatPreview(fighting(ENEMY_QIONG_QI, content), content).fleeChance;
    const blinded = combatPreview(
      fighting(ENEMY_QIONG_QI, content, { blind: 2 }),
      content,
    ).fleeChance;
    expect(blinded - seeing).toBeCloseTo(content.tuning.combatBlindFleeBonus, 5);
  });
});

describe("搏杀：器官技与冷却", () => {
  const armed = (content: TaleContent, organId = ORGAN_GOU_CHI, overrides = {}): TaleState =>
    enterCombat(
      withOrgans(createLife(1, FIXTURE_SEED_ID, content), organId),
      ENEMY_QIONG_QI,
      content,
      { guardPart: "eye", ...overrides },
    );

  it("伤害 ×organSkillDamageMul（4 × 2 = 8）", () => {
    const { state: next, roundLog } = combatAct(
      armed(EXACT),
      { kind: "skill", skillId: ORGAN_GOU_CHI },
      EXACT,
    );
    expect(clashOf(next)?.enemyHp).toBe(40 - 8);
    expect(roundLog.join("")).toContain("撕咬");
  });

  it("用掉即进冷却，缺省 combatSkillCooldown 回合后才好", () => {
    const content = pinIntent("guard", { combatSkillCooldown: 2 });
    let state = combatAct(armed(content), { kind: "skill", skillId: ORGAN_GOU_CHI }, content).state;
    expect(clashOf(state)?.skillCooldowns[ORGAN_GOU_CHI]).toBe(2);
    expect(combatPreview(state, content).skills[0]?.ready).toBe(false);
    state = combatAct(state, BITE("throat"), content).state;
    expect(clashOf(state)?.skillCooldowns[ORGAN_GOU_CHI]).toBe(1);
    state = combatAct(state, BITE("throat"), content).state;
    // 归零的键直接删掉：留着一个 0 会让「有没有在冷却」有两种写法
    expect(clashOf(state)?.skillCooldowns).toEqual({});
    expect(combatPreview(state, content).skills[0]?.ready).toBe(true);
  });

  it("器官自带的 cooldown 覆盖 tuning 缺省", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, combatSkillCooldown: 2 },
      organs: [...FIXTURE_CONTENT.organs, organWithSkill("long-cd", "久技", undefined, 5)],
    });
    const state = combatAct(
      armed(content, "long-cd"),
      { kind: "skill", skillId: "long-cd" },
      content,
    ).state;
    expect(clashOf(state)?.skillCooldowns["long-cd"]).toBe(5);
  });

  it("effect=venom 挂迟滞", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, combatVenomSlowRounds: 3 },
      organs: [...FIXTURE_CONTENT.organs, organWithSkill("venom-organ", "喷毒", ["venom"])],
    });
    const { state: next, roundLog } = combatAct(
      armed(content, "venom-organ"),
      { kind: "skill", skillId: "venom-organ" },
      content,
    );
    expect(clashOf(next)?.slow).toBe(2); // 3 挂上，回合末减 1
    expect(roundLog.join("")).toContain("血凝");
  });

  it("effect=stun 把它下一回合的意图压成「守」", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0 },
      organs: [...FIXTURE_CONTENT.organs, organWithSkill("stun-organ", "顿挫", ["stun"])],
    });
    const { state: next, roundLog } = combatAct(
      armed(content, "stun-organ"),
      { kind: "skill", skillId: "stun-organ" },
      content,
    );
    expect(clashOf(next)?.intent.kind).toBe("guard");
    expect(roundLog.join("")).toContain("一滞");
  });

  it("effect=heal 回血且不出伤", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, combatSkillHealAmount: 8 },
      organs: [
        ...FIXTURE_CONTENT.organs,
        // [S1] 「不出伤」现在由数据声明（`damageMul: 0`），不再从 effect 反推 ——
        // 组合技里「又咬又护」是正当的组合，见 skillDealsDamage 的注释
        organWithSkill("heal-organ", "疗愈", ["heal"], undefined, { damageMul: 0 }),
      ],
    });
    const hurt = armed(content, "heal-organ", { playerHp: 6 });
    const { state: next } = combatAct(hurt, { kind: "skill", skillId: "heal-organ" }, content);
    expect(clashOf(next)?.enemyHp).toBe(40);
    // 6 ＋ 8 = 14，再挨它常规一口 6 → 8
    expect(clashOf(next)?.playerHp).toBe(8);
    expect(combatPreview(hurt, content).skills[0]?.damage).toEqual({ mid: 0, min: 0, max: 0 });
  });

  it("heal 不会超过体（血量上限＝ti）", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, combatSkillHealAmount: 40 },
      organs: [
        ...FIXTURE_CONTENT.organs,
        organWithSkill("heal-organ", "疗愈", ["heal"], undefined, { damageMul: 0 }),
      ],
    });
    const state = armed(content, "heal-organ", {
      playerHp: 18,
      intent: { kind: "guard", text: "它守着。" },
    });
    expect(combatAct(state, { kind: "skill", skillId: "heal-organ" }, content).state.encounter?.clash?.playerHp).toBe(20);
  });

  it("effect=armor 挂护体，受伤减半", () => {
    const content = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, combatWardRounds: 2, combatWardDamageMul: 0.5 },
      organs: [...FIXTURE_CONTENT.organs, organWithSkill("armor-organ", "护体", ["armor"])],
    });
    const { state: next, roundLog } = combatAct(
      armed(content, "armor-organ"),
      { kind: "skill", skillId: "armor-organ" },
      content,
    );
    // 护体当回合就生效：6 × 0.5 = 3
    expect(clashOf(next)?.playerHp).toBe(20 - 3);
    expect(clashOf(next)?.ward).toBe(1);
    expect(roundLog.join("")).toContain("硬物");
  });
});

describe("搏杀：迟滞削出伤", () => {
  it("迟滞期间它出伤打折（6 × 0.75 = 4.5 → 4）", () => {
    const content = pinIntent("bite");
    const state = fighting(ENEMY_QIONG_QI, content, { guardPart: "eye", slow: 2 });
    expect(combatAct(state, BITE("throat"), content).state.encounter?.clash?.playerHp).toBe(20 - 4);
  });
});

describe("搏杀：逃跑", () => {
  it("成功 → over=fled，未损血，combat 清空", () => {
    const surefire = contentWithoutEvents({
      tuning: { ...UNCLAMPED_CHANCE, combatDamageJitter: 0, fleeBase: 1, combatBlindFleeBonus: 0 },
    });
    const { state: next, over, roundLog } = combatAct(fighting(ENEMY_QIONG_QI, surefire), FLEE, surefire);
    expect(over).toBe("fled");
    expect(clashOf(next)).toBeNull();
    expect(next.alive).toBe(true);
    expect(roundLog.join("")).toContain("遁去");
  });

  it("失败 → 战斗继续并挨它这一下", () => {
    const doomed = contentWithoutEvents({
      tuning: {
        ...UNCLAMPED_CHANCE,
        combatDamageJitter: 0,
        fleeBase: 0,
        fleePerLingDiff: 0,
        combatBlindFleeBonus: 0,
      },
    });
    const { state: next, over, roundLog } = combatAct(fighting(ENEMY_QIONG_QI, doomed), FLEE, doomed);
    expect(over).toBeNull();
    expect(clashOf(next)?.playerHp).toBe(20 - 6);
    expect(clashOf(next)?.enemyHp).toBe(40);
    expect(roundLog.join("")).toContain("遁而不得脱");
  });

  it("fleeBias 真的进了公式（同一 ling，野雉必脱、穷奇必不脱）", () => {
    const biasRules = contentWithoutEvents({
      tuning: {
        ...UNCLAMPED_CHANCE,
        combatDamageJitter: 0,
        fleeBase: 0.5,
        fleePerLingDiff: 0,
        fleeBiasFactor: 0.05,
        combatBlindFleeBonus: 0,
      },
    });
    expect(combatAct(fighting(ENEMY_YE_ZHI, biasRules), FLEE, biasRules).over).toBe("fled");
    expect(combatAct(fighting(ENEMY_QIONG_QI, biasRules), FLEE, biasRules).over).toBeNull();
  });

  it("ling 与 enemy.meng 的差进了公式", () => {
    const lingRules = contentWithoutEvents({
      tuning: {
        ...UNCLAMPED_CHANCE,
        combatDamageJitter: 0,
        fleeBase: 0,
        fleePerLingDiff: 0.1,
        fleeBiasFactor: 0,
        combatBlindFleeBonus: 0,
      },
    });
    const dull = fighting(ENEMY_QIONG_QI, lingRules); // ling 13 − 30 < 0 → 0%
    expect(combatAct(dull, FLEE, lingRules).over).toBeNull();
    const bright = { ...dull, stats: { ...dull.stats, ling: 50 } }; // (50−30)×0.1 = 2 → 100%
    expect(combatAct(bright, FLEE, lingRules).over).toBe("fled");
  });
});

describe("搏杀：胜负收束", () => {
  const oneShot = contentWithoutEvents({
    tuning: { combatDamageJitter: 0, combatBiteMul: { throat: 100, leg: 100, eye: 100 } },
  });

  it("敌人血尽 → over=win，吞得精气与饱食，combat 清空", () => {
    const state = fighting(ENEMY_YE_ZHI, oneShot);
    const { state: next, over, roundLog } = combatAct(state, BITE("throat"), oneShot);
    expect(over).toBe("win");
    expect(clashOf(next)).toBeNull();
    expect(next.essence.zu).toBe(12);
    expect(next.essence.xue).toBe(4);
    expect(next.hunger).toBe(60 + 18);
    expect(roundLog.join("")).toContain("毙于爪牙");
  });

  it("战胜写一条 combat 记录（击杀专用，refId=敌人）", () => {
    const { state: next } = combatAct(fighting(ENEMY_YE_ZHI, oneShot), BITE("throat"), oneShot);
    const record = next.records[next.records.length - 1];
    expect(record?.kind).toBe("combat");
    expect(record?.refId).toBe(ENEMY_YE_ZHI);
    expect(record?.text).toContain("野雉");
  });

  it("敌人被打死后不再出手", () => {
    const { state: next, roundLog } = combatAct(
      fighting(ENEMY_YE_ZHI, oneShot, { intent: { kind: "pounce", text: "它要扑。" } }),
      BITE("throat"),
      oneShot,
    );
    expect(next.alive).toBe(true);
    expect(roundLog.join("")).not.toContain("自身受创");
  });

  it("playerHp 见底 → over=dead，ending=slain，death 记录末条", () => {
    const state = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye", playerHp: 1 });
    const { state: next, over } = combatAct(state, BITE("throat"), EXACT);
    expect(over).toBe("dead");
    expect(next.alive).toBe(false);
    expect(next.ending).toBe("slain");
    expect(clashOf(next)).toBeNull();
    const record = next.records[next.records.length - 1];
    expect(record?.kind).toBe("death");
    expect(record?.refId).toBe(ENEMY_QIONG_QI);
    expect(record?.text).toContain("穷奇幼崽");
  });

  it("被打死不写 combat（击杀）记录", () => {
    const state = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye", playerHp: 1 });
    const { state: next } = combatAct(state, BITE("throat"), EXACT);
    expect(next.records.filter((record) => record.kind === "combat")).toHaveLength(0);
  });

  it("round 每回合 +1，log 在 state.encounter?.log 上累积", () => {
    const content = pinIntent("guard");
    let state = fighting(ENEMY_QIONG_QI, content, { guardPart: "eye" });
    state = combatAct(state, BITE("eye"), content).state;
    expect(clashOf(state)?.round).toBe(1);
    const after = state.encounter?.log.length ?? 0;
    state = combatAct(state, BITE("eye"), content).state;
    expect(clashOf(state)?.round).toBe(2);
    expect(state.encounter?.log.length).toBeGreaterThan(after);
  });
});

describe("搏杀：预览与真跑逐字对账（没有预览的按钮就是翻牌）", () => {
  const cases: readonly { name: string; overrides: Parameters<typeof enterCombat>[3] }[] = [
    { name: "常规局面", overrides: { guardPart: "eye" } },
    { name: "打在守备处", overrides: { guardPart: "throat" } },
    { name: "它在守势", overrides: { guardPart: "throat", intent: { kind: "guard", text: "守。" } } },
    { name: "它要扑", overrides: { guardPart: "eye", intent: { kind: "pounce", text: "扑。" } } },
    { name: "伏低", overrides: { guardPart: "eye", stance: "low" } },
    { name: "扑击", overrides: { guardPart: "eye", stance: "lunge" } },
    { name: "已迟滞", overrides: { guardPart: "eye", slow: 2 } },
    { name: "已护体", overrides: { guardPart: "eye", ward: 2 } },
  ];

  for (const { name, overrides } of cases) {
    it(`三颗咬击按钮报的伤害＝真跑的伤害（${name}）`, () => {
      for (const part of ["throat", "leg", "eye"] as const) {
        const state = fighting(ENEMY_QIONG_QI, EXACT, overrides);
        const shown = combatPreview(state, EXACT).bites.find((bite) => bite.part === part);
        const after = combatAct(state, BITE(part), EXACT).state;
        const real = 40 - (clashOf(after)?.enemyHp ?? 0);
        expect(shown?.damage.mid, `${name} / ${part}`).toBe(real);
      }
    });

    it(`「咬完这一下它会打我多少」报的＝真跑挨的（${name}）`, () => {
      /*
       * 打在 `incomingAfter` 而不是 `incomingDamage` 上：咬腿的迟滞与扑眼的致盲**当回合**
       * 就削它这一下，所以三颗按钮各自要报自己那份账。致盲的打空掷骰在这里关掉
       * （必打中），否则量的是运气不是账。
       */
      const content = contentWithoutEvents({
        tuning: { combatDamageJitter: 0, ...NEVER_COUNTER, ...NEVER_MISS },
      });
      for (const part of ["leg", "eye"] as const) {
        const state = fighting(ENEMY_QIONG_QI, content, overrides);
        const shown = combatPreview(state, content).bites.find((bite) => bite.part === part);
        const after = combatAct(state, BITE(part), content).state;
        expect(20 - (clashOf(after)?.playerHp ?? 0), `${name} / ${part}`).toBe(shown?.incomingAfter.mid);
      }
    });
  }

  it("扑眼当回合就让它可能打空，咬腿当回合就削它的出伤（低伤那两颗的全部价值）", () => {
    const state = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "throat" });
    const preview = combatPreview(state, EXACT);
    const eye = preview.bites.find((bite) => bite.part === "eye");
    const leg = preview.bites.find((bite) => bite.part === "leg");
    const throat = preview.bites.find((bite) => bite.part === "throat");
    // [M2-B1] 打空的概率现在来自**眼伤**（每层 woundEyeMissChance），不再是两回合的致盲计数器
    expect(eye?.incomingAfterMissChance).toBe(EXACT.tuning.woundEyeMissChance);
    expect(throat?.incomingAfterMissChance).toBe(0);
    // 咬腿：6 × 0.75 = 4，比咬喉那一下的 6 少一截
    expect(leg?.incomingAfter.mid).toBeLessThan(throat?.incomingAfter.mid ?? 0);
  });

  it("换姿态按钮报的「这一回合会挨多少」＝真跑挨的", () => {
    for (const to of ["low", "lunge"] as const) {
      const state = fighting(ENEMY_QIONG_QI, EXACT, {
        guardPart: "eye",
        intent: { kind: "pounce", text: "扑。" },
      });
      const shown = combatPreview(state, EXACT).stances.find((item) => item.to === to);
      const after = combatAct(state, STANCE(to), EXACT).state;
      expect(shown?.incomingIfSwitch.mid).toBe(20 - (clashOf(after)?.playerHp ?? 0));
    }
  });

  it("器官技按钮报的伤害＝真跑的伤害", () => {
    const state = enterCombat(
      withOrgans(createLife(1, FIXTURE_SEED_ID, EXACT), ORGAN_GOU_CHI),
      ENEMY_QIONG_QI,
      EXACT,
      { guardPart: "eye" },
    );
    const shown = combatPreview(state, EXACT).skills[0];
    const after = combatAct(state, { kind: "skill", skillId: ORGAN_GOU_CHI }, EXACT).state;
    expect(shown?.damage.mid).toBe(40 - (clashOf(after)?.enemyHp ?? 0));
  });

  it("反击的概率与伤害都如实报（必反档下真的挨那么多）", () => {
    const content = contentWithoutEvents({ tuning: { combatDamageJitter: 0, ...ALWAYS_COUNTER } });
    const state = fighting(ENEMY_QIONG_QI, content, { guardPart: "throat" });
    const shown = combatPreview(state, content);
    const bite = shown.bites.find((item) => item.part === "throat");
    expect(bite?.guarded).toBe(true);
    expect(bite?.counterChance).toBe(1);
    const after = combatAct(state, BITE("throat"), content).state;
    expect(20 - (clashOf(after)?.playerHp ?? 0)).toBe(
      shown.incomingDamage.mid + (bite?.counterDamage.mid ?? 0),
    );
  });

  it("「它会走掉」与「咬腿拦得住」两个位如实报", () => {
    const state = fighting(ENEMY_QIONG_QI, EXACT, {
      guardPart: "eye",
      intent: { kind: "flee", text: "它想走。" },
    });
    const preview = combatPreview(state, EXACT);
    expect(preview.enemyWillFlee).toBe(true);
    expect(preview.bites.find((bite) => bite.part === "leg")?.stopsFlee).toBe(true);
    expect(preview.bites.find((bite) => bite.part === "throat")?.stopsFlee).toBe(false);
    expect(combatAct(state, BITE("throat"), EXACT).over).toBe("escaped");
    expect(combatAct(state, BITE("leg"), EXACT).over).toBeNull();
  });

  /**
   * 抖动打开时，按钮上的区间必须**真的**盖住每一种可能的掷骰结果。
   *
   * 这一条是补 code-reviewer 抓到的一个真 bug：原来的 `damageJitter` 写成
   * `round(combatDamageJitter × 倍率)`，而抖动加在**乘倍率之前**、取整在**乘倍率之后**。
   * 低倍率的按钮于是报出「伤 1（无抖动）」而真跑打 2 —— 三分之一的局面对不上账，
   * 且全落在扑眼／咬腿这两颗最需要玩家信得过的按钮上。
   *
   * 之前所有伤害断言都把 `combatDamageJitter` 关成 0「好让公式可断言」，于是整类 bug
   * 无人看守。这一条刻意**开着抖动**，并把三端逐个跑出来对账。
   */
  it("抖动打开时，按钮报的区间盖得住每一种真实掷骰（含守备减半这种低倍率局面）", () => {
    const content = makeContent({ tuning: { combatDamageJitter: 1, ...NEVER_COUNTER } });
    const cases: Parameters<typeof enterCombat>[3][] = [
      { guardPart: "eye" },
      { guardPart: "throat" },
      { guardPart: "throat", intent: { kind: "guard", text: "守。" } },
      { guardPart: "eye", stance: "low" },
      { guardPart: "eye", stance: "lunge" },
    ];
    for (const overrides of cases) {
      for (const part of ["throat", "leg", "eye"] as const) {
        const seen = new Set<number>();
        for (let seed = 0; seed < 60; seed += 1) {
          const state = fighting(ENEMY_QIONG_QI, content, overrides, seed);
          const shown = combatPreview(state, content).bites.find((bite) => bite.part === part);
          const after = combatAct(state, BITE(part), content).state;
          const real = 40 - (clashOf(after)?.enemyHp ?? 0);
          seen.add(real);
          const label = `${JSON.stringify(overrides)} / ${part} / seed ${seed}`;
          expect(shown?.damage.min, label).toBeLessThanOrEqual(real);
          expect(shown?.damage.max, label).toBeGreaterThanOrEqual(real);
        }
        /*
         * 双向对账（这才是「预览不骗人」的完整形式）：
         * - 区间退化成一点时，真跑就**只能**出那一个数（不许偷偷有跨度）；
         * - 区间报了跨度时，真跑就该真的摇出多个数（不许无端把区间放宽，那也是骗人）。
         * 极低倍率（扑眼打在护着的眼上：×0.175）三端都被下限顶成 1，属于前者。
         */
        const shown = combatPreview(fighting(ENEMY_QIONG_QI, content, overrides, 0), content).bites.find(
          (bite) => bite.part === part,
        );
        const label = `${JSON.stringify(overrides)} / ${part}`;
        if (shown && shown.damage.min === shown.damage.max) {
          expect([...seen], label).toEqual([shown.damage.mid]);
        } else {
          expect(seen.size, `${label} 报了跨度却只摇出一个数`).toBeGreaterThan(1);
        }
      }
    }
  });

  it("守备减半 ＋ 守势那种低倍率局面：区间是 1〜2，不是「1 无抖动」", () => {
    const content = makeContent({ tuning: { combatDamageJitter: 1, ...NEVER_COUNTER } });
    // meng 10 → base 4；咬喉 ×1.6 × 守备 0.5 × 守势 0.5 = 0.4
    // floor(3×0.4)=1／floor(4×0.4)=1／floor(5×0.4)=2 —— 手算，不抄源码
    const state = fighting(ENEMY_QIONG_QI, content, {
      guardPart: "throat",
      intent: { kind: "guard", text: "守。" },
    });
    const throat = combatPreview(state, content).bites.find((bite) => bite.part === "throat");
    expect(throat?.damage).toEqual({ mid: 1, min: 1, max: 2 });
  });

  it("它这一合不出手时，受伤区间整段是 0（不被下限顶成 1）", () => {
    const content = makeContent({ tuning: { combatDamageJitter: 1 } });
    const state = fighting(ENEMY_QIONG_QI, content, {
      guardPart: "eye",
      intent: { kind: "guard", text: "守。" },
    });
    const preview = combatPreview(state, content);
    expect(preview.incomingDamage).toEqual({ mid: 0, min: 0, max: 0 });
    expect(preview.stances.find((item) => item.to === "low")?.incomingIfSwitch).toEqual({
      mid: 0,
      min: 0,
      max: 0,
    });
  });

  it("这一咬就能把它打死时，不再许诺部位伤（打死了不必再瞎）", () => {
    const content = pinIntent("guard", { combatDamageJitter: 0 });
    const alive = fighting(ENEMY_YE_ZHI, content, { guardPart: "leg" });
    expect(combatPreview(alive, content).bites.find((bite) => bite.part === "eye")?.woundLands).toBe(true);
    // 血只剩 1，扑眼那一下就致命 → 不该再许诺一层眼伤
    const dying = fighting(ENEMY_YE_ZHI, content, { guardPart: "leg", enemyHp: 1 });
    expect(combatPreview(dying, content).bites.find((bite) => bite.part === "eye")?.woundLands).toBe(false);
  });

  it("combatPreview 不消耗抽取（连调十次 rngState 不动）", () => {
    const state = fighting(ENEMY_QIONG_QI);
    const before = state.rngState;
    for (let i = 0; i < 10; i += 1) combatPreview(state, EXACT);
    expect(state.rngState).toBe(before);
  });

  it("roundsToLive／roundsToKill 是「什么时候该逃」的依据（血越少越小）", () => {
    const healthy = combatPreview(fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye" }), EXACT);
    const dying = combatPreview(
      fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye", playerHp: 7 }),
      EXACT,
    );
    expect(dying.roundsToLive).toBeLessThan(healthy.roundsToLive);
    // 40 血 ÷ 咬喉 6 = 7 下
    expect(healthy.roundsToKill).toBe(7);
    // 它守着不打时 roundsToLive 也不该跳成 99（按常规手估，不按这一回合的意图估）
    const guarding = combatPreview(
      fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye", intent: { kind: "guard", text: "守。" } }),
      EXACT,
    );
    expect(guarding.roundsToLive).toBe(healthy.roundsToLive);
  });
});

describe("搏杀：洞察类器官只改信息，不改结算", () => {
  it("有 combatIntentTags 的器官 → intentKnown 为真", () => {
    const bare = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye" });
    expect(combatPreview(bare, EXACT).intentKnown).toBe(false);
    // fixture 的雾目带 night-eye，在 BASELINE 的 combatIntentTags 里
    const seer = enterCombat(
      withOrgans(createLife(1, FIXTURE_SEED_ID, EXACT), "wu-mu"),
      ENEMY_QIONG_QI,
      EXACT,
      { guardPart: "eye" },
    );
    expect(combatPreview(seer, EXACT).intentKnown).toBe(true);
  });

  it("粗档 intentClass 人人可读：守与逃同为 hold，扑与咬同为 act", () => {
    const classOf = (kind: "pounce" | "bite" | "guard" | "flee"): string =>
      combatPreview(fighting(ENEMY_QIONG_QI, EXACT, { intent: { kind, text: "。" } }), EXACT)
        .intentClass;
    expect(classOf("pounce")).toBe("act");
    expect(classOf("bite")).toBe("act");
    expect(classOf("guard")).toBe("hold");
    expect(classOf("flee")).toBe("hold");
  });

  it("带洞察与不带，同一状态同一动作的推进逐字相同（信息 tag 不是数值加成）", () => {
    const bare = fighting(ENEMY_QIONG_QI, EXACT, { guardPart: "eye" });
    const seer = { ...bare, organIds: [...bare.organIds, "wu-mu"] };
    const a = combatAct(bare, BITE("throat"), EXACT).state.encounter?.clash;
    const b = combatAct(seer, BITE("throat"), EXACT).state.encounter?.clash;
    expect({ ...a, log: [] }).toEqual({ ...b, log: [] });
  });
});

describe("搏杀：不可变约定", () => {
  it("combatAct 不改动入参 state（含 intent 与 skillCooldowns 两个新容器）", () => {
    const state = enterCombat(
      withOrgans(createLife(1, FIXTURE_SEED_ID, EXACT), ORGAN_GOU_CHI),
      ENEMY_QIONG_QI,
      EXACT,
      { guardPart: "eye", skillCooldowns: { [ORGAN_GOU_CHI]: 1 } },
    );
    const snapshot = structuredClone(state);
    combatAct(state, BITE("throat"), EXACT);
    expect(state).toEqual(snapshot);
  });

  it("同一 state 重复调用得到相同结果（无隐藏状态）", () => {
    const content = makeContent({ tuning: { combatDamageJitter: 1 } });
    const state = fighting(ENEMY_QIONG_QI, content, { guardPart: "eye" });
    expect(combatAct(state, BITE("throat"), content).state).toEqual(
      combatAct(state, BITE("throat"), content).state,
    );
  });
});
