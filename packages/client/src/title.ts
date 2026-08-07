import { generatePaperNoiseDataUrl } from "./render/atmosphere.js";
import { PALETTE } from "./render/palette.js";

/**
 * 标题画面（Task 9）：全屏纸色噪底遮罩，压在已经在跑的 3D 场景（main.ts 把
 * `started` 锁在 false，世界静止在 tick 0，但渲染循环照常跑——见该文件的 gate
 * 注释）之上，让"活的青丘"透过半透明纸色背景隐约可见，呼应水墨卷轴展开的观感。
 * 点击「入　山」后本模块自己负责 600ms 淡出动画 + 卸载 DOM，再回调 onEnter——
 * main.ts 不需要知道淡出的具体时长/实现，只需要在 onEnter 里把 `started` 置真。
 */

const OVERLAY_ID = "shiling-title-overlay";
const STYLE_ID = "shiling-title-style";
const NOISE_TILE_SIZE = 256;

/** 点击到调用 onEnter 之间的墨色淡出时长——brief 明确要求 600ms，CSS transition 与 setTimeout 必须用同一个数，单一数据源。 */
const FADE_MS = 600;

function hexToCssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}
function hexToRgbTriplet(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `${r}, ${g}, ${b}`;
}

const inkHex = hexToCssColor(PALETTE.outlineInk); // #14161a — 墨：标题字/按钮底色
const inkRgb = hexToRgbTriplet(PALETTE.outlineInk);
const cinnabarHex = hexToCssColor(PALETTE.cinnabar); // #c23b22 — 朱砂：按钮 hover 描边

/**
 * 纸白——与 hud.ts 私有的 `UI.paper` 同一个字面量（0xe8e2d3），但那个常量没有
 * export（HUD-only neutral，见 hud.ts 头注释），这里独立声明一份而不是改动
 * hud.ts 的可见性：两处都是"UI-only、不在共享 PALETTE 里"的同类做法，各自
 * 独立成一个 module-local 常量，与本工程"每个模块自成一体"的既有惯例一致
 * （atmosphere/hud/screenFx 都各自维护自己的 style/color 常量，不共享一个
 * 全局 UI 模块）。
 */
const PAPER_HEX = "#e8e2d3";
const PAPER_RGB = "232, 226, 211";

/**
 * 字体子集扩容（Task 9 决策，见 task-9-report.md「字体子集决策」一节）：
 * Task 8 给 HUD 请求的 30 字子集（28 汉字 + "R" + 破折号）不含标题画面新增的
 * 「山海之间，吞灵化形」「入　山」用到的汉字。选择方案 A——用同一套
 * fonts.googleapis.com `text=` 技术重新请求一份**并集**子集（旧 31
 * codepoint ∪ 新增），覆盖后原地替换 `public/fonts/mashanzheng.woff2`，而
 * 不是二选一里的方案 B（新增文案直接退回楷体 fallback）：标题「食灵」120px
 * 是全场最大的文字，字体一旦按字符退化会非常显眼地割裂，且 Google 按
 * `text=` 请求的子集文件本身很小，并入后依旧是单一小文件，不存在"文件太大"
 * 的顾虑。
 *
 * 新增的 8 个汉字 codepoint：山 海 之 间 吞 化 形 入，外加 　(表意空格
 * U+3000，按钮文案「入　山」中间那个全角空格) 和 ，(全角逗号 U+FF0C，字幕
 * 「山海之间，吞灵化形」里的那个逗号——第一版手工枚举漏了这个标点，被 code
 * review 抓到；教训是标点必须跟着完整字符串一起核对，不能只数汉字)。
 *
 * **括号剥除 + 二次裁剪（controller ruling，Task 9 review 第二轮）**：标题/
 * 字幕最初按 plan/brief 字面渲染成"《食灵》"/"「山海之间，吞灵化形」"，但
 * plan 文本里的书名号/引号是**引用记号**，不是要渲染的字符——Task 8 死亡
 * 界面（身死／魂归青丘／食灵）和 README 都不带括号，标题画面统一改成裸字
 * "食灵"/"山海之间，吞灵化形"（见下方 `showTitle()` 里的详细注释）。剥除后
 * 《》「」这 4 个括号 codepoint 不再被任何运行时字符串用到，顺手把子集从
 * 45 重新裁剪到 41——用 fontTools `TTFont(...).getBestCmap()` 把新文件的
 * cmap 逐一对照 hud.ts + title.ts 两个消费方**实际的 textContent 字面量**
 * （不是手工枚举的"应该"字符表）验证过恰好 41/41 双向精确匹配（零缺口、
 * 零多余字形），见 task-9-report.md。
 */
