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
import type { DestinationButtonVm } from "../model/destinationVm.js";
import type { CombatActionVm, CombatVm } from "../model/combatVm.js";
import type { DetailSel, DetailVm } from "../model/detailVm.js";
import type { EventCardVm, MediaAsset } from "../model/eventVm.js";
import type { GuideVm } from "../model/guideVm.js";
import type { LogLineVm } from "../model/logVm.js";
import type { StalkActId, StalkMeterVm, StalkVm } from "../model/stalkVm.js";
import type { StatusVm } from "../model/statusVm.js";
import type { ActionId, CombatAct, WayId } from "@shiling/tale-sim";

export type CenterVm =
  | {
      kind: "narration";
      key: string;
      title: string | null;
      lines: string[];
      media: MediaAsset | null;
      continueLabel: string | null;
      /**
       * [2026-08-13] 降世屏那两条「前提」：天时与出身，各带**机制那一行**。
       *
       * 为什么不塞进 `lines`：它们不是旁白而是**账**（「每季多饿 3　水泽之事 ×2」），
       * 要跟正文分开排、要能被 E2E 逐条读出来。只有降世那一屏用得上，所以是可选字段。
       */
      omens?: NarrationOmenVm[];
    }
  | { kind: "event"; key: string; card: EventCardVm }
  | { kind: "combat"; key: string; combat: CombatVm }
  | { kind: "stalk"; key: string; stalk: StalkVm };

/** 降世屏上的一条前提（天时／出身）：名字 ＋ 机制账 ＋ 风味一句。 */
export interface NarrationOmenVm {
  /** 「天时」／「出身」 */
  kind: string;
  name: string;
  /** 机制那一行 —— 这一批的全部主张就在这一行上，它不许被省 */
  effect: string;
  desc: string;
}

export interface PlayProps {
  status: StatusVm;
  center: CenterVm;
  actions: ActionButtonVm[];
  /** [S2] 探索去处（含未开启的，顺序恒按内容表） */
  destinations: DestinationButtonVm[];
  /** [S2] 去处那一排的小标题：「往哪走 · 可去三／六处 · 这一世已至二处」 */
  destinationCaption: string;
  log: LogLineVm[];
  freshLogIds: ReadonlySet<number>;
  /** 演出播放中：所有按钮禁用，避免连点打穿引擎的「先结算再行动」纪律 */
  busy: boolean;
  /** 当前展开的详情浮层（属性／饱食／精气／器官／登神），null ＝ 没开 */
  detail: DetailVm | null;
  /** 首世引导链的当前一步；null ＝ 已跳过／已看完 */
  guide: GuideVm | null;
  onAction(id: ActionId): void;
  /** [S2] 去某一处探索 —— 它**就是**这一季的行动（不是二级菜单里的一步） */
  onExplore(destinationId: string): void;
  onChoice(idx: number): void;
  onCombat(act: CombatAct): void;
  onStalk(act: StalkActId): void;
  onContinue(): void;
  /** 点同一处 ＝ 收起（调用方传 null）；详情的开合不进引擎 */
  onDetail(sel: DetailSel | null): void;
  /** 切换横带展开哪一条道；`null` ＝ 回到「跟着最接近的那条」。纯查看态，不进引擎 */
  onWayTab(way: WayId | null): void;
  onGuideDismiss(): void;
}

const STAT_HUE: Record<string, string> = {
  meng: "var(--c-meng)",
  ling: "var(--c-ling)",
  ti: "var(--c-ti)",
  de: "var(--c-de)",
};

/**
 * 一处可点开详情的读数（属性环／饱食条／精气柱／器官 chip／登神带共用这一层壳）。
 *
 * 为什么是 `<button>` 而不是 hover 提示：原先属性说明只在原生 `title=` 里，**触控板用户
 * 基本发现不了**，而它恰好是「每个属性值有啥用」的唯一答案所在。`title` 仍然保留
 * （鼠标用户白拿一层），但真正的说明挂在点击上。
 *
 * `data-anchor` 必须留在同一个元素上：数值飘字与精气粒子按它定位（app.ts 的
 * `showDelta`／`syncAmbient` 查的就是这个属性），换了标签名不影响，丢了就飘字没了。
 */
