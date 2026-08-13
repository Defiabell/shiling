/**
 * 视觉 token 表 —— 跨事件复用的角色／场景的**唯一权威视觉描述**。
 *
 * ## 为什么要有这张表
 * B4 美术管线按每个事件的 `illustrationBrief` 逐张生成插图。如果「白泽」在三条 brief 里
 * 各写一遍相貌，就会生出三头不同的白泽 —— 剧情连贯当场崩掉。所以：**具名角色与具名地点
 * 的相貌只在这里写一次**，brief 里靠 `VT.baize` 拼进去。这是机制保障，不靠自觉：
 * schema 测试断言「brief 里出现了某 token 的 `name`，就必须同时出现它的 `desc`」，
 * 手写裸名字（"白泽站在山脊上"）会让测试变红。
 *
 * ## 写 desc 的格式约定
 * `desc` 是一个**能直接嵌进句子的名词短语**，且必须包含 `name` 本身，例如
 * `"人面四目、通体霜白、额生双角的白泽"` —— 拼进 brief 读起来仍是通顺的中文。
 * 反例（不要写成定义句）：`"白泽：人面四目……"`。
 *
 * ## 与 B4 风格圣经的分工
 * 本表只管**画什么**（角色相貌、场景构成、构图重心）。**怎么画**（山海经志怪×宋代绢本
 * 设色×水墨晕染×留白、禁文字禁水印、尺幅）归 B4 的 `packages/gen/src/artStyle.ts` 统一
 * 拼接 —— 所以 44 条 brief 里都不重复写画风与 negative prompt，避免风格调整时要改 44 处。
 */

export interface VisualToken {
  id: string;
  /** 具名实体在正文/brief 里的名字。schema 测试用它做「裸名字」检测 */
  name: string;
  /** 唯一权威的视觉描述：可直接嵌句的名词短语，必须包含 name */
  desc: string;
}

