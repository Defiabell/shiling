/**
 * 详情浮层视图模型（「看得懂」批次）。
 *
 * 这份测试守两件事，都是 owner 那句「每个属性值有啥用……只能乱点」直接推出来的：
 *
 * 1. **每一行都带着真数**（不是「血肉与寿数」这种读完等于没读的风味词），而且数从
 *    `tuning` 与内容数据来 —— 所以断言一律用 `T.xxx` 表达期望值，调参之后测试跟着走。
 * 2. **必须在客户端复算的那两条算式（底伤、遁走成算）与引擎对得上账**：它们是唯一两处
 *    「界面自己算」的地方（引擎没有导出无战斗上下文的推导），一旦引擎改了算式形状，
 *    这两条对账测试先红，而不是等玩家发现按钮上的数是假的。
 */

import { describe, expect, it } from "vitest";
import { combatPreview, type TaleState } from "@shiling/tale-sim";
import {
  ORGAN_JI_ZU,
  ORGAN_LING_XI,
  ORGAN_LONG_XIAN,
  ORGAN_WU_MU,
  TALE_CONTENT,
} from "@shiling/tale-content";
import {
  baseBiteDamage,
  buildDetailVm,
  detailKey,
  essenceGates,
  essenceSources,
  fleeChanceAgainst,
  moltPool,
  moltPreviewText,
  organTagGates,
  seenEventIds,
  statGates,
  tagEffects,
} from "../src/model/detailVm.js";
import { FIXTURE_CONTENT, newState, withPatch } from "./helpers.js";

const T = TALE_CONTENT.tuning;
const FT = FIXTURE_CONTENT.tuning;

/** 真内容里的一世（神种＝fixture 的灵蕴，只为省一次 seed 常量；属性口径同 createLife）。 */
function realLife(patch: Partial<TaleState> = {}): TaleState {
  const born = newState();
  return { ...born, ...patch };
}

function rowsText(state: TaleState, sel: Parameters<typeof buildDetailVm>[2]): string {
  const vm = buildDetailVm(state, TALE_CONTENT, sel);
  expect(vm).not.toBeNull();
  return [vm!.lede, ...vm!.rows.map((row) => `${row.label}：${row.text}`), vm!.foot ?? ""].join("\n");
}

describe("与引擎对账：客户端唯一两处复算", () => {
  it("底伤 ＝ combatPreview 里那一咬（倍率全钉成 1 时应逐字相等）", () => {
    // 把部位／姿态倍率与抖动全钉平，剩下的就只有「base + floor(meng/div)」这一层
    const content = {
      ...FIXTURE_CONTENT,
      tuning: {
        ...FT,
        combatDamageJitter: 0,
        combatBiteMul: { throat: 1, leg: 1, eye: 1 },
        combatStanceMul: {
          low: { out: 1, in: 1 },
          square: { out: 1, in: 1 },
          lunge: { out: 1, in: 1 },
        },
      },
    };
    const state = withPatch(newState(), {
      combat: {
        enemyId: "ye-zhi",
        enemyHp: 6,
        playerHp: 20,
        round: 0,
        stance: "square" as const,
        // 护后腿 ＋ 这一合常规咬 → 咬喉既没被护住、也不吃守势那一档
        guardPart: "leg" as const,
        intent: { kind: "bite" as const, text: "" },
        blind: 0,
        slow: 0,
        ward: 0,
        skillCooldowns: {},
        log: [],
      },
    });
    const throat = combatPreview(state, content).bites.find((bite) => bite.part === "throat");
    expect(throat?.damage.mid).toBe(baseBiteDamage(state.stats.meng, content.tuning));
  });

  it("遁走成算 ＝ combatPreview.fleeChance（未致盲时）", () => {
    const state = withPatch(newState(), {
      combat: {
        enemyId: "ye-zhi",
        enemyHp: 6,
        playerHp: 20,
        round: 0,
        stance: "square" as const,
        guardPart: "leg" as const,
        intent: { kind: "bite" as const, text: "" },
        blind: 0,
        slow: 0,
        ward: 0,
        skillCooldowns: {},
        log: [],
      },
    });
    const enemy = FIXTURE_CONTENT.enemies.find((candidate) => candidate.id === "ye-zhi")!;
    expect(combatPreview(state, FIXTURE_CONTENT).fleeChance).toBeCloseTo(
      fleeChanceAgainst(state.stats.ling, enemy, FT),
      10,
    );
  });
});

