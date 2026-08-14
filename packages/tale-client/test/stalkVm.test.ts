/**
 * 追猎屏视图模型（M1-P1）。
 *
 * 这份测试守的是**界面有没有如实把决策变量摆出来**，因为追猎的全部意义就在这里：
 * 一颗不写「按下去会发生什么」的按钮，等于 M0 那个「点了才知道」的狩猎按钮换了张皮。
 *
 * 三组：
 * 1. 四个动作各自的预期效果字串必须真的带着数（不是「潜行」两个字了事）；
 * 2. 精确值 vs 模糊档位按器官 tag 切换，且**互斥**（有确数就不该只给档位，反之亦然）；
 * 3. 该警告的都警告到了：顺风、必失手、失手要打、已在上风（白费一息）、体力将尽。
 */

import { describe, expect, it } from "vitest";
import { approachOf, createLife, performAction, stalkAct, type TaleContent, type TaleState } from "@shiling/tale-sim";
import { TALE_CONTENT, ORGAN_YE_TONG, SEED_CHANG_TAI } from "@shiling/tale-content";
import { buildStalkVm } from "../src/model/stalkVm.js";

/** [M2-B1] 改接近阶段的某几个量（接近状态住在遭遇外壳里，各处手写会漏掉外壳）。 */
function withApproach(state: TaleState, patch: Partial<NonNullable<TaleState["encounter"]>["approach"]>): TaleState {
  const encounter = state.encounter;
  if (!encounter?.approach) throw new Error("withApproach: 不在接近阶段");
  return { ...state, encounter: { ...encounter, approach: { ...encounter.approach, ...patch } } };
}

const CONTENT: TaleContent = { ...TALE_CONTENT, tuning: { ...TALE_CONTENT.tuning, eventChanceBase: 0 } };

/** 起追一场（关掉事件，狩猎必然进追猎屏）。 */
function stalkState(seed = 20260812, organIds: readonly string[] = []): TaleState {
  const born = createLife(seed, SEED_CHANG_TAI, CONTENT);
  const withOrgans =
    organIds.length > 0 ? { ...born, organIds: [...born.organIds, ...organIds] } : born;
  const state = performAction(withOrgans, "hunt", CONTENT).state;
  if (!approachOf(state)) throw new Error("stalkState: 这一季没起追（种子不合适）");
  return state;
}

function vmOf(state: TaleState) {
  const approach = approachOf(state);
  if (!approach) throw new Error("vmOf: 不在接近阶段");
  return buildStalkVm(state, approach, CONTENT);
}

function actionOf(state: TaleState, id: "creep" | "circle" | "wait" | "pounce") {
  const action = vmOf(state).actions.find((candidate) => candidate.id === id);
  if (!action) throw new Error(`actionOf: 没有 ${id} 这颗按钮`);
  return action;
}

describe("四量可视化", () => {
  it("距离/警觉/体力三个量都给出读数、档位与条形比例", () => {
    const vm = vmOf(stalkState());
    for (const meter of [vm.distance, vm.alert, vm.stamina]) {
      expect(meter.label.length).toBeGreaterThan(0);
      expect(meter.band.length).toBeGreaterThan(0);
      expect(meter.percent).toBeGreaterThanOrEqual(0);
      expect(meter.percent).toBeLessThanOrEqual(100);
      expect(meter.hint.length).toBeGreaterThan(0);
    }
    expect(vm.roundLabel).toMatch(/第 \d+ 息/);
    expect(vm.preyName.length).toBeGreaterThan(0);
  });

  it("距离与体力对谁都是精确的（自己的腿脚与步数不需要器官来读）", () => {
    const vm = vmOf(stalkState());
    expect(vm.distance.exact).toBe(true);
    expect(vm.stamina.exact).toBe(true);
  });

  it("距离轨的 closeness 随逼近单调上升", () => {
    let state = stalkState();
    const before = vmOf(state).closeness;
    state = stalkAct(state, "creep", CONTENT).state;
    if (!approachOf(state)) return; // 起手就收束的极端种子跳过
    expect(vmOf(state).closeness).toBeGreaterThan(before);
  });

  it("体力剩一动时转告急并明说后果", () => {
    const state = stalkState();
    const low: TaleState = withApproach(state, { stamina: 1 });
    const vm = vmOf(low);
    expect(vm.stamina.hot).toBe(true);
    expect(vm.stamina.band).toBe("将尽");
    expect(vm.stamina.hint).toContain("罢手");
  });
});

