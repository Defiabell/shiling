import { describe, expect, it } from "vitest";
import type { Bloodline, ChronicleEntry, SeedDef, TaleContent } from "@shiling/tale-sim";
import { buildSeedScreenVm } from "../src/model/seedVm.js";
import { FIXTURE_CONTENT, FIXTURE_SEED_ID } from "./helpers.js";

/** 一枚要花血统点的神种（fixture 只有免费种，三态解锁得自己造） */
const PAID_SEED: SeedDef = {
  id: "seed-gou-ya",
  name: "狗牙神种",
  cost: 5,
  organ: {
    id: "organ-gou-ya",
    name: "狗牙",
    slot: "tooth",
    affinity: { meng: 0.6 },
    statMods: { meng: 4, de: -2 },
    tags: ["fang", "hunter"],
    combatSkill: { name: "锁喉", desc: "咬住不放。" },
    desc: "生而带牙。",
  },
  desc: "以血统换来的凶种。",
};

const CONTENT: TaleContent = {
  ...FIXTURE_CONTENT,
  seeds: [...FIXTURE_CONTENT.seeds, PAID_SEED],
};

function bloodline(patch: Partial<Bloodline> = {}): Bloodline {
  return { points: 0, unlockedSeedIds: [FIXTURE_SEED_ID], chronicle: [], ...patch };
}

function entry(title: string, ending: ChronicleEntry["ending"] = "starve"): ChronicleEntry {
  return { title, body: "开篇。\n赞曰：了。", ending, years: 6, organCount: 2 };
}

describe("buildSeedScreenVm", () => {
  it("免费种恒为 unlocked（哪怕存档里没记它）", () => {
    const vm = buildSeedScreenVm({ points: 0, unlockedSeedIds: [], chronicle: [] }, FIXTURE_CONTENT);
    expect(vm.cards[0]?.lock).toBe("unlocked");
    expect(vm.cards[0]?.shortfall).toBe(0);
  });

  it("点数不足 → locked，并给出还差多少", () => {
    const card = buildSeedScreenVm(bloodline({ points: 2 }), CONTENT).cards[1];
    expect(card?.lock).toBe("locked");
    expect(card?.shortfall).toBe(3);
  });

  it("点数刚好等于花费 → affordable（边界不许算成 locked）", () => {
    const card = buildSeedScreenVm(bloodline({ points: 5 }), CONTENT).cards[1];
    expect(card?.lock).toBe("affordable");
    expect(card?.shortfall).toBe(0);
  });

  it("已解锁的种即使点数为 0 也是 unlocked，且不再显示差额", () => {
    const card = buildSeedScreenVm(
      bloodline({ points: 0, unlockedSeedIds: [FIXTURE_SEED_ID, PAID_SEED.id] }),
      CONTENT,
    ).cards[1];
    expect(card?.lock).toBe("unlocked");
    expect(card?.shortfall).toBe(0);
  });

  it("点数远超花费也只是 affordable，不会溢出成负的差额", () => {
    const card = buildSeedScreenVm(bloodline({ points: 99 }), CONTENT).cards[1];
    expect(card?.lock).toBe("affordable");
    expect(card?.shortfall).toBe(0);
  });

  it("带出自带器官的名号、战技与中文加成（负值用全角减号）", () => {
    const card = buildSeedScreenVm(bloodline(), CONTENT).cards[1];
    expect(card?.organName).toBe("狗牙");
    expect(card?.combatSkillName).toBe("锁喉");
    expect(card?.statMods).toEqual(["猛 +4", "德 −2"]);
    expect(card?.organTags).toEqual(["fang", "hunter"]);
  });

  it("无 statMods／无战技的神种给空数组与 null，而不是编造", () => {
    const plain: SeedDef = {
      ...PAID_SEED,
      id: "seed-plain",
      organ: { ...PAID_SEED.organ, id: "organ-plain", statMods: undefined, combatSkill: undefined },
    };
    const card = buildSeedScreenVm(bloodline(), { ...CONTENT, seeds: [plain] }).cards[0];
    expect(card?.statMods).toEqual([]);
    expect(card?.combatSkillName).toBeNull();
  });

  it("前传目录最新在前，并报出已历世数", () => {
    const vm = buildSeedScreenVm(
      bloodline({ chronicle: [entry("甲传"), entry("乙传"), entry("丙传", "ascend")] }),
      CONTENT,
    );
    expect(vm.lives).toBe(3);
    expect(vm.chronicle.map((item) => item.title)).toEqual(["丙传", "乙传", "甲传"]);
    expect(vm.chronicle[0]?.ending).toBe("ascend");
  });

  it("不改入参的 chronicle 数组（reverse 必须作用在副本上）", () => {
    const before = bloodline({ chronicle: [entry("甲传"), entry("乙传")] });
    buildSeedScreenVm(before, CONTENT);
    expect(before.chronicle.map((item) => item.title)).toEqual(["甲传", "乙传"]);
  });

  it("血统点原样透出", () => {
    expect(buildSeedScreenVm(bloodline({ points: 7 }), CONTENT).points).toBe(7);
  });
});
