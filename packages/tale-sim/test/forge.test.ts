/**
 * M2-B2「凝招」的引擎机制。
 *
 * 需求正本：`docs/plans/shiling/2026-08-14-liezhuan-m2-combat-core-plan.md` 的「B2 凝招」节。
 * 分工：这里守**公式与规则**（分量单调、三档代价、槽位、名号、招式册、断伤落地）；
 * 内容那一版的数够不够互不吃掉由 `tale-content/test/forge.test.ts` 的占优闸门守。
 *
 * 手算基数（与 combat.test.ts 同一套，别改）：
 * - fixture 我方 meng 10 → 一咬基础伤害 3 + floor(10/8) = **4**（`combatDamageJitter` 钉成 0）。
 * - fixture 的 `forgePowerPerMul` 5／`forgePowerWound` 4／效果表见 `BASELINE_TUNING`。
 */

import { describe, expect, it } from "vitest";
import {
  FORGE_SKILL_PREFIX,
  FORGE_SLOTS,
  combatAct,
  combatPreview,
  combatSkills,
  createLife,
  defaultForgePicks,
  forgeNameValid,
  forgeParts,
  forgePartsForSlot,
  forgePreview,
  forgeSkill,
  forgetForgedSkill,
  learnLore,
  loreOptions,
  recommendForge,
  type CombatAct,
  type ForgePicks,
  type TaleContent,
  type TaleState,
  clashOf,
} from "../src/index.js";
import {
  ENEMY_QIONG_QI,
  FIXTURE_SEED_ID,
  NEVER_COUNTER,
  ORGAN_GOU_CHI,
  ORGAN_JI_ZU,
  ORGAN_LIN_JIA,
  ORGAN_WU_MU,
  contentWithoutEvents,
  enterCombat,
  makePart,
  makeSynergy,
  withOrgans,
} from "./fixtures.js";

// 三件部件恰好占满三个槽，且各自只擅长一个槽 —— 最小可拼局面
const PART_A = makePart("p-a", "甲", ORGAN_GOU_CHI, {
  open: { damageMul: 1.4, text: "甲起手 —— 伤 ×1.4" },
  force: { damageMul: 0.6, woundPart: null, text: "甲发力 —— 力道 +0.6 倍" },
});
const PART_B = makePart("p-b", "乙", ORGAN_WU_MU, {
  force: { damageMul: 0.4, woundPart: "leg", text: "乙发力 —— 力道 +0.4 倍 · 断其腿" },
  addon: { effect: "insight", text: "乙附加 —— 明识" },
});
const PART_C = makePart("p-c", "丙", ORGAN_LIN_JIA, {
  addon: { effect: "venom", text: "丙附加 —— 附毒" },
  essenceType: "lin",
});
/** 一件按灵算的起手（灵系那一支的最小样本）。 */
const PART_D = makePart("p-d", "丁", ORGAN_JI_ZU, {
  open: { damageMul: 1, stat: "ling", text: "丁起手 —— 伤 ×1.0（按灵算）" },
  essenceType: "lin",
});

const PARTS = [PART_A, PART_B, PART_C, PART_D];

const SYN = makeSynergy("test-syn", [ORGAN_GOU_CHI, ORGAN_WU_MU], {
  name: "试古法",
  desc: "两件凑齐。",
  effects: ["venom", "stun"],
  damageMul: 2.6,
  cooldown: 5,
  cost: { kind: "hp", amount: 3 },
});

function content(tuning: Record<string, unknown> = {}): TaleContent {
  return contentWithoutEvents({
    parts: PARTS,
    synergies: [SYN],
    tuning: { combatDamageJitter: 0, ...NEVER_COUNTER, ...tuning },
  });
}

const CONTENT = content();

/** 一世：身上带三件产出部件的器官 ＋ 一把精气。 */
function armed(state?: Partial<TaleState>, c: TaleContent = CONTENT): TaleState {
  const base = withOrgans(
    createLife(1, FIXTURE_SEED_ID, c),
    ORGAN_GOU_CHI,
    ORGAN_WU_MU,
    ORGAN_LIN_JIA,
    ORGAN_JI_ZU,
  );
  return { ...base, essence: { zu: 200, lin: 200, xue: 200, meng: 200 }, ...state };
}

