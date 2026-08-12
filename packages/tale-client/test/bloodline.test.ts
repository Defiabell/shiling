import { describe, expect, it } from "vitest";
import type { Bloodline, ChronicleEntry, SeedDef, TaleContent } from "@shiling/tale-sim";
import {
  BLOODLINE_KEY,
  CHRONICLE_CAPACITY,
  emptyBloodline,
  loadBloodline,
  parseBloodline,
  recordLife,
  saveBloodline,
  serializeBloodline,
  unlockSeed,
  type StorageLike,
} from "../src/persist/bloodline.js";
import { GUIDE_KEY, loadGuideDismissed, saveGuideDismissed } from "../src/persist/guide.js";
import { FIXTURE_CONTENT, FIXTURE_SEED_ID } from "./helpers.js";

/** 内存 Storage —— 单测不需要 jsdom。 */
class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const PAID_SEED: SeedDef = {
  id: "seed-gou-ya",
  name: "狗牙神种",
  cost: 5,
  organ: {
    id: "organ-gou-ya",
    name: "狗牙",
    slot: "tooth",
    affinity: { meng: 0.6 },
    tags: ["fang"],
    desc: "生而带牙。",
  },
  desc: "以血统换来的凶种。",
};

const CONTENT_WITH_PAID: TaleContent = {
  ...FIXTURE_CONTENT,
  seeds: [...FIXTURE_CONTENT.seeds, PAID_SEED],
};

function entry(title: string): ChronicleEntry {
  return { title, body: "开篇。\n赞曰：了。", ending: "starve", years: 3, organCount: 1 };
}

describe("emptyBloodline", () => {
  it("免费神种（cost ≤ 0）恒为已解锁，否则新玩家一个可选项都没有", () => {
    const bloodline = emptyBloodline(CONTENT_WITH_PAID);
    expect(bloodline.points).toBe(0);
    expect(bloodline.unlockedSeedIds).toEqual([FIXTURE_SEED_ID]);
    expect(bloodline.chronicle).toEqual([]);
  });
});

describe("parseBloodline", () => {
  it("null／坏 JSON／非对象都退回默认，不抛", () => {
    for (const raw of [null, "{", "[]", "3", '"x"', "null"]) {
      expect(parseBloodline(raw, FIXTURE_CONTENT)).toEqual(emptyBloodline(FIXTURE_CONTENT));
    }
  });

  it("points 非法或为负时归零并取整", () => {
    expect(parseBloodline('{"points":-9}', FIXTURE_CONTENT).points).toBe(0);
    expect(parseBloodline('{"points":"7"}', FIXTURE_CONTENT).points).toBe(0);
    expect(parseBloodline('{"points":4.9}', FIXTURE_CONTENT).points).toBe(4);
  });

  it("丢掉内容库里已不存在的神种 id（改名后不该让「已解锁」虚高）", () => {
    const raw = JSON.stringify({ points: 9, unlockedSeedIds: ["seed-gou-ya", "seed-gone"] });
    const bloodline = parseBloodline(raw, CONTENT_WITH_PAID);
    expect(bloodline.unlockedSeedIds).toEqual([FIXTURE_SEED_ID, "seed-gou-ya"]);
  });

  it("列传里形状不对的条目被剔除，好的留下", () => {
    const raw = JSON.stringify({
      chronicle: [entry("甲传"), { title: "缺字段" }, null, 3, entry("乙传")],
    });
    const bloodline = parseBloodline(raw, FIXTURE_CONTENT);
    expect(bloodline.chronicle.map((item) => item.title)).toEqual(["甲传", "乙传"]);
  });

  it("非法 ending 的条目也剔除", () => {
    const raw = JSON.stringify({ chronicle: [{ ...entry("怪传"), ending: "exploded" }] });
    expect(parseBloodline(raw, FIXTURE_CONTENT).chronicle).toEqual([]);
  });

  it("超容量的旧档只保留最新 N 篇", () => {
    const many = Array.from({ length: CHRONICLE_CAPACITY + 5 }, (_, i) => entry(`第${i}传`));
    const parsed = parseBloodline(JSON.stringify({ chronicle: many }), FIXTURE_CONTENT);
    expect(parsed.chronicle).toHaveLength(CHRONICLE_CAPACITY);
    expect(parsed.chronicle[0]?.title).toBe("第5传");
  });
});

