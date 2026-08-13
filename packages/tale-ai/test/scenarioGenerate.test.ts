/**
 * 生成编排 —— 断言的全是**「绝不阻塞开局」与「永不抛错」这两条性质**。
 *
 * 这一层没有网络：`fetchImpl` 是注入的，所以「网关 5xx」「回了 HTML」「fetch 自己炸了」
 * 「一批超时」这些路径全都能在 `pnpm test` 里跑一遍 —— 这条管线的正确性不依赖「跑一次看看」。
 */

import { describe, expect, it, vi } from "vitest";
import { createLife, type TaleEvent } from "@shiling/tale-sim";
import { SEED_CHANG_TAI, TALE_CONTENT } from "@shiling/tale-content";
import { buildSlots, generateScenario, midpointDraft, type SlotSpec } from "../src/index.js";

const CONTENT = TALE_CONTENT;
const STATE = createLife(20260813, SEED_CHANG_TAI, CONTENT);

/**
 * 八段互不相同的正文。
 *
 * **必须逐条不同**：批内去重（最长公共片段 ≥ 十二字即打回）本来就该把「四条一模一样的
 * 稿子」挡下来 —— 第一版测试用了同一段正文，于是每批只收下一条，看着像编排坏了，
 * 其实是闸门在正常工作。
 */
const BODIES = [
  "沟底的石头一块块露出来，露出来的地方结着白痕。你把鼻子探进那点残余里，泥腥压过一切。底下有什么在动，动得很慢，像是也快撑不住了。",
  "坡背后有一处塌下去的土窝，边沿被什么反复踩过。你伏在窝口听了半刻，里头有极轻的呼吸，一起一伏，不像睡着，倒像在忍着不出声。",
  "枯枝架成的一堆东西横在路当中，缝里塞着毛和碎骨。你绕着它转了两圈，怎么看都不像是风堆起来的，堆的人似乎还知道你会来。",
  "月亮被云挡住的那一刻，草叶忽然全部朝一个方向倒过去。你站住不动，等风过去，可风一直没有来，草就那么倒着，很久都没有起身。",
  "白石从土里斜插出来，一半埋着，露出的那面被磨得发亮。你把爪子搭上去时，石面比夜里的土还凉，凉得让你想起没有睁眼的那几天。",
  "草地上压出一条宽宽的痕，两边的草茎全折向外侧。顺着它走出十几步，尽头忽然什么都没有了，像是走到那里的东西自己散掉了。",
  "远处传来一阵闷响，隔了很久才又响一次。你数着那个间隔往声音那边挪，越挪越觉得它在等你，等你把那几步走完再决定下一声。",
  "泥里陷着一样东西，形状规整得不像山里长出来的。你用鼻子把它拱出来一半，它比看上去沉得多，也比看上去凉得多，凉到牙根。",
];

/** 按骨架编一份**能过闸门**的回复（标题与正文逐槽不同，正文带上该槽的母题词）。 */
function replyFor(slots: readonly SlotSpec[]): string {
  const titles = ["涸痕", "残窝", "枯堆", "无风", "白石", "宽痕", "闷响", "泥物"];
  return JSON.stringify({
    events: slots.map((slot) => {
      const base = midpointDraft(slot);
      const keyword = slot.echo.keywords[0] ?? "";
      // 用槽位序号取标题与正文，两批之间也不会撞
      const index = Number.parseInt(slot.id.slice(slot.id.lastIndexOf("-") + 1), 10) - 1;
      return {
        id: slot.id,
        title: titles[index % titles.length] ?? "无题",
        // 母题词单独缀一句：**不能带一段公共尾巴**，否则八条正文两两都撞十二字以上，
        // 会被批内去重挡掉（第一版就是这么写的，看着像编排坏了）
        body: `${BODIES[index % BODIES.length] ?? ""}${keyword}。`,
        choices: base.choices.map((choice, choiceIdx) => ({
          label: ["探爪取之", "伏而不动", "退开让路", "缓步而前"][choiceIdx] ?? "远远绕开",
          outcomes: choice.outcomes.map((outcome, outcomeIdx) => ({
            text: outcomeIdx === 0
              ? "你把它按在泥里看了很久，然后松开了爪子，转身沿着干河床往上走。"
              : "你退开三十步，回头时那处地方已经看不出有什么不同了。",
            effects: outcome.effects,
          })),
        })),
      };
    }),
  });
}

function okResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    }),
    { status: 200, headers: { "content-type": "application/json", "x-litellm-response-cost": "0.02" } },
  );
}

/** 按批次序返回不同的回复（批之间靠 prompt 里的槽位 id 区分）。 */
function scriptedFetch(handler: (slotIds: string[], attempt: number) => Response): typeof fetch {
  const attempts = new Map<string, number>();
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
    const prompt = body.messages.map((message) => message.content).join("\n");
    const slotIds = [...prompt.matchAll(/── 槽位 (gen-[\w-]+) ──/gu)].map((match) => match[1] ?? "");
    const key = slotIds.join(",");
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    return handler(slotIds, attempt);
  }) as unknown as typeof fetch;
}

function run(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return generateScenario({
    state: STATE,
    content: CONTENT,
    cacheKey: "test:1",
    slotCount: 8,
    options: { endpoint: "/ai/chat", model: "test-model", fetchImpl, batchSize: 4, ...extra },
  });
}

describe("顺利那一条路", () => {
  it("两批并行、全数收下，事件是标准 TaleEvent", async () => {
    const slots = buildSlots(STATE, CONTENT, 8).slots;
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const result = await run(
      scriptedFetch((slotIds) => okResponse(replyFor(slotIds.map((id) => byId.get(id)!)))),
    );
    expect(result.pack.events).toHaveLength(8);
    expect(result.telemetry.source).toBe("ai");
    expect(result.telemetry.accepted).toBe(8);
    expect(result.telemetry.costUsd).toBeCloseTo(0.04);
    // 触发条件与插图**原样取自骨架**，草稿里那几个字段不作数
    for (const event of result.pack.events) {
      const slot = byId.get(event.id);
      expect(event.trigger).toEqual(slot?.trigger);
      expect(event.illustration ?? "").toBe(slot?.illustration);
    }
  });

  it("**每批落定就回调一次**（增量热注入，不等最后一批）", async () => {
    const slots = buildSlots(STATE, CONTENT, 8).slots;
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const onBatch = vi.fn();
    await run(
      scriptedFetch((slotIds) => okResponse(replyFor(slotIds.map((id) => byId.get(id)!)))),
      { onBatch },
    );
    expect(onBatch).toHaveBeenCalledTimes(2);
    expect(onBatch.mock.calls.every((call) => (call[0] as TaleEvent[]).length === 4)).toBe(true);
  });

  it("**幼年的槽位排进第一批** —— 最先落地的那一批要正好还在窗口里", async () => {
    const seen: string[][] = [];
    const slots = buildSlots(STATE, CONTENT, 8).slots;
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    await run(
      scriptedFetch((slotIds) => {
        seen.push(slotIds);
        return okResponse(replyFor(slotIds.map((id) => byId.get(id)!)));
      }),
    );
    const firstBatchMinYears = (seen[0] ?? []).map((id) => byId.get(id)?.trigger.minYear ?? 0);
    const lastBatchMinYears = (seen[1] ?? []).map((id) => byId.get(id)?.trigger.minYear ?? 0);
    expect(Math.max(...firstBatchMinYears)).toBeLessThanOrEqual(Math.min(...lastBatchMinYears));
  });
});

