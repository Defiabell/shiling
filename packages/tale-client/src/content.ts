/**
 * 内容源 —— 全客户端**唯一**一处 import 内容库的地方。
 *
 * B5 已把开发期的 `FIXTURE_CONTENT`（tale-sim 的 3 事件最小 fixture）换成 B2 交付的
 * 真内容 `TALE_CONTENT`（44 事件／12 器官／3 神种／8 敌人／列传模板）。界面其余部分
 * 一律从这里取 content，不许再有第二处 import 内容库 —— 换内容时才不会漏改。
 */

import { TALE_CONTENT } from "@shiling/tale-content";
import type { TaleContent } from "@shiling/tale-sim";

export const CONTENT: TaleContent = TALE_CONTENT;

/** 开发期标记：真内容已接入，题字画面的「fixture 内容」水印随之消失。 */
export const USING_FIXTURE_CONTENT = false;
