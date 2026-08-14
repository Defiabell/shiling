/**
 * [S3] 血统元进度的引擎侧专测 —— 「跨世积累变成真进度」那四类消费的引擎那一半。
 *
 * 这一批新增的机制有五块，逐块钉：
 * 1. **三份价目表**（`chartCost`／`loreCost`／`SigilDef.cost`）：规则算出来的，不是手抄的。
 * 2. **世家印记**：statMods 与起手饱食落账、上限截断、未知抛错，且**一骰不掷**
 *    （同一颗种子带不带印记，天时／出身／rngState 逐字相同）。
 * 3. **图录**：`destinationUnlocked` 的第二条通路 —— 免门槛、**不免路费**。
 * 4. **图鉴知识**：`stalkPreview.alertVisible` 与 `combatPreview.intentKnown` 的新来源，
 *    且它**只改预览、不改任何结算**（同一条种子跑两遍，带与不带的终态逐字相同）。
 * 5. **照面记录**（`metEnemyIds`）：起追与开战两处都记、幂等、不改入参。
 */

import { describe, expect, it } from "vitest";
import {
  chartCost,
  combatPreview,
  createLife,
  destinationPreview,
  loreCost,
  performAction,
  sigilById,
  stalkAct,
  stalkPreview,
  type SigilDef,
  type TaleContent,
  type TaleState,
} from "../src/index.js";
import {
  DEST_FAR,
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  FIXTURE_SEED_ID,
  NEAR,
  ORGAN_JI_ZU,
  contentWithoutEvents,
  makeContent,
} from "./fixtures.js";

const SIGIL_MENG: SigilDef = {
  id: "sigil-test-meng",
  name: "试印·爪",
  desc: "测试用。",
  cost: 6,
  statMods: { meng: 2 },
};
const SIGIL_TI: SigilDef = {
  id: "sigil-test-ti",
  name: "试印·骨",
  desc: "测试用。",
  cost: 6,
  statMods: { ti: 4 },
};
const SIGIL_FOOD: SigilDef = {
  id: "sigil-test-shi",
  name: "试印·食",
  desc: "测试用。",
  cost: 6,
  statMods: {},
  hungerBonus: 12,
};

const QUIET = contentWithoutEvents();
/** 遇袭必中的一份内容（远地只有穷奇）—— 「开战」这条路要可控地走得到 */
const AMBUSH = contentWithoutEvents({
  tuning: {
    explorePeril: {
      ...contentWithoutEvents().tuning.explorePeril,
      grim: { ambushChance: 1, travelCost: 0, eventMul: 1 },
    },
  },
});
const WITH_SIGILS = contentWithoutEvents({ sigils: [SIGIL_MENG, SIGIL_TI, SIGIL_FOOD] });
/** 上限 2 枚的一份内容 —— 「至多三枚」这条规则本身要可测，不能靠真内容的 3 撞运气 */
const CAP_TWO = contentWithoutEvents({
  sigils: [SIGIL_MENG, SIGIL_TI, SIGIL_FOOD],
  tuning: { sigilCap: 2 },
});

function life(content: TaleContent = QUIET, seed = 7): TaleState {
  return createLife(seed, FIXTURE_SEED_ID, content);
}

