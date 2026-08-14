/**
 * B4 美术管线的**作业清单**：60 张成图各自「画什么、什么尺幅、落在哪个文件」。
 *
 * ## 设计要点：清单是算出来的，不是抄出来的
 * 44 张事件插图的 subject 直接取 `TALE_CONTENT.events[].illustrationBrief` 原文，
 * 敌人头像的形貌直接取 `VISUAL_TOKENS` 里那一句权威描述 —— 本文件**不重写任何
 * 角色相貌**。这样 B2 改了白泽的样子，重跑脚本就自动跟上；抄一份到这里就是给
 * 「剧情连贯」埋一颗必然会爆的雷。
 *
 * 只有 B2 数据里确实不存在的东西才在这里手写：玩家三阶段立绘的成长形貌（B2 只定义了
 * 幼兽期）、题字主视觉、四张结局图。它们同样以 `VT.self` 为基句往上长，不另起一套相貌。
 *
 * ## 敌人 → 视觉 token 的对应
 * 不写死映射表，而是「敌人名里包含哪个 token 的 name，就用那个 token」——
 * 这条不变量已经被 `tale-content/test/schema.test.ts` 的
 * 「每个敌人都在 token 表里有形貌」断言守住了，所以这里复用它，而不是再造一张会漂移的表。
 */

// 走相对路径而非 `@shiling/tale-content` workspace 依赖：加依赖要动 packages/gen/package.json
// 与 pnpm-lock.yaml，而 B3 正在并行改 tale-client —— 共享 lockfile 是这两条线唯一会撞车的
// 文件。相对路径拿到的是同一份源码，零依赖变更，撞车面积为零。
// （tale-content 内部的 `@shiling/tale-sim` 仍由 pnpm 的 workspace 符号链接解析，不受影响；
//   它内部 `./x.js` 形式的 import 由 tsResolveHook.mjs 在运行时改写成 `./x.ts`。）
import { TALE_CONTENT, VISUAL_TOKENS, VT } from "../../tale-content/src/index.ts";
import type { ArtKind } from "./artStyle.ts";

export interface ArtJob {
  /** 输出文件的 basename（无扩展名）。事件图恒等于事件 id，方便回填 `illustration`。 */
  id: string;
  kind: ArtKind;
  /** `public/art/` 下的子目录。 */
  dir: "events" | "portraits" | "enemies" | "ui" | "endings" | "_style";
  /** 日志与报告里的人读名字。 */
  label: string;
  /** 「画什么」，交给 artStyle 拼装。 */
  subject: string;
  /** 少数需要额外内容约束的图（例如立绘要强调「同一个个体长大」）。 */
  extra?: string;
  /**
   * 追加参考图（`public/art/` 下的相对路径），与正典锚图一起送进 image-to-image。
   *
   * 用途只有一个：**形貌承接**。「同一只兽的三个年纪」「结局图里的兽和立绘是同一只」
   * 靠文字描述是赌，靠把上一张图本身当参考才是机制。所以立绘成兽／近神挂幼兽立绘，
   * 老死／登神挂对应阶段的立绘 —— 生成顺序由 generate-art 的依赖波次自动排。
   */
  refs?: string[];
}

/** `public/art/` 下的相对路径 —— 与 tale-client 的 `ART_DIR + illustration` 拼法对齐。 */
export function artRelPath(job: ArtJob, ext = "webp"): string {
  return `${job.dir}/${job.id}.${ext}`;
}

/**
 * 本图是否出现玩家那只食灵 —— 由 subject 里有没有 `VT.self` 那句权威描述机械判定。
 *
 * 之所以算而不是手标：全库只有一句话描述玩家幼兽，subject 含它就是它出现了，不含就是没出现。
 * 手标 60 个布尔值一定会错，而错的后果是锚图把敌人画成玩家（见 artStyle 的 selfIdentityClause）。
 */
export function featuresSelf(job: Pick<ArtJob, "subject">): boolean {
  return job.subject.includes(VT.self);
}

// ---------------------------------------------------------------------------
// 44 张事件插图
// ---------------------------------------------------------------------------

