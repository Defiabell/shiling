/**
 * 主界面：顶部状态栏 ／ 中央事件卡 ／ 底部行动面板 ／ 右侧近事。
 *
 * 渲染策略是**每回合整棵重建**。理由：一回合最多几十个节点，重建成本远低于自己写 diff
 * 的出错成本；而且事件卡的「水墨浮现」本来就该每张新卡重放一次。代价是入场动画会跟着
 * 重放 —— 所以只有中央卡带入场动画，状态栏与行动面板不带，近事列表按 `freshIds` 只给
 * 新增那几条加。
 *
 * 本文件零游戏逻辑：所有可用性/门槛/数值都来自 model/ 下的纯视图模型，那些又都来自引擎。
 */

import { el } from "../dom.js";
import { inkArt } from "../art/placeholders.js";
import type { ActionButtonVm } from "../model/actionVm.js";
import type { CombatActId, CombatVm } from "../model/combatVm.js";
import type { EventCardVm, MediaAsset } from "../model/eventVm.js";
import type { LogLineVm } from "../model/logVm.js";
import type { StatusVm } from "../model/statusVm.js";
import type { ActionId } from "@shiling/tale-sim";

export type CenterVm =
  | {
      kind: "narration";
      key: string;
      title: string | null;
      lines: string[];
      media: MediaAsset | null;
      continueLabel: string | null;
    }
  | { kind: "event"; key: string; card: EventCardVm }
  | { kind: "combat"; key: string; combat: CombatVm };

export interface PlayProps {
  status: StatusVm;
  center: CenterVm;
  actions: ActionButtonVm[];
  log: LogLineVm[];
  freshLogIds: ReadonlySet<number>;
  /** 演出播放中：所有按钮禁用，避免连点打穿引擎的「先结算再行动」纪律 */
  busy: boolean;
  onAction(id: ActionId): void;
  onChoice(idx: number): void;
  onCombat(act: CombatActId): void;
  onContinue(): void;
}

const STAT_HUE: Record<string, string> = {
  meng: "var(--c-meng)",
  ling: "var(--c-ling)",
  ti: "var(--c-ti)",
  de: "var(--c-de)",
};

function gauge(stat: StatusVm["stats"][number]): HTMLElement {
  return el(
    "div",
    {
      class: "gauge",
      style: `--p:${stat.percent / 100};--c:${STAT_HUE[stat.key] ?? "var(--gold)"}`,
      title: `${stat.label}　${stat.hint}`,
      attrs: { "data-anchor": `stat:${stat.key}` },
    },
    [
      el("div", { class: "gauge__ring" }),
      el("div", { class: "gauge__face" }, [
        el("b", { class: "gauge__zi", text: stat.label }),
        el("span", { class: "gauge__num", text: String(stat.value) }),
      ]),
    ],
  );
}

