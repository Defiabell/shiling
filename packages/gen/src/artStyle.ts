/**
 * 《食灵·列传》风格圣经 —— 全部插图 prompt 的**唯一拼装口**。
 *
 * ## 为什么必须走这里
 * B4 要产 60 张图。如果每个脚本各自写画风词，风格调整就要改 60 处，而且必然漂移 ——
 * 「风格一致」这条硬验收就靠不住了。所以约定：**任何生成脚本都只提供「画什么」
 * （subject），画风、负面词、尺幅由本模块拼**。散写画风词视为破坏机制。
 *
 * ## 与 tale-content/visualTokens.ts 的分工
 * - `visualTokens.ts`（B2）管**画什么**：具名角色／地点的唯一权威相貌，事件 brief 里已内联。
 * - 本文件（B4）管**怎么画**：宋代绢本设色 × 山海经志怪 × 水墨晕染 × 留白，以及尺幅与负面词。
 * 两边不重叠 —— 所以 44 条 brief 里一个画风词都没有，改画风只改这个文件。
 *
 * ## API 事实（2026-08-11 实测 + docs.meshy.ai 核对）
 * - `POST /openapi/v1/text-to-image` 与 `/image-to-image` **没有 `negative_prompt` 参数**。
 *   所以负面约束只能写成 prompt 里的显式禁令句（`NEGATIVE_CLAUSE`）。
 * - `ai_model` 必填，可选 `nano-banana`(3 分) / `nano-banana-2`(6) / `nano-banana-pro`(9) /
 *   `gpt-image-2`(9，编辑 12)。
 * - **尺幅受 model 限制**：nano-banana 系支持 `1:1 16:9 9:16 4:3 3:4`；`gpt-image-2` 只支持
 *   `1:1 3:2 2:3`。M0 计划原写「事件插图 3:2」—— nano-banana 系不支持 3:2，而 gpt-image-2
 *   又不支持题字要用的 16:9。**风格一致 > 尺幅严格**，故全批锁定同一个 model
 *   （`nano-banana-pro`），事件插图退到最接近的 `4:3`（宋人册页本就近于 4:3）。
 */

/** Meshy 图像模型 id。全批共用一个 —— 换 model 等于换画师，风格一致当场作废。 */
export type ImageAiModel = "nano-banana" | "nano-banana-2" | "nano-banana-pro" | "gpt-image-2";

/** nano-banana 系支持的尺幅（`gpt-image-2` 的 3:2/2:3 不在此列，见文件头）。 */
export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

/**
 * 全批唯一的生成模型。
 *
 * 选 pro 而不是 3 分的标准档：60 张 × 9 分 = 540 分，在 1000 分预算内绰绰有余，而
 * 「同一画师之手」的稳定度直接决定本批次的验收结论 —— 这里不是省积分的地方。
 */
export const IMAGE_MODEL: ImageAiModel = "nano-banana-pro";

/** 每张图的用途。决定尺幅与取景语。 */
export type ArtKind =
  /** 事件卡插图（44 张，4:3） */
  | "event"
  /** 玩家三阶段立绘（3 张，3:4 全身） */
  | "portrait"
  /** 敌人头像（8 张，1:1 胸像） */
  | "avatar"
  /** 题字主视觉（1 张，16:9） */
  | "hero"
  /** 结局图（4 张，16:9） */
  | "ending"
  /** 风格锚图候选（4:3，与事件插图同尺幅 —— 60 张里 44 张是事件，锚就锚在主力尺幅上） */
  | "anchor";

const ASPECT_BY_KIND: Record<ArtKind, AspectRatio> = {
  event: "4:3",
  portrait: "3:4",
  avatar: "1:1",
  hero: "16:9",
  ending: "16:9",
  anchor: "4:3",
};

export function aspectRatioFor(kind: ArtKind): AspectRatio {
  return ASPECT_BY_KIND[kind];
}

// ---------------------------------------------------------------------------
// 画风正本
// ---------------------------------------------------------------------------

/**
 * 正典画风段。锚图评选的胜出措辞就地固化在这里 —— 评选依据见
 * `.superpowers/sdd/2026-08-11-liezhuan-m0/b4-report.md`「锚图评选」节。
 *
 * 英文写画风、中文写内容是刻意的：subject 直接取 tale-content 的 `illustrationBrief`
 * 原文（中文），不做翻译 —— 一旦翻译，visualTokens 的「一个角色只有一句权威描述」就
 * 被翻译副本击穿了。画风段用英文因为色彩／笔法术语的英文指令更稳。
 */
