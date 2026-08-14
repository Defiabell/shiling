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
import type {
  BeastRowVm,
  BoonRowVm,
  ChartRowVm,
  CodexVm,
  LoreRowVm,
  PlaceRowVm,
  SeedCardVm,
  SeedScreenVm,
  SigilRowVm,
  SynergyRowVm,
} from "../model/seedVm.js";
import type { EndingType } from "@shiling/tale-sim";

export interface SeedProps {
  vm: SeedScreenVm;
  onChoose(seedId: string): void;
  onUnlock(seedId: string): void;
  /** [S1] 买「血脉」：花血统点让下一世起手自带这件器官 */
  onBuyBoon(organId: string): void;
  /** [S3] 买「图录」：花血统点让下一世直通这一处（免门槛） */
  onBuyChart(destinationId: string): void;
  /** [S3] 受「世家印记」：永久小加成，至多三枚 */
  onBuySigil(sigilId: string): void;
  /** [S3] 参透一头异兽：此后追猎／搏杀读得出确数 */
  onBuyLore(enemyId: string): void;
  onBack(): void;
}

/**
 * [S3] 货架上那颗按钮 —— 四类消费共用一份写法。
 *
 * 三种字样在四处必须完全一致（同 S1 血脉那条：界面的置灰是规则的镜像，不许更严也不许更松）：
 * 已买／买得起（写价）／买不起（写价 ＋ **还差多少**）。写清还差多少，玩家才知道
 * 「再活一世够不够」。
 */
