/**
 * 热注入与生成包持久化 —— 断言的是**「同一局重放必须完全一致」这条红线**在客户端这一侧的兑现。
 *
 * 三件事各有各的失败形状，所以分三组：
 * - 注入：注错了会污染所有一世共享的那份内容对象（下一局还带着上一局的剧本）。
 * - 持久化：不存就等于「刷新一次页面换一个剧本」。
 * - 取货：缓存命中时**一个请求都不该发**（既是一致性，也是钱）。
 */

import { describe, expect, it, vi } from "vitest";
import type { TaleEvent } from "@shiling/tale-sim";
import { TALE_CONTENT } from "@shiling/tale-content";
import {
  CONTENT,
  WRITTEN_EVENT_COUNT,
  clearInjectedEvents,
  injectedEvents,
  setInjectedEvents,
} from "../src/content.js";
import {
  SCENARIO_CAPACITY,
  SCENARIO_KEY,
  loadScenarioPack,
  parseScenarioStore,
  saveScenarioPack,
} from "../src/persist/scenario.js";
import {
  SCENARIO_MODEL,
  requestScenario,
  scenarioCacheKey,
  scenarioConfig,
} from "../src/ai/scenario.js";
import type { StorageLike } from "../src/persist/bloodline.js";
import { buildEventCardVm } from "../src/model/eventVm.js";
import { inkArt } from "../src/art/placeholders.js";
import { realState } from "./helpers.js";

const VERSION = 1;

function fakeEvent(id: string): TaleEvent {
  return {
    id,
    trigger: { region: "qingqiu", weight: 30, once: true },
    title: `题${id}`,
    body: "正文",
    choices: [
      { label: "甲", outcomes: [{ weight: 1, text: "结果", effects: { hunger: 4 } }] },
      { label: "乙", outcomes: [{ weight: 1, text: "结果", effects: { stats: { de: 2 } } }] },
    ],
  };
}

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("热注入", () => {
  it("注入是**接在手写池后面**，且手写池一个字不动", () => {
    clearInjectedEvents();
    expect(CONTENT.events).toHaveLength(WRITTEN_EVENT_COUNT);
    setInjectedEvents([fakeEvent("gen-a-1"), fakeEvent("gen-a-2")]);
    expect(CONTENT.events).toHaveLength(WRITTEN_EVENT_COUNT + 2);
    expect(CONTENT.events.slice(0, WRITTEN_EVENT_COUNT)).toEqual(TALE_CONTENT.events);
    expect(injectedEvents().map((event) => event.id)).toEqual(["gen-a-1", "gen-a-2"]);
    clearInjectedEvents();
  });

  it("**替换而不是追加** —— 同一批回调重放两次不会出现两条同 id", () => {
    clearInjectedEvents();
    const pack = [fakeEvent("gen-a-1"), fakeEvent("gen-a-2")];
    setInjectedEvents(pack);
    setInjectedEvents(pack);
    expect(injectedEvents()).toHaveLength(2);
    clearInjectedEvents();
  });

  it("与手写事件撞 id 的一律不收（手写池优先）", () => {
    clearInjectedEvents();
    const written = TALE_CONTENT.events[0];
    expect(written).toBeDefined();
    setInjectedEvents([fakeEvent(written?.id ?? "x"), fakeEvent("gen-a-9")]);
    expect(injectedEvents().map((event) => event.id)).toEqual(["gen-a-9"]);
    clearInjectedEvents();
  });

  it("**不污染 TALE_CONTENT** —— 那是所有包共享的同一份常量", () => {
    clearInjectedEvents();
    const before = TALE_CONTENT.events.length;
    setInjectedEvents([fakeEvent("gen-a-1")]);
    expect(TALE_CONTENT.events).toHaveLength(before);
    clearInjectedEvents();
  });

  it("转世清空", () => {
    setInjectedEvents([fakeEvent("gen-a-1")]);
    clearInjectedEvents();
    expect(injectedEvents()).toEqual([]);
    expect(CONTENT.events).toHaveLength(WRITTEN_EVENT_COUNT);
  });
});

