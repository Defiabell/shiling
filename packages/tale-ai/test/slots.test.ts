/**
 * 槽位骨架 —— 这一层的断言全是**「机制正确性由骨架保证」这句话的兑现条件**。
 *
 * 它跑在真内容（`TALE_CONTENT`）上而不是 fixture：骨架是从内容里现取材的
 * （器官 tag、敌人、插图、flag、前提的权重表），fixture 里那几样东西都没有，
 * 而这里要挡的恰恰是「内容改了一处，骨架静默失效」——那种失效不会有别的测试变红。
 */

import { describe, expect, it } from "vitest";
import { createLife, type TaleEvent } from "@shiling/tale-sim";
import { SEED_CHANG_TAI, SKIES, TALE_CONTENT } from "@shiling/tale-content";
import {
  GENERATED_ID_PREFIX,
  SLOT_COUNT,
  assembleEvent,
  auditEvent,
  buildSlots,
  combatableEnemies,
  gateableTags,
  midpointDraft,
} from "../src/index.js";

const CONTENT = TALE_CONTENT;

function born(seed: number) {
  return createLife(seed, SEED_CHANG_TAI, CONTENT);
}

function slotsOf(seed: number) {
  return buildSlots(born(seed), CONTENT).slots;
}

describe("确定性", () => {
  it("同一个种子掷出逐字相同的骨架（生成包随存档持久化的前提）", () => {
    expect(slotsOf(20260813)).toEqual(slotsOf(20260813));
  });

  it("不同种子的骨架不同（母题、门槛 tag、对手都会换）", () => {
    const a = JSON.stringify(slotsOf(20260813));
    const b = JSON.stringify(slotsOf(20260901));
    expect(a).not.toBe(b);
  });

  it("槽位数、id 前缀与唯一性", () => {
    const slots = slotsOf(20260813);
    expect(slots).toHaveLength(SLOT_COUNT);
    expect(slots.every((slot) => slot.id.startsWith(GENERATED_ID_PREFIX))).toBe(true);
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(SLOT_COUNT);
  });
});

