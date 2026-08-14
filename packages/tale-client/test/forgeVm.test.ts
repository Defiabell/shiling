/**
 * 凝招屏（招式框）的视图模型测试。
 *
 * 这一屏的验收标准只有一句话：**每换一个部件，屏幕上的数当场跟着变，且变成的是真数**。
 * 所以本文件的断言一律打在「玩家眼睛看得到的那串字」上（`outcome`／`resultCost`／
 * `blockedReason`／`emptyReason`），而不是打在中间字段上 —— 一个 `affordable: false`
 * 配一句「不可用」的界面在类型上完全合法，在屏幕上却是个死胡同。
 *
 * 用的是**真内容**（`TALE_CONTENT` ＋ `realState`）而不是 fixture：部件表（15 件）与
 * 古法表（10 条）都住在真内容里，fixture 一件部件都没有，拿它测凝招等于测一个空表。
 */

import { describe, expect, it } from "vitest";
import {
  defaultForgePicks,
  forgeSkill,
  learnLore,
  type ForgePicks,
  type TaleState,
} from "@shiling/tale-sim";
import {
  ORGAN_DU_XIAN,
  ORGAN_GOU_CHI,
  ORGAN_JI_ZU,
  ORGAN_LIN_JIA,
  ORGAN_TIE_ZONG,
  ORGAN_WU_MU,
  ORGAN_XUE_ZHAO,
  ORGAN_YE_TONG,
  PART_CHI,
  PART_DU,
  PART_ZHAO,
  PART_ZONG,
  SEED_ORGAN_LING_YUN,
  SYN_KUI_YAO,
  SYN_SUI_GU,
  SYNERGIES,
  TALE_CONTENT,
} from "@shiling/tale-content";
import { buildForgeVm } from "../src/model/forgeVm.js";
import { realState, withPatch } from "./helpers.js";

/** 四型都不缺 —— 除非这一条测的就是「付不起」，否则精气不该是变量。 */
const RICH_ESSENCE = { zu: 99, lin: 99, xue: 99, meng: 99 };

/** 一世 ＝ 常胎（自带灵蕴 → 部件「蕴」）＋ 这几件蜕出来的器官。 */
function lifeWith(
  organIds: readonly string[],
  essence: Record<"zu" | "lin" | "xue" | "meng", number> = RICH_ESSENCE,
): TaleState {
  return withPatch(realState(), { organIds: [...organIds], essence: { ...essence } });
}

/**
 * 手上有 齿 鬃 毒 爪 蕴 五件部件的一世 —— 三个槽各有多个候选，
 * 且 齿／爪 同时能起手能发力、鬃／毒 同时能发力能收尾，占槽冲突全都出得来。
 */
const FIVE_PARTS = [
  SEED_ORGAN_LING_YUN,
  ORGAN_GOU_CHI,
  ORGAN_TIE_ZONG,
  ORGAN_DU_XIAN,
  ORGAN_XUE_ZHAO,
] as const;

/**
 * owner 那张招式框原型上的一手：齿起手（×1.4）· 鬃发力（+0.4）· 毒收尾（附毒）
 * → 猛之精气 18 · 势 3 · 冷却 3。tuning 的注释里逐项对过账。
 */
const PROTO_PICKS: ForgePicks = { open: PART_CHI, force: PART_ZONG, addon: PART_DU };