describe("属性详情：讲结果，不讲风味", () => {
  it("猛：三个部位的落地伤害都摆出来，并说清它不管信息", () => {
    const state = realLife();
    const text = rowsText(state, { kind: "stat", key: "meng" });
    const base = baseBiteDamage(state.stats.meng, T);
    expect(text).toContain(`空口一咬 ${base}`);
    expect(text).toContain(`咬喉 ${Math.max(1, Math.floor(base * T.combatBiteMul.throat))}`);
    expect(text).toContain(`扑眼 ${Math.max(1, Math.floor(base * T.combatBiteMul.eye))}`);
    // 扑击命中里那一份加成（不是「搏杀之力」四个字）
    expect(text).toContain(`+${Math.round(state.stats.meng * T.stalkPouncePerMeng * 100)}%`);
    // 别让玩家以为堆猛就能看清警觉
    expect(text).toContain("器官");
  });

  it("体：血量按当前值实例化，且寿限**不**假装还会随体涨", () => {
    const state = realLife({ stats: { meng: 10, ling: 10, ti: 40, de: 5 } });
    const text = rowsText(state, { kind: "stat", key: "ti" });
    expect(text).toContain("每场搏杀起手 40 血");
    // lifespanMax 出生时定一次（createLife），此后长体不加寿 —— 写成「16＋体/10」会是谎
    expect(text).toContain(`${state.lifespanMax} 岁`);
    expect(text).toContain("此后再长体也不加寿");
    // 「挨得住几下」要落到具体对手上
    expect(text).toMatch(/野雉|穴鼠|文鳐鱼/);
  });

  it("灵：遁走成算给两头对照 ＋ 登神门槛问引擎", () => {
    const state = realLife();
    const text = rowsText(state, { kind: "stat", key: "ling" });
    expect(text).toContain("遁走");
    expect(text).toContain(`登神需 ${T.ascendMinLing}`);
    expect(text).toContain(`灵 ${Math.round(state.stats.ling)}／${T.ascendMinLing}`);
  });

  it("德：说清它不进搏杀的账，只买抉择与登神", () => {
    const text = rowsText(realLife(), { kind: "stat", key: "de" });
    expect(text).toContain("不进搏杀的账");
    expect(text).toContain(`德 5／${T.ascendMinDe}`);
  });

  it("抉择门槛报数目与下一档，且「涨它的路」指向真的器官", () => {
    const gates = statGates(TALE_CONTENT, "de");
    expect(gates.length).toBeGreaterThan(0);
    const text = rowsText(realLife(), { kind: "stat", key: "de" });
    expect(text).toContain(`全青丘 ${gates.length} 处抉择认德`);
    expect(text).toContain(`下一档 德 ${gates[0]!.need}`);
    expect(text).toContain("涨德的路");
  });
});

describe("饱食详情：开局第一回合就要知道的账", () => {
  it("进／出／还够几季全部实例化", () => {
    const state = realLife({ hunger: 60 });
    const text = rowsText(state, { kind: "hunger" });
    expect(text).toContain(`每季 −${T.hungerPerSeason}`);
    expect(text).toContain(`冬季 −${T.hungerPerSeason + T.winterHungerExtra}`);
    expect(text).toContain(`追猎得手 +${T.huntFoodGain}`);
    expect(text).toContain(`休憩 +${T.restHungerGain}`);
    expect(text).toContain(`还够 ${Math.floor(60 / T.hungerPerSeason)} 季`);
  });

  it("已挂 sys:starving 时改口成「再一季就是饿殍」", () => {
    const text = rowsText(realLife({ hunger: 0, flags: ["sys:starving"] }), { kind: "hunger" });
    expect(text).toContain("再一季不进食就是饿殍");
  });
});

