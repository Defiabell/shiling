/**
 * 「异变」揭示演出（S1）—— 凑齐一条器官组合的那一刻。
 *
 * ## 它为什么值一个专门的演出（而不是日志里一行字）
 * 组合对玩家是**隐藏**的：图鉴上只有「？」，配方一个字都不列。于是发现的那一瞬是这套设计
 * 的全部回报 —— 若它只是 notices 里的一行「你凑齐了溃咬」，那「意料之外」就被读成了
 * 「哦，又解锁了一个」。这张卡的结构照着「意外但合理」写：
 *
 * 1. **先亮配方**：两枚（或三枚）已在身上的器官名并排浮出，中间一个「＋」——
 *    玩家第一眼看到的是**自己攒的那几件东西**，而不是一个新名词。
 * 2. **再给因果**（`SynergyDef.reveal`）：「齿咬开的口子，正好是毒进得去的地方。」
 *    这一句是「情理之中」的唯一载体。它排在名号**之前** —— 先懂道理，再知道它叫什么。
 * 3. **最后落名号与那一手的账**：伤害／效果／冷却／代价，与搏杀屏按钮同一套读法。
 *
 * ## 与蜕变开奖（`moltReveal`）的分工
 * 蜕变是「开奖」：有滚动、有悬念，因为结果是引擎摇出来的。异变**没有悬念** ——
 * 它是玩家自己凑出来的，所以这里不滚动、不掷骰，只做「浮现」：那是确认，不是抽奖。
 * 同蜕变的一处纪律：`resolve` 在玩家按下按钮之后才落，一世里最大的岔路口不该被一晃而过。
 */

import type { SynergyDef, TaleContent } from "@shiling/tale-sim";
import { el } from "../dom.js";
import { skillMulLine } from "../model/format.js";
import { prefersReducedMotion, sleep } from "./motion.js";
import { createParticleLayer } from "./particles.js";

/** 异变的朱砂色（与「异」印同一色）—— 不借精气四色：它不属于任何一型。 */
const RGB = "196,74,58";

/** 「异变再现」自动收之前停留多久（够读完名号与那一手的账，又不至于挡路）。 */
const REPEAT_HOLD_MS = 2600;

/**
 * 播一次异变揭示。
 *
 * @param first 这是**头一次**发现（图鉴里还没有它）—— 第二世重新凑齐同一条时演出降一档：
 *   标题换成「异变再现」、不放粒子、不等玩家点（那时它已经是玩家熟悉的东西，
 *   拦一下反而烦）。判据来自 `Bloodline.knownSynergyIds`，引擎不认识图鉴。
 */
export async function playSynergyReveal(
  host: HTMLElement,
  synergy: SynergyDef,
  content: TaleContent,
  first: boolean,
): Promise<void> {
  const reduced = prefersReducedMotion();
  const organNames = synergy.organIds.map(
    (id) => content.organs.find((organ) => organ.id === id)?.name ?? id,
  );

  const recipe = el(
    "div",
    { class: "synergy__recipe" },
    organNames.flatMap((name, idx) => [
      ...(idx === 0 ? [] : [el("span", { class: "synergy__plus", text: "＋" })]),
      el("b", { class: "synergy__organ", text: name }),
    ]),
  );

  const confirm = el("button", {
    class: "btn btn--seal synergy__confirm",
    text: first ? "记入图鉴" : "知道了",
    attrs: { type: "button" },
  });

  const fx = el("div", { class: "synergy__fx" });
  const card = el("div", { class: `synergy__card${first ? " is-first" : ""}` }, [
    el("div", { class: "synergy__kicker" }, [
      el("span", { class: "synergy__seal", text: "异" }),
      el("span", { text: first ? "异　变" : "异变再现" }),
    ]),
    recipe,
    // 因果排在名号之前：先懂道理，再知道它叫什么（见文件头第 2 条）
    el("p", { class: "synergy__reveal", text: synergy.reveal }),
    el("div", { class: "synergy__name", text: synergy.name }),
    el("p", { class: "synergy__desc", text: synergy.skill.desc }),
    el("div", { class: "synergy__stat", text: skillMulLine(synergy.skill, content.tuning) }),
    el("p", {
      class: "synergy__foot",
      text: first
        ? "此后搏杀屏上多一颗「异」印的按钮。已记入图鉴 —— 下一世也可以再去凑。"
        : "搏杀屏上又有它了。",
    }),
    confirm,
  ]);

  const overlay = el(
    "div",
    {
      class: "overlay synergy",
      attrs: { role: "dialog", "aria-modal": "true", "aria-label": `异变：${synergy.name}` },
    },
    [fx, card],
  );
  host.append(overlay);

  const particles = reduced || !first ? null : createParticleLayer(fx, { ambientRate: 2, rise: 26 });
  await sleep(reduced ? 0 : 120);
  card.classList.add("is-open");
  if (particles) {
    const rect = fx.getBoundingClientRect();
    particles.burst(rect.width / 2, rect.height * 0.42, RGB, 22);
  }

  /*
   * **首次发现才拦人**：一世里最大的岔路口不该被一晃而过（同蜕变开奖的纪律）。
   * 而第二世重新凑齐同一条时它已经是熟人 —— 再拦一下就是给「每回合必点次数」加码
   * （计划纪律里明写不许），所以那一档**自动收**，只是仍留着按钮让人提前跳过。
   */
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    confirm.addEventListener("click", finish, { once: true });
    confirm.focus();
    if (!first) setTimeout(finish, reduced ? 600 : REPEAT_HOLD_MS);
  });

  overlay.classList.add("is-closing");
  await sleep(reduced ? 0 : 240);
  particles?.dispose();
  overlay.remove();
}
