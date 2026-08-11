/**
 * 列传卷轴屏。
 *
 * 卷轴刻意做成**暗色绢本**而不是米白纸：整套界面是弱光玻璃＋水墨，一屏纯白纸会在夜里
 * 直接晃眼，且与前面所有屏割裂。用暖炭底 ＋ 绢纹 ＋ 铜色轴头，读起来仍是「夜里展一卷旧传」。
 */

import { el } from "../dom.js";
import { paperGrain } from "../art/placeholders.js";
import type { ChronicleVm } from "../model/chronicleVm.js";

export interface ChronicleProps {
  vm: ChronicleVm;
  onReincarnate(): void;
}

export function renderChronicle(props: ChronicleProps): HTMLElement {
  const { vm } = props;
  return el("div", { class: `screen screen--chronicle ending-${vm.ending}` }, [
    el("div", { class: "chronicle__wrap" }, [
      el("div", { class: "scroll" }, [
        el("div", { class: "scroll__rod scroll__rod--top" }),
        el(
          "article",
          {
            class: "scroll__paper",
            style: `background-image:url("${paperGrain(0.05)}")`,
          },
          [
            el("div", { class: "scroll__stamp", text: vm.endingLabel }),
            el("h1", { class: "scroll__title", text: vm.title }),
            // 元信息跟着正文用汉字数字：B5 把列传模板改成史书体（「凡历四岁，成器官二」）后，
            // 这里若还写「寿 4 岁」，同屏相邻三行就会并置两种数字体系。
            el("div", { class: "scroll__meta" }, [
              el("span", { text: `寿${vm.yearsCn}岁` }),
              el("i", { text: "·" }),
              el("span", { text: `器官${vm.organCountCn}` }),
              el("i", { text: "·" }),
              el("span", { text: vm.epitaph }),
            ]),
            // 「其形」：终局形貌的立绘，靠右浮着让正文绕排 —— 旧书里的插图就是这么嵌的。
            // 画像随器官数分阶（幼兽／成兽／近神），所以它也是这一世 build 的一句总结。
            el("figure", { class: "scroll__figure" }, [
              el("img", { attrs: { src: vm.portrait.src, alt: "", "data-portrait": "1" } }),
              el("figcaption", { text: `其形　${vm.portrait.label}` }),
            ]),
            el("p", { class: "scroll__opening", text: vm.opening }),
            vm.middle.length > 0
              ? el(
                  "ol",
                  { class: "scroll__middle" },
                  vm.middle.map((line) => el("li", { text: line })),
                )
              : null,
            vm.closing ? el("p", { class: "scroll__closing", text: vm.closing }) : null,
            el("div", { class: "scroll__praise" }, [
              el("span", { class: "praise__prefix", text: vm.praisePrefix }),
              el("p", { class: "praise__text", text: vm.praise }),
            ]),
          ],
        ),
        el("div", { class: "scroll__rod scroll__rod--bottom" }),
      ]),
      el("div", { class: "chronicle__foot" }, [
        el("div", { class: "chronicle__gain" }, [
          el("div", { class: "chronicle__gain-row" }, [
            el("span", { text: "血统" }),
            el("b", { text: `+${vm.bloodlineGain}`, attrs: { "data-gain": "1" } }),
          ]),
          el("em", { text: "蜕变、寿数与登神所积，可用于解开新的神种。" }),
        ]),
        el("button", {
          class: "btn btn--seal",
          text: "转　世",
          attrs: { type: "button", "data-reincarnate": "1" },
          on: { click: () => props.onReincarnate() },
        }),
      ]),
    ]),
  ]);
}
