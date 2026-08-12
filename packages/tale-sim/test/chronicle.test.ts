import { describe, expect, it } from "vitest";
import {
  SYS_FLAG_ASCEND_READY,
  SYS_FLAG_DIVINE_EATEN,
  WAY_FLAGS,
  bloodlineGain,
  cnNumeral,
  composeChronicle,
  createLife,
  performAction,
  render,
  waysProgress,
  type EndingType,
  type LifeRecord,
  type TaleState,
  type WayId,
} from "../src/index.js";
import {
  ENEMY_YE_ZHI,
  EVENT_MANDATE,
  EVENT_SPROUT,
  FIXTURE_SEED_ID,
  FIXTURE_SEED_ORGAN_ID,
  ORGAN_GOU_CHI,
  ORGAN_WU_MU,
  contentWithoutEvents,
} from "./fixtures.js";

const CONTENT = contentWithoutEvents();

/**
 * 造一个「已经过完」的一世：给定结局、岁数与若干素材记录。
 *
 * [2026-08-13] `livesTaken` 缺省 **1**（「一世总要吃点活的」）—— 缺省 0 会让「化灵」那条道
 * 的「不杀一命」门槛在每一个 fixture 一世里都是达成的，于是每条血统点断言都白拿一分，
 * 而那一分与被测的东西无关。要测化灵就显式传 0（见「化灵」那几条）。
 */
function finishedLife(options: {
  ending: EndingType;
  year?: number;
  de?: number;
  ling?: number;
  livesTaken?: number;
  /** 成道时是哪条道（`ending: "ascend"` 才有意义） */
  way?: WayId;
  extraRecords?: LifeRecord[];
  organIds?: string[];
}): TaleState {
  const base = createLife(1, FIXTURE_SEED_ID, CONTENT);
  return {
    ...base,
    year: options.year ?? 7,
    stats: { ...base.stats, de: options.de ?? 5, ling: options.ling ?? base.stats.ling },
    organIds: options.organIds ?? base.organIds,
    livesTaken: options.livesTaken ?? 1,
    alive: false,
    ending: options.ending,
    wayAchieved: options.ending === "ascend" ? (options.way ?? null) : null,
    records: [...base.records, ...(options.extraRecords ?? [])],
  };
}

const MOLT_RECORD: LifeRecord = {
  year: 2,
  season: 1,
  kind: "molt",
  text: "蛰伏一季，蜕生狩齿。",
  refId: ORGAN_GOU_CHI,
};
const KILL_RECORD: LifeRecord = {
  year: 3,
  season: 2,
  kind: "combat",
  text: "搏杀野雉，食其精气。",
  refId: ENEMY_YE_ZHI,
};
const RARE_EVENT_RECORD: LifeRecord = {
  year: 5,
  season: 3,
  kind: "event",
  text: "白光垂落，天命及身。",
  refId: EVENT_MANDATE,
};
const PLAIN_EVENT_RECORD: LifeRecord = {
  year: 6,
  season: 0,
  kind: "event",
  text: "食了一丛野蓂。",
  refId: EVENT_SPROUT,
};

describe("composeChronicle 前置", () => {
  it("一世未结束时抛错（活着 / ending 为空）", () => {
    const alive = createLife(1, FIXTURE_SEED_ID, CONTENT);
    expect(() => composeChronicle(alive, CONTENT)).toThrow(/尚未结束/);
    expect(() => composeChronicle({ ...alive, alive: false }, CONTENT)).toThrow(/尚未结束/);
  });
});