const PICKS: ForgePicks = { open: "p-a", force: "p-b", addon: "p-c" };
const SKILL = (skillId: string): CombatAct => ({ kind: "skill", skillId });

describe("部件与三个槽", () => {
  it("手上有哪几件部件只看器官在不在身上（不看它是怎么来的）", () => {
    expect(forgeParts(armed(), CONTENT).map((part) => part.id)).toEqual([
      "p-a",
      "p-b",
      "p-c",
      "p-d",
    ]);
    // 血脉带来的一样算 —— 与 `ownedSynergies` 同一条判据
    const born = createLife(1, FIXTURE_SEED_ID, CONTENT, { boonOrganIds: [ORGAN_JI_ZU] });
    expect(forgeParts(born, CONTENT).map((part) => part.id)).toEqual(["p-d"]);
  });

  it("一件部件只填得进它有 payload 的那个槽", () => {
    expect(forgePartsForSlot(armed(), CONTENT, "open").map((p) => p.id)).toEqual(["p-a", "p-d"]);
    expect(forgePartsForSlot(armed(), CONTENT, "force").map((p) => p.id)).toEqual(["p-a", "p-b"]);
    expect(forgePartsForSlot(armed(), CONTENT, "addon").map((p) => p.id)).toEqual(["p-b", "p-c"]);
  });

  it("放错槽、身上没有、或同一件占两个槽 —— 三种都当场抛错", () => {
    const state = armed();
    // 丙只有附加 payload，塞进起手是内容/界面的 bug，不许静默降级
    expect(() => forgePreview(state, CONTENT, { ...PICKS, open: "p-c" })).toThrow(/起手/);
    expect(() => forgePreview(state, CONTENT, { ...PICKS, addon: "p-d" })).toThrow(/附加/);
    expect(() => forgePreview(state, CONTENT, { open: "p-a", force: "p-a", addon: "p-c" })).toThrow(
      /两个槽/,
    );
  });
});

