import { describe, expect, it } from "vitest";
import {
  boonCost,
  createLife,
  rollPremise,
  type Bloodline,
  type ChronicleEntry,
  type SeedDef,
  type SynergyDef,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { composeAscendGap } from "../src/model/chronicleVm.js";
import { WAY_LABELS } from "../src/model/format.js";
import { buildSeedScreenVm } from "../src/model/seedVm.js";
import { FIXTURE_CONTENT, FIXTURE_SEED_ID } from "./helpers.js";

/** fixture 的四件器官 id（图鉴与血脉的断言要点名） */
const ORGAN_GOU_CHI = "gou-chi";
const ORGAN_WU_MU = "wu-mu";
const ORGAN_LIN_JIA = "lin-jia";
const ORGAN_JI_ZU = "ji-zu";

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
  return {
    points: 0,
    unlockedSeedIds: [FIXTURE_SEED_ID],
    chronicle: [],
    knownSynergyIds: [],
    knownOrganIds: [],
    boonOrganId: null,
    ...patch,
  };
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
      bloodline({ unlockedSeedIds: [] }),
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

/*
 * ===== S1 异变图鉴 ＋ 血脉 =====
 *
 * 两条铁律各有一条断言：**未发现的不许泄露配方**（连 DOM 上的 id 都不给），
 * 以及**血脉只卖已发现过的器官**（血统点的第二个去处）。
 */

const SYN_A: SynergyDef = {
  id: "syn-a",
  name: "甲变",
  organIds: [ORGAN_GOU_CHI, ORGAN_WU_MU],
  kind: "skill",
  reveal: "齿与目凑在一处，自有其理。",
  desc: "甲变之说。",
  skill: {
    name: "甲变",
    desc: "咬定并看清。",
    effects: ["venom"],
    damageMul: 2.6,
    cooldown: 4,
    cost: { kind: "hp", amount: 3 },
  },
};

const SYN_B: SynergyDef = {
  ...SYN_A,
  id: "syn-b",
  name: "乙变",
  organIds: [ORGAN_LIN_JIA, ORGAN_JI_ZU],
  reveal: "鳞与足凑在一处，自有其理。",
};

const CODEX_CONTENT: TaleContent = { ...FIXTURE_CONTENT, synergies: [SYN_A, SYN_B] };

describe("异变图鉴：未发现的一格不许泄露任何配方", () => {
  it("一条都没发现 → 全是「？」，且行里没有 id、没有配方、没有效果", () => {
    const vm = buildSeedScreenVm(bloodline(), CODEX_CONTENT, NEXT_SEED);
    expect(vm.codex.caption).toBe("已知异变 0/2");
    expect(vm.codex.knownCount).toBe(0);
    for (const row of vm.codex.rows) {
      expect(row.known).toBe(false);
      expect(row.id).toBeNull();
      expect(row.name).toBe("？");
      expect(row.recipe).toBe("");
      expect(row.effect).toBe("");
    }
    // 整个 VM 序列化之后也不该出现任何未发现组合的名字或配方器官名
    const dump = JSON.stringify(vm);
    expect(dump).not.toContain("甲变");
    expect(dump).not.toContain("乙变");
  });

  it("发现过的那一条摊开配方、效果与因果；另一条仍是「？」", () => {
    const vm = buildSeedScreenVm(
      bloodline({ knownSynergyIds: [SYN_A.id] }),
      CODEX_CONTENT,
      NEXT_SEED,
    );
    expect(vm.codex.caption).toBe("已知异变 1/2");
    const [first, second] = vm.codex.rows;
    expect(first?.known).toBe(true);
    expect(first?.name).toBe("甲变");
    expect(first?.recipe).toBe("狩齿 ＋ 雾目");
    expect(first?.effect).toContain("伤 ×2.6");
    expect(first?.effect).toContain("附毒");
    expect(first?.effect).toContain("自伤 3");
    expect(first?.note).toBe(SYN_A.reveal);
    expect(second?.known).toBe(false);
    expect(JSON.stringify(vm)).not.toContain("乙变");
  });

  /**
   * 顺序恒定（按 `content.synergies`）而不是「已发现的排前面」：位置固定，
   * 玩家才会记住「第二格还是问号」—— 那一格就是他下一世想去凑的东西。
   */
  it("行的顺序恒按内容表，不因发现与否重排", () => {
    const vm = buildSeedScreenVm(
      bloodline({ knownSynergyIds: [SYN_B.id] }),
      CODEX_CONTENT,
      NEXT_SEED,
    );
    expect(vm.codex.rows[0]?.known).toBe(false);
    expect(vm.codex.rows[1]?.known).toBe(true);
  });
});

describe("血脉：血统点的第二个去处", () => {
  it("一件器官都没见过 → 不列表，给一句「怎么才能有」", () => {
    const vm = buildSeedScreenVm(bloodline(), CODEX_CONTENT, NEXT_SEED);
    expect(vm.codex.boons).toEqual([]);
    expect(vm.codex.boonEmptyNote).toContain("蜕一件形");
  });

  it("见过的器官标价，点数够才 affordable（价钱问引擎，界面不写第二份）", () => {
    const cost = boonCost(ORGAN_GOU_CHI, CODEX_CONTENT);
    const poor = buildSeedScreenVm(
      bloodline({ knownOrganIds: [ORGAN_GOU_CHI], points: cost - 1 }),
      CODEX_CONTENT,
      NEXT_SEED,
    );
    expect(poor.codex.boons[0]?.cost).toBe(cost);
    expect(poor.codex.boons[0]?.affordable).toBe(false);
    // 买不起要写清**还差多少**（同屏神种卡的体例）——「再活一世够不够」是玩家的下一个问题
    expect(poor.codex.boons[0]?.shortfall).toBe(1);
    const rich = buildSeedScreenVm(
      bloodline({ knownOrganIds: [ORGAN_GOU_CHI], points: cost }),
      CODEX_CONTENT,
      NEXT_SEED,
    );
    expect(rich.codex.boons[0]?.affordable).toBe(true);
    expect(rich.codex.boons[0]?.shortfall).toBe(0);
    // 战技名是买它的主要动机，要报出来
    expect(rich.codex.boons[0]?.skillName).toBe("撕咬");
  });

  it("已买下的那一件标成「下一世自带」，并在标题那一行点名", () => {
    const vm = buildSeedScreenVm(
      bloodline({ knownOrganIds: [ORGAN_GOU_CHI], boonOrganId: ORGAN_GOU_CHI, points: 20 }),
      CODEX_CONTENT,
      NEXT_SEED,
    );
    expect(vm.codex.boons[0]?.chosen).toBe(true);
    expect(vm.codex.boons[0]?.affordable).toBe(false);
    expect(vm.codex.chosenBoonName).toBe("狩齿");
  });

  /**
   * 买过之后**整排锁住**：`buyBoon` 允许改主意，但改一次要再付一次（已付不退）。
   * 界面若把别的行显示成「可买」，玩家点第二件时不会预期到那是第二笔钱 ——
   * 而这一屏上一颗按钮就是一世的积蓄。
   */
  it("已经买过血脉之后，别的器官也不许再买（免得第二笔钱花得莫名其妙）", () => {
    const vm = buildSeedScreenVm(
      bloodline({
        knownOrganIds: [ORGAN_GOU_CHI, ORGAN_WU_MU],
        boonOrganId: ORGAN_GOU_CHI,
        points: 99,
      }),
      CODEX_CONTENT,
      NEXT_SEED,
    );
    expect(vm.codex.boons.every((boon) => !boon.affordable)).toBe(true);
  });

  it("最近见过的排在前（图鉴是流水的反序，刚蜕出来的那件最想带）", () => {
    const vm = buildSeedScreenVm(
      bloodline({ knownOrganIds: [ORGAN_GOU_CHI, ORGAN_WU_MU], points: 20 }),
      CODEX_CONTENT,
      NEXT_SEED,
    );
    expect(vm.codex.boons.map((boon) => boon.organId)).toEqual([ORGAN_WU_MU, ORGAN_GOU_CHI]);
  });
});