describe("buildForgeVm：每一颗部件按钮都写着「换上它之后这一手变成什么」", () => {
  /**
   * 这一屏的验收第一问。一颗只写「齿：伤 ×1.4」的按钮等于让玩家自己算总账 ——
   * 四项缺一项，那一项就成了点下去才知道的东西。
   */
  it("每个槽的每一颗可选部件都写全伤害、势、冷却、精气四项", () => {
    const state = lifeWith([
      ...FIVE_PARTS,
      ORGAN_WU_MU,
      ORGAN_JI_ZU,
      ORGAN_LIN_JIA,
      ORGAN_YE_TONG,
    ]);
    const picks = defaultForgePicks(state, TALE_CONTENT);
    expect(picks).not.toBeNull();
    const vm = buildForgeVm(state, TALE_CONTENT, picks, []);
    // 三个槽都得有候选，否则下面的循环可能一颗按钮都没走到
    expect(vm.slots).toHaveLength(3);
    for (const slot of vm.slots) {
      expect(slot.options.length, slot.label).toBeGreaterThan(2);
      for (const option of slot.options.filter((item) => item.disabledReason === null)) {
        const where = `${slot.label}·${option.name}`;
        expect(option.outcome, where).toMatch(/伤 \d/);
        expect(option.outcome, where).toMatch(/势 \d/);
        expect(option.outcome, where).toMatch(/冷却 \d+ 合/);
        expect(option.outcome, where).toMatch(/之精气 \d+/);
      }
    }
  });

  /**
   * 按钮上的数**就是**换上它之后真会拿到的数 —— 两处各算一遍就会在下一次调参时分家，
   * 而分家的表现是「按钮说 18，凝成扣了 23」这种没人会当场发现的账。
   */
  it("按钮写的数与换上它之后的成品行、代价行逐字对得上", () => {
    const state = lifeWith(FIVE_PARTS);
    const vm = buildForgeVm(state, TALE_CONTENT, PROTO_PICKS, []);
    for (const slot of vm.slots) {
      for (const option of slot.options.filter((item) => item.disabledReason === null)) {
        const swapped = buildForgeVm(
          state,
          TALE_CONTENT,
          { ...PROTO_PICKS, [slot.slot]: option.partId },
          [],
        );
        const where = `${slot.label}·${option.name}`;
        const effect = String(swapped.resultEffect);
        expect(option.outcome, where).toContain(effect);
        // 按钮尾巴上那一句「猛之精气 18」也要与代价行是同一个数
        const paid = option.outcome.slice(`${effect} · `.length);
        expect(swapped.resultCost, where).toContain(paid);
      }
    }
  });

  /**
   * 「换一个部件预览当场变」的最小证明：同一世、只动起手那一件，成品行与代价行两处都变 ——
   * 连**付哪一型精气**都跟着换（齿是猛、爪是穴），因为精气型由起手那一件定。
   */
  it("换掉起手那一件，成品行与代价行都当场变（精气型也跟着换）", () => {
    const state = lifeWith(FIVE_PARTS);
    const withTooth = buildForgeVm(state, TALE_CONTENT, PROTO_PICKS, []);
    const withClaw = buildForgeVm(state, TALE_CONTENT, { ...PROTO_PICKS, open: PART_ZHAO }, []);
    expect(withTooth.resultEffect).toBe("伤 5〜9 · 附毒·数合不起势 · 势 3 · 冷却 3 合");
    expect(withClaw.resultEffect).not.toBe(withTooth.resultEffect);
    expect(withTooth.resultCost).toContain("猛之精气 18");
    expect(withClaw.resultCost).toContain("穴之精气 16");
    expect(withClaw.resultCost).not.toBe(withTooth.resultCost);
  });

  /**
   * 同一件部件不能占两个槽（引擎那边直接抛错）。占着别的槽的那一件**照样列出来、
   * 照样写满后果** —— 点它 ＝ **两个槽对调**（`picksAfter`），并在按钮上写明
   * 「与起手对调」。
   *
   * 这一条最初写成「灰掉并写明已占起手」，code review 判它是 S1 那条
   * 「原因顶掉后果」的复发：一颗只剩「已占起手」的按钮既不摊后果，又要玩家自己
   * 先把它从那边挪走再点这边（多一次点击）。改成对调之后两样都解决了。
   */
  it("已经占着别的槽的那一件不灰掉，而是点了就对调 —— 后果照写", () => {
    const vm = buildForgeVm(lifeWith(FIVE_PARTS), TALE_CONTENT, PROTO_PICKS, []);
    // 齿起手 · 爪发力 —— 两件都同时能起手能发力，于是「对调」这一档跑得出来
    const vm2 = buildForgeVm(
      lifeWith(FIVE_PARTS),
      TALE_CONTENT,
      { open: PART_CHI, force: PART_ZHAO, addon: PART_DU },
      [],
    );
    const at = (slot: string, partId: string) =>
      vm.slots.find((item) => item.slot === slot)?.options.find((o) => o.partId === partId);

    // 爪占着力道 → 它在起手槽里可点，点了就是「起手 ↔ 力道」对调（齿与爪都两样 payload 都有）
    const clawInOpen = vm2.slots
      .find((item) => item.slot === "open")
      ?.options.find((o) => o.partId === PART_ZHAO);
    expect(clawInOpen?.disabledReason).toBeNull();
    expect(clawInOpen?.swapNote).toBe("与力道对调");
    expect(clawInOpen?.picksAfter).toEqual({
      open: PART_ZHAO,
      force: PART_CHI,
      addon: PART_DU,
    });
    const toothInForce = clawInOpen;
    // **后果照写**（这一屏的全部主张）：四项一项不少
    expect(toothInForce?.outcome).toMatch(/伤 \d/);
    expect(toothInForce?.outcome).toMatch(/势 \d/);
    expect(toothInForce?.outcome).toMatch(/冷却 \d+ 合/);
    expect(toothInForce?.outcome).toMatch(/之精气 \d+/);
    expect(toothInForce?.selected).toBe(false);

    // 反证：同一颗齿在它自己占着的那个槽里是选中的、且写满后果、不写对调
    expect(at("open", PART_CHI)?.selected).toBe(true);
    expect(at("open", PART_CHI)?.swapNote).toBeNull();
    expect(at("open", PART_CHI)?.outcome).toContain("猛之精气 18");

    /*
     * 对调**换不动**的那一档才灰：换过去的那一件在对方的槽里没有 payload。
     * 鬃在附加槽里点下去要与力道对调，而力道上那一件（毒）没有力道 payload ——
     * 那一颗写清是**哪一件**卡住了，而不是一句「不可选」。
     */
    const stuck = at("addon", PART_ZONG);
    expect(stuck?.disabledReason).toBe("换不动 —— 毒放不进力道");
  });
});

