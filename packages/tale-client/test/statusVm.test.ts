import { describe, expect, it } from "vitest";
import { ascendProgress } from "@shiling/tale-sim";
import { buildAscendVm, buildStatusVm } from "../src/model/statusVm.js";
import { FIXTURE_CONTENT, newState, withPatch } from "./helpers.js";

const T = FIXTURE_CONTENT.tuning;

describe("buildStatusVm", () => {
  it("出生时把神种名与自带器官解出来（神种器官不在 content.organs 里）", () => {
    const vm = buildStatusVm(newState(), FIXTURE_CONTENT);
    expect(vm.seedName).toBe("灵蕴神种");
    expect(vm.organCount).toBe(1);
    expect(vm.organNames).toEqual(["灵蕴"]);
    expect(vm.when).toBe("初岁 · 春 · 青丘");
  });

  it("四属性按 猛灵体德 排序并给出环形填充百分比", () => {
    const vm = buildStatusVm(newState(), FIXTURE_CONTENT);
    expect(vm.stats.map((stat) => stat.key)).toEqual(["meng", "ling", "ti", "de"]);
    // 神种 statMods 灵 +3 落在初值 10 上
    expect(vm.stats[1]?.value).toBe(13);
    expect(vm.stats[1]?.percent).toBe(13);
  });

  it("饱食低于 25% 判 critical，挂 sys:starving 判 starving", () => {
    const base = newState();
    const healthy = buildStatusVm(base, FIXTURE_CONTENT).hunger;
    expect(healthy.critical).toBe(false);
    expect(healthy.starving).toBe(false);

    const low = buildStatusVm(withPatch(base, { hunger: 20 }), FIXTURE_CONTENT).hunger;
    expect(low.percent).toBe(20);
    expect(low.critical).toBe(true);
    expect(low.caption).toBe("腹中空空");

    const dying = buildStatusVm(
      withPatch(base, { hunger: 0, flags: ["sys:starving"] }),
      FIXTURE_CONTENT,
    ).hunger;
    expect(dying.starving).toBe(true);
    expect(dying.caption).toBe("再一季便要饿殍");
  });

  it("精气柱按阈值算填充，达阈值即 ripe 且整体 moltReady", () => {
    const base = newState();
    expect(buildStatusVm(base, FIXTURE_CONTENT).moltReady).toBe(false);

    const half = buildStatusVm(
      withPatch(base, { essence: { zu: T.moltThreshold / 2, lin: 0, xue: 0, meng: 0 } }),
      FIXTURE_CONTENT,
    );
    expect(half.essences[0]?.percent).toBe(50);
    expect(half.essences[0]?.ripe).toBe(false);
    expect(half.moltReady).toBe(false);

    const ripe = buildStatusVm(
      withPatch(base, { essence: { zu: T.moltThreshold + 9, lin: 0, xue: 0, meng: 0 } }),
      FIXTURE_CONTENT,
    );
    // 超过阈值仍显示 100%，不溢出成 115%
    expect(ripe.essences[0]?.percent).toBe(100);
    expect(ripe.essences[0]?.ripe).toBe(true);
    expect(ripe.moltReady).toBe(true);
  });

  it("神种记录缺失时不崩，退回兜底名", () => {
    const vm = buildStatusVm(withPatch(newState(), { records: [] }), FIXTURE_CONTENT);
    expect(vm.seedName).toBe("无名神种");
  });

  /**
   * 状态栏那枚立绘随器官数换阶 —— 它是玩家在界面上唯一「看得见自己」的地方，
   * 也是攒到第三枚器官时的视觉兑现。分档与登神门槛（器官 ≥5）对齐。
   */
  it("立绘按器官数分阶：幼兽 → 成兽 → 近神", () => {
    const base = newState();
    const cub = buildStatusVm(base, FIXTURE_CONTENT);
    expect(cub.portrait.stage).toBe("cub");
    expect(cub.portrait.label).toBe("幼兽");
    expect(cub.portrait.src).toContain("portraits/self-1-cub");

    const adult = buildStatusVm(
      withPatch(base, { organIds: [...base.organIds, "a", "b"] }),
      FIXTURE_CONTENT,
    );
    expect(adult.portrait.stage).toBe("adult");
    expect(adult.portrait.src).toContain("self-2-adult");

    const neargod = buildStatusVm(
      withPatch(base, { organIds: [...base.organIds, "a", "b", "c", "d"] }),
      FIXTURE_CONTENT,
    );
    expect(neargod.portrait.stage).toBe("neargod");
    expect(neargod.portrait.label).toBe("近神");
  });
});

/**
 * [M1-P2] 登神之路 —— 计划 P2 的第一条「登神条件开局可见，每项达成即点亮」。
 *
 * 这一组盯的是**门槛只有一份**：进度条的数必须与引擎 `ascendProgress` 同源，
 * 否则哪天引擎加一条门槛，进度条会照旧显示「全亮」而天命死活不入池。
 */
describe("buildAscendVm（登神之路）", () => {
  it("四项按固定顺序给出，开局一项都不亮", () => {
    const ascend = buildAscendVm(newState(), FIXTURE_CONTENT);
    expect(ascend.gates.map((gate) => gate.id)).toEqual(["year", "organs", "ling", "de"]);
    expect(ascend.gates.map((gate) => gate.label)).toEqual(["寿", "器", "灵", "德"]);
    expect(ascend.gates.every((gate) => !gate.met)).toBe(true);
    expect(ascend.metCount).toBe(0);
    expect(ascend.ready).toBe(false);
    expect(ascend.caption).toBe("登神之路　0／4");
  });

  it("门槛的 have／need 与引擎同源（界面不自己比大小）", () => {
    const state = withPatch(newState(), { year: 9 });
    const engine = ascendProgress(state, FIXTURE_CONTENT);
    const vm = buildAscendVm(state, FIXTURE_CONTENT);
    expect(vm.gates.map((gate) => [gate.have, gate.need, gate.met])).toEqual(
      engine.gates.map((gate) => [gate.have, gate.need, gate.met]),
    );
  });

  it("达成即点亮，且 hint 从「还差多少」换成「已足」", () => {
    const old = withPatch(newState(), { year: T.ascendMinYear });
    const [year] = buildAscendVm(old, FIXTURE_CONTENT).gates;
    expect(year?.met).toBe(true);
    expect(year?.percent).toBe(100);
    expect(year?.hint).toContain("已足");
    const young = buildAscendVm(newState(), FIXTURE_CONTENT).gates[0];
    expect(young?.hint).toContain("寿数差");
  });

  it("四项全满 → ready，标题换成那句话", () => {
    const base = newState();
    const ready = withPatch(base, {
      year: T.ascendMinYear,
      organIds: [...base.organIds, "a", "b", "c", "d"],
      stats: { ...base.stats, ling: T.ascendMinLing, de: T.ascendMinDe },
    });
    const ascend = buildAscendVm(ready, FIXTURE_CONTENT);
    expect(ascend.metCount).toBe(4);
    expect(ascend.ready).toBe(true);
    expect(ascend.caption).toContain("天门");
  });

  it("挂在 StatusVm 上（状态栏常驻，不是某个面板里的东西）", () => {
    expect(buildStatusVm(newState(), FIXTURE_CONTENT).ascend.gates).toHaveLength(4);
  });
});
