/**
 * 开局变量（天时／出身）与四道的机制测试 —— 2026-08-13「每局不同」批次。
 *
 * 这份测试守的是这一批**唯一的**产品主张：开局变量真改机制、四条道各自可达。
 * 每一条都对着一种「看着有效、其实没效」的失败模式：
 *
 * | 断言 | 它防的那种静默失效 |
 * |---|---|
 * | `tuningDelta` 真的落在结算上 | 降世屏写着「每季多饿 3」而实扣照旧 —— 玩家只当那是风味字 |
 * | `eventWeightMul` 只在抽取阶段生效 | 改了 content 里的 `weight` 原值 ＝ 污染所有一世 ＋ 击穿确定性 |
 * | 专属事件靠 flag 入池 | 漏挂 flag ＝ 那条线变成人人都撞得到的普通事件 |
 * | `livesTaken` 三个来源都记 | 少记一处 ＝ 化灵这条道可以靠某条路径「白吃」 |
 * | 寿终那一刻的一次判定 | 两套并行逻辑 ＝ 归山备了却仍报「终未成器」 |
 * | `rollPremise` 与 `createLife` 同解 | 择神种屏预告的世道与真正降生的不是一个 |
 */

import { describe, expect, it } from "vitest";
import {
  SYS_FLAG_DIVINE_EATEN,
  availableActions,
  WAY_FLAGS,
  WAY_ORDER,
  combatAct,
  composeChronicle,
  createLife,
  lifeTuning,
  performAction,
  premiseOf,
  resolveChoice,
  rollPremise,
  stalkAct,
  waysProgress,
  type PremiseDef,
  type TaleContent,
  type TaleEvent,
  type TaleState,
} from "../src/index.js";
import {
  ALWAYS_POUNCE,
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  FIXTURE_ORIGIN,
  FIXTURE_SEED_ID,
  FIXTURE_SKY,
  contentWithoutEvents,
  enterCombat,
  makeContent,
  NEAR,
} from "./fixtures.js";

const PLAIN = contentWithoutEvents();

/** 造一份「只有这一个天时」的 content —— 掷出来的必然是它，断言不必猜种子。 */
function withSky(sky: Partial<PremiseDef>, extra: Parameters<typeof makeContent>[0] = {}): TaleContent {
  return contentWithoutEvents({ ...extra, skies: [{ ...FIXTURE_SKY, ...sky }] });
}

function withOrigin(origin: Partial<PremiseDef>): TaleContent {
  return contentWithoutEvents({ origins: [{ ...FIXTURE_ORIGIN, ...origin }] });
}

describe("降世：天时与出身怎么落进这一世", () => {
  it("两者都记进 state，且与 rollPremise 的只读预览逐字相同", () => {
    const life = createLife(20260813, FIXTURE_SEED_ID, PLAIN);
    const preview = rollPremise(20260813, PLAIN);
    expect(life.skyId).toBe(preview.sky.id);
    expect(life.originId).toBe(preview.origin.id);
    expect(premiseOf(life, PLAIN).sky.id).toBe(life.skyId);
  });

  /**
   * 择神种那一屏在 `createLife` **之前**就要显示「此世大旱」，靠的就是这条约定：
   * 天时与出身恒是一世的头两次抽取。在它们之前插入别的抽取会让预览与实际分叉。
   */
  it("预览只依赖 seedNum（与选了哪枚神种无关）", () => {
    const paid = makeContent({
      seeds: [
        ...PLAIN.seeds,
        { ...PLAIN.seeds[0]!, id: "seed-other", organ: { ...PLAIN.seeds[0]!.organ, id: "organ-other" } },
      ],
      events: [],
    });
    const a = createLife(777, FIXTURE_SEED_ID, paid);
    const b = createLife(777, "seed-other", paid);
    expect(a.skyId).toBe(b.skyId);
    expect(a.originId).toBe(b.originId);
    expect(rollPremise(777, paid).sky.id).toBe(a.skyId);
  });

  it("出身的 statMods 在神种之后落账，lifespanDelta 在按体质算完之后落", () => {
    const content = withOrigin({ statMods: { ling: 8, de: -5 }, lifespanDelta: -2 });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    const bare = createLife(1, FIXTURE_SEED_ID, PLAIN);
    expect(life.stats.ling).toBe(bare.stats.ling + 8);
    expect(life.stats.de).toBe(bare.stats.de - 5);
    expect(life.lifespanMax).toBe(bare.lifespanMax - 2);
  });

  it("出身挂的 flag 在降世那一刻就在（专属事件线靠它入池）", () => {
    const content = withOrigin({ flags: ["born-twin"] });
    expect(createLife(1, FIXTURE_SEED_ID, content).flags).toContain("born-twin");
  });

  /** `sys:` 是引擎保留命名空间：内容写错一个前缀不该在降世这一刻就改掉规则。 */
  it("开局变量写不进 sys: 保留 flag", () => {
    const content = withOrigin({ flags: ["sys:starving", "born-twin"] });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    expect(life.flags).toContain("born-twin");
    expect(life.flags).not.toContain("sys:starving");
  });

  it("池为空时抛错（一个静默失效的开局变量等于这一批没做）", () => {
    expect(() => createLife(1, FIXTURE_SEED_ID, contentWithoutEvents({ skies: [] }))).toThrow(/skies/);
    expect(() => createLife(1, FIXTURE_SEED_ID, contentWithoutEvents({ origins: [] }))).toThrow(/origins/);
  });

  it("id 悬空时抛错，不静默退回「无修正」", () => {
    const life = createLife(1, FIXTURE_SEED_ID, PLAIN);
    expect(() => lifeTuning({ ...life, skyId: "no-such" }, PLAIN)).toThrow(/未知天时/);
    expect(() => lifeTuning({ ...life, originId: "no-such" }, PLAIN)).toThrow(/未知出身/);
  });
});