describe("composeChronicle 输出结构", () => {
  it("含出生、结局与「赞曰」三段", () => {
    const state = finishedLife({ ending: "oldage", extraRecords: [MOLT_RECORD] });
    const entry = composeChronicle(state, CONTENT);
    expect(entry.body).toContain("灵蕴神种降世"); // 出生（birth 记录原文）
    expect(entry.body).toContain("寿数既尽"); // 结局四型之一
    expect(entry.body).toContain("赞曰：");
  });

  it("标题与统计字段按 state 渲染", () => {
    const state = finishedLife({
      ending: "slain",
      year: 11,
      organIds: [FIXTURE_SEED_ORGAN_ID, ORGAN_GOU_CHI, ORGAN_WU_MU],
      extraRecords: [MOLT_RECORD, KILL_RECORD],
    });
    const entry = composeChronicle(state, CONTENT);
    expect(entry.title).toBe("灵蕴神种列传");
    expect(entry.ending).toBe("slain");
    expect(entry.years).toBe(11);
    expect(entry.organCount).toBe(3);
    expect(entry.body).toContain("凡历11岁");
    expect(entry.body).toContain("成器官3");
    expect(entry.body).toContain("蜕1");
    expect(entry.body).toContain("杀1");
  });

  it("四种结局各取自己那段", () => {
    const endings: Record<EndingType, string> = {
      starve: "终以饥馑不振",
      slain: "终为强兽所杀",
      oldage: "寿数既尽",
      ascend: "遂脱兽籍而列神班",
    };
    for (const [ending, snippet] of Object.entries(endings) as [EndingType, string][]) {
      const entry = composeChronicle(finishedLife({ ending }), CONTENT);
      expect(entry.body).toContain(snippet);
    }
  });

  it("中段摘录 molt / combat / once 事件，普通事件不入", () => {
    const state = finishedLife({
      ending: "oldage",
      extraRecords: [MOLT_RECORD, KILL_RECORD, RARE_EVENT_RECORD, PLAIN_EVENT_RECORD],
    });
    const entry = composeChronicle(state, CONTENT);
    expect(entry.body).toContain(MOLT_RECORD.text);
    expect(entry.body).toContain(KILL_RECORD.text);
    expect(entry.body).toContain(RARE_EVENT_RECORD.text);
    expect(entry.body).not.toContain(PLAIN_EVENT_RECORD.text);
  });

  it("中段行用 seasonNames 渲染季节", () => {
    const state = finishedLife({ ending: "oldage", extraRecords: [MOLT_RECORD] });
    const entry = composeChronicle(state, CONTENT);
    expect(entry.body).toContain("2岁夏，蛰伏一季，蜕生狩齿。");
  });

  it("摘录条数受 chronicleMaxExcerpts 限制（birth 不占额度）", () => {
    const many: LifeRecord[] = Array.from({ length: 6 }, (_, index) => ({
      year: index,
      season: 0,
      kind: "combat" as const,
      text: `杀敌第${index}次。`,
      refId: ENEMY_YE_ZHI,
    }));
    const capped = contentWithoutEvents({ tuning: { chronicleMaxExcerpts: 2 } });
    const entry = composeChronicle(
      finishedLife({ ending: "slain", extraRecords: many }),
      capped,
    );
    expect(entry.body).toContain("杀敌第0次。");
    expect(entry.body).toContain("杀敌第1次。");
    expect(entry.body).not.toContain("杀敌第2次。");
    // birth 仍在
    expect(entry.body).toContain("灵蕴神种降世");
  });

  it("找不到 birth 记录时用兜底神种名，不崩", () => {
    const state = finishedLife({ ending: "starve" });
    const orphan: TaleState = { ...state, records: [] };
    const entry = composeChronicle(orphan, CONTENT);
    expect(entry.title).toBe("无名神种列传");
  });
});

describe("composeChronicle 赞语变体", () => {
  it("登神走 ascend 专属赞语", () => {
    const entry = composeChronicle(finishedLife({ ending: "ascend", de: 5 }), CONTENT);
    expect(entry.body).toContain("此其所以为神也");
  });

  it("德高（de≥40）走厚德赞语", () => {
    const entry = composeChronicle(finishedLife({ ending: "oldage", de: 55 }), CONTENT);
    expect(entry.body).toContain("其德厚");
  });

  it("德薄（de≤4）走暴行赞语", () => {
    const entry = composeChronicle(finishedLife({ ending: "slain", de: 2 }), CONTENT);
    expect(entry.body).toContain("其行暴");
  });

  it("都不匹配时走末项兜底", () => {
    const entry = composeChronicle(finishedLife({ ending: "starve", de: 20 }), CONTENT);
    expect(entry.body).toContain("兽之常也");
  });

  it("praise 全都不匹配也退到末项而不是抛错", () => {
    const picky = contentWithoutEvents({
      chronicleTemplates: {
        ...CONTENT.chronicleTemplates,
        praise: [{ id: "impossible", minDe: 200, text: "不可能之赞。" }],
      },
    });
    const entry = composeChronicle(finishedLife({ ending: "oldage", de: 5 }), picky);
    expect(entry.body).toContain("不可能之赞。");
  });
});

