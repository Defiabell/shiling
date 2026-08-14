/**
 * 真美术资源的路径与选取规则 —— 客户端**唯一**知道 `public/art/` 目录长什么样的地方。
 *
 * B4 交付 60 张图，命名是跨批次契约：事件图 `events/<event.id>.webp`、敌人头像
 * `enemies/<EnemyDef.id>.webp`、结局图 `endings/<EndingType>.webp`、玩家立绘三阶段、
 * 题字主视觉。**契约由 `test/artAssets.test.ts` 逐个文件对着磁盘核**（`<img>` 加载失败
 * 不报错，玩家看到的只是一块空图位 —— 这类漏接线在运行时是静默的，只能在测试里吵）。
 *
 * 纯字符串拼接，无 DOM，可直接进单测。
 */

import type { EndingType } from "@shiling/tale-sim";

/** `public/art/` 在 dev server 与 build 后的 URL 前缀。 */
export const ART_DIR = "/art/";

/** 玩家立绘的三个阶段（同一只兽的三个年纪，B4 用多参考图链条画出来的）。 */
export type PortraitStage = "cub" | "adult" | "neargod";

export const PORTRAIT_LABELS: Record<PortraitStage, string> = {
  cub: "幼兽",
  adult: "成兽",
  neargod: "近神",
};

const PORTRAIT_FILES: Record<PortraitStage, string> = {
  cub: "portraits/self-1-cub.webp",
  adult: "portraits/self-2-adult.webp",
  neargod: "portraits/self-3-neargod.webp",
};

/** 「成兽」这一阶的门槛（纯表现，引擎里没有对应常量）。 */
const ADULT_AT_ORGANS = 3;

/**
 * 「近神」这一阶的门槛。
 *
 * [2026-08-13] 原来它吃引擎的 `tuning.ascendMinOrgans`（当时登神要 5 件器官，于是
 * 「近神立绘 ⇔ 够格登神」是一条真的对应）。四道改动把器官件数从**所有**成道门槛里拿掉了
 * —— 登神现在看灵德与神兽，归山看寿与德。于是那条对应已经不存在，继续吃一个与形貌无关的
 * 门槛只会在下一次调参时静默错位。形貌分阶从此是**纯表现规则**，就写在表现层。
 */
const NEAR_DIVINE_AT_ORGANS = 5;

/**
 * 器官件数 → 形态阶段。`organCount` 含神种那一枚（`organIds[0]`），所以下限是 1。
 *
 * 一世平均蜕 3 件左右，于是绝大多数玩家会在一世里亲眼看到幼兽 → 成兽这一次形貌变化，
 * 而「近神」是要争的。
 */
export function portraitStage(organCount: number): PortraitStage {
  if (organCount >= NEAR_DIVINE_AT_ORGANS) return "neargod";
  if (organCount >= ADULT_AT_ORGANS) return "adult";
  return "cub";
}

export function portraitArt(stage: PortraitStage): string {
  return ART_DIR + PORTRAIT_FILES[stage];
}

/** 事件插图：`TaleEvent.illustration` 已含子目录（`events/<id>.webp`）。 */
export function eventArt(illustration: string): string {
  return ART_DIR + illustration;
}

/**
 * 敌人头像（1:1 胸像），文件名恒等于 `EnemyDef.id` —— 或它**显式借的那一头**。
 *
 * [M2-B3] B4 只出了 8 张胸像，而敌人已经二十一头。新兽在 `EnemyDef.artId` 里逐个声明
 * 借哪一张脸（鸟借野雉、鱼借文鳐、带甲借玄蟒、人形借山魈……）。这里读的就是那一位。
 *
 * **刻意不做「文件不在就退占位」的兜底**：那会把「忘了配图」与「有意复用」写成同一件事，
 * 而前者恰恰是这个项目最该吵出来的那类静默失效（`<img>` 加载失败不报错，玩家只看到空框）。
 * 缺图由 `test/artAssets.test.ts` 对着磁盘核 —— 少一张就变红，而不是等 owner 试玩时看见。
 */
export function enemyArt(enemy: { id: string; artId?: string }): string {
  return `${ART_DIR}enemies/${enemy.artId ?? enemy.id}.webp`;
}

/** 结局图（16:9），文件名恒等于 `EndingType`。 */
export function endingArt(ending: EndingType): string {
  return `${ART_DIR}endings/${ending}.webp`;
}

/** 题字画面主视觉（16:9，上方三分之二是特意留空的绢面，正好放标题排版）。 */
export const TITLE_HERO = `${ART_DIR}ui/title-hero.webp`;

/**
 * 神种卡的图。
 *
 * B4 没画神种卡专用图（不在产出清单里），但三枚神种里有两枚的来源本身就有成图：
 * 白泽遗种 ← 「白泽问路」的插图、应龙遗种 ← 「垂死应龙」的插图；常胎用幼兽立绘
 * （「凭常胎降世，托身幼兽」说的就是它）。这是零积分的复用，且画的正是同一个对象。
 * 未列出的神种（M1 会加）退回程序化占位，不硬拼一个可能 404 的路径。
 */
// Map 而不是对象字面量：`SEED_ART["constructor"]` 之类会从原型链上查到东西，
// 于是「没配图」会被误判成「配了图」并拼出一个垃圾 URL。Map 没有这个面。
const SEED_ART = new Map<string, string>([
  ["seed-chang-tai", PORTRAIT_FILES.cub],
  ["seed-bai-ze-yi", "events/qiu-explore-baize.webp"],
  ["seed-ying-long-yi", "events/qiu-explore-yinglong.webp"],
]);

export function seedArt(seedId: string): string | null {
  const file = SEED_ART.get(seedId);
  return file === undefined ? null : ART_DIR + file;
}
