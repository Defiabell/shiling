import { describe, expect, it } from "vitest";
import { quickHuntPreview } from "@shiling/tale-sim";
import { actionOfButton, buildActionVms } from "../src/model/actionVm.js";
import { FIXTURE_CONTENT, fightingState, newState, withPatch } from "./helpers.js";

const T = FIXTURE_CONTENT.tuning;

describe("buildActionVms", () => {
  // [S2] 探索离开了这一排（它变成了一排去处按钮，见 destinationVm.test.ts）
  // [饥饿节奏批] 狩猎拆成两颗：追猎／速猎（平级，不是二级菜单 —— 每季仍只点一次）
  it("四颗按钮恒在（蛰伏不可用时置灰而不是隐藏），且探索不在其中", () => {
    const vms = buildActionVms(newState(), FIXTURE_CONTENT);
    expect(vms.map((vm) => vm.id)).toEqual(["hunt", "hunt-quick", "rest", "dormant"]);
  });

  it("蛰伏置灰时说清还差多少精气（差多少来自最高的一型）＋攒它干什么", () => {
    const state = withPatch(newState(), { essence: { zu: 18, lin: 4, xue: 0, meng: 0 } });
    const dormant = buildActionVms(state, FIXTURE_CONTENT)[3]!;
    expect(dormant.enabled).toBe(false);
    expect(dormant.highlight).toBe(false);
    expect(dormant.disabledReason).toContain(`尚需足之精气 ${T.moltThreshold - 18}`);
    // 禁用时 hint 被 disabledReason 顶掉，所以「蛰伏＝换器官」得在这句里说清
    expect(dormant.disabledReason).toContain("器官");
  });

  it("任一精气达阈值 → 蛰伏点亮并高亮", () => {
    const state = withPatch(newState(), {
      essence: { zu: 0, lin: T.moltThreshold, xue: 0, meng: 0 },
    });
    const dormant = buildActionVms(state, FIXTURE_CONTENT)[3]!;
    expect(dormant.enabled).toBe(true);
    expect(dormant.highlight).toBe(true);
    expect(dormant.disabledReason).toBeNull();
  });

  it("战斗中四颗全灰，理由一律是「战事未了」", () => {
    const base = newState();
    const state = fightingState(base);
    const vms = buildActionVms(state, FIXTURE_CONTENT);
    expect(vms.every((vm) => !vm.enabled)).toBe(true);
    expect(vms.map((vm) => vm.disabledReason)).toEqual([
      "战事未了",
      "战事未了",
      "战事未了",
      "战事未了",
    ]);
  });

  it("精气已满却在打架时，蛰伏说「战事未了」而不是「尚需…0」", () => {
    const base = newState();
    const state = fightingState(
      withPatch(base, { essence: { zu: T.moltThreshold + 5, lin: 0, xue: 0, meng: 0 } }),
    );
    const dormant = buildActionVms(state, FIXTURE_CONTENT)[3]!;
    expect(dormant.enabled).toBe(false);
    expect(dormant.highlight).toBe(false);
    expect(dormant.disabledReason).toBe("战事未了");
  });

  it("死后全灰，理由是「已殁」", () => {
    const state = withPatch(newState(), { alive: false, ending: "starve" });
    const vms = buildActionVms(state, FIXTURE_CONTENT);
    expect(vms.every((vm) => !vm.enabled)).toBe(true);
    expect(vms[0]?.disabledReason).toBe("已　殁");
  });
});

/**
 * [饥饿节奏批] 两颗狩猎按钮**必须摊开分别** —— 这一组是那条铁律的可执行版。
 *
 * 判据不是「两句话不一样」，而是**四项差别逐项写在按钮上**：点击数、食、精气、食余。
 * 少写任何一项，玩家就只能靠试才知道自己刚才买的是什么（＝翻牌）。
 */
describe("追猎 vs 速猎：按钮上读得出分别", () => {
  const vms = (): ReturnType<typeof buildActionVms> => buildActionVms(newState(), FIXTURE_CONTENT);
  const hunt = (): string => vms()[0]!.hint;
  const quick = (): string => vms()[1]!.hint;

  it("追猎那颗写：全额饱食 ＋ 整份精气 ＋ 食余", () => {
    expect(hunt()).toContain(`+${T.huntFoodGain} 饱食`);
    expect(hunt()).toContain("整份精气");
    expect(hunt()).toContain("食余");
    expect(hunt()).toContain(`+${T.huntSurplusGain}`);
  });

  it("速猎那颗写：得手率 ＋ 打折的饱食 ＋ 半份精气 ＋ **无食余**", () => {
    const preview = quickHuntPreview(newState(), FIXTURE_CONTENT);
    expect(quick()).toContain(`+${preview.foodGain} 饱食`);
    expect(quick()).toContain("半份精气");
    expect(quick()).toContain("无食余");
    // 得手率必须是**数**（汉字成数也是数）：只写「较易得手」等于没说
    expect(quick()).toMatch(/[〇一二三四五六七八九十]成/);
  });

  it("速猎的饱食确实是打了折的那一份（折的是一趟追猎的总值）", () => {
    const preview = quickHuntPreview(newState(), FIXTURE_CONTENT);
    /*
     * **手算的字面量**，不是把 `quickHuntFoodOf` 的算式抄一遍：fixture 吃基线调参
     * （得手 26 ＋ 缺省食余 2 季 × 8 ＝ 一趟总值 42），×0.6 ＝ 25.2 → 25。
     * 抄算式会连「系数写反」一起抄过去，那种断言永远不会红（P1 的自证式断言教训）。
     */
    expect(T.huntFoodGain).toBe(26);
    expect(preview.stalkWorth).toBe(42);
    expect(preview.foodGain).toBe(25);
    // 一趟追猎（连食余）恒比速猎值钱 —— 否则那五次点击就白花了
    expect(preview.foodGain).toBeLessThan(preview.stalkWorth);
  });

  it("速猎得手率随猛变（按钮上的数不是死的）", () => {
    const weak = newState();
    const strong = withPatch(weak, { stats: { ...weak.stats, meng: weak.stats.meng + 30 } });
    expect(quickHuntPreview(strong, FIXTURE_CONTENT).chance).toBeGreaterThan(
      quickHuntPreview(weak, FIXTURE_CONTENT).chance,
    );
  });

  it("休憩那颗把**净额**写出来（它当年就是靠只写毛额才成了陷阱）", () => {
    const rest = vms()[2]!;
    expect(rest.hint).toContain(`+${T.restHungerGain} 饱食`);
    expect(rest.hint).toContain(`净 +${T.restHungerGain - T.hungerPerSeason}`);
  });

  it("按钮 id → 行动 id：速猎落到 hunt（引擎那侧它是参数，不是第五个行动）", () => {
    expect(actionOfButton("hunt-quick")).toBe("hunt");
    expect(actionOfButton("hunt")).toBe("hunt");
    expect(actionOfButton("rest")).toBe("rest");
  });
});
