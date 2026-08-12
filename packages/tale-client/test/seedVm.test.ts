import { describe, expect, it } from "vitest";
import {
  createLife,
  rollPremise,
  type Bloodline,
  type ChronicleEntry,
  type SeedDef,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { composeAscendGap } from "../src/model/chronicleVm.js";
import { WAY_LABELS } from "../src/model/format.js";
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

/**
 * [2026-08-13] 择神种屏要**提前**报出下一世的天时与出身，所以它多了一个「下一世的种子数」
 * 参数（`rollPremise(seedNum)` 是纯函数，与 `createLife` 掷出的逐字相同）。
 * 测试固定一个数即可 —— 这一屏的判定与掷到哪个天时无关。
 */
const NEXT_SEED = 20260813;

function entry(title: string, ending: ChronicleEntry["ending"] = "starve"): ChronicleEntry {
  return { title, body: "开篇。\n赞曰：了。", ending, years: 6, organCount: 2 };
}

describe("buildSeedScreenVm", () => {
  it("免费种恒为 unlocked（哪怕存档里没记它）", () => {
    const vm = buildSeedScreenVm(
      { points: 0, unlockedSeedIds: [], chronicle: [] },
      FIXTURE_CONTENT,
      NEXT_SEED,
    );
    expect(vm.cards[0]?.lock).toBe("unlocked");
    expect(vm.cards[0]?.shortfall).toBe(0);
  });

  it("点数不足 → locked，并给出还差多少", () => {
    const card = buildSeedScreenVm(bloodline({ points: 2 }), CONTENT, NEXT_SEED).cards[1];
    expect(card?.lock).toBe("locked");
    expect(card?.shortfall).toBe(3);
  });

  it("点数刚好等于花费 → affordable（边界不许算成 locked）", () => {
    const card = buildSeedScreenVm(bloodline({ points: 5 }), CONTENT, NEXT_SEED).cards[1];
    expect(card?.lock).toBe("affordable");
    expect(card?.shortfall).toBe(0);
  });

  it("已解锁的种即使点数为 0 也是 unlocked，且不再显示差额", () => {
    const card = buildSeedScreenVm(
      bloodline({ points: 0, unlockedSeedIds: [FIXTURE_SEED_ID, PAID_SEED.id] }),
      CONTENT,
      NEXT_SEED,
    ).cards[1];
    expect(card?.lock).toBe("unlocked");
    expect(card?.shortfall).toBe(0);
  });

  it("点数远超花费也只是 affordable，不会溢出成负的差额", () => {
    const card = buildSeedScreenVm(bloodline({ points: 99 }), CONTENT, NEXT_SEED).cards[1];
    expect(card?.lock).toBe("affordable");
    expect(card?.shortfall).toBe(0);
  });

  it("带出自带器官的名号、战技与中文加成（负值用全角减号）", () => {
    const card = buildSeedScreenVm(bloodline(), CONTENT, NEXT_SEED).cards[1];
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
    const card = buildSeedScreenVm(bloodline(), { ...CONTENT, seeds: [plain] }, NEXT_SEED).cards[0];
    expect(card?.statMods).toEqual([]);
    expect(card?.combatSkillName).toBeNull();
  });

  it("前传目录最新在前，并报出已历世数", () => {
    const vm = buildSeedScreenVm(
      bloodline({ chronicle: [entry("甲传"), entry("乙传"), entry("丙传", "ascend")] }),
      CONTENT,
      NEXT_SEED,
    );
    expect(vm.lives).toBe(3);
    expect(vm.chronicle.map((item) => item.title)).toEqual(["丙传", "乙传", "甲传"]);
    expect(vm.chronicle[0]?.ending).toBe("ascend");
  });

  it("不改入参的 chronicle 数组（reverse 必须作用在副本上）", () => {
    const before = bloodline({ chronicle: [entry("甲传"), entry("乙传")] });
    buildSeedScreenVm(before, CONTENT, NEXT_SEED);
    expect(before.chronicle.map((item) => item.title)).toEqual(["甲传", "乙传"]);
  });

  it("血统点原样透出", () => {
    expect(buildSeedScreenVm(bloodline({ points: 7 }), CONTENT, NEXT_SEED).points).toBe(7);
  });

  /**
   * [2026-08-13] 「此世天时」预告：这一屏在 `createLife` **之前**，而它显示的必须与真正
   * 降生的那一世逐字相同 —— 靠引擎的 `rollPremise(seedNum)`（纯函数，且降世时那两次抽取
   * 恒在最前）。这条测试钉住的正是「预告不许说谎」。
   */
  it("报出下一世的天时与出身，且与 rollPremise 逐字相同", () => {
    const vm = buildSeedScreenVm(bloodline(), CONTENT, NEXT_SEED);
    const premise = rollPremise(NEXT_SEED, CONTENT);
    expect(vm.next.skyName).toBe(premise.sky.name);
    expect(vm.next.skyEffect).toBe(premise.sky.effect);
    expect(vm.next.originName).toBe(premise.origin.name);
    expect(vm.next.caption).toContain(premise.sky.name);
    expect(vm.next.caption).toContain(premise.origin.name);
  });

  it("没有前世时不给「换条路」的建议（无从推）", () => {
    expect(buildSeedScreenVm(bloodline(), CONTENT, NEXT_SEED).next.advice).toBeNull();
  });

  /**
   * 有前世时那句话必须**由数据推**：上一世死在哪条道上、差了什么、这一世不妨试哪条。
   * 写死的建议在第三世就开始重复，而这一屏的全部作用就是让人觉得「下一局有别的可试」。
   */
  it("有前世时报出上一世走的那条道与差距，并建议换一条", () => {
    const last: TaleState = {
      ...createLife(4242, FIXTURE_SEED_ID, CONTENT),
      alive: false,
      ending: "oldage",
      year: 12,
      livesTaken: 4,
    };
    const advice = buildSeedScreenVm(bloodline(), CONTENT, NEXT_SEED, last).next.advice;
    expect(advice).not.toBeNull();
    expect(advice).toContain("上一世");
    // 建议的那条道不能是上一世刚走过的那条（否则「换条路」这句话是空的）
    const lastWay = composeAscendGap(last, CONTENT).way;
    expect(advice).toContain("这一世不妨试试");
    expect(advice?.includes(`试试${WAY_LABELS[lastWay]}`)).toBe(false);
  });
});