function statusBar(status: StatusVm): HTMLElement {
  const organs = status.organNames.length > 0 ? status.organNames.join("、") : "尚无";
  return el("header", { class: "statusbar" }, [
    el("div", { class: "statusbar__when", attrs: { "data-anchor": "when" } }, [
      // 立绘按器官数分阶（幼兽→成兽→近神）。这是玩家在界面上唯一「看得见自己」的地方，
      // 也是蜕变攒到第三枚器官时的一次视觉兑现 —— 所以贴在最常看的岁月旁边。
      el(
        "figure",
        { class: `self self--${status.portrait.stage}`, title: `此身　${status.portrait.label}` },
        [
          el("img", {
            class: "self__img",
            attrs: { src: status.portrait.src, alt: "", "data-portrait": status.portrait.stage },
          }),
          el("figcaption", { class: "self__zi", text: status.portrait.label }),
        ],
      ),
      el("div", { class: "statusbar__when-text" }, [
        el("div", { class: "when__main", text: status.when }),
        el("div", { class: "when__sub" }, [
          el("span", { text: status.seedName }),
          el("i", { text: "·" }),
          el("span", { text: `器官 ${status.organCount}`, title: organs }),
          el("i", { text: "·" }),
          el("span", { text: `寿限 ${status.lifespanMax}` }),
        ]),
      ]),
    ]),

    el("div", { class: "statusbar__stats" }, status.stats.map(gauge)),

    el("div", { class: "statusbar__vitals" }, [
      el(
        "div",
        {
          class: `hunger${status.hunger.critical ? " is-critical" : ""}${status.hunger.starving ? " is-starving" : ""}`,
          attrs: { "data-anchor": "hunger" },
          title: `饱食 ${status.hunger.value}／${status.hunger.max}　${status.hunger.caption}`,
        },
        [
          el("span", { class: "hunger__zi", text: "饱" }),
          el("div", { class: "hunger__track" }, [
            el("i", { class: "hunger__fill", style: `width:${status.hunger.percent}%` }),
          ]),
          el("span", { class: "hunger__num", text: String(status.hunger.value) }),
        ],
      ),
      el(
        "div",
        { class: "essences", title: `精气满 ${status.essences[0]?.threshold ?? 0} 可蛰伏` },
        status.essences.map((essence) =>
          el(
            "div",
            {
              class: `ess ess--${essence.type}${essence.ripe ? " is-ripe" : ""}`,
              attrs: { "data-anchor": `essence:${essence.type}` },
              title: `${essence.label}之精气 ${essence.value}／${essence.threshold}`,
            },
            [
              el("div", { class: "ess__track" }, [
                el("i", { class: "ess__fill", style: `height:${essence.percent}%` }),
              ]),
              el("span", { class: "ess__zi", text: essence.label }),
            ],
          ),
        ),
      ),
    ]),
  ]);
}

/**
 * 卡片图位。
 *
 * **图位按画幅比开框，不再是固定高度的横幅** —— B4 的插图是 4:3 册页，而原先
 * `height: clamp(132px, 22vh, 240px)` ＋ `object-fit: cover` 实测把图位压成 780×198
 * （≈3.9:1），只留中间那条横带：44 条 brief 里 21 条把主体放在画幅上下极端，切完主体
 * 整个不在画面里（「白泽问路」切完既没有白泽的头也没有仰望的幼兽）。
 * 比例交给内容声明（`MediaAsset.aspect`），缺省 4:3；卡片在宽屏改成图文并排（见 CSS
 * `.card--split`），所以整幅显示也不会把正文挤出屏幕。
 */
function artFigure(media: MediaAsset | null, fallbackKey: string, kind: "event" | "seed"): HTMLElement {
  // 占位图按 4:3 出（与真插图同比例），否则换图时排版会跳一下
  const src = media?.src ?? inkArt(kind, fallbackKey, { width: 1024, height: 768 });
  const node =
    media?.kind === "video"
      ? el("video", {
          class: "card__art-el",
          attrs: { src: media.src, autoplay: "", muted: "", loop: "", playsinline: "" },
        })
      : el("img", { class: "card__art-el", attrs: { src, alt: "", loading: "lazy" } });
  if (media?.kind === "video") (node as HTMLVideoElement).muted = true;
  return el(
    "figure",
    { class: "card__art", style: `aspect-ratio:${media?.aspect ?? "4 / 3"}` },
    [node, el("span", { class: "card__art-veil" })],
  );
}

function requirementChip(requirement: EventCardVm["choices"][number]["requirements"][number]): HTMLElement {
  return el(
    "span",
    {
      class: `req req--${requirement.kind}${requirement.met ? " is-met" : " is-unmet"}`,
    },
    [
      el("b", { text: requirement.label }),
      requirement.shortfall ? el("em", { text: requirement.shortfall }) : null,
    ],
  );
}