const TOKEN_DEFS = {
  // — 主角与地域 —
  self: {
    id: "self",
    name: "食灵幼兽",
    desc: "瘦小如幼狐、灰褐皮毛、额心一点淡青灵纹的食灵幼兽",
  },
  qiuHills: {
    id: "qiuHills",
    name: "青丘丘陵",
    desc: "红土裸露、白草覆坡、远处丘背连绵的青丘丘陵",
  },

  // — 神异角色 —
  baize: {
    id: "baize",
    name: "白泽",
    desc: "人面四目、通体霜白、额生双角的白泽",
  },
  yinglong: {
    id: "yinglong",
    name: "应龙",
    desc: "残翼半张、鳞色青金而黯、身长数丈的垂死应龙",
  },
  baiTu: {
    id: "baiTu",
    name: "白兔",
    desc: "通体雪白、耳后一道旧疤的白兔",
  },

  // — 人 —
  caiyaoren: {
    id: "caiyaoren",
    name: "采药人",
    desc: "青布短褐、背竹篓、腰悬小镰的采药人",
  },
  lieren: {
    id: "lieren",
    name: "猎人",
    desc: "举火把与铜锣、牵猎犬成列的青丘猎人",
  },

  // — [S2] 六处探索去处：一处一副长相 —
  //
  // 这六个是本表最该存在的一批：同一处会出现在六到九条 brief 里，若每条各写一遍地貌，
  // 生出来的就是六个「幽潭」而不是同一个 —— 而这一批的验收标准恰恰是「读起来／看起来
  // 像另一个地方」。`DestinationDef.desc` 是给玩家读的一句，这里是给画的一句，两者不混。
  shouJing: {
    id: "shouJing",
    name: "兽径",
    desc: "被无数蹄爪踏出土色浅沟、两侧枯草伏倒的兽径",
  },
  xianFeng: {
    id: "xianFeng",
    name: "险峰",
    desc: "青灰石脊瘦削如刀、落脚处不盈尺、云在脚下的险峰",
  },
  guCi: {
    id: "guCi",
    name: "古祠",
    desc: "夯土矮墙半塌、阶前野草没膝、梁木朽而未倒的青丘古祠",
  },
  youTan: {
    id: "youTan",
    name: "幽潭",
    desc: "水色由青转墨、水面静无一纹、四周湿石覆苔的幽潭",
  },
  miKu: {
    id: "miKu",
    name: "秘窟",
    desc: "洞口低窄、内里全暗、石壁湿而挂钟乳的山腹秘窟",
  },
  jiaoYuan: {
    id: "jiaoYuan",
    name: "焦原",
    desc: "半尺厚白灰覆地、焦木桩四散、地表裂成龟纹的焦原",
  },

  // — 具名地点／器物 —
  lingquan: {
    id: "lingquan",
    name: "灵泉",
    desc: "泉底铺九曲青石纹、水色微碧而浮薄白气的灵泉",
  },
  zhaoyingtan: {
    id: "zhaoyingtan",
    name: "照影潭",
    desc: "水面静如镜、四周碎石环列的照影潭",
  },
  gutan: {
    id: "gutan",
    name: "骨坛",
    desc: "兽骨环列朝向一处、中央一块血渍发亮黑石的骨坛",
  },
  duanbei: {
    id: "duanbei",
    name: "断碑",
    desc: "半埋藤中、刻痕深峻的青灰断碑",
  },
  youxue: {
    id: "youxue",
    name: "幽穴",
    desc: "石壁裂开一线、口沿覆湿苔而透暖气的幽穴",
  },
  qiannianSang: {
    id: "qiannianSang",
    name: "千年桑",
    desc: "树身需三兽合抱、枝上只余数叶的千年桑",
  },
  shilin: {
    id: "shilin",
    name: "石林",
    desc: "青石直立成林、石面凿有积雨小坑的石林",
  },
  huGrave: {
    id: "huGrave",
    name: "野狐坟",
    desc: "小土丘成排、丘前各压一块白石的野狐坟",
  },
  guiSan: {
    id: "guiSan",
    name: "鬼伞",
    desc: "伞面灰白带淡红斑、一碰即渗水的鬼伞",
  },
  chanTui: {
    id: "chanTui",
    name: "蝉蜕",
    desc: "背缝裂开一线、通体琥珀色的空蝉蜕",
  },
  shifeng: {
    id: "shifeng",
    name: "石蜂",
    desc: "灰白巢体嵌在崖缝、蜜色顺石纹下淌的石蜂之巢",
  },
  shengTao: {
    id: "shengTao",
    name: "绳套",
    // 描述里刻意不出现「猎人」二字 —— 那是另一个 token 的 name，写进来会被一致性测试当成裸用
    desc: "麻绳圈系在弯下树梢、圈心搁半块熏肉的绳套",
  },

  // — 敌人（B4 头像与插图共用同一形貌） —
  yezhi: {
    id: "yezhi",
    name: "野雉",
    desc: "羽色斑驳、尾长而尖的野雉",
  },
  wenyao: {
    id: "wenyao",
    name: "文鳐鱼",
    desc: "银鳞、胸鳍宽张如翼的文鳐鱼",
  },
  xueshu: {
    id: "xueshu",
    name: "穴鼠",
    desc: "土黄短毛、前爪宽厚的穴鼠",
  },
  yanyang: {
    id: "yanyang",
    name: "岩羊",
    desc: "青灰皮毛、双角后弯的岩羊",
  },
  caohu: {
    id: "caohu",
    name: "草狐",
    desc: "瘦削、毛色枯黄、眼极亮的草狐",
  },
  shanxiao: {
    id: "shanxiao",
    name: "山魈",
    desc: "人形赤面无毛、两臂过膝的山魈",
  },
  xuanmang: {
    id: "xuanmang",
    name: "玄蟒",
    desc: "黑鳞泛紫、身粗如柱的玄蟒",
  },
  qiongqi: {
    id: "qiongqi",
    name: "穷奇",
    desc: "虎身猬毛、肩生小翼、啼声如婴的穷奇幼崽",
  },
} as const satisfies Record<string, VisualToken>;

export type VisualTokenId = keyof typeof TOKEN_DEFS;

function descOf<K extends string>(defs: Record<K, VisualToken>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(defs) as K[]) out[key] = defs[key].desc;
  return out;
}

/** brief 拼接用的简写：`${VT.baize}` 即那一句唯一权威描述。 */
export const VT: Record<VisualTokenId, string> = descOf(TOKEN_DEFS);

/** 全表（schema 测试与 B4 遍历用）。 */
export const VISUAL_TOKENS: readonly VisualToken[] = Object.values(TOKEN_DEFS);
