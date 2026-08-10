import { describe, expect, it, vi } from "vitest";
import {
  OBJECTIVES,
  OBJECTIVES_COMPLETE_TEXT,
  OBJECTIVES_INITIAL_STATE,
  advanceObjective,
  dismissObjectivesForever,
  isObjectivesDismissed,
  type ObjectiveSnapshot,
} from "../src/objectives.js";

/** 全部条件恒为 false 的空快照，测试各自只叠加需要变真的字段。 */
const EMPTY: ObjectiveSnapshot = {
  kills: 0,
  essenceTotal: 0,
  anyDug: false,
  hasHomeNest: false,
  stash: 0,
  hasEvolved: false,
};

describe("OBJECTIVES — chain content matches brief verbatim", () => {
  it("has exactly 5 objectives in the given order with the given full-width-punctuation text", () => {
    expect(OBJECTIVES.map((o) => o.text)).toEqual([
      "猎食一只苓鼠",
      "挖开一个洞穴",
      "在洞中筑巢——钻入洞穴按住 E",
      "储备食物——叼运猎物回巢按 C",
      "积攒精气并饮足水——蛰伏进化（V）",
    ]);
  });

  it("OBJECTIVES_COMPLETE_TEXT is the given closing line", () => {
    expect(OBJECTIVES_COMPLETE_TEXT).toBe("青丘任你闯荡");
  });
});

describe("advanceObjective — pure state transition", () => {
  it("stays at index 0 when nothing is satisfied yet", () => {
    const next = advanceObjective(OBJECTIVES_INITIAL_STATE, EMPTY);
    expect(next).toBe(OBJECTIVES_INITIAL_STATE); // 未变化：返回同一个引用（dirty-check 契约）
    expect(next.index).toBe(0);
  });

  it("objective 1 completes via kills >= 1", () => {
    const next = advanceObjective(OBJECTIVES_INITIAL_STATE, { ...EMPTY, kills: 1 });
    expect(next.index).toBe(1);
  });

  it("objective 1 also completes via essenceTotal > 0 (a carcass was eaten, even with zero kills)", () => {
    const next = advanceObjective(OBJECTIVES_INITIAL_STATE, { ...EMPTY, essenceTotal: 0.5 });
    expect(next.index).toBe(1);
  });

  it("advances one step at a time through the whole chain as each condition flips true in isolation", () => {
    let state = OBJECTIVES_INITIAL_STATE;
    state = advanceObjective(state, { ...EMPTY, kills: 1 });
    expect(state.index).toBe(1);
    state = advanceObjective(state, { ...EMPTY, kills: 1, anyDug: true });
    expect(state.index).toBe(2);
    state = advanceObjective(state, { ...EMPTY, kills: 1, anyDug: true, hasHomeNest: true });
    expect(state.index).toBe(3);
    state = advanceObjective(state, { ...EMPTY, kills: 1, anyDug: true, hasHomeNest: true, stash: 5 });
    expect(state.index).toBe(4);
    state = advanceObjective(state, { ...EMPTY, kills: 1, anyDug: true, hasHomeNest: true, stash: 5, hasEvolved: true });
    expect(state.index).toBe(5); // === OBJECTIVES.length，链路走完
    expect(state.index).toBe(OBJECTIVES.length);
  });

  it("does not advance past the current step just because a LATER step's condition happens to already be true (still gated by earlier steps)", () => {
    // hasEvolved 为真但 kills/anyDug/hasHomeNest/stash 全假——不能跳过前面几步，仍停在 0。
    const next = advanceObjective(OBJECTIVES_INITIAL_STATE, { ...EMPTY, hasEvolved: true });
    expect(next.index).toBe(0);
  });

  it("robustness edge case (brief-noted, 'impossible with a fresh seed but stay state-based'): a snapshot where every condition is already true jumps straight to chain-complete in a single call", () => {
    const allTrue: ObjectiveSnapshot = {
      kills: 3,
      essenceTotal: 40,
      anyDug: true,
      hasHomeNest: true,
      stash: 20,
      hasEvolved: true,
    };
    const next = advanceObjective(OBJECTIVES_INITIAL_STATE, allTrue);
    expect(next.index).toBe(OBJECTIVES.length);
  });

  it("once complete, stays at length (never exceeds it) and keeps returning the same reference when re-fed an already-complete snapshot", () => {
    const complete = { index: OBJECTIVES.length };
    const allTrue: ObjectiveSnapshot = { kills: 9, essenceTotal: 99, anyDug: true, hasHomeNest: true, stash: 99, hasEvolved: true };
    const next = advanceObjective(complete, allTrue);
    expect(next).toBe(complete);
    expect(next.index).toBe(OBJECTIVES.length);
  });
});

/**
 * localStorage 持久化：本工程 vitest 未配置 jsdom（见 audio.test.ts 头部注释），Node 全局
 * `localStorage` 在这个测试环境下不可靠，必须像 audio.test.ts 的
 * "persists mute across separate createAudio() instances" 那条测试一样，手动
 * vi.stubGlobal 换一个内存 Storage 实现，才能真正验证"写进去的确实能读出来"，而不是
 * 误判成"函数调用不报错就算过"。
 */
function stubFakeStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } satisfies Storage;
  vi.stubGlobal("localStorage", fakeStorage);
  return store;
}

describe("isObjectivesDismissed / dismissObjectivesForever — persistence", () => {
  it("defaults to not-dismissed on an empty store", () => {
    stubFakeStorage();
    try {
      expect(isObjectivesDismissed()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("dismissObjectivesForever() writes the flag and isObjectivesDismissed() reads it back", () => {
    stubFakeStorage();
    try {
      expect(isObjectivesDismissed()).toBe(false);
      dismissObjectivesForever();
      expect(isObjectivesDismissed()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("persists across independent reads of the same underlying store (not just an in-memory closure variable)", () => {
    const store = stubFakeStorage();
    try {
      dismissObjectivesForever();
      expect(store.get("shiling.objectivesDismissed")).toBe("1");
      // 换一次"读取"（重新调用纯函数，而不是复用任何缓存的布尔值）——证明真的是从
      // store 里读回来的，不是巧合命中同一个闭包变量。
      expect(isObjectivesDismissed()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("privacy-mode-like failure (getItem/setItem throw): isObjectivesDismissed() falls back to false, dismissObjectivesForever() does not throw", () => {
    const throwingStorage = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
      removeItem: () => { throw new Error("SecurityError"); },
      clear: () => { throw new Error("SecurityError"); },
      key: () => { throw new Error("SecurityError"); },
      length: 0,
    } satisfies Storage;
    vi.stubGlobal("localStorage", throwingStorage);
    try {
      expect(isObjectivesDismissed()).toBe(false);
      expect(() => dismissObjectivesForever()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
