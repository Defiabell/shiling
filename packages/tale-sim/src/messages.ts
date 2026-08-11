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

  huntSuccess: "伏草间半日，猎得{{enemy}}，饱食稍安。",
  huntFail: "追逐无果，空腹而返。",
  huntNoPrey: "山野寂寂，竟无兽踪可循。",
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
 * 把 `{{key}}` 占位替换为 `vars` 中的值。
 *
 * 未知占位**保持原样**（不静默吞掉），便于内容侧一眼看出占位名写错。
 */
export function render(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const value = vars[key];
    return value === undefined ? whole : String(value);
  });
}
