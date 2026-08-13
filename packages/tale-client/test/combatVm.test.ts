import { describe, expect, it } from "vitest";
import { combatPreview, type CombatState, type TaleContent, type TaleState } from "@shiling/tale-sim";
import { buildCombatVm, recommendCombatActId } from "../src/model/combatVm.js";
import { FIXTURE_CONTENT, combatState, newState, withPatch } from "./helpers.js";

/** 灵蕴神种（fixture）＋雾目 = 带 night-eye，也就是 BASELINE 的 combatIntentTags 之一。 */
const SEER_ORGAN = "wu-mu";

function seeing(state: TaleState): TaleState {
  return withPatch(state, { organIds: [...state.organIds, SEER_ORGAN] });
}

function vm(patch: Partial<CombatState> = {}, state: TaleState = newState()) {
  const combat = combatState(patch);
  return buildCombatVm(withPatch(state, { combat }), combat, FIXTURE_CONTENT);
}

function actionById(actions: ReturnType<typeof vm>["actions"], id: string) {
  return actions.find((action) => action.id === id);
}

/** 造一件带技器官（默认伤害倍率吃 tuning 缺省）。 */
function skillOrgan(id: string, name: string, skill: Record<string, unknown>) {
  return {
    id,
    name,
    slot: "gut" as const,
    affinity: { meng: 0.5 },
    tags: [],
    combatSkill: { name, desc: `试${name}。`, ...skill } as never,
    desc: `试用器官${name}。`,
  };
}

describe("buildCombatVm：血条与基本盘", () => {
  it("敌我血条按各自上限算比率（我方上限＝体）", () => {
    const state = newState();
    const view = vm({ enemyHp: 3, playerHp: 10 }, state);
    expect(view.enemyName).toBe("野雉");
    expect(view.enemyHpMax).toBe(6);
    expect(view.enemyPercent).toBe(50);
    expect(view.playerHpMax).toBe(state.stats.ti);
    expect(view.playerPercent).toBe(50);
  });

  it("血量为负时显示 0 而不是负数", () => {
    const view = vm({ enemyHp: -4 });
    expect(view.enemyHp).toBe(0);
    expect(view.enemyPercent).toBe(0);
  });

  it("我方低于三成判 critical", () => {
    expect(vm({ playerHp: 5 }).playerCritical).toBe(true);
    expect(vm({ playerHp: 12 }).playerCritical).toBe(false);
  });

  /**
   * [M1-P2 行为变更] 悬空 enemyId 从「静默降级」改成**抛错**。
   *
   * M0 的战斗卡只用到敌人的名字与血量，查不到就退回 id 还能画出来。P2 的每颗按钮都要
   * 按敌人的 meng 算受伤与反击，`combatPreview` 在查不到时直接抛（与 `stalkPreview`
   * 同一条纪律：内容 bug 要吵）。而且降级也没有意义 —— 那张卡上每颗按钮一点就会抛。
   * app.ts 的 `safely()` 会把它变成一条可见的报错 ＋ 可恢复的界面。
   */
  it("敌人 id 失效时抛错而不是画一张点不动的卡", () => {
    expect(() => vm({ enemyId: "ghost", enemyHp: 5 })).toThrow(/未知敌人/);
  });
});