describe("骨架不变量", () => {
  const slots = slotsOf(20260813);

  it("每条至少两个抉择，且**至少一个不带门槛** —— 否则会出一张点不动的死卡", () => {
    for (const slot of slots) {
      expect(slot.choices.length).toBeGreaterThanOrEqual(2);
      expect(slot.choices.some((choice) => choice.requires === undefined)).toBe(true);
    }
  });

  it("门槛只挂**蜕得出来的**器官 tag（神种自带的 tag 人人都有，挂了等于没挂）", () => {
    const legal = new Set(gateableTags(CONTENT));
    for (const slot of slots) {
      for (const choice of slot.choices) {
        for (const tag of choice.requires?.organTags ?? []) expect(legal.has(tag)).toBe(true);
      }
    }
  });

  it("门槛都带人话（gateHint）—— 直接把 tag 名递给模型只会换来「凭 swift 之力」", () => {
    const gated = slots.flatMap((slot) => slot.choices).filter((choice) => choice.requires !== undefined);
    expect(gated.length).toBeGreaterThan(0);
    for (const choice of gated) expect(choice.gateHint ?? "").not.toBe("");
  });

  it("开战只挑得起**非神兽**的架 —— 战胜神兽是登神门槛，生成内容不许发放", () => {
    const legal = new Set(combatableEnemies(CONTENT).map((enemy) => enemy.id));
    const divine = CONTENT.enemies.filter((enemy) => enemy.tags.includes(CONTENT.tuning.wayDivineTag));
    expect(divine.length).toBeGreaterThan(0);
    for (const slot of slots) {
      for (const choice of slot.choices) {
        for (const outcome of choice.outcomes) {
          const id = outcome.fixed.startCombat;
          if (id !== undefined) expect(legal.has(id)).toBe(true);
        }
      }
    }
  });

  it("挂的 flag 只来自引擎自己声明「歇一季能好」的那一组", () => {
    const legal = new Set(CONTENT.tuning.restHealFlags);
    for (const slot of slots) {
      for (const choice of slot.choices) {
        for (const flag of choice.outcomes.flatMap((outcome) => outcome.fixed.addFlags ?? [])) {
          expect(legal.has(flag)).toBe(true);
        }
      }
    }
  });

  it("插图取自手写事件（故文件必然存在），空串才走客户端占位", () => {
    const legal = new Set(CONTENT.events.map((event) => event.illustration).filter(Boolean));
    for (const slot of slots) {
      if (slot.illustration.length === 0) continue;
      expect(legal.has(slot.illustration)).toBe(true);
    }
  });

  it("取命只出现在**活物母题**上 —— 故事与 livesTaken 由构造保持一致", () => {
    for (const slot of slots) {
      const kills = slot.choices.some((choice) =>
        choice.outcomes.some((outcome) => (outcome.fixed.takesLife ?? 0) > 0),
      );
      if (!kills) continue;
      // 活物母题的措辞里一定有「活物／它／兽／食客」这类活的东西；这里只断言反向：
      // 不取命的母题（果实、旧迹、天象）不许出现 takesLife
      expect(slot.motif).not.toMatch(/碑|坛|骨堆|废巢|草木|火塘|天象|一块石/u);
    }
  });

  it("每条至少两种不同的取舍类型 —— 三个「多一点／少一点」不是抉择", () => {
    for (const slot of slots) {
      expect(new Set(slot.choices.map((choice) => choice.kind)).size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("前提呼应", () => {
  it("有机制的天时／出身会分到母题词表；平年（对照组）一律退回 none", () => {
    const plain = SKIES.find((sky) => sky.tuningDelta === undefined && sky.eventWeightMul === undefined);
    expect(plain).toBeDefined();
    // 掷到平年的那一世：sky 档的槽位不该背上「必须写出平年感」这种不可能的要求
    const seeds = Array.from({ length: 40 }, (_, index) => 20260813 + index * 7919);
    const plainSeed = seeds.find((seed) => born(seed).skyId === plain?.id);
    if (plainSeed !== undefined) {
      const echoed = slotsOf(plainSeed).filter((slot) => slot.echo.kind === "sky");
      expect(echoed).toHaveLength(0);
    }
    const tideSeed = seeds.find((seed) => born(seed).skyId !== plain?.id);
    expect(tideSeed).toBeDefined();
    const withEcho = slotsOf(tideSeed ?? 20260813).filter((slot) => slot.echo.kind !== "none");
    expect(withEcho.length).toBeGreaterThan(0);
    for (const slot of withEcho) expect(slot.echo.keywords.length).toBeGreaterThan(0);
  });

  it("呼应槽位的分类 tag 取自那条前提**自己声明的**权重表（写死字面量会得到一个永远乘不上的 tag）", () => {
    const slots = slotsOf(20260813);
    const state = born(20260813);
    const sky = CONTENT.skies.find((item) => item.id === state.skyId);
    const origin = CONTENT.origins.find((item) => item.id === state.originId);
    for (const slot of slots) {
      const tags = slot.trigger.tags ?? [];
      if (tags.length === 0) continue;
      const table = (slot.echo.kind === "sky" ? sky : origin)?.eventWeightMul ?? {};
      for (const tag of tags) expect((table[tag] ?? 0) > 1).toBe(true);
    }
  });
});

describe("拼成的事件本身合法（id 白名单终审）", () => {
  it("中值草稿拼出来的十六条全部通过 auditEvent", () => {
    for (const seed of [20260813, 20260901, 19700101]) {
      for (const slot of slotsOf(seed)) {
        const event: TaleEvent = assembleEvent(slot, midpointDraft(slot));
        expect(auditEvent(event, CONTENT)).toEqual([]);
      }
    }
  });

  it("预算之外的键会被 assembleEvent 丢掉（校验之后的第二道门）", () => {
    const slot = slotsOf(20260813)[0];
    expect(slot).toBeDefined();
    if (!slot) return;
    const draft = midpointDraft(slot);
    const first = draft.choices[0]?.outcomes[0];
    expect(first).toBeDefined();
    if (!first) return;
    // 塞一个这一支绝对没声明的键
    (first.effects as Record<string, number>)["lifespan"] = 9;
    const event = assembleEvent(slot, draft);
    expect(event.choices[0]?.outcomes[0]?.effects.lifespan).toBeUndefined();
  });
});