describe("save／load 往返", () => {
  it("写进去再读出来是同一份", () => {
    const storage = new MemoryStorage();
    const bloodline: Bloodline = { points: 7, unlockedSeedIds: [FIXTURE_SEED_ID], chronicle: [entry("甲传")] };
    expect(saveBloodline(storage, bloodline)).toBe(true);
    expect(storage.getItem(BLOODLINE_KEY)).toBe(serializeBloodline(bloodline));
    expect(loadBloodline(storage, FIXTURE_CONTENT)).toEqual(bloodline);
  });

  it("storage 为 null（隐私模式）时读默认、写返回 false —— 只降级不报错", () => {
    expect(loadBloodline(null, FIXTURE_CONTENT)).toEqual(emptyBloodline(FIXTURE_CONTENT));
    expect(saveBloodline(null, emptyBloodline(FIXTURE_CONTENT))).toBe(false);
  });

  it("写失败（配额满）返回 false 而不抛", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(saveBloodline(storage, emptyBloodline(FIXTURE_CONTENT))).toBe(false);
  });
});

describe("recordLife", () => {
  it("加点并把列传追到末尾，不改入参", () => {
    const before = emptyBloodline(FIXTURE_CONTENT);
    const after = recordLife(before, 3, entry("甲传"));
    expect(after.points).toBe(3);
    expect(after.chronicle.map((item) => item.title)).toEqual(["甲传"]);
    expect(before.chronicle).toHaveLength(0);
  });

  it("负数或小数的收益被夹成非负整数", () => {
    const base = emptyBloodline(FIXTURE_CONTENT);
    expect(recordLife(base, -5, entry("甲传")).points).toBe(0);
    expect(recordLife(base, 2.8, entry("甲传")).points).toBe(2);
  });

  it("列传超容量时丢最旧", () => {
    let bloodline = emptyBloodline(FIXTURE_CONTENT);
    for (let i = 0; i < CHRONICLE_CAPACITY + 3; i += 1) {
      bloodline = recordLife(bloodline, 1, entry(`第${i}传`));
    }
    expect(bloodline.chronicle).toHaveLength(CHRONICLE_CAPACITY);
    expect(bloodline.chronicle[0]?.title).toBe("第3传");
    expect(bloodline.points).toBe(CHRONICLE_CAPACITY + 3);
  });
});

describe("unlockSeed", () => {
  it("点数够 → 扣点并加入已解锁", () => {
    const before: Bloodline = { points: 6, unlockedSeedIds: [FIXTURE_SEED_ID], chronicle: [] };
    const after = unlockSeed(before, PAID_SEED.id, CONTENT_WITH_PAID);
    expect(after?.points).toBe(1);
    expect(after?.unlockedSeedIds).toContain(PAID_SEED.id);
    expect(before.points).toBe(6);
  });

  it("点数不足 → null（调用方据此不扣点、不改状态）", () => {
    const before: Bloodline = { points: 4, unlockedSeedIds: [], chronicle: [] };
    expect(unlockSeed(before, PAID_SEED.id, CONTENT_WITH_PAID)).toBeNull();
  });

  it("未知 id、免费种、已解锁都返回 null", () => {
    const rich: Bloodline = { points: 99, unlockedSeedIds: [PAID_SEED.id], chronicle: [] };
    expect(unlockSeed(rich, "seed-nope", CONTENT_WITH_PAID)).toBeNull();
    expect(unlockSeed(rich, FIXTURE_SEED_ID, CONTENT_WITH_PAID)).toBeNull();
    expect(unlockSeed(rich, PAID_SEED.id, CONTENT_WITH_PAID)).toBeNull();
  });
});

/*
 * 引导链的「看过了」标记（`persist/guide.ts`）——与血统同一套 StorageLike 注入，
 * 所以搭在同一份内存 Storage 上测。三条失败模式都盖：无 storage、写不进去、读时抛。
 */
describe("引导链持久化", () => {
  it("默认没看过；写入后跨会话生效", () => {
    const storage = new MemoryStorage();
    expect(loadGuideDismissed(storage)).toBe(false);
    expect(saveGuideDismissed(storage)).toBe(true);
    expect(storage.getItem(GUIDE_KEY)).toBe("1");
    expect(loadGuideDismissed(storage)).toBe(true);
  });

  it("没有 storage（隐私模式／无 window）时一律当作没看过，且写入不抛", () => {
    expect(loadGuideDismissed(null)).toBe(false);
    expect(saveGuideDismissed(null)).toBe(false);
  });

  it("写入失败只返回 false —— 本次会话内仍生效，不该炸掉一世", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(saveGuideDismissed(storage)).toBe(false);
  });

  it("读取抛异常时退回「没看过」（宁可多教一次，也不白屏）", () => {
    const throwing: StorageLike = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {},
      removeItem() {},
    };
    expect(loadGuideDismissed(throwing)).toBe(false);
  });
});