describe("永不抛错：六种失败路径", () => {
  it("网络层炸了 → 空包，不抛", async () => {
    const boom = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const result = await run(boom);
    expect(result.pack.events).toEqual([]);
    expect(result.telemetry.source).toBe("none");
    expect(result.telemetry.failureReason).toContain("TypeError");
  });

  it("没配 key（503）→ 空包", async () => {
    const denied = (async () => new Response(JSON.stringify({ error: "aigw-key-missing" }), { status: 503 })) as unknown as typeof fetch;
    const result = await run(denied);
    expect(result.pack.events).toEqual([]);
    expect(result.telemetry.failureReason).toContain("503");
  });

  it("网关回了 HTML（代理错误页）→ 空包", async () => {
    const html = (async () => new Response("<html>502</html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const result = await run(html);
    expect(result.pack.events).toEqual([]);
  });

  it("JSON 崩了 → 打回重生一次，第二次好了就照常收下", async () => {
    const slots = buildSlots(STATE, CONTENT, 8).slots;
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const result = await run(
      scriptedFetch((slotIds, attempt) =>
        attempt === 1 ? okResponse("我先解释一下这几条事件的设计思路……") : okResponse(replyFor(slotIds.map((id) => byId.get(id)!))),
      ),
    );
    expect(result.pack.events).toHaveLength(8);
    expect(result.telemetry.batches.every((batch) => batch.attempts === 2)).toBe(true);
    expect(result.telemetry.batches.every((batch) => batch.rejections.length === 1)).toBe(true);
  });

  it("**一批崩了只损失那一批** —— 别的批照常注入（分批的全部理由）", async () => {
    const slots = buildSlots(STATE, CONTENT, 8).slots;
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const firstBatchIds = new Set(
      [...slots].sort((a, b) => (a.trigger.minYear ?? 0) - (b.trigger.minYear ?? 0)).slice(0, 4).map((slot) => slot.id),
    );
    const result = await run(
      scriptedFetch((slotIds) =>
        firstBatchIds.has(slotIds[0] ?? "")
          ? new Response("boom", { status: 500 })
          : okResponse(replyFor(slotIds.map((id) => byId.get(id)!))),
      ),
    );
    expect(result.pack.events).toHaveLength(4);
    expect(result.telemetry.source).toBe("ai");
  });

  it("**预算耗尽就不再重试** —— 打回本该重问一次，但剩的时间不够，于是收摊", async () => {
    /*
     * 拿假时钟把「第一发回来时预算已经见底」这个局面钉死：
     * 每发回复推进 200s，而总预算 60s ＋ 重试留白 45s。若 `budgetLeft <= 0` 与
     * `now() + RETRY_HEADROOM_MS >= deadline` 两处守卫有任何一处失效，
     * 这里就会看到 `attempts === 2`（一次注定超时的重试，白花一次钱）。
     */
    let clock = 0;
    const now = (): number => clock;
    const result = await run(
      // 回一段不是 JSON 的东西：**必然打回**，于是「要不要重试」这条路一定被走到
      scriptedFetch(() => {
        clock += 200_000;
        return okResponse("我先解释一下这几条事件的设计思路……");
      }),
      { now, budgetMs: 60_000 },
    );
    /*
     * `[1, 0]` 是这份剧本下**唯一正确**的结果，两个数各钉一处守卫：
     * 第一批发了一次、被打回、算出剩余时间不够再来一发 → 不重试（`RETRY_HEADROOM_MS`）；
     * 第二批轮到它时时钟已经过了 deadline → 一发都不发（循环顶上的 `budgetLeft <= 0`）。
     * 任何一处失效都会在这里变成 2 或 1。
     */
    expect(result.telemetry.batches).toHaveLength(2);
    expect(result.telemetry.batches.map((batch) => batch.attempts)).toEqual([1, 0]);
    expect(result.telemetry.batches.map((batch) => batch.rejections.length)).toEqual([1, 0]);
    expect(result.pack.events).toEqual([]);
    expect(result.telemetry.source).toBe("none");
    expect(result.telemetry.failureReason).toContain("没能解析出 JSON");
  });

  it("已经收下的**不会因为超时被丢掉**（第二批崩了不牵连第一批）", async () => {
    let clock = 0;
    const now = (): number => clock;
    const slots = buildSlots(STATE, CONTENT, 8).slots;
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    let first = true;
    const result = await run(
      scriptedFetch((slotIds) => {
        const good = first;
        first = false;
        clock += 200_000;
        return good ? okResponse(replyFor(slotIds.map((id) => byId.get(id)!))) : new Response("boom", { status: 500 });
      }),
      { now, budgetMs: 60_000 },
    );
    expect(result.pack.events).toHaveLength(4);
    expect(result.telemetry.source).toBe("ai");
  });
});

describe("跨批去重", () => {
  it("两批撞了标题时按槽位序留先者（与网络时序无关）", async () => {
    const slots = buildSlots(STATE, CONTENT, 8).slots;
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const sameTitle = (slotIds: string[]): string =>
      JSON.stringify({
        events: slotIds.map((id) => {
          const slot = byId.get(id)!;
          const base = midpointDraft(slot);
          const index = Number.parseInt(slot.id.slice(slot.id.lastIndexOf("-") + 1), 10) - 1;
          return {
            id: slot.id,
            title: "同一个题",
            body: `${BODIES[index % BODIES.length] ?? ""}${slot.echo.keywords[0] ?? ""}。`,
            choices: base.choices.map((choice, choiceIdx) => ({
              label: ["探爪取之", "伏而不动", "退开让路", "缓步而前"][choiceIdx] ?? "远远绕开",
              outcomes: choice.outcomes.map((outcome) => ({
                text: "你把它按在泥里看了很久，然后松开了爪子，转身沿着干河床往上走。",
                effects: outcome.effects,
              })),
            })),
          };
        }),
      });
    const result = await run(scriptedFetch((slotIds) => okResponse(sameTitle(slotIds))));
    // 批内去重挡住三条，跨批去重再挡住另一批的全部 —— 最后只剩一条
    expect(result.pack.events).toHaveLength(1);
  });

  it("**两批撞正文**也要挡（实机里真出过：两条都写「夜里石缝里又透出那种青光」）", async () => {
    const slots = buildSlots(STATE, CONTENT, 8).slots;
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    // 标题各不相同、正文共用一段长句 —— 批内去重看得见，跨批看不见
    const sharedBody = (slotIds: string[]): string =>
      JSON.stringify({
        events: slotIds.map((id, index) => {
          const slot = byId.get(id)!;
          const base = midpointDraft(slot);
          const order = Number.parseInt(slot.id.slice(slot.id.lastIndexOf("-") + 1), 10);
          return {
            id: slot.id,
            title: `第${"一二三四五六七八九十"[order - 1] ?? "零"}题`,
            body:
              index === 0
                ? `${BODIES[0]}${slot.echo.keywords[0] ?? ""}。`
                : `${BODIES[(order % 6) + 1] ?? ""}${slot.echo.keywords[0] ?? ""}。`,
            choices: base.choices.map((choice, choiceIdx) => ({
              label: ["探爪取之", "伏而不动", "退开让路", "缓步而前"][choiceIdx] ?? "远远绕开",
              outcomes: choice.outcomes.map((outcome, outcomeIdx) => ({
                text:
                  outcomeIdx === 0
                    ? "你把它按在泥里看了很久，然后松开了爪子，转身沿着干河床往上走。"
                    : "你退开三十步，回头时那处地方已经看不出有什么不同了。",
                effects: outcome.effects,
              })),
            })),
          };
        }),
      });
    const result = await run(scriptedFetch((slotIds) => okResponse(sharedBody(slotIds))));
    const bodies = result.pack.events.map((event) => event.body);
    // 两批各有一条用了 BODIES[0] —— 跨批去重后只该留下一条
    expect(bodies.filter((body) => body.startsWith(BODIES[0] ?? "x"))).toHaveLength(1);
  });
});
