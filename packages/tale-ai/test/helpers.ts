/**
 * tale-ai 单测的共用零件：一个「已经过完」的一世 ＋ 一个可编排的假 fetch。
 *
 * 用 tale-sim 的 fixture 内容而不是真内容：单测要断言的是**管线行为**（选摘录、校验、
 * 重试、回落），fixture 小而极端，断言写得死、跑得快。真内容的意外（专名撞车之类）
 * 由 `real-content.test.ts` 单独盯。
 */

import { createLife, type EndingType, type LifeRecord, type TaleState, type WayId } from "@shiling/tale-sim";
import {
  ENEMY_YE_ZHI,
  FIXTURE_SEED_ID,
  ORGAN_GOU_CHI,
  contentWithoutEvents,
} from "@shiling/tale-sim/test/fixtures";

export const CONTENT = contentWithoutEvents();

export const MOLT_RECORD: LifeRecord = {
  year: 2,
  season: 1,
  kind: "molt",
  text: "蛰伏一季，蜕生狩齿。",
  refId: ORGAN_GOU_CHI,
};

export const KILL_RECORD: LifeRecord = {
  year: 3,
  season: 2,
  kind: "combat",
  text: "搏杀野雉，食其精气。",
  refId: ENEMY_YE_ZHI,
};

export const DEATH_RECORD: LifeRecord = {
  year: 7,
  season: 3,
  kind: "death",
  text: "力尽，横死于野雉之口。",
  refId: ENEMY_YE_ZHI,
};

export function finishedLife(options: {
  ending: EndingType;
  year?: number;
  way?: WayId;
  extraRecords?: LifeRecord[];
  organIds?: string[];
  livesTaken?: number;
} = { ending: "oldage" }): TaleState {
  const base = createLife(1, FIXTURE_SEED_ID, CONTENT);
  return {
    ...base,
    year: options.year ?? 7,
    organIds: options.organIds ?? [...base.organIds, ORGAN_GOU_CHI],
    livesTaken: options.livesTaken ?? 1,
    alive: false,
    ending: options.ending,
    wayAchieved: options.ending === "ascend" ? (options.way ?? "guishan") : null,
    records: [...base.records, ...(options.extraRecords ?? [MOLT_RECORD, KILL_RECORD])],
  };
}

/** 一份能通过全部校验的草稿（各测试按需改坏其中一处）。 */
export function goodDraft(prefixes: string[]): {
  opening: string;
  middle: { prefix: string; text: string }[];
  closing: string;
  praise: string;
} {
  return {
    opening:
      "食灵者，无名，凭灵蕴神种降于青丘，值常年，常胎，托身幼兽。凡历七岁，成器官二，蜕一，杀一。其为兽也，猛薄而灵稍长，德无可称。",
    middle: prefixes.map((prefix) => ({ prefix, text: "是岁山中无雪，兽各自守，食灵伏于石隙，终日不出。" })),
    closing: "终未成器，寿数既尽，殁于青丘之野，与草木同朽。四门在上，其不得望焉。",
    praise: "其生也微，其死也速。青丘不记其名，而石隙间的旧痕犹在，风一吹便没了。",
  };
}

export interface FakeCall {
  body: unknown;
  headers: Record<string, string>;
}

/**
 * 假 fetch：按剧本逐次返回。
 *
 * 剧本项可以是「一段模型回复文本」「一个 Error（网络层炸）」或「一个 {status} 对象」。
 * 记录每次请求体，供断言「重试时把上一稿与问题递回去了」。
 */
export function fakeFetch(
  script: (string | Error | { status: number; body?: string })[],
  options: { costHeader?: string | null; delayMs?: number } = {},
): { impl: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let index = 0;
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    calls.push({
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (options.delayMs !== undefined) {
      // 必须认 AbortSignal —— 「超预算就收摊」这条承诺全靠它，假 fetch 不认就测了个寂寞
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, options.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      });
    }
    if (step instanceof Error) throw step;
    if (typeof step === "object") {
      return new Response(step.body ?? "{}", { status: step.status });
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    const cost = options.costHeader === undefined ? "0.0031" : options.costHeader;
    if (cost !== null) headers["x-litellm-response-cost"] = cost;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: step }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1200, completion_tokens: 400 },
      }),
      { status: 200, headers },
    );
  }) as unknown as typeof fetch;
  return { impl, calls };
}
