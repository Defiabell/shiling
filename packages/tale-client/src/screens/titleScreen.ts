/**
 * 题字画面。
 *
 * 背景是过场演出组件的 `hold` 模式（Ken Burns 缓推镜＋灵尘粒子），前景是题字与「入山」。
 * 之所以复用 cinematic 而不是自己写一段 CSS 背景：题字是计划点名的四处演出之一，
 * B4 换真图（乃至真视频）时应该和蜕变/死亡/登神走同一条替换路径。
 */

import { el } from "../dom.js";
import { inkArt } from "../art/placeholders.js";
import { createCinematic, type CinematicHandle } from "../fx/cinematic.js";

export interface TitleProps {
  /** 已历几世（0 = 头一回） */
  lives: number;
  bloodlinePoints: number;
  usingFixtureContent: boolean;
  onStart(): void;
}

export interface ScreenHandle {
  el: HTMLElement;
  dispose(): void;
}

export function renderTitle(props: TitleProps): ScreenHandle {
  const backdrop: CinematicHandle = createCinematic({
    media: { kind: "image", src: inkArt("title", "shiling-liezhuan", { width: 1600, height: 900 }) },
    durationMs: 6000,
    hold: true,
    skippable: false,
    tintRgb: "232,180,95",
    motion: "in",
    label: "青丘夜山，月出东岭",
    className: "cine--title",
  });

  const enter = el("button", {
    class: "btn btn--seal title__enter",
    text: props.lives > 0 ? "再入青丘" : "入　山",
    attrs: { type: "button", "data-start": "1" },
    on: { click: () => props.onStart() },
  });

  const root = el("div", { class: "screen screen--title" }, [
    backdrop.el,
    el("div", { class: "title__inner" }, [
      el("div", { class: "title__mark" }, [
        // 朱砂印当「藏书印」用：绝对定位在题字右上角、微微歪着盖。
        // 早先把它排在「列　传」左边，读出来是「传 列 传」——一个字重复两遍。
        el("span", { class: "title__seal", text: "传" }),
        el("div", { class: "title__zi", text: "食灵" }),
        el("div", { class: "title__rule" }),
        el("div", { class: "title__sub", text: "列　传" }),
      ]),
      el("p", {
        class: "title__lede",
        text: "一缕食灵凭神种降世，托身青丘幼兽。吞精气以定形，历抉择以成德；寿尽或横死，则有列传一篇入于图谱，血统微存，再世复来。",
      }),
      enter,
      el("div", { class: "title__foot" }, [
        props.lives > 0
          ? el("span", { text: `已历 ${props.lives} 世 · 血统 ${props.bloodlinePoints}` })
          : el("span", { text: "尚无前传" }),
        props.usingFixtureContent
          ? el("em", { class: "title__badge", text: "开发内容（fixture）" })
          : null,
      ]),
    ]),
  ]);

  return {
    el: root,
    dispose() {
      backdrop.dispose();
      root.remove();
    },
  };
}
