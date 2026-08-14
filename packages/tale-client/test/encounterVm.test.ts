/**
 * [M2-B1] 遭遇屏公共外壳的视图模型。
 *
 * 这份测试守的是**「一套 UI 语汇」这条交付线在屏幕上真的成立**：
 *
 * 1. 势条、部位伤牌、四相盘在**两个阶段都在**（接近与交锋读的是同一个函数）；
 * 2. 四相盘的每一行都写得出**此刻的数**（owner 那句「好好展示积累的各项指标的作用」——
 *    一句没有数的形容词与「藏在公式里」是同一回事）；
 * 3. 破绽牌没识破时也要写清**怎么才识得破**（还差几合／还差几口）——
 *    一枚只写「尚未看出破绽」的牌是废话。
 */

import { describe, expect, it } from "vitest";
import { createLife, performAction, type TaleContent, type TaleState } from "@shiling/tale-sim";
import { SEED_CHANG_TAI, TALE_CONTENT } from "@shiling/tale-content";
import { buildEncounterChromeVm } from "../src/model/encounterVm.js";
import { fightingState, realState, withPatch } from "./helpers.js";

/** 关掉事件抽取，好让「狩猎」这一季必定起追。 */
const CONTENT: TaleContent = {
  ...TALE_CONTENT,
  tuning: { ...TALE_CONTENT.tuning, eventChanceBase: 0 },
};

function approaching(seed = 20260814): TaleState {
  const state = performAction(createLife(seed, SEED_CHANG_TAI, CONTENT), "hunt", CONTENT).state;
  if (state.encounter?.phase !== "approach") throw new Error("这一季没起追（种子不合适）");
  return state;
}

describe("[M2-B1] 遭遇外壳：两个阶段共用同一套语汇", () => {
  it("接近阶段也有势条、部位伤牌与四相盘（不是交锋屏专属）", () => {
    const vm = buildEncounterChromeVm(approaching(), CONTENT);
    expect(vm.phaseLabel).toBe("接近");
    expect(vm.originLabel).toBe("我盯上了它");
    expect(vm.momentum.pips.length).toBeGreaterThan(0);
    expect(vm.wounds.map((wound) => wound.part)).toEqual(["throat", "leg", "eye"]);
    expect(vm.stats.map((line) => line.key)).toEqual(["meng", "ti", "ling", "de"]);
    expect(vm.log.length).toBeGreaterThan(0);
  });

  it("交锋阶段读的是同一个函数、同一套字段（换的只有中段）", () => {
    const vm = buildEncounterChromeVm(fightingState(realState(), { enemyId: "ye-zhi" }), CONTENT);
    expect(vm.phaseLabel).toBe("交锋");
    expect(vm.stats.map((line) => line.key)).toEqual(["meng", "ti", "ling", "de"]);
    expect(vm.wounds).toHaveLength(3);
  });

  it("来路三种各有各的说法（主动权是玩家该读到的第一件事）", () => {
    const say = (origin: "hunt" | "ambush" | "event"): string =>
      buildEncounterChromeVm(
        fightingState(realState(), { enemyId: "ye-zhi" }, { origin }),
        CONTENT,
      ).originLabel;
    expect(new Set([say("hunt"), say("ambush"), say("event")]).size).toBe(3);
  });
});

describe("[M2-B1] 势条：读得出「攒到几点、还差几点」", () => {
  it("pips 长度＝上限、点亮数＝当前，标签写出比值", () => {
    const state = fightingState(realState(), { enemyId: "ye-zhi" }, { momentum: 2, momentumMax: 5 });
    const vm = buildEncounterChromeVm(state, CONTENT);
    expect(vm.momentum.pips).toEqual([true, true, false, false, false]);
    expect(vm.momentum.label).toContain("2／5");
    expect(vm.momentum.hot).toBe(false);
    // 没攒够时提示里要写「还差几点」—— 看不见的目标没人会去攒
    expect(vm.momentum.hint).toContain("再攒");
  });

  it("攒够决杀时转金，且提示改说「它护不住」", () => {
    const state = fightingState(realState(), { enemyId: "ye-zhi" }, { momentum: 6, momentumMax: 6 });
    const vm = buildEncounterChromeVm(state, CONTENT);
    expect(vm.momentum.hot).toBe(true);
    expect(vm.momentum.label).toContain("可发决杀");
    expect(vm.momentum.hint).toContain("护不住");
  });
});

