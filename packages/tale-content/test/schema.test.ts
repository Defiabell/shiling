/**
 * 内容 schema 校验 —— 44 事件 ＋ 12 器官 ＋ 3 神种 ＋ 8 敌人 ＋ 列传模板 ＋ tuning 的静态体检。
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
 */

import { describe, expect, it } from "vitest";
import {
  SYS_FLAG_ASCEND_READY,
  type EffectDelta,
  type EventChoice,
  type TaleEvent,
} from "@shiling/tale-sim";
import {
  ALL_FLAGS,
  ALL_TAGS,
  CHRONICLE_TEMPLATES,
  ENEMIES,
  EVENTS,
  EXPLORE_EVENTS,
  GENERIC_EVENTS,
  HUNT_EVENTS,
  ORGANS,
  PREY_IDS,
  REST_EVENTS,
  SEEDS,
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
        if (flag === SYS_FLAG_ASCEND_READY) continue; // 唯一允许读的引擎 flag（登神门槛）
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
    const written = new Set<string>();
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
  it("44 事件，按 12／20／4／8 分池", () => {
    expect(EVENTS.length).toBe(44);
    expect(HUNT_EVENTS.length).toBe(12);
    expect(EXPLORE_EVENTS.length).toBe(20);
    expect(REST_EVENTS.length).toBe(4);
    expect(GENERIC_EVENTS.length).toBe(8);
    for (const event of HUNT_EVENTS) expect(event.trigger.actions).toEqual(["hunt"]);
    for (const event of EXPLORE_EVENTS) expect(event.trigger.actions).toEqual(["explore"]);
    for (const event of REST_EVENTS) expect(event.trigger.actions).toEqual(["rest"]);
    for (const event of GENERIC_EVENTS) expect(event.trigger.actions).toBeUndefined();
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
      ...CHRONICLE_TEMPLATES.praise.map((variant) => variant.text),
    );
    for (const text of texts) {
      expect(ASCII_PUNCT.test(text), `半角标点：${text}`).toBe(false);
    }
  });

  it("列传模板：四结局齐备、赞语末项无条件兜底、占位名全部已知", () => {
    for (const ending of ENDING_TYPES) {
      expect(charCount(CHRONICLE_TEMPLATES.endings[ending])).toBeGreaterThan(0);
    }
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
  it("每个事件的 illustration 都是 events/<id>.webp（B4 产出的命名约定）", () => {
    for (const event of EVENTS) {
      expect(event.illustration, `${event.id} 缺 illustration`).toBe(`events/${event.id}.webp`);
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