function detailButton(
  props: PlayProps,
  sel: DetailSel,
  key: string,
  attrs: {
    class: string;
    style?: string;
    title: string;
    anchor?: string;
    /** 额外的 data-* （E2E 与样式钩子，两种形态下都要保留） */
    extra?: Record<string, string>;
  },
  children: (HTMLElement | null)[],
): HTMLElement {
  const open = props.detail?.key === key;
  const shared = { ...(attrs.anchor === undefined ? {} : { "data-anchor": attrs.anchor }), ...attrs.extra };
  /*
   * 追猎／搏杀的全屏模式里这些读数**退回不可点**（`div`）：浮层在那两屏是关着的
   * （见 `renderPlay`），若还留着按钮的样子，玩家点一下什么也不会发生 —— 一颗按了没反应
   * 的按钮比没有按钮更糟。悬停提示仍在（title 里就是那句实例化的机制）。
   */
  if (props.center.kind === "stalk" || props.center.kind === "combat") {
    return el(
      "div",
      {
        class: attrs.class,
        ...(attrs.style === undefined ? {} : { style: attrs.style }),
        title: attrs.title,
        attrs: shared,
      },
      children,
    );
  }
  return el(
    "button",
    {
      class: `${attrs.class} has-detail${open ? " is-open" : ""}`,
      ...(attrs.style === undefined ? {} : { style: attrs.style }),
      title: attrs.title,
      attrs: {
        type: "button",
        "data-detail": key,
        // 必须给字符串：`el()` 对布尔 false 是「整条属性不写」（见 dom.ts），
        // 于是折叠态永远不宣告 aria-expanded="false"，读屏只听得见展开那一半
        "aria-expanded": String(open),
        ...shared,
      },
      // 同一处再点＝收起（把 null 递给调用方），别的处则换成那一处
      on: { click: () => props.onDetail(open ? null : sel) },
    },
    children,
  );
}