describe("buildCombatVm：三颗咬击按钮都写着按下去会发生什么", () => {
  it("每颗按钮的伤害与引擎预览逐字一致（界面不自己算公式）", () => {
    const combat = combatState({ enemyId: "qiong-qi-you", enemyHp: 40, guardPart: "eye" });
    const state = withPatch(newState(), { combat });
    const preview = combatPreview(state, FIXTURE_CONTENT);
    const view = buildCombatVm(state, combat, FIXTURE_CONTENT);
    for (const bite of preview.bites) {
      const button = actionById(view.actions, `bite:${bite.part}`);
      // 抖动开着时按钮写真实两端（「伤 4〜8」），退化成一点时写一个数 —— 两种都要与引擎对得上
      const shown =
        bite.damage.min === bite.damage.max
          ? String(bite.damage.mid)
          : `${bite.damage.min}〜${bite.damage.max}`;
      expect(button?.effect, bite.part).toContain(`伤 ${shown}`);
    }
  });

  it("咬腿写明「它迟滞 N 合」、扑眼写明「它盲 N 合」，咬喉不写附带", () => {
    const view = vm({ enemyId: "qiong-qi-you", enemyHp: 40, guardPart: "throat" });
    expect(actionById(view.actions, "bite:leg")?.effect).toContain("迟滞");
    expect(actionById(view.actions, "bite:eye")?.effect).toContain("盲");
    expect(actionById(view.actions, "bite:throat")?.effect).not.toContain("盲");
  });

  it("打在守备处的那颗按钮挂警告，写清减半与反击概率", () => {
    const view = vm({ enemyId: "qiong-qi-you", enemyHp: 40, guardPart: "throat" });
    const throat = actionById(view.actions, "bite:throat");
    expect(throat?.warning).toContain("咽喉");
    expect(throat?.warning).toContain("减半");
    expect(throat?.warning).toContain("反咬");
    expect(actionById(view.actions, "bite:leg")?.warning).toBeNull();
  });

  it("它要走时，咬腿那颗按钮的警告变成「拦住它」", () => {
    const view = vm(
      {
        enemyId: "qiong-qi-you",
        enemyHp: 8,
        guardPart: "eye",
        intent: { kind: "flee", text: "它想走。" },
      },
      seeing(newState()),
    );
    expect(actionById(view.actions, "bite:leg")?.warning).toContain("拦住它");
  });
});

describe("buildCombatVm：姿态与器官技", () => {
  it("当前姿态不出按钮（换成已在的姿态只是白费一合，引擎那边直接抛错）", () => {
    const view = vm({ stance: "low" });
    expect(actionById(view.actions, "stance:low")).toBeUndefined();
    expect(actionById(view.actions, "stance:square")).toBeDefined();
    expect(actionById(view.actions, "stance:lunge")).toBeDefined();
    expect(view.stanceLabel).toBe("伏低");
  });

  it("姿态按钮写清出伤/受伤倍率，并提醒「占一合」", () => {
    const low = actionById(vm().actions, "stance:low");
    expect(low?.effect).toContain("出伤 ×0.75");
    expect(low?.effect).toContain("受伤 ×0.7");
    expect(low?.warning).toContain("占一合");
  });

  it("没有战技器官时没有技能按钮（不是灰按钮 —— 那一世根本没有这一手）", () => {
    expect(vm().actions.filter((action) => action.group === "skill")).toHaveLength(0);
  });

  it("有战技器官时按钮显示技名、伤害、效果与冷却", () => {
    const armed = withPatch(newState(), { organIds: [...newState().organIds, "gou-chi"] });
    const button = actionById(vm({}, armed).actions, "skill:gou-chi");
    expect(button?.label).toBe("撕咬");
    expect(button?.effect).toContain("伤 ");
    expect(button?.effect).toContain("冷却");
    expect(button?.enabled).toBe(true);
  });

  it("冷却中的技按钮置灰并说还要等几合（引擎那边会抛错，界面必须先挡住）", () => {
    const armed = withPatch(newState(), { organIds: [...newState().organIds, "gou-chi"] });
    const button = actionById(vm({ skillCooldowns: { "gou-chi": 2 } }, armed).actions, "skill:gou-chi");
    expect(button?.enabled).toBe(false);
    expect(button?.disabledReason).toBe("还需 2 合");
    // VM 仍如实保留这一手的效果（界面在置灰时用 disabledReason 顶掉它，见 playScreen）
    expect(button?.effect).toContain("冷却");
  });
});

describe("buildCombatVm：守备、形势与遁走", () => {
  it("守备部位对谁都可见（它不是器官奖励，是眼前的事实）", () => {
    expect(vm({ guardPart: "throat" }).guardLabel).toBe("护 咽喉");
    expect(vm({ guardPart: "leg" }).guardLabel).toBe("护 后腿");
    expect(vm({ guardPart: "eye" }).guardLabel).toBe("护 眼");
  });

  it("形势一行给「还撑得住几合／它还需几下」，撑不住两合就转朱砂", () => {
    const healthy = vm({ enemyId: "qiong-qi-you", enemyHp: 40 });
    expect(healthy.outlook).toMatch(/还撑得住约 \d+ 合 · 它还需 \d+ 下/);
    expect(healthy.outlookHot).toBe(false);
    expect(vm({ enemyId: "qiong-qi-you", enemyHp: 40, playerHp: 6 }).outlookHot).toBe(true);
  });

  it("场上的状态挂成小牌（它半盲／它迟滞／护体）", () => {
    expect(vm({ blind: 2, slow: 1, ward: 1 }).marks).toEqual([
      "它半盲 2 合",
      "它迟滞 1 合",
      "护体 1 合",
    ]);
    expect(vm().marks).toEqual([]);
  });

  it("遁走按钮报成功率，并明说走脱了也吃不到", () => {
    const flee = actionById(vm().actions, "flee");
    expect(flee?.effect).toMatch(/成 .+/);
    expect(flee?.warning).toContain("精气与饱食都没有");
  });
});