describe("render 占位替换", () => {
  it("已知占位替换，未知占位原样保留", () => {
    expect(render("{{a}}与{{b}}", { a: "甲", b: 2 })).toBe("甲与2");
    expect(render("{{a}}与{{missing}}", { a: "甲" })).toBe("甲与{{missing}}");
  });

  it("`|cn` 把数字渲染成汉字（列传的史书体靠这一支笔）", () => {
    expect(render("凡历{{years|cn}}岁", { years: 4 })).toBe("凡历四岁");
    expect(render("凡历{{years|cn}}岁", { years: 12 })).toBe("凡历十二岁");
    expect(render("{{n|cn}}", { n: 0 })).toBe("〇");
    expect(render("{{n|cn}}", { n: 20 })).toBe("二十");
    // 字符串值不该被当数字处理，原样输出
    expect(render("{{s|cn}}", { s: "常胎" })).toBe("常胎");
  });

  it("未知格式化器与未知占位同待遇：原样保留，不静默退回未格式化的值", () => {
    // 静默降级会让「模板写错」看起来像「数字风格没生效」——最难查的一类
    expect(render("{{n|roman}}", { n: 4 })).toBe("{{n|roman}}");
    expect(render("{{missing|cn}}", {})).toBe("{{missing|cn}}");
    // 原型链上的名字也必须算「未知」（对象查表会把 constructor 当成一个能调的格式化器）
    expect(render("{{n|constructor}}", { n: 4 })).toBe("{{n|constructor}}");
    expect(render("{{n|toString}}", { n: 4 })).toBe("{{n|toString}}");
  });

  it("超出 0〜99 的数退回阿拉伯数字（列传里「一百二十」不如 120 好读）", () => {
    expect(render("{{n|cn}}", { n: 120 })).toBe("120");
    expect(render("{{n|cn}}", { n: -3 })).toBe("-3");
  });

  it("条件段：非零留内层、零去掉，`^` 反之", () => {
    const tpl = "{{#kill}}，杀{{kill|cn}}{{/kill}}{{^kill}}，未尝杀生{{/kill}}";
    expect(render(tpl, { kill: 3 })).toBe("，杀三");
    expect(render(tpl, { kill: 0 })).toBe("，未尝杀生");
    // 空字符串同样算「无」
    expect(render("{{#s}}有{{/s}}{{^s}}无{{/s}}", { s: "" })).toBe("无");
  });

  it("条件段的 key 未知时整段原样保留（内容 bug 要看得见）", () => {
    expect(render("{{#nope}}甲{{/nope}}", {})).toBe("{{#nope}}甲{{/nope}}");
  });

  it("同一模板里多个条件段互不串味", () => {
    const tpl = "{{#a}}A{{/a}}{{#b}}B{{/b}}{{^a}}a{{/a}}";
    expect(render(tpl, { a: 1, b: 0 })).toBe("A");
    expect(render(tpl, { a: 0, b: 1 })).toBe("Ba");
  });
});

describe("cnNumeral", () => {
  it("0〜9 单字、10〜19 以「十」起、整十不带尾数", () => {
    expect(cnNumeral(0)).toBe("〇");
    expect(cnNumeral(7)).toBe("七");
    expect(cnNumeral(10)).toBe("十");
    expect(cnNumeral(11)).toBe("十一");
    expect(cnNumeral(30)).toBe("三十");
    expect(cnNumeral(99)).toBe("九十九");
  });

  it("越界与非有限数退回阿拉伯数字", () => {
    expect(cnNumeral(100)).toBe("100");
    expect(cnNumeral(-1)).toBe("-1");
    expect(cnNumeral(Number.NaN)).toBe("NaN");
  });

  it("小数向下取整（岁数一律取整年）", () => {
    expect(cnNumeral(4.9)).toBe("四");
  });
});

