/**
 * 「渲染对任何可达状态都不抛错、且每一帧都有路可走」—— 走子式回归锁。
 *
 * ## 为什么要有这一条
 * 2026-08-14 owner 撞到一个死局（行动与去处整排「先了此事」，中央空白）。排查时发现这类
 * 事故有两条来路：
 *
 * 1. **渲染半路抛错** —— `renderPlay` 是 `swap(renderPlay(...))`，抛在里面时 `swap` 根本
 *    不执行：DOM 停在上一帧，而 app 的状态已经往前走了。屏幕从此每一次点击都改状态、
 *    却一次都不重画，玩家看到的是「点什么都没反应」。所以「所有 VM builder 对可达状态
 *    都不抛错」必须是一条能跑红的断言，而不是靠 code review 盯。
 * 2. **抽出一条点不开的事件** —— 引擎那边已经在 `drawEvent` 里挡掉（见
 *    `tale-sim/test/events.test.ts`），这里从**客户端**再验一遍：真内容 ＋ 真骨架生成的
 *    池子里，走完一世也不该出现「有 pendingEvent 却一条抉择都点不开」。
 *
 * ## 两个池子都要走
 * 手写池是一份；`?scenario=` 开着时事件池里还会热注入 AI 生成的十六条。生成事件的**结构**
 * （trigger／门槛／效果／权重）全部来自代码里的骨架（`buildSlots`＋`assembleEvent`），
 * 只有散文来自模型 —— 所以拿合成散文填真骨架，能在不发一次网络请求、不花一分钱的前提下
 * 覆盖「注入之后的事件池」这条真实路径。
 */

import { describe, expect, it } from "vitest";
import { TALE_CONTENT } from "@shiling/tale-content";
import {
  approachOf,
  availableActions,
  clashOf,
  combatAct,
  createLife,
  eligibleChoiceIdxs,
  performAction,
  recommendForge,
  resolveChoice,
  stalkAct,
  type TaleContent,
  type TaleEvent,
  type TaleState,
  type WayId,
} from "@shiling/tale-sim";
import { assembleEvent, buildSlots } from "@shiling/tale-ai";
import { buildStatusVm } from "../src/model/statusVm.js";
import { buildActionVms } from "../src/model/actionVm.js";
import { buildDestinationVms, destinationCaption } from "../src/model/destinationVm.js";
import { buildEventCardVm } from "../src/model/eventVm.js";
import { buildEncounterChromeVm } from "../src/model/encounterVm.js";
import { buildStalkVm } from "../src/model/stalkVm.js";
import { buildCombatVm } from "../src/model/combatVm.js";
import { buildForgeVm } from "../src/model/forgeVm.js";
import { buildDetailVm, type DetailSel } from "../src/model/detailVm.js";
import { buildGuideVm } from "../src/model/guideVm.js";
import { checkPlayable } from "../src/model/playable.js";
import type { CenterVm } from "../src/screens/playScreen.js";

const WAYS: WayId[] = ["shen", "yaowang", "guishan", "hualing"];

function everyDetailSel(state: TaleState): DetailSel[] {
  return [
    { kind: "hunger" },
    ...(["meng", "ling", "ti", "de"] as const).map((key): DetailSel => ({ kind: "stat", key })),
    ...(["zu", "lin", "xue", "meng"] as const).map((type): DetailSel => ({ kind: "essence", type })),
    ...WAYS.map((way): DetailSel => ({ kind: "way", way })),
    ...state.organIds.map((id): DetailSel => ({ kind: "organ", id })),
  ];
}

/**
 * 一帧渲染会碰到的**全部**视图模型 —— 顺带把护栏也跑一遍。
 *
 * 详情浮层与四道 tab 每一格都建一次：它们各自都是一次渲染时的现算（`buildDetailVm` 里
 * `wayDetail` 认不出 id 时是抛错的），漏掉哪一格，那一格就是没被这条锁守住。
 */
function renderFrame(state: TaleState, content: TaleContent, pending: TaleEvent | null, wayTab: WayId | null): string | null {
  const actionsRaw = buildActionVms(state, content);
  const destsRaw = buildDestinationVms(state, content);
  buildStatusVm(state, content, wayTab);
  destinationCaption(destsRaw);
  recommendForge(state, content);
  buildForgeVm(state, content, null, [], null);
  buildGuideVm(state, content, 0);
  for (const sel of everyDetailSel(state)) buildDetailVm(state, content, sel);

  const approach = approachOf(state);
  const clash = clashOf(state);
  let center: CenterVm;
  if (pending) {
    center = {
      kind: "event",
      key: "e",
      event: pending,
      card: buildEventCardVm(state, pending, content),
    };
  } else if (state.encounter && (approach || clash)) {
    const chrome = buildEncounterChromeVm(state, content);
    center = approach
      ? { kind: "encounter", key: "a", chrome, body: { kind: "approach", stalk: buildStalkVm(state, approach, content) } }
      : { kind: "encounter", key: "c", chrome, body: { kind: "clash", combat: buildCombatVm(state, clash!, content), playback: null } };
  } else {
    center = { kind: "narration", key: "n", title: null, lines: ["……"], media: null, continueLabel: null };
  }

  // app 的折算：事件卡在场时行动与去处整排锁死（`renderPlayScreen` 里那一段的等价物）
  const blocked = center.kind === "event";
  const actions = actionsRaw.map((a) => ({ ...a, enabled: a.enabled && !blocked, highlight: a.highlight && !blocked }));
  const destinations = destsRaw.map((d) => ({ ...d, enabled: d.enabled && !blocked }));
  return checkPlayable({ state, center, busy: false, actions, destinations });
}

