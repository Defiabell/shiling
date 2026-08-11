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
 */

import type { ChronicleTemplates } from "@shiling/tale-sim";

export const CHRONICLE_TEMPLATES: ChronicleTemplates = {
  titleTemplate: "食灵列传·{{seedName}}",

  opening:
    "食灵者，无名，凭{{seedName}}降于青丘，托身幼兽。凡历{{years}}岁，成器官{{organCount}}，蜕{{moltCount}}，杀{{killCount}}。其为兽也，猛{{meng}}、灵{{ling}}、体{{ti}}、德{{de}}。",

  middleLine: "{{year}}岁{{season}}，{{text}}",

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
      text: "其行暴，同类畏之；所得者众，所存者寡。以杀始，以杀终，宜也。",
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
