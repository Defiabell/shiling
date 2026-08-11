/**
 * `node --import ./tsResolveHook.mjs` 用的解析钩子：把 `./x.js` 改写成 `./x.ts`。
 *
 * ## 为什么需要它
 * B4 的生成脚本要读 tale-content 的真实内容（44 条 illustrationBrief ＋ visualTokens），
 * 否则就得在 gen 里抄一份 —— 抄本必然漂移，「剧情连贯」直接失守。
 *
 * Node 26 原生剥离 TS 类型，能直接 `import "./index.ts"`；但它**不会**把 TS 源码里
 * NodeNext 风格的 `./chronicle.js` 回写成 `./chronicle.ts`（这点已实测：
 * `ERR_MODULE_NOT_FOUND: .../tale-content/src/chronicle.js`）。而 tale-sim / tale-content
 * 全库都是 `.js` 后缀写法（给 vite/tsc 用的正确写法，不该为了 B4 去改）。
 * 所以在 resolve 阶段补这一步改写。
 *
 * ## 实现要点
 * 必须在调用 `nextResolve` **之前**改写 specifier。先调 `nextResolve` 再看结果不行 ——
 * 默认解析器发现文件不存在就直接抛 `ERR_MODULE_NOT_FOUND`，钩子没有机会补救。
 *
 * 只在「`.js` 不存在而同名 `.ts` 存在」时改写，所以对真实的 `.js` 文件零影响。
 */

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (specifier.endsWith(".js") && isRelative && context.parentURL?.startsWith("file:")) {
      let filePath;
      try {
        filePath = fileURLToPath(new URL(specifier, context.parentURL));
      } catch {
        filePath = undefined;
      }
      if (filePath && !existsSync(filePath) && existsSync(`${filePath.slice(0, -3)}.ts`)) {
        specifier = `${specifier.slice(0, -3)}.ts`;
      }
    }
    return nextResolve(specifier, context);
  },
});
