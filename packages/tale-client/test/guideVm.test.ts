/**
 * 首世引导链（交付内容 E）。
 *
 * 这份测试守的是这一批的**验收第三问**：「吃什么→涨什么→开什么」这条链有没有被完整
 * 讲过一次。所以除了推进逻辑，重点断言两处文案：
 * - 第二步的提示必须把「猎某物 → 某型精气 N／90 → 蛰伏 → 蜕出某器官」串成一句；
 * - 走完全链的收尾句必须把玩家**真的走过的那条**链复述一遍（不是通稿）。
 */

import { describe, expect, it } from "vitest";
import { lifeTuning, waysProgress } from "@shiling/tale-sim";
import { ORGAN_JI_ZU, ORGAN_LONG_XIAN, TALE_CONTENT } from "@shiling/tale-content";
import {
  GUIDE_STEPS,
  advanceGuide,
  buildGuideVm,
  guideChainSummary,
  guideSnapshot,
  type GuideSnapshot,
} from "../src/model/guideVm.js";
import { WAY_LABELS } from "../src/model/format.js";
import { realState as newState, withPatch } from "./helpers.js";

/**
 * [2026-08-13] 期望值一律按**这一世生效的调参**算，不按 `TALE_CONTENT.tuning` 算。
 *
 * 天时会改 `hungerPerSeason`／`huntFoodGain`／`moltThreshold` 这几项（大旱之年每季 −15
 * 而不是基线的 −12），而引导链的提示读的就是生效值 —— 拿基线当期望值只会在下一次
 * 「这个种子换了个天时」时红一次，而红的是测试而不是产品。
 */
const T = lifeTuning(newState(), TALE_CONTENT);
const SEED_ORGAN = "organ-ling-yun";

function snap(patch: Partial<GuideSnapshot> = {}): GuideSnapshot {
  return {
    essenceTotal: 0,
    dormantMolted: false,
    sawOrganGateChoice: false,
    openedAscend: false,
    gatesMet: 0,
    ...patch,
  };
}

describe("advanceGuide", () => {
  it("四步，出生时停在第一步", () => {
    expect(GUIDE_STEPS.length).toBe(4);
    expect(advanceGuide(0, snap())).toBe(0);
  });

  it("吃到一口（任一型精气 >0）＝ 第一步达成", () => {
    expect(advanceGuide(0, snap({ essenceTotal: 16 }))).toBe(1);
  });

  it("一口气满足前两步时连跳两格，不卡在中间那一格", () => {
    expect(advanceGuide(0, snap({ essenceTotal: 90, dormantMolted: true }))).toBe(2);
  });

  /*
   * 第二步认的是「真的蛰伏过」，不是「身上多了一枚器官」——器官也能由事件的 addOrganId
   * 直接送来（「垂死应龙」只要德 ≥20），那条路径不该让「蛰伏是你变强的唯一途径」自动打勾。
   */
  it("身上有器官但没蛰伏过时，第二步不算达成", () => {
    expect(advanceGuide(0, snap({ essenceTotal: 12, dormantMolted: false }))).toBe(1);
  });

  it("只前进不后退（转世后由 app 重置 index，而不是靠它自己回滚）", () => {
    expect(advanceGuide(2, snap())).toBe(2);
  });

  it("第四步：点开过登神之路，或已点亮任一门槛", () => {
    const before = snap({ essenceTotal: 9, dormantMolted: true, sawOrganGateChoice: true });
    expect(advanceGuide(0, before)).toBe(3);
    expect(advanceGuide(0, { ...before, openedAscend: true })).toBe(4);
    expect(advanceGuide(0, { ...before, gatesMet: 1 })).toBe(4);
  });
});

describe("guideSnapshot", () => {
  it("精气总量从 TaleState 来；蛰伏过没有只能由界面告诉它（引擎不分两种来源）", () => {
    const state = withPatch(newState(), {
      essence: { zu: 12, lin: 3, xue: 0, meng: 0 },
      organIds: [SEED_ORGAN, ORGAN_JI_ZU],
    });
    const ui = { dormantMolted: false, sawOrganGateChoice: false, openedAscend: false };
    const result = guideSnapshot(state, TALE_CONTENT, ui);
    expect(result.essenceTotal).toBe(15);
    // 身上已有第二枚器官，但没蛰伏过 —— 快照照实报 false
    expect(result.dormantMolted).toBe(false);
    expect(guideSnapshot(state, TALE_CONTENT, { ...ui, dormantMolted: true }).dormantMolted).toBe(true);
    /*
     * 最接近的那条道达成了几条门槛。这一世还没夺过命，于是**化灵**的「不杀一命」已经
     * 达成 —— 那正是引擎判的「最近的一条」，`gatesMet` 照实报 1。
     * （这一位只用来判断引导链第四步是否该自动打勾。）
     */
    expect(result.gatesMet).toBe(1);
  });
});