function eventCard(card: EventCardVm, key: string, props: PlayProps): HTMLElement {
  return el("section", { class: "card card--event card--split", attrs: { "data-key": key } }, [
    artFigure(card.media, card.eventId, "event"),
    el("div", { class: "card__body" }, [
      el("h2", { class: "card__title", text: card.title }),
      el(
        "div",
        { class: "card__prose" },
        card.paragraphs.map((paragraph) => el("p", { text: paragraph })),
      ),
      el(
        "ul",
        { class: "choices" },
        card.choices.map((choice) =>
          el("li", {}, [
            el(
              "button",
              {
                class: `choice${choice.enabled ? "" : " is-locked"}`,
                attrs: {
                  type: "button",
                  disabled: !choice.enabled || props.busy,
                  "aria-disabled": !choice.enabled,
                  "data-choice": choice.idx,
                },
                title: choice.enabled ? "" : choice.deniedSummary,
                on: { click: () => props.onChoice(choice.idx) },
              },
              [
                el("span", { class: "choice__index", text: String(choice.idx + 1) }),
                el("span", { class: "choice__label", text: choice.label }),
                choice.requirements.length > 0
                  ? el("span", { class: "choice__reqs" }, choice.requirements.map(requirementChip))
                  : null,
              ],
            ),
          ]),
        ),
      ),
      card.deadlocked
        ? el("p", {
            class: "card__deadlock",
            text: "此局无路可择——按下方行动另寻他途。（内容缺兜底分支）",
          })
        : null,
    ]),
  ]);
}

function narrationCard(center: Extract<CenterVm, { kind: "narration" }>, props: PlayProps): HTMLElement {
  const hasArt = center.media !== null || center.title !== null;
  return el(
    "section",
    {
      class: `card card--narration${hasArt ? " card--split" : " card--plain"}`,
      attrs: { "data-key": center.key },
    },
    [
      hasArt ? artFigure(center.media, center.key, "event") : null,
      el("div", { class: "card__body" }, [
        center.title ? el("h2", { class: "card__title", text: center.title }) : null,
        el(
          "div",
          { class: "card__prose" },
          center.lines.map((line) => el("p", { text: line })),
        ),
        center.continueLabel
          ? el("div", { class: "card__foot" }, [
              el("button", {
                class: "btn btn--seal",
                text: center.continueLabel,
                attrs: { type: "button", disabled: props.busy, "data-continue": "1" },
                on: { click: () => props.onContinue() },
              }),
            ])
          : null,
      ]),
    ],
  );
}

function hpBar(label: string, name: string, hp: number, max: number, percent: number, tone: string): HTMLElement {
  return el("div", { class: `hp hp--${tone}` }, [
    el("div", { class: "hp__head" }, [
      el("span", { class: "hp__label", text: label }),
      el("span", { class: "hp__name", text: name }),
      el("span", { class: "hp__num", text: `${hp}／${max}` }),
    ]),
    el("div", { class: "hp__track" }, [el("i", { class: "hp__fill", style: `width:${percent}%` })]),
  ]);
}

function combatCard(combat: CombatVm, props: PlayProps): HTMLElement {
  const log = el(
    "ol",
    { class: "combat__log" },
    combat.log.slice(-9).map((line) => el("li", { text: line })),
  );
  return el(
    "section",
    {
      class: `card card--combat${combat.playerCritical ? " is-critical" : ""}`,
      attrs: { "data-key": `combat:${combat.enemyName}` },
    },
    [
      /*
       * 敌人头像是 B4 出的 1:1 胸像，所以**不能**走顶部横幅图位 —— 一张方形胸像塞进
       * 780×130 的横幅里只剩眼睛一条缝。改成头像在左、名号与描述在右（三国志式的遭遇版式），
       * 顺带把战斗卡的纵向高度让给血条与四指令：打架时最不该出现的就是滚屏。
       */
      el("div", { class: "combat__head" }, [
        el("figure", { class: "foe" }, [
          el("img", {
            class: "foe__img",
            attrs: {
              src: combat.enemyPortrait?.src ?? inkArt("event", `enemy:${combat.enemyName}`, { width: 768, height: 768 }),
              alt: "",
              "data-foe": "1",
            },
          }),
        ]),
        el("div", { class: "combat__intro" }, [
          el("div", { class: "combat__kicker" }, [
            el("span", { text: "遭遇" }),
            el("em", { text: `第 ${combat.round + 1} 合` }),
            combat.primed ? el("b", { class: "combat__primed", text: "蓄势·下击倍之" }) : null,
          ]),
          el("h2", { class: "combat__name", text: combat.enemyName }),
          el("p", { class: "combat__desc", text: combat.enemyDesc }),
        ]),
      ]),
      el("div", { class: "combat__bars" }, [
        hpBar("彼", combat.enemyName, combat.enemyHp, combat.enemyHpMax, combat.enemyPercent, "foe"),
        hpBar("我", "此身", combat.playerHp, combat.playerHpMax, combat.playerPercent, "self"),
      ]),
      log,
      el(
        "div",
        { class: "combat__acts" },
        combat.actions.map((action) =>
          el(
            "button",
            {
              class: `cact${action.enabled ? "" : " is-locked"}`,
              attrs: {
                type: "button",
                disabled: !action.enabled || props.busy,
                "data-combat": action.id,
              },
              title: action.disabledReason ?? action.hint,
              on: { click: () => props.onCombat(action.id) },
            },
            [
              el("b", { class: "cact__zi", text: action.label }),
              el("em", { class: "cact__hint", text: action.disabledReason ?? action.hint }),
            ],
          ),
        ),
      ),
    ],
  );
}