describe("buildForgeVm：凝不成的两种原因，对玩家的下一步完全不同", () => {
  /**
   * 精气不够时**照样把那几件列出来**（欲望展示位）：玩家得看得见「再攒 13 点猛就能凝这一手」，
   * 那正是他下一趟去猎的理由。藏起来等于把目标也藏了。
   */
  it("精气不足：付不起的部件照样列出来写满后果，只是 affordable 为假", () => {
    const poor = lifeWith(FIVE_PARTS, { zu: 0, lin: 0, xue: 0, meng: 5 });
    const vm = buildForgeVm(poor, TALE_CONTENT, PROTO_PICKS, []);
    expect(vm.canForge).toBe(false);
    expect(vm.blockedReason).toBe("猛精气不足（需 18，现有 5）");
    // 缺多少要说得出来：「需 18，现有 5」而不是「精气不足」
    expect(vm.blockedReason).toContain("需 18");
    expect(vm.blockedReason).toContain("现有 5");

    const tooth = vm.slots
      .find((slot) => slot.slot === "open")
      ?.options.find((option) => option.partId === PART_CHI);
    expect(tooth?.affordable).toBe(false);
    // 付不起 ≠ 不可选：它没有 disabledReason，后果也照写
    expect(tooth?.disabledReason).toBeNull();
    expect(tooth?.outcome).toContain("猛之精气 18");
    // 精气那一行四型全列 —— 「凝哪一手付哪一型」得先看得见都有多少
    expect(vm.essenceLine).toBe("足 0 · 鳞 0 · 穴 0 · 猛 5");
  });

  /**
   * 槽满与精气不足必须分得开：前者的下一步是「先忘掉一手」，后者是「去猎」。
   * 一句笼统的「不可用」把这两条路合成了一条死路。
   */
  it("招式册已满：那一句说的是「先忘掉一手」，不是精气", () => {
    let full = lifeWith(FIVE_PARTS);
    const combos: ForgePicks[] = [
      { open: PART_CHI, force: PART_ZONG, addon: PART_DU },
      { open: PART_ZHAO, force: PART_CHI, addon: PART_ZONG },
      { open: PART_DU, force: PART_ZHAO, addon: PART_ZONG },
      { open: PART_CHI, force: PART_ZHAO, addon: PART_DU },
    ];
    for (const picks of combos) full = forgeSkill(full, TALE_CONTENT, picks);

    const vm = buildForgeVm(full, TALE_CONTENT, PROTO_PICKS, [SYN_KUI_YAO]);
    expect(vm.slotLine).toBe("招式册 4／4");
    expect(vm.canForge).toBe(false);
    expect(vm.blockedReason).toBe("招式册已满（4／4）—— 先忘掉一手");
    // 与「精气不足」那一句不能混：这一世精气满仓，屏幕上一个字都不该提精气
    expect(vm.blockedReason).not.toContain("精气");
    // 古法货架同理（凑齐了、付得起，卡的也是槽）
    const kuiYao = vm.lore.find((row) => row.synergyId === SYN_KUI_YAO);
    expect(kuiYao?.enabled).toBe(false);
    expect(kuiYao?.disabledReason).toContain("招式册已满");
    expect(kuiYao?.disabledReason).not.toContain("精气不足");
    // 满册之后引擎也不再推荐凝招 —— 招式册入口那点金光该灭
    expect(vm.recommended).toBe(false);
  });
});

