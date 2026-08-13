/**
 * 内容源 —— 全客户端**唯一**一处 import 内容库的地方，也是**唯一**一处热注入生成事件的地方。
 *
 * B5 已把开发期的 `FIXTURE_CONTENT`（tale-sim 的 3 事件最小 fixture）换成 B2 交付的
 * 真内容 `TALE_CONTENT`（51 事件／12 器官／3 神种／8 敌人／列传模板）。界面其余部分
 * 一律从这里取 content，不许再有第二处 import 内容库 —— 换内容时才不会漏改。
 *
 * ## [P2 一世一剧本] 热注入
 * 降世时 `tale-ai` 会按这一世的前提生成十六条专属事件，一批一批地回来。注入就是把它们
 * 接在手写池后面：引擎每次抽事件都现读 `content.events`，所以**接上去那一刻就生效**，
 * 不需要引擎知道任何事（架构红线 1：AI 产物只以内容形态进入）。
 *
 * 三条纪律：
 * 1. **`CONTENT` 是本包自己的一份副本**（`TALE_CONTENT` 的浅拷贝 ＋ 事件数组的拷贝）。
 *    直接注入 `TALE_CONTENT` 会污染那个所有包共享的常量 —— tale-content 的测试、
 *    tale-ai 的实验台都会读到上一局的生成事件。
 * 2. **替换数组而不是就地 push**：`setInjectedEvents` 每次都从手写池重新拼，所以
 *    「注入」是幂等的，同一批回调重放两次也不会出现两条同 id 的事件。
 * 3. **转世必须 `clearInjectedEvents`**：上一世的剧本是上一世的，留着就等于「每一局
 *    几乎都一样」——只是这次是 AI 写的那一半在重复。
 */

import { TALE_CONTENT } from "@shiling/tale-content";
import type { TaleContent, TaleEvent } from "@shiling/tale-sim";

/** 手写池（永远的底本）。注入只在它后面接，不改它一个字。 */
const WRITTEN_EVENTS: readonly TaleEvent[] = [...TALE_CONTENT.events];

export const CONTENT: TaleContent = { ...TALE_CONTENT, events: [...WRITTEN_EVENTS] };

/** 开发期标记：真内容已接入，题字画面的「fixture 内容」水印随之消失。 */
export const USING_FIXTURE_CONTENT = false;

/**
 * 热注入这一世的生成事件（**替换**上一次注入的那批，不是追加）。
 *
 * 传空数组等价于 `clearInjectedEvents`。返回注入后事件池的总数，方便调用方记日志。
 */
export function setInjectedEvents(events: readonly TaleEvent[]): number {
  const seen = new Set<string>(WRITTEN_EVENTS.map((event) => event.id));
  const fresh: TaleEvent[] = [];
  for (const event of events) {
    // 同 id 顶掉后来者：手写池的 id 优先，生成包内部撞 id 只留先者
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    fresh.push(event);
  }
  CONTENT.events = [...WRITTEN_EVENTS, ...fresh];
  return CONTENT.events.length;
}

export function clearInjectedEvents(): void {
  CONTENT.events = [...WRITTEN_EVENTS];
}

/** 当前注入的那些（调试快照与测试用）。 */
export function injectedEvents(): TaleEvent[] {
  return CONTENT.events.slice(WRITTEN_EVENTS.length);
}

/** 手写事件条数 —— 测试拿它断言「注入没有动手写池」。 */
export const WRITTEN_EVENT_COUNT = WRITTEN_EVENTS.length;
