import { describe, expect, it } from "vitest";
import { buildStatusVm } from "../src/model/statusVm.js";
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
});