describe("持久化", () => {
  it("存了再读＝同一份（同一局重放一致的全部依据）", () => {
    const storage = memoryStorage();
    const pack = [fakeEvent("gen-b-1"), fakeEvent("gen-b-2")];
    expect(saveScenarioPack(storage, "k1", pack, VERSION)).toBe(true);
    expect(loadScenarioPack(storage, "k1", VERSION)).toEqual(pack);
  });

  it("版本不符即丢弃 —— 拿旧结构的事件喂新引擎是最难查的一类 bug", () => {
    const storage = memoryStorage();
    saveScenarioPack(storage, "k1", [fakeEvent("gen-b-1")], VERSION);
    expect(loadScenarioPack(storage, "k1", VERSION + 1)).toBeNull();
  });

  it("坏档、半截 JSON、形状不对的事件一律当没有缓存（不许让开局崩在读档上）", () => {
    expect(parseScenarioStore("{not json", VERSION).size).toBe(0);
    expect(parseScenarioStore('{"nope":1}', VERSION).size).toBe(0);
    const broken = JSON.stringify([
      { cacheKey: "k", version: VERSION, events: [{ id: "x" }] },
      { cacheKey: "k2", version: VERSION, events: [{ id: "y", title: "t", body: "b", trigger: { region: "qingqiu", weight: 1 }, choices: [] }] },
    ]);
    expect(parseScenarioStore(broken, VERSION).size).toBe(0);
  });

  it("只留最近几局，且**刚更新过的那一局不会被当成最旧的丢掉**", () => {
    const storage = memoryStorage();
    for (let index = 0; index < SCENARIO_CAPACITY + 2; index += 1) {
      saveScenarioPack(storage, `k${index}`, [fakeEvent(`gen-c-${index}`)], VERSION);
    }
    // 再更新最旧的那一局：它应当被挪到队尾而不是留在原地等着被丢
    saveScenarioPack(storage, "k0", [fakeEvent("gen-c-0"), fakeEvent("gen-c-0b")], VERSION);
    saveScenarioPack(storage, "kNew", [facadeEvent()], VERSION);
    const store = parseScenarioStore(storage.getItem(SCENARIO_KEY), VERSION);
    expect(store.size).toBe(SCENARIO_CAPACITY);
    expect(store.get("k0")).toHaveLength(2);
  });

  it("存不进去（配额满／隐私模式）只返回 false，不抛", () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
      removeItem: () => undefined,
    };
    expect(saveScenarioPack(hostile, "k", [fakeEvent("gen-d-1")], VERSION)).toBe(false);
    expect(loadScenarioPack(hostile, "k", VERSION)).toBeNull();
  });
});

function facadeEvent(): TaleEvent {
  return fakeEvent("gen-c-new");
}

describe("开关与缓存键", () => {
  it("生产构建里恒关（那里没有 /ai/chat 端点）", () => {
    expect(scenarioConfig("", false).enabled).toBe(false);
  });

  it("`?scenario=0` 与 `?ai=0` 都关得掉", () => {
    expect(scenarioConfig("?scenario=0", true).enabled).toBe(false);
    expect(scenarioConfig("?ai=0", true).enabled).toBe(false);
    expect(scenarioConfig("", true).enabled).toBe(true);
  });

  it("换模型要过形状检查，乱写退回缺省", () => {
    expect(scenarioConfig("?scenariomodel=litellm/gpt-latest", true).model).toBe("litellm/gpt-latest");
    expect(scenarioConfig("?scenariomodel=<script>", true).model).toBe(SCENARIO_MODEL);
  });

  it("缓存键＝种子 ＋ 神种（不掺 lifeIndex：清一次血统存档它就漂了）", () => {
    expect(scenarioCacheKey(20260813, "seed-chang-tai")).toBe("20260813:seed-chang-tai");
  });
});

