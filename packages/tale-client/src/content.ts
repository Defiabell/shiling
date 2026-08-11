/**
 * 开发期内容源。
 *
 * B2 的 `@shiling/tale-content` 就绪后，B5 只改这一个文件的 import：
 * `import { TALE_CONTENT as CONTENT } from "@shiling/tale-content";`
 * 界面其余部分一律从这里取 content，不许再有第二处 import 内容库 ——
 * 换真内容时才不会漏改。
 */

import { FIXTURE_CONTENT } from "@shiling/tale-sim/test/fixtures";
import type { TaleContent } from "@shiling/tale-sim";

export const CONTENT: TaleContent = FIXTURE_CONTENT;

/** 开发期标记：真内容接入后置 false，界面上的「fixture 内容」水印随之消失。 */
export const USING_FIXTURE_CONTENT = true;
