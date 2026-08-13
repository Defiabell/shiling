/**
 * 「秘藏」揭示演出（S2）—— 在某一处摸到那件只有到过才知道的东西。
 *
 * ## 它与「异变」（`synergyReveal`）是同一条设计的两半
 * 组合藏的是**配方**（凑齐才知道自己凑了什么），去处藏的是**里头有什么**
 * （门槛写在按钮上，但潭底有什么不下去就不知道）。两者的「情理之中」都靠一句因果，
 * 所以这张卡照抄那边的顺序，一处不改：
 *
 * 1. **先亮地方**：这一处的名号与地貌 —— 玩家第一眼看到的是**自己走到的那个地方**。
 * 2. **再给因果**（`TreasureDef.reveal`）：「潭底没有泥，只有一层旧鳞……」
 *    这一句排在名号**之前** —— 先懂道理，再知道它叫什么。
 * 3. **最后落名号与它是什么**。
 *
 * ## 与异变的两处刻意不同
 * - **色**：异变是朱砂（不属于任何精气型），秘藏用**赭金**——它是从地里挖出来的东西。
 * - **重复发现**：秘藏一世只得一次（`once` 事件），但**跨世可以再得**（图鉴记的是
 *   `Bloodline.foundTreasureIds`，而这一世的 `state.foundTreasureIds` 从零开始）。
 *   第二世再得同一件时演出降一档并自动收 —— 与异变逐字同解（纪律：不得增加每回合必点次数）。
 */

import type { DestinationDef, TreasureDef } from "@shiling/tale-sim";
import { el } from "../dom.js";
import { prefersReducedMotion, sleep } from "./motion.js";
import { createParticleLayer } from "./particles.js";

/** 秘藏的赭金色 —— 与异变的朱砂分开，好让两种揭示在余光里就分得出。 */
const RGB = "182,138,62";

/** 「故地重得」自动收之前停留多久（与异变那一档同一个数）。 */
const REPEAT_HOLD_MS = 2600;

/**
 * 播一次秘藏揭示。
 *
 * @param place 这件秘藏属于哪一处（名号与地貌都从它取 —— 秘藏本身不重复写地方）
 * @param first 这是**头一次**得到它（图鉴里还没有）。判据来自 `Bloodline.foundTreasureIds`，
 *   引擎不认识图鉴，所以差集里报的每一件它都当成「新的」。
 */
export async function playTreasureReveal(
  host: HTMLElement,
  treasure: TreasureDef,
  place: DestinationDef,
  first: boolean,
): Promise<void> {
  const reduced = prefersReducedMotion();

  const confirm = el("button", {
    class: "btn btn--seal treasure__confirm",
    text: first ? "记入图鉴" : "知道了",
    attrs: { type: "button" },
  });

  const fx = el("div", { class: "treasure__fx" });
  const card = el("div", { class: `treasure__card${first ? " is-first" : ""}` }, [
    el("div", { class: "treasure__kicker" }, [
      el("span", { class: "treasure__seal", text: "秘" }),
      el("span", { text: first ? "秘　藏" : "故地重得" }),
    ]),
    // 先亮地方：玩家第一眼看到的是自己走到的那个地方（见文件头第 1 条）
    el("div", { class: "treasure__place" }, [
      el("b", { class: "treasure__placeName", text: place.name }),
      el("em", { class: "treasure__placeDesc", text: place.desc }),
    ]),
    // 因果排在名号之前（见文件头第 2 条）
    el("p", { class: "treasure__reveal", text: treasure.reveal }),
    el("div", { class: "treasure__name", text: treasure.name }),
    el("p", { class: "treasure__desc", text: treasure.desc }),
    el("p", {
      class: "treasure__foot",
      text: first
        ? "已记入图鉴 —— 此后转世也记得青丘的这一处。"
        : "又摸到了同一件东西。",
    }),
    confirm,
  ]);

  const overlay = el(
    "div",
    {
      class: "overlay treasure",
      attrs: { role: "dialog", "aria-modal": "true", "aria-label": `秘藏：${treasure.name}` },
    },
    [fx, card],
  );
  host.append(overlay);

  const particles = reduced || !first ? null : createParticleLayer(fx, { ambientRate: 2, rise: 22 });
  await sleep(reduced ? 0 : 120);
  card.classList.add("is-open");
  if (particles) {
    const rect = fx.getBoundingClientRect();
    particles.burst(rect.width / 2, rect.height * 0.44, RGB, 20);
  }

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
