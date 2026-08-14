import { describe, expect, it } from "vitest";
import { TALE_CONTENT } from "@shiling/tale-content";
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

/** [S2] 真内容 ＋ 一份空图鉴 —— 山川那一段测的是与真去处表的对账。 */
const TALE_REAL = TALE_CONTENT;

function realBloodline(): Bloodline {
  return {
    points: 0,
    unlockedSeedIds: TALE_REAL.seeds.filter((seed) => seed.cost <= 0).map((seed) => seed.id),
    chronicle: [],
    knownSynergyIds: [],
    knownOrganIds: [],
    boonOrganId: null,
    knownDestinationIds: [],
    foundTreasureIds: [],
    knownEnemyIds: [],
    loreEnemyIds: [],
    sigilIds: [],
    chartedDestinationId: null,
  };
}

function bloodline(patch: Partial<Bloodline> = {}): Bloodline {
  return {
    points: 0,
    unlockedSeedIds: [FIXTURE_SEED_ID],
    chronicle: [],
    knownSynergyIds: [],
    knownOrganIds: [],
    boonOrganId: null,
    knownDestinationIds: [],
    foundTreasureIds: [],
    knownEnemyIds: [],
    loreEnemyIds: [],
    sigilIds: [],
    chartedDestinationId: null,
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

/*
 * [S2] 山川图鉴：去处与秘藏。
 *
 * 信息分配与异变图鉴**刚好相反**，而这正是最容易在下一次改动里被抹平的地方，所以逐条钉：
 * 去处的名号与门槛**恒可见**（欲望展示位），秘藏的名号**未得则恒为「？」**（意料之外）。
 */
describe("[S2] 山川图鉴", () => {
  const PLACE = TALE_REAL.destinations[0]!;
  const DEEP = TALE_REAL.destinations[TALE_REAL.destinations.length - 1]!;

  function realVm(patch: Partial<Bloodline> = {}) {
    return buildSeedScreenVm(
      { ...realBloodline(), ...patch },
      TALE_REAL,
      1234,
      null,
    ).codex;
  }

  it("六处全在，顺序恒按内容表，门槛与名号恒可见", () => {
    const codex = realVm();
    expect(codex.places.map((row) => row.id)).toEqual(
      TALE_REAL.destinations.map((destination) => destination.id),
    );
    for (const row of codex.places) {
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.gate.length).toBeGreaterThan(0);
      expect(row.desc.length).toBeGreaterThan(0);
    }
    // 无门槛那一处要写成人话，而不是一个空字符串
    expect(codex.places[0]?.gate).toContain("无门槛");
  });

  it("门槛列的是**器官名**（玩家据它去凑），不是 id", () => {
    const row = realVm().places.find((item) => item.id === DEEP.id)!;
    for (const id of DEEP.requiresOrganIds) {
      const name = TALE_REAL.organs.find((organ) => organ.id === id)?.name ?? "";
      expect(row.gate).toContain(name);
      expect(row.gate).not.toContain(id);
    }
  });

  /** 与 S1 异变图鉴的铁律逐字同解：**未得的秘藏连名字都不许进 VM**。 */
  it("未得的秘藏恒为「？」，且序列化之后也搜不到它的名字", () => {
    const codex = realVm();
    for (const row of codex.places) {
      expect(row.treasureKnown).toBe(false);
      expect(row.treasureName).toBe("？");
    }
    const serialized = JSON.stringify(codex.places);
    for (const destination of TALE_REAL.destinations) {
      expect(serialized, `${destination.treasure.id} 的名字漏进了 VM`).not.toContain(
        destination.treasure.name,
      );
    }
  });

  it("得过的秘藏摊开名号与说明", () => {
    const codex = realVm({ foundTreasureIds: [PLACE.treasure.id] });
    const row = codex.places.find((item) => item.id === PLACE.id)!;
    expect(row.treasureKnown).toBe(true);
    expect(row.treasureName).toBe(PLACE.treasure.name);
    expect(row.treasureNote).toBe(PLACE.treasure.desc);
  });

  it("到过的标 visited（没到过的不标）", () => {
    const codex = realVm({ knownDestinationIds: [PLACE.id] });
    expect(codex.places.find((item) => item.id === PLACE.id)?.visited).toBe(true);
    expect(codex.places.find((item) => item.id === DEEP.id)?.visited).toBe(false);
  });

  it("小标题报两个计数（已至之地 N/M · 秘藏 N/M）", () => {
    const codex = realVm({
      knownDestinationIds: [PLACE.id, DEEP.id],
      foundTreasureIds: [PLACE.treasure.id],
    });
    expect(codex.placeCaption).toBe(`已至之地 2/6 · 秘藏 1/6`);
  });
});

/**
 * [S3] 异兽图鉴 ＋ 三个新货架 ＋ 「这一世可以试着凑 X」。
 *
 * 三条断言最要紧（其余是形状）：
 * ① 未照面的兽**连名字都不许进 VM**（S1 铁律的第三次落地）；
 * ② 建议只从**已发现**的组合里推 —— 拿一条没撞见的配方去写建议等于把这一批的本钱送掉；
 * ③ 四类货架的置灰与 persist 层的 `buyX` 逐条同形（S1 血脉那条教训）。
 */
describe("[S3] 异兽图鉴 · 血统货架 · 转世建议", () => {
  const REAL = TALE_CONTENT;
  const BEAST = REAL.enemies[0]!;
  const FIERCE = [...REAL.enemies].sort((a, b) => b.meng - a.meng)[0]!;
  const SIGIL = REAL.sigils[0]!;
  const GATED = REAL.destinations.find((place) => place.requiresOrganIds.length > 0)!;
  const GATELESS = REAL.destinations.find((place) => place.requiresOrganIds.length === 0)!;

  function vm(patch: Partial<Bloodline> = {}) {
    return buildSeedScreenVm({ ...realBloodline(), ...patch }, REAL, 20260814);
  }

  describe("异兽图鉴（不泄露）", () => {
    it("一头都没照面时八行全是「？」，序列化之后也搜不到任何兽名", () => {
      const codex = vm().codex;
      expect(codex.beasts).toHaveLength(REAL.enemies.length);
      for (const row of codex.beasts) {
        expect(row.known).toBe(false);
        expect(row.name).toBe("？");
        expect(row.id).toBeNull();
      }
      const serialized = JSON.stringify(codex.beasts);
      for (const enemy of REAL.enemies) {
        expect(serialized, `${enemy.id} 的名字漏进了 VM`).not.toContain(enemy.name);
      }
    });

    it("照过面的摊开名号与两个数；顺序**恒按内容表**（位置固定才记得住哪一格还是问号）", () => {
      const codex = vm({ knownEnemyIds: [FIERCE.id] }).codex;
      expect(codex.beasts.map((row) => row.known)).toEqual(
        REAL.enemies.map((enemy) => enemy.id === FIERCE.id),
      );
      const row = codex.beasts.find((item) => item.id === FIERCE.id)!;
      expect(row.name).toBe(FIERCE.name);
      expect(row.meta).toContain(String(FIERCE.meng));
      expect(row.lore).toBe(false);
    });

    it("参透过的标「已参透」", () => {
      const codex = vm({ knownEnemyIds: [BEAST.id], loreEnemyIds: [BEAST.id] }).codex;
      expect(codex.beasts.find((item) => item.id === BEAST.id)?.lore).toBe(true);
    });

    it("总览那一条把四个分数并排（这一屏「往哪使劲」的第一层答案）", () => {
      const codex = vm({
        knownSynergyIds: [REAL.synergies[0]!.id],
        knownDestinationIds: [GATELESS.id],
        knownEnemyIds: [BEAST.id],
      }).codex;
      expect(codex.summary).toContain(`已知异变 1/${REAL.synergies.length}`);
      expect(codex.summary).toContain(`已至之地 1/${REAL.destinations.length}`);
      expect(codex.summary).toContain(`已识异兽 1/${REAL.enemies.length}`);
      expect(codex.summary).toContain("历代 0 篇");
      expect(codex.beastCaption).toBe(`已识异兽 1/${REAL.enemies.length}`);
    });
  });

  describe("三个新货架", () => {
    it("图鉴知识：只上架照过面的；标价、买得起、还差多少", () => {
      const poor = vm({ knownEnemyIds: [FIERCE.id] }).codex;
      expect(poor.lores).toHaveLength(1);
      expect(poor.lores[0]?.affordable).toBe(false);
      expect(poor.lores[0]?.shortfall).toBeGreaterThan(0);
      const rich = vm({ points: 99, knownEnemyIds: [FIERCE.id] }).codex;
      expect(rich.lores[0]?.affordable).toBe(true);
      expect(rich.lores[0]?.shortfall).toBe(0);
      // 买到的是**信息**，所以那一行写的是读得出什么，不是「+X」
      expect(rich.lores[0]?.gain).not.toMatch(/\+\d/);
    });

    it("图鉴知识：一头都没照面时给一句话而不是留白", () => {
      expect(vm().codex.lores).toHaveLength(0);
      expect(vm().codex.loreEmptyNote).not.toBeNull();
    });

    it("图录：**只上架已到过且有门槛的**（兽径不上架）", () => {
      const codex = vm({ points: 99, knownDestinationIds: [GATED.id, GATELESS.id] }).codex;
      expect(codex.charts.map((row) => row.destinationId)).toEqual([GATED.id]);
      expect(codex.charts[0]?.gate).toContain(
        REAL.organs.find((organ) => organ.id === GATED.requiresOrganIds[0])!.name,
      );
      expect(codex.charts[0]?.affordable).toBe(true);
    });

    it("图录：买过之后**整排锁住**（一世一处，界面是 `buyChart` 的镜像）", () => {
      const codex = vm({
        points: 99,
        knownDestinationIds: REAL.destinations.map((place) => place.id),
        chartedDestinationId: GATED.id,
      }).codex;
      expect(codex.chosenChartName).toBe(GATED.name);
      for (const row of codex.charts) expect(row.affordable).toBe(false);
      expect(codex.charts.find((row) => row.destinationId === GATED.id)?.chosen).toBe(true);
    });

    it("世家印记：五枚全列；满员之后整排锁住（上限是 `buySigil` 的镜像）", () => {
      const codex = vm({ points: 99 }).codex;
      expect(codex.sigils).toHaveLength(REAL.sigils.length);
      expect(codex.sigils.every((row) => row.affordable)).toBe(true);
      expect(codex.sigils[0]?.effect).toMatch(/^每世 /);

      const full = vm({
        points: 99,
        sigilIds: REAL.sigils.slice(0, REAL.tuning.sigilCap).map((sigil) => sigil.id),
      }).codex;
      expect(full.sigilCaption).toBe(`已受 ${REAL.tuning.sigilCap}/${REAL.tuning.sigilCap} 枚`);
      for (const row of full.sigils) expect(row.affordable).toBe(false);
      expect(full.sigils.find((row) => row.sigilId === SIGIL.id)?.owned).toBe(true);
    });
  });

  describe("转世建议（「这一世可以试着凑 X」）", () => {
    /** 上一世的终态：身上带着这几件器官 */
    function lastLife(organIds: readonly string[]): TaleState {
      const state = createLife(20260814, REAL.seeds[0]!.id, REAL);
      return { ...state, organIds: [...state.organIds, ...organIds] };
    }

    it("已发现的组合差一件 → 点名那一件，并说它顺带开哪一处", () => {
      // 秘窟与「夜猎之眼」共用配方（雾目＋夜瞳）—— 这一条正好同时覆盖两半
      const synergy = REAL.synergies.find((item) => item.organIds.length === 2)!;
      const have = synergy.organIds[0]!;
      const missing = synergy.organIds[1]!;
      const quests = buildSeedScreenVm(
        { ...realBloodline(), knownSynergyIds: [synergy.id] },
        REAL,
        20260814,
        lastLife([have]),
      ).next.quests;
      const first = quests[0] ?? "";
      expect(first).toContain(REAL.organs.find((organ) => organ.id === have)!.name);
      expect(first).toContain(REAL.organs.find((organ) => organ.id === missing)!.name);
      expect(first).toContain(synergy.name);
    });

    it("**不许**拿没发现过的组合去写建议（S1 铁律）", () => {
      const synergy = REAL.synergies[0]!;
      const quests = buildSeedScreenVm(
        realBloodline(),
        REAL,
        20260814,
        lastLife([synergy.organIds[0]!]),
      ).next.quests;
      for (const quest of quests) expect(quest).not.toContain(synergy.name);
    });

    it("没去过的地方差一件门槛 → 写全门槛并点名缺的那一件（门槛是公开信息）", () => {
      // 双件门槛的那一处：只带一件进去，才量得到「已走到一半」那一支措辞
      const twoGate = REAL.destinations.find((place) => place.requiresOrganIds.length === 2)!;
      const quests = buildSeedScreenVm(
        realBloodline(),
        REAL,
        20260814,
        lastLife([twoGate.requiresOrganIds[0]!]),
      ).next.quests;
      const line = quests.find((quest) => quest.includes(twoGate.name)) ?? "";
      expect(line).not.toBe("");
      for (const id of twoGate.requiresOrganIds) {
        expect(line).toContain(REAL.organs.find((organ) => organ.id === id)!.name);
      }
      // 「已走到一半」那一支，而不是「只要一件」
      expect(line).toContain("只差");
    });

    it("头一世（没有前世）也点得出一处单件门槛的地方，但**不说「只差」**", () => {
      const line = vm().next.quests.find((quest) => quest.includes("历代未至")) ?? "";
      expect(line).toContain("门槛只要一件");
      expect(line).not.toContain("只差");
    });

    it("已照面、买得起、还没参透的兽 → 写出价钱与买到的东西", () => {
      const quests = buildSeedScreenVm(
        { ...realBloodline(), points: 99, knownEnemyIds: [FIERCE.id] },
        REAL,
        20260814,
      ).next.quests;
      expect(quests.some((quest) => quest.includes(FIERCE.name))).toBe(true);
    });

    it("**买不起的不写**（一条买不起的建议不是建议）", () => {
      const quests = buildSeedScreenVm(
        { ...realBloodline(), points: 0, knownEnemyIds: [FIERCE.id] },
        REAL,
        20260814,
      ).next.quests;
      expect(quests.some((quest) => quest.includes(FIERCE.name))).toBe(false);
    });

    it("一条都推不出来时给兜底那一句（不留空 —— 空白只会让人以为界面坏了）", () => {
      // 造一份「无门槛去处 ＋ 无印记」的内容：四条优先级全落空的那个角落
      const barren: TaleContent = {
        ...REAL,
        sigils: [],
        destinations: REAL.destinations.filter((place) => place.requiresOrganIds.length === 0),
      };
      const quests = buildSeedScreenVm(
        { ...realBloodline(), knownDestinationIds: barren.destinations.map((p) => p.id) },
        barren,
        20260814,
      ).next.quests;
      expect(quests).toHaveLength(1);
      expect(quests[0]).toContain(String(REAL.synergies.length));
      expect(quests[0]).toContain(String(REAL.enemies.length));
    });

    it("至多三条（一屏读得完）", () => {
      const synergy = REAL.synergies.find((item) => item.organIds.length === 2)!;
      const quests = buildSeedScreenVm(
        {
          ...realBloodline(),
          points: 99,
          knownSynergyIds: REAL.synergies.map((item) => item.id),
          knownEnemyIds: REAL.enemies.map((enemy) => enemy.id),
        },
        REAL,
        20260814,
        lastLife([synergy.organIds[0]!]),
      ).next.quests;
      expect(quests.length).toBeLessThanOrEqual(3);
    });
  });
});