describe("bloodlineGain 四来源（M1-P2 加了「距登神多近」）", () => {
  /*
   * `finishedLife` 缺省是 year 7／de 5／单器官／ling 13 —— 四条登神门槛（15 岁／5 器官／
   * ling 60／de 40）**一条都没达成**，所以下面这些只量前三项的断言不受第四项干扰。
   * 第四项自己的断言在本 describe 末尾，逐条把门槛顶上去。
   */
  const gain = (state: TaleState): number => bloodlineGain(state, CONTENT);

  it("什么都没做则为 0", () => {
    expect(gain(finishedLife({ ending: "starve", year: 3 }))).toBe(0);
  });

  it("每次蜕变 +1", () => {
    const state = finishedLife({
      ending: "starve",
      year: 3,
      extraRecords: [MOLT_RECORD, { ...MOLT_RECORD, year: 3 }],
    });
    expect(gain(state)).toBe(2);
  });

  it("每满 10 岁 +1", () => {
    expect(gain(finishedLife({ ending: "oldage", year: 9 }))).toBe(0);
    expect(gain(finishedLife({ ending: "oldage", year: 10 }))).toBe(1);
    // 25 岁：2 个十年 ＋ 已过 15 岁那条登神门槛（第四项）
    expect(gain(finishedLife({ ending: "oldage", year: 25 }))).toBe(3);
  });

  /**
   * [2026-08-13] 成道那一笔按**道**给（`tuning.wayBloodline`），不再是固定 +3：
   * 四条道的难度不一样，同一个 +3 会让「哪条道都一样」。
   */
  it("成道按道加权，其余结局无此项", () => {
    for (const way of ["shen", "yaowang", "guishan", "hualing"] as const) {
      expect(gain(finishedLife({ ending: "ascend", way, year: 3 }))).toBe(
        CONTENT.tuning.wayBloodline[way],
      );
    }
    expect(gain(finishedLife({ ending: "slain", year: 3 }))).toBe(0);
    // 四条给的不是同一个数（否则「按道加权」这句话是空的）
    expect(new Set(Object.values(CONTENT.tuning.wayBloodline)).size).toBeGreaterThan(1);
  });

  it("四来源叠加", () => {
    const state = finishedLife({
      ending: "ascend",
      way: "shen",
      year: 21,
      extraRecords: [MOLT_RECORD, { ...MOLT_RECORD, year: 4 }, { ...MOLT_RECORD, year: 9 }],
    });
    // 3 蜕变 ＋ 2 个十年 ＋ 4 登神成道 ＋ 0 条门槛（最接近的是归山，寿 21／25 与德 5／60 都没到）
    expect(gain(state)).toBe(3 + 2 + CONTENT.tuning.wayBloodline.shen);
  });

  it("击杀不计入血统点", () => {
    const state = finishedLife({
      ending: "slain",
      year: 5,
      extraRecords: [KILL_RECORD, { ...KILL_RECORD, year: 4 }],
    });
    expect(gain(state)).toBe(0);
  });

  it("事件赠予的器官也算蜕变（同为 molt 记录）", () => {
    const state = finishedLife({
      ending: "oldage",
      year: 2,
      extraRecords: [
        { year: 1, season: 0, kind: "molt", text: "身内又生狩齿。", refId: ORGAN_GOU_CHI },
      ],
    });
    expect(gain(state)).toBe(1);
  });

  /**
   * 第四项存在的理由（计划 P2「血统结算按距登神多近加权」，2026-08-13 改按**最接近的那条道**）：
   * 让「差一点」也算数。
   *
   * 为什么不是四条道求和：化灵的「不杀一命」在降世那一刻就是达成的，求和等于每一世白拿
   * 一分，也把「差一点」稀释掉。按最接近的那条算，读法才与死亡屏那句差距报告一致。
   */
  it("最接近那条道每达成一条门槛 +1（同寿同蜕变，走得更近的那一世给得更多）", () => {
    // 寿 18／25、德 5／60：归山最接近，一条也没达成
    const plain = finishedLife({ ending: "oldage", year: 18 });
    expect(gain(plain)).toBe(1);
    // 德挣到 60 → 归山的德那条达成（寿还差七岁）
    const closer: TaleState = { ...plain, stats: { ...plain.stats, de: 60 } };
    expect(gain(closer)).toBe(1 + 1);
    // 寿也到 25 → 归山两条全达（活着的话就该成道了）
    const almost: TaleState = { ...closer, year: 25 };
    expect(gain(almost)).toBe(2 + 2);
    expect(gain(almost)).toBeGreaterThan(gain(plain));
  });

  it("门槛全满但没成道，也比什么都没做的同龄人高", () => {
    const wasted = finishedLife({ ending: "oldage", year: 18 });
    const ready: TaleState = { ...wasted, stats: { ...wasted.stats, de: 62 } };
    expect(gain(ready) - gain(wasted)).toBe(1);
  });

  it("一世不杀的那条道也进得了这一项（化灵：不杀一命本身就是一条门槛）", () => {
    const pacifist = finishedLife({ ending: "starve", year: 4, livesTaken: 0 });
    // 化灵：不杀一命达成、灵还差 → 最接近的是化灵，metCount 1
    expect(waysProgress(pacifist, CONTENT).nearest).toBe("hualing");
    expect(gain(pacifist)).toBe(1);
    // 夺过一命 → 化灵已闭，它不再是「最接近的那条」
    const hunter: TaleState = { ...pacifist, livesTaken: 1 };
    expect(waysProgress(hunter, CONTENT).nearest).not.toBe("hualing");
    expect(gain(hunter)).toBe(0);
  });
});

