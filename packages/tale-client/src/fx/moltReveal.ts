/**
 * 蜕变开奖卷轴 —— 三候选滚动定格。
 *
 * 开奖结果由引擎给（`MoltResult.chosen`），这里只负责让它**看起来像开奖**：候选条纵向
 * 滚动、减速、定在中格，然后展开这枚器官的全貌。绝不自己抽签（那就是把游戏逻辑挪进
 * 界面了），滚动列表里出现的三条恒为 `candidates`，落点恒为 `chosen`。
 */

import type { MoltResult, OrganDef, TaleContent } from "@shiling/tale-sim";
import { el } from "../dom.js";
import { ESSENCE_LABELS, STAT_LABELS, STAT_ORDER, formatSigned } from "../model/format.js";
import { prefersReducedMotion, sleep } from "./motion.js";
import { ESSENCE_RGB, createParticleLayer } from "./particles.js";

/** 单条候选的行高（px）—— 与 CSS 的 `--molt-row` 必须一致，滚动落点按它算。 */
const ROW_H = 78;
const LOOPS = 5;
const SPIN_MS = 2100;

const SLOT_NAMES: Record<string, string> = {
  eye: "窍",
  tooth: "颌",
  hide: "皮",
  limb: "肢",
  gut: "腑",
  spirit: "神",
};

/**
 * 一行候选。
 *
 * 刻意**不显示 `organ.tags`**：那些是引擎钩子的英文 id（`night-eye`／`armor`），
 * 摆在楷体古卷界面里既难看又泄露内部实现。玩家需要的 tag 信息由「门槛提示」以中文
 * 器官名的形式给出（见 eventVm 的 describeOrganTag），此处只留槽位与名号。
 */
function organRow(organ: OrganDef, highlight: boolean): HTMLElement {
  return el(
    "div",
    { class: `molt__row${highlight ? " is-target" : ""}`, title: organ.desc },
    [
      el("span", { class: "molt__slot", text: SLOT_NAMES[organ.slot] ?? organ.slot }),
      el("span", { class: "molt__name", text: organ.name }),
    ],
  );
}

function statModLine(organ: OrganDef): string {
  const mods = organ.statMods;
  if (!mods) return "";
  const parts: string[] = [];
  for (const key of STAT_ORDER) {
    const value = mods[key];
    if (value === undefined || value === 0) continue;
    parts.push(`${STAT_LABELS[key]} ${formatSigned(value)}`);
  }
  return parts.join("　");
}

/**
 * 播一次开奖。resolve 于玩家点「承此形」之后 —— 蜕变是一世里最大的岔路口，
 * 不该被自动关掉的过场一晃而过。
 */
export async function playMoltReveal(
  host: HTMLElement,
  molt: MoltResult,
  _content: TaleContent,
): Promise<void> {
  const reduced = prefersReducedMotion();
  const candidates = molt.candidates;
  const chosenIdx = Math.max(0, candidates.findIndex((organ) => organ.id === molt.chosen.id));
  const rgb = ESSENCE_RGB[molt.essenceType];

  const strip = el("div", { class: "molt__strip" });
  if (reduced) {
    strip.append(organRow(molt.chosen, true));
  } else {
    for (let loop = 0; loop <= LOOPS; loop += 1) {
      candidates.forEach((organ, idx) => {
        strip.append(organRow(organ, loop === LOOPS && idx === chosenIdx));
      });
    }
  }

  const detail = el("div", { class: "molt__detail" }, [
    el("div", { class: "molt__detail-name", text: molt.chosen.name }),
    el("p", { class: "molt__detail-desc", text: molt.chosen.desc }),
    statModLine(molt.chosen)
      ? el("div", { class: "molt__detail-mods", text: statModLine(molt.chosen) })
      : null,
    molt.chosen.combatSkill
      ? el("div", { class: "molt__detail-skill" }, [
          el("span", { class: "molt__skill-tag", text: "战技" }),
          el("b", { text: molt.chosen.combatSkill.name }),
          el("span", { class: "molt__skill-desc", text: molt.chosen.combatSkill.desc }),
        ])
      : null,
  ]);

  const confirm = el("button", {
    class: "btn btn--seal molt__confirm",
    text: "承此形",
    attrs: { type: "button" },
  });

  const fx = el("div", { class: "molt__fx" });
  const card = el("div", { class: "molt__card" }, [
    el("div", { class: "molt__kicker" }, [
      el("span", { text: "蛰伏一季" }),
      el("em", { text: `${ESSENCE_LABELS[molt.essenceType]}之精气尽化` }),
    ]),
    el("div", { class: "molt__window" }, [strip, el("div", { class: "molt__band" })]),
    detail,
    confirm,
  ]);

  const overlay = el(
    "div",
    { class: "overlay molt", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "蜕变开奖" } },
    [fx, card],
  );
  host.append(overlay);

  const particles = reduced ? null : createParticleLayer(fx, { ambientRate: 3, rise: 30 });

  if (!reduced) {
    const targetRow = LOOPS * candidates.length + chosenIdx;
    const offset = (targetRow - 1) * ROW_H;
    const animation = strip.animate(
      [{ transform: "translateY(0)" }, { transform: `translateY(${-offset}px)` }],
      { duration: SPIN_MS, easing: "cubic-bezier(.12,.76,.04,1)", fill: "forwards" },
    );
    await animation.finished.catch(() => undefined);
    card.classList.add("is-settled");
    const rect = fx.getBoundingClientRect();
    particles?.burst(rect.width / 2, rect.height * 0.46, rgb, 26);
  } else {
    card.classList.add("is-settled");
  }

  detail.classList.add("is-open");
  await sleep(reduced ? 0 : 180);

  await new Promise<void>((resolve) => {
    confirm.addEventListener("click", () => resolve(), { once: true });
    confirm.focus();
  });

  overlay.classList.add("is-closing");
  await sleep(reduced ? 0 : 260);
  particles?.dispose();
  overlay.remove();
}
