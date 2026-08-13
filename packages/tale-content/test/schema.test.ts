/**
 * 内容 schema 校验 —— 44 事件 ＋ 12 器官 ＋ 10 组合 ＋ 3 神种 ＋ 8 敌人 ＋ 列传模板 ＋ tuning 的静态体检。
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
  WAY_FLAGS,
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
  PLACE_EVENTS,
  PREMISE_EVENTS,
  PREY_IDS,
  REST_EVENTS,
  SEEDS,
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

  it("每个敌人都够得着（在猎物表里，或被某个 startCombat 引用）", () => {
    const summoned = new Set<string>(PREY_IDS);
    for (const effects of allEffects()) {
      if (effects.startCombat) summoned.add(effects.startCombat);
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

  it("8 敌人，含 ≥1 divine，数值量程合理", () => {
    expect(ENEMIES.length).toBe(8);
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

  it("token 表没有死条目（每个 token 至少被一条 brief 用到）", () => {
    const briefs = EVENTS.map((event) => event.illustrationBrief ?? "").join("\n");
    for (const token of VISUAL_TOKENS) {
      expect(briefs.includes(token.desc), `token ${token.id} 从未被任何 brief 引用`).toBe(true);
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

  it("器官 id 不许以 syn: 开头（skillId 命名空间要分得开）", () => {
    for (const organ of [...ORGANS, ...SEEDS.map((seed) => seed.organ)]) {
      expect(organ.id.startsWith("syn:"), organ.id).toBe(false);
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
