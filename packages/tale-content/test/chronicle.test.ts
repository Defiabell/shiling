/**
 * 列传模板的分支覆盖 —— 用真引擎的 `composeChronicle` 渲染各种「一世」。
 *
 * 冒烟测试只能撞到玩出来的那几种组合（多半是德行平平的战死／寿终），而列传是玩家一世
 * 结束后**唯一读到的评语**：8 段赞语里若有一段永远选不中，或某个结局段落里有个写错的占位，
 * 玩家不会报 bug，只会觉得「这游戏的文字很敷衍」。所以这里按 de × ending 把矩阵铺开渲染。
 */

import { describe, expect, it } from "vitest";
import {
  composeChronicle,
  createLife,
  type EndingType,
  type TaleState,
  type WayId,
} from "@shiling/tale-sim";
import { CHRONICLE_TEMPLATES, SEED_CHANG_TAI, TALE_CONTENT } from "../src/index.js";

const ENDINGS: readonly EndingType[] = ["starve", "slain", "oldage", "ascend"];
const DE_LEVELS = [0, 5, 20, 42, 70];

/**
 * 造一具「刚死的」状态：真出生记录 ＋ 几条中段素材 ＋ 指定德行与结局。
 *
 * [2026-08-13] `ending: "ascend"` 时必须同时给出**哪条道**（`wayAchieved`）：四条道的
 * ending 都是 `ascend`，结语与赞语按道分，不给就退回泛用兜底那一段。
 */
function deadLife(ending: EndingType, de: number, way: WayId = "shen"): TaleState {
  const born = createLife(4321, SEED_CHANG_TAI, TALE_CONTENT);
  return {
    ...born,
    year: 12,
    season: 2,
    alive: false,
    ending,
    wayAchieved: ending === "ascend" ? way : null,
    stats: { ...born.stats, de, ling: 30 },
    organIds: [...born.organIds, "gou-chi", "wu-mu"],
    records: [
      ...born.records,
      { year: 3, season: 1, kind: "molt", text: "蛰伏一季，蜕生狩齿。", refId: "gou-chi" },
      { year: 5, season: 0, kind: "combat", text: "搏杀草狐，食其精气。", refId: "cao-hu" },
      { year: 9, season: 2, kind: "molt", text: "蛰伏一季，蜕生雾目。", refId: "wu-mu" },
      { year: 12, season: 2, kind: "death", text: "力尽，横死于青丘荒野。" },
    ],
  };
}