describe("分量与三档代价", () => {
  /**
   * 这一条把 owner 那张招式框原型上的四个数逐项钉住。数变了要么是刻意调参
   * （那就改这条），要么是有人动了公式 —— 后者必须当场变红。
   */
  it("分量 ＝ 总系数×5 ＋ 断伤 4 ＋ 效果；精气价**就是分量**", () => {
    const preview = forgePreview(armed(), CONTENT, PICKS);
    // 总系数 1.4 + 0.4 = 1.8 → 9；断伤（腿）4；附毒 9 → 分量 22
    expect(preview.cost.essence).toBe(22);
    expect(preview.cost.essenceType).toBe("meng"); // 起手那一件决定付哪一型
    expect(preview.cost.momentum).toBe(3); // clamp(round(22/7),1,3)
    expect(preview.cost.cooldown).toBe(3); // clamp(1+round(22/9),1,4)
    expect(preview.woundPart).toBe("leg");
    expect(preview.effect).toBe("venom");
  });

  /**
   * **精气价不缩放**是占优闸门恒为 0 的结构性前提（见 tuning 那一节的注释）。
   * 这一条钉的就是那个前提：分量差 1 的两手，精气价必须也差 1 —— 任何缩放系数
   * 都会把它们压成同价，而「同价而处处不差」正是一条严格占优的拼法。
   */
  it("同一档效果里，伤害更高的那一手精气价必然更高（不许有取整撞车）", () => {
    const state = armed();
    /*
     * 这一条**全枚举**本 fixture 的合法拼法，按「同效果 ＋ 同断伤 ＋ 同属性」分组，
     * 组内比「伤害更高的是不是也更贵」。它守的是占优闸门恒为 0 的那个前提 ——
     * 任何缩放系数都会把两档不同的分量压成同价，而「同价而处处不差」正是占优的定义。
     */
    const rows = [] as { key: string; damage: number; essence: number }[];
    for (const open of forgePartsForSlot(state, CONTENT, "open")) {
      for (const force of forgePartsForSlot(state, CONTENT, "force")) {
        for (const addon of forgePartsForSlot(state, CONTENT, "addon")) {
          if (open.id === force.id || open.id === addon.id || force.id === addon.id) continue;
          const preview = forgePreview(state, CONTENT, {
            open: open.id,
            force: force.id,
            addon: addon.id,
          });
          rows.push({
            key: `${addon.addon?.effect}|${force.force?.woundPart}|${open.open?.stat ?? "meng"}`,
            damage: preview.damage.mid,
            essence: preview.cost.essence,
          });
        }
      }
    }
    // fixture 只有四件部件，合法拼法恰好 4 副 —— 真内容那 912 副由 tale-content 的
    // 占优闸门全枚举，这里守的是**公式的性质**，不是覆盖率
    expect(rows.length).toBe(4);
    for (const a of rows) {
      for (const b of rows) {
        if (a.key !== b.key) continue;
        if (a.damage > b.damage) {
          expect(a.essence, `${a.key}：伤 ${a.damage} 却不比伤 ${b.damage} 的贵`).toBeGreaterThan(
            b.essence,
          );
        }
      }
    }
  });

  it("起手那一件同时决定按哪个属性出伤", () => {
    const state = armed({ stats: { meng: 10, ling: 40, ti: 20, de: 5 } });
    const meng = forgePreview(state, CONTENT, { open: "p-a", force: "p-b", addon: "p-c" });
    const ling = forgePreview(state, CONTENT, { open: "p-d", force: "p-a", addon: "p-c" });
    // meng 10 → 基 4 × 1.8 = 7；ling 40 → 基 8 × 1.6 = 12
    expect(meng.damage.mid).toBe(7);
    expect(ling.damage.mid).toBe(12);
    expect(ling.cost.essenceType).toBe("lin");
    // 同样的一副拼法，付的型跟着**起手**那一件走 —— 四型精气是四笔不同的钱
    expect(meng.cost.essenceType).toBe("meng");
  });
});

