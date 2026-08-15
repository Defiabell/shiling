/**
 * 主界面版式的**契约锁**（`styles/screens.css`）。
 *
 * 这一组锁的是 2026-08-14 那次「故事卡被压成一条细缝」的根因，而不是好看不好看：
 * 中央舞台曾经是版式里的**残差** —— `.play` 是 `height: 100vh` 的一屏壳，舞台行写成
 * `minmax(0, 1fr)`，于是状态栏、引导条、行动面板先各取所需，舞台剩多少算多少，
 * 而 `minmax(0, …)` 允许它一路让到零。修复前实测（事件卡在场）：
 *
 *     1440×900 → 舞台 116px    1440×820 → 36px    1280×720 → 8px（卡片高度 0）
 *
 * 实机那一层由 `e2e/layout.py` 的视口矩阵盯（它才量得到「玩家此刻看不看得见抉择」），
 * 但那是要自己起 dev server 的手跑脚本 —— **不在 `pnpm test` 里**。所以把「不许再退回去」
 * 的那几行本身锁在单测里：谁把 `max-height: 100%` 加回 `.card`、或把 `overflow-y: auto`
 * 加回 `.stage`／`.card__body`，舞台行的下限就会重新塌回零，而这里会先红。
 *
 * 断言打在**声明本身**上（不是渲染结果），因为这一层要防的正是「改 CSS 时不知道这几行
 * 是承重墙」。每一条都附着它防的那个具体回归。
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(new URL("../src/styles/screens.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

interface Block {
  /** 所在的媒体查询条件（无则空串） */
  media: string;
  selector: string;
  decls: Record<string, string>;
}

/** 极简 CSS 扫描：够用就好 —— 只要能把「哪个选择器在哪个媒体查询下声明了什么」摊平。 */
function parse(css: string): Block[] {
  const blocks: Block[] = [];
  const media: string[] = [];
  let i = 0;
  let head = "";
  while (i < css.length) {
    const ch = css[i];
    if (ch === "{") {
      const selector = head.trim();
      if (selector.startsWith("@media")) {
        media.push(selector.slice("@media".length).trim());
        head = "";
        i += 1;
        continue;
      }
      // 普通规则：读到配对的 }
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth += 1;
        else if (css[j] === "}") depth -= 1;
        j += 1;
      }
      const body = css.slice(i + 1, j - 1);
      const decls: Record<string, string> = {};
      for (const line of body.split(";")) {
        const at = line.indexOf(":");
        if (at < 0) continue;
        decls[line.slice(0, at).trim()] = line.slice(at + 1).trim();
      }
      for (const one of selector.split(",")) {
        blocks.push({ media: media.join(" && "), selector: one.trim(), decls });
      }
      head = "";
      i = j;
      continue;
    }
    if (ch === "}") {
      media.pop();
      head = "";
      i += 1;
      continue;
    }
    head += ch;
    i += 1;
  }
  return blocks;
}

const BLOCKS = parse(CSS);

function rules(selector: string, media = ""): Block[] {
  return BLOCKS.filter((b) => b.selector === selector && b.media === media);
}

/** 顶层（不在任何媒体查询里）那一条规则 —— 取不到就当场红，不给后面的断言假绿的机会。 */
function base(selector: string): Record<string, string> {
  const found = rules(selector);
  expect(found, `顶层没有 ${selector} 这条规则（解析器坏了？）`).toHaveLength(1);
  return found[0]!.decls;
}

/** 某个选择器在**所有**媒体查询下对某属性的全部声明（用来证明「没有任何一处把它改回去」）。 */
function everywhere(selector: string, prop: string): { media: string; value: string }[] {
  return BLOCKS.flatMap((b) => {
    if (b.selector !== selector) return [];
    const value = b.decls[prop];
    return value === undefined ? [] : [{ media: b.media, value }];
  });
}

