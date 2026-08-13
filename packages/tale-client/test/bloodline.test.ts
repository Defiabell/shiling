import { describe, expect, it } from "vitest";
import { boonCost, type Bloodline, type ChronicleEntry, type SeedDef, type TaleContent } from "@shiling/tale-sim";
import {
  BLOODLINE_KEY,
  CHRONICLE_CAPACITY,
  buyBoon,
  consumeBoon,
  emptyBloodline,
  noteSynergies,
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
    const bloodline: Bloodline = { points: 7, unlockedSeedIds: [FIXTURE_SEED_ID], chronicle: [entry("甲传")], knownSynergyIds: [], knownOrganIds: [], boonOrganId: null, knownDestinationIds: [], foundTreasureIds: [] };
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
    const before: Bloodline = { points: 6, unlockedSeedIds: [FIXTURE_SEED_ID], chronicle: [], knownSynergyIds: [], knownOrganIds: [], boonOrganId: null, knownDestinationIds: [], foundTreasureIds: [] };
    const after = unlockSeed(before, PAID_SEED.id, CONTENT_WITH_PAID);
    expect(after?.points).toBe(1);
    expect(after?.unlockedSeedIds).toContain(PAID_SEED.id);
    expect(before.points).toBe(6);
  });

  it("点数不足 → null（调用方据此不扣点、不改状态）", () => {
    const before: Bloodline = { points: 4, unlockedSeedIds: [], chronicle: [], knownSynergyIds: [], knownOrganIds: [], boonOrganId: null, knownDestinationIds: [], foundTreasureIds: [] };
    expect(unlockSeed(before, PAID_SEED.id, CONTENT_WITH_PAID)).toBeNull();
  });

  it("未知 id、免费种、已解锁都返回 null", () => {
    const rich: Bloodline = { points: 99, unlockedSeedIds: [PAID_SEED.id], chronicle: [], knownSynergyIds: [], knownOrganIds: [], boonOrganId: null, knownDestinationIds: [], foundTreasureIds: [] };
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

/*
 * ===== S1 图鉴与血脉的持久化 =====
 *
 * 这一组守的是「跨世保留」这件事本身：图鉴记在血统里，第二世起玩家才可能**主动去凑**
 * （若记在 `TaleState` 里，每一世都要重新发现一遍，那就永远只是「意料之外」）。
 */

describe("noteSynergies", () => {
  it("记下新发现；已知的一律跳过，且返回同一个引用（调用方据此决定要不要写档）", () => {
    const base = emptyBloodline(FIXTURE_CONTENT);
    const first = noteSynergies(base, ["syn-a"]);
    expect(first.knownSynergyIds).toEqual(["syn-a"]);
    expect(first).not.toBe(base);
    const again = noteSynergies(first, ["syn-a"]);
    expect(again).toBe(first);
    expect(noteSynergies(first, ["syn-b"]).knownSynergyIds).toEqual(["syn-a", "syn-b"]);
  });
});

describe("recordLife 累进 knownOrganIds", () => {
  it("这一世拥有过的器官进图鉴，重复不叠", () => {
    let bloodline = emptyBloodline(FIXTURE_CONTENT);
    bloodline = recordLife(bloodline, 3, entry("甲传"), ["gou-chi", "wu-mu"], FIXTURE_CONTENT);
    expect(bloodline.knownOrganIds).toEqual(["gou-chi", "wu-mu"]);
    bloodline = recordLife(bloodline, 3, entry("乙传"), ["gou-chi", "ji-zu"], FIXTURE_CONTENT);
    expect(bloodline.knownOrganIds).toEqual(["gou-chi", "wu-mu", "ji-zu"]);
  });

  it("神种器官不进图鉴（它走「解锁神种」那条线，混进血脉等于绕开定价）", () => {
    const bloodline = recordLife(
      emptyBloodline(FIXTURE_CONTENT),
      1,
      entry("甲传"),
      ["organ-ling-yun", "gou-chi"],
      FIXTURE_CONTENT,
    );
    expect(bloodline.knownOrganIds).toEqual(["gou-chi"]);
  });
});

describe("buyBoon / consumeBoon", () => {
  const cost = boonCost("gou-chi", FIXTURE_CONTENT);

  function seen(points: number): Bloodline {
    return { ...emptyBloodline(FIXTURE_CONTENT), points, knownOrganIds: ["gou-chi"] };
  }

  it("点数够 → 扣点并记下 boonOrganId，不改入参", () => {
    const before = seen(cost + 2);
    const after = buyBoon(before, "gou-chi", FIXTURE_CONTENT);
    expect(after?.points).toBe(2);
    expect(after?.boonOrganId).toBe("gou-chi");
    expect(before.boonOrganId).toBeNull();
  });

  it("点数不足、没见过、内容里没有 → null（调用方据此不扣点、不改状态）", () => {
    expect(buyBoon(seen(cost - 1), "gou-chi", FIXTURE_CONTENT)).toBeNull();
    expect(buyBoon({ ...seen(99), knownOrganIds: [] }, "gou-chi", FIXTURE_CONTENT)).toBeNull();
    // 内容里不存在的 id（脏存档／改过名的旧档）
    expect(buyBoon(seen(99), "ghost-organ", FIXTURE_CONTENT)).toBeNull();
  });

  /**
   * **一世只带一件，且不许改主意** —— 规则只有这一处，界面的置灰是它的镜像。
   *
   * 早先这里允许「再买一件换掉前一件、钱不退」而界面把整排锁住：同一条规则两套语义，
   * 且花钱的那一份更松。两条断言分别钉住「换同一件」与「换另一件」都买不成。
   */
  it("这一世已经买过血脉 → 再买（同一件或另一件）都返回 null", () => {
    const bought = { ...seen(99), boonOrganId: "gou-chi", knownOrganIds: ["gou-chi", "wu-mu"] };
    expect(buyBoon(bought, "gou-chi", FIXTURE_CONTENT)).toBeNull();
    expect(buyBoon(bought, "wu-mu", FIXTURE_CONTENT)).toBeNull();
    // 用掉之后（下一世）才能再买
    expect(buyBoon(consumeBoon(bought), "wu-mu", FIXTURE_CONTENT)?.boonOrganId).toBe("wu-mu");
  });

  it("consumeBoon 只清标记、不退钱（钱在买的那一刻就付了）", () => {
    const bought = buyBoon(seen(cost), "gou-chi", FIXTURE_CONTENT)!;
    const used = consumeBoon(bought);
    expect(used.boonOrganId).toBeNull();
    expect(used.points).toBe(bought.points);
    // 没买过时是恒等操作
    const empty = emptyBloodline(FIXTURE_CONTENT);
    expect(consumeBoon(empty)).toBe(empty);
  });
});

describe("存档对账（S1 的三个新键）", () => {
  it("往返带上图鉴与血脉", () => {
    const storage = new MemoryStorage();
    const bloodline: Bloodline = {
      ...emptyBloodline(FIXTURE_CONTENT),
      points: 9,
      knownSynergyIds: [],
      knownOrganIds: ["gou-chi"],
      boonOrganId: "gou-chi",
    };
    saveBloodline(storage, bloodline);
    expect(loadBloodline(storage, FIXTURE_CONTENT)).toEqual(bloodline);
  });

  it("S1 之前的旧档（没有这三个键）退回空 —— 图鉴是发现记录，不该凭空补上", () => {
    const legacy = JSON.stringify({ points: 5, unlockedSeedIds: [FIXTURE_SEED_ID], chronicle: [] });
    const parsed = parseBloodline(legacy, FIXTURE_CONTENT);
    expect(parsed.points).toBe(5);
    expect(parsed.knownSynergyIds).toEqual([]);
    expect(parsed.knownOrganIds).toEqual([]);
    expect(parsed.boonOrganId).toBeNull();
  });

  it("悬空的 id 被丢掉：内容改过名的组合／器官不许让图鉴虚高、也不许让降世抛错", () => {
    const raw = JSON.stringify({
      points: 3,
      unlockedSeedIds: [],
      chronicle: [],
      knownSynergyIds: ["syn-gone", "syn-gone"],
      knownOrganIds: ["gou-chi", "organ-gone", "gou-chi"],
      boonOrganId: "organ-gone",
    });
    const parsed = parseBloodline(raw, FIXTURE_CONTENT);
    // fixture 的 synergies 是空表，所以任何已知组合 id 都对不上账
    expect(parsed.knownSynergyIds).toEqual([]);
    expect(parsed.knownOrganIds).toEqual(["gou-chi"]);
    // boon 指向一件对不上账的器官 → 清掉（否则 createLife 会在降世那一刻抛错）
    expect(parsed.boonOrganId).toBeNull();
  });

  it("boon 必须是已发现过的那些之一（存档被手改过也不放行）", () => {
    const raw = JSON.stringify({
      points: 3,
      unlockedSeedIds: [],
      chronicle: [],
      knownOrganIds: ["gou-chi"],
      boonOrganId: "wu-mu",
    });
    expect(parseBloodline(raw, FIXTURE_CONTENT).boonOrganId).toBeNull();
  });
});