export const STYLE_CORE = [
  "Painted in the style of a Song-dynasty Chinese silk-scroll painting (绢本设色), as an illustration plate from a Shan-Hai-Jing bestiary.",
  "Mineral-pigment palette laid on aged raw-silk ground: ink black, indigo slate, malachite blue-green, ochre red earth, bone white — muted, desaturated, low-chroma, as though the silk has aged nine hundred years.",
  "Fine even ink contour lines (铁线描) over soft wet ink wash (水墨晕染) that bleeds and feathers at the edges of rock, fog, water and fur.",
  "Shallow flattened depth, no dramatic perspective, no strong cast shadows; forms separated by tonal wash rather than by modelling.",
  "Large areas of bare untouched silk used as compositional weight (留白); the emptiness carries as much of the picture as the painted matter does.",
  // 原本这里还有一句「painted area 的边缘要融进绢里而不是硬边」。删掉了 ——
  // 它让模型认为「有一块 painted area」，于是约 5% 的图画成了四周留白边的嵌入式小画心
  // （qiu-hunt-snare／qiu-explore-waterfall 两张实例）。留白必须是画面内部的空，不是画心外的边。
  "Faint silk-weave texture and hairline craquelure over the whole surface.",
  "Mood: quiet, austere, uncanny, slightly ominous. Reverent rather than decorative.",
].join(" ");

/**
 * 负面约束。API 无 `negative_prompt`，故写成 prompt 尾部的显式禁令。
 *
 * 四条最要命的（都是实测踩到的，不是想象的风险）：
 * 1. **印章／题跋**：宋画本来就有红印与落款，模型会「体贴地」补上 —— 而 owner 的验收
 *    标准里「无文字」是硬项，且客户端会在图上叠自己的标题排版。
 * 2. **裱框／嵌入式画心**：绢本必然带装裱边，模型爱画一圈绫边或把画心缩成中间一小块，
 *    进 UI 里就是一道多余的框（实测 60 张里中了 2 张，见 STYLE_CORE 的注释）。
 * 3. **多格／角色设定图**：brief 里出现两个主体时模型倾向拆成分镜或三视图。
 * 4. **碑上刻真字**：brief 说「刻痕深峻」，模型会刻出可读汉字（qiu-explore-stele 实例）。
 *    所以这里把「碑刻／摩崖／题记一律是风化到不可读的抽象凿痕」写死。
 */
export const NEGATIVE_CLAUSE = [
  "Hard constraints, obey strictly:",
  "no text of any kind, no Chinese characters, no Latin letters, no numerals, no calligraphy, no inscription, no colophon, no red seal or chop, no signature, no watermark, no logo, no caption, no label;",
  "if the scene contains a carved stone, stele or cliff face, its carving must be weathered into abstract unreadable grooves and pits — never legible glyphs;",
  "no scroll mounting, no brocade border, no frame, no vignette, no passe-partout, no inset picture area with blank silk margins around it — the painting fills the entire canvas edge to edge, and bare silk appears only as negative space inside the scene, never as a band or margin framing it;",
  "not a photograph, not photorealistic, no realistic skin or fur photography, no 3D render, no CGI, no digital airbrush, no lens flare, no depth-of-field bokeh rings, no anime or manga cel shading, no western oil impasto, no comic-book inking;",
  "nothing modern: no machinery, no vehicles, no plastic, no glass or metal architecture, no electric light, no clothing later than ancient China;",
  "one single coherent scene only: no collage, no diptych, no split panel, no grid, no multiple views of the same subject, no character turnaround sheet, no inset thumbnail.",
].join(" ");

/** 各用途的取景语。写「怎么摆」，不写「画什么」。 */
const FRAMING_BY_KIND: Record<ArtKind, string> = {
  event:
    "Composition: a single narrative moment as a horizontal album-leaf plate. Follow the shot distance stated in the scene description; if none is stated, use a mid shot. Keep roughly a third of the picture as bare silk.",
  portrait:
    "Composition: one creature alone, full body, standing, three-quarter view facing left, occupying the central vertical band. Ground it with a single soft ink wash beneath the feet — no landscape, no props, no other creature; the rest is bare aged silk.",
  avatar:
    "Composition: bust of one creature alone — head, neck and the top of the shoulders — filling most of the square, three-quarter view. Bare aged silk behind it with only a faint wash halo; no landscape, no props, no other creature.",
  hero:
    "Composition: a wide, near-empty establishing landscape. Painted matter sits low, in the bottom third and along the left edge; the upper two-thirds are bare untouched silk with only the faintest wash of cloud. That emptiness must stay completely unpainted — nothing at all is placed in it.",
  ending:
    "Composition: one decisive final moment, wide and cinematic, staged small against a vast field of bare silk. Still, terminal, no motion blur.",
  anchor:
    "Composition: a single narrative moment as a horizontal album-leaf plate, mid shot, roughly a third of the picture left as bare silk.",
};

