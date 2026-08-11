/**
 * 列传模板 —— 一世结束时 `composeChronicle` 用它把 `LifeRecord` 拼成史传。
 *
 * 笔法参照《史记》列传：开篇交代出身与一世总账（岁数／器官／蜕变／杀伐／四属性），
 * 中段以编年摘录（引擎只挑 birth／molt／combat／once 事件，即「值得入传的事」），
 * 结局一段，末以「赞曰」作评。
 *
 * 赞语按 `de` 与 `ending` 分 8 变体，`composeChronicle` **取第一个匹配**，所以顺序即优先级：
 * 越具体的（登神＋厚德）越靠前，末项必须是无条件兜底（引擎在无匹配时也退到末项）。
 * 同一世的结局与德行不同，赞语就不同 —— 这是玩家「上一世我做了什么」的唯一评语。
 *
 * 可用占位（引擎 `render`）：`seedName` `years` `organCount` `moltCount` `killCount`
 * `meng` `ling` `ti` `de`；`middleLine` 额外可用 `year` `season` `text`。
 *
 * ## 数字体例（B5 定，勿混）
 * 列传正文里的数字**一律汉字**（`{{years|cn}}`）—— 「凡历4岁，成器官2，蜕1，杀3」是
 * 报表话，摆在史记笔法的正文里当场破文气。阿拉伯数字只留给界面上那些要横向比对的量值
 * （状态栏属性／饱食／精气），那些不在这个文件里。
 *
 * 零值另有措辞，用条件段 `{{#key}}…{{/key}}`／`{{^key}}…{{/key}}` 表达：一世未曾蜕形、
 * 未曾杀生、未及一岁而死都是常见结局，而「蜕〇，杀〇」「凡历〇岁」读起来是机器在说话。
 */

import type { ChronicleTemplates } from "@shiling/tale-sim";

export const CHRONICLE_TEMPLATES: ChronicleTemplates = {
  titleTemplate: "食灵列传·{{seedName}}",

  opening:
    "食灵者，无名，凭{{seedName}}降于青丘，托身幼兽。{{#years}}凡历{{years|cn}}岁{{/years}}{{^years}}未及一岁{{/years}}，成器官{{organCount|cn}}{{#moltCount}}，蜕{{moltCount|cn}}{{/moltCount}}{{^moltCount}}，未尝蜕形{{/moltCount}}{{#killCount}}，杀{{killCount|cn}}{{/killCount}}{{^killCount}}，未尝杀生{{/killCount}}。其为兽也，猛{{meng|cn}}、灵{{ling|cn}}、体{{ti|cn}}{{#de}}、德{{de|cn}}{{/de}}{{^de}}，而德无可称{{/de}}。",

  middleLine: "{{#year}}{{year|cn}}岁{{/year}}{{^year}}初岁{{/year}}{{season}}，{{text}}",

  endings: {
    starve: "末年荐饥，山无可食之物，遂以饥馑不振，殒于青丘之野。",
    slain: "终为强者所杀，血沃荒原，骨不得掩。",
    oldage: "寿数既尽，卧于旧穴，三日不出而化。",
    ascend: "白光贯顶，兽身褪如敝衣，遂脱兽籍而列于神班。",
  },

  praisePrefix: "赞曰：",

  praise: [
    {
      id: "ascend-virtuous",
      endings: ["ascend"],
      minDe: 60,
      text: "食灵之志，不在饱腹，而在超然。起于青丘一幼兽，终与云气同流——非独其力，亦其德也。",
    },
    {
      id: "ascend-cold",
      endings: ["ascend"],
      text: "登神者未必仁。天既取之，青丘众兽亦无从置喙。",
    },
    {
      id: "virtuous-oldage",
      endings: ["oldage"],
      minDe: 45,
      text: "其德厚，异类亦亲之；其寿全，山野亦容之。虽兽，有士君子之风焉。",
    },
    {
      id: "virtuous",
      minDe: 40,
      text: "厚德者未必久生，然其所全者众。故死之日，青丘草木若有知。",
    },
    {
      id: "cruel-violent-end",
      endings: ["slain"],
      maxDe: 6,
      // 不要写「以杀始，以杀终」：赞语只吃 de 与 ending，而 de 归零的路子有一半是弃卵、
      // 见死不救、取人之食这类**不仁而未必杀生**的抉择 —— 实测真出现过「未尝杀生」的
      // 一世配上这句评语，读起来是史官在瞎写。措辞只说得起 de 与横死这两件事。
      text: "其取也无让，其行也无恤。终毙于爪牙之下，青丘无为之惜者。",
    },
    {
      id: "cruel",
      maxDe: 6,
      text: "食而不知止，取而不知让。非青丘薄之，其自薄耳。",
    },
    {
      id: "starved",
      endings: ["starve"],
      text: "非不勇也，时不与之。青丘之冬，杀兽多于爪牙。",
    },
    {
      id: "default",
      text: "生于青丘，死于青丘，兽之常也。太史氏无所讥焉。",
    },
  ],

  seasonNames: ["春", "夏", "秋", "冬"],
};
