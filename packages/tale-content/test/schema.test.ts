/**
 * 内容 schema 校验 —— 70 事件 ＋ 12 器官 ＋ 10 组合 ＋ 3 神种 ＋ 21 敌人 ＋ 15 部件 ＋ 6 去处
 * ＋ 列传模板 ＋ tuning 的静态体检。
 *
 * 这些断言不是形式主义：本库全是手写数据，**一个拼错的 id 或 tag 不会让任何运行时报错，
 * 只会静默变成一条永远不入池的事件、一个永远置灰的按钮、或一个永远拿不到的器官**。
 * 所以凡是「错了也不吵」的东西，都在这里吵。
 *
 * 分四组：
 * 1. 引用完整性（id／tag／flag／器官／敌人 都指向真实存在的东西）
 * 2. 数量与分布（计划 B2 节的硬性清单）
 * 3. 文案纪律（长度、全角标点、标题/label 尺寸）
 * 4. 视觉 token 一致性（brief 里的具名角色必须来自 token 表）
 * 5. [S1] 技能与组合表（12 件器官全部带技、效果分散、配方自洽且凑得到）
 */

import { describe, expect, it } from "vitest";
import {
  FORGE_SKILL_PREFIX,
  WAY_FLAGS,
  chartCost,
  loreCost,
  type EffectDelta,
  type EventChoice,
  type PremiseDef,
  type TaleEvent,
} from "@shiling/tale-sim";
import {
  ALL_EVENT_TAGS,
  ALL_FLAGS,
  ALL_TAGS,
  CHRONICLE_TEMPLATES,
  ENEMIES,
  DESTINATIONS,
  EVENTS,
  EXPLORE_BASE_EVENTS,
  EXPLORE_EVENTS,
  GENERIC_EVENTS,
  HUNT_EVENTS,
  ORGANS,
  ORIGINS,
  PARTS,
  PLACE_EVENTS,
  PREMISE_EVENTS,
  PREY_IDS,
  REST_EVENTS,
  SEEDS,
  SIGILS,
  SKIES,
  SYNERGIES,
  TALE_CONTENT,
  TUNING,
  VISUAL_TOKENS,
} from "../src/index.js";

// ===== 小工具 =====

const ORGAN_IDS = new Set(ORGANS.map((organ) => organ.id));
const SEED_ORGAN_IDS = new Set(SEEDS.map((seed) => seed.organ.id));
const ENEMY_IDS = new Set(ENEMIES.map((enemy) => enemy.id));
const TAG_SET = new Set(ALL_TAGS);
const FLAG_SET = new Set(ALL_FLAGS);
const EVENT_TAG_SET = new Set(ALL_EVENT_TAGS);
/** 内容侧唯一允许**读**的引擎 flag：四条道的资格位（成道出口靠它们入池） */
const READABLE_SYS_FLAGS = new Set<string>(Object.values(WAY_FLAGS));
/** 天时 ＋ 出身：两池合起来是「开局变量」，很多断言对两者同解 */
const PREMISES: readonly PremiseDef[] = [...SKIES, ...ORIGINS];
const ESSENCE_TYPES = ["zu", "lin", "xue", "meng"] as const;
const ENDING_TYPES = ["starve", "slain", "oldage", "ascend"] as const;

/** 字数按码位算（中文全在 BMP，但别让将来某个 emoji 混进来把长度算错）。 */
function charCount(text: string): number {
  return [...text].length;
}

