/**
 * 神种选择屏（同时也是转世后的落点）。
 *
 * 两块内容：可选神种（含血统点解锁）＋前世列传目录。放在同一屏是有意的 ——
 * 转世的动机来自「上一世发生了什么」，把列传目录摆在选种旁边，血统点的花销就有了叙事重量。
 */

import { el } from "../dom.js";
import { inkArt } from "../art/placeholders.js";
import { seedArt } from "../art/assets.js";
import { ENDING_LABELS, formatCountCn, formatYearCn } from "../model/format.js";
import type { BoonRowVm, CodexVm, SeedCardVm, SeedScreenVm, SynergyRowVm } from "../model/seedVm.js";
import type { EndingType } from "@shiling/tale-sim";

export interface SeedProps {
  vm: SeedScreenVm;
  onChoose(seedId: string): void;
  onUnlock(seedId: string): void;
  /** [S1] 买「血脉」：花血统点让下一世起手自带这件器官 */
  onBuyBoon(organId: string): void;
  onBack(): void;
}

function seedCard(card: SeedCardVm, props: SeedProps): HTMLElement {
  const action =
    card.lock === "unlocked"
      ? el("button", {
          class: "btn btn--seal seedcard__go",
          text: "承此种降世",
          attrs: { type: "button", "data-seed": card.id },
          on: { click: () => props.onChoose(card.id) },
        })
      : el("button", {
          class: `btn btn--ghost seedcard__go${card.lock === "locked" ? " is-locked" : ""}`,
          text: card.lock === "affordable" ? `以血统 ${card.cost} 解开` : `血统 ${card.cost}（尚差 ${card.shortfall}）`,
          attrs: {
            type: "button",
            disabled: card.lock === "locked",
            "data-unlock": card.id,
          },
          on: { click: () => props.onUnlock(card.id) },
        });

  /*
   * 神种卡的图：B4 没画神种专用图，但三枚神种的对象本身都有成图（常胎＝幼兽立绘、
   * 白泽遗种＝「白泽问路」、应龙遗种＝「垂死应龙」），零积分复用同一个对象的画。
   * 立绘是 3:4 竖构图，塞进 4:3 的卡首图位要靠 `contain` 整幅显示（cover 会切掉头）。
   */
  const art = seedArt(card.id);
  const portraitFit = art !== null && art.includes("/portraits/");
  return el("article", { class: `seedcard is-${card.lock}` }, [
    el("figure", { class: "seedcard__art" }, [
      el("img", {
        class: portraitFit ? "is-contained" : undefined,
        attrs: { src: art ?? inkArt("seed", card.id, { width: 1024, height: 768 }), alt: "" },
      }),
      el("span", { class: "card__art-veil" }),
    ]),
    el("div", { class: "seedcard__body" }, [
      el("h2", { class: "seedcard__name", text: card.name }),
      el("p", { class: "seedcard__desc", text: card.desc }),
      el("div", { class: "seedcard__organ", title: card.organTags.join(" · ") }, [
        el("div", { class: "seedcard__organ-head" }, [
          el("span", { class: "seedcard__slot", text: "神" }),
          el("b", { text: card.organName }),
          card.combatSkillName
            ? el("em", { class: "seedcard__skill", text: `战技 · ${card.combatSkillName}` })
            : null,
        ]),
        el("p", { class: "seedcard__organ-desc", text: card.organDesc }),
        // 只展示中文可读的一次性加成；`organTags` 是引擎钩子的英文 id，不给玩家看
        // （需要它的地方由抉择门槛以中文器官名呈现）。
        card.statMods.length > 0
          ? el(
              "div",
              { class: "seedcard__chips" },
              card.statMods.map((mod) => el("span", { class: "chip chip--mod", text: mod })),
            )
          : null,
      ]),
      action,
    ]),
  ]);
}

function chronicleRow(
  entry: SeedScreenVm["chronicle"][number],
  index: number,
): HTMLElement {
  const ending = entry.ending as EndingType;
  return el("details", { class: `pastlife pastlife--${ending}` }, [
    el("summary", { class: "pastlife__head" }, [
      el("span", { class: "pastlife__idx", text: `第${formatYearCn(index + 1)}世` }),
      el("b", { class: "pastlife__title", text: entry.title }),
      // 前传目录跟列传正文同一套数字体例（汉字）——同一行里不并置两种数字
      el("span", {
        class: "pastlife__meta",
        text: `${formatYearCn(entry.years)}岁 · 器官${formatCountCn(entry.organCount)}`,
      }),
      el("em", { class: "pastlife__ending", text: ENDING_LABELS[ending] ?? entry.ending }),
    ]),
    el(
      "div",
      { class: "pastlife__body" },
      entry.body
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => el("p", { text: line.trim() })),
    ),
  ]);
}

/**
 * [S1] 图鉴一行。
 *
 * 未发现的那一行**只渲染一个「？」**：不给 id、不给件数、不给任何 title —— 从 DOM 里
 * 也读不出配方（这一批的全部本钱是「意料之外」，而 devtools 是玩家伸手就能开的东西）。
 */
function synergyRow(row: SynergyRowVm): HTMLElement {
  if (!row.known) {
    return el("li", { class: "codex__row is-unknown", attrs: { "data-synergy": "unknown" } }, [
      el("b", { class: "codex__name", text: "？" }),
      el("em", { class: "codex__note", text: row.note }),
    ]);
  }
  return el("li", { class: "codex__row is-known", attrs: { "data-synergy": row.id ?? "" } }, [
    el("div", { class: "codex__head" }, [
      el("span", { class: "codex__seal", text: "异" }),
      el("b", { class: "codex__name", text: row.name }),
      el("span", { class: "codex__recipe", text: row.recipe }),
    ]),
    el("em", { class: "codex__effect", text: row.effect }),
    el("p", { class: "codex__note", text: row.note }),
  ]);
}