describe("列传模板", () => {
  it("四结局 × 五档德行都渲染得出，且不留占位", () => {
    for (const ending of ENDINGS) {
      for (const de of DE_LEVELS) {
        const entry = composeChronicle(deadLife(ending, de), TALE_CONTENT);
        expect(entry.body, `${ending}/de=${de} 有漏填占位`).not.toMatch(/\{\{\w+\}\}/);
        expect(entry.title).toBe("食灵列传·常胎");
        expect(entry.ending).toBe(ending);
        expect(entry.body.startsWith("食灵者")).toBe(true);
        // 成道走 wayEndings 那一段（`endings.ascend` 只是兜底，正常路径读不到）
        expect(entry.body).toContain(
          ending === "ascend"
            ? CHRONICLE_TEMPLATES.wayEndings.shen
            : CHRONICLE_TEMPLATES.endings[ending],
        );
        expect(entry.body).toContain(CHRONICLE_TEMPLATES.praisePrefix);
      }
    }
  });

  it("中段按史记笔法编年摘录（蜕变与搏杀都入传）", () => {
    const body = composeChronicle(deadLife("oldage", 30), TALE_CONTENT).body;
    expect(body).toContain("三岁夏，蛰伏一季，蜕生狩齿。");
    expect(body).toContain("五岁春，搏杀草狐，食其精气。");
    // 开篇总账要把一世的数字说清楚
    expect(body).toContain("凡历十二岁");
    expect(body).toContain("蜕二");
    expect(body).toContain("杀一");
  });

  /**
   * 数字体例：列传正文是史记笔法，**一个阿拉伯数字都不许有**。
   *
   * 这条是 B5 修的真 bug：模板原来写 `凡历{{years}}岁，成器官{{organCount}}，蜕{{moltCount}}，
   * 杀{{killCount}}`，实测渲染出「凡历4岁，成器官2，蜕1，杀3」—— 报表话摆在正文里。
   * 阿拉伯数字只留给界面上要横向比对的量值（状态栏属性／饱食／精气），不在这个文件里。
   * 断言写成「全文扫描」而不是逐句比对：以后谁在任何一段模板里塞回一个裸占位都会红。
   */
  it("列传正文一律汉字数字（史书体，不许出现阿拉伯数字）", () => {
    for (const ending of ENDINGS) {
      for (const de of DE_LEVELS) {
        const body = composeChronicle(deadLife(ending, de), TALE_CONTENT).body;
        expect(body, `${ending}/de=${de} 正文里出现了阿拉伯数字`).not.toMatch(/\d/);
      }
    }
  });

  /**
   * 零值另有措辞：「蜕〇，杀〇」「凡历〇岁」是机器在说话，一句就破掉整段文气
   * （死亡屏的摘要早为此专门写了零值措辞，列传不能自成一套）。
   */
  it("未蜕形／未杀生／未及一岁三种零值都有专门措辞", () => {
    const born = createLife(99, SEED_CHANG_TAI, TALE_CONTENT);
    const stillborn: TaleState = {
      ...born,
      year: 0,
      alive: false,
      ending: "slain",
      records: [...born.records, { year: 0, season: 1, kind: "death", text: "力尽，横死于青丘荒野。" }],
    };
    const body = composeChronicle(stillborn, TALE_CONTENT).body;
    expect(body).toContain("未及一岁");
    expect(body).toContain("未尝蜕形");
    expect(body).toContain("未尝杀生");
    expect(body).not.toContain("〇");
    // 中段的出生那一行同样不许出现「0岁」
    expect(body).toContain("初岁");
  });

  it("赞语真的按德行与结局分支（至少 4 段变体能被选中）", () => {
    const praises = new Set<string>();
    for (const ending of ENDINGS) {
      for (const de of DE_LEVELS) {
        const body = composeChronicle(deadLife(ending, de), TALE_CONTENT).body;
        const lines = body.split("\n");
        praises.add(lines[lines.length - 1] ?? "");
      }
    }
    expect(praises.size, `只选中了 ${praises.size} 段赞语`).toBeGreaterThanOrEqual(4);
  });

  it("登神＋厚德是最高一档评语，寡德横死是最低一档", () => {
    const saintly = composeChronicle(deadLife("ascend", 70, "shen"), TALE_CONTENT).body;
    expect(saintly).toContain("与云气同流");
    const brute = composeChronicle(deadLife("slain", 0), TALE_CONTENT).body;
    expect(brute).toContain("青丘无为之惜者");
  });

  /**
   * [2026-08-13] 四条道各有自己的结语与赞语 —— 这一条是这一批最要紧的断言之一。
   *
   * 尤其归山：owner 此前说「最后寿终正寝，让人没有再次玩的欲望」，而奔归山这条道养的一世
   * **寿终就是成道**。若它读到的仍是「终未成器，与草木同朽」那一段（或泛用的登神段），
   * 这一批立起来的东西当场就塌了。
   */
  it("四条道各读到自己的结语与赞语，互不串味", () => {
    const marks: Record<WayId, readonly [string, string]> = {
      shen: ["脱兽籍而列于神班", "与云气同流"],
      yaowang: ["太史氏谓之兽王", "以杀立威"],
      guishan: ["青丘为之寂三日", "此亦成也"],
      hualing: ["风过而散", "一世未饮血"],
    };
    for (const [way, [ending, praise]] of Object.entries(marks) as [WayId, readonly [string, string]][]) {
      const body = composeChronicle(deadLife("ascend", 70, way), TALE_CONTENT).body;
      expect(body, `${way} 的结语`).toContain(ending);
      expect(body, `${way} 的赞语`).toContain(praise);
      // 不串味：别的道的结语一句都不许出现
      for (const [other, [otherEnding]] of Object.entries(marks) as [WayId, readonly [string, string]][]) {
        if (other !== way) expect(body, `${way} 串进了 ${other} 的结语`).not.toContain(otherEnding);
      }
    }
  });

  it("寿终而归山门槛不备时仍是失败结语（oldage 的语义分叉）", () => {
    const failed = composeChronicle(deadLife("oldage", 20), TALE_CONTENT).body;
    expect(failed).toContain("终未成器");
    expect(failed).not.toContain("此亦成也");
  });

  /**
   * 赞语只吃 de 与 ending，所以它**不许断言 de 之外的事实**。
   *
   * 实测踩到过：一世 de 归零但「未尝杀生」（弃卵、见死不救、取人之食都掉德不杀生），
   * 赞语却是「以杀始，以杀终」—— 玩家读到的是史官在瞎写。这条测试把「零杀伐 × 零德行 ×
   * 横死」这个真实组合钉住：全文不许出现任何谈杀伐的字。
   */
  it("零杀伐的一世，赞语不许说它杀过谁", () => {
    const born = createLife(77, SEED_CHANG_TAI, TALE_CONTENT);
    const pacifist: TaleState = {
      ...born,
      year: 4,
      alive: false,
      ending: "slain",
      stats: { ...born.stats, de: 0 },
      records: [...born.records, { year: 4, season: 2, kind: "death", text: "力尽，横死于青丘荒野。" }],
    };
    const body = composeChronicle(pacifist, TALE_CONTENT).body;
    expect(body).toContain("未尝杀生");
    const lines = body.split("\n");
    const praise = lines[lines.length - 1] ?? "";
    expect(praise).not.toMatch(/杀|屠|血食/);
    // de 归零时不写「德〇」（机器话），改说「德无可称」
    expect(body).toContain("德无可称");
    expect(body).not.toContain("德〇");
  });
});