describe("凝成与招式册", () => {
  it("凝成扣精气、入册、写一条 forge 记录，且**不掷任何骰**", () => {
    const before = armed();
    const after = forgeSkill(before, CONTENT, PICKS);
    expect(after.essence.meng).toBe(200 - 22);
    expect(after.forgedSkills).toHaveLength(1);
    expect(after.forgedSkills[0]?.id).toBe(`${FORGE_SKILL_PREFIX}0`);
    expect(after.forgedSkills[0]?.parts).toEqual(PICKS);
    expect(after.forgedSkills[0]?.loreId).toBeNull();
    const record = after.records[after.records.length - 1];
    expect(record?.kind).toBe("forge");
    expect(record?.text).toContain("甲、乙、丙");
    expect(record?.text).toContain("甲乙蚀");
    /*
     * 不掷骰是这一批对确定性的承诺：凝招是玩家自己算出来的东西，掷骰会把「我算准了」
     * 变成「我运气好」。副作用是既存种子的剧本一个字都没被这一批破坏。
     */
    expect(after.rngState).toBe(before.rngState);
  });

  it("默认名号按三件部件拼，重名往后排；玩家给的名号优先", () => {
    const state = armed();
    expect(forgePreview(state, CONTENT, PICKS).defaultName).toBe("甲乙蚀");
    const once = forgeSkill(state, CONTENT, PICKS);
    expect(once.forgedSkills[0]?.name).toBe("甲乙蚀");
    // 忘掉再凝同一副拼法不该撞名；这里直接凝第二手验重名规则
    const twice = forgeSkill(once, CONTENT, PICKS);
    expect(twice.forgedSkills[1]?.name).toBe("甲乙蚀·二");
    expect(forgeSkill(state, CONTENT, PICKS, "裂石").forgedSkills[0]?.name).toBe("裂石");
  });

  it("名号只许汉字且不超上限 —— 判据由引擎给，界面与引擎共用一份", () => {
    const t = CONTENT.tuning;
    expect(forgeNameValid("裂石", t)).toBe(true);
    expect(forgeNameValid("", t)).toBe(true); // 空 ＝ 退回默认名号，不算非法
    expect(forgeNameValid("abc", t)).toBe(false);
    expect(forgeNameValid("一二三四五六七", t)).toBe(false);
    expect(() => forgeSkill(armed(), CONTENT, PICKS, "abc")).toThrow(/名号/);
  });

  it("精气不够凝不成，且预览把原因分成「精气」与「槽满」两种", () => {
    const poor = armed({ essence: { zu: 0, lin: 0, xue: 0, meng: 5 } });
    const preview = forgePreview(poor, CONTENT, PICKS);
    expect(preview.affordable).toBe(false);
    expect(preview.blocked).toBe("essence");
    expect(preview.ready).toBe(false);
    expect(() => forgeSkill(poor, CONTENT, PICKS)).toThrow(/精气不足/);
  });

  it("招式册满员之后凝不成 —— 槽位上限是取舍不是白拿", () => {
    let state = armed();
    for (let i = 0; i < CONTENT.tuning.forgeSlots; i += 1) {
      state = forgeSkill(state, CONTENT, PICKS);
    }
    const preview = forgePreview(state, CONTENT, PICKS);
    expect(preview.hasSlot).toBe(false);
    expect(preview.blocked).toBe("slots");
    expect(() => forgeSkill(state, CONTENT, PICKS)).toThrow(/已满/);
  });

  /**
   * 遗忘只腾槽位、**不退精气**：退钱会让「先凝一手顶着、回头再换」变成零成本，
   * 槽位上限也就不再是取舍。
   */
  it("遗忘腾出槽位但不退精气，且新招不会继承旧招的冷却键", () => {
    const state = forgeSkill(armed(), CONTENT, PICKS);
    const forgot = forgetForgedSkill(state, `${FORGE_SKILL_PREFIX}0`);
    expect(forgot.forgedSkills).toHaveLength(0);
    expect(forgot.essence.meng).toBe(200 - 22);
    // 序号只增不重用 —— 否则新招会捡到旧招留在 `skillCooldowns` 里的那一格
    expect(forgeSkill(forgot, CONTENT, PICKS).forgedSkills[0]?.id).toBe(`${FORGE_SKILL_PREFIX}1`);
    expect(() => forgetForgedSkill(forgot, `${FORGE_SKILL_PREFIX}0`)).toThrow(/册中没有/);
  });

  it("招式册一世一册：转世（`createLife`）之后是空的", () => {
    expect(createLife(2, FIXTURE_SEED_ID, CONTENT).forgedSkills).toEqual([]);
    expect(createLife(2, FIXTURE_SEED_ID, CONTENT).forgeSeq).toBe(0);
  });
});

