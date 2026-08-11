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
import type { SeedCardVm, SeedScreenVm } from "../model/seedVm.js";
import type { EndingType } from "@shiling/tale-sim";

export interface SeedProps {
  vm: SeedScreenVm;
  onChoose(seedId: string): void;
  onUnlock(seedId: string): void;
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
    el("div", { class: "seed__grid" }, vm.cards.map((card) => seedCard(card, props))),
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
