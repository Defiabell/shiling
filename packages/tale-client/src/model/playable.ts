/**
 * 渲染入口的护栏：**这一帧屏幕上还有路可走吗**（纯函数，可单测）。
 *
 * ## 它挡的是哪一类事故
 * 2026-08-14 owner 试玩撞到一个死局：四颗行动与六处去处全灰、副文案全是「先了此事」，
 * 而中央该出事件卡的地方是空的 —— 屏幕上一个能推进局面的按钮都没有，键盘也点不出东西来。
 * 那一类状态的共同形状是「**界面认为有待办，却没有把待办画出来**」：`pendingEvent` 与
 * `center` 是两个各自赋值的字段，两次写之间抛一次错就会脱钩，而脱钩之后没有任何回头路。
 *
 * 结构性修复有两层，这是第二层：
 * 1. 事件与卡片合成 `CenterVm` 的**同一个** case（有事件必有卡）—— 脱钩在类型层就构造不出来；
 * 2. **每一帧渲染之前**都问一次「还有路吗」。答不出路的帧不许上屏 —— 调用方拿到 reason
 *    就换一张带出口的卡，并把这次违规记到 `debugSnapshot().integrity` 里。
 *
 * ## 为什么判据放在这里而不是写成注释约定
 * owner 立过一条规矩：「没跑成」必须在代码层与「没发现问题」可区分。所以这条不变量是一个
 * **有返回值的函数 ＋ 一组单测**（每种违规形状各一条），而不是一句「注意保持两者一致」。
 * 它不读 DOM、不碰引擎，输入就是 app 递给 `renderPlay` 的那几样东西。
 */

import { approachOf, clashOf, type TaleState } from "@shiling/tale-sim";
import type { ActionButtonVm } from "./actionVm.js";
import type { DestinationButtonVm } from "./destinationVm.js";
import type { CenterVm } from "../screens/playScreen.js";

export interface PlayableInput {
  state: TaleState;
  center: CenterVm;
  /** 演出播放中（此刻**全部**按钮都该是灰的，那不是死局） */
  busy: boolean;
  /** 已经过 `blocked` 折算之后的那一排（app 递给 `renderPlay` 的原物） */
  actions: readonly ActionButtonVm[];
  destinations: readonly DestinationButtonVm[];
}

/**
 * 检查这一帧。返回 `null` ＝ 有路可走；返回字符串 ＝ 一句能直接进日志的违规原因。
 *
 * 三条判据，都对着实机上真出现过（或结构上能出现）的形状：
 *
 * 1. **事件卡在场，却一条抉择都点不开** —— 事件卡自己那句「按下方行动另寻他途」是假话：
 *    事件在场时下方行动恰恰是全灰的。这一条同时兜住「内容缺兜底分支」与「卡片建错了」。
 * 2. **遭遇未收束，却没有入口** —— 遭遇屏不在中央，又没有「迎敌」那颗按钮，那头兽就
 *    悬在状态里，而行动面板会因为 `clashOf` 非空而整排灰掉（「战事未了」）。
 * 3. **兜底：一条出路都数不出来** —— 上面两条之外的任何形状（含将来新加的 center）。
 *    活着、不在演出、屏幕上却没有任何可点的东西，就是死局，不必先知道它是怎么来的。
 *
 * 演出中（`busy`）与已死（`!alive`，那时中央必有「瞑目」）都不算 —— 前者是暂时全灰，
 * 后者的出口由死亡演出接手。
 */
export function checkPlayable(input: PlayableInput): string | null {
  const { state, center, busy } = input;
  if (busy) return null;

  /*
   * [交锋节奏] **演出中的那一帧不是死局** —— 而且这一条不靠 `busy` 那个布尔。
   *
   * 逐拍演出期间全部按钮都是灰的（那正是它该有的样子），若只由 `busy` 兜着，
   * 「app 忘了置 busy」与「界面真的没路了」在这一层就分不开 —— 而这份护栏存在的
   * 全部理由就是要把这两件事分开（头注：「没跑成」必须与「没发现问题」可区分）。
   * 现在播放态是 `CenterVm` 里的一位（`body.playback`），所以判据读的是**画面本身**。
   */
  if (center.kind === "encounter" && center.body.kind === "clash" && center.body.playback) {
    return null;
  }

  /*
   * 开机那张空白卡（`bootCenter()`）**不许出现在 play 屏上**。
   *
   * 它 `title`／`media` 皆空、`lines` 为空、没有按钮 —— 渲染出来就是一个什么都没有的
   * 圆角矩形，正是 owner 截图里中央那块空白。它合法出现的窗口只有「还没进 play 屏」那一瞬；
   * 一旦跟状态栏一起上屏，说明 `startLife` 半路抛错、这一世的降世卡从来没被摆上去。
   * 行动面板此刻多半还是能点的（所以不会被下面那条兜底判据抓到），但玩家看到的是一屏
   * 说不出话的空白 —— 那件事本身就该吵。
   */
  if (center.kind === "narration" && center.key === BOOT_CENTER_KEY) {
    return "中央还是开机那张空白卡 —— 这一世的降世卡没有摆上去（`startLife` 多半半路抛了错）";
  }

  if (center.kind === "event") {
    const openable = center.card.choices.filter((choice) => choice.enabled);
    if (openable.length === 0) {
      return `事件「${center.card.eventId}」一条抉择都点不开，而事件在场时行动面板整排锁死 —— 无路可走`;
    }
    return null;
  }

  const encounterLive = approachOf(state) !== null || clashOf(state) !== null;
  if (encounterLive && center.kind !== "encounter") {
    const hasEntry = center.kind === "narration" && center.continueLabel !== null;
    if (!hasEntry) {
      return `遭遇未收束（${state.encounter?.enemyId ?? "?"}）却没有进遭遇屏的入口 —— 行动面板会因此整排锁死`;
    }
    return null;
  }

  if (!state.alive) return null;

  const exits =
    input.actions.filter((action) => action.enabled).length +
    input.destinations.filter((dest) => dest.enabled).length +
    (center.kind === "narration" && center.continueLabel !== null ? 1 : 0) +
    (center.kind === "encounter" ? 1 : 0);
  if (exits === 0) {
    return `屏幕上一条出路都没有（center=${center.kind}）—— 行动、去处、继续、遭遇全无`;
  }
  return null;
}

/** 违规时顶上去的那张卡：一句人话 ＋ 一颗真能按的按钮（`onContinue` 会把 center 复位）。 */
export const ESCAPE_CONTINUE_LABEL = "脱　困";

/** 开机／换世那张空白卡的 key（`app.bootCenter()` 与本文件共用这一个字面量）。 */
export const BOOT_CENTER_KEY = "boot";