/** [S1] 血脉一行：一件已发现过的器官 ＋ 标价。买不起就置灰**并写清还差多少**。 */
function boonRow(row: BoonRowVm, props: SeedProps): HTMLElement {
  return el("li", { class: `boon__row${row.chosen ? " is-chosen" : ""}` }, [
    el("div", { class: "boon__main" }, [
      el("b", { class: "boon__name", text: row.name }),
      el("span", { class: "boon__meta", text: row.meta }),
      row.skillName ? el("em", { class: "boon__skill", text: `战技 · ${row.skillName}` }) : null,
    ]),
    el("button", {
      class: `btn btn--ghost boon__buy${row.chosen ? " is-chosen" : ""}`,
      text: row.chosen
        ? "下一世自带"
        : row.shortfall > 0
          ? `血统 ${row.cost}（尚差 ${row.shortfall}）`
          : `以血统 ${row.cost} 带上`,
      attrs: {
        type: "button",
        disabled: row.chosen || !row.affordable,
        "data-boon": row.organId,
      },
      on: { click: () => props.onBuyBoon(row.organId) },
    }),
  ]);
}

/**
 * [S1] 「异变图鉴 ＋ 血脉」那一段。
 *
 * 摆在神种卡**之后**、前传之前：它回答的是「这一世我要带什么、去凑什么」，
 * 而那是选完神种之后的问题。血统点此前只能解锁神种（三枚共 13 点，花完永久无处可花），
 * 这一段就是它的第二个去处。
 */
function codexSection(codex: CodexVm, props: SeedProps): HTMLElement {
  return el("section", { class: "seed__codex", attrs: { "data-codex": "1" } }, [
    el("div", { class: "seed__codex-head" }, [
      el("h2", { text: "异　变" }),
      el("span", { attrs: { "data-codex-count": "1" }, text: codex.caption }),
    ]),
    el("p", {
      class: "seed__codex-lede",
      text: "某几件器官凑在一处会生出新的一手。配方不载于图鉴 —— 凑齐的那一刻自会知道。",
    }),
    el("ul", { class: "codex__list" }, codex.rows.map(synergyRow)),
    el("div", { class: "seed__boon" }, [
      el("div", { class: "seed__boon-head" }, [
        el("h3", { text: "血　脉" }),
        el("span", {
          text:
            codex.chosenBoonName === null
              ? "花血统点，让下一世起手自带一件已见过的器官（一世只带一件）"
              : `下一世自带　${codex.chosenBoonName} —— 一世只带一件，这一世的血脉已定`,
        }),
      ]),
      codex.boonEmptyNote !== null
        ? el("p", { class: "seed__boon-empty", text: codex.boonEmptyNote })
        : el("ul", { class: "boon__list" }, codex.boons.map((row) => boonRow(row, props))),
    ]),
  ]);
}

export function renderSeedSelect(props: SeedProps): HTMLElement {
  const { vm } = props;
  return el("div", { class: "screen screen--seed" }, [
    el("header", { class: "seed__head" }, [
      el("div", {}, [
        el("h1", { class: "seed__title", text: "择　神　种" }),
        el("p", {
          class: "seed__lede",
          text: "神种是食灵入世的凭据，也是这一世的第一枚器官。它给的那点偏向，会一路长进你的形貌里。",
        }),
      ]),
      el("div", { class: "seed__points" }, [
        el("span", { text: "血统" }),
        el("b", { text: String(vm.points), attrs: { "data-points": "1" } }),
      ]),
    ]),
    /*
     * [2026-08-13] 「此世天时」预告 ＋ 「换条路试试」。
     *
     * 摆在神种卡**之前**：这一屏原本只有三张卡，于是第二局就是从同一个起点再来一次。
     * 天时与出身能提前显示，是因为引擎 `rollPremise(seedNum)` 是纯函数、且降世时那两次
     * 抽取恒在最前 —— 界面不掷骰，只是提前问了同一个答案（选哪枚神种因此成了一道
     * 有前提的题：旱年该不该挑那枚偏灵的种）。
     */
    el("section", { class: "nextlife", attrs: { "data-nextlife": "1" } }, [
      el("b", { class: "nextlife__caption", text: vm.next.caption }),
      el("div", { class: "nextlife__omens" }, [
        el("span", { class: "nextlife__omen", attrs: { "data-omen": vm.next.skyName } }, [
          el("b", { text: vm.next.skyName }),
          el("em", { text: vm.next.skyEffect }),
        ]),
        el("span", { class: "nextlife__omen", attrs: { "data-omen": vm.next.originName } }, [
          el("b", { text: vm.next.originName }),
          el("em", { text: vm.next.originEffect }),
        ]),
      ]),
      vm.next.advice
        ? el("p", { class: "nextlife__advice", text: vm.next.advice, attrs: { "data-advice": "1" } })
        : null,
    ]),
    el("div", { class: "seed__grid" }, vm.cards.map((card) => seedCard(card, props))),
    codexSection(vm.codex, props),
    vm.chronicle.length > 0
      ? el("section", { class: "seed__past" }, [
          el("div", { class: "seed__past-head" }, [
            el("h2", { text: "前　传" }),
            el("span", { text: `共 ${vm.lives} 篇` }),
          ]),
          el("div", { class: "seed__past-list" }, vm.chronicle.map(chronicleRow)),
        ])
      : null,
  ]);
}