describe("三份价目表（规则算出来的，不是手抄的）", () => {
  it("图录：2×门槛件数 ＋ 风险档；**无门槛的恒 0**（兽径不上货架的判据就在这里）", () => {
    // 远地：一件门槛 ＋ grim（2）＝ 2×1 + 2 = 4
    expect(chartCost(DEST_FAR, QUIET)).toBe(4);
    // 近野无门槛 → 0，界面据此把它排除出货架（不写第二条 if）
    expect(chartCost(NEAR.destinationId, QUIET)).toBe(0);
  });

  it("图录：门槛件数与风险档各自单调（越难到的地方那张图越贵）", () => {
    const twoGates = makeContent({
      destinations: QUIET.destinations.map((def) =>
        def.id === DEST_FAR ? { ...def, requiresOrganIds: [ORGAN_JI_ZU, "wu-mu"] } : def,
      ),
    });
    expect(chartCost(DEST_FAR, twoGates)).toBeGreaterThan(chartCost(DEST_FAR, QUIET));
    const calmFar = makeContent({
      destinations: QUIET.destinations.map((def) =>
        def.id === DEST_FAR ? { ...def, peril: "calm" as const } : def,
      ),
    });
    expect(chartCost(DEST_FAR, calmFar)).toBeLessThan(chartCost(DEST_FAR, QUIET));
  });

  it("图鉴知识：底价 ＋ floor(猛/10)，越凶越贵", () => {
    // 野雉 meng 4 → 2 + 0；穷奇 meng 30 → 2 + 3
    expect(loreCost(ENEMY_YE_ZHI, QUIET)).toBe(2);
    expect(loreCost(ENEMY_QIONG_QI, QUIET)).toBe(5);
    expect(loreCost(ENEMY_QIONG_QI, QUIET)).toBeGreaterThan(loreCost(ENEMY_YE_ZHI, QUIET));
  });

  it("两份价目表对未知 id 一律抛错（脏存档要吵，不许静默按最便宜的算）", () => {
    expect(() => chartCost("dest-nope", QUIET)).toThrow(/未知去处/);
    expect(() => loreCost("enemy-nope", QUIET)).toThrow(/未知异兽/);
  });

  it("sigilById：认得的返回 def，不认得的返回 null", () => {
    expect(sigilById(WITH_SIGILS, SIGIL_MENG.id)?.name).toBe("试印·爪");
    expect(sigilById(WITH_SIGILS, "sigil-nope")).toBeNull();
  });
});

describe("世家印记（唯一的永久数值加成）", () => {
  it("statMods 在**神种之前**落账，且照样进寿限的算式", () => {
    const bare = life(WITH_SIGILS);
    const marked = createLife(7, FIXTURE_SEED_ID, WITH_SIGILS, { sigilIds: [SIGIL_TI.id] });
    expect(marked.stats.ti).toBe(bare.stats.ti + 4);
    // lifespanMax = lifespanBase + floor(ti/10)：ti +4 不一定换来整年，但绝不会变少
    expect(marked.lifespanMax).toBeGreaterThanOrEqual(bare.lifespanMax);
  });

  it("`hungerBonus` 那一枚加在起手饱食上（照样吃 hungerMax 的上限）", () => {
    const bare = life(WITH_SIGILS);
    const fed = createLife(7, FIXTURE_SEED_ID, WITH_SIGILS, { sigilIds: [SIGIL_FOOD.id] });
    expect(fed.hunger).toBe(Math.min(WITH_SIGILS.tuning.hungerMax, bare.hunger + 12));
  });

  it("多枚叠加；重复的那一枚只算一次", () => {
    const both = createLife(7, FIXTURE_SEED_ID, WITH_SIGILS, {
      sigilIds: [SIGIL_MENG.id, SIGIL_TI.id, SIGIL_MENG.id],
    });
    const bare = life(WITH_SIGILS);
    expect(both.stats.meng).toBe(bare.stats.meng + 2);
    expect(both.stats.ti).toBe(bare.stats.ti + 4);
  });

  it("超过 `sigilCap` 的静默截断（上限是平衡阀，不该让手改过的旧档开不了局）", () => {
    const bare = life(CAP_TWO);
    const over = createLife(7, FIXTURE_SEED_ID, CAP_TWO, {
      sigilIds: [SIGIL_MENG.id, SIGIL_TI.id, SIGIL_FOOD.id],
    });
    expect(over.stats.meng).toBe(bare.stats.meng + 2);
    expect(over.stats.ti).toBe(bare.stats.ti + 4);
    // 第三枚（起手饱食）被截掉了
    expect(over.hunger).toBe(bare.hunger);
  });

  it("未知印记 id 抛错（内容 bug／脏存档要吵）", () => {
    expect(() => createLife(7, FIXTURE_SEED_ID, WITH_SIGILS, { sigilIds: ["sigil-nope"] })).toThrow(
      /未知世家印记/,
    );
  });

  it("**一骰不掷**：带不带印记，天时／出身／rngState 逐字相同", () => {
    const bare = life(WITH_SIGILS);
    const marked = createLife(7, FIXTURE_SEED_ID, WITH_SIGILS, {
      sigilIds: [SIGIL_MENG.id, SIGIL_FOOD.id],
    });
    expect(marked.rngState).toBe(bare.rngState);
    expect(marked.skyId).toBe(bare.skyId);
    expect(marked.originId).toBe(bare.originId);
    expect(marked.organIds).toEqual(bare.organIds);
  });
});