/** 造一份「AI 剧本」：骨架／门槛／效果／触发都是真的，只有散文是合成的。 */
function syntheticScenario(born: TaleState, content: TaleContent): TaleEvent[] {
  return buildSlots(born, content, 16).slots.map((slot) =>
    assembleEvent(slot, {
      title: `合成${slot.id.slice(-2)}`,
      body: "夜里山中透出一线青光，风从石缝里过，带着一股潮气与旧血的气味，久久不散。",
      choices: slot.choices.map((choice, i) => ({
        label: `其${i + 1}`,
        outcomes: choice.outcomes.map(() => ({ text: "此事到此为止，你转身走开。", effects: {} })),
      })),
    }),
  );
}

interface SweepResult {
  frames: number;
  injectedDrawn: number;
  failures: string[];
}

function sweep(lives: number, inject: boolean): SweepResult {
  const failures: string[] = [];
  let frames = 0;
  let injectedDrawn = 0;
  for (let n = 1; n <= lives; n += 1) {
    for (const seedId of TALE_CONTENT.seeds.map((seed) => seed.id)) {
      const born = createLife(n * 7919, seedId, TALE_CONTENT);
      const injected = inject ? syntheticScenario(born, TALE_CONTENT) : [];
      const injectedIds = new Set(injected.map((event) => event.id));
      const content: TaleContent =
        injected.length === 0
          ? TALE_CONTENT
          : { ...TALE_CONTENT, events: [...TALE_CONTENT.events, ...injected] };
      let state = born;
      let pending: TaleEvent | null = null;
      let rng = n + (inject ? 7 : 0);
      const pick = <T,>(items: readonly T[]): T | undefined => {
        rng = (rng * 1103515245 + 12345) >>> 0;
        return items.length === 0 ? undefined : items[rng % items.length];
      };
      const where = (turn: number): string => `${seedId} seed=${n} turn=${turn}`;
      for (let turn = 0; turn < 90 && state.alive; turn += 1) {
        frames += 1;
        if (pending && injectedIds.has(pending.id)) injectedDrawn += 1;
        try {
          const violation = renderFrame(state, content, pending, pick([null, ...WAYS]) ?? null);
          if (violation !== null) failures.push(`${where(turn)} 护栏：${violation}`);
        } catch (error) {
          failures.push(`${where(turn)} 渲染抛错：${String(error)}（pending=${pending?.id ?? "-"}）`);
          break;
        }
        try {
          if (pending) {
            const idxs = eligibleChoiceIdxs(state, pending, content);
            state = resolveChoice(state, pending, pick(idxs) ?? idxs[0]!, content).state;
            pending = null;
            continue;
          }
          if (approachOf(state)) {
            state = stalkAct(state, pick(["creep", "circle", "wait", "pounce"] as const) ?? "creep", content).state;
            continue;
          }
          if (clashOf(state)) {
            state = combatAct(
              state,
              { kind: "bite", part: pick(["throat", "leg", "eye"] as const) ?? "throat" },
              content,
            ).state;
            continue;
          }
          const act = pick(availableActions(state, content));
          if (!act) break;
          const destinationId = pick(
            buildDestinationVms(state, content).filter((d) => d.enabled).map((d) => d.id),
          );
          if (act === "explore" && destinationId === undefined) break;
          const turnResult = performAction(
            state,
            act,
            content,
            act === "explore" ? { destinationId } : undefined,
          );
          state = turnResult.state;
          pending = turnResult.pendingEvent;
        } catch (error) {
          failures.push(`${where(turn)} 引擎抛错：${String(error)}`);
          break;
        }
      }
    }
  }
  return { frames, injectedDrawn, failures };
}

describe("走子回归：渲染不抛错、每一帧都有路可走", () => {
  it("手写事件池（真内容，三枚神种 × 60 世）", () => {
    const result = sweep(60, false);
    expect(result.frames).toBeGreaterThan(3000);
    expect(result.failures).toEqual([]);
  });

  it("热注入 AI 剧本之后照样成立（真骨架 ＋ 合成散文）", () => {
    const result = sweep(60, true);
    // 这一条的前提是「真撞上了生成事件」—— 撞不上就等于什么都没验
    expect(result.injectedDrawn).toBeGreaterThan(30);
    expect(result.failures).toEqual([]);
  });
});