describe("lifeTuning：调参覆写真的落在结算上", () => {
  it("无覆写时返回 content.tuning 本体（平年零额外分配）", () => {
    const life = createLife(1, FIXTURE_SEED_ID, PLAIN);
    expect(lifeTuning(life, PLAIN)).toBe(PLAIN.tuning);
  });

  it("天时与出身的覆写相加", () => {
    const content = contentWithoutEvents({
      skies: [{ ...FIXTURE_SKY, tuningDelta: { hungerPerSeason: 3 } }],
      origins: [{ ...FIXTURE_ORIGIN, tuningDelta: { hungerPerSeason: 2 } }],
    });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    expect(lifeTuning(life, content).hungerPerSeason).toBe(content.tuning.hungerPerSeason + 5);
  });

  it("覆写有下限 0（负的每季消耗不是「更容易」而是坏掉）", () => {
    const content = withSky({ tuningDelta: { hungerPerSeason: -999 } });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    expect(lifeTuning(life, content).hungerPerSeason).toBe(0);
  });

  /** 「大旱年就该真的更容易饿死」—— 这一条是交付线的原话，所以直接量季耗。 */
  it("`hungerPerSeason` 覆写改变真实季耗（不只是屏幕上那一行）", () => {
    const dry = withSky({ tuningDelta: { hungerPerSeason: 3 } });
    const before = createLife(1, FIXTURE_SEED_ID, dry);
    const after = performAction({ ...before, hunger: 90 }, "explore", dry, NEAR).state;
    const plainBefore = createLife(1, FIXTURE_SEED_ID, PLAIN);
    const plainAfter = performAction({ ...plainBefore, hunger: 90 }, "explore", PLAIN, NEAR).state;
    expect(plainAfter.hunger - after.hunger).toBe(3);
  });

  it("`moltThreshold` 覆写改变「蛰伏」何时可选", () => {
    const flux = withSky({ tuningDelta: { moltThreshold: -15 } });
    const threshold = PLAIN.tuning.moltThreshold;
    const essence = { zu: threshold - 10, lin: 0, xue: 0, meng: 0 };
    const fluxLife: TaleState = { ...createLife(1, FIXTURE_SEED_ID, flux), essence };
    const plainLife: TaleState = { ...createLife(1, FIXTURE_SEED_ID, PLAIN), essence };
    // 同一份精气：灵气盛之年已经够蛰伏，平年还差 10
    expect(availableActions(fluxLife, flux)).toContain("dormant");
    expect(availableActions(plainLife, PLAIN)).not.toContain("dormant");
  });

  /**
   * `stalkAlertBonus` 是**加成**而不是缺省值：八头猎物全都自带 `wariness`，
   * 改缺省值（`stalkStartAlert`）等于一条完全没有效果的天时，而且不会有测试变红。
   */
  it("`stalkAlertBonus` 加在猎物自带的 wariness 之上", () => {
    const tide = withSky({ tuningDelta: { stalkAlertBonus: 8 } }, { tuning: { stalkStartAlertJitter: 0 } });
    const plainNoJitter = contentWithoutEvents({ tuning: { stalkStartAlertJitter: 0 } });
    const a = performAction(
      { ...createLife(9, FIXTURE_SEED_ID, tide), hunger: 90 },
      "hunt",
      tide,
    ).state;
    const b = performAction(
      { ...createLife(9, FIXTURE_SEED_ID, plainNoJitter), hunger: 90 },
      "hunt",
      plainNoJitter,
    ).state;
    expect(a.stalk).not.toBeNull();
    expect(b.stalk).not.toBeNull();
    expect((a.stalk?.alertness ?? 0) - (b.stalk?.alertness ?? 0)).toBe(8);
  });

  it("`combatWinEssenceMul` 覆写让杀获更厚", () => {
    const tide = withSky({ tuningDelta: { combatWinEssenceMul: 0.2 } });
    const prey = tide.enemies.find((enemy) => enemy.id === ENEMY_YE_ZHI);
    const gain = (content: TaleContent): number => {
      const cornered = enterCombat(createLife(1, FIXTURE_SEED_ID, content), ENEMY_YE_ZHI, content, {
        enemyHp: 1,
        guardPart: "eye",
      });
      return combatAct(cornered, { kind: "bite", part: "throat" }, content).state.essence.zu;
    };
    const base = prey?.essence.zu ?? 0;
    expect(gain(PLAIN)).toBe(base);
    expect(gain(tide)).toBe(Math.round(base * 1.2));
  });
});