describe("动作按钮必须预告后果", () => {
  it("四颗按钮都带非空的预期效果", () => {
    const vm = vmOf(stalkState());
    expect(vm.actions.map((action) => action.id)).toEqual(["creep", "circle", "wait", "pounce"]);
    for (const action of vm.actions) {
      expect(action.effect.length, `${action.id} 没有预期效果`).toBeGreaterThan(0);
      expect(action.glyph.length).toBe(1);
    }
  });

  it("潜行写清「近几步、警觉涨多少、扑中会变成什么」", () => {
    const creep = actionOf(stalkState(), "creep");
    expect(creep.effect).toMatch(/近 \d+ 步/);
    expect(creep.effect).toMatch(/警觉 [+−]\d+/);
    // 「扑中转 X」是档位模式下唯一能看出收益的东西 —— 少了它，模糊档位就等于没信息
    expect(creep.effect).toContain("扑中转");
  });

  it("屏息写清压多少警觉与挪位风险", () => {
    const wait = actionOf(stalkState(), "wait");
    expect(wait.effect).toMatch(/警觉 −\d+/);
    expect(wait.effect).toContain("挪位");
  });

  it("扑击写清命中率", () => {
    const pounce = actionOf(stalkState(), "pounce");
    expect(pounce.effect).toMatch(/命中 .+/);
  });

  it("同一时刻最多一颗按钮发金光（否则等于没有推荐）", () => {
    for (let seed = 0; seed < 30; seed += 1) {
      let state: TaleState;
      try {
        state = stalkState(20260812 + seed * 7919);
      } catch {
        continue;
      }
      const hot = vmOf(state).actions.filter((action) => action.highlight);
      expect(hot.length, `种子 ${seed} 同时有 ${hot.length} 颗高亮`).toBeLessThanOrEqual(1);
    }
  });
});

describe("精确值 vs 模糊档位（器官 tag 决定信息精度）", () => {
  it("没有夜瞳／灵犀：警觉只给档位，不给数字", () => {
    const vm = vmOf(stalkState());
    expect(vm.alert.exact).toBe(false);
    expect(["未觉", "有疑", "欲遁"]).toContain(vm.alert.band);
    expect(vm.alert.hint).toContain("夜瞳");
    // 命中率也是档位（汉字成数只给读得出确数的 build）
    expect(vm.pounceLabel).not.toMatch(/成/);
  });

  it("带夜瞳：警觉给确数，命中率给汉字成数", () => {
    const vm = vmOf(stalkState(20260812, [ORGAN_YE_TONG]));
    expect(vm.alert.exact).toBe(true);
    expect(vm.alert.hint).toContain("／100");
    expect(vm.pounceLabel).toMatch(/成/);
  });

  it("带夜瞳时风向也读得出（正本：night-eye 同时给警觉与风向）", () => {
    expect(vmOf(stalkState()).windVisible).toBe(false);
    expect(vmOf(stalkState(20260812, [ORGAN_YE_TONG])).windVisible).toBe(true);
  });

  it("读不出风向时只写「风势难辨」，不泄露真风向", () => {
    const vm = vmOf(stalkState());
    expect(vm.windLabel).toBe("风势难辨");
    expect(vm.windMulLabel).toBeNull();
    expect(vm.windAgainst).toBe(false);
    expect(vm.windHint).toContain("雾目");
  });

  it("读得出风向时写明风向与潜行动静倍率", () => {
    const vm = vmOf(stalkState(20260812, [ORGAN_YE_TONG]));
    expect(["逆风", "侧风", "顺风"]).toContain(vm.windLabel);
    expect(vm.windMulLabel).toMatch(/潜行动静 ×/);
  });

  /*
   * 这一条守着实机跑出来的那个坑：读不出风向的 build 若看不到「绕行」被推荐，
   * 界面等于在劝玩家别管风，而顺风硬冲的得手率只有三成。
   */
  it("读不出风向时照样推荐绕行（不确定就花一息买确定）", () => {
    const circle = actionOf(stalkState(), "circle");
    expect(circle.highlight).toBe(true);
    expect(circle.warning).toContain("绕一圈可保准是逆风");
  });

  it("读得出风向且已在上风时，绕行明说是白费", () => {
    const seer = stalkState(20260812, [ORGAN_YE_TONG]);
    const upwind: TaleState = withApproach(seer, { wind: "into" });
    const circle = actionOf(upwind, "circle");
    expect(circle.highlight).toBe(false);
    expect(circle.warning).toContain("白费");
  });
});