describe("图录（免门槛，不免路费）", () => {
  it("带着图录 → 门槛未凑齐也进得去", () => {
    const charted = createLife(7, FIXTURE_SEED_ID, QUIET, { chartedDestinationId: DEST_FAR });
    expect(() =>
      performAction(charted, "explore", QUIET, { destinationId: DEST_FAR }),
    ).not.toThrow();
    // 对照：同一世不带图录就是「尚未开启」
    expect(() => performAction(life(), "explore", QUIET, { destinationId: DEST_FAR })).toThrow(
      /尚未开启/,
    );
  });

  it("图录只开这一处，别处照样要门槛", () => {
    const charted = createLife(7, FIXTURE_SEED_ID, QUIET, { chartedDestinationId: NEAR.destinationId });
    expect(() => performAction(charted, "explore", QUIET, { destinationId: DEST_FAR })).toThrow(
      /尚未开启/,
    );
  });

  it("**路费照扣** —— 三档风险是「往哪走」这道题的另一半，图录不许把它一起买断", () => {
    const charted = createLife(7, FIXTURE_SEED_ID, QUIET, { chartedDestinationId: DEST_FAR });
    const before = charted.hunger;
    const after = performAction(charted, "explore", QUIET, { destinationId: DEST_FAR }).state;
    const t = QUIET.tuning;
    // 季耗 ＋ grim 路费，一分都不少（春天没有冬季加扣）
    expect(before - after.hunger).toBe(t.hungerPerSeason + t.explorePeril.grim.travelCost);
  });

  it("预览的 `chartedOpen` 只在**门槛没凑齐**时为真（凑齐了就不是图录的功劳）", () => {
    const charted = createLife(7, FIXTURE_SEED_ID, QUIET, { chartedDestinationId: DEST_FAR });
    expect(destinationPreview(charted, QUIET, DEST_FAR).chartedOpen).toBe(true);
    expect(destinationPreview(charted, QUIET, DEST_FAR).unlocked).toBe(true);

    const alsoOwns = { ...charted, organIds: [...charted.organIds, ORGAN_JI_ZU] };
    expect(destinationPreview(alsoOwns, QUIET, DEST_FAR).chartedOpen).toBe(false);
    expect(destinationPreview(alsoOwns, QUIET, DEST_FAR).unlocked).toBe(true);
  });

  it("未知图录 id 抛错", () => {
    expect(() =>
      createLife(7, FIXTURE_SEED_ID, QUIET, { chartedDestinationId: "dest-nope" }),
    ).toThrow(/未知图录去处/);
  });
});