describe("buildCombatVm：读不出意图时不许泄露意图", () => {
  it("没有洞察类器官 → 只给粗档两字 ＋ 一句「读不出来」", () => {
    const view = vm({ intent: { kind: "pounce", text: "它压低身子，重心后坐。" } });
    expect(view.intentKnown).toBe(false);
    expect(view.intentLabel).toBe("似要动手");
    expect(view.intentLabel).not.toContain("压低");
    expect(view.intentDetail).toMatch(/读得清|读不出来/);
  });

  it("「守」与「逃」在粗档里分不出来（那正是洞察要买的东西）", () => {
    const guarding = vm({ intent: { kind: "guard", text: "它护住要害。" } });
    const fleeing = vm({
      enemyHp: 2,
      intent: { kind: "flee", text: "它想走。" },
    });
    expect(guarding.intentLabel).toBe("按兵不动");
    expect(fleeing.intentLabel).toBe("按兵不动");
    expect(guarding.intentDetail).toBe(fleeing.intentDetail);
  });

  /**
   * 这一条是全文件最要紧的断言：`incomingDamage` 那一族数**能反推出意图**
   * （0 ＝ 它在守或要走，13 ＝ 重击）。若界面照报，洞察类器官就白给了 ——
   * 而这种泄露不会有任何别的测试变红。
   */
  it("读不出意图时，屏幕上不出现任何受伤数字（它会反推出意图）", () => {
    const pouncing = vm({
      enemyId: "qiong-qi-you",
      enemyHp: 40,
      guardPart: "eye",
      intent: { kind: "pounce", text: "它要扑。" },
    });
    const guarding = vm({
      enemyId: "qiong-qi-you",
      enemyHp: 40,
      guardPart: "eye",
      intent: { kind: "guard", text: "它守着。" },
    });
    for (const view of [pouncing, guarding]) {
      expect(view.intentDetail).not.toMatch(/受伤/);
      for (const action of view.actions) {
        // 「受伤 ×0.7」这种**倍率**不算泄露（它与意图无关）；绝对伤害数才算
        expect(action.effect, action.id).not.toMatch(/受伤 \d/);
        expect(action.effect, action.id).not.toMatch(/这合受伤/);
      }
    }
    // 反证：同一局面带上洞察，这些数就该出现
    const known = vm(
      {
        enemyId: "qiong-qi-you",
        enemyHp: 40,
        guardPart: "eye",
        intent: { kind: "pounce", text: "它要扑。" },
      },
      seeing(newState()),
    );
    expect(known.intentDetail).toContain("受伤");
    expect(actionById(known.actions, "bite:eye")?.effect).toMatch(/受伤 \d/);
    expect(actionById(known.actions, "stance:low")?.effect).toContain("这合受伤");
  });

  it("带洞察 → 读到内容写的那句话 ＋ 重击／预计受伤", () => {
    const view = vm(
      {
        enemyId: "qiong-qi-you",
        enemyHp: 40,
        intent: { kind: "pounce", text: "它压低身子，重心后坐。" },
      },
      seeing(newState()),
    );
    expect(view.intentKnown).toBe(true);
    expect(view.intentLabel).toBe("它压低身子，重心后坐。");
    expect(view.intentDetail).toContain("重击");
    expect(view.intentHot).toBe(true);
  });
});