describe("[M2-B1] 部位伤牌：断腿／废眼那两件一劳永逸的事要看得出已经成了", () => {
  it("[M2-B1] 咬喉那一格明说「不留伤」（它是爆发那一档）—— 不许再挂一句永远不会发生的承诺", () => {
    const vm = buildEncounterChromeVm(fightingState(realState(), { enemyId: "ye-zhi" }), CONTENT);
    const throat = vm.wounds.find((wound) => wound.part === "throat");
    expect(throat?.neverWounds).toBe(true);
    expect(throat?.hint).toContain("不留整场伤");
    // 反证：另两处是真的会累积的，所以它们不许被标成「不留伤」
    expect(vm.wounds.filter((wound) => wound.neverWounds).map((wound) => wound.part)).toEqual(["throat"]);
  });

  it("没伤时不标记，有伤时写层数", () => {
    const clean = buildEncounterChromeVm(fightingState(realState(), { enemyId: "ye-zhi" }), CONTENT);
    expect(clean.wounds.every((wound) => wound.stacks === 0 && !wound.landmark)).toBe(true);
    const hurt = buildEncounterChromeVm(
      fightingState(realState(), { enemyId: "ye-zhi" }, { wounds: { throat: 0, leg: 1, eye: 0 } }),
      CONTENT,
    );
    expect(hurt.wounds.find((wound) => wound.part === "leg")?.stacks).toBe(1);
  });

  it("腿伤到那一层 → landmark 亮起，提示改成「它走不掉了」", () => {
    const state = fightingState(
      realState(),
      { enemyId: "ye-zhi" },
      { wounds: { throat: 0, leg: CONTENT.tuning.woundLegNoFleeAt, eye: 0 } },
    );
    const leg = buildEncounterChromeVm(state, CONTENT).wounds.find((wound) => wound.part === "leg");
    expect(leg?.landmark).toBe(true);
    expect(leg?.hint).toContain("走不掉");
  });

  it("眼伤到那一层 → 提示改成「它不再反口」", () => {
    const state = fightingState(
      realState(),
      { enemyId: "ye-zhi" },
      { wounds: { throat: 0, leg: 0, eye: CONTENT.tuning.woundEyeNoCounterAt } },
    );
    const eye = buildEncounterChromeVm(state, CONTENT).wounds.find((wound) => wound.part === "eye");
    expect(eye?.landmark).toBe(true);
    expect(eye?.hint).toContain("反口");
  });
});

describe("[M2-B1] 四相盘：四项各写得出此刻的数", () => {
  it("每一行都带着数字（没有一行是「提升伤害」这种没有数的形容词）", () => {
    const state = fightingState(realState(), { enemyId: "ye-zhi" });
    const vm = buildEncounterChromeVm(state, CONTENT);
    for (const line of vm.stats) {
      expect(line.effects.length, line.key).toBeGreaterThan(0);
      for (const text of line.effects) {
        expect(/[0-9〇一二三四五六七八九十]/.test(text), `${line.key}：${text}`).toBe(true);
      }
    }
  });

  it("猛写基伤、体写血上限与减伤、灵写势与识破与遁走、德写闪避与暴击与它的退意", () => {
    const base = realState();
    const state = fightingState(
      withPatch(base, { stats: { meng: 40, ti: 42, ling: 36, de: 30 } }),
      { enemyId: "ye-zhi" },
    );
    const vm = buildEncounterChromeVm(state, CONTENT);
    const line = (key: string): string => vm.stats.find((item) => item.key === key)!.effects.join("｜");
    expect(line("meng")).toContain("基伤");
    expect(line("ti")).toContain("血上限");
    expect(line("ti")).toContain("受伤 −");
    expect(line("ling")).toContain("势上限");
    expect(line("ling")).toContain("弱点");
    expect(line("ling")).toContain("遁走");
    expect(line("de")).toContain("闪避");
    expect(line("de")).toContain("暴击");
    expect(line("de")).toContain("退意");
  });

  it("属性涨了，盘上的数跟着涨（这一盘不是静态说明书）", () => {
    const base = realState();
    const weak = buildEncounterChromeVm(
      fightingState(withPatch(base, { stats: { ...base.stats, ti: 10 } }), { enemyId: "ye-zhi" }),
      CONTENT,
    );
    const strong = buildEncounterChromeVm(
      fightingState(withPatch(base, { stats: { ...base.stats, ti: 60 } }), { enemyId: "ye-zhi" }),
      CONTENT,
    );
    const hp = (vm: typeof weak): string => vm.stats.find((line) => line.key === "ti")!.effects[0]!;
    expect(hp(weak)).not.toBe(hp(strong));
  });
});

describe("[M2-B1] 破绽牌：没识破时也要说清怎么才识得破", () => {
  it("未识破 → 牌上写「尚未看出」，提示给出两条倒数（几合／几口）", () => {
    // 岩羊有弱点（后蹄的旧裂）
    const state = fightingState(realState(), { enemyId: "yan-yang" });
    const vm = buildEncounterChromeVm(state, CONTENT);
    expect(vm.weaknessFound).toBe(false);
    expect(vm.weaknessBadge).toBe("尚未看出破绽");
    expect(vm.weaknessHint).toContain("合看得出来");
    expect(vm.weaknessHint).toContain("回试出来");
  });

  it("识破 → 牌上写在哪儿，提示改说「它护也护不住」", () => {
    const state = fightingState(realState(), { enemyId: "yan-yang" }, { weaknessFound: true });
    const vm = buildEncounterChromeVm(state, CONTENT);
    expect(vm.weaknessBadge).toContain("破绽");
    expect(vm.weaknessBadge).toContain("后蹄");
    expect(vm.weaknessHint).toContain("护不住");
  });

  it("没有弱点的兽（穷奇）根本不出这枚牌 —— 它那道题的答案是「逃不逃」", () => {
    const state = fightingState(realState(), { enemyId: "qiong-qi-you" });
    const vm = buildEncounterChromeVm(state, CONTENT);
    expect(vm.weaknessBadge).toBeNull();
    expect(vm.weaknessHint).toBeNull();
  });
});

describe("[M2-B1] 行为段牌：多段的兽要看得出「它还会变」", () => {
  it("多段的兽写段名与进度", () => {
    const vm = buildEncounterChromeVm(
      fightingState(realState(), { enemyId: "xuan-mang" }, { stage: 1 }),
      CONTENT,
    );
    expect(vm.stageBadge).toBe("缠上");
    expect(vm.stageProgress).toBe("2／3 段");
  });
});
