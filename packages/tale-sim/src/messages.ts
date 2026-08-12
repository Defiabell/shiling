/**
 * 引擎自身产出的旁白文案（notices 与 LifeRecord.text）。
 *
 * 为什么放在引擎里而不是 tale-content：`TaleContent` 的字段在接口正本里是封闭的
 * （events/organs/seeds/enemies/tuning/chronicleTemplates），没有 strings 槽位，
 * 而 `TurnResult.notices` 又是引擎返回给界面的成品字符串。列传文案仍归内容
 * （`ChronicleTemplates`），引擎只负责这些结构性旁白。
 *
 * 支持 `{{key}}` 占位，替换见 `render()`。全角标点。
 */
export const ENGINE_MESSAGES = {
  birth: "食灵凭{{seedName}}降世，托身青丘幼兽。",

  huntFail: "追逐无果，空腹而返。",
  huntEncounter: "循迹而行，反被{{enemy}}盯上。",
  explore: "循青丘旧径独行，草木皆是生面。",
  rest: "蜷于石隙间敛息养神。",
  restHeal: "旧创渐合，痛意稍退。",
  molt: "蛰伏一季，蜕生{{organ}}。",
  moltNoCandidate: "蛰伏一季，精气无所凭依，终未成形。",
  organGained: "身内又生{{organ}}。",

  combatStart: "{{enemy}}当道，避之不得。",
  combatPlayerHit: "扑击{{enemy}}，伤其{{dmg}}。",
  combatSkillHit: "施{{skill}}，{{enemy}}受创{{dmg}}。",
  combatEnemyHit: "{{enemy}}反噬，自身受创{{dmg}}。",
  combatWin: "{{enemy}}毙于爪牙之下，吞其精气。",
  combatWinRecord: "搏杀{{enemy}}，食其精气。",
  combatFleeOk: "觑得一隙遁去，未损分毫。",
  combatFleeFail: "去路已绝，遁而不得脱。",
  combatFeintOk: "作伏低将死之态，{{enemy}}一击扑空。",
  combatFeintFail: "诈术为{{enemy}}所觉，反受重创。",

  deathStarve: "饥馑连季，形销骨立而终。",
  deathOldage: "寿数已尽，卧于旧穴不复起。",
  deathSlain: "力尽，横死于{{enemy}}之口。",
  deathSlainGeneric: "力尽，横死于青丘荒野。",
  deathAscend: "白光贯顶，遂脱兽身而登神位。",
} as const;

/**
 * 追猎屏的通用旁白变体（M1-P1）。
 *
 * ## 为什么是数组
 * 一场追猎要潜行三四次、一世要追几十场 —— 同一句话会在同一屏里连着出现三遍。M0 实测
 * 「探索空手时中央卡重复同一句」被 owner 直接感知为「廉价」，追猎屏的重复密度比它高一个
 * 量级，所以这里从一开始就是变体池（每槽 3 条），由引擎的种子 rng 抽（**恒定消耗一次抽取**，
 * 见 `pickFlavor`）。
 *
 * ## 与 `EnemyDef.stalkFlavor` 的分工
 * 这里是**兜底**：猎物没写自己那一槽时用。真正的「野雉与岩羊说法不同」归内容
 * （`stalkFlavor`）—— 引擎不认识具体猎物，写不出「一头扎进地下」这种只对穴鼠成立的话。
 *
 * 占位：`{{enemy}}`（猎物名）、`{{steps}}`（步数）。
 */
export const STALK_MESSAGES = {
  begin: [
    "草梢有一线新踩过的痕。{{enemy}}就在前头，还没发现你。",
    "风里混进一股活物的气味。{{enemy}}在那儿，尚不知有人在看它。",
    "你伏下身，把自己压进草色里。{{enemy}}离得还远。",
  ],
  creep: [
    "四足轮换落地，无声近了{{steps}}步。",
    "贴着石影游走，又近了{{steps}}步。",
    "压低身形，借草色挪近{{steps}}步。",
  ],
  circle: [
    "退开半圈，绕到下风处 —— 气味不再往它那边送了。",
    "顺着坡脊兜转，直到风迎面吹来。",
    "沿着湿地绕行一段，把风留在正面。",
  ],
  wait: [
    "伏地不动，只余鼻息。草间那点惊意慢慢散了。",
    "屏住气，任草叶擦过脊背，一动不动。",
    "静了一阵。它重新低下头去。",
  ],
  stir: [
    "{{enemy}}忽然抬头，挪开了{{steps}}步。",
    "{{enemy}}绕着走了半圈，位置换了{{steps}}步。",
    "{{enemy}}没来由地一惊，挪了{{steps}}步。",
  ],
  catch: [
    "一跃而出，{{enemy}}未及转身。",
    "扑落如石，{{enemy}}只挣了两下。",
    "自侧后一口咬住，{{enemy}}的挣动很快就停了。",
  ],
  miss: [
    "扑空了 —— {{enemy}}几乎在同一瞬弹开。",
    "只擦到一把毛，{{enemy}}已窜出丈外。",
    "落地时草响，{{enemy}}早不在原处。",
  ],
  escape: [
    "{{enemy}}再不肯留，转眼没入林中。",
    "一声惊叫，{{enemy}}去得干净。",
    "{{enemy}}扬长而去，只剩一片踩乱的草。",
  ],
  /** 受惊／失手后反扑（`EnemyDef.retaliates`） */
  retaliate: [
    "{{enemy}}非但不走，反而低头压了上来。",
    "{{enemy}}转身立定，眼里全是要打的意思。",
    "{{enemy}}把身子横过来 —— 这一场躲不掉了。",
  ],
  /** 体力耗尽 */
  exhausted: [
    "腿脚发软，追不动了。空手而返。",
    "气力散尽，只得罢手。",
    "半日追逐，终究没能近身。",
  ],
  /** 得手后的进食 */
  feed: [
    "就地饱食一顿，精气入腹。",
    "血肉入喉，一股暖意自腹中散开。",
    "吃得干净，只剩一地零碎。",
  ],
  /** 附毒（venom tag）：扑空转搏杀时敌人已带伤 */
  venom: ["爪牙上的腥液蹭进它的皮肉，{{enemy}}的动作滞了一滞。"],
} as const;