describe("buildForgeVm：名号", () => {
  /**
   * 预填名号让「接受缺省」＝ 0 次点击。它必须跟着三件部件走 —— 换了收尾那一件却还叫
   * 原来的名字，玩家下一次在招式册里就认不出这是哪一手。
   */
  it("预填名跟着三件部件走：换掉收尾那一件，名号也换", () => {
    const state = lifeWith(FIVE_PARTS);
    const venom = buildForgeVm(state, TALE_CONTENT, PROTO_PICKS, []);
    expect(venom.defaultName).toBe("齿鬃蚀");
    expect(venom.nameValue).toBe("齿鬃蚀");

    const bleed = buildForgeVm(state, TALE_CONTENT, { ...PROTO_PICKS, addon: PART_ZHAO }, []);
    expect(bleed.defaultName).toBe("齿鬃裂");
    expect(bleed.nameValue).toBe("齿鬃裂");
  });

  it("玩家打过字之后，名框显示的是他打的那几个字", () => {
    const vm = buildForgeVm(lifeWith(FIVE_PARTS), TALE_CONTENT, PROTO_PICKS, [], "长风");
    expect(vm.nameValue).toBe("长风");
    expect(vm.defaultName).toBe("齿鬃蚀");
    expect(vm.canForge).toBe(true);
  });

  /**
   * 这一条防的是「引擎抛错打到控制台」：名号判据在引擎（`forgeNameValid`），
   * 界面若不先拦，玩家按下凝成就是一条 console.error，而 E2E 的判据之一是「0 控制台报错」。
   * 置灰之外还要说清收什么 —— 「无效」两个字不告诉他改成什么才行。
   */
  it("名号带英文字母或超过六字 → 凝成置灰，并说清只收六字以内的汉字", () => {
    const state = lifeWith(FIVE_PARTS);
    const latin = buildForgeVm(state, TALE_CONTENT, PROTO_PICKS, [], "abc");
    expect(latin.canForge).toBe(false);
    expect(latin.blockedReason).toBe("名号只许 6 字以内的汉字");

    const tooLong = buildForgeVm(state, TALE_CONTENT, PROTO_PICKS, [], "一二三四五六七");
    expect(tooLong.canForge).toBe(false);
    expect(tooLong.blockedReason).toBe("名号只许 6 字以内的汉字");

    // 六字整仍然收 —— 边界不许一边倒
    expect(buildForgeVm(state, TALE_CONTENT, PROTO_PICKS, [], "一二三四五六").canForge).toBe(true);
  });
});