describe("recommendCombatActId：同一时刻只推荐一手（链在 tale-sim，这里只验按钮 id 映射）", () => {
  it("任何局面下都恰好一颗按钮发金光", () => {
    const cases: Partial<CombatState>[] = [
      {},
      { guardPart: "throat" },
      { intent: { kind: "pounce", text: "扑。" } },
      { intent: { kind: "guard", text: "守。" } },
      { enemyHp: 2, intent: { kind: "flee", text: "走。" } },
      { playerHp: 4 },
      { blind: 2 },
      { stance: "low" },
    ];
    for (const patch of cases) {
      for (const state of [newState(), seeing(newState())]) {
        const view = vm({ enemyId: "qiong-qi-you", enemyHp: 40, ...patch }, state);
        const hot = view.actions.filter((action) => action.highlight);
        expect(hot.length, `${JSON.stringify(patch)}：${hot.map((a) => a.id).join("/")}`).toBe(1);
      }
    }
  });

  /**
   * [S1] 同一条不变式，**在技能池满员的局面下**再跑一遍。
   *
   * 上面那八个 case 用的都是 fixture 的裸 state（一个技都没有）—— 而这一批的头条改动
   * 恰恰是把技能池从 1 颗按钮扩到 5〜8 颗。池子里混着「冷却中」「精气不够」的技时，
   * 推荐链有没有可能一颗都不亮（全被过滤掉）、或亮两颗（技与咬同时命中），
   * 那八个 case 一条都答不上来。
   */
  it("技能池满员（含冷却中与付不起的技）时，仍恰好一颗发金光", () => {
    const content: TaleContent = {
      ...FIXTURE_CONTENT,
      organs: [
        ...FIXTURE_CONTENT.organs,
        skillOrgan("s-burst", "爆发技", {}),
        skillOrgan("s-venom", "附毒技", { effects: ["venom"] }),
        skillOrgan("s-costly", "精气技", {
          damageMul: 0,
          effects: ["insight"],
          cost: { kind: "essence", type: "lin", amount: 40 },
        }),
        skillOrgan("s-bolt", "脱身技", { damageMul: 0, effects: ["bolt"] }),
      ],
      synergies: [
        {
          id: "syn-pool",
          name: "试组合",
          organIds: ["s-burst", "s-venom"],
          kind: "skill" as const,
          reveal: "两件凑齐，自有其理。",
          desc: "试组合之说。",
          skill: { name: "试组合", desc: "两件凑齐。", effects: ["stun" as const], damageMul: 2.6, cooldown: 5 },
        },
      ],
    };
    const cases: Partial<CombatState>[] = [
      {},
      { skillCooldowns: { "s-burst": 2, "syn:syn-pool": 3 } },
      { intent: { kind: "pounce", text: "扑。" } },
      { playerHp: 4 },
      { enemyHp: 2 },
      { bleed: 2, slow: 1, insight: 2 },
    ];
    const base = newState();
    const armed = withPatch(base, {
      organIds: [...base.organIds, "s-burst", "s-venom", "s-costly", "s-bolt"],
      essence: { zu: 0, lin: 0, xue: 0, meng: 0 },
    });
    for (const patch of cases) {
      const combat = combatState({ enemyId: "qiong-qi-you", enemyHp: 40, ...patch });
      const view = buildCombatVm(withPatch(armed, { combat }), combat, content);
      // 池子确实是满的（4 颗器官技 ＋ 1 颗组合技），不是「碰巧只有一颗」
      expect(view.actions.filter((action) => action.group === "skill")).toHaveLength(5);
      const hot = view.actions.filter((action) => action.highlight);
      expect(hot.length, `${JSON.stringify(patch)}：${hot.map((a) => a.id).join("/")}`).toBe(1);
    }
  });

  it("能一下打死它就打（不劝人在赢面前逃走）", () => {
    const combat = combatState({ enemyId: "ye-zhi", enemyHp: 2, guardPart: "eye", playerHp: 3 });
    const state = withPatch(newState(), { combat });
    expect(recommendCombatActId(combatPreview(state, FIXTURE_CONTENT))).toBe("bite:throat");
  });

  /**
   * 这条链的第一版把「逃」排在 `roundsToLive <= 1`，200 世实测战死率从 M0 的 8.5% 飙到 33.5%
   * —— 界面在劝玩家送死。判据放在这里：撑不过两合就该走。
   */
  it("撑不过两合且逃得掉 → 推荐遁走", () => {
    const combat = combatState({ enemyId: "qiong-qi-you", enemyHp: 40, guardPart: "eye", playerHp: 6 });
    const base = newState();
    // 灵性 50 才逃得掉穷奇（fleeBias 16）：逃不掉的时候链条会改推扑眼买两合，见下一条
    const state = withPatch(base, { combat, stats: { ...base.stats, ling: 50 } });
    expect(recommendCombatActId(combatPreview(state, FIXTURE_CONTENT))).toBe("flee");
  });

  it("撑不过两合但逃不掉（穷奇 fleeBias 高）→ 改推扑眼买两合，而不是硬送", () => {
    const combat = combatState({ enemyId: "qiong-qi-you", enemyHp: 40, guardPart: "eye", playerHp: 6 });
    const state = withPatch(newState(), { combat });
    expect(recommendCombatActId(combatPreview(state, FIXTURE_CONTENT))).toBe("bite:eye");
  });

  it("它要走且自己还撑得住 → 推荐咬腿拦住", () => {
    const combat = combatState({
      enemyId: "qiong-qi-you",
      enemyHp: 8,
      guardPart: "eye",
      intent: { kind: "flee", text: "它想走。" },
    });
    const state = seeing(withPatch(newState(), { combat }));
    expect(recommendCombatActId(combatPreview(state, FIXTURE_CONTENT))).toBe("bite:leg");
  });

  it("读不出意图时，粗档「按兵不动」也按「它可能要走」处置（拦一手比丢一顿肉便宜）", () => {
    const combat = combatState({
      enemyId: "qiong-qi-you",
      enemyHp: 40,
      guardPart: "eye",
      intent: { kind: "guard", text: "它守着。" },
    });
    const bare = withPatch(newState(), { combat });
    expect(recommendCombatActId(combatPreview(bare, FIXTURE_CONTENT))).toBe("bite:leg");
    /*
     * 同一局面读得出意图 → 知道它只是在守，于是**不是**为了拦逃而咬腿，而是为了钝它的势
     * （长仗、迟滞落得下来）。两者按钮相同、理由不同；理由的差别在下面这条上才看得出来。
     */
    const known = seeing(bare);
    expect(recommendCombatActId(combatPreview(known, FIXTURE_CONTENT))).toBe("bite:leg");
  });

  it("它在守、而迟滞还挂着（咬腿这一手落不下来）→ 那一合拿去换姿态", () => {
    const combat = combatState({
      enemyId: "qiong-qi-you",
      enemyHp: 40,
      guardPart: "eye",
      slow: 2,
      intent: { kind: "guard", text: "它守着。" },
    });
    const known = seeing(withPatch(newState(), { combat }));
    expect(recommendCombatActId(combatPreview(known, FIXTURE_CONTENT))).toBe("stance:lunge");
  });
});