describe("eventWeightMul：只在抽取阶段生效", () => {
  const WATER: TaleEvent = {
    id: "qiu-water",
    trigger: { region: "any", weight: 10, tags: ["water"] },
    title: "水",
    body: "水。",
    choices: [{ label: "饮之", outcomes: [{ weight: 1, text: "饮了。", effects: {} }] }],
  };
  const DRY: TaleEvent = {
    id: "qiu-dry",
    trigger: { region: "any", weight: 10 },
    title: "旱",
    body: "旱。",
    choices: [{ label: "忍之", outcomes: [{ weight: 1, text: "忍了。", effects: {} }] }],
  };

  function drawMany(content: TaleContent, lives = 240): Record<string, number> {
    const counts: Record<string, number> = { "qiu-water": 0, "qiu-dry": 0 };
    for (let i = 0; i < lives; i += 1) {
      const life = { ...createLife(1000 + i * 7919, FIXTURE_SEED_ID, content), hunger: 90 };
      const drawn = performAction(life, "rest", content).pendingEvent;
      if (drawn) counts[drawn.id] = (counts[drawn.id] ?? 0) + 1;
    }
    return counts;
  }

  it("带乘子的 tag 在抽取里真的更常出（无乘子时两条持平）", () => {
    const events = [WATER, DRY];
    const even = makeContent({ events, tuning: { eventChanceBase: 1 } });
    const flat = drawMany(even);
    // 同权重同 tag 数 —— 两条应当大致持平（容差给足，这里量的是「有没有偏」）
    expect(Math.abs(flat["qiu-water"]! - flat["qiu-dry"]!)).toBeLessThan(60);

    const dry = makeContent({
      events,
      tuning: { eventChanceBase: 1 },
      skies: [{ ...FIXTURE_SKY, eventWeightMul: { water: 4 } }],
    });
    const biased = drawMany(dry);
    expect(biased["qiu-water"]!).toBeGreaterThan(biased["qiu-dry"]! * 2);
  });

  /**
   * **绝不改 content 里的 weight 原值**：`TaleContent` 是所有一世共享的同一份对象，
   * 改它等于污染后续每一世，并让「同种子同操作＝同终态」在第二世起就不成立。
   */
  it("不改内容对象里的 weight 原值", () => {
    const events: TaleEvent[] = [{ ...WATER }, { ...DRY }];
    const content = makeContent({
      events,
      tuning: { eventChanceBase: 1 },
      skies: [{ ...FIXTURE_SKY, eventWeightMul: { water: 4 } }],
    });
    drawMany(content, 20);
    expect(content.events.map((event) => event.trigger.weight)).toEqual([10, 10]);
  });

  it("多条乘子相乘（天时 × 出身都关照到的事件放大得最多）", () => {
    const both = makeContent({
      events: [WATER, DRY],
      tuning: { eventChanceBase: 1 },
      skies: [{ ...FIXTURE_SKY, eventWeightMul: { water: 3 } }],
      origins: [{ ...FIXTURE_ORIGIN, eventWeightMul: { water: 3 } }],
    });
    const counts = drawMany(both);
    // 3 × 3 = 9 倍权重 → 水那条该占绝大多数
    expect(counts["qiu-water"]!).toBeGreaterThan(counts["qiu-dry"]! * 4);
  });

  it("没有 tags 的事件不受任何乘子影响", () => {
    const content = makeContent({
      events: [DRY],
      tuning: { eventChanceBase: 1 },
      skies: [{ ...FIXTURE_SKY, eventWeightMul: { water: 100 } }],
    });
    expect(drawMany(content, 20)["qiu-dry"]).toBe(20);
  });
});