const FONT_CSS = `
@font-face {
  font-family: "Ma Shan Zheng";
  src: url("/fonts/mashanzheng.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
`;

function ensureStyleInjected(noiseDataUrl: string): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
${FONT_CSS}
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  z-index: 30; /* 高于 hud.ts 的 #hud(10)、screenFx.ts(8)、atmosphere.ts 的纸纹/暗角(5/6)——标题必须盖住一切 */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  /* 半透纸色 + 噪点纹理用 background-blend-mode 叠在同一层背景上（单 div 两层
     背景合成，不必再像 atmosphere.ts 那样叠两个 div）：0.88 的纸色不透明度
     让背后"活的青丘"透出朦胧轮廓，呼应"卷轴展开"的水墨观感。 */
  background-color: rgba(${PAPER_RGB}, 0.88);
  background-image: url(${noiseDataUrl});
  background-repeat: repeat;
  background-size: ${NOISE_TILE_SIZE}px ${NOISE_TILE_SIZE}px;
  background-blend-mode: multiply;
  opacity: 1;
  transition: opacity ${FADE_MS}ms ease;
  font-family: "Ma Shan Zheng", "STKaiti", "KaiTi", serif;
}
#${OVERLAY_ID}.title-fade-out {
  opacity: 0;
  pointer-events: none;
}
.title-main {
  writing-mode: vertical-rl;
  margin: 0;
  font-size: 120px;
  font-weight: 400;
  letter-spacing: 0.15em;
  color: ${inkHex};
  text-shadow: 3px 3px 0 rgba(${PAPER_RGB}, 0.5);
}
.title-sub {
  margin: 0;
  font-size: 22px;
  letter-spacing: 0.3em;
  color: rgba(${inkRgb}, 0.78);
}
.title-enter {
  margin-top: 12px;
  padding: 14px 44px;
  font-family: "Ma Shan Zheng", "STKaiti", "KaiTi", serif;
  font-size: 28px;
  letter-spacing: 0.2em;
  background: ${inkHex};
  color: ${PAPER_HEX};
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 200ms ease, transform 200ms ease;
}
.title-enter:hover,
.title-enter:focus-visible {
  border-color: ${cinnabarHex};
  transform: scale(1.04);
}
`;
  document.head.appendChild(style);
}

/**
 * 挂载全屏标题遮罩；点击「入　山」触发 600ms 淡出，淡出结束后自己把 DOM 摘掉
 * 再调 onEnter（main.ts 在 onEnter 里把 `started` 置 true，具体见 main.ts 头部
 * gate 注释）。`{ once: true }` 防止淡出过程中重复点击二次触发。
 */
export function showTitle(onEnter: () => void): void {
  // 幂等 guard，对齐 atmosphere.ts 的 mountPaperOverlay()/screenFx.ts 的
  // ensureOverlayDiv() 同一套"重复调用不重复挂载"惯例——main.ts 目前只在
  // 模块顶层调用一次，不会真的撞上，但保持这个约定比让 showTitle 是本文件
  // 唯一的例外更省心（且能防住"以后不小心调了第二次"的隐性 bug：没有这个
  // guard 的话第二次调用会重复插入一份 DOM/监听器，而不是像现在这样直接
  // no-op）。
  if (document.getElementById(OVERLAY_ID)) return;

  const noiseDataUrl = generatePaperNoiseDataUrl();
  ensureStyleInjected(noiseDataUrl);

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;

  // 剥括号惯例（controller ruling，Task 9 review）：plan/brief 文本里的
  // 《》「」是引用记号，不是要渲染的字符——Task 8 死亡界面（身死／魂归青丘——
  // 按 R 转世／食灵）和 README 的写法都不带括号，标题画面理应统一同一套惯例，
  // 而不是按字面照抄 brief 里的引用符号。裸字「食灵」在 120px 竖排书法下也
  // 更有笔意（书名号会在这个字号下显得像多余的框线）。
  const main = document.createElement("h1");
  main.className = "title-main";
  main.textContent = "食灵";

  const sub = document.createElement("p");
  sub.className = "title-sub";
  sub.textContent = "山海之间，吞灵化形";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "title-enter";
  button.textContent = "入　山"; // U+3000 表意全角空格，视觉上比普通空格更宽——呼应《食灵》的疏朗排布

  overlay.append(main, sub, button);
  document.body.appendChild(overlay);

  button.addEventListener(
    "click",
    () => {
      overlay.classList.add("title-fade-out");
      window.setTimeout(() => {
        overlay.remove();
        onEnter();
      }, FADE_MS);
    },
    { once: true },
  );
}