// ---------------------------------------------------------------------------
// prompt 拼装
// ---------------------------------------------------------------------------

export interface PromptSpec {
  kind: ArtKind;
  /** 「画什么」。事件图直接传 `illustrationBrief` 原文；其余由 manifest 按 visualTokens 拼。 */
  subject: string;
  /** 极少数情况下的额外取景／内容微调（例如重试时加的纠正句）。缺省不加。 */
  extra?: string;
  /**
   * 本图是否出现玩家那只食灵。由 manifest 从 subject 是否含 `VT.self` 机械算出，不手填。
   *
   * 只影响 image-to-image 的锚图承接句：锚图里画着玩家幼兽，若不区分，
   * 敌人头像会被锚图污染成「带额心灵纹的狐狸」（实测穴鼠／穷奇／草狐三张中招）。
   */
  featuresSelf?: boolean;
  /**
   * 本图挂了「同一只兽在更早阶段」的参考图（立绘成兽／近神、老死／登神结局）。
   *
   * 与 `featuresSelf` 一起决定身份句用哪一支。缺了这一位会出事：只说「与参考图那只
   * 形貌完全一致」会把「体量增至三倍／身量再倍」直接压掉 —— 实测首轮四张成长形态
   * 全部画成幼兽加装饰（脊棱、灵纹亮起），体量与骨架一点没长。
   */
  growthFromRef?: boolean;
  /**
   * 画风段覆写。**只有锚图评选轮**用得到（要横向比不同措辞）；
   * 正式批次一律不传，走 `STYLE_CORE`。
   */
  styleOverride?: string;
}

/**
 * text-to-image 用的完整 prompt。
 *
 * 段序固定为 画风 → 取景 → 内容 → 禁令：内容夹在中间，前后都被约束句包住，
 * 实测比「内容在最后」更少出现模型跑偏去画写实照片的情况。
 */
export function buildPrompt(spec: PromptSpec): string {
  const style = spec.styleOverride ?? STYLE_CORE;
  const parts = [style, FRAMING_BY_KIND[spec.kind], `Scene to paint: ${spec.subject}`];
  if (spec.extra) parts.push(spec.extra);
  parts.push(NEGATIVE_CLAUSE);
  return parts.join("\n\n");
}

/**
 * 锚图承接句（image-to-image 专用）。
 *
 * 关键是**两个方向都要说死**：既要「照抄这只手的画法」，又要「别抄这张的内容」。
 * 只写前半句时模型会连构图一起复制（实测：三张图都变成同一个雪坡）。
 */
export const ANCHOR_CLAUSE = [
  "The first attached reference image is a finished plate by the painter you are imitating.",
  "Reproduce its painting style exactly: the same palette and tonality, the same ink-line weight, the same wet-wash behaviour and feathered edges, the same aged-silk ground and surface texture, the same restrained low-chroma colour. Same hand, same album, same century.",
  "Do NOT reuse the reference's subject, composition, framing, season or light direction. Paint an entirely new plate as described below.",
].join(" ");

/**
 * 锚图里那只兽的身份归属句 —— 三支，缺任何一支都出过事。
 *
 * 锚图画的是玩家幼兽，于是它同时是「风格来源」和「一只具体的幼年动物」。这两重身份必须
 * 按图区分，否则：
 * - 非玩家题材（敌人头像）被污染成「带额心灵纹的灰褐狐狸」
 *   —— 实测穴鼠画成狐头、穷奇画成带小翼的狐头、草狐额上多出玩家灵纹，三张全中；
 * - 成长形态（成兽／近神／老死／登神）被「形貌完全一致」压住不长
 *   —— 实测四张全部画成幼兽加装饰，体量与骨架没有任何变化。
 */