describe("livesTaken：三个来源都要记", () => {
  it("追猎得手记一条命（它刻意不写 LifeRecord，所以只有这个计数器记得住）", () => {
    const content = contentWithoutEvents({ tuning: { ...ALWAYS_POUNCE } });
    const started = performAction(
      { ...createLife(5, FIXTURE_SEED_ID, content), hunger: 90 },
      "hunt",
      content,
    ).state;
    expect(started.stalk).not.toBeNull();
    const caught = stalkAct(started, "pounce", content);
    expect(caught.over).toBe("caught");
    expect(caught.state.livesTaken).toBe(1);
    // 记录里没有对应条目 —— 正是这个字段存在的理由
    expect(caught.state.records.filter((record) => record.kind === "combat")).toHaveLength(0);
  });

  it("搏杀取胜记一条命", () => {
    const content = contentWithoutEvents({ tuning: { combatDamageJitter: 0 } });
    const cornered = enterCombat(createLife(1, FIXTURE_SEED_ID, content), ENEMY_YE_ZHI, content, {
      enemyHp: 1,
      guardPart: "eye",
    });
    const turn = combatAct(cornered, { kind: "bite", part: "throat" }, content);
    expect(turn.over).toBe("win");
    expect(turn.state.livesTaken).toBe(1);
  });

  /** 内容明写了杀生的抉择（「取其咽喉」那一类）也算 —— 否则化灵可以靠事件白吃肉。 */
  it("内容标了 takesLife 的抉择按数目累加", () => {
    const event: TaleEvent = {
      id: "qiu-eggs",
      trigger: { region: "any", weight: 1 },
      title: "遗卵",
      body: "卵。",
      choices: [{ label: "三枚尽食", outcomes: [{ weight: 1, text: "吃了。", effects: { takesLife: 3 } }] }],
    };
    const content = makeContent({ events: [event] });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    expect(resolveChoice(life, event, 0, content).state.livesTaken).toBe(3);
  });

  it("逃脱与它遁走都不记（没夺到命）", () => {
    const content = contentWithoutEvents({ tuning: { fleeBase: 1, minChance: 0, maxChance: 1 } });
    const cornered = enterCombat(createLife(1, FIXTURE_SEED_ID, content), ENEMY_YE_ZHI, content);
    const fled = combatAct(cornered, { kind: "flee" }, content);
    expect(fled.over).toBe("fled");
    expect(fled.state.livesTaken).toBe(0);
  });
});

describe("尝过神兽：登神那条道的第三门", () => {
  it("战胜带 divine tag 的敌人即挂 sys:divine-eaten", () => {
    const content = contentWithoutEvents({ tuning: { combatDamageJitter: 0 } });
    const cornered = enterCombat(createLife(1, FIXTURE_SEED_ID, content), ENEMY_QIONG_QI, content, {
      enemyHp: 1,
      guardPart: "eye",
    });
    const turn = combatAct(cornered, { kind: "bite", part: "throat" }, content);
    expect(turn.over).toBe("win");
    expect(turn.state.flags).toContain(SYS_FLAG_DIVINE_EATEN);
  });

  it("战胜普通兽不挂", () => {
    const content = contentWithoutEvents({ tuning: { combatDamageJitter: 0 } });
    const cornered = enterCombat(createLife(1, FIXTURE_SEED_ID, content), ENEMY_YE_ZHI, content, {
      enemyHp: 1,
      guardPart: "eye",
    });
    expect(combatAct(cornered, { kind: "bite", part: "throat" }, content).state.flags).not.toContain(
      SYS_FLAG_DIVINE_EATEN,
    );
  });

  it("内容的 devourDivine 钩子也算（不经搏杀的神兽因缘）", () => {
    const event: TaleEvent = {
      id: "qiu-dragon",
      trigger: { region: "any", weight: 1 },
      title: "垂死",
      body: "龙。",
      choices: [
        { label: "食其血肉", outcomes: [{ weight: 1, text: "吃了。", effects: { devourDivine: true } }] },
      ],
    };
    const content = makeContent({ events: [event] });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    expect(resolveChoice(life, event, 0, content).state.flags).toContain(SYS_FLAG_DIVINE_EATEN);
  });
});