/*
 * ===== S1 技能池：五到八颗按钮，每颗都摊开后果 =====
 *
 * 这一组守的是「验收第③问」：有没有哪颗按钮点下去才知道会发生什么。
 * 不可用的那些尤其要守 —— 它们此前是「原因顶掉后果」。
 */

/** fixture 里带一件自定义技的 content（`probe`），可指定效果、冷却、代价。 */
function withSkill(skill: Record<string, unknown>): TaleContent {
  return {
    ...FIXTURE_CONTENT,
    organs: [
      ...FIXTURE_CONTENT.organs,
      {
        id: "probe",
        name: "试器",
        slot: "gut" as const,
        affinity: { meng: 0.5 },
        tags: [],
        combatSkill: skill as never,
        desc: "试。",
      },
    ],
  };
}

function skillButton(content: TaleContent, patch: Partial<CombatState> = {}, statePatch: Partial<TaleState> = {}) {
  const base = newState();
  const state = withPatch({ ...base, ...statePatch }, {
    organIds: [...base.organIds, "probe"],
    combat: combatState({ enemyId: "qiong-qi-you", enemyHp: 40, guardPart: "eye", ...patch }),
  });
  const view = buildCombatVm(state, state.combat!, content);
  return view.actions.find((action) => action.id === "skill:probe");
}