describe("精气详情：说清它通向什么（交付内容 C）", () => {
  it("候选偏向按 affinity 排序，且排掉已持有的", () => {
    const bare = realLife();
    const pool = moltPool(bare, TALE_CONTENT, "zu");
    expect(pool[0]?.id).toBe(ORGAN_JI_ZU); // 疾足 zu 0.9，全库最高
    const withJiZu = realLife({ organIds: [...bare.organIds, ORGAN_JI_ZU] });
    expect(moltPool(withJiZu, TALE_CONTENT, "zu").map((organ) => organ.id)).not.toContain(ORGAN_JI_ZU);
  });

  it("食之可增按「猎场里就有」优先，并标出量", () => {
    const sources = essenceSources(TALE_CONTENT, "zu");
    expect(sources[0]?.huntable).toBe(true);
    const text = rowsText(realLife({ essence: { zu: 45, lin: 0, xue: 0, meng: 0 } }), {
      kind: "essence",
      type: "zu",
    });
    expect(text).toContain(`45／${T.moltThreshold}`);
    expect(text).toContain(`${sources[0]!.name} +${sources[0]!.amount}`);
    // 「路子」那一句必须把整条链讲一遍
    expect(text).toContain("蛰伏");
    expect(text).toContain("清零");
  });

  /*
   * 精气既是蛰伏的燃料、又是若干抉择的通行证，而蛰伏会把它清零 —— 这是本作里最容易
   * 踩空的一处取舍，所以那一行必须报数目、报下一档、并明说「蛰伏会清零」。
   */
  it("抉择门槛那一行报数目与下一档，并提醒蛰伏会清零", () => {
    const gates = essenceGates(TALE_CONTENT, "zu");
    expect(gates.length).toBeGreaterThan(0);
    const text = rowsText(realLife({ essence: { zu: 10, lin: 0, xue: 0, meng: 0 } }), {
      kind: "essence",
      type: "zu",
    });
    expect(text).toContain(`全青丘 ${gates.length} 处抉择认足之精气`);
    expect(text).toContain(`下一档 足之精气 ${gates[0]!.need}`);
    expect(text).toContain("蛰伏会把此型清零");
  });

  /*
   * **不许点名会开出哪一件**：引擎的 `resolveMolt` 是「按 affinity×精气加权抽三件，再在
   * 这三件里等权抽一」，写成「→ 蜕出坚喙」多数时候会与玩家真拿到的那件不符 —— 而这一批
   * 存在的全部理由就是让屏幕上的话算数。
   */
  it("收尾的那条路子只报候选偏向，不预言开出哪一件", () => {
    const state = realLife({ essence: { zu: 40, lin: 0, xue: 0, meng: 0 } });
    const vm = buildDetailVm(state, TALE_CONTENT, { kind: "essence", type: "zu" })!;
    const pool = moltPool(state, TALE_CONTENT, "zu");
    expect(vm.foot).toContain("候选偏向");
    expect(vm.foot).toContain(pool[0]!.name);
    expect(vm.foot).not.toContain(`蜕出${pool[0]!.name}`);
    // 候选数与引擎的开奖候选数一致（不多报也不少报）
    for (const organ of pool.slice(0, TALE_CONTENT.tuning.moltCandidateCount)) {
      expect(vm.foot).toContain(organ.name);
    }
    expect(vm.foot).not.toContain(pool[TALE_CONTENT.tuning.moltCandidateCount]!.name);
  });

  it("达阈值时收尾句改成「按下方蛰伏」", () => {
    const text = rowsText(realLife({ essence: { zu: T.moltThreshold, lin: 0, xue: 0, meng: 0 } }), {
      kind: "essence",
      type: "zu",
    });
    expect(text).toContain("已够了");
  });
});

describe("器官详情：进化有啥好处（交付内容 B）", () => {
  it("战术后果从 tuning 的 tag 表推，不是写死的映射", () => {
    // 疾足带 swift ＝ tuning.stalkSwiftTag → 那一句必须带真实步数
    expect(tagEffects(["swift"], T).join()).toContain(`多近 ${T.stalkCreepSwiftBonus} 步`);
    // 夜瞳带 night-eye ＝ stalkAlertTags ＋ stalkWindTags ＋ combatIntentTags → 三句都在
    const nightEye = tagEffects(["night-eye"], T);
    expect(nightEye.some((line) => line.includes("精确警觉"))).toBe(true);
    expect(nightEye.some((line) => line.includes("风向"))).toBe(true);
    expect(nightEye.some((line) => line.includes("意图"))).toBe(true);
    // 表里没有的 tag 不硬编文案（它的用处在事件门槛那一行）
    expect(tagEffects(["armor"], T)).toEqual([]);
  });

  it("「它开了哪些抉择」报数目；没见过的事**不剧透**具名", () => {
    const state = realLife({ organIds: ["organ-ling-yun", ORGAN_JI_ZU] });
    const gates = organTagGates(TALE_CONTENT, [
      ...TALE_CONTENT.organs.find((organ) => organ.id === ORGAN_JI_ZU)!.tags,
    ]);
    expect(gates.length).toBeGreaterThan(0);
    const text = rowsText(state, { kind: "organ", id: ORGAN_JI_ZU });
    expect(text).toContain(`全青丘 ${gates.length} 处抉择只认它这一门`);
    expect(text).toContain("尚有未至之事");
    // 没见过的事件标题一律不出现
    expect(text).not.toContain(gates[0]!.eventTitle);
  });

  it("已见过的事才具名（`records` 里的 event 记录就是判据）", () => {
    const gate = organTagGates(TALE_CONTENT, ["swift"])[0]!;
    const state = realLife({
      organIds: ["organ-ling-yun", ORGAN_JI_ZU],
      records: [
        { year: 1, season: 1, kind: "event", text: "见过一桩事", refId: gate.eventId },
      ],
    });
    expect(seenEventIds(state).has(gate.eventId)).toBe(true);
    const text = rowsText(state, { kind: "organ", id: ORGAN_JI_ZU });
    expect(text).toContain(gate.eventTitle);
    expect(text).toContain(gate.choiceLabel!);
  });

  it("战斗技把冷却与附带效果的账算给玩家", () => {
    const state = realLife({ organIds: ["organ-ling-yun", ORGAN_LONG_XIAN] });
    const text = rowsText(state, { kind: "organ", id: ORGAN_LONG_XIAN });
    expect(text).toContain("龙吟");
    expect(text).toContain(`伤 ×${T.organSkillDamageMul}`);
    expect(text).toContain(`护体 ${T.combatWardRounds} 合`);
    expect(text).toContain("冷却 4 合");
    // 龙涎 affinity 为空：不入开奖池这件事要说出来（否则玩家会一直等它开出来）
    expect(text).toContain("不入蛰伏的开奖池");
  });

  it("神种那一枚标明「一世之始」，属性加成照实报", () => {
    const state = realLife();
    const text = rowsText(state, { kind: "organ", id: state.organIds[0]! });
    expect(text).toContain("神种");
    expect(text).toContain("灵 +3");
  });

  it("雾目／灵犀这类纯信息器官也有可读的战术后果", () => {
    for (const id of [ORGAN_WU_MU, ORGAN_LING_XI]) {
      const state = realLife({ organIds: ["organ-ling-yun", id] });
      const vm = buildDetailVm(state, TALE_CONTENT, { kind: "organ", id })!;
      expect(vm.rows.some((row) => row.label === "战术")).toBe(true);
    }
  });
});