describe("图鉴知识（买到的是信息，不是加成）", () => {
  /** 起一场对野雉的追猎（`hunt` 那一步只把猎物摆上来，不推进季）。 */
  function stalking(content: TaleContent, lore: readonly string[] = []): TaleState {
    const born = createLife(7, FIXTURE_SEED_ID, content, { loreEnemyIds: lore });
    return performAction(born, "hunt", content).state;
  }

  it("已参透 → 追猎屏读得出确切警觉（`alertVisible`），并说得出**为什么**（`loreKnown`）", () => {
    const blind = stalking(QUIET);
    expect(stalkPreview(blind, QUIET).alertVisible).toBe(false);
    expect(stalkPreview(blind, QUIET).loreKnown).toBe(false);

    const known = stalking(QUIET, [ENEMY_YE_ZHI]);
    expect(known.stalk?.preyId).toBe(ENEMY_YE_ZHI);
    expect(stalkPreview(known, QUIET).alertVisible).toBe(true);
    expect(stalkPreview(known, QUIET).loreKnown).toBe(true);
  });

  it("参透的是**别的**兽 → 这一头照旧读不出", () => {
    const other = stalking(QUIET, [ENEMY_QIONG_QI]);
    expect(stalkPreview(other, QUIET).alertVisible).toBe(false);
    expect(stalkPreview(other, QUIET).loreKnown).toBe(false);
  });

  it("已参透 → 搏杀屏读得出确切意图（`intentKnown`）", () => {
    /*
     * 走**遇袭**那条路开战（把条件概率钉成 1），而不是「追猎失手转搏杀」——
     * 后者要猎物 `retaliates`，而 fixture 的野雉不反扑，那条断言会静默变成空跑。
     */
    const fight = (lore: readonly string[]): TaleState => {
      const born = createLife(7, FIXTURE_SEED_ID, AMBUSH, {
        loreEnemyIds: lore,
        chartedDestinationId: DEST_FAR,
      });
      return performAction(born, "explore", AMBUSH, { destinationId: DEST_FAR }).state;
    };
    const blind = fight([]);
    expect(blind.combat?.enemyId).toBe(ENEMY_QIONG_QI);
    expect(combatPreview(blind, AMBUSH).intentKnown).toBe(false);
    expect(combatPreview(blind, AMBUSH).loreKnown).toBe(false);

    const known = fight([ENEMY_QIONG_QI]);
    expect(known.combat?.enemyId).toBe(ENEMY_QIONG_QI);
    expect(combatPreview(known, AMBUSH).intentKnown).toBe(true);
    expect(combatPreview(known, AMBUSH).loreKnown).toBe(true);
  });

  it("**只改预览、不改结算**：同一颗种子同一串动作，带与不带图鉴知识的终态逐字相同", () => {
    const run = (lore: readonly string[]): TaleState => {
      let state = createLife(31, FIXTURE_SEED_ID, QUIET, { loreEnemyIds: lore });
      for (let i = 0; i < 8 && state.alive; i += 1) {
        if (state.stalk) {
          state = stalkAct(state, i % 2 === 0 ? "creep" : "pounce", QUIET).state;
          continue;
        }
        if (state.combat) break;
        state = performAction(state, i % 3 === 0 ? "hunt" : "rest", QUIET).state;
      }
      return state;
    };
    const bare = run([]);
    const known = run([ENEMY_YE_ZHI, ENEMY_QIONG_QI]);
    // 唯一允许不同的就是这一份投影本身
    expect({ ...known, loreEnemyIds: [] }).toEqual({ ...bare, loreEnemyIds: [] });
  });

  it("未知图鉴异兽 id 抛错", () => {
    expect(() => createLife(7, FIXTURE_SEED_ID, QUIET, { loreEnemyIds: ["enemy-nope"] })).toThrow(
      /未知图鉴异兽/,
    );
  });
});

describe("照面记录（图鉴「已识异兽」的唯一来源）", () => {
  it("起追即记（追丢了也数 —— 你确确实实盯着它看了几息）", () => {
    const born = life();
    expect(born.metEnemyIds).toEqual([]);
    const hunting = performAction(born, "hunt", QUIET).state;
    expect(hunting.metEnemyIds).toEqual([ENEMY_YE_ZHI]);
  });

  it("开战即记（哪怕第一回合就被咬死）—— 遇袭那条路", () => {
    // 远地只有穷奇，遇袭必中（`AMBUSH` 把条件概率钉成 1）
    const charted = createLife(7, FIXTURE_SEED_ID, AMBUSH, { chartedDestinationId: DEST_FAR });
    const after = performAction(charted, "explore", AMBUSH, { destinationId: DEST_FAR }).state;
    expect(after.combat?.enemyId).toBe(ENEMY_QIONG_QI);
    expect(after.metEnemyIds).toContain(ENEMY_QIONG_QI);
  });

  it("幂等：同一头兽追第二次不重复记", () => {
    let state = performAction(life(), "hunt", QUIET).state;
    while (state.stalk) state = stalkAct(state, "pounce", QUIET).state;
    if (state.combat || !state.alive) return; // 这一次撞上反噬，换一条判据没意义
    const again = performAction(state, "hunt", QUIET).state;
    expect(again.metEnemyIds).toEqual([ENEMY_YE_ZHI]);
  });

  it("不改入参（`draftOf` 拷了这个容器）", () => {
    const born = life();
    performAction(born, "hunt", QUIET);
    expect(born.metEnemyIds).toEqual([]);
  });
});
