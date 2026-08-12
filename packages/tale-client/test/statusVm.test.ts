import { describe, expect, it } from "vitest";
import { waysProgress } from "@shiling/tale-sim";
import { buildStatusVm, buildWaysVm } from "../src/model/statusVm.js";
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
describe("buildWaysVm（四道横带）", () => {
  it("四条道按固定顺序给出，各自的门槛也定序", () => {
    const ways = buildWaysVm(newState(), FIXTURE_CONTENT);
    expect(ways.ways.map((way) => way.id)).toEqual(["shen", "yaowang", "guishan", "hualing"]);
    expect(ways.ways.map((way) => way.label)).toEqual(["登神", "妖王", "归山", "化灵"]);
    expect(ways.ways.map((way) => way.gates.map((gate) => gate.label))).toEqual([
      ["灵", "德", "神"],
      ["杀", "猛"],
      ["寿", "德"],
      ["灵", "净"],
    ]);
  });

  it("门槛的 have／need／met 与引擎同源（界面不自己比大小）", () => {
    const state = withPatch(newState(), { year: 9 });
    const engine = waysProgress(state, FIXTURE_CONTENT);
    const vm = buildWaysVm(state, FIXTURE_CONTENT);
    expect(vm.ways.map((way) => way.gates.map((gate) => [gate.have, gate.need, gate.met]))).toEqual(
      engine.ways.map((way) => way.gates.map((gate) => [gate.have, gate.need, gate.met])),
    );
  });

  it("达成即点亮，且 hint 从「还差多少」换成「已足」", () => {
    const base = newState();
    const old = withPatch(base, { year: T.wayGuishanYear, livesTaken: 1 });
    const guishan = buildWaysVm(old, FIXTURE_CONTENT).ways.find((way) => way.id === "guishan");
    const [year] = guishan?.gates ?? [];
    expect(year?.met).toBe(true);
    expect(year?.percent).toBe(100);
    expect(year?.read).toBe(`${T.wayGuishanYear}／${T.wayGuishanYear}`);
    expect(year?.hint).toContain("已足");
    const young = buildWaysVm(base, FIXTURE_CONTENT).ways.find((way) => way.id === "guishan");
    expect(young?.gates[0]?.hint).toContain("寿数差");
  });

  /**
   * 「不杀一命」是唯一的 `max` 类门槛：它要么满、要么**永久破**。
   * 界面若按 have/need 画进度条会得到 `3／0`，读起来像「超额完成」—— 正相反。
   */
  it("化灵那条：夺过一命即已闭，进度条归零、caption 改口", () => {
    const clean = withPatch(newState(), { livesTaken: 0 });
    const before = buildWaysVm(clean, FIXTURE_CONTENT).ways.find((way) => way.id === "hualing");
    expect(before?.lost).toBe(false);
    expect(before?.gates[1]).toMatchObject({ met: true, percent: 100 });

    // 达成时读「未夺」而不是「0／0」（后者在屏幕上读成「零比零」）
    expect(before?.gates[1]?.read).toBe("未夺");

    const bloodied = withPatch(clean, { livesTaken: 3 });
    const after = buildWaysVm(bloodied, FIXTURE_CONTENT).ways.find((way) => way.id === "hualing");
    expect(after?.lost).toBe(true);
    expect(after?.gates[1]).toMatchObject({ met: false, percent: 0, read: "已夺 3" });
    expect(after?.gates[1]?.hint).toContain("已夺");
    expect(after?.caption).toContain("已闭");
  });

  it("某条道门槛全备 → ready，caption 改「既备」", () => {
    const base = newState();
    const ready = withPatch(base, {
      livesTaken: 1,
      year: T.wayGuishanYear,
      stats: { ...base.stats, de: T.wayGuishanDe },
    });
    const guishan = buildWaysVm(ready, FIXTURE_CONTENT).ways.find((way) => way.id === "guishan");
    expect(guishan?.metCount).toBe(2);
    expect(guishan?.ready).toBe(true);
    expect(guishan?.caption).toContain("既备");
    expect(buildWaysVm(ready, FIXTURE_CONTENT).anyReady).toBe(true);
  });

  /**
   * 缺省展开「最接近的那条」，而玩家点了 tab 就听他的 —— 切 tab 是**查看态**，
   * 不进引擎、不消耗回合（M1 的既定裁决：不得增加每回合的必点次数）。
   */
  it("缺省跟着引擎的 nearest，传了 shown 就听玩家的", () => {
    const state = withPatch(newState(), { livesTaken: 2 });
    const auto = buildWaysVm(state, FIXTURE_CONTENT);
    expect(auto.shown).toBe(waysProgress(state, FIXTURE_CONTENT).nearest);
    expect(auto.current.id).toBe(auto.shown);
    const picked = buildWaysVm(state, FIXTURE_CONTENT, "yaowang");
    expect(picked.shown).toBe("yaowang");
    expect(picked.current.id).toBe("yaowang");
    // 玩家点开的那条**已闭**也照他点的显示（他要看的正是「已夺几命」这个答案）
    const lost = buildWaysVm(state, FIXTURE_CONTENT, "hualing");
    expect(lost.shown).toBe("hualing");
    expect(lost.current.lost).toBe(true);
  });

  it("挂在 StatusVm 上（状态栏常驻，不是某个面板里的东西）", () => {
    const vm = buildStatusVm(newState(), FIXTURE_CONTENT);
    expect(vm.ways.ways).toHaveLength(4);
    expect(vm.ways.current.gates.length).toBeGreaterThan(0);
  });
});

describe("buildPremiseVm（这一世的天时与出身）", () => {
  /**
   * 状态栏那一行不能只写名字：「大旱之年」四个字与一行风味字无从区分，而这一批的
   * 全部主张是开局变量**真改机制**。所以机制那一行必须能被界面读到。
   */
  it("两条前提都带名字与机制那一行", () => {
    const vm = buildStatusVm(newState(), FIXTURE_CONTENT);
    expect(vm.premise.sky.kind).toBe("天时");
    expect(vm.premise.origin.kind).toBe("出身");
    expect(vm.premise.sky.name.length).toBeGreaterThan(0);
    expect(vm.premise.sky.effect.length).toBeGreaterThan(0);
    expect(vm.premise.caption).toContain(vm.premise.sky.name);
    expect(vm.premise.caption).toContain(vm.premise.origin.name);
    expect(vm.premise.hint).toContain(vm.premise.sky.effect);
  });
});