function actionBar(props: PlayProps): HTMLElement {
  return el(
    "footer",
    { class: "actions" },
    props.actions.map((action, index) =>
      el(
        "button",
        {
          class: `act${action.enabled ? "" : " is-locked"}${action.highlight ? " is-hot" : ""}`,
          attrs: {
            type: "button",
            disabled: !action.enabled || props.busy,
            "data-action": action.id,
          },
          title: action.disabledReason ?? action.hint,
          on: { click: () => props.onAction(action.id) },
        },
        [
          el("span", { class: "act__seal", text: action.glyph }),
          el("span", { class: "act__text" }, [
            el("b", {}, [el("span", { text: action.label }), el("kbd", { text: String(index + 1) })]),
            el("em", { text: action.disabledReason ?? action.hint }),
          ]),
        ],
      ),
    ),
  );
}

/**
 * 右栏 = 近事（6 条）＋身内（已蜕生的器官）。
 *
 * 器官那一格不是凑版面：在此之前「我现在长成什么样」只存在于状态栏的 title 提示里，
 * 而它恰好是 build 的全部内容 —— 玩家每次抉择都要看它。顺带把 6 条上限留下的下半栏填实。
 */
function logRail(props: PlayProps): HTMLElement {
  return el("aside", { class: "rail" }, [
    el("div", { class: "rail__title", text: "近　事" }),
    el(
      "ol",
      { class: "rail__list" },
      props.log.length === 0
        ? [el("li", { class: "rail__empty", text: "尚无可记。" })]
        : props.log.map((line) =>
            el(
              "li",
              {
                class: `rail__item tone-${line.tone}${props.freshLogIds.has(line.id) ? " is-fresh" : ""}`,
              },
              [
                el("div", { class: "rail__head" }, [
                  el("span", { class: "rail__stamp", text: line.stamp }),
                  // 连续重复的同一句合成一条，省下的可见位留给真正发生过的事
                  line.repeat > 1 ? el("em", { class: "rail__repeat", text: `×${line.repeat}` }) : null,
                ]),
                el("p", { class: "rail__text", text: line.text }),
              ],
            ),
          ),
    ),
    el("div", { class: "rail__organs" }, [
      el("div", { class: "rail__title", text: "身　内" }),
      el(
        "div",
        { class: "organs" },
        props.status.organNames.length === 0
          ? [el("span", { class: "rail__empty", text: "唯神种一枚。" })]
          : props.status.organNames.map((name, index) =>
              el("span", { class: `organ-chip${index === 0 ? " is-seed" : ""}` }, [
                index === 0 ? el("i", { class: "organ-chip__mark", text: "神" }) : null,
                el("b", { text: name }),
              ]),
            ),
      ),
    ]),
  ]);
}

function centerNode(props: PlayProps): HTMLElement {
  switch (props.center.kind) {
    case "event":
      return eventCard(props.center.card, props.center.key, props);
    case "combat":
      return combatCard(props.center.combat, props);
    default:
      return narrationCard(props.center, props);
  }
}

/** 整屏重建，返回新的根节点（调用方负责替换）。 */
export function renderPlay(props: PlayProps): HTMLElement {
  return el("div", { class: "screen screen--play play" }, [
    statusBar(props.status),
    el("main", { class: "stage" }, [centerNode(props)]),
    logRail(props),
    actionBar(props),
  ]);
}