describe("插图兜底", () => {
  it("生成事件复用手写事件的插图时，卡片照常出图", () => {
    const withArt: TaleEvent = { ...fakeEvent("gen-f-1"), illustration: "events/qiu-hunt-thicket.webp" };
    const vm = buildEventCardVm(realState(20260813), withArt, CONTENT);
    expect(vm.media).toEqual({ kind: "image", src: "/art/events/qiu-hunt-thicket.webp" });
  });

  it("**没有插图时走水墨占位**（`illustration` 留空的兜底路径确实通）", () => {
    const vm = buildEventCardVm(realState(20260813), fakeEvent("gen-f-2"), CONTENT);
    // 卡片这一层给 null，由 `playScreen` 的 `artFigure` 换成程序化占位图
    expect(vm.media).toBeNull();
    const placeholder = inkArt("event", "gen-f-2", { width: 1024, height: 768 });
    expect(placeholder.startsWith("data:image/svg+xml")).toBe(true);
    expect(placeholder.length).toBeGreaterThan(200);
  });
});

describe("取货", () => {
  const state = realState(20260813);
  const bornState = (): typeof state => state;

  it("缓存命中 → 同步注入，**一个请求都不发**", async () => {
    const storage = memoryStorage();
    const pack = [fakeEvent("gen-e-1")];
    saveScenarioPack(storage, "k1", pack, VERSION);
    const onEvents = vi.fn();
    const outcome = await requestScenario({
      state,
      content: CONTENT,
      config: { enabled: true, endpoint: "/nowhere", model: "m" },
      cacheKey: "k1",
      storage,
      onEvents,
    });
    expect(outcome.source).toBe("cache");
    expect(onEvents).toHaveBeenCalledWith(pack);
  });

  it("**玩家已经转世了 → 注入与落盘都停**（陈旧的那一批不许改写上一局的存档）", async () => {
    const storage = memoryStorage();
    const onEvents = vi.fn();
    let stale = false;
    /*
     * 假网关：回一批合格的事件。`isStale` 在第一批落定之前就翻成 true ——
     * 这正是「一世四五岁就饿死、而生成还要一两分钟」的那个局面。
     */
    const outcome = await requestScenario({
      state: bornState(),
      content: CONTENT,
      config: { enabled: true, endpoint: "/ai/chat", model: "m" },
      cacheKey: "k-stale",
      storage,
      isStale: () => stale,
      onEvents: (events) => {
        stale = true;
        onEvents(events);
      },
    });
    // 网关没接上（endpoint 在测试里发不出去）→ 一条都没生成，重点是不抛、不写脏数据
    expect(outcome.source).toBe("none");
    expect(storage.map.get(SCENARIO_KEY)).toBeUndefined();
  });

  it("注入回调自己炸了也不该把取货流程带走", async () => {
    const storage = memoryStorage();
    saveScenarioPack(storage, "k-boom", [fakeEvent("gen-g-1")], VERSION);
    const outcome = await requestScenario({
      state: bornState(),
      content: CONTENT,
      config: { enabled: true, endpoint: "/ai/chat", model: "m" },
      cacheKey: "k-boom",
      storage,
      onEvents: () => {
        throw new Error("注入炸了");
      },
    });
    expect(outcome.source).toBe("cache");
  });

  it("关掉时什么都不做（测试与生产构建的缺省路径）", async () => {
    const onEvents = vi.fn();
    const outcome = await requestScenario({
      state,
      content: CONTENT,
      config: { enabled: false, endpoint: "/nowhere", model: "m" },
      cacheKey: "k-none",
      storage: memoryStorage(),
      onEvents,
    });
    expect(outcome).toEqual({ source: "none", events: [], telemetry: null });
    expect(onEvents).not.toHaveBeenCalled();
  });
});