describe("buildForgeVm：拼不出来时，那一句要说清缺的是哪一类部件", () => {
  /**
   * 「部件不足」四个字对玩家的下一步毫无指示。他需要知道的是**缺哪一类** ——
   * 缺收尾的那一件，去蜕毒腺／穴爪／雾目都行；缺起手的，那几件就一件都不顶用。
   */
  it("只有一件蕴（能起手能发力、不能收尾）→ 点名缺的是「附加」", () => {
    const state = lifeWith([SEED_ORGAN_LING_YUN]);
    // 拼不出来时引擎给不出预填 —— 界面走的就是 picks 为 null 这一条路
    expect(defaultForgePicks(state, TALE_CONTENT)).toBeNull();
    const vm = buildForgeVm(state, TALE_CONTENT, null, []);
    expect(vm.emptyReason).toBe("尚缺一件能作附加的部件 —— 再蜕一件器官试试。");
    expect(vm.emptyReason).not.toContain("部件不足");
    expect(vm.slots).toEqual([]);
    expect(vm.resultEffect).toBeNull();
    expect(vm.canForge).toBe(false);
    // 手上有什么照旧写出来（「我能拼什么」是这一屏最先要答的问题）
    expect(vm.partsLine).toBe("蕴");
  });

  it("只有一件目（只能收尾）→ 点名缺的是起手与力道两类", () => {
    const vm = buildForgeVm(lifeWith([ORGAN_WU_MU]), TALE_CONTENT, null, []);
    expect(vm.emptyReason).toBe("尚缺一件能作起手／力道的部件 —— 再蜕一件器官试试。");
  });

  /**
   * 三个槽各有候选、只是候选全是同一件部件（瞳三个槽都放得进）—— 这时说不出「缺哪一类」，
   * 于是退回一句同样能照做的话：三个槽要**三件不同的**，再蜕一件。
   */
  it("三个槽都有候选、只是凑不出三件不同的 → 退回「三个槽各要一件不同的部件」", () => {
    const state = lifeWith([ORGAN_YE_TONG]);
    expect(defaultForgePicks(state, TALE_CONTENT)).toBeNull();
    const vm = buildForgeVm(state, TALE_CONTENT, null, []);
    expect(vm.emptyReason).toBe("三个槽各要一件不同的部件 —— 手上还不够，再蜕一件器官试试。");
    expect(vm.emptyReason).not.toContain("部件不足");
  });
});