describe("主界面版式契约（screens.css）", () => {
  it("解析器能认出 .play 这条规则（自检：解析器坏了下面每一条都会假绿）", () => {
    expect(base(".play")["display"]).toBe("grid");
  });

  describe("舞台行的下限＝卡片本身，不再是零", () => {
    it(".play 的舞台行走 --stage-row，且 --stage-row 的下限是 min-content", () => {
      const play = base(".play");
      expect(play["grid-template-rows"]).toBe("auto var(--stage-row) auto");
      expect(play["--stage-row"]).toMatch(/^minmax\(\s*min-content\s*,/);
    });

    it("引导条在场时（多一行）舞台行仍是同一个 --stage-row", () => {
      // `.play--guided` 那一档正是最容易把舞台挤没的：状态栏 ＋ 引导条 ＋ 行动面板三样一起吃
      for (const block of BLOCKS.filter((b) => b.selector === ".play--guided")) {
        const rows = block.decls["grid-template-rows"];
        if (rows === undefined) continue;
        expect(rows, `.play--guided @media(${block.media}) 的行模板`).toContain("var(--stage-row)");
        expect(rows).not.toContain("minmax(0");
      }
    });

    it("没有任何一处把舞台行写回 minmax(0, 1fr)（那正是压扁的写法）", () => {
      for (const sel of [".play", ".play--guided", ".play--stalk", ".play--combat"]) {
        for (const value of everywhere(sel, "grid-template-rows")) {
          expect(value.value, `${sel} @media(${value.media})`).not.toMatch(/minmax\(\s*0/);
        }
      }
    });
  });

  describe("滚动只发生在整壳这一层（内层一滚，舞台行的下限就塌回零）", () => {
    it(".play 是滚动容器：定高 100vh ＋ 纵向 auto、横向 hidden", () => {
      const play = base(".play");
      expect(play["height"]).toBe("100vh");
      // 两条 longhand（不是 `overflow: hidden auto` 双值简写）：简写在老引擎上整条被丢掉，
      // 而这一行是整个版式最承重的一条 —— 丢掉它就退回「不裁也不滚」，内容溢出且够不到
      expect(play["overflow-y"]).toBe("auto");
      expect(play["overflow-x"]).toBe("hidden");
      expect(play["overflow"]).toBeUndefined();
    });

    it(".play 的高度没有在任何媒体查询里被改回 auto", () => {
      // 曾经的窄屏版式是 `height: auto; min-height: 100vh` ＋ `body { overflow: auto }`，
      // 留着它，滚动容器就失效，行动面板会把舞台重新挤成残差。
      for (const value of everywhere(".play", "height")) {
        expect(value.value, `.play @media(${value.media})`).toBe("100vh");
      }
      expect(everywhere(".play", "min-height")).toHaveLength(0);
      expect(everywhere("body", "overflow")).toHaveLength(0);
    });

    it(".stage 不自己滚（滚动容器对外不贡献内容高度）", () => {
      for (const value of everywhere(".stage", "overflow")) {
        expect(value.value, `.stage @media(${value.media})`).toBe("visible");
      }
      expect(everywhere(".stage", "overflow-y")).toHaveLength(0);
      expect(everywhere(".stage", "overflow-x")).toHaveLength(0);
    });

    it(".card__body 不自己滚（同上，且卡片从此按内容排版）", () => {
      expect(everywhere(".card__body", "overflow-y")).toHaveLength(0);
      expect(everywhere(".card__body", "overflow")).toHaveLength(0);
    });

    it(".card 不再被舞台封顶（max-height: 100% 就是把卡片压成细缝的那一刀）", () => {
      expect(everywhere(".card", "max-height")).toHaveLength(0);
    });

    it("两栏版式下「近事」不参与舞台行的高度计算，单列版式下才由内容定高", () => {
      // 实测（1200×560）：日志攒到八九条时自己就有六百多像素，与卡片同在一行，
      // 于是把舞台行撑高、短卡在居中里被推到折线以下 —— 与压扁同症，推手换成了日志。
      expect(base(".rail")["contain"]).toBe("size");
      expect(everywhere(".rail", "contain")).toEqual([
        { media: "", value: "size" },
        { media: "(max-width: 1080px)", value: "none" },
      ]);
    });
  });

  describe("响应式断点：宽高两个维度都要有（这次的教训是宽度测了、高度没测）", () => {
    const medias = new Set(BLOCKS.map((b) => b.media));

    it("状态栏与四道横带塌成单列的断点是 ≤860（不是 ≤1080）", () => {
      // 1000×477 那扇窗户：单列状态栏量到 348px，三栏只要 156px —— 差的这一档正好是故事卡
      expect(medias.has("(max-width: 860px)")).toBe(true);
      const statusbar = BLOCKS.filter(
        (b) => b.selector === ".statusbar" && b.decls["grid-template-columns"] !== undefined,
      );
      for (const block of statusbar) {
        if (block.media === "") continue;
        expect(block.media, "状态栏的窄屏版").toBe("(max-width: 860px)");
      }
      for (const block of BLOCKS.filter((b) => b.selector === ".ways" && b.media !== "")) {
        expect(block.media, "四道横带的窄屏版").toBe("(max-width: 860px)");
      }
    });

    it("矮窗口有两档：≤800 收插图、≤560 收起插图并压间距", () => {
      expect(medias.has("(max-height: 800px)")).toBe(true);
      expect(medias.has("(max-height: 560px)")).toBe(true);
      const shrink = BLOCKS.find(
        (b) => b.selector === ".card__art" && b.media === "(max-height: 800px)",
      );
      expect(shrink?.decls["max-height"]).toBe("26vh");
      const hide = BLOCKS.find(
        (b) => b.selector === ".card__art" && b.media === "(max-height: 560px)",
      );
      expect(hide?.decls["display"]).toBe("none");
    });

    it("图文并排版式的插图在矮窗口下也收一档（并排时高度是给死的，26vh 那条管不着它）", () => {
      // 并排版式（≥1100 宽）的图位高度写在 `height` 上而不是 `max-height`，
      // 所以它需要**自己**那一条矮窗口规则；漏了它，1280×720 的插图仍是 274px。
      const split = BLOCKS.find(
        (b) =>
          b.selector === ".card--split .card__art" &&
          b.media === "(min-width: 1100px) and (max-height: 800px)",
      );
      expect(split?.decls["height"]).toBe("clamp(150px, 26vh, 340px)");
    });

    it("行动那一排是自适应列数（四颗行动不许再固定挤成两行）", () => {
      expect(base(".actions__row")["grid-template-columns"]).toMatch(/^repeat\(auto-fit/);
    });
  });

  /*
   * [交锋节奏] 逐拍演出的两条承重规则。
   *
   * 它们与上面那几条同一个性质：**改的时候看不出是承重墙**，而坏了不会有任何别的测试变红
   * （VM 照样造得出那一拍的起止值，只是屏幕上不动）。
   */
  describe("逐拍演出", () => {
    it("血条走 `@keyframes` 而不是 `transition` —— 整棵重建之后 transition 播不出来", () => {
      // `renderPlay` 每一拍整棵重建 DOM：新节点身上没有「上一个宽度」，
      // transition 无从过渡。起止值由数据带着（`--hp-from` / `--hp-to`）。
      expect(base(".hp.is-beating .hp__fill")["animation"]).toMatch(/^hp-drain /);
      const css = readFileSync(new URL("../src/styles/fx.css", import.meta.url), "utf8");
      expect(css).toMatch(/@keyframes hp-drain\s*\{[\s\S]*?from\s*\{\s*width:\s*var\(--hp-from\)/);
      expect(css).toMatch(/@keyframes hp-drain\s*\{[\s\S]*?to\s*\{\s*width:\s*var\(--hp-to\)/);
    });

    it("演出中卡片自己不入场 —— 否则整张卡每半秒重新水墨浮现一次", () => {
      expect(base(".card")["animation"]).toMatch(/^ink-rise /);
      expect(base(".card--encounter.is-beating")["animation"]).toBe("none");
    });
  });
});