function selfIdentityClause(featuresSelf: boolean, growthFromRef: boolean): string {
  if (!featuresSelf) {
    return "IMPORTANT: the animal in the new plate is a completely different species from the grey-brown beast in the reference. Take only paint handling from the reference, never anatomy — do not give the new animal that beast's fox-like head, its grey-brown coat, or the pale mark on its forehead. Paint the species described below and nothing else.";
  }
  if (growthFromRef) {
    return [
      "The additional reference image shows the SAME INDIVIDUAL animal at an earlier age. It is a starting point for identity, not for proportions.",
      "Carry forward only its identity marks: skull shape, ear set, muzzle profile, coat colour family and the position of the forehead mark.",
      "You MUST change its body: obey the scale, mass, build and ornament described in the scene text. This animal is older, heavier and larger than in the reference — a deeper chest, thicker neck and limbs, a broader head, adult proportions rather than a cub's long-legged slightness. Do not reproduce the reference's silhouette.",
    ].join(" ");
  }
  return "The small grey-brown beast with a pale blue-green mark on its forehead in the reference is the same individual animal that appears in the new scene — keep its build, markings and proportions identical.";
}

/** image-to-image 用的完整 prompt：锚图承接句在最前，其余段序与 text-to-image 一致。 */
export function buildAnchoredPrompt(spec: PromptSpec): string {
  const style = spec.styleOverride ?? STYLE_CORE;
  const parts = [
    ANCHOR_CLAUSE,
    selfIdentityClause(spec.featuresSelf ?? false, spec.growthFromRef ?? false),
    style,
    FRAMING_BY_KIND[spec.kind],
    `Scene to paint: ${spec.subject}`,
  ];
  if (spec.extra) parts.push(spec.extra);
  parts.push(NEGATIVE_CLAUSE);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// 锚图评选轮：候选画风措辞
// ---------------------------------------------------------------------------

/**
 * 锚图候选的**同一场景、不同画风措辞**。评选出的一条被提升为 `STYLE_CORE`。
 *
 * 保留在代码里而不是删掉：日后 owner 要求「换个画风」时，这就是已经花过积分的
 * 对照组，直接换 `STYLE_CORE` 引用即可，不用重跑评选。
 */
export const ANCHOR_STYLE_VARIANTS: ReadonlyArray<{ id: string; label: string; style: string }> = [
  {
    id: "a-songsilk",
    label: "宋代绢本设色（矿物色为主，色重）",
    style: [
      "Painted in the style of a Song-dynasty Chinese silk-scroll painting (绢本设色), as an illustration plate from a Shan-Hai-Jing bestiary.",
      "Mineral pigments on silk: azurite blue, malachite green, cinnabar-tinged ochre, ink black; colour laid in flat translucent layers, saturated but never bright.",
      "Fine ink contour lines throughout, gentle wash inside the contours, silk-weave texture visible.",
      "Large areas of bare silk as composition (留白). Quiet, austere, uncanny mood.",
    ].join(" "),
  },
  {
    id: "b-inkwash",
    label: "水墨为骨（近乎单色，设色极淡）",
    style: [
      "Painted as a Chinese ink-wash plate (水墨) on aged silk, in the manner of a Song bestiary illustration for the Shan Hai Jing.",
      "Almost monochrome: ink black through every grey to bare silk, with only the faintest breath of indigo and ochre where life needs it.",
      "Wet brush, bleeding wash edges, dry-brush texture on rock; contour lines sparing and calligraphic.",
      "Vast 留白. Mood: still, cold, uncanny.",
    ].join(" "),
  },
  {
    id: "c-mural",
    label: "壁画感（矿物色＋斑驳剥落）",
    style: [
      "Painted as an ancient Chinese mineral-pigment mural fragment depicting a Shan-Hai-Jing creature.",
      "Earthy mineral palette on plaster: iron oxide red, ochre, malachite, carbon black; pigment visibly flaked and abraded in patches, surface pitted.",
      "Bold flat shapes with soft dark outlines, minimal internal shading, weathered texture across the whole surface.",
      "Empty plaster serves as background. Mood: archaic, votive, ominous.",
    ].join(" "),
  },
  {
    id: "d-agedsilk",
    label: "陈年绢本＋水墨晕染（低彩，绢纹开片）",
    style: STYLE_CORE,
  },
  {
    id: "e-scholar",
    label: "文人小品（笔意疏放，留白极大）",
    style: [
      "Painted as a Chinese literati album leaf (文人小品) of a strange beast, brush-and-ink on aged paper-silk.",
      "Sparse economical brushwork, few strokes carrying the whole form, ink tone doing the work; a single muted accent colour at most.",
      "Deliberately unfinished at the margins; enormous 留白, subject placed off-centre and small.",
      "Mood: detached, wry, faintly melancholy.",
    ].join(" "),
  },
];