function gauge(stat: StatusVm["stats"][number], props: PlayProps): HTMLElement {
  return detailButton(
    props,
    { kind: "stat", key: stat.key },
    `stat:${stat.key}`,
    {
      class: "gauge",
      style: `--p:${stat.percent / 100};--c:${STAT_HUE[stat.key] ?? "var(--gold)"}`,
      title: stat.hint,
      anchor: `stat:${stat.key}`,
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

/**
 * 详情浮层。
 *
 * **`position: fixed` 是刻意的**：P1/P2 两轮都踩过「新元素把按钮挤出屏幕」（搏杀卡在
 * 780px 版式里量到 608px 而舞台只有 588px，日志被压到一行）。详情是临时读物，让它
 * 完全不参与布局流最安全 —— 追猎／搏杀两个战术屏进场时 app 会主动关掉它（那两屏的
 * 按钮就在右下角，浮层压上去等于挡住操作）。
 */
function detailSheet(detail: DetailVm, props: PlayProps): HTMLElement {
  return el(
    "aside",
    {
      class: "dsheet",
      /*
       * `role="region"` 而不是 `dialog`：dialog 向读屏承诺的是模态 ＋ 焦点被移进来 ＋
       * 焦点被困住，而这是一张随手开、随手关（× ／ Esc ／再点同一处）的旁注，
       * 底下那一屏仍然可点可读。承诺做不到的语义比不给语义更坏。
       */
      attrs: { "data-detail-open": detail.key, role: "region", "aria-label": detail.title },
    },
    [
      el("div", { class: "dsheet__head" }, [
        el("b", { class: "dsheet__title", text: detail.title }),
        el("button", {
          class: "dsheet__close",
          text: "×",
          attrs: { type: "button", "aria-label": "收起", "data-detail-close": "1" },
          on: { click: () => props.onDetail(null) },
        }),
      ]),
      el("p", { class: "dsheet__lede", text: detail.lede }),
      el(
        "dl",
        { class: "dsheet__rows" },
        detail.rows.flatMap((row) => [
          el("dt", { class: "dsheet__label", text: row.label }),
          el("dd", { class: `dsheet__text tone-${row.tone}`, text: row.text }),
        ]),
      ),
      detail.foot ? el("p", { class: "dsheet__foot", text: detail.foot }) : null,
    ],
  );
}

/**
 * 首世引导链（交付内容 E）——一行目标 ＋ 一行实例化提示 ＋ 跳过。
 *
 * 占的是 `.play` 网格里 `guide` 那一行（不是浮层）：它要跟着屏幕一起滚、不遮任何东西。
 * 追猎与搏杀的全屏模式里整条不渲染 —— 那两屏自己已经把每颗按钮的后果写在脸上了。
 */
function guideBar(guide: GuideVm, props: PlayProps): HTMLElement {
  return el(
    "div",
    {
      class: `guide${guide.complete ? " is-complete" : ""}`,
      attrs: { "data-guide": guide.complete ? "done" : String(guide.step) },
    },
    [
      el("span", {
        class: "guide__step",
        text: guide.complete ? "成" : `${guide.step}／${guide.total}`,
      }),
      el("div", { class: "guide__body" }, [
        el("b", { class: "guide__text", text: guide.text }),
        guide.hint ? el("em", { class: "guide__hint", text: guide.hint }) : null,
      ]),
      el("button", {
        class: "guide__close",
        text: "×",
        attrs: { type: "button", "aria-label": "跳过引导", "data-guide-close": "1" },
        on: { click: () => props.onGuideDismiss() },
      }),
    ],
  );
}

/**
 * 四道并列 —— **常驻**在状态栏底沿的一条横带（P2 的「登神之路」在 2026-08-13 扩成四条）。
 *
 * 为什么必须常驻而不是放进某个面板：M0 的门槛只存在于引擎里，玩家好几世都不知道自己在
 * 往哪走，于是一世结束只剩「哦，死了」。摆在最常看的那一栏之后，每一次蜕变、每一次德行
 * 抉择才有了指向 —— 也让死亡屏那句「离归山：德行差一二」有了前情。
 *
 * ## 切 tab 是**查看态**，不是操作
 * 四颗 tab 只换「横带上展开哪一条」，不进引擎、不消耗回合、不影响任何结算（M1 的既定
 * 裁决：不得增加每回合的必点次数）。缺省展开的是引擎判的「最接近的那条」——
 * 玩家什么都不点也总看得见一条与自己这一世有关的道。
 */
function waysPath(ways: StatusVm["ways"], props: PlayProps): HTMLElement {
  const tabs = el(
    "div",
    { class: "ways__tabs", attrs: { role: "tablist", "aria-label": "四道" } },
    ways.ways.map((way) => {
      const active = way.id === ways.shown;
      return el("button", {
        class: `waytab${active ? " is-active" : ""}${way.ready ? " is-ready" : ""}${way.lost ? " is-lost" : ""}`,
        text: way.caption,
        title: `${way.label}：${way.scope}`,
        attrs: {
          type: "button",
          role: "tab",
          "aria-selected": String(active),
          "data-waytab": way.id,
          "data-way-met": String(way.metCount),
          "data-way-lost": way.lost ? "1" : "0",
        },
        // 点已展开的那条 ＝ 回到「跟着最接近的那条走」（传 null），同详情浮层的开合体例
        on: { click: () => props.onWayTab(active ? null : way.id) },
      });
    }),
  );

  const current = ways.current;
  const gates = el(
    "div",
    { class: "ascend__gates" },
    current.gates.map((gate) =>
      el(
        "div",
        {
          class: `agate${gate.met ? " is-met" : ""}`,
          title: gate.hint,
          attrs: { "data-gate": gate.id, "data-met": gate.met ? "1" : "0" },
        },
        [
          el("b", { class: "agate__zi", text: gate.label }),
          // 读数由 VM 给（`max` 类门槛不是「几比几」而是「未夺／已夺 N」）—— 界面不自己拼
          el("span", { class: "agate__num", text: gate.read }),
          el("div", { class: "agate__track" }, [
            el("i", { class: "agate__fill", style: `width:${gate.percent}%` }),
          ]),
        ],
      ),
    ),
  );

  const body = detailButton(
    props,
    { kind: "way", way: current.id },
    `way:${current.id}`,
    {
      class: `ascend${current.ready ? " is-ready" : ""}${current.lost ? " is-lost" : ""}`,
      // 点开看「这条道的门槛各自怎么长、它怎么收束」—— 横带只给「差多少」
      title: `点开看${current.label}要凑齐什么`,
      anchor: "ascend",
      extra: { "data-way": current.id, "data-ascend-met": String(current.metCount) },
    },
    [el("span", { class: "ascend__zi", text: current.scope }), gates],
  );

  return el("div", { class: "ways" }, [tabs, body]);
}

function statusBar(status: StatusVm, props: PlayProps): HTMLElement {
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

    el(
      "div",
      { class: "statusbar__stats" },
      status.stats.map((stat) => gauge(stat, props)),
    ),

    el("div", { class: "statusbar__vitals" }, [
      detailButton(
        props,
        { kind: "hunger" },
        "hunger",
        {
          class: `hunger${status.hunger.critical ? " is-critical" : ""}${status.hunger.starving ? " is-starving" : ""}`,
          title: `${status.hunger.hint}　${status.hunger.caption}`,
          anchor: "hunger",
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
        { class: "essences" },
        status.essences.map((essence) =>
          detailButton(
            props,
            { kind: "essence", type: essence.type },
            `essence:${essence.type}`,
            {
              class: `ess ess--${essence.type}${essence.ripe ? " is-ripe" : ""}`,
              title: essence.hint,
              anchor: `essence:${essence.type}`,
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

    waysPath(status.ways, props),
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
        /*
         * [2026-08-13] 降世屏的两条前提。**机制那一行必须上屏** —— 只写名字（「大旱之年」）
         * 与「一行风味字」无从区分，而这一批的全部主张就是开局变量真改机制。
         */
        center.omens && center.omens.length > 0
          ? el(
              "dl",
              { class: "omens", attrs: { "data-omens": String(center.omens.length) } },
              center.omens.flatMap((omen) => [
                el("dt", { class: "omens__kind", text: omen.kind }),
                el("dd", { class: "omens__body", attrs: { "data-omen": omen.name } }, [
                  el("b", { class: "omens__name", text: omen.name }),
                  el("em", { class: "omens__effect", text: omen.effect }),
                  el("span", { class: "omens__desc", text: omen.desc }),
                ]),
              ]),
            )
          : null,
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

/**
 * 搏杀屏（M1-P2 重做）。
 *
 * 与追猎屏同一条骨架，因为它们要回答同一个问题：**按下去会发生什么**。
 * 从上到下：遭遇头（头像／名号／它护哪儿／它打算干什么）→ 双血条 → 形势一行
 * （还撑得住几合／它还需几下，「什么时候该逃」的依据）→ 日志（高度给死）→ 指令网格。
 *
 * 指令**全部平铺在一屏**（既定裁决第三条：不做多级菜单、不增加每回合的必点次数）：
 * 三颗咬击 ＋ 两颗姿态（当前姿态不出按钮）＋ 器官技若干 ＋ 遁走。
 */
function combatCard(combat: CombatVm, props: PlayProps): HTMLElement {
  // [S1] 遁走单独拎出来（见下面 combat__stand 那段的理由）；其余按钮留在可滚的网格里
  const flee = combat.actions.find((action) => action.group === "flee") ?? null;
  const grid = combat.actions.filter((action) => action.group !== "flee");
  const log = el(
    "ol",
    { class: "combat__log" },
    combat.log.slice(-6).map((line) => el("li", { text: line })),
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
       * 顺带把战斗卡的纵向高度让给血条与指令：打架时最不该出现的就是滚屏。
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
            el("em", { text: combat.roundLabel }),
            // 守备与姿态是两个常驻小牌：它们决定「该咬哪儿」与「出伤受伤各打几折」
            el("b", { class: "combat__guard", attrs: { "data-guard": combat.guardPart } }, [
              el("span", { text: combat.guardLabel }),
            ]),
            el("b", { class: "combat__stance" }, [el("span", { text: combat.stanceLabel })]),
            ...combat.marks.map((mark) => el("i", { class: "combat__mark", text: mark })),
          ]),
          el("div", { class: "combat__nameline" }, [
            el("h2", { class: "combat__name", text: combat.enemyName }),
            /*
             * [S3] 「已入图鉴」：花血统点参透过这一头，所以这一场读得出确切意图。
             * 挂在名号旁而不是意图行里 —— 它是**关于这头兽本身**的事实（世世都算数），
             * 而意图行说的是这一回合。
             */
            combat.enemyLoreBadge
              ? el("b", {
                  class: "combat__lore",
                  text: combat.enemyLoreBadge,
                  attrs: { "data-lore-badge": "1" },
                  title: "历代与它照过面，且已以血统参透 —— 它的意图读得出确数。",
                })
              : null,
          ]),
          /*
           * 意图宣告：这一行是整个搏杀屏的意义所在（它相当于追猎屏的风标 ＋ 命中率）。
           * 读得出意图的 build 看到的是内容写的那句话＋一笔受伤账；读不出的只看到粗档
           * 「似要动手」＋一句「灵犀之类的器官才读得清」——**差别必须写在脸上**，
           * 否则器官白给（P1 第一条教训）。
           */
          el(
            "div",
            {
              class: `combat__intent${combat.intentHot ? " is-hot" : ""}${combat.intentKnown ? "" : " is-vague"}`,
              attrs: { "data-intent": combat.intentKnown ? "exact" : "vague" },
            },
            [
              el("b", { class: "combat__intent-text", text: combat.intentLabel }),
              el("em", { class: "combat__intent-detail", text: combat.intentDetail }),
            ],
          ),
        ]),
      ]),
      el("div", { class: "combat__bars" }, [
        hpBar("彼", combat.enemyName, combat.enemyHp, combat.enemyHpMax, combat.enemyPercent, "foe"),
        hpBar("我", "此身", combat.playerHp, combat.playerHpMax, combat.playerPercent, "self"),
      ]),
      /*
       * [S1] **遁走从滚动网格里搬到形势那一行旁边**（`combat__stand`）。
       *
       * 两个理由，一个是实机量出来的、一个是设计上的：
       * 1. 技能池长到 5〜8 颗（极端 build 十几颗）之后，网格必须能滚，而滚动会把**末尾**
       *    那颗顶出可视区 —— 末尾正好是遁走。「什么时候该逃」是搏杀屏三道题之一，
       *    它的按钮不能是要滚才找得到的那一颗。
       * 2. 「还撑得住约 3 合 · 它还需 4 下」就是这道题的算式。按钮挨着它的依据放，
       *    才读得成一句话。
       */
      el("div", { class: "combat__stand" }, [
        el("div", {
          class: `combat__outlook${combat.outlookHot ? " is-hot" : ""}`,
          text: combat.outlook,
          attrs: { "data-outlook": "1" },
        }),
        ...(flee ? [combatButton(flee, props)] : []),
      ]),
      log,
      el("div", { class: "combat__acts" }, grid.map((action) => combatButton(action, props))),
    ],
  );
}

/** 一颗搏杀指令按钮 —— 网格与「形势那一行」共用这一份（两处长得必须一样）。 */
function combatButton(action: CombatActionVm, props: PlayProps): HTMLElement {
  return el(
    "button",
    {
      class: `cact cact--${action.group}${action.enabled ? "" : " is-locked"}${action.highlight ? " is-hot" : ""}${action.warning ? " has-warn" : ""}${action.synergy ? " is-synergy" : ""}`,
      attrs: {
        type: "button",
        disabled: !action.enabled || props.busy,
        "data-combat": action.id,
      },
      title: action.disabledReason ?? action.warning ?? action.flavor ?? action.effect,
      on: { click: () => props.onCombat(action.act) },
    },
    [
      el("span", { class: "cact__seal", text: action.glyph }),
      el("span", { class: "cact__text" }, [
        el("b", { text: action.label }),
        /*
         * 预期效果**恒在**：没有预览的按钮就是翻牌。
         *
         * [S1] 不可用时**照样写后果**，把原因另起一行 —— 此前是「原因顶掉后果」，
         * 技能池只有一颗按钮时无所谓，而现在有五到八颗：一颗只写「还需 2 合」的
         * 按钮，玩家既不知道它是什么，也就没法决定「要不要留着它收官」。
         */
        el("em", { class: "cact__effect", text: action.effect }),
        action.disabledReason ? el("i", { class: "cact__lock", text: action.disabledReason }) : null,
        action.warning ? el("i", { class: "cact__warn", text: action.warning }) : null,
        // 风味（组合技那一行）与警告分开排版：一个是「这一手是什么」，一个是「注意后果」
        action.flavor ? el("i", { class: "cact__flavor", text: action.flavor }) : null,
      ]),
    ],
  );
}

/**
 * 追猎屏的一个量表：汉字标签 ＋ 读数 ＋ 横条。
 *
 * **精确值与档位是互斥显示的**（`exact`）—— 没有夜瞳／灵犀时读数位只写「有疑」，
 * 那正是「信息本身就是器官奖励」在屏幕上的样子。若两个都显示，器官就白给了。
 */
function stalkMeter(meter: StalkMeterVm): HTMLElement {
  return el(
    "div",
    {
      class: `smeter${meter.hot ? " is-hot" : ""}${meter.exact ? "" : " is-vague"}`,
      title: meter.hint,
    },
    [
      el("div", { class: "smeter__head" }, [
        el("b", { class: "smeter__zi", text: meter.label }),
        el("span", { class: "smeter__read" }, [
          meter.exact ? el("i", { class: "smeter__num", text: String(meter.value) }) : null,
          el("em", { class: "smeter__band", text: meter.band }),
        ]),
      ]),
      el("div", { class: "smeter__track" }, [
        el("i", { class: "smeter__fill", style: `width:${meter.percent}%` }),
      ]),
    ],
  );
}

/**
 * 距离轨：左端是自己，右端是猎物，中间那条按 `closeness` 收拢。
 *
 * 一条横轨比一个数字更快读懂「我还差多远」，而追猎屏最怕的就是玩家要在四个数字之间
 * 换算。数字仍在量表里给（要算账时看得到），轨道负责一眼的空间感。
 */
function stalkTrack(stalk: StalkVm): HTMLElement {
  return el("div", { class: "strack" }, [
    el("span", { class: "strack__self", text: "我" }),
    el("div", { class: "strack__line" }, [
      el("i", { class: "strack__gap", style: `width:${100 - stalk.closeness}%` }),
      el("b", {
        class: "strack__prey",
        style: `left:${stalk.closeness}%`,
        text: stalk.distance.value <= 0 ? "◆" : "◇",
      }),
    ]),
    el("span", { class: "strack__num", text: `${stalk.distance.value} 步` }),
  ]);
}

function stalkCard(stalk: StalkVm, key: string, props: PlayProps): HTMLElement {
  return el("section", { class: "card card--stalk", attrs: { "data-key": key } }, [
    el("div", { class: "stalk__head" }, [
      el("figure", { class: "foe foe--stalk" }, [
        el("img", {
          class: "foe__img",
          attrs: {
            src:
              stalk.preyPortrait?.src ??
              inkArt("event", `prey:${stalk.preyName}`, { width: 768, height: 768 }),
            alt: "",
            "data-prey": "1",
          },
        }),
      ]),
      el("div", { class: "stalk__intro" }, [
        el("div", { class: "stalk__kicker" }, [
          el("span", { text: "追猎" }),
          el("em", { text: stalk.roundLabel }),
          el(
            "b",
            {
              class: `stalk__wind${stalk.windAgainst ? " is-bad" : ""}${stalk.windVisible ? "" : " is-vague"}`,
              title: stalk.windHint,
            },
            [
              el("span", { text: stalk.windLabel }),
              stalk.windMulLabel ? el("i", { text: stalk.windMulLabel }) : null,
            ],
          ),
        ]),
        el("div", { class: "stalk__nameline" }, [
          el("h2", { class: "stalk__name", text: stalk.preyName }),
          // 「会反扑」一直挂在名号旁边：它决定要不要在这头身上花五个回合
          stalk.preyBadge
            ? el("b", {
                class: "stalk__badge",
                text: stalk.preyBadge,
                title: "追猎失手或它受惊时，它不会逃 —— 会转成一场搏杀。",
              })
            : null,
          /*
           * [S3] 「已入图鉴」：花血统点参透过这一头，所以这一屏读得出确切警觉与命中率。
           * 与「会反扑」并列而不是二选一 —— 一头兽可以既会反扑又已参透，而两件事
           * 玩家都要知道。挂在名号旁而不是量表里，理由同「会反扑」：它是**关于这头兽本身**
           * 的事实，不随这一息变。
           */
          stalk.preyLoreBadge
            ? el("b", {
                class: "stalk__lore",
                text: stalk.preyLoreBadge,
                attrs: { "data-lore-badge": "1" },
                title: "历代与它照过面，且已以血统参透 —— 警觉与命中率读得出确数。",
              })
            : null,
        ]),
        el("p", { class: "stalk__desc", text: stalk.preyDesc }),
      ]),
    ]),

    stalkTrack(stalk),
    el("div", { class: "stalk__meters" }, [
      stalkMeter(stalk.distance),
      stalkMeter(stalk.alert),
      stalkMeter(stalk.stamina),
    ]),

    el(
      "ol",
      { class: "combat__log stalk__log" },
      stalk.log.slice(-6).map((line) => el("li", { text: line })),
    ),

    el(
      "div",
      { class: "stalk__acts" },
      stalk.actions.map((action) =>
        el(
          "button",
          {
            class: `sact${action.enabled ? "" : " is-locked"}${action.highlight ? " is-hot" : ""}${action.warning ? " has-warn" : ""}`,
            attrs: {
              type: "button",
              disabled: !action.enabled || props.busy,
              "data-stalk": action.id,
            },
            title: action.disabledReason ?? action.warning ?? action.effect,
            on: { click: () => props.onStalk(action.id) },
          },
          [
            el("span", { class: "sact__seal", text: action.glyph }),
            el("span", { class: "sact__text" }, [
              el("b", { text: action.label }),
              // 预期效果**恒在**：没有预览的按钮就是翻牌，这一行是整个追猎屏的意义所在
              el("em", { class: "sact__effect", text: action.effect }),
              action.warning ? el("i", { class: "sact__warn", text: action.warning }) : null,
            ]),
          ],
        ),
      ),
    ),
  ]);
}

function actionBar(props: PlayProps): HTMLElement {
  return el("footer", { class: "actions" }, [
    el(
      "div",
      { class: "actions__row" },
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
    ),
    destinationBar(props),
  ]);
}

/**
 * [S2] 去处那一排 —— 「探索」这一季的全部内容。
 *
 * 每颗按钮四行恒在（地貌／遇事／风险＋此地有什么／路费），未开启的**后果照写、
 * 原因另起一行**（`dest__lock`）—— 与 S1 技能池那一条同解：只写「尚不得其门」的按钮，
 * 玩家既不知道那儿是什么，也就没法决定「要不要为它去凑一件浮鳔」。
 *
 * 键盘编号从 4 起（1／2／3 归上面那三颗行动）。
 */
function destinationBar(props: PlayProps): HTMLElement {
  const offset = props.actions.length;
  return el("div", { class: "dests" }, [
    el("div", { class: "dests__title", text: props.destinationCaption }),
    el(
      "div",
      { class: "dests__grid" },
      props.destinations.map((dest, index) =>
        el(
          "button",
          {
            class: `dest dest--${dest.peril}${dest.enabled ? "" : " is-locked"}${dest.visited ? " is-visited" : ""}${dest.chartedOpen ? " is-charted" : ""}`,
            attrs: {
              type: "button",
              disabled: !dest.enabled || props.busy,
              "data-dest": dest.id,
            },
            title: dest.disabledReason ?? dest.desc,
            on: { click: () => props.onExplore(dest.id) },
          },
          [
            el("span", { class: "dest__head" }, [
              el("b", { text: dest.name }),
              dest.treasureFound ? el("i", { class: "dest__seal", text: "秘" }) : null,
              dest.visited && !dest.treasureFound ? el("i", { class: "dest__mark", text: "已至" }) : null,
              el("kbd", { text: String(offset + index + 1) }),
            ]),
            el("em", { class: "dest__desc", text: dest.desc }),
            el("span", { class: "dest__facts" }, [
              el("i", { text: dest.chanceLine }),
              el("i", { text: dest.perilLine }),
              dest.denizenLine ? el("i", { class: "dest__foe", text: dest.denizenLine }) : null,
              el("i", { text: dest.costLine }),
            ]),
            dest.disabledReason ? el("i", { class: "dest__lock", text: dest.disabledReason }) : null,
            /*
             * [S3] 靠图录进得去的那一处：把「凭什么进得去」写出来。
             * 不写的后果是玩家会以为自己已经凑齐了那两件器官，而下一世图录用掉之后
             * 它又灰回去 —— 那是一次没有任何解释的倒退（同 legibility 那条：
             * 界面不许让玩家自己去猜规则）。
             */
            dest.chartNote ? el("i", { class: "dest__chart", text: dest.chartNote }) : null,
          ],
        ),
      ),
    ),
  ]);
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
      /*
       * chip **可点开详情**（交付内容 B）。此前它只渲染名字：`OrganDef.desc`／`tags`／
       * `combatSkill` 一个字都没露面，器官详情只存在于选神种屏 —— 于是「进化能有啥好处」
       * 在游戏里无处可查，而它恰好是 build 的全部内容。
       */
      el(
        "div",
        { class: "organs" },
        props.status.organs.length === 0
          ? [el("span", { class: "rail__empty", text: "唯神种一枚。" })]
          : props.status.organs.map((organ) =>
              detailButton(
                props,
                { kind: "organ", id: organ.id },
                `organ:${organ.id}`,
                {
                  class: `organ-chip${organ.isSeed ? " is-seed" : ""}`,
                  title: "点开看它给了什么、开了哪些抉择",
                },
                [
                  organ.isSeed ? el("i", { class: "organ-chip__mark", text: "神" }) : null,
                  el("b", { text: organ.name }),
                ],
              ),
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
    case "stalk":
      return stalkCard(props.center.stalk, props.center.key, props);
    default:
      return narrationCard(props.center, props);
  }
}

/**
 * 整屏重建，返回新的根节点（调用方负责替换）。
 *
 * 追猎与搏杀都进**全屏模式**（`play--stalk`／`play--combat`）：收掉右栏「近事」、收掉底部
 * 四行动（引擎此刻 `availableActions` 本来就是空的，留着一排全灰的按钮只会分散注意），
 * 把整块横向空间让给动作卡。状态栏留着 —— 饱食、精气与登神进度正是「这一场打不打得起、
 * 值不值得打」的前提，藏了反而要玩家凭记忆。
 *
 * [M1-P2] 搏杀跟着进全屏是**实机逼出来的**：P2 的搏杀卡要装遭遇头＋意图宣告＋双血条＋
 * 形势＋日志＋六到八颗带两行说明的按钮，在 780px 宽的两栏版式里量到卡片高 608px 而舞台
 * 只有 588px —— 日志被 flex 压到 24px（一行都读不全）。收掉右栏与行动面板之后横向多 300px、
 * 纵向多 100px，日志才回到该有的四行。
 */
export function renderPlay(props: PlayProps): HTMLElement {
  const kind = props.center.kind;
  const fullscreen = kind === "stalk" || kind === "combat";
  const mode = kind === "stalk" ? " play--stalk" : kind === "combat" ? " play--combat" : "";
  /*
   * 引导链与详情浮层都**不进两个战术全屏**：那两屏的按钮带两行说明、纵向已经量到极限
   * （P2 那次实测卡片 608px／舞台 588px），再插一行或压一张浮层就是重犯「新元素把按钮
   * 挤出屏幕」。追猎与搏杀本来也不需要 —— 它们每颗按钮都自带后果预览。
   */
  const guide = fullscreen ? null : props.guide;
  const detail = fullscreen ? null : props.detail;
  return el("div", { class: `screen screen--play play${mode}${guide ? " play--guided" : ""}` }, [
    statusBar(props.status, props),
    guide ? guideBar(guide, props) : null,
    el("main", { class: "stage" }, [centerNode(props)]),
    fullscreen ? null : logRail(props),
    fullscreen ? null : actionBar(props),
    detail ? detailSheet(detail, props) : null,
  ]);
}