describe("凝成的招进技能池并真的按写的打", () => {
  function fighting(state: TaleState, c: TaleContent = CONTENT): TaleState {
    return enterCombat(state, ENEMY_QIONG_QI, c, { guardPart: "eye" });
  }

  it("凝成之后技能池里多一颗，skillId 带 forge: 前缀且带得出出处", () => {
    const before = armed();
    expect(combatSkills(before, CONTENT).map((entry) => entry.skillId)).toEqual([ORGAN_GOU_CHI]);
    const after = forgeSkill(before, CONTENT, PICKS);
    const pool = combatSkills(after, CONTENT);
    expect(pool.map((entry) => entry.skillId)).toEqual([ORGAN_GOU_CHI, `${FORGE_SKILL_PREFIX}0`]);
    expect(pool[1]?.forged?.parts).toEqual(PICKS);
    expect(pool[1]?.organId).toBeNull();
    expect(pool[1]?.synergyId).toBeNull();
  });

  /**
   * 「断伤」是凝招接进 B1 那套部位伤体系的接口 —— 它必须**真的记一层**（整场累积），
   * 否则招式框上「断其后腿」是一句屏幕上恒在、引擎从不兑现的承诺。
   */
  it("断伤真的记一层部位伤（整场累积，与三颗咬击共用同一条线）", () => {
    const ready = fighting(forgeSkill(armed(), CONTENT, PICKS));
    const state = { ...ready, encounter: { ...ready.encounter!, momentum: 3, momentumMax: 6 } };
    expect(state.encounter?.wounds.leg).toBe(0);
    const turn = combatAct(state, SKILL(`${FORGE_SKILL_PREFIX}0`), CONTENT);
    expect(turn.state.encounter?.wounds.leg).toBe(1);
    // 预览也要写得出来 —— 按钮上那一行「断其后腿」读的就是它
    expect(combatPreview(state, CONTENT).skills[1]?.woundPart).toBe("leg");
  });

  it("伤害、势价与冷却都照招式框上写的那三个数结算", () => {
    const state = fighting(forgeSkill(armed(), CONTENT, PICKS), CONTENT);
    // 起手时势不够（3 点）就按不了 —— 势是这一批的第三样价钱
    const preview = combatPreview(state, CONTENT).skills[1];
    expect(preview?.momentumCost).toBe(3);
    expect(preview?.damage.mid).toBe(7);
    const rich = {
      ...state,
      encounter: { ...state.encounter!, momentum: 4, momentumMax: 6 },
    };
    const turn = combatAct(rich, SKILL(`${FORGE_SKILL_PREFIX}0`), CONTENT);
    // 穷奇 40 血 − 7
    expect(clashOf(turn.state)?.enemyHp).toBe(33);
    // 4 − 3（这一手的势价）＋ 每合自涨 1 = 2
    expect(turn.state.encounter?.momentum).toBe(2);
    expect(clashOf(turn.state)?.skillCooldowns[`${FORGE_SKILL_PREFIX}0`]).toBeGreaterThan(0);
    // 自拟招**没有每次发招的 hp／精气代价**（钱在凝成那一刻付清了）
    expect(clashOf(turn.state)?.playerHp).toBeLessThan(clashOf(rich)?.playerHp ?? 0);
    expect(turn.state.essence.meng).toBe(rich.essence.meng);
  });
});

describe("古法：组合表降级成可直接习得的成品", () => {
  it("凑齐配方只是上货架，习得之后才进技能池", () => {
    const state = armed();
    const option = loreOptions(state, CONTENT)[0];
    expect(option?.missingOrganIds).toEqual([]);
    expect(option?.blocked).toBe("ok");
    // 没习得之前池子里没有它（S1 时凑齐即白拿一颗按钮）
    expect(combatSkills(state, CONTENT).map((e) => e.skillId)).toEqual([ORGAN_GOU_CHI]);
    const after = learnLore(state, CONTENT, "test-syn");
    expect(combatSkills(after, CONTENT)[1]?.synergyId).toBe("test-syn");
    expect(after.forgedSkills[0]?.parts).toBeNull();
    expect(after.records[after.records.length - 1]?.kind).toBe("forge");
  });

  it("古法照样付精气、占一个槽，且同一条不许习得两次", () => {
    const state = learnLore(armed(), CONTENT, "test-syn");
    expect(state.essence.meng).toBe(200 - 36);
    expect(loreOptions(state, CONTENT)[0]?.blocked).toBe("learned");
    expect(() => learnLore(state, CONTENT, "test-syn")).toThrow();
  });

  it("差一件器官时报「尚缺」，而不是笼统的不可用", () => {
    const one = { ...armed(), organIds: [createLife(1, FIXTURE_SEED_ID, CONTENT).organIds[0] as string, ORGAN_GOU_CHI] };
    expect(loreOptions(one, CONTENT)[0]?.missingOrganIds).toEqual([ORGAN_WU_MU]);
    expect(loreOptions(one, CONTENT)[0]?.blocked).toBe("missing");
  });

  /**
   * 古法的**势与冷却照抄它自己声明的那一份**（不走凝招那条公式）：它们是写死在内容里的
   * 成品，而那两个数正是「重手」的一半。只有精气价需要一条公式 —— S1 时组合技压根不要钱。
   */
  it("古法的冷却与势来自它自己的声明，只有精气价走公式", () => {
    const option = loreOptions(armed(), CONTENT)[0];
    expect(option?.cost.cooldown).toBe(5);
    // 系数 2.6 → 13、附毒 9 ＋ 顿挫 10、古法加价 4 → 36
    expect(option?.cost.essence).toBe(36);
    // 付的型跟着技自己的精气代价走；这一条付血，于是按配方第一件器官的部件精气型算
    expect(option?.cost.essenceType).toBe("meng");
  });
});

