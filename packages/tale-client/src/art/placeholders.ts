/**
 * 程序化水墨占位图（SVG data URI）。
 *
 * 开发期顶 B4 美术管线的位置：真图（Meshy text-to-image）到位后，事件数据里的
 * `illustration` 一填，这里就不再被调用。所以这里的目标不是「像成品」，而是
 * **构图与色温对得上**——远山剪影＋一点灯火＋大片留白与暗角，好让排版/对比度的判断
 * 在换成真图后仍然成立。
 *
 * 手法：`feTurbulence` ＋ `feDisplacementMap` 把规整的椭圆推成墨迹边缘，几层叠出远近。
 * 纯字符串拼接，无 DOM、无 canvas —— 可以直接进 `<img src>`、CSS `url()` 与
 * Playwright 截图。
 */

export type InkArtKind = "title" | "event" | "molt" | "death" | "ascend" | "seed";

export interface InkArtOptions {
  /** 画布宽高（决定 viewBox，不决定显示尺寸） */
  width?: number;
  height?: number;
}

/** 稳定字符串哈希（FNV-1a 变体）—— 同一事件 id 每次拿到同一张图。 */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 由哈希派生的伪随机序列（0〜1），保证同 key 同图。 */
function seriesOf(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

interface Accent {
  glow: string;
  glowAlpha: number;
  ink: string;
  /** 光源位置（0〜1） */
  lightX: number;
  lightY: number;
}

const ACCENTS: Record<InkArtKind, Accent> = {
  // 题字：月出东山，暖金弱光，山势最重
  title: { glow: "232,180,95", glowAlpha: 0.42, ink: "10,13,18", lightX: 0.72, lightY: 0.24 },
  // 事件：普通暮色，光更淡，留白更多（正文压在上面要读得清）
  event: { glow: "200,190,166", glowAlpha: 0.26, ink: "12,15,21", lightX: 0.66, lightY: 0.3 },
  // 蜕变：青蓝灵光自下而上
  molt: { glow: "111,216,232", glowAlpha: 0.4, ink: "10,14,20", lightX: 0.5, lightY: 0.72 },
  // 死亡：朱砂一点，几乎全墨
  death: { glow: "194,59,34", glowAlpha: 0.3, ink: "7,8,11", lightX: 0.5, lightY: 0.56 },
  // 登神：白光垂落
  ascend: { glow: "244,240,228", glowAlpha: 0.55, ink: "12,16,24", lightX: 0.5, lightY: 0.12 },
  // 神种：静物感，暖灰
  seed: { glow: "216,200,168", glowAlpha: 0.3, ink: "11,14,19", lightX: 0.4, lightY: 0.38 },
};

/** 一层远山：越远越淡越高。 */
function ridge(
  y: number,
  height: number,
  width: number,
  alpha: number,
  ink: string,
  filterId: string,
  rand: () => number,
): string {
  const cx = width * (0.2 + rand() * 0.6);
  const rx = width * (0.42 + rand() * 0.36);
  const ry = height * (0.16 + rand() * 0.2);
  return `<ellipse cx="${cx.toFixed(1)}" cy="${(y + ry).toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="rgba(${ink},${alpha})" filter="url(#${filterId})"/>`;
}

/**
 * 生成一张水墨占位图的 data URI。
 *
 * @param kind 用途（决定色温与构图）
 * @param key  稳定键（事件 id／屏名）—— 同 key 同图
 */
export function inkArt(kind: InkArtKind, key: string, options: InkArtOptions = {}): string {
  const width = options.width ?? 900;
  const height = options.height ?? 600;
  const accent = ACCENTS[kind];
  const seed = hashKey(`${kind}:${key}`);
  const rand = seriesOf(seed);
  const turbSeed = seed % 9973;
  const fid = `ink${turbSeed}`;

  // 山层铺到画面下缘（0.34→0.92）：只画到七成高时，下面三成是一片死黑，
  // 在事件卡里会被当成「图没加载出来」。
  const ridges: string[] = [];
  const layers = kind === "death" ? 4 : 6;
  for (let i = 0; i < layers; i += 1) {
    const t = i / Math.max(1, layers - 1);
    const y = height * (0.34 + t * 0.58);
    ridges.push(ridge(y, height, width, 0.34 + t * 0.52, accent.ink, fid, rand));
  }
  // 一条贴着山腰的雾带，把层与层之间的硬边化开
  ridges.splice(
    Math.max(1, layers - 3),
    0,
    `<rect x="0" y="${(height * 0.52).toFixed(1)}" width="${width}" height="${(height * 0.2).toFixed(1)}" fill="url(#mist)"/>`,
  );

  // 登神多一根光柱；蜕变多一团上浮灵光
  const extras: string[] = [];
  if (kind === "ascend") {
    const cx = width * 0.5;
    const w = width * 0.09;
    extras.push(
      `<path d="M${(cx - w * 0.35).toFixed(1)} 0 L${(cx + w * 0.35).toFixed(1)} 0 L${(cx + w).toFixed(1)} ${(height * 0.82).toFixed(1)} L${(cx - w).toFixed(1)} ${(height * 0.82).toFixed(1)} Z" fill="url(#beam)"/>`,
    );
  }
  if (kind === "molt") {
    for (let i = 0; i < 7; i += 1) {
      const x = width * (0.3 + rand() * 0.4);
      const y = height * (0.35 + rand() * 0.45);
      const r = 2 + rand() * 4;
      extras.push(
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="rgba(${accent.glow},${(0.25 + rand() * 0.4).toFixed(2)})"/>`,
      );
    }
  }
  // 画在暗角**之上**的层：月亮是画面里最亮的光源，压在暗角下面会变成一枚灰饼
  // （第一版就是这么翻的车）。
  const topExtras: string[] = [];
  if (kind === "title") {
    const mx = width * 0.7;
    const my = height * 0.19;
    const mr = height * 0.042;
    topExtras.push(
      `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${(mr * 4).toFixed(1)}" fill="url(#halo)"/>`,
      `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${mr.toFixed(1)}" fill="#faf5ea"/>`,
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="presentation">
<defs>
<linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#0d1116"/><stop offset=".46" stop-color="#171d26"/><stop offset="1" stop-color="#090b0f"/>
</linearGradient>
<radialGradient id="glow" cx="${accent.lightX}" cy="${accent.lightY}" r=".62">
<stop offset="0" stop-color="rgba(${accent.glow},${accent.glowAlpha})"/>
<stop offset=".55" stop-color="rgba(${accent.glow},${(accent.glowAlpha * 0.28).toFixed(3)})"/>
<stop offset="1" stop-color="rgba(${accent.glow},0)"/>
</radialGradient>
<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="rgba(${accent.glow},.5)"/><stop offset="1" stop-color="rgba(${accent.glow},0)"/>
</linearGradient>
<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="rgba(${accent.glow},0)"/>
<stop offset=".5" stop-color="rgba(${accent.glow},.1)"/>
<stop offset="1" stop-color="rgba(${accent.glow},0)"/>
</linearGradient>
<radialGradient id="halo" cx=".5" cy=".5" r=".5">
<stop offset="0" stop-color="rgba(246,240,226,.42)"/>
<stop offset=".45" stop-color="rgba(246,240,226,.12)"/>
<stop offset="1" stop-color="rgba(246,240,226,0)"/>
</radialGradient>
<radialGradient id="vig" cx=".5" cy=".5" r=".78">
<stop offset=".52" stop-color="rgba(6,7,10,0)"/><stop offset="1" stop-color="rgba(6,7,10,.72)"/>
</radialGradient>
<filter id="${fid}" x="-25%" y="-25%" width="150%" height="150%">
<feTurbulence type="fractalNoise" baseFrequency="0.011 0.021" numOctaves="4" seed="${turbSeed}" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="${(height * 0.11).toFixed(1)}" xChannelSelector="R" yChannelSelector="G"/>
<feGaussianBlur stdDeviation="${(height * 0.0035).toFixed(2)}"/>
</filter>
</defs>
<rect width="${width}" height="${height}" fill="url(#base)"/>
<rect width="${width}" height="${height}" fill="url(#glow)"/>
${extras.join("")}
${ridges.join("")}
<rect width="${width}" height="${height}" fill="url(#vig)"/>
${topExtras.join("")}
</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\n/g, ""))}`;
}

/** 页面底纹：极淡的纸纹噪点，铺在全局背景上防止大面积纯色显得廉价。 */
export function paperGrain(opacity = 0.035): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".82" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="180" height="180" filter="url(#g)" opacity="${opacity}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
