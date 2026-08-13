/**
 * [S2] 去处按钮的视图模型专测。
 *
 * 这一屏的铁律与追猎屏、技能池同一条：**没有预览的按钮＝翻牌**。所以这里逐条钉住
 * 「四项事实恒在」「未开启也照写后果、原因另起一行」「缺什么写成器官名」三件事 ——
 * 它们各自都是「一句话省掉就退回翻牌」的那种改动。
 */

import { describe, expect, it } from "vitest";
import { DESTINATIONS, TALE_CONTENT } from "@shiling/tale-content";
import { buildDestinationVms, destinationCaption, PERIL_LABELS } from "../src/model/destinationVm.js";
import { realState, withPatch } from "./helpers.js";

const CONTENT = TALE_CONTENT;

/** 身上多几件器官（只借 id —— 这一组测的是门槛与文案，不是数值）。 */
function withOrgans(organIds: string[]) {
  const base = realState();
  return withPatch(base, { organIds: [...base.organIds, ...organIds] });
}

const FREE = DESTINATIONS[0]!;
const GATED = DESTINATIONS.find((destination) => destination.requiresOrganIds.length === 2)!;
const SINGLE = DESTINATIONS.find((destination) => destination.requiresOrganIds.length === 1)!;

describe("buildDestinationVms", () => {
  it("全部去处恒在（未开启的照样渲染 —— 那是欲望展示位），顺序恒按内容表", () => {
    const vms = buildDestinationVms(realState(), CONTENT);
    expect(vms.map((vm) => vm.id)).toEqual(DESTINATIONS.map((destination) => destination.id));
    // 起手只有无门槛那一处能去
    expect(vms.filter((vm) => vm.enabled).map((vm) => vm.id)).toEqual([FREE.id]);
  });

  /**
   * 四项事实恒在，**开启与否都写**。
   *
   * S1 那条教训的同一形状：原因顶掉后果的按钮，玩家既不知道那儿是什么，
   * 也就没法决定「要不要为它去凑一件浮鳔」。
   */
  it("每颗按钮四项恒在：地貌 · 遇事 · 风险 · 路费（置灰的也写）", () => {
    for (const vm of buildDestinationVms(realState(), CONTENT)) {
      expect(vm.desc.length, vm.id).toBeGreaterThan(0);
      expect(vm.chanceLine, vm.id).toMatch(/^遇事 /);
      expect(vm.perilLine, vm.id).toContain(PERIL_LABELS[vm.peril]);
      expect(vm.costLine, vm.id).toContain("耗饱食");
    }
  });

  it("置灰时原因另起一行，且**缺什么写成器官名**（不是 id、不是「缺 2 件」）", () => {
    const vms = buildDestinationVms(realState(), CONTENT);
    const locked = vms.find((vm) => vm.id === GATED.id)!;
    expect(locked.enabled).toBe(false);
    const names = GATED.requiresOrganIds.map(
      (id) => CONTENT.organs.find((organ) => organ.id === id)?.name ?? id,
    );
    for (const name of names) expect(locked.disabledReason).toContain(name);
    // id 不许漏进屏幕
    for (const id of GATED.requiresOrganIds) expect(locked.disabledReason).not.toContain(id);
    // 后果照写
    expect(locked.chanceLine.length).toBeGreaterThan(0);
    expect(locked.costLine.length).toBeGreaterThan(0);
  });

  it("凑齐一半时，写明门槛全列 ＋ 还差哪一件", () => {
    const half = GATED.requiresOrganIds[0]!;
    const rest = GATED.requiresOrganIds[1]!;
    const vm = buildDestinationVms(withOrgans([half]), CONTENT).find((item) => item.id === GATED.id)!;
    const nameOf = (id: string): string =>
      CONTENT.organs.find((organ) => organ.id === id)?.name ?? id;
    expect(vm.enabled).toBe(false);
    expect(vm.disabledReason).toContain(`缺 ${nameOf(rest)}`);
    // 已有的那一件仍列在「需」里 —— 玩家才看得出自己走到哪儿了
    expect(vm.disabledReason).toContain(nameOf(half));
  });

  it("门槛齐了就点得开，且不再有原因那一行", () => {
    const vm = buildDestinationVms(withOrgans([...GATED.requiresOrganIds]), CONTENT).find(
      (item) => item.id === GATED.id,
    )!;
    expect(vm.enabled).toBe(true);
    expect(vm.disabledReason).toBeNull();
  });

  it("此地有什么兽写在按钮上；无兽的那一处写「此地无袭」", () => {
    const vms = buildDestinationVms(withOrgans([...GATED.requiresOrganIds]), CONTENT);
    const gated = vms.find((vm) => vm.id === GATED.id)!;
    expect(gated.denizenLine).not.toBeNull();
    for (const denizen of GATED.denizens) {
      const name = CONTENT.enemies.find((enemy) => enemy.id === denizen.enemyId)?.name ?? "";
      expect(gated.denizenLine).toContain(name);
    }
  });

  /**
   * 遇袭是**条件概率**（先要这一季没撞上事件），所以措辞恒为「无事则……」。
   * 写成「三成遇袭」就是界面替引擎许了一个它不保证的诺。
   */
  it("遇袭那一句写明它是条件概率", () => {
    const vm = buildDestinationVms(withOrgans([...GATED.requiresOrganIds]), CONTENT).find(
      (item) => item.id === GATED.id,
    )!;
    expect(vm.perilLine).toContain("无事则");
  });

  it("路费 >0 的去处把路费单列出来（不然玩家看不出这一处贵在哪）", () => {
    const vms = buildDestinationVms(withOrgans([...GATED.requiresOrganIds]), CONTENT);
    const gated = vms.find((vm) => vm.id === GATED.id)!;
    const free = vms.find((vm) => vm.id === FREE.id)!;
    expect(gated.costLine).toContain("含路费");
    expect(free.costLine).not.toContain("含路费");
  });

  it("三档风险各有自己的读法（常路／险地／绝境）", () => {
    const tiers = new Set(DESTINATIONS.map((destination) => destination.peril));
    expect(tiers.size).toBe(3);
    for (const tier of tiers) expect(PERIL_LABELS[tier].length).toBeGreaterThan(0);
  });

  it("单件门槛那一处只列一件器官（避免把「需 X」写成「需 X、X」）", () => {
    const vm = buildDestinationVms(realState(), CONTENT).find((item) => item.id === SINGLE.id)!;
    const name = CONTENT.organs.find((organ) => organ.id === SINGLE.requiresOrganIds[0])?.name ?? "";
    expect(vm.disabledReason).toContain(`需 ${name}`);
    expect(vm.disabledReason).not.toContain("、");
  });
});

describe("destinationCaption", () => {
  it("报「可去几处／共几处」与「这一世已至几处」", () => {
    const caption = destinationCaption(buildDestinationVms(realState(), CONTENT));
    expect(caption).toContain("往　哪　走");
    expect(caption).toContain("可去 一／六 处");
    expect(caption).toContain("已至 〇 处");
  });
});