describe("每一步的提示都带真数（不是「去猎食吧」这种废话）", () => {
  it("第一步：饱食账 ＋ 一次得手补多少", () => {
    const vm = buildGuideVm(newState(), TALE_CONTENT, 0);
    expect(vm.step).toBe(1);
    expect(vm.hint).toContain(`每季 −${T.hungerPerSeason}`);
    expect(vm.hint).toContain(`+${T.huntFoodGain} 饱食`);
  });

  it("第二步：把「猎什么→涨什么→蛰伏→蜕出什么」串成一句", () => {
    const state = withPatch(newState(), { essence: { zu: 32, lin: 0, xue: 0, meng: 0 } });
    const vm = buildGuideVm(state, TALE_CONTENT, 1);
    expect(vm.hint).toMatch(/^猎/); // 从「猎某物」起头
    expect(vm.hint).toContain(`足 32／${T.moltThreshold}`);
    expect(vm.hint).toContain("蛰伏");
    // **不许点名会开出哪一件**（引擎是加权抽三再等权抽一）：只报偏向
    expect(vm.hint).toContain("偏足的器官");
    expect(vm.hint).toContain("疾足"); // zu 亲和最高的那一件，在候选里
    expect(vm.hint).not.toContain("蜕出疾足");
  });

  it("第三步：报出已蜕器官认得几处抉择（进化有啥好处的兑现）", () => {
    const state = withPatch(newState(), { organIds: [SEED_ORGAN, ORGAN_JI_ZU] });
    const vm = buildGuideVm(state, TALE_CONTENT, 2);
    expect(vm.hint).toContain("疾足认得");
    expect(vm.hint).toMatch(/\d+ 处抉择/);
  });

  it("第三步在一件器官都没蜕时先教「去蜕一枚」", () => {
    expect(buildGuideVm(newState(), TALE_CONTENT, 2).hint).toContain("先蜕一枚器官");
  });

  /**
   * [2026-08-13] 第四步教的是那条**横带**（四道并列），提示报的是「最接近的那条道」的
   * 逐条门槛 —— 与横带缺省展开的那条同源，首尾对得上。
   */
  it("第四步：最接近那条道的门槛一行摆齐", () => {
    const state = newState();
    const vm = buildGuideVm(state, TALE_CONTENT, 3);
    const progress = waysProgress(state, TALE_CONTENT);
    const nearest = progress.ways.find((way) => way.id === progress.nearest);
    expect(vm.hint).toContain(WAY_LABELS[progress.nearest]);
    for (const gate of nearest?.gates ?? []) {
      expect(vm.hint).toContain(`${gate.have}／${gate.need}`);
    }
  });
});

describe("走完全链的收尾句：验收第三问", () => {
  it("复述玩家真的走过的那条链（猎物 → 精气 → 器官 → 抉择）", () => {
    const state = withPatch(newState(), { organIds: [SEED_ORGAN, ORGAN_JI_ZU] });
    const summary = guideChainSummary(state, TALE_CONTENT);
    expect(summary).toContain("猎");
    expect(summary).toContain("足之精气");
    expect(summary).toContain(String(T.moltThreshold));
    expect(summary).toContain("蛰伏");
    expect(summary).toContain("疾足");
    expect(summary).toContain("抉择");
  });

  it("index 越界即 complete，此时 hint 空、text 就是那条链", () => {
    const state = withPatch(newState(), { organIds: [SEED_ORGAN, ORGAN_JI_ZU] });
    const vm = buildGuideVm(state, TALE_CONTENT, GUIDE_STEPS.length);
    expect(vm.complete).toBe(true);
    expect(vm.hint).toBe("");
    expect(vm.text).toBe(guideChainSummary(state, TALE_CONTENT));
  });

  it("一件都没蜕就走完（跳步的极端情形）也给得出通用链，不会报错", () => {
    const vm = buildGuideVm(newState(), TALE_CONTENT, GUIDE_STEPS.length);
    expect(vm.text).toContain("蛰伏");
    expect(vm.text).toContain("新器官");
  });
});

/*
 * 一条实机撞出来的取舍：龙涎（`affinity` 刻意留空、只能由「垂死应龙」事件送到手上）
 * 也认得住抉择，若只按「能开抉择」挑，收尾句的头就退化成泛泛的「猎食 → 精气」——
 * 而这一句的全部意义正是说清**猎什么涨什么**。
 */
describe("收尾句挑哪一枚器官来复述", () => {
  it("同时有龙涎与疾足时，讲得出「猎某物 → 某型精气」的那一枚优先", () => {
    const state = withPatch(newState(), {
      organIds: [SEED_ORGAN, ORGAN_LONG_XIAN, ORGAN_JI_ZU],
    });
    const summary = guideChainSummary(state, TALE_CONTENT);
    expect(summary).toContain("足之精气");
    expect(summary).toContain("疾足");
  });

  it("只有龙涎时也不报错，只是头一句退回泛指", () => {
    const state = withPatch(newState(), { organIds: [SEED_ORGAN, ORGAN_LONG_XIAN] });
    const summary = guideChainSummary(state, TALE_CONTENT);
    expect(summary).toContain("龙涎");
    expect(summary).toContain("蛰伏");
  });
});