function buyButton(opts: {
  cls: string;
  attr: string;
  id: string;
  cost: number;
  owned: boolean;
  ownedLabel: string;
  affordable: boolean;
  shortfall: number;
  buyLabel: string;
  onBuy(id: string): void;
}): HTMLElement {
  return el("button", {
    class: `btn btn--ghost ${opts.cls}${opts.owned ? " is-chosen" : ""}`,
    text: opts.owned
      ? opts.ownedLabel
      : opts.shortfall > 0
        ? `血统 ${opts.cost}（尚差 ${opts.shortfall}）`
        : `${opts.buyLabel} ${opts.cost}`,
    attrs: {
      type: "button",
      disabled: opts.owned || !opts.affordable,
      [opts.attr]: opts.id,
    },
    on: { click: () => opts.onBuy(opts.id) },
  });
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
/**
 * [S2] 「山川」那一段的一行。
 *
 * 与异变那一行的分工：这里**名号与门槛恒可见**（欲望展示位 —— 知道幽潭要什么才会去凑），
 * 而**秘藏未得则只渲染一个「？」**：不给 id、不给名字，devtools 里也搜不出来
 * （同 S1 图鉴那条铁律 —— devtools 是玩家伸手就能开的东西）。
 */
function placeRow(row: PlaceRowVm): HTMLElement {
  return el(
    "li",
    {
      class: `codex__row place__row${row.visited ? " is-known" : " is-unvisited"}`,
      attrs: { "data-place": row.id },
    },
    [
      el("div", { class: "codex__head" }, [
        el("span", { class: `codex__seal place__seal${row.treasureKnown ? " is-found" : ""}`, text: "地" }),
        el("b", { class: "codex__name", text: row.name }),
        el("span", { class: "codex__recipe", text: row.gate }),
        row.visited ? el("em", { class: "place__been", text: "已至" }) : null,
      ]),
      el("em", { class: "codex__effect", text: row.desc }),
      el(
        "p",
        {
          class: `codex__note place__treasure${row.treasureKnown ? " is-found" : ""}`,
          attrs: { "data-treasure": row.treasureKnown ? "known" : "unknown" },
        },
        [
          el("b", { text: `秘藏 · ${row.treasureName}` }),
          el("span", { text: `　${row.treasureNote}` }),
        ],
      ),
    ],
  );
}

/**
 * [S3] 异兽图鉴一行。
 *
 * 与异变那一行同一条铁律：**未照面的只渲染一个「？」**——不给 id、不给名字、不给数值。
 * 「青丘有几头兽」是分母（那不算泄露），「第六头叫穷奇幼崽、猛 34」是内容（那算）。
 */
function beastRow(row: BeastRowVm): HTMLElement {
  if (!row.known) {
    return el("li", { class: "codex__row is-unknown", attrs: { "data-beast": "unknown" } }, [
      el("b", { class: "codex__name", text: "？" }),
      el("em", { class: "codex__note", text: row.note }),
    ]);
  }
  return el("li", { class: "codex__row is-known", attrs: { "data-beast": row.id ?? "" } }, [
    el("div", { class: "codex__head" }, [
      el("span", { class: `codex__seal beast__seal${row.lore ? " is-found" : ""}`, text: "兽" }),
      el("b", { class: "codex__name", text: row.name }),
      el("span", { class: "codex__recipe", text: row.meta }),
      row.lore ? el("em", { class: "place__been", text: "已参透" }) : null,
    ]),
    el("p", { class: "codex__note", text: row.note }),
  ]);
}

/** [S3] 图录一行：一处已到过、有门槛的去处 ＋ 标价。 */
function chartRow(row: ChartRowVm, props: SeedProps): HTMLElement {
  return el("li", { class: `boon__row${row.chosen ? " is-chosen" : ""}` }, [
    el("div", { class: "boon__main" }, [
      el("b", { class: "boon__name", text: row.name }),
      el("span", { class: "boon__meta", text: row.gate }),
    ]),
    buyButton({
      cls: "boon__buy",
      attr: "data-chart",
      id: row.destinationId,
      cost: row.cost,
      owned: row.chosen,
      ownedLabel: "下一世直通",
      affordable: row.affordable,
      shortfall: row.shortfall,
      buyLabel: "以血统",
      onBuy: props.onBuyChart,
    }),
  ]);
}

/** [S3] 世家印记一行：机制那一句恒在（「每世 灵 +2」），因果那一句在下面。 */
function sigilRow(row: SigilRowVm, props: SeedProps): HTMLElement {
  return el("li", { class: `boon__row${row.owned ? " is-chosen" : ""}` }, [
    el("div", { class: "boon__main" }, [
      el("b", { class: "boon__name", text: row.name }),
      el("span", { class: "boon__meta", text: row.effect }),
      el("em", { class: "boon__skill", text: row.desc }),
    ]),
    buyButton({
      cls: "boon__buy",
      attr: "data-sigil",
      id: row.sigilId,
      cost: row.cost,
      owned: row.owned,
      ownedLabel: "已受此印",
      affordable: row.affordable,
      shortfall: row.shortfall,
      buyLabel: "以血统",
      onBuy: props.onBuySigil,
    }),
  ]);
}

/** [S3] 图鉴知识一行：买到的是**信息**，所以那一行写的是「读得出什么」而不是「+X」。 */
function loreRow(row: LoreRowVm, props: SeedProps): HTMLElement {
  return el("li", { class: `boon__row${row.owned ? " is-chosen" : ""}` }, [
    el("div", { class: "boon__main" }, [
      el("b", { class: "boon__name", text: row.name }),
      el("span", { class: "boon__meta", text: row.gain }),
    ]),
    buyButton({
      cls: "boon__buy",
      attr: "data-lore",
      id: row.enemyId,
      cost: row.cost,
      owned: row.owned,
      ownedLabel: "已参透",
      affordable: row.affordable,
      shortfall: row.shortfall,
      buyLabel: "以血统",
      onBuy: props.onBuyLore,
    }),
  ]);
}

/** 一段货架的通用外壳（题头 ＋ 一句说明 ＋ 行；空货架给一句而不是留白）。 */
function shelf(opts: {
  title: string;
  caption: string;
  captionAttr?: string;
  emptyNote: string | null;
  rows: HTMLElement[];
  cls?: string;
}): HTMLElement {
  return el("div", { class: opts.cls ?? "seed__boon" }, [
    el("div", { class: "seed__boon-head" }, [
      el("h3", { text: opts.title }),
      el("span", {
        text: opts.caption,
        ...(opts.captionAttr ? { attrs: { [opts.captionAttr]: "1" } } : {}),
      }),
    ]),
    opts.emptyNote !== null
      ? el("p", { class: "seed__boon-empty", text: opts.emptyNote })
      : el("ul", { class: "boon__list" }, opts.rows),
  ]);
}

/**
 * [S3] 「血　统」——四类消费的统一货架。
 *
 * 摆在图鉴**之前**：图鉴回答「我见过什么」，货架回答「这几点花在哪」，而玩家进这一屏
 * 手里正攥着刚结算的血统点。四段的顺序按「离这一世多近」排：
 * 血脉与图录是**这一世**的装备（一世一次），印记与知识是**世世**的底子（永久）。
 */
function bloodlineShop(codex: CodexVm, points: number, props: SeedProps): HTMLElement {
  return el("section", { class: "seed__shop", attrs: { "data-shop": "1" } }, [
    el("div", { class: "seed__codex-head" }, [
      el("h2", { text: "血　统" }),
      el("span", { attrs: { "data-shop-points": "1" }, text: `可用 ${points} 点` }),
    ]),
    el("p", {
      class: "seed__codex-lede",
      text: "四样可花：血脉与图录只管下一世（用掉即无），世家印记与图鉴知识世世都在。一世产三到八点，四样加起来永远买不全 —— 这一世先要哪一样，是你的事。",
    }),
    shelf({
      title: "血　脉",
      caption:
        codex.chosenBoonName === null
          ? "下一世起手自带一件已见过的器官（一世只带一件）"
          : `下一世自带　${codex.chosenBoonName} —— 一世只带一件，这一世的血脉已定`,
      emptyNote: codex.boonEmptyNote,
      rows: codex.boons.map((row) => boonRow(row, props)),
    }),
    shelf({
      title: "图　录",
      caption:
        codex.chosenChartName === null
          ? "下一世直通某处已到过的秘境，不必其门（只免门槛，不免路费；一世一处）"
          : `下一世直通　${codex.chosenChartName} —— 一世一处，这一世的图录已定`,
      emptyNote: codex.chartEmptyNote,
      rows: codex.charts.map((row) => chartRow(row, props)),
    }),
    shelf({
      title: "世家印记",
      caption: codex.sigilCaption,
      captionAttr: "data-sigil-count",
      emptyNote: null,
      rows: codex.sigils.map((row) => sigilRow(row, props)),
    }),
    shelf({
      title: "图鉴知识",
      caption: codex.loreCaption,
      captionAttr: "data-lore-count",
      emptyNote: codex.loreEmptyNote,
      rows: codex.lores.map((row) => loreRow(row, props)),
    }),
  ]);
}

/**
 * [S1＋S2＋S3] 「图　鉴」——四录，一颗按钮都没有。
 *
 * 总览那一条（四个分数并排）是这一屏「摸得着的发展方向」的入口：分母摆在一起，
 * 玩家一眼看得出「异变才 3/10，而山川已经 5/6」——「该往哪使劲」的第一层答案就在那一行。
 */
function codexSection(codex: CodexVm, props: SeedProps): HTMLElement {
  return el("section", { class: "seed__codex", attrs: { "data-codex": "1" } }, [
    el("div", { class: "seed__codex-head" }, [
      el("h2", { text: "图　鉴" }),
      el("span", { attrs: { "data-codex-summary": "1" }, text: codex.summary }),
    ]),
    el("p", {
      class: "seed__codex-lede",
      text: "见过的都记在这里，没见过的一律是问号 —— 图鉴只记你亲身遇到的，不替你剧透。",
    }),
    el("div", { class: "seed__places" }, [
      el("div", { class: "seed__boon-head" }, [
        el("h3", { text: "异　变" }),
        el("span", { attrs: { "data-codex-count": "1" }, text: codex.caption }),
      ]),
      el("p", {
        class: "seed__boon-empty",
        text: "某几件器官凑在一处会生出新的一手。配方不载于图鉴 —— 凑齐的那一刻自会知道。",
      }),
      el("ul", { class: "codex__list" }, codex.rows.map(synergyRow)),
    ]),
    /*
     * [S2] 山川：去处与秘藏。与异变的信息分配刚好相反 —— 门槛恒可见（欲望展示位），
     * 秘藏未得则恒为「？」。
     */
    el("div", { class: "seed__places" }, [
      el("div", { class: "seed__boon-head" }, [
        el("h3", { text: "山　川" }),
        el("span", { attrs: { "data-place-count": "1" }, text: codex.placeCaption }),
      ]),
      el("p", {
        class: "seed__boon-empty",
        text: "去处的门槛写在明处 —— 凑齐了才进得去。而每一处藏着什么，只有到过才知道。",
      }),
      el("ul", { class: "codex__list" }, codex.places.map(placeRow)),
    ]),
    /* [S3] 异兽：照过面的才有名字。这一段同时是「图鉴知识」那个货架的货源。 */
    el("div", { class: "seed__places" }, [
      el("div", { class: "seed__boon-head" }, [
        el("h3", { text: "异　兽" }),
        el("span", { attrs: { "data-beast-count": "1" }, text: codex.beastCaption }),
      ]),
      el("p", {
        class: "seed__boon-empty",
        text: "追过、打过、或者被它咬死过，都算照面。参透过的那几头，此后追猎与搏杀读得出确数。",
      }),
      el("ul", { class: "codex__list" }, codex.beasts.map(beastRow)),
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
      /*
       * [S3] 「这一世可以试着凑 X」—— 三条以内的**具体**建议，全部由图鉴与上一世的
       * 擦肩而过推出来（`composeQuests`）。`advice` 说的是换哪条道（目标），
       * 这几条说的是下一步干什么（手段）。owner 的原话是「不知道要怎么发展」，
       * 治的就是这一行 —— 所以它排在天时之下、神种卡之上：按下「承此种降世」之前读到。
       */
      vm.next.quests.length > 0
        ? el("ul", { class: "nextlife__quests", attrs: { "data-quests": "1" } },
            vm.next.quests.map((quest) =>
              el("li", { class: "nextlife__quest", attrs: { "data-quest": "1" }, text: quest }),
            ),
          )
        : null,
    ]),
    el("div", { class: "seed__grid" }, vm.cards.map((card) => seedCard(card, props))),
    bloodlineShop(vm.codex, vm.points, props),
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
