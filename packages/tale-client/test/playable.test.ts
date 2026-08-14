/**
 * 渲染护栏（`model/playable.ts`）—— 每一种「界面认为有待办、却没有出路」的形状各一条。
 *
 * 这一组是 2026-08-14 那次死局的**回归锁**：owner 撞到的屏幕是「四颗行动与六处去处全灰、
 * 副文案全是『先了此事』，中央却不是事件卡」。那种帧现在必须被 `checkPlayable` 判成违规
 * ——「护栏生效」因此是一条能跑红的断言，不是一句注释约定。
 */

import { describe, expect, it } from "vitest";
import { TALE_CONTENT } from "@shiling/tale-content";
import { buildEventCardVm } from "../src/model/eventVm.js";
import { buildActionVms } from "../src/model/actionVm.js";
import { buildDestinationVms } from "../src/model/destinationVm.js";
import { BOOT_CENTER_KEY, checkPlayable, ESCAPE_CONTINUE_LABEL } from "../src/model/playable.js";
import type { CenterVm } from "../src/screens/playScreen.js";
import type { TaleEvent } from "@shiling/tale-sim";
import { encounterOf, combatState, realState } from "./helpers.js";

const C = TALE_CONTENT;

function blockedBars(state = realState()) {
  return {
    actions: buildActionVms(state, C).map((a) => ({
      ...a,
      enabled: false,
      highlight: false,
      disabledReason: "先了此事",
    })),
    destinations: buildDestinationVms(state, C).map((d) => ({
      ...d,
      enabled: false,
      disabledReason: "先了此事",
    })),
  };
}

function openBars(state = realState()) {
  return { actions: buildActionVms(state, C), destinations: buildDestinationVms(state, C) };
}

/** 一条门槛高到谁都点不开的事件（内容 bug 的形状；引擎那边已不许抽出来，这里只造帧）。 */
const UNOPENABLE: TaleEvent = {
  id: "test-unopenable",
  trigger: { region: "any", weight: 1 },
  title: "无路",
  body: "无路可择。",
  choices: [
    {
      label: "非人所能",
      requires: { stats: { ling: 9999 } },
      outcomes: [{ weight: 1, text: "不可能发生。", effects: {} }],
    },
  ],
};

const NARRATION: CenterVm = {
  kind: "narration",
  key: "n",
  title: null,
  lines: ["伏草间半日。"],
  media: null,
  continueLabel: null,
};

describe("checkPlayable", () => {
  it("放行：普通旁白卡 ＋ 行动面板可用", () => {
    const state = realState();
    expect(checkPlayable({ state, center: NARRATION, busy: false, ...openBars(state) })).toBeNull();
  });

  it("放行：事件卡在场且至少一条抉择点得开（行动整排锁死是对的）", () => {
    const state = realState();
    const event = C.events.find((e) => e.choices.some((c) => !c.requires))!;
    const center: CenterVm = {
      kind: "event",
      key: "e",
      event,
      card: buildEventCardVm(state, event, C),
    };
    expect(checkPlayable({ state, center, busy: false, ...blockedBars(state) })).toBeNull();
  });

  it("抓住：中央还是开机那张空白卡（owner 截图里中央那块空白）", () => {
    const state = realState();
    const boot: CenterVm = {
      kind: "narration",
      key: BOOT_CENTER_KEY,
      title: null,
      lines: [],
      media: null,
      continueLabel: null,
    };
    // 注意：此刻行动面板照旧可点，所以这一条**不能**靠「数不出出路」那条兜底判据抓到
    const reason = checkPlayable({ state, center: boot, busy: false, ...openBars(state) });
    expect(reason).toContain("开机那张空白卡");
  });

  it("抓住：事件卡在场、一条抉择都点不开 —— owner 那一屏的形状", () => {
    const state = realState();
    const center: CenterVm = {
      kind: "event",
      key: "e",
      event: UNOPENABLE,
      card: buildEventCardVm(state, UNOPENABLE, C),
    };
    const reason = checkPlayable({ state, center, busy: false, ...blockedBars(state) });
    expect(reason).toContain("test-unopenable");
    expect(reason).toContain("无路可走");
  });

  it("抓住：行动与去处整排锁死、中央不是事件卡（`pendingEvent` 与 `center` 脱钩的表现）", () => {
    const state = realState();
    const reason = checkPlayable({ state, center: NARRATION, busy: false, ...blockedBars(state) });
    expect(reason).toContain("一条出路都没有");
  });

  it("抓住：遭遇未收束，中央却是旁白且没有「迎敌」入口", () => {
    const base = realState();
    const state = { ...base, encounter: encounterOf(combatState()) };
    const reason = checkPlayable({ state, center: NARRATION, busy: false, ...openBars(base) });
    expect(reason).toContain("遭遇未收束");
  });

  it("放行：遭遇未收束但中央给了「迎敌」", () => {
    const base = realState();
    const state = { ...base, encounter: encounterOf(combatState()) };
    const center: CenterVm = { ...NARRATION, continueLabel: "迎　敌" };
    expect(checkPlayable({ state, center, busy: false, ...openBars(base) })).toBeNull();
  });

  it("放行：遭遇未收束且中央就是遭遇屏", () => {
    const base = realState();
    const state = { ...base, encounter: encounterOf(combatState()) };
    const center = { kind: "encounter" } as unknown as CenterVm;
    expect(checkPlayable({ state, center, busy: false, ...openBars(base) })).toBeNull();
  });

  it("放行：演出播放中（`busy`）全灰不算死局", () => {
    const state = realState();
    expect(checkPlayable({ state, center: NARRATION, busy: true, ...blockedBars(state) })).toBeNull();
  });

  it("放行：已死（出口由死亡演出接手）", () => {
    const state = { ...realState(), alive: false, ending: "starve" as const };
    expect(checkPlayable({ state, center: NARRATION, busy: false, ...blockedBars() })).toBeNull();
  });

  it("自愈那张兜底卡自己必须过检 —— 否则护栏会无限自愈", () => {
    const state = realState();
    const escape: CenterVm = {
      kind: "narration",
      key: "escape",
      title: "此　处　有　异",
      lines: ["已就地脱困。"],
      media: null,
      continueLabel: ESCAPE_CONTINUE_LABEL,
    };
    // 最坏情况：行动与去处仍然整排锁死，只靠「脱困」这一颗出路
    expect(checkPlayable({ state, center: escape, busy: false, ...blockedBars(state) })).toBeNull();
  });
});
