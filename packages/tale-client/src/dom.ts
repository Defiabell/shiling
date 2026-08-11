/**
 * 极小 DOM 构建助手。
 *
 * 不引框架的理由：这是一个只有 5 个屏、状态全在引擎里的界面，虚拟 DOM 的收益抵不上
 * 依赖成本；但手写 `document.createElement` 三行一个元素会让屏幕代码淹没在样板里。
 * 这里只做「一句话造一棵子树」这一件事。
 */

export type Child = Node | string | null | undefined | false;

export interface ElAttrs {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  title?: string;
  style?: string;
  /** data-* 与 aria-* 一并走这里 */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs.class) node.className = attrs.class;
  if (attrs.id) node.id = attrs.id;
  if (attrs.title) node.title = attrs.title;
  if (attrs.style) node.setAttribute("style", attrs.style);
  if (attrs.text !== undefined) node.textContent = attrs.text;
  if (attrs.html !== undefined) node.innerHTML = attrs.html;
  if (attrs.attrs) {
    for (const [key, value] of Object.entries(attrs.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(key, String(value));
    }
  }
  if (attrs.on) {
    for (const [key, handler] of Object.entries(attrs.on)) {
      if (handler) node.addEventListener(key, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

/** 下一帧（两次 rAF：第一帧让浏览器把新节点算进布局，第二帧改类才有过渡）。 */
export function nextFrame(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}