describe("登神详情：四门槛各自怎么长", () => {
  it("每一条都带 have／need ＋ 一句路子", () => {
    const text = rowsText(realLife(), { kind: "ascend" });
    // 器官 1／5 —— 出生就有神种那一枚，这一条从第一回合起就是「已经在走」的
    expect(text).toContain(`1／${T.ascendMinOrgans}`);
    expect(text).toContain("攒精气 → 蛰伏");
    expect(text).toContain("抉择");
  });
});

describe("蛰伏按钮预览（交付内容 D）", () => {
  it("未达阈值：差多少 ＋ 满了干什么 ＋ 怎么攒", () => {
    const state = realLife({ essence: { zu: 30, lin: 0, xue: 0, meng: 0 } });
    const text = moltPreviewText(state, TALE_CONTENT);
    expect(text).toContain(`尚需足之精气 ${T.moltThreshold - 30}`);
    expect(text).toContain("满则蜕一器官");
    expect(text).toMatch(/猎野雉|猎穴鼠|猎岩羊/);
  });

  it("达阈值：报是哪一型、候选偏向哪几件", () => {
    const state = realLife({ essence: { zu: T.moltThreshold + 4, lin: 0, xue: 0, meng: 0 } });
    const text = moltPreviewText(state, TALE_CONTENT);
    expect(text).toContain("以足之精气蜕形");
    expect(text).toContain("候选偏向");
    expect(text).toContain(moltPool(state, TALE_CONTENT, "zu")[0]!.name);
  });

  it("候选池空（该型器官全长齐了）时明说会白费一季", () => {
    const zuOrgans = TALE_CONTENT.organs
      .filter((organ) => (organ.affinity.zu ?? 0) > 0)
      .map((organ) => organ.id);
    const state = realLife({
      organIds: ["organ-ling-yun", ...zuOrgans],
      essence: { zu: T.moltThreshold, lin: 0, xue: 0, meng: 0 },
    });
    expect(moltPreviewText(state, TALE_CONTENT)).toContain("白费一季");
  });
});

describe("detailKey", () => {
  it("五种选中处各有稳定 id（界面据此判断「再点一次＝收起」）", () => {
    expect(detailKey({ kind: "stat", key: "meng" })).toBe("stat:meng");
    expect(detailKey({ kind: "essence", type: "zu" })).toBe("essence:zu");
    expect(detailKey({ kind: "organ", id: ORGAN_JI_ZU })).toBe(`organ:${ORGAN_JI_ZU}`);
    expect(detailKey({ kind: "hunger" })).toBe("hunger");
    expect(detailKey({ kind: "ascend" })).toBe("ascend");
  });

  it("器官 id 不存在时返回 null（内容 bug 不该炸掉整屏）", () => {
    expect(buildDetailVm(realLife(), TALE_CONTENT, { kind: "organ", id: "no-such" })).toBeNull();
  });
});