export function eventJobs(): ArtJob[] {
  return TALE_CONTENT.events.map((event) => {
    const brief = event.illustrationBrief;
    if (!brief) {
      throw new Error(
        `事件 ${event.id} 没有 illustrationBrief —— B4 不替 B2 编画面，请回 tale-content 补。`
      );
    }
    return {
      id: event.id,
      kind: "event" as const,
      dir: "events" as const,
      label: `事件 ${event.title}`,
      subject: brief,
    };
  });
}

// ---------------------------------------------------------------------------
// 敌人头像（B4 出了 8 张；[M2-B3] 之后表里有 21 头，新兽在 EnemyDef.artId 里借老兽的脸，
// 这张清单仍然按头生 —— 哪天补图那一轮就是照它跑）
// ---------------------------------------------------------------------------

/** 敌人名里包含的最长 token name 即其形貌来源（见文件头）。 */
function tokenDescForEnemy(enemyName: string): string {
  const hit = [...VISUAL_TOKENS]
    .filter((token) => enemyName.includes(token.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!hit) {
    throw new Error(
      `敌人「${enemyName}」在 visualTokens 里没有形貌。` +
        `tale-content 的 schema 测试本该拦住这种情况 —— 先去补 token，别在这里手写相貌。`
    );
  }
  return hit.desc;
}

export function enemyJobs(): ArtJob[] {
  return TALE_CONTENT.enemies.map((enemy) => ({
    id: enemy.id,
    kind: "avatar" as const,
    dir: "enemies" as const,
    label: `敌人头像 ${enemy.name}`,
    subject: `${tokenDescForEnemy(enemy.name)}的胸像，头部微侧，双眼看向画外。`,
    extra:
      "The creature is alert but motionless, as if it has just noticed the viewer. Its eyes are the focal point of the plate.",
  }));
}

// ---------------------------------------------------------------------------
// 3 张玩家立绘（幼兽 → 成兽 → 近神）
// ---------------------------------------------------------------------------

/**
 * 三阶段共用一条基句 `VT.self`，各自只叠加「长大了什么」——
 * 这样三张立绘是同一只兽的三个年纪，而不是三只不同的兽。
 */
const SELF_STAGES: ReadonlyArray<{
  id: string;
  label: string;
  growth: string;
  refs?: string[];
}> = [
  {
    id: "self-1-cub",
    label: "玩家立绘·幼兽",
    growth: "此刻仍是初生模样：四肢细弱，毛色未匀，额心灵纹只有一点，眼大而怯。",
  },
  {
    id: "self-2-adult",
    label: "玩家立绘·成兽",
    // 挂幼兽立绘：成兽不是「另一只长得像的兽」，是这一张里那只长大了。
    refs: ["portraits/self-1-cub.webp"],
    growth:
      "同一只兽已长成：体量增至三倍，肩背隆起，毛色转为深灰褐并透出金属般的哑光，" +
      "颈侧生出数片青黑硬鳞，齿露出唇外半寸，额心灵纹长开成一道细纹，眼神已无怯色。",
  },
  {
    id: "self-3-neargod",
    label: "玩家立绘·近神",
    // 挂成兽而非幼兽：三阶段是一条链，每一环只跨一步，形貌漂移最小。
    refs: ["portraits/self-2-adult.webp"],
    growth:
      "同一只兽已近于神：身量再倍，脊线上生一列薄如刀的青玉状棱片，四足踏处浮起极淡白气，" +
      "额心灵纹漫成覆盖半额的青光纹路并微微发亮，双目瞳色转为无底的墨青，通体安静得不像活物。",
  },
];

export function portraitJobs(): ArtJob[] {
  return SELF_STAGES.map((stage) => ({
    id: stage.id,
    kind: "portrait" as const,
    dir: "portraits" as const,
    label: stage.label,
    subject: `${VT.self}的全身立绘。${stage.growth}`,
    refs: stage.refs,
    extra:
      "This is the same individual animal at a different age as the other plates in this set — " +
      "keep the skull shape, ear set, limb proportions and the forehead mark's placement identical across ages; only scale, mass and ornament change. " +
      "Where a second reference image of this animal at a younger age is attached, that is the very same animal: carry its anatomy forward and age it, do not redesign it.",
  }));
}

// ---------------------------------------------------------------------------
// 题字主视觉
// ---------------------------------------------------------------------------

export function heroJobs(): ArtJob[] {
  return [
    {
      id: "title-hero",
      kind: "hero",
      dir: "ui",
      label: "题字主视觉",
      subject:
        `破晓时分的${VT.qiuHills}，丘背层层退向远处直至化入空白；` +
        `画面左下一道矮坡上，${VT.self}极小地侧身立着仰望天空，只见剪影。` +
        `上方三分之二是全空的绢面，不置一物。`,
      extra:
        "The empty upper area will later carry hand-set typography, so it must remain absolutely clean silk — no clouds with defined shapes, no birds, no mountains rising into it.",
    },
  ];
}

// ---------------------------------------------------------------------------
// 4 张结局图
// ---------------------------------------------------------------------------

/** id 与 `EndingType`（starve/slain/oldage/ascend）逐字对应，客户端可直接按 ending 取图。 */
const ENDINGS: ReadonlyArray<{
  id: string;
  label: string;
  subject: string;
  extra?: string;
  refs?: string[];
}> = [
  {
    id: "starve",
    label: "结局·饿殍",
    subject:
      `隆冬雪原上的${VT.qiuHills}，天地皆白；画面偏右下，${VT.self}侧卧雪中不动，` +
      `半身已被新雪覆住，只余头部与一只前爪露在外面；身后来路的足迹被雪填平了大半。` +
      `全画只有雪白、灰与一点枯黄，大面积留白。`,
  },
  {
    id: "slain",
    label: "结局·横死",
    subject:
      `暮色中的乱石坡，地面一片洇开的暗色血渍顺石缝下渗；${VT.self}倒卧血渍中央，` +
      `头偏向一侧，四肢松弛；数步之外只留下一串体量远大于它的兽爪印，凶手已不在画中。` +
      `天光将尽，坡上方大片空白。`,
    extra: "The killer is absent from the plate — only its footprints remain. Do not paint a second creature.",
  },
  {
    id: "oldage",
    label: "结局·寿终",
    subject:
      `秋末黄昏，${VT.qiannianSang}下的干草窝里，一头老去的食灵伏卧闭目，` +
      `毛色斑白稀疏，额心灵纹已淡得几乎看不出，形貌仍是${VT.self}长成之后的样子；` +
      `落叶积在它背上无人拂去。暖褐调，光线极低，右上留白。`,
    // 挂成兽立绘：老死的是长成之后的兽，而 VT.self 那句权威描述写的是幼兽期 ——
    // 单靠文字「长成之后的样子」，模型有一半概率画回幼兽。参考图直接消掉这个赌局。
    refs: ["portraits/self-2-adult.webp"],
    extra:
      "The animal is the same individual as in the attached portrait reference, simply very old — " +
      "same skull shape and forehead-mark placement, now faded. It is fully grown, NOT a cub: " +
      "the cub wording in the scene text is there only to identify which individual this is.",
  },
  {
    id: "ascend",
    label: "结局·登神",
    subject:
      `夜山之巅，浓云自中裂开一道竖隙，一柱冷白光垂落；光柱之中一头食灵正在离地升起，` +
      `身形已近于神：脊列青玉棱片，四足下浮白气，额心青光纹漫开发亮，` +
      `形貌仍是${VT.self}长成之后的样子。山石与远处的${VT.qiuHills}沉在深暗里，只有光柱是亮的。`,
    refs: ["portraits/self-3-neargod.webp"],
    extra:
      "The ascending animal is the same individual as in the attached portrait reference, at its final stage — " +
      "same skull shape and forehead-mark placement. It is fully grown, NOT a cub. " +
      "No deities, no attendants, no palace: only the beast, the light and the mountain.",
  },
];

export function endingJobs(): ArtJob[] {
  return ENDINGS.map((ending) => ({
    id: ending.id,
    kind: "ending" as const,
    dir: "endings" as const,
    label: ending.label,
    subject: ending.subject,
    extra: ending.extra,
    refs: ending.refs,
  }));
}

// ---------------------------------------------------------------------------
// 全量
// ---------------------------------------------------------------------------

export type BatchName = "events" | "enemies" | "portraits" | "ui" | "endings";

export const BATCHES: Record<BatchName, () => ArtJob[]> = {
  events: eventJobs,
  enemies: enemyJobs,
  portraits: portraitJobs,
  ui: heroJobs,
  endings: endingJobs,
};

export function allJobs(): ArtJob[] {
  return (Object.keys(BATCHES) as BatchName[]).flatMap((name) => BATCHES[name]());
}