describe("waysProgress（主界面横带与死亡屏差距报告共用一份判据）", () => {
  it("四条道按固定顺序给出，各自的门槛也定序", () => {
    const progress = waysProgress(finishedLife({ ending: "oldage", year: 9 }), CONTENT);
    expect(progress.ways.map((way) => way.id)).toEqual(["shen", "yaowang", "guishan", "hualing"]);
    expect(progress.ways.map((way) => way.gates.map((gate) => gate.id))).toEqual([
      ["ling", "de", "divine"],
      ["lives", "meng"],
      ["year", "de"],
      ["ling", "nokill"],
    ]);
  });

  it("`min` 门槛的 have／need／short 都是原始数值", () => {
    const state = finishedLife({ ending: "oldage", year: 9, de: 5 });
    const guishan = waysProgress(state, CONTENT).ways.find((way) => way.id === "guishan");
    const [year, de] = guishan?.gates ?? [];
    expect(year).toMatchObject({
      bound: "min",
      have: 9,
      need: CONTENT.tuning.wayGuishanYear,
      met: false,
      short: CONTENT.tuning.wayGuishanYear - 9,
    });
    expect(de?.short).toBe(CONTENT.tuning.wayGuishanDe - 5);
  });

  /**
   * `max` 那一档只有「不杀一命」用得上，但它必须是**数据里的一位**而不是特例分支：
   * 用 `min` 硬套（need 0、have 0）的话，任何 `have >= need` 的通用判定都会把「已夺三命」
   * 判成达标 —— 而那正是化灵这条道唯一的本钱。
   */
  it("`nokill` 是 max 类门槛：short 读作「已夺几命」，破了就 lost", () => {
    const clean = finishedLife({ ending: "starve", year: 2, livesTaken: 0 });
    const hualingClean = waysProgress(clean, CONTENT).ways.find((way) => way.id === "hualing");
    expect(hualingClean?.gates[1]).toMatchObject({ bound: "max", have: 0, need: 0, met: true, short: 0 });
    expect(hualingClean?.lost).toBe(false);

    const bloodied: TaleState = { ...clean, livesTaken: 3 };
    const hualingBlood = waysProgress(bloodied, CONTENT).ways.find((way) => way.id === "hualing");
    expect(hualingBlood?.gates[1]).toMatchObject({ met: false, short: 3 });
    expect(hualingBlood?.lost).toBe(true);
    // 别的道没有 max 门槛，永远不会「闭」
    for (const way of waysProgress(bloodied, CONTENT).ways) {
      if (way.id !== "hualing") expect(way.lost).toBe(false);
    }
  });

  it("已闭的道不参与「最接近」的竞争", () => {
    // 灵 71／72 差一点、但已夺一命 → 化灵接近度最高却已闭，nearest 不能是它
    const state = finishedLife({ ending: "starve", year: 1, ling: 71, livesTaken: 1 });
    const progress = waysProgress(state, CONTENT);
    const hualing = progress.ways.find((way) => way.id === "hualing");
    // 灵那一条几乎满（71／门槛），可另一条门槛破了 → 接近度仍是四条里最高的
    const others = progress.ways.filter((way) => way.id !== "hualing");
    expect(hualing?.closeness).toBeGreaterThan(Math.max(...others.map((way) => way.closeness)));
    expect(progress.nearest).not.toBe("hualing");
  });

  it("某条道全满 → readyIds 含它，且与引擎挂的 WAY_FLAGS 同进同退", () => {
    const born = createLife(1, FIXTURE_SEED_ID, CONTENT);
    const ready: TaleState = {
      ...born,
      hunger: 80,
      stats: { ...born.stats, ling: CONTENT.tuning.wayShenLing, de: CONTENT.tuning.wayShenDe },
      flags: [...born.flags, SYS_FLAG_DIVINE_EATEN],
    };
    expect(waysProgress(ready, CONTENT).readyIds).toContain("shen");
    // 走一个回合让引擎重算 flag：进度说 ready，flag 就必须亮
    const after = performAction(ready, "rest", CONTENT).state;
    expect(after.flags).toContain(SYS_FLAG_ASCEND_READY);
    expect(after.flags).toContain(WAY_FLAGS.shen);
    expect(waysProgress(after, CONTENT).readyIds).toContain("shen");
  });

  it("死亡后仍算得出进度（差距报告是在死亡屏上读的）", () => {
    const dead = finishedLife({ ending: "oldage", year: 12 });
    const guishan = waysProgress(dead, CONTENT).ways.find((way) => way.id === "guishan");
    expect(guishan?.gates[0]?.short).toBe(CONTENT.tuning.wayGuishanYear - 12);
  });
});