describe("警告", () => {
  it("必失手时明确警告（不是让玩家从 2% 里自己悟）", () => {
    const state = stalkState();
    const far: TaleState = withApproach(state, { distance: 40, alertness: 90 });
    const vm = vmOf(far);
    expect(vm.pounceHopeless).toBe(true);
    const pounce = vm.actions.find((action) => action.id === "pounce");
    expect(pounce?.warning).toContain("几乎必空");
    expect(pounce?.highlight).toBe(false);
  });

  it("反扑的猎物：扑之前就写明失手要打", () => {
    // 岩羊是猎物表里唯一 retaliates 的一头，多试几个种子直到抽到它
    for (let seed = 0; seed < 60; seed += 1) {
      let state: TaleState;
      try {
        state = stalkState(20260812 + seed * 7919);
      } catch {
        continue;
      }
      if (state.encounter?.enemyId !== "yan-yang") continue;
      // 常驻标记：远距离时扑击按钮的警告位被「几乎必空」占着，所以这件事挂在名号旁边
      expect(vmOf(state).preyBadge).toBe("会反扑");
      // 逼到近处后，扑击按钮自己也要把赌注写出来
      const close: TaleState = withApproach(state, { distance: 0, alertness: 10 });
      expect(actionOf(close, "pounce").warning).toContain("硬仗");
      return;
    }
    throw new Error("60 个种子都没抽到岩羊 —— 猎物表配置变了？");
  });

  it("顺风逼近时潜行按钮警告翻倍（前提是看得见风）", () => {
    const seer = stalkState(20260812, [ORGAN_YE_TONG]);
    const downwind: TaleState = withApproach(seer, { wind: "with" });
    expect(actionOf(downwind, "creep").warning).toContain("翻倍");
  });

  it("贴身后潜行无益时明说，且不再发金光", () => {
    const state = stalkState();
    const point: TaleState = withApproach(state, { distance: 0 });
    const creep = actionOf(point, "creep");
    expect(creep.warning).toContain("再近无益");
    expect(creep.highlight).toBe(false);
    expect(creep.effect).not.toContain("扑中转");
  });

  it("警觉已经归零时屏息明说是白耗", () => {
    const state = stalkState();
    const calm: TaleState = withApproach(state, { alertness: 0 });
    expect(actionOf(calm, "wait").warning).toContain("白耗");
  });
});

describe("纪律", () => {
  it("是纯函数：同一 state 连造两次结果一致，且不动入参", () => {
    const state = stalkState();
    const snapshot = structuredClone(state);
    expect(vmOf(state)).toEqual(vmOf(state));
    expect(state).toEqual(snapshot);
  });

  it("猎物名与描述取自内容库，不是界面自己写的字符串", () => {
    const state = stalkState();
    const prey = CONTENT.enemies.find((enemy) => enemy.id === state.encounter?.enemyId);
    const vm = vmOf(state);
    expect(vm.preyName).toBe(prey?.name);
    expect(vm.preyDesc).toBe(prey?.desc);
  });

  it("log 直接来自引擎（界面不改写旁白）", () => {
    const state = stalkState();
    expect(vmOf(state).log).toEqual(state.encounter?.log);
  });
});

/**
 * [S3] 「图鉴知识」在追猎屏上的兑现。
 *
 * 这一组量的是**同一头猎物、同一颗种子**下，参透与没参透看到的字有什么不同 ——
 * 那正是 S3 验收第三问要贴的对照。判据不是「有个字段变了」，是**屏幕上的读数换了一种**：
 * 档位（「未觉」「参半」）→ 确数（「警觉 23」「四成六」）。
 */
describe("[S3] 已参透的异兽：读数从档位换成确数", () => {
  /** 同一颗种子、同一头猎物，只差一份图鉴知识 */
  function pair(seed = 20260812) {
    const born = createLife(seed, SEED_CHANG_TAI, CONTENT);
    const blind = performAction(born, "hunt", CONTENT).state;
    if (!approachOf(blind)) throw new Error("这一季没起追");
    const preyId = blind.encounter!.enemyId;
    const knownBorn = createLife(seed, SEED_CHANG_TAI, CONTENT, { loreEnemyIds: [preyId] });
    const known = performAction(knownBorn, "hunt", CONTENT).state;
    return { blind, known, preyId };
  }

  it("同一头猎物：未识只有档位，已识给确数（且两屏的猎物真是同一头）", () => {
    const { blind, known, preyId } = pair();
    expect(known.encounter?.enemyId).toBe(preyId);

    const dim = vmOf(blind);
    const lit = vmOf(known);
    expect(dim.alert.exact).toBe(false);
    expect(lit.alert.exact).toBe(true);
    // 警觉那一格：档位 vs 确数
    expect(dim.alert.hint).toContain("大概");
    expect(lit.alert.hint).toContain(`警觉 ${approachOf(known)!.alertness}`);
    // 命中率那一行：七档汉字 vs 汉字成数
    expect(dim.pounceLabel).not.toContain("成");
    expect(lit.pounceLabel).toContain("成");
  });

  it("名号旁多一枚「已入图鉴」小牌（与「会反扑」并列，不是二选一）", () => {
    const { blind, known } = pair();
    expect(vmOf(blind).preyLoreBadge).toBeNull();
    expect(vmOf(known).preyLoreBadge).toBe("已入图鉴");
  });

  it("读不出确数的那一屏要说得出**两条**出路（长器官／参透此兽）", () => {
    const { blind } = pair();
    expect(vmOf(blind).alert.hint).toContain("夜瞳");
    expect(vmOf(blind).alert.hint).toContain("血统");
  });

  it("参透的是别的兽 → 这一头照旧读不出（不是「买一送全部」）", () => {
    const born = createLife(20260812, SEED_CHANG_TAI, CONTENT, { loreEnemyIds: ["qiong-qi-you"] });
    const state = performAction(born, "hunt", CONTENT).state;
    const approach = approachOf(state);
    if (!approach || state.encounter?.enemyId === "qiong-qi-you") return;
    expect(buildStalkVm(state, approach, CONTENT).alert.exact).toBe(false);
  });
});