const CN_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

/**
 * 汉字数字（0〜99）：0→「〇」、10→「十」、11→「十一」、20→「二十」。
 *
 * 超出 0〜99 或非有限数时退回阿拉伯数字 —— 列传里出现「一百二十三」不如出现 123 好读，
 * 而 M0 的寿数上限是 20 余岁，越界只会是将来的新数据。
 *
 * 唯一实现放在 tale-sim：列传模板的 `{{n|cn}}` 与界面 `format.ts` 的岁数／计数汉字化
 * 用的必须是同一张表，否则「凡历四岁」与状态栏的「四岁」哪天就会各写一套。
 */
export function cnNumeral(value: number): string {
  const n = Math.floor(value);
  if (!Number.isFinite(n) || n < 0 || n > 99) return String(Math.floor(value));
  if (n < 10) return CN_DIGITS[n] as string;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensPart = tens === 1 ? "十" : `${CN_DIGITS[tens] as string}十`;
  return ones === 0 ? tensPart : `${tensPart}${CN_DIGITS[ones] as string}`;
}

/**
 * `{{key|fmt}}` 支持的格式化器。`cn` = 汉字数字（史书体列传要的那种）。
 *
 * 用 Map 而不是对象字面量：对象查表会连原型链上的 `constructor`／`toString` 一起「查到」，
 * 于是 `{{n|constructor}}` 这种写错的模板不会按「未知格式化器」处理，而是拿到一个能调的
 * 函数、悄悄输出点什么。Map 没有这个面。
 */
const FORMATTERS = new Map<string, (value: string | number) => string>([
  ["cn", (value) => (typeof value === "number" ? cnNumeral(value) : String(value))],
]);

/**
 * 条件段：`{{#key}}…{{/key}}` 值非零非空时保留内层，`{{^key}}…{{/key}}` 反之。
 *
 * 为什么需要它：列传是史记笔法，而「蜕〇，杀〇」「凡历〇岁」是机器话，一句就把整段文气
 * 破掉（死亡屏的摘要早就为此专门写了零值措辞）。零值该怎么说是**文案决定**，不是引擎
 * 决定，所以给内容一个开关，而不是在引擎里内置「杀 0 时说未尝杀生」。
 *
 * 不支持嵌套（内容里也没有嵌套的需求）；未知 key 的段**整段原样留着**，与未知占位同待遇。
 */
function renderSections(template: string, vars: Record<string, string | number>): string {
  return template.replace(
    /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/g,
    (whole, mode: string, key: string, inner: string) => {
      const value = vars[key];
      if (value === undefined) return whole;
      const truthy = typeof value === "number" ? value !== 0 : value.length > 0;
      return (mode === "#") === truthy ? inner : "";
    },
  );
}

/**
 * 把 `{{key}}`／`{{key|fmt}}` 占位替换为 `vars` 中的值，并先处理条件段。
 *
 * 未知占位与未知格式化器**一律保持原样**（不静默吞掉，也不退回未格式化的值）——
 * 静默降级会让「模板写错」看起来像「数字风格没生效」，那是最难查的一类。
 *
 * `fmt` 目前只有 `cn`（汉字数字）：列传是史记笔法，正文里出现「凡历4岁，成器官2」
 * 会当场破掉文气，所以内容侧写 `凡历{{years|cn}}岁`。哪些数字用汉字由**内容**决定，
 * 引擎只提供这一支笔。
 */
export function render(template: string, vars: Record<string, string | number> = {}): string {
  return renderSections(template, vars).replace(
    /\{\{(\w+)(?:\|(\w+))?\}\}/g,
    (whole, key: string, fmt?: string) => {
      const value = vars[key];
      if (value === undefined) return whole;
      if (fmt === undefined) return String(value);
      const formatter = FORMATTERS.get(fmt);
      return formatter === undefined ? whole : formatter(value);
    },
  );
}