/** 半角标点黑名单 —— 界面文案一律全角（计划「全局约束」）。 */
const ASCII_PUNCT = /[,.;:!?'"()[\]<>~]/;

function allOutcomes(event: TaleEvent) {
  return event.choices.flatMap((choice) => choice.outcomes);
}

function allEffects(): EffectDelta[] {
  return EVENTS.flatMap((event) => allOutcomes(event).map((outcome) => outcome.effects));
}

function gateKinds(choice: EventChoice): string[] {
  const requires = choice.requires;
  if (!requires) return [];
  const kinds: string[] = [];
  if (requires.stats) kinds.push("stats");
  if (requires.organTags) kinds.push("organTags");
  if (requires.essenceMin) kinds.push("essenceMin");
  return kinds;
}

// ===== 1. 引用完整性 =====

describe("引用完整性", () => {
  it("事件 id 唯一且为 qiu- 前缀的 kebab-case", () => {
    const ids = EVENTS.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^qiu-[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("器官／神种／敌人 id 唯一，且神种器官不与普通器官重号", () => {
    expect(ORGAN_IDS.size).toBe(ORGANS.length);
    expect(ENEMY_IDS.size).toBe(ENEMIES.length);
    expect(new Set(SEEDS.map((seed) => seed.id)).size).toBe(SEEDS.length);
    expect(SEED_ORGAN_IDS.size).toBe(SEEDS.length);
    for (const id of SEED_ORGAN_IDS) expect(ORGAN_IDS.has(id)).toBe(false);
  });

  it("所有 tag 都来自 ALL_TAGS（器官声明侧与事件引用侧）", () => {
    for (const organ of [...ORGANS, ...SEEDS.map((seed) => seed.organ)]) {
      for (const tag of organ.tags) expect(TAG_SET.has(tag), `${organ.id} 的未知 tag ${tag}`).toBe(true);
    }
    for (const event of EVENTS) {
      for (const tag of event.trigger.requiresOrganTags ?? []) {
        expect(TAG_SET.has(tag), `${event.id} 的未知 trigger tag ${tag}`).toBe(true);
      }
      for (const choice of event.choices) {
        for (const tag of choice.requires?.organTags ?? []) {
          expect(TAG_SET.has(tag), `${event.id} / ${choice.label} 的未知门槛 tag ${tag}`).toBe(true);
        }
      }
    }
  });

  it("所有 flag 都来自 ALL_FLAGS，且内容侧从不写 sys: 保留前缀", () => {
    for (const event of EVENTS) {
      const read = [...(event.trigger.requiresFlags ?? []), ...(event.trigger.forbidsFlags ?? [])];
      for (const flag of read) {
        // 允许读的引擎 flag 只有四条道的资格位（成道出口靠它们入池）
        if (READABLE_SYS_FLAGS.has(flag)) continue;
        expect(FLAG_SET.has(flag), `${event.id} 读了未知 flag ${flag}`).toBe(true);
      }
      for (const effects of allOutcomes(event).map((outcome) => outcome.effects)) {
        for (const flag of [...(effects.addFlags ?? []), ...(effects.removeFlags ?? [])]) {
          expect(flag.startsWith("sys:"), `${event.id} 试图写引擎保留 flag ${flag}`).toBe(false);
          expect(FLAG_SET.has(flag), `${event.id} 写了未知 flag ${flag}`).toBe(true);
        }
      }
    }
  });

  it("每个 flag 都既被写过也被读过（不留只写不读的死数据）", () => {
    // [2026-08-13] 「写」多了一个来源：开局变量降世时挂的 flag（`PremiseDef.flags`）
    const written = new Set<string>(PREMISES.flatMap((premise) => premise.flags ?? []));
    const read = new Set<string>(TUNING.restHealFlags);
    for (const event of EVENTS) {
      for (const flag of event.trigger.requiresFlags ?? []) read.add(flag);
      for (const flag of event.trigger.forbidsFlags ?? []) read.add(flag);
      for (const effects of allOutcomes(event).map((outcome) => outcome.effects)) {
        for (const flag of effects.addFlags ?? []) written.add(flag);
      }
    }
    for (const flag of ALL_FLAGS) {
      expect(written.has(flag), `flag ${flag} 从未被任何事件写入`).toBe(true);
      expect(read.has(flag), `flag ${flag} 从未被任何 trigger 或 restHealFlags 读取`).toBe(true);
    }
  });

  it("effects 引用的 organId／enemyId／ending 全部存在", () => {
    for (const effects of allEffects()) {
      if (effects.addOrganId !== undefined) {
        expect(ORGAN_IDS.has(effects.addOrganId), `未知器官 ${effects.addOrganId}`).toBe(true);
      }
      if (effects.startCombat !== undefined) {
        expect(ENEMY_IDS.has(effects.startCombat), `未知敌人 ${effects.startCombat}`).toBe(true);
      }
      if (effects.die !== undefined) expect(ENDING_TYPES).toContain(effects.die);
      for (const type of Object.keys(effects.essence ?? {})) {
        expect(ESSENCE_TYPES).toContain(type as (typeof ESSENCE_TYPES)[number]);
      }
    }
  });

  it("tuning 的猎物表与 hunter tag 都指向真实内容", () => {
    expect(TUNING.huntPreyIds.length).toBeGreaterThan(0);
    for (const id of TUNING.huntPreyIds) expect(ENEMY_IDS.has(id)).toBe(true);
    expect(TAG_SET.has(TUNING.huntHunterTag)).toBe(true);
    // hunter tag 没有任何器官提供 = 那 +0.15 的狩猎加成是死数值
    expect(ORGANS.some((organ) => organ.tags.includes(TUNING.huntHunterTag))).toBe(true);
    for (const flag of TUNING.restHealFlags) expect(FLAG_SET.has(flag)).toBe(true);
  });

  /**
   * [M2-B3] 第三条来路：**去处的 `denizens`**（S2 的探索遇袭）。
   *
   * 这一批把敌人从 8 加到 21，而新兽绝大多数只从去处的遇袭里来 —— 若这条测试还只认
   * 「猎物表 ＋ startCombat」，那它会把十三头全判成不可达，或者（更糟）被人为了让它变绿
   * 而给每头新兽硬塞一条事件。denizens 本来就是一条真的召唤路径，补上它才是对的。
   */
  it("每个敌人都够得着（猎物表／某个 startCombat／某处的 denizens）", () => {
    const summoned = new Set<string>(PREY_IDS);
    for (const effects of allEffects()) {
      if (effects.startCombat) summoned.add(effects.startCombat);
    }
    for (const dest of DESTINATIONS) {
      for (const denizen of dest.denizens ?? []) summoned.add(denizen.enemyId);
    }
    for (const enemy of ENEMIES) {
      expect(summoned.has(enemy.id), `敌人 ${enemy.id} 在本世界里永远不会出现`).toBe(true);
    }
  });

  it("每个器官都拿得到（进得了开奖池，或被某个事件直接赠予）", () => {
    const granted = new Set(
      allEffects()
        .map((effects) => effects.addOrganId)
        .filter((id): id is string => id !== undefined),
    );
    for (const organ of ORGANS) {
      const inMoltPool = ESSENCE_TYPES.some((type) => (organ.affinity[type] ?? 0) > 0);
      expect(
        inMoltPool || granted.has(organ.id),
        `器官 ${organ.id} 既不入蛰伏开奖池也无事件赠予`,
      ).toBe(true);
    }
  });

  it("TALE_CONTENT 就是各分池的聚合（没有漏接线）", () => {
    expect(TALE_CONTENT.events).toEqual([...EVENTS]);
    expect(TALE_CONTENT.organs).toEqual([...ORGANS]);
    expect(TALE_CONTENT.seeds).toEqual([...SEEDS]);
    expect(TALE_CONTENT.enemies).toEqual([...ENEMIES]);
    expect(TALE_CONTENT.tuning).toBe(TUNING);
    expect(TALE_CONTENT.chronicleTemplates).toBe(CHRONICLE_TEMPLATES);
  });
});

// ===== 2. 数量与分布（计划 B2 节的硬性清单） =====

describe("数量与分布", () => {
  it("70 事件，按 12／39／4／10／5 分池", () => {
    expect(EVENTS.length).toBe(70);
    expect(HUNT_EVENTS.length).toBe(12);
    // [S2] 探索池 20 → 39：既有 20 条按地点重新归属，`places.ts` 按处补了 19 条
    expect(EXPLORE_EVENTS.length).toBe(39);
    expect(EXPLORE_BASE_EVENTS.length).toBe(20);
    expect(PLACE_EVENTS.length).toBe(19);
    expect(REST_EVENTS.length).toBe(4);
    // [2026-08-13] 通用池 8 → 10：多了妖王与化灵两个成道出口（登神那个「天命」原本就在）
    expect(GENERIC_EVENTS.length).toBe(10);
    // [2026-08-13] 开局变量专属池：大旱 1 ／孤生 2 ／双生 2
    expect(PREMISE_EVENTS.length).toBe(5);
    for (const event of HUNT_EVENTS) expect(event.trigger.actions).toEqual(["hunt"]);
    for (const event of EXPLORE_EVENTS) expect(event.trigger.actions).toEqual(["explore"]);
    for (const event of REST_EVENTS) expect(event.trigger.actions).toEqual(["rest"]);
    for (const event of GENERIC_EVENTS) expect(event.trigger.actions).toBeUndefined();
    for (const event of PREMISE_EVENTS) expect(event.trigger.actions).toBeUndefined();
  });

  /**
   * 开局变量专属池的**存在理由**就是「只在那一类开局里出现」——
   * 漏写 `requiresFlags` 的那一条会变成一条所有人都撞得到的普通事件，而没有任何别的
   * 测试会红（它照样入池、照样能玩），于是「第二局不一样」被静默削掉一块。
   */
  it("开局变量专属事件必须挂在某个开局变量的 flag 上", () => {
    const premiseFlags = new Set(PREMISES.flatMap((premise) => premise.flags ?? []));
    expect(premiseFlags.size).toBeGreaterThan(0);
    for (const event of PREMISE_EVENTS) {
      const gated = (event.trigger.requiresFlags ?? []).some((flag) => premiseFlags.has(flag));
      expect(gated, `${event.id} 没有挂在任何开局变量的 flag 上`).toBe(true);
    }
    // 反过来：每个挂了 flag 的开局变量都得真有专属内容（否则那个 flag 是死数据）
    for (const premise of PREMISES) {
      for (const flag of premise.flags ?? []) {
        expect(
          PREMISE_EVENTS.some((event) => (event.trigger.requiresFlags ?? []).includes(flag)),
          `开局变量 ${premise.id} 的 flag ${flag} 没有任何专属事件`,
        ).toBe(true);
      }
    }
  });

  it("通用池覆盖四季，且季节值合法", () => {
    const seasons = new Set(GENERIC_EVENTS.flatMap((event) => event.trigger.seasons ?? []));
    expect([...seasons].sort()).toEqual([0, 1, 2, 3]);
    for (const event of EVENTS) {
      for (const season of event.trigger.seasons ?? []) expect([0, 1, 2, 3]).toContain(season);
    }
  });

  it("once 稀有事件 ≥6", () => {
    const once = EVENTS.filter((event) => event.trigger.once);
    expect(once.length).toBeGreaterThanOrEqual(6);
  });

  it("三类抉择门槛各 ≥4 处", () => {
    const counts = { stats: 0, organTags: 0, essenceMin: 0 } as Record<string, number>;
    for (const event of EVENTS) {
      for (const choice of event.choices) {
        for (const kind of gateKinds(choice)) counts[kind] = (counts[kind] ?? 0) + 1;
      }
    }
    expect(counts.stats).toBeGreaterThanOrEqual(4);
    expect(counts.organTags).toBeGreaterThanOrEqual(4);
    expect(counts.essenceMin).toBeGreaterThanOrEqual(4);
  });

  it("坏结局兜底（die／startCombat）≥6 处", () => {
    const bad = allEffects().filter(
      (effects) => effects.die !== undefined || effects.startCombat !== undefined,
    );
    expect(bad.length).toBeGreaterThanOrEqual(6);
  });

  it("trigger 各字段取值合法（region／weight／年龄区间／minStats）", () => {
    for (const event of EVENTS) {
      const trigger = event.trigger;
      expect(["any", "qingqiu"]).toContain(trigger.region);
      expect(Number.isInteger(trigger.weight)).toBe(true);
      expect(trigger.weight, `${event.id} 权重越界`).toBeGreaterThanOrEqual(1);
      expect(trigger.weight, `${event.id} 权重越界`).toBeLessThanOrEqual(100);
      if (trigger.minYear !== undefined && trigger.maxYear !== undefined) {
        expect(trigger.minYear).toBeLessThanOrEqual(trigger.maxYear);
      }
      for (const value of Object.values(trigger.minStats ?? {})) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it("每个事件 1〜4 抉择，label 不重复，且至少有一个无门槛抉择", () => {
    for (const event of EVENTS) {
      expect(event.choices.length, `${event.id} 抉择数`).toBeGreaterThanOrEqual(2);
      expect(event.choices.length, `${event.id} 抉择数`).toBeLessThanOrEqual(4);
      const labels = event.choices.map((choice) => choice.label);
      expect(new Set(labels).size, `${event.id} label 重复`).toBe(labels.length);
      // 全部抉择都带门槛 = 玩家可能一个都点不了 = 界面卡死在这张事件卡上
      expect(
        event.choices.some((choice) => choice.requires === undefined),
        `${event.id} 没有无门槛抉择，可能卡死`,
      ).toBe(true);
    }
  });

  it("每个抉择 outcomes 非空且权重 1〜100", () => {
    for (const event of EVENTS) {
      for (const choice of event.choices) {
        expect(choice.outcomes.length, `${event.id} / ${choice.label}`).toBeGreaterThanOrEqual(1);
        for (const outcome of choice.outcomes) {
          expect(outcome.weight).toBeGreaterThanOrEqual(1);
          expect(outcome.weight).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it("门槛数值落在合理量程（属性 0〜100、精气 ≥1、tag 非空）", () => {
    for (const event of EVENTS) {
      for (const choice of event.choices) {
        const requires = choice.requires;
        if (!requires) continue;
        for (const value of Object.values(requires.stats ?? {})) {
          expect(value).toBeGreaterThan(0);
          expect(value).toBeLessThanOrEqual(100);
        }
        for (const value of Object.values(requires.essenceMin ?? {})) {
          expect(value).toBeGreaterThan(0);
        }
        if (requires.organTags) expect(requires.organTags.length).toBeGreaterThan(0);
      }
    }
  });

  it("12 器官覆盖 6 槽与 4 型精气，affinity 在 0〜1，且战斗技 ≥3 件", () => {
    expect(ORGANS.length).toBe(12);
    expect(new Set(ORGANS.map((organ) => organ.slot)).size).toBe(6);
    for (const type of ESSENCE_TYPES) {
      const pool = ORGANS.filter((organ) => (organ.affinity[type] ?? 0) > 0);
      // 一世最多蜕 4〜5 件，池子少于 3 件时后期开奖会频繁空转
      expect(pool.length, `${type} 型开奖池太薄`).toBeGreaterThanOrEqual(3);
    }
    for (const organ of ORGANS) {
      for (const value of Object.values(organ.affinity)) {
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      for (const value of Object.values(organ.statMods ?? {})) {
        expect(Math.abs(value)).toBeLessThanOrEqual(10);
      }
    }
    expect(ORGANS.filter((organ) => organ.combatSkill).length).toBeGreaterThanOrEqual(3);
  });

  it("3 神种，恰有一个免费种，cost 递增合理", () => {
    expect(SEEDS.length).toBe(3);
    expect(SEEDS.filter((seed) => seed.cost === 0).length).toBe(1);
    for (const seed of SEEDS) {
      expect(seed.cost).toBeGreaterThanOrEqual(0);
      expect(seed.cost).toBeLessThanOrEqual(20);
    }
  });

  /*
   * 追猎战术档案（M1-P1）。这一组守的是三条**内容改动时最容易静默出错**的不变量：
   *
   * 1. `startDistance` 超过 `tuning.stalkLoseDistance` 的敌人是**一出场就死的内容**：
   *    第一个动作还没做完就判「跟丢」，玩家做什么都没用，而没有任何别的测试会红。
   * 2. 猎物表里的四头必须写全 `stalkFlavor` —— 它们是玩家真会读到那些句子的猎物；
   *    漏写只会静默退回引擎兜底池（四头说同一套话，正是 M0 被 owner 说「廉价」的那件事）。
   * 3. 每个填了的槽必须 ≥2 条变体：一场追猎要潜行三四次，一句到底就是复读。
   */
  it("追猎战术档案：距离/警觉在可玩量程内", () => {
    for (const enemy of ENEMIES) {
      if (enemy.startDistance !== undefined) {
        expect(enemy.startDistance, `${enemy.id} 起手距离 ≤0`).toBeGreaterThan(0);
        /*
         * 连**起手抖动**都不许越过跟丢线：越过就是「第一个动作还没做完就判跟丢」的死内容。
         * 起追之后被屏息的挪位推过线是**设计里的风险**（界面明写「也可能就此走远」），
         * 所以这里只卡起手，不留一整次潜行的余量。
         */
        expect(
          enemy.startDistance + TUNING.stalkStartDistanceJitter,
          `${enemy.id} 起手距离 ${enemy.startDistance} 加抖动后越过跟丢线 ${TUNING.stalkLoseDistance}`,
        ).toBeLessThanOrEqual(TUNING.stalkLoseDistance);
      }
      if (enemy.wariness !== undefined) {
        expect(enemy.wariness).toBeGreaterThanOrEqual(0);
        // 起手警觉就贴着惊走线的猎物，第一次潜行必然把它惊走
        expect(
          enemy.wariness,
          `${enemy.id} 起手警觉 ${enemy.wariness} 太接近惊走线`,
        ).toBeLessThanOrEqual(TUNING.stalkAlertMax - 2 * TUNING.stalkCreepAlert);
      }
    }
  });

  /*
   * [M2-B1] 行为段与弱点。这一组守的也是「内容改动时静默出错」那一类：
   *
   * 1. `stages[0].at` 必须是 1 —— 否则开场那一段根本进不去（`stageIndexOf` 取的是
   *    「最后一个满足 hp/max ≤ at 的段」，第一段够不着就等于整头兽少一段）；
   * 2. `at` 必须**严格递减** —— 两段同 `at` 会让「它变了」这件事变成一次随机跳变；
   * 3. 除第一段外每段都要有 `text` —— 换段是玩家该当场读到的一句，缺了就是静默换打法；
   * 4. `weakness.part` 必须是三个部位之一，且 `text` 非空。
   */
  it("[M2-B1] 行为段：第一段恒为 1、其后严格递减、换段都有宣告", () => {
    for (const enemy of ENEMIES) {
      const stages = enemy.stages;
      if (!stages) continue;
      expect(stages.length, `${enemy.id} 声明了 stages 却是空的`).toBeGreaterThan(1);
      expect(stages[0]?.at, `${enemy.id} 第一段的 at 必须是 1（否则开场那一段进不去）`).toBe(1);
      for (let i = 1; i < stages.length; i += 1) {
        expect(
          stages[i]!.at,
          `${enemy.id} 第 ${i + 1} 段的 at 没有严格小于上一段`,
        ).toBeLessThan(stages[i - 1]!.at);
        expect(stages[i]!.at, `${enemy.id} 第 ${i + 1} 段的 at 不在 (0,1)`).toBeGreaterThan(0);
        expect(
          stages[i]!.text.length,
          `${enemy.id} 第 ${i + 1} 段没有宣告句 —— 换段必须当场读得到`,
        ).toBeGreaterThan(0);
        expect(stages[i]!.name.length).toBeGreaterThan(0);
      }
    }
  });

  it("[M2-B1] 弱点：部位合法、名号与宣告句都写了", () => {
    const parts = new Set(["throat", "leg", "eye"]);
    let withWeakness = 0;
    for (const enemy of ENEMIES) {
      const weakness = enemy.weakness;
      if (!weakness) continue;
      withWeakness += 1;
      expect(parts.has(weakness.part), `${enemy.id} 弱点部位 ${weakness.part} 不合法`).toBe(true);
      expect(weakness.name.length, `${enemy.id} 弱点没有名号`).toBeGreaterThan(0);
      expect(weakness.text.length, `${enemy.id} 弱点没有识破那一句`).toBeGreaterThan(0);
    }
    // 「大多数兽有弱点、但不是全部」是这条机制的设计：没有弱点的那头（穷奇）逼玩家答另一道题
    expect(withWeakness).toBeGreaterThanOrEqual(ENEMIES.length - 2);
    expect(withWeakness).toBeLessThan(ENEMIES.length);
  });

  /*
   * [M2-B1] **弱点必须真的能成为最优的一咬** —— 否则屏幕上那句「破绽在此」是空话。
   *
   * 这条是实机抄屏抓出来的：第一版把穴鼠与草狐的弱点放在眼上，而扑眼的部位倍率只有 0.35，
   * 乘上弱点的 1.6 才 0.56 —— 连「咬喉被护住」的 0.8 都不到。于是识破之后推荐链照旧咬喉，
   * 玩家花几合试出来的那个「破绽」一次都用不上。这类失效**不会有任何别的测试变红**
   * （弱点照样识破、伤害照样翻倍，只是翻完还是最差的一手），所以只能在这里钉住。
   */
  it("[M2-B1] 弱点所在的部位必须打得过一记被护住的咬喉（否则「破绽在此」是空话）", () => {
    const floor = TUNING.combatBiteMul.throat * TUNING.combatGuardDamageMul;
    for (const enemy of ENEMIES) {
      const weakness = enemy.weakness;
      if (!weakness) continue;
      const found = TUNING.combatBiteMul[weakness.part] * TUNING.weaknessDamageMul;
      expect(
        found,
        `${enemy.id} 的弱点在「${weakness.part}」：识破后倍率 ${found.toFixed(2)}，` +
          `连一记被护住的咬喉（${floor.toFixed(2)}）都打不过 —— 这个破绽永远不会被采用`,
      ).toBeGreaterThan(floor);
    }
  });

  it("追猎旁白：猎物表四头必须写全，每槽 ≥2 条变体且占位合法", () => {
    const SLOTS = ["begin", "creep", "circle", "wait", "stir", "catch", "miss", "escape"] as const;
    const KNOWN_VARS = /\{\{(enemy|steps)\}\}/g;
    for (const id of TUNING.huntPreyIds) {
      const prey = ENEMIES.find((enemy) => enemy.id === id);
      const flavor = prey?.stalkFlavor;
      expect(flavor, `猎物 ${id} 没写 stalkFlavor（会退回引擎兜底池，四头说同一套话）`).toBeDefined();
      for (const slot of SLOTS) {
        const pool = flavor?.[slot];
        expect(pool, `猎物 ${id} 缺 ${slot} 槽`).toBeDefined();
        expect(pool?.length, `猎物 ${id} 的 ${slot} 只有一条变体`).toBeGreaterThanOrEqual(2);
        for (const line of pool ?? []) {
          expect(line.length, `猎物 ${id} 的 ${slot} 有空句`).toBeGreaterThan(4);
          // 未知占位会原样渲染到屏幕上（引擎的 render 刻意不静默吞掉）
          expect(
            line.replace(KNOWN_VARS, ""),
            `猎物 ${id} 的 ${slot} 有未知占位：${line}`,
          ).not.toMatch(/\{\{/);
        }
      }
    }
    // 反扑的猎物要有自己的反扑旁白（那是一世里最戏剧化的一句）
    for (const enemy of ENEMIES) {
      if (enemy.retaliates && TUNING.huntPreyIds.includes(enemy.id)) {
        expect(enemy.stalkFlavor?.retaliate?.length, `${enemy.id} 会反扑却没写反扑旁白`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  /*
   * ===== [M2-B3] 敌人扩容的四条不变量 =====
   *
   * 全部是「错了也不吵」的那一类：借错脸只会渲染成一块空框、偏好写歪只是屏幕上少一行、
   * 坡度断了要玩到第五世才觉出不对 —— 没有一条会让别的测试变红。
   */

  it("[M2-B3] 难度是一条连续的坡：从教具到墙，每一档都有兽", () => {
    /*
     * 判据不是「有多少头」，是**相邻两档之间的空档有多大**。B1 的遗留 3 说的正是这件事：
     * 8 头兽里从岩羊（meng 10）直接跳到草狐（14）再跳到山魈（20）、玄蟒（32）——
     * 中段那一片没有兽，于是「必胜」与「打不过」之间没有过渡。
     *
     * 这里用 `meng × hp` 当难度的粗代理（它是敌人出伤与耐打的乘积，和实测胜率单调相关；
     * 真正的胜率矩阵在 `--lab matrix` 里量，那要跑 400 场，不适合放进单测）。
     */
    const scores = ENEMIES.map((enemy) => enemy.meng * enemy.hp).sort((a, b) => a - b);
    expect(scores.length).toBeGreaterThanOrEqual(20);
    /*
     * **教具层刻意不进这条判据**（分数 <200：野雉／穴鼠／文鳐／灌灌／赤鱬）。
     * 它们与真正要打的兽之间本来就该有一道坎 —— 一只鸟不该是「岩羊的下一档」，
     * 它是另一件东西（那一段的题目是追猎，不是搏杀）。所以这里量的是**搏杀那条坡**。
     */
    const teaching = scores.filter((score) => score < 200);
    expect(teaching.length, "教具层（三四合可下的）少于四头").toBeGreaterThanOrEqual(4);
    const fights = scores.filter((score) => score >= 200);
    for (let i = 1; i < fights.length; i += 1) {
      const prev = fights[i - 1]!;
      const gap = fights[i]! / Math.max(1, prev);
      expect(
        gap,
        `难度坡上有一处断层：${prev} → ${fights[i]}（相邻两档不许拉开一半以上）`,
      ).toBeLessThanOrEqual(1.5);
    }
    // 中段（打得赢之上、墙之下）必须真的有一批兽，否则「坡」只是首尾两端连了一条线
    const mid = fights.filter((score) => score >= 250 && score <= 1300);
    expect(mid.length, "中段（要动脑才赢的那一档）少于六头").toBeGreaterThanOrEqual(6);
  });

  it("[M2-B3] 头像：借的那一头真实存在、自己不再借，且 8 张老图全被指着", () => {
    const byId = new Map(ENEMIES.map((enemy) => [enemy.id, enemy]));
    for (const enemy of ENEMIES) {
      if (enemy.artId === undefined) continue;
      const lender = byId.get(enemy.artId);
      expect(lender, `${enemy.id} 借的 ${enemy.artId} 不是一头真的兽`).toBeDefined();
      expect(lender?.artId, `${enemy.id} 借的那一头自己也在借（不许接力）`).toBeUndefined();
      expect(enemy.artId, `${enemy.id} 借了自己`).not.toBe(enemy.id);
    }
    // 自己有图的恰好是 B4 画过的那 8 头 —— 多一头没借就是漏配
    const own = ENEMIES.filter((enemy) => enemy.artId === undefined);
    expect(own.length, "自带头像的不是 8 头（B4 只出了 8 张）").toBe(8);
  });

  it("[M2-B3] 食之所偏：部件真实、精气型对得上、最大的那一型必被列到", () => {
    const partById = new Map(PARTS.map((part) => [part.id, part]));
    const seedOrganIds = new Set(SEEDS.map((seed) => seed.organ.id));
    let withBias = 0;
    for (const enemy of ENEMIES) {
      const bias = enemy.partBias;
      if (!bias || bias.length === 0) continue;
      withBias += 1;
      const types = new Set<string>();
      for (const partId of bias) {
        const part = partById.get(partId);
        expect(part, `${enemy.id} 的 partBias 指向不存在的部件 ${partId}`).toBeDefined();
        if (!part) continue;
        /*
         * 神种产出的三件（蕴／血／胎）不许出现在这里：它们不从精气开奖来，
         * 而「食之所偏」写的正是「吃了它，攒的是哪一件的本钱」——
         * 一件根本买不到的东西写在那儿是一句假承诺。
         */
        expect(
          seedOrganIds.has(part.organId),
          `${enemy.id} 把神种部件 ${part.name} 写进了食之所偏（那一件不是精气买得到的）`,
        ).toBe(false);
        expect(
          Object.prototype.hasOwnProperty.call(enemy.essence, part.essenceType),
          `${enemy.id} 偏向 ${part.name}（${part.essenceType} 型），可它自己不产这一型精气`,
        ).toBe(true);
        types.add(part.essenceType);
      }
      const richest = Object.entries(enemy.essence).sort(
        (a, b) => (b[1] ?? 0) - (a[1] ?? 0),
      )[0]?.[0];
      expect(
        richest !== undefined && types.has(richest),
        `${enemy.id} 产出最多的是 ${richest} 型，而食之所偏一件都没落在那一型上 —— 这一行就成了装饰`,
      ).toBe(true);
    }
    expect(withBias, "有一头兽没写食之所偏").toBe(ENEMIES.length);

    // 反过来：精气开奖得到的每一件部件，都至少有一头兽是它的本钱来源
    const covered = new Set(ENEMIES.flatMap((enemy) => [...(enemy.partBias ?? [])]));
    for (const part of PARTS) {
      if (seedOrganIds.has(part.organId)) continue;
      const organ = ORGANS.find((item) => item.id === part.organId);
      // 龙涎那类事件专属器官（affinity 全空）不进开奖池，猎哪一头都攒不出来
      const inMoltPool = Object.values(organ?.affinity ?? {}).some((weight) => (weight ?? 0) > 0);
      if (!inMoltPool) continue;
      expect(
        covered.has(part.id),
        `部件 ${part.name} 没有任何一头兽是它的本钱来源 —— 玩家无从知道该去猎什么`,
      ).toBe(true);
    }
  });

  it("[M2-B3] 没有后腿的兽必须自报「腿」该叫什么（否则旁白会说鱼有后腿）", () => {
    /*
     * 引擎的咬腿旁白原来写死「后腿」，而这一批把鱼／鸟／蛇／带甲的东西都放进了可打的名册
     * —— 实机当场读到「蠃鱼的后腿已经拖在地上」。这条测试钉住的是**内容那一半的责任**：
     * 凡带这几个 tag 的兽都得自报一个词。它不会有别的测试变红（旁白照样渲染，只是错的）。
     */
    const NO_HIND_LEG = ["fish", "bird", "venom", "shell"];
    for (const enemy of ENEMIES) {
      if (!enemy.tags.some((tag) => NO_HIND_LEG.includes(tag))) continue;
      expect(
        enemy.legWord,
        `${enemy.id} 带 ${enemy.tags.join("/")} 却没写 legWord —— 咬腿那几句会说它有后腿`,
      ).toBeDefined();
      expect(enemy.legWord?.length ?? 0).toBeGreaterThan(0);
      expect(enemy.legWord).not.toBe("后腿");
    }
  });

  it("[M2-B3] 守备与弱点是配对定的（护着的那一处不许同时是软肋所在的最优解）", () => {
    /*
     * B1 立下的规矩只卡了「弱点部位撑不撑得起」（倍率 > 0.8）。这一批加的是**配对**那一半：
     * 一头护喉的兽，弱点若也在喉，那它识破前后都只该咬喉 —— 顺序没有变化，
     * 「看懂了」这件事就没有兑现处。所以：**护得最重的那一处，不许同时是弱点所在**，
     * 除非那一处是喉（喉是全库唯一「识破后倍率 2.56 远高于一切」的部位，
     * 玄蟒与九尾狐那种「它护着的正是软肋」恰恰是这套机制最好的一处兑现）。
     */
    for (const enemy of ENEMIES) {
      const weakness = enemy.weakness;
      const guard = enemy.guardBias;
      if (!weakness || !guard) continue;
      if (weakness.part === "throat") continue;
      /*
       * 并列时的 tie-break 写成**显式**的（按部位名排序再取最大），而不是靠
       * `Object.entries` 的插入顺序 —— 九尾狐正好是 `throat 4 / eye 4` 并列。
       * 那一头今天不受这条判据影响（它的弱点在腿，两边都豁免），
       * 但一条判据的结论取决于一个字段的书写顺序，是下一次改内容时的静默陷阱。
       */
      const entries = (Object.entries(guard) as [string, number][]).sort((a, b) =>
        b[1] - a[1] || a[0].localeCompare(b[0]),
      );
      const top = entries[0]!;
      expect(
        top[0] === weakness.part && top[1] > 2,
        `${enemy.id} 护得最重的是 ${top[0]}（权重 ${top[1]}），而弱点也在那儿 —— ` +
          `识破前后都只该咬别处，那个破绽兑现不出来`,
      ).toBe(false);
    }
  });

  it("21 敌人，含 ≥1 divine，数值量程合理", () => {
    expect(ENEMIES.length).toBe(21);
    expect(ENEMIES.some((enemy) => enemy.tags.includes("divine"))).toBe(true);
    for (const enemy of ENEMIES) {
      expect(enemy.meng).toBeGreaterThan(0);
      expect(enemy.hp).toBeGreaterThan(0);
      expect(enemy.fleeBias).toBeGreaterThanOrEqual(-20);
      expect(enemy.fleeBias).toBeLessThanOrEqual(20);
      expect(Object.keys(enemy.essence).length, `${enemy.id} 吞食无所得`).toBeGreaterThan(0);
      for (const type of Object.keys(enemy.essence)) {
        expect(ESSENCE_TYPES).toContain(type as (typeof ESSENCE_TYPES)[number]);
      }
    }
  });
});

// ===== 3. 文案纪律 =====

describe("文案纪律", () => {
  it("正文 60〜150 字", () => {
    for (const event of EVENTS) {
      const length = charCount(event.body);
      expect(length, `${event.id} 正文 ${length} 字`).toBeGreaterThanOrEqual(60);
      expect(length, `${event.id} 正文 ${length} 字`).toBeLessThanOrEqual(150);
    }
  });

  it("标题 2〜6 字，抉择 label 4〜12 字", () => {
    for (const event of EVENTS) {
      const title = charCount(event.title);
      expect(title, `${event.id} 标题 ${title} 字`).toBeGreaterThanOrEqual(2);
      expect(title, `${event.id} 标题 ${title} 字`).toBeLessThanOrEqual(6);
      for (const choice of event.choices) {
        const label = charCount(choice.label);
        expect(label, `${event.id} / ${choice.label} ${label} 字`).toBeGreaterThanOrEqual(4);
        expect(label, `${event.id} / ${choice.label} ${label} 字`).toBeLessThanOrEqual(12);
      }
    }
  });

  it("outcome 文案非空且不超过 80 字", () => {
    for (const event of EVENTS) {
      for (const outcome of allOutcomes(event)) {
        const length = charCount(outcome.text);
        expect(length, `${event.id} outcome 为空`).toBeGreaterThan(0);
        expect(length, `${event.id} outcome ${length} 字`).toBeLessThanOrEqual(80);
      }
    }
  });

  it("界面文案一律全角标点（含列传模板）", () => {
    const texts: string[] = [];
    for (const event of EVENTS) {
      texts.push(event.title, event.body);
      for (const choice of event.choices) texts.push(choice.label);
      for (const outcome of allOutcomes(event)) texts.push(outcome.text);
    }
    for (const organ of [...ORGANS, ...SEEDS.map((seed) => seed.organ)]) {
      texts.push(organ.name, organ.desc);
    }
    for (const enemy of ENEMIES) texts.push(enemy.name, enemy.desc);
    for (const seed of SEEDS) texts.push(seed.name, seed.desc);
    texts.push(
      CHRONICLE_TEMPLATES.opening,
      CHRONICLE_TEMPLATES.praisePrefix,
      ...Object.values(CHRONICLE_TEMPLATES.endings),
      ...Object.values(CHRONICLE_TEMPLATES.wayEndings),
      ...CHRONICLE_TEMPLATES.praise.map((variant) => variant.text),
    );
    // [2026-08-13] 开局变量的三行文案都会上屏（降世屏／择神种屏／列传开篇）
    for (const premise of PREMISES) texts.push(premise.name, premise.effect, premise.desc);
    for (const text of texts) {
      expect(ASCII_PUNCT.test(text), `半角标点：${text}`).toBe(false);
    }
  });

  it("列传模板：四结局齐备、赞语末项无条件兜底、占位名全部已知", () => {
    for (const ending of ENDING_TYPES) {
      expect(charCount(CHRONICLE_TEMPLATES.endings[ending])).toBeGreaterThan(0);
    }
    // [2026-08-13] 四条道各一段结语（缺一条就会退回泛用的登神段，而那对归山是错的）
    for (const way of ["shen", "yaowang", "guishan", "hualing"] as const) {
      expect(charCount(CHRONICLE_TEMPLATES.wayEndings[way]), `${way} 缺结语`).toBeGreaterThan(0);
    }
    // 四段不许互相重复 —— 重复就等于那两条道没有自己的结局
    expect(new Set(Object.values(CHRONICLE_TEMPLATES.wayEndings)).size).toBe(4);
    // 赞语必须真的按道分支（否则归山读到的仍是登神那句）
    expect(CHRONICLE_TEMPLATES.praise.some((variant) => variant.ways)).toBe(true);
    expect(CHRONICLE_TEMPLATES.seasonNames.length).toBe(4);
    expect(CHRONICLE_TEMPLATES.praise.length).toBeGreaterThanOrEqual(4);
    const ids = CHRONICLE_TEMPLATES.praise.map((variant) => variant.id);
    expect(new Set(ids).size).toBe(ids.length);
    const last = CHRONICLE_TEMPLATES.praise[CHRONICLE_TEMPLATES.praise.length - 1];
    expect(last?.minDe).toBeUndefined();
    expect(last?.maxDe).toBeUndefined();
    expect(last?.endings).toBeUndefined();
    // 赞语必须真的分支：至少各有一条按 de 与按 ending 挑的
    expect(
      CHRONICLE_TEMPLATES.praise.some((variant) => variant.minDe !== undefined),
    ).toBe(true);
    expect(CHRONICLE_TEMPLATES.praise.some((variant) => variant.maxDe !== undefined)).toBe(true);
    expect(CHRONICLE_TEMPLATES.praise.some((variant) => variant.endings)).toBe(true);

    const known = new Set([
      "seedName",
      "years",
      "organCount",
      "moltCount",
      "killCount",
      // [2026-08-13] 夺命数与开局前提（引擎 composeChronicle 的 vars 里新增的三个）
      "livesTaken",
      "skyName",
      "originName",
      "meng",
      "ling",
      "ti",
      "de",
      "year",
      "season",
      "text",
    ]);
    const templates = [
      CHRONICLE_TEMPLATES.titleTemplate,
      CHRONICLE_TEMPLATES.opening,
      CHRONICLE_TEMPLATES.middleLine,
      ...Object.values(CHRONICLE_TEMPLATES.endings),
      ...Object.values(CHRONICLE_TEMPLATES.wayEndings),
      ...CHRONICLE_TEMPLATES.praise.map((variant) => variant.text),
    ];
    for (const template of templates) {
      for (const match of template.matchAll(/\{\{(\w+)\}\}/g)) {
        expect(known.has(match[1] ?? ""), `未知占位 ${match[0]}`).toBe(true);
      }
    }
  });
});

// ===== 4. 视觉 token 一致性 =====

describe("视觉 token", () => {
  it("token id／name 唯一，desc 必须包含 name", () => {
    expect(new Set(VISUAL_TOKENS.map((token) => token.id)).size).toBe(VISUAL_TOKENS.length);
    expect(new Set(VISUAL_TOKENS.map((token) => token.name)).size).toBe(VISUAL_TOKENS.length);
    for (const token of VISUAL_TOKENS) {
      expect(token.desc.includes(token.name), `${token.id} 的 desc 不含 name`).toBe(true);
      expect(charCount(token.desc)).toBeGreaterThan(charCount(token.name));
    }
  });

  it("每个事件都有非空 illustrationBrief（B4 美术管线的输入）", () => {
    for (const event of EVENTS) {
      expect(event.illustrationBrief, `${event.id} 缺 brief`).toBeTruthy();
      expect(charCount(event.illustrationBrief ?? ""), `${event.id} brief 太短`).toBeGreaterThan(20);
    }
  });

  // B4 已交付（2026-08-11）：44 张事件插图全部生成并回填，原先「illustration 应留给 B4 回填」
  // 的断言就地换成命名约定断言 —— 客户端拼的是 `ART_DIR + illustration`（ART_DIR="/art/"），
  // 所以值必须是 `events/<事件 id>.webp` 这一种形状。文件名与事件 id 绑死，命名一漂就红，
  // 静默 404（界面只是空图位，不报错）才不会溜过去。
  /**
   * [2026-08-13] 2026-08-13 批次新加的 7 条事件**还没有图**（美术管线要单独跑一轮）。
   *
   * 白名单是刻意留的、且必须**逐条列名**：不列名就只能把断言放宽成「有图的才检查命名」，
   * 那等于给「以后某次改名把一批图变成孤儿」留了藏身处。名单里每一条都写了
   * `illustrationBrief`（管线的输入已经备好），补图时把它从名单里删掉即可。
   */
  const EVENTS_AWAITING_ART = new Set([
    "qiu-way-yaowang",
    "qiu-way-hualing",
    "qiu-dry-springhead",
    "qiu-lone-path",
    "qiu-lone-winter",
    "qiu-twin-call",
    "qiu-twin-fall",
    // [S2] 去处专属的 19 条（`events/places.ts`）—— 美术管线要单独跑一轮
    "qiu-path-worn",
    "qiu-tan-sunken",
    "qiu-tan-scale-drift",
    "qiu-tan-no-bottom",
    "qiu-tan-heart-pearl",
    "qiu-feng-eyrie",
    "qiu-feng-gap",
    "qiu-feng-cloud-root",
    "qiu-ci-incense",
    "qiu-ci-clay-figure",
    "qiu-ci-slips",
    "qiu-ku-blind-fish",
    "qiu-ku-stone-teat",
    "qiu-ku-old-mark",
    "qiu-ku-earth-marrow",
    "qiu-yuan-ash-egg",
    "qiu-yuan-unburnt",
    "qiu-yuan-great-bones",
    "qiu-yuan-thunder-marrow",
  ]);

  it("每个事件的 illustration 都是 events/<id>.webp（B4 产出的命名约定）", () => {
    for (const event of EVENTS) {
      if (EVENTS_AWAITING_ART.has(event.id)) {
        expect(event.illustration, `${event.id} 在待补图名单里却已有图（该把它从名单删掉）`).toBeUndefined();
        continue;
      }
      expect(event.illustration, `${event.id} 缺 illustration`).toBe(`events/${event.id}.webp`);
    }
    // 名单只许收敛，不许出现名单里已经不存在的事件 id
    for (const id of EVENTS_AWAITING_ART) {
      expect(EVENTS.some((event) => event.id === id), `待补图名单里的 ${id} 已不存在`).toBe(true);
    }
  });

  it("brief 里出现的具名角色／地点必须引用 token 表的权威描述", () => {
    for (const event of EVENTS) {
      const brief = event.illustrationBrief ?? "";
      for (const token of VISUAL_TOKENS) {
        if (!brief.includes(token.name)) continue;
        expect(
          brief.includes(token.desc),
          `${event.id} 的 brief 裸写了「${token.name}」，应改用 VT.${token.id} 拼接`,
        ).toBe(true);
      }
    }
  });

  /**
   * [M2-B3] 判据加了**第二个消费方**：`packages/gen` 的 `enemyJobs()`。
   *
   * 它按「敌人名里包含的最长 token name」取形貌去生头像 —— 于是一头兽的 token 即使
   * 一条 brief 都没引用，也照样是活的（它是那头兽将来那张脸的正本）。
   * 这一批加了十三头新兽的形貌，全部属于这一类。判据仍然是「不许有死条目」，
   * 只是死的定义从「没进 brief」改成「**两个消费方都用不到**」。
   */
  it("token 表没有死条目（进了某条 brief，或是某头敌人的形貌来源）", () => {
    const briefs = EVENTS.map((event) => event.illustrationBrief ?? "").join("\n");
    // 与 artManifest.tokenDescForEnemy 同一条规则：敌人名里包含的最长 token name
    const usedByEnemy = new Set<string>();
    for (const enemy of ENEMIES) {
      const hit = [...VISUAL_TOKENS]
        .filter((token) => enemy.name.includes(token.name))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (hit) usedByEnemy.add(hit.id);
    }
    for (const token of VISUAL_TOKENS) {
      expect(
        briefs.includes(token.desc) || usedByEnemy.has(token.id),
        `token ${token.id} 既没进任何 brief，也不是任何一头敌人的形貌来源`,
      ).toBe(true);
    }
  });

  it("每个敌人都在 token 表里有形貌（B4 头像与插图共用同一形貌的前提）", () => {
    const tokenNames = VISUAL_TOKENS.map((token) => token.name);
    for (const enemy of ENEMIES) {
      expect(
        tokenNames.some((name) => enemy.name.includes(name)),
        `敌人 ${enemy.name} 缺视觉 token`,
      ).toBe(true);
    }
  });
});

/*
 * ===== 5. [S1] 技能与组合表 =====
 *
 * 这一组守的是 S1 的三条设计约束 —— 每一条错了都**不会有任何运行时报错**：
 * 少一件器官带技 ＝ 那一世蜕出它只涨属性（owner 原话「摸不着头脑」的来源）；
 * 效果全是纯伤害 ＝ 技能池是一排等价按钮；配方指向不存在的器官 ＝ 一条永远凑不齐的组合
 * （而图鉴上那一格会永远是「？」，玩家会一直去凑一个不存在的东西）。
 */

describe("S1 器官战斗技", () => {
  it("12 件器官**全部**带 combatSkill（S1 之前只有 4 件）", () => {
    const missing = ORGANS.filter((organ) => !organ.combatSkill).map((organ) => organ.id);
    expect(missing).toEqual([]);
    expect(ORGANS).toHaveLength(12);
  });

  it("每个技都有冷却与代价 —— 只有冷却的技是「转好了就按」", () => {
    for (const organ of ORGANS) {
      const skill = organ.combatSkill;
      expect(skill?.cooldown, organ.id).toBeGreaterThanOrEqual(2);
      expect(skill?.cost, organ.id).toBeDefined();
      if (skill?.cost?.kind === "hp") {
        // 自伤要付得起：出生体质 20，代价过半就成了陷阱按钮
        expect(skill.cost.amount, organ.id).toBeLessThanOrEqual(5);
      } else if (skill?.cost?.kind === "essence") {
        // 精气代价不能超过蜕变阈值的四分之一 —— 否则一次技就吃掉小半个蜕变
        expect(skill.cost.amount, organ.id).toBeLessThanOrEqual(TALE_CONTENT.tuning.moltThreshold / 4);
      }
    }
  });

  it("效果类型分散：至少 6 档不同的效果在用，纯伤害技不超过 2 件", () => {
    const kinds = new Set(ORGANS.flatMap((organ) => organ.combatSkill?.effects ?? []));
    expect(kinds.size).toBeGreaterThanOrEqual(6);
    const pureDamage = ORGANS.filter((organ) => (organ.combatSkill?.effects ?? []).length === 0);
    expect(pureDamage.map((organ) => organ.id).length).toBeLessThanOrEqual(2);
  });

  it("控制／防御类技的伤害倍率压在缺省之下（否则三颗咬击按钮又废了）", () => {
    const control = ["blind", "stun", "thorns", "brace", "insight", "bolt", "heal"];
    for (const organ of ORGANS) {
      const skill = organ.combatSkill;
      if (!skill?.effects?.some((effect) => control.includes(effect))) continue;
      expect(skill.damageMul ?? TALE_CONTENT.tuning.organSkillDamageMul, organ.id).toBeLessThan(
        TALE_CONTENT.tuning.organSkillDamageMul,
      );
    }
  });

  it("精气代价的型跟着器官的 affinity 走（付的是养出它的那一型）", () => {
    for (const organ of ORGANS) {
      const cost = organ.combatSkill?.cost;
      if (cost?.kind !== "essence") continue;
      expect(organ.affinity[cost.type], organ.id).toBeGreaterThan(0);
    }
  });

  it("不出伤的技必须显式写 damageMul: 0（靠 rollDamage 的下限会偷偷打 1 点）", () => {
    const noDamage = ["heal", "bolt", "insight", "brace"];
    for (const organ of ORGANS) {
      const skill = organ.combatSkill;
      if (!skill) continue;
      const onlyNoDamage =
        (skill.effects ?? []).length > 0 &&
        (skill.effects ?? []).every((effect) => noDamage.includes(effect));
      if (onlyNoDamage) expect(skill.damageMul, organ.id).toBe(0);
    }
  });
});

describe("S1 器官组合表（异变）", () => {
  it("10 条组合，id 唯一且不与器官 id 撞", () => {
    expect(SYNERGIES).toHaveLength(10);
    const ids = SYNERGIES.map((synergy) => synergy.id);
    expect(new Set(ids).size).toBe(ids.length);
    const organIds = new Set(ORGANS.map((organ) => organ.id));
    for (const id of ids) expect(organIds.has(id)).toBe(false);
  });

  // [M2-B2] `syn:` 已不再生成（组合表降级成古法，走 `forge:`），但两个前缀都要守住：
  // 一个漏网的器官 id 会让 `ClashState.skillCooldowns` 的键与招式册撞上
  it("器官 id 不许以 syn: / forge: 开头（skillId 命名空间要分得开）", () => {
    for (const organ of [...ORGANS, ...SEEDS.map((seed) => seed.organ)]) {
      expect(organ.id.startsWith("syn:"), organ.id).toBe(false);
      expect(organ.id.startsWith(FORGE_SKILL_PREFIX), organ.id).toBe(false);
    }
  });

  it("配方是 2〜3 件**真实存在**的器官，且同一条里不重复", () => {
    const organIds = new Set(ORGANS.map((organ) => organ.id));
    for (const synergy of SYNERGIES) {
      expect(synergy.organIds.length, synergy.id).toBeGreaterThanOrEqual(2);
      expect(synergy.organIds.length, synergy.id).toBeLessThanOrEqual(3);
      expect(new Set(synergy.organIds).size, synergy.id).toBe(synergy.organIds.length);
      for (const id of synergy.organIds) expect(organIds.has(id), `${synergy.id} → ${id}`).toBe(true);
    }
  });

  it("没有两条组合共用同一份配方（否则一次凑齐会同时报两条，玩家分不出是哪一条给的）", () => {
    const keys = SYNERGIES.map((synergy) => [...synergy.organIds].sort().join("+"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * 「情理之中」没法被断言（那是文案判断，由报告里的第②问回答），但**它的载体必须在**：
   * `reveal` 是因果那一句，缺了它揭示演出就只剩「解锁了一个新按钮」。
   */
  it("每条都有因果一句（reveal）与风味（desc），且都不是占位", () => {
    for (const synergy of SYNERGIES) {
      expect(synergy.reveal.length, synergy.id).toBeGreaterThanOrEqual(10);
      expect(synergy.desc.length, synergy.id).toBeGreaterThanOrEqual(10);
      expect(synergy.reveal, synergy.id).not.toContain("TODO");
      expect(synergy.skill.desc.length, synergy.id).toBeGreaterThanOrEqual(10);
    }
  });

  it("组合技的冷却与代价都比单件器官技重一档（它是攒来的，不是白拿的）", () => {
    const organMaxCooldown = Math.max(
      ...ORGANS.map((organ) => organ.combatSkill?.cooldown ?? TALE_CONTENT.tuning.combatSkillCooldown),
    );
    for (const synergy of SYNERGIES) {
      expect(synergy.skill.cooldown, synergy.id).toBeGreaterThanOrEqual(4);
      expect(synergy.skill.cost, synergy.id).toBeDefined();
      // 三件配方的那两条（capstone）要最贵
      if (synergy.organIds.length === 3) {
        expect(synergy.skill.cooldown, synergy.id).toBeGreaterThanOrEqual(organMaxCooldown + 1);
      }
    }
  });

  /**
   * 组合技必须**与任何单件器官技不同形** —— 否则凑齐两件器官换来的只是「又一颗按钮」。
   *
   * 判据不写成「≥2 条效果或更高倍率」：那会漏掉一类真正的新东西 —— 「穿地」是
   * 「出伤 ＋ 这一合免伤」，而 12 件器官里带 `brace` 的那件（合鳞）**不出伤**。
   * 「同一组效果、伤害不低于它」才是「同形」的定义。
   */
  it("每条组合技都与所有单件器官技不同形（不能只是「又一个技」）", () => {
    const key = (effects: readonly string[]): string => [...effects].sort().join("+");
    const organSkills = ORGANS.map((organ) => ({
      id: organ.id,
      key: key(organ.combatSkill?.effects ?? []),
      mul: organ.combatSkill?.damageMul ?? TALE_CONTENT.tuning.organSkillDamageMul,
    }));
    for (const synergy of SYNERGIES) {
      const mul = synergy.skill.damageMul ?? TALE_CONTENT.tuning.organSkillDamageMul;
      const sameShape = organSkills.find(
        (organ) => organ.key === key(synergy.skill.effects ?? []) && organ.mul >= mul,
      );
      expect(sameShape?.id ?? null, synergy.id).toBeNull();
    }
  });

  /**
   * **凑得到**才算数（这一条是数值约束，不是洁癖）：蛰伏开奖按 `affinity × 该型精气` 加权，
   * 所以一世拿到的器官大概率同属一两个精气型。若某一型没有任何**同型可凑**的配方，
   * 走那条精气线的玩家首世发现率近乎零 —— 那时「隐藏」就不是惊喜而是无感。
   */
  it("四型精气各有至少一条「同型可凑」的配方（首世发现率的下限）", () => {
    const organById = new Map(ORGANS.map((organ) => [organ.id, organ] as const));
    for (const type of ["zu", "lin", "xue", "meng"] as const) {
      const reachable = SYNERGIES.filter((synergy) =>
        synergy.organIds.every((id) => (organById.get(id)?.affinity[type] ?? 0) >= 0.2),
      );
      expect(reachable.length, type).toBeGreaterThanOrEqual(1);
    }
  });
});

// ===== 6. [S2] 探索去处（门槛公开、风险单调、事件池归属、秘藏各一） =====

describe("探索去处（S2）", () => {
  const DEST_IDS = new Set(DESTINATIONS.map((destination) => destination.id));
  const TREASURE_IDS = new Set(DESTINATIONS.map((destination) => destination.treasure.id));

  it("六处，id 唯一，且**恰有一处无门槛**（否则探索按钮可能整排是灰的）", () => {
    expect(DESTINATIONS.length).toBe(6);
    expect(DEST_IDS.size).toBe(DESTINATIONS.length);
    const free = DESTINATIONS.filter((destination) => destination.requiresOrganIds.length === 0);
    expect(free.map((destination) => destination.id)).toEqual([DESTINATIONS[0]?.id]);
  });

  it("门槛引用真实器官，且 1〜2 件（三件的门槛在实测里几乎开不出来）", () => {
    for (const destination of DESTINATIONS) {
      expect(destination.requiresOrganIds.length, destination.id).toBeLessThanOrEqual(2);
      for (const id of destination.requiresOrganIds) {
        expect(ORGAN_IDS.has(id), `${destination.id} 门槛引用了不存在的器官 ${id}`).toBe(true);
      }
      // 神种器官不许当门槛：人人都有，等于没门槛
      expect(SEED_ORGAN_IDS.has(destination.requiresOrganIds[0] ?? ""), destination.id).toBe(false);
    }
  });

  /**
   * **每一型精气都要在某处门口有一只脚**（这一节是数值，不是文风）。
   *
   * 蛰伏开奖按 `affinity × 该型精气` 加权，所以一世拿到的器官大概率同属一两个型。
   * 若某一型的玩家连一处去处的门槛都沾不上，「探索有方向」这件事对他就不存在。
   *
   * 判据是**弱形**（门槛里**至少有一件**对该型 affinity ≥ 0.2），不是「整副门槛同型」：
   * 穴系（夜瞳／鳞甲／穴爪）实测就够不着强形 —— 幽潭要一件鳞系的浮鳔、秘窟要一件鳞系的
   * 雾目。那**是设计**：穴系是「深处」那条线，它离两处双件门槛各只差一件，而那一件正是
   * 「我这一世要去凑什么」。强形会逼着把某处的门槛改成同型，而那会让六处的门槛挤在两型上。
   */
  it("四型精气各在某处门口有一只脚（affinity ≥ 0.2）", () => {
    const organById = new Map(ORGANS.map((organ) => [organ.id, organ] as const));
    for (const type of ESSENCE_TYPES) {
      const reachable = DESTINATIONS.filter((destination) =>
        destination.requiresOrganIds.some(
          (id) => (organById.get(id)?.affinity[type] ?? 0) >= 0.2,
        ),
      );
      expect(reachable.length, `${type} 型一处去处的门槛都沾不上`).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * **三处单件门槛要落在三个不同的精气型上**（那是「第一世就开得出一处新地方」的下限）。
   *
   * 若三处单件门槛全挂在足系上，非足系的玩家第一世一处新地方都开不出来 ——
   * 而 S2 的成败恰恰在于「第一次看见一处新去处」那一刻。
   */
  it("三处单件门槛分属三个不同的精气型", () => {
    const organById = new Map(ORGANS.map((organ) => [organ.id, organ] as const));
    const singles = DESTINATIONS.filter(
      (destination) => destination.requiresOrganIds.length === 1,
    );
    expect(singles.length).toBe(3);
    const mainTypes = singles.map((destination) => {
      const organ = organById.get(destination.requiresOrganIds[0] ?? "");
      const entries = Object.entries(organ?.affinity ?? {}) as [string, number][];
      return entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    });
    expect(new Set(mainTypes).size, `三处单件门槛的主亲和：${mainTypes.join("、")}`).toBe(3);
  });

  it("兽名真实存在；除常路外每处都有兽（没有兽的「险地」不成其为险）", () => {
    for (const destination of DESTINATIONS) {
      for (const denizen of destination.denizens) {
        expect(ENEMY_IDS.has(denizen.enemyId), `${destination.id} 的 ${denizen.enemyId}`).toBe(true);
        expect(denizen.weight, `${destination.id}`).toBeGreaterThan(0);
      }
      if (destination.peril !== "calm") {
        expect(destination.denizens.length, `${destination.id} 是险地却无兽`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * 三档风险必须**单调**：越险越贵、事越密、越容易遇袭。
   *
   * 一处「更险但收益不变」的去处不是取舍，是陷阱 —— 而这一批的全部主张就是
   * 「往哪走」是一道**算得清**的题。
   */
  it("三档风险的数单调（越险越贵、事越密、越容易遇袭）", () => {
    const { calm, wary, grim } = TUNING.explorePeril ?? TALE_CONTENT.tuning.explorePeril;
    expect(calm.ambushChance).toBeLessThan(wary.ambushChance);
    expect(wary.ambushChance).toBeLessThan(grim.ambushChance);
    expect(calm.travelCost).toBeLessThan(wary.travelCost);
    expect(wary.travelCost).toBeLessThan(grim.travelCost);
    expect(calm.eventMul).toBeLessThan(wary.eventMul);
    expect(wary.eventMul).toBeLessThan(grim.eventMul);
  });

  it("每处一件秘藏，id 唯一，因果与说明都不是占位", () => {
    expect(TREASURE_IDS.size).toBe(DESTINATIONS.length);
    for (const destination of DESTINATIONS) {
      const treasure = destination.treasure;
      expect(charCount(treasure.name), treasure.id).toBeGreaterThanOrEqual(2);
      expect(charCount(treasure.reveal), treasure.id).toBeGreaterThanOrEqual(10);
      expect(charCount(treasure.desc), treasure.id).toBeGreaterThanOrEqual(10);
      expect(treasure.reveal, treasure.id).not.toContain("TODO");
    }
  });

  it("景物词每处 ≥5 个且互不重复（它是 AI 生成事件的机械判据）", () => {
    const seen = new Map<string, string>();
    for (const destination of DESTINATIONS) {
      expect(destination.scenery.length, destination.id).toBeGreaterThanOrEqual(5);
      for (const word of destination.scenery) {
        const owner = seen.get(word);
        expect(owner, `景物词「${word}」同时属于 ${owner} 与 ${destination.id}`).toBeUndefined();
        seen.set(word, destination.id);
      }
    }
  });

  /**
   * **每一条探索事件都必须声明去处**，且每处都要有事件可撞。
   *
   * 漏声明的那一条会在六处全部出现 —— 那就是换皮而不是新世界，而且不会有别的测试变红
   * （它照样入池、照样能玩）。这一条正是这一批「独立事件池」的判据。
   */
  it("探索事件全部声明了去处，去处 id 真实存在", () => {
    for (const event of EXPLORE_EVENTS) {
      const destinations = event.trigger.destinations ?? [];
      expect(destinations.length, `${event.id} 没有声明去处`).toBeGreaterThan(0);
      for (const id of destinations) {
        expect(DEST_IDS.has(id), `${event.id} 声明了不存在的去处 ${id}`).toBe(true);
      }
    }
  });

  it("不限行动的事件**不许**声明去处（那类写的是天气与时令，不是地方）", () => {
    for (const event of EVENTS) {
      if (event.trigger.actions !== undefined) continue;
      expect(event.trigger.destinations, `${event.id}`).toBeUndefined();
    }
  });

  it("每处至少 6 条事件（少于这个数，那一处读起来就是同一批事件换了名字）", () => {
    for (const destination of DESTINATIONS) {
      const pool = EXPLORE_EVENTS.filter((event) =>
        (event.trigger.destinations ?? []).includes(destination.id),
      );
      expect(pool.length, `${destination.id} 只有 ${pool.length} 条事件`).toBeGreaterThanOrEqual(6);
    }
  });

  /** 秘藏必须真的有一条事件发得出来，否则图鉴上那一格永远是「？」。 */
  it("每件秘藏都有恰好一条事件发得出来，且那条事件属于它自己那一处", () => {
    for (const destination of DESTINATIONS) {
      const givers = EXPLORE_EVENTS.filter((event) =>
        event.choices.some((choice) =>
          choice.outcomes.some(
            (outcome) => outcome.effects.findTreasureId === destination.treasure.id,
          ),
        ),
      );
      expect(givers.length, `${destination.treasure.id} 的出处`).toBeGreaterThanOrEqual(1);
      for (const giver of givers) {
        expect(
          (giver.trigger.destinations ?? []).includes(destination.id),
          `${giver.id} 发的是 ${destination.id} 的秘藏，却不在那一处的池子里`,
        ).toBe(true);
        // 秘藏不该是第一季就撞上的东西（那样它只是一件装备）
        expect(giver.trigger.once, `${giver.id} 的秘藏事件不是 once`).toBe(true);
      }
    }
  });

  it("`findTreasureId` 只许引用真实秘藏", () => {
    for (const event of EVENTS) {
      for (const outcome of allOutcomes(event)) {
        const id = outcome.effects.findTreasureId;
        if (id === undefined) continue;
        expect(TREASURE_IDS.has(id), `${event.id} 引用了不存在的秘藏 ${id}`).toBe(true);
      }
    }
  });
});

/**
 * [S3] 世家印记与三份价目表。
 *
 * 这一组守的是**经济学**而不是拼写：四类消费共用一笔点数（一世产 3〜8），
 * 定价错了不会有任何运行时报错，只会让 owner 在第十三世发现「点数又没处花了」——
 * 而那正是这一批要治的病。所以「花得完」与「买不全」两条都写成可执行的断言。
 */
describe("[S3] 世家印记与血统价目表", () => {
  it("印记数量 > 上限（否则「买哪三枚」不是一道题）", () => {
    expect(SIGILS.length).toBeGreaterThan(TUNING.sigilCap!);
  });

  it("id 唯一、价钱为正、每一枚都真的给了点什么", () => {
    expect(new Set(SIGILS.map((sigil) => sigil.id)).size).toBe(SIGILS.length);
    for (const sigil of SIGILS) {
      expect(sigil.cost, `${sigil.id} 的价钱`).toBeGreaterThan(0);
      const stats = Object.values(sigil.statMods).filter((value) => (value ?? 0) !== 0);
      expect(
        stats.length > 0 || (sigil.hungerBonus ?? 0) > 0,
        `${sigil.id} 什么都不给`,
      ).toBe(true);
    }
  });

  it("**一枚只动一件事**（读起来才是「一枚印记＝一件事」）", () => {
    for (const sigil of SIGILS) {
      const touched =
        Object.values(sigil.statMods).filter((value) => (value ?? 0) !== 0).length +
        ((sigil.hungerBonus ?? 0) > 0 ? 1 : 0);
      expect(touched, `${sigil.id} 同时动了 ${touched} 件事`).toBe(1);
    }
  });

  it("**加成必须小**：满员三枚的属性总和 < 一件器官的量级（四道门槛在 40〜90 之间）", () => {
    const perSigil = SIGILS.map((sigil) =>
      Object.values(sigil.statMods).reduce((sum, value) => sum + (value ?? 0), 0),
    ).sort((a, b) => b - a);
    const worst = perSigil.slice(0, TUNING.sigilCap!).reduce((sum, value) => sum + value, 0);
    // 12 件器官里 statMods 最大的那一件 —— 印记满员也不该超过它
    const bestOrgan = Math.max(
      ...ORGANS.map((organ) =>
        Object.values(organ.statMods ?? {}).reduce((sum, value) => sum + (value ?? 0), 0),
      ),
    );
    expect(worst).toBeLessThanOrEqual(bestOrgan);
  });

  it("文案不是占位（名号带「印记」，因果句成句）", () => {
    for (const sigil of SIGILS) {
      expect(sigil.name).toContain("印记");
      expect(sigil.desc.length, `${sigil.id} 的因果句`).toBeGreaterThanOrEqual(12);
      expect(sigil.desc.endsWith("。")).toBe(true);
    }
  });

  it("图录：**每一处有门槛的去处都卖得出去**，兽径那一处恒 0（不上货架）", () => {
    for (const destination of DESTINATIONS) {
      const cost = chartCost(destination.id, TALE_CONTENT);
      if (destination.requiresOrganIds.length === 0) {
        expect(cost, `${destination.id} 无门槛却标了价`).toBe(0);
      } else {
        expect(cost, `${destination.id} 的图录`).toBeGreaterThan(0);
      }
    }
  });

  it("图鉴知识：八头都卖得出去，且越凶越贵（严格单调不要求，但不许反着来）", () => {
    const byMeng = [...ENEMIES].sort((a, b) => a.meng - b.meng);
    let prev = 0;
    for (const enemy of byMeng) {
      const cost = loreCost(enemy.id, TALE_CONTENT);
      expect(cost, `${enemy.id} 的知识`).toBeGreaterThan(0);
      expect(cost, `${enemy.id} 比更弱的兽还便宜`).toBeGreaterThanOrEqual(prev);
      prev = cost;
    }
  });

  /**
   * 经济学第一条：**永远有东西可买**。
   *
   * 「一世一次」的两类（血脉／图录）里最便宜的那一样，价钱不得高于一世产出的下界（3）＋ 一点，
   * 否则一个短命的玩家会连着几世什么都买不起 —— 那就是 S3 之前的状态换了个说法。
   */
  it("最便宜的一次性消费买得起（一世产 3〜8 点）", () => {
    const cheapestChart = Math.min(
      ...DESTINATIONS.filter((place) => place.requiresOrganIds.length > 0).map((place) =>
        chartCost(place.id, TALE_CONTENT),
      ),
    );
    expect(Math.min(TUNING.bloodlineBoonCost!, cheapestChart)).toBeLessThanOrEqual(4);
  });

  /**
   * 经济学第二条：**买不全**。
   *
   * 「一世一次」的两类加起来必须**大于**一世产出的下界，否则每一世都能两样全买，
   * 那道取舍（这一世带器官，还是下深处）就不存在了。
   */
  it("血脉 ＋ 最便宜的图录 > 一世产出的下界（3）—— 两样不能都买", () => {
    const cheapestChart = Math.min(
      ...DESTINATIONS.filter((place) => place.requiresOrganIds.length > 0).map((place) =>
        chartCost(place.id, TALE_CONTENT),
      ),
    );
    expect(TUNING.bloodlineBoonCost! + cheapestChart).toBeGreaterThan(3);
  });

  /**
   * 经济学第三条：**一次性的那三类要够玩很多世**。
   *
   * 神种（13）＋ 八头知识 ＋ 满员印记的总额，除以一世产出的上界（8），至少要五世 ——
   * 少于这个数，owner 玩到第五世就又回到「点数无处可花」。
   * （**只是下界**：一次性买空之后，一世一次的血脉与图录仍然恒有东西可买，见下一条。）
   */
  it("一次性消费总额 ≥ 五世的满额产出（不许几世就买空）", () => {
    const seeds = SEEDS.reduce((sum, seed) => sum + seed.cost, 0);
    const lores = ENEMIES.reduce((sum, enemy) => sum + loreCost(enemy.id, TALE_CONTENT), 0);
    const sigils = [...SIGILS]
      .sort((a, b) => a.cost - b.cost)
      .slice(0, TUNING.sigilCap!)
      .reduce((sum, sigil) => sum + sigil.cost, 0);
    expect(seeds + lores + sigils).toBeGreaterThanOrEqual(5 * 8);
  });
});