describe("界面缺省与推荐（呈现层建议，引擎自己不消费）", () => {
  it("预填挑「付得起的里面分量最大的一手」；拼不出来时给 null", () => {
    expect(defaultForgePicks(armed(), CONTENT)).toEqual(PICKS);
    const bare = createLife(1, FIXTURE_SEED_ID, CONTENT);
    expect(defaultForgePicks(bare, CONTENT)).toBeNull();
  });

  /**
   * 册里已有的那一副拼法不再当缺省 —— 否则「开框 → 凝成 → 再开框」会把四个槽填成
   * 同一手招。这一条是**实机跑出来的**：第一版的机器玩家凝出了
   * 「蕴鬃蚀／蕴鬃蚀·二／·三／·四」，四手一模一样，槽位上限于是形同虚设。
   */
  it("册里已有的那一副拼法不再被预填（不许四个槽填成同一手）", () => {
    const once = forgeSkill(armed(), CONTENT, PICKS);
    const next = defaultForgePicks(once, CONTENT);
    expect(next).not.toBeNull();
    expect(next).not.toEqual(PICKS);
  });

  it("招式册满了就不再推荐；古法可习得时优先推荐古法", () => {
    const state = armed();
    expect(recommendForge(state, CONTENT)).toEqual({ kind: "lore", synergyId: "test-syn" });
    let full = state;
    for (let i = 0; i < CONTENT.tuning.forgeSlots; i += 1) full = forgeSkill(full, CONTENT, PICKS);
    expect(recommendForge(full, CONTENT)).toBeNull();
  });

  /**
   * 「别花本钱」那一闸：付的那一型若正是这一世离蜕变门槛最近的那一型，就不推荐 ——
   * 花掉它等于拿一件器官换一手招，而器官既给属性也给部件。
   */
  it("不推荐去花「离蜕变门槛最近的那一型」精气", () => {
    // 先把古法习掉，逼推荐链走到自拟那一支（古法优先，见链的第 1 条）
    const learned = learnLore(armed(), CONTENT, "test-syn");
    const threshold = CONTENT.tuning.moltThreshold;
    /*
     * 猛是存量最高的一型、且已经攒到门槛一半以上 —— 那是这一世下一次蜕变的本钱。
     * 花掉它等于拿一件器官换一手招，而器官既给属性也给部件。
     */
    const savings = {
      ...learned,
      essence: { zu: 0, lin: 0, xue: 0, meng: Math.ceil(threshold / 2) + 20 },
    };
    expect(recommendForge(savings, CONTENT)).toBeNull();
    // 同样的猛精气，若鳞更多（猛不再是最高的那一型），它就成了零钱 —— 推荐得动
    const spare = { ...savings, essence: { ...savings.essence, lin: 999 } };
    expect(recommendForge(spare, CONTENT)?.kind).toBe("forge");
  });
});

describe("纪律", () => {
  it("三个槽的顺序是固定的（界面从上到下就念它）", () => {
    expect(FORGE_SLOTS).toEqual(["open", "force", "addon"]);
  });

  it("凝招不推进季节、不改年岁 —— 它是随时可做的经营动作", () => {
    const before = armed();
    const after = forgeSkill(before, CONTENT, PICKS);
    expect(after.year).toBe(before.year);
    expect(after.season).toBe(before.season);
    expect(after.hunger).toBe(before.hunger);
  });
});