describe("buildForgeVm：未发现过的古法不许泄露名号与配方", () => {
  /** 这一世凑不齐任何一条古法的配方（齿 ＋ 鬃 ＋ 蕴，十条古法一条都不成）。 */
  const secretLife = () => lifeWith([SEED_ORGAN_LING_YUN, ORGAN_GOU_CHI, ORGAN_TIE_ZONG]);

  /** 这一世拼得出来的那一手（部件只有三件，`PROTO_PICKS` 里的毒它没有）。 */
  const secretPicks = (state: TaleState) => defaultForgePicks(state, TALE_CONTENT);

  /**
   * 沿用 S1 图鉴那条铁律（`seedVm.test.ts` 的「一条都没发现」那一条）：**把整个 VM
   * 序列化再查**。逐字段断言只挡得住已经想到的那几个字段，而 devtools 是玩家伸手就能开的
   * 东西 —— 泄露从来不是从 `name` 漏的，是从某个新加的字段漏的。
   */
  it("一条都没发现 → 整个 VM 里查不到任何古法名、因果句或配方器官名", () => {
    const state = secretLife();
    const vm = buildForgeVm(state, TALE_CONTENT, secretPicks(state), []);
    expect(vm.lore).toHaveLength(SYNERGIES.length);
    for (const row of vm.lore) {
      expect(row.known, row.synergyId).toBe(false);
      expect(row.name, row.synergyId).toBe("？");
      expect(row.recipe, row.synergyId).toBe("？");
      expect(row.reveal, row.synergyId).toBeNull();
      expect(row.effect, row.synergyId).toBe("尚未识得此法。");
      expect(row.cost, row.synergyId).toBe("");
      expect(row.enabled, row.synergyId).toBe(false);
      expect(row.disabledReason, row.synergyId).toBe("尚未识得");
    }
    const dump = JSON.stringify(vm);
    for (const synergy of SYNERGIES) {
      expect(dump, `${synergy.id} 的名号漏进了 VM`).not.toContain(synergy.name);
      expect(dump, `${synergy.id} 的因果句漏进了 VM`).not.toContain(synergy.reveal);
    }
    // 配方器官名同样是配方的一半（知道要「狩齿 ＋ 毒腺」就等于知道了这一条）
    for (const organName of ["狩齿", "铁鬃", "毒腺", "雾目", "坚喙"]) {
      expect(dump, `器官名 ${organName} 漏进了 VM`).not.toContain(organName);
    }
  });

  /**
   * 反证：跨世图鉴（`Bloodline.knownSynergyIds`）记得的那一条要**全摊开** ——
   * 哪怕这一世还没凑齐配方。那正是跨世积累买到的东西：知道该去凑什么。
   */
  it("图鉴记得的那一条摊开名号、配方、因果与代价，并写明还差哪件器官", () => {
    const state = secretLife();
    const vm = buildForgeVm(state, TALE_CONTENT, secretPicks(state), [SYN_SUI_GU]);
    const row = vm.lore.find((item) => item.synergyId === SYN_SUI_GU);
    expect(row?.known).toBe(true);
    expect(row?.name).toBe("碎骨");
    expect(row?.recipe).toBe("狩齿 ＋ 坚喙 ＋ 铁鬃");
    expect(row?.reveal).toBe("齿咬定、喙贯骨、鬃承它的反扑 —— 三件缺一件都不敢这么打。");
    expect(row?.effect).toContain("伤 9〜15");
    expect(row?.effect).toContain("顿挫·下合只守");
    expect(row?.effect).toContain("冷却 6 合");
    expect(row?.cost).toBe("习得 猛之精气 29 · 槽 1");
    // 差的那一件要点名（「尚缺」而不是「不可用」）
    expect(row?.enabled).toBe(false);
    expect(row?.disabledReason).toBe("尚缺 坚喙");
    // 别的九条仍然一个字都不漏
    const others = JSON.stringify(vm.lore.filter((item) => item.synergyId !== SYN_SUI_GU));
    for (const synergy of SYNERGIES.filter((item) => item.id !== SYN_SUI_GU)) {
      expect(others, synergy.id).not.toContain(synergy.name);
    }
  });
});

describe("buildForgeVm：招式册那几行", () => {
  /**
   * 「这一手是我自己拼的」与「这一手是照古法习得的」在屏幕上必须分得开 ——
   * 那是这一批的情绪落点（自拟招是玩家的东西），也是他下一世还想不想再拼一手的理由。
   */
  it("自拟招印「凝」并写得出三件部件与已付的精气；古法印「古」", () => {
    const forged = forgeSkill(lifeWith(FIVE_PARTS), TALE_CONTENT, PROTO_PICKS, "长风");
    const learned = learnLore(forged, TALE_CONTENT, SYN_KUI_YAO);
    const vm = buildForgeVm(learned, TALE_CONTENT, PROTO_PICKS, [SYN_KUI_YAO]);

    expect(vm.slotLine).toBe("招式册 2／4");
    const [own, lore] = vm.forged;

    expect(own?.glyph).toBe("凝");
    expect(own?.name).toBe("长风");
    // 三件部件写在那一行上 —— 玩家隔了半世回来还认得出这一手是怎么来的
    expect(own?.source).toBe("齿·鬃·毒");
    expect(own?.paid).toBe("已付 猛之精气 18");
    expect(own?.effect).toContain("附毒·数合不起势");
    expect(own?.effect).toContain("冷却 3 合");
    expect(own?.effect).toContain("耗势 3");

    expect(lore?.glyph).toBe("古");
    expect(lore?.name).toBe("溃咬");
    expect(lore?.source).toBe("溃咬");
    expect(lore?.paid).toBe("已付 猛之精气 26");

    // 已在册的那一条古法在货架上写「已在册中」，而不是又一次「可习得」
    expect(vm.lore.find((row) => row.synergyId === SYN_KUI_YAO)?.disabledReason).toBe("已在册中");
  });
});