describe("S1 技能池：每颗技能按钮都写清伤害、效果、冷却与代价", () => {
  it("四项恒在：伤害区间 · 效果 · 冷却 · 代价", () => {
    const content = withSkill({
      name: "试技",
      desc: "。",
      effects: ["venom"],
      cooldown: 3,
      cost: { kind: "hp", amount: 2 },
    });
    const button = skillButton(content);
    expect(button?.effect).toContain("伤 ");
    expect(button?.effect).toContain("附毒");
    expect(button?.effect).toContain("冷却 3 合");
    expect(button?.effect).toContain("自伤 2");
  });

  it("不出伤的技明说「不出伤」（而不是留白让玩家猜）", () => {
    const content = withSkill({
      name: "垂雾",
      desc: "。",
      effects: ["insight"],
      damageMul: 0,
      cooldown: 3,
      cost: { kind: "essence", type: "lin", amount: 8 },
    });
    const button = skillButton(content);
    expect(button?.effect).toContain("不出伤");
    expect(button?.effect).toContain("明识");
    expect(button?.effect).toContain("鳞精气 8");
  });

  it("精气不够时置灰，原因写清缺哪一型、要多少（这一架里等不到，得去猎）", () => {
    const content = withSkill({
      name: "垂雾",
      desc: "。",
      effects: ["insight"],
      damageMul: 0,
      cost: { kind: "essence", type: "lin", amount: 8 },
    });
    const button = skillButton(content, {}, { essence: { zu: 0, lin: 3, xue: 0, meng: 0 } });
    expect(button?.enabled).toBe(false);
    expect(button?.disabledReason).toContain("鳞精气不足");
    expect(button?.disabledReason).toContain("8");
  });

  /**
   * S1 之前不可用时是「原因**顶掉**后果」。技能池只有一颗按钮时无所谓，
   * 现在有五到八颗：一颗只写「还需 2 合」的按钮，玩家既不知道它是什么，
   * 也就没法决定「要不要留着它收官」。
   */
  it("冷却中**照样**写清后果，原因只是多一行", () => {
    const content = withSkill({ name: "试技", desc: "。", effects: ["stun"], cooldown: 3, cost: { kind: "hp", amount: 2 } });
    const button = skillButton(content, { skillCooldowns: { probe: 2 } });
    expect(button?.enabled).toBe(false);
    expect(button?.disabledReason).toBe("还需 2 合");
    expect(button?.effect).toContain("顿挫");
    expect(button?.effect).toContain("冷却 3 合");
  });

  it("组合技带「异」印与因果一句，器官技不带（那次发现不能白发现）", () => {
    const content: TaleContent = {
      ...FIXTURE_CONTENT,
      synergies: [
        {
          id: "test-syn",
          name: "试组合",
          organIds: ["gou-chi", "wu-mu"],
          kind: "skill" as const,
          reveal: "齿咬开的口子，正好是毒进得去的地方。",
          desc: "两件凑齐。",
          skill: {
            name: "溃咬",
            desc: "咬住不松，把腺里的东西全挤进伤口。",
            effects: ["venom" as const],
            damageMul: 2.6,
            cooldown: 4,
            cost: { kind: "hp" as const, amount: 3 },
          },
        },
      ],
    };
    const base = newState();
    const state = withPatch(base, {
      organIds: [...base.organIds, "gou-chi", "wu-mu"],
      combat: combatState({ enemyId: "qiong-qi-you", enemyHp: 40, guardPart: "eye" }),
    });
    const view = buildCombatVm(state, state.combat!, content);
    const combo = view.actions.find((action) => action.id === "skill:syn:test-syn");
    const organSkill = view.actions.find((action) => action.id === "skill:gou-chi");
    expect(combo?.synergy).toBe(true);
    expect(combo?.glyph).toBe("异");
    // 组合技的那一行给的是**这一手是什么**（技自己的描述）—— 它走 `flavor` 而不是
    // `warning`：后者的语义是「按下去会有这个后果，注意」，两种东西不共用一个字段
    expect(combo?.flavor).toContain("把腺里的东西全挤进伤口");
    expect(combo?.warning).toBeNull();
    expect(organSkill?.synergy).toBe(false);
    expect(organSkill?.glyph).toBe("技");
    expect(organSkill?.warning).toBeNull();
    expect(organSkill?.flavor).toBeNull();
  });

  it("三个新计数器也挂成小牌（看不见的状态等于不存在）", () => {
    expect(vm({ bleed: 2, thorns: 1, insight: 3 }).marks).toEqual([
      "它流血 2 合",
      "反刺 1 合",
      "明识 3 合",
    ]);
  });

  it("明识期间读得出意图（不必有洞察器官）—— 它是那几件器官的临时替身", () => {
    const view = vm({ insight: 2, intent: { kind: "pounce", text: "它压低身子。" } });
    expect(view.intentKnown).toBe(true);
    expect(view.intentLabel).toContain("压低");
  });
});