describe("四道资格 flag 与成道", () => {
  it("四条 flag 各自随门槛进退，死亡时一律摘掉", () => {
    const content = PLAIN;
    const t = content.tuning;
    const base = createLife(1, FIXTURE_SEED_ID, content);
    // 归山：寿 ＋ 德
    const ready: TaleState = {
      ...base,
      hunger: 90,
      year: t.wayGuishanYear,
      // 寿限拉高：否则这一步的 closeSeason 会当场判寿终，flag 随死亡一并摘掉
      lifespanMax: t.wayGuishanYear + 10,
      livesTaken: 1,
      stats: { ...base.stats, de: t.wayGuishanDe },
    };
    const after = performAction(ready, "rest", content).state;
    expect(after.flags).toContain(WAY_FLAGS.guishan);
    expect(after.flags).not.toContain(WAY_FLAGS.shen);
    // 德掉下去 → flag 跟着摘掉
    const fallen = performAction(
      { ...after, stats: { ...after.stats, de: t.wayGuishanDe - 1 } },
      "rest",
      content,
    ).state;
    expect(fallen.flags).not.toContain(WAY_FLAGS.guishan);
  });

  /**
   * 寿终那一刻的**一次判定**（计划正本原话）：归山备了就是成道，不备就是「终未成器」。
   * 两套并行逻辑会让其中一支静默走错，而玩家读到的正是那一行。
   */
  it("寿终：归山门槛已备 → 成道；不备 → oldage 失败", () => {
    const content = PLAIN;
    const t = content.tuning;
    const base = createLife(1, FIXTURE_SEED_ID, content);
    const atEdge = (de: number): TaleState => ({
      ...base,
      hunger: 90,
      year: Math.max(t.wayGuishanYear, base.lifespanMax),
      season: 3,
      lifespanMax: Math.max(t.wayGuishanYear, base.lifespanMax),
      livesTaken: 1,
      stats: { ...base.stats, de },
    });

    const failed = performAction(atEdge(t.wayGuishanDe - 1), "rest", content).state;
    expect(failed.alive).toBe(false);
    expect(failed.ending).toBe("oldage");
    expect(failed.wayAchieved).toBeNull();

    const achieved = performAction(atEdge(t.wayGuishanDe), "rest", content).state;
    expect(achieved.alive).toBe(false);
    expect(achieved.ending).toBe("ascend");
    expect(achieved.wayAchieved).toBe("guishan");
    // 列传读的是归山那一段，不是泛用的登神段
    expect(composeChronicle(achieved, content).body).toContain(
      content.chronicleTemplates.wayEndings.guishan,
    );
  });

  it("`die: \"ascend\"` 没写 way 时兜底到已够格的那条", () => {
    const event: TaleEvent = {
      id: "qiu-open",
      trigger: { region: "any", weight: 1 },
      title: "门开",
      body: "门。",
      choices: [{ label: "受之而升", outcomes: [{ weight: 1, text: "升了。", effects: { die: "ascend" } }] }],
    };
    const content = makeContent({ events: [event] });
    const t = content.tuning;
    const base = createLife(1, FIXTURE_SEED_ID, content);
    const ready: TaleState = {
      ...base,
      livesTaken: 1,
      stats: { ...base.stats, ling: t.wayShenLing, de: t.wayShenDe },
      flags: [...base.flags, SYS_FLAG_DIVINE_EATEN],
    };
    expect(waysProgress(ready, content).readyIds).toContain("shen");
    expect(resolveChoice(ready, event, 0, content).state.wayAchieved).toBe("shen");
  });

  it("四条道在 waysProgress 里恒定齐全且定序（界面横带靠它排 tab）", () => {
    const life = createLife(1, FIXTURE_SEED_ID, PLAIN);
    expect(waysProgress(life, PLAIN).ways.map((way) => way.id)).toEqual([...WAY_ORDER]);
  });
});
