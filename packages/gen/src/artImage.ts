/**
 * 本地图片处理 —— webp 压缩与锚图 JPEG 化。
 *
 * ## 为什么用外部二进制而不是 sharp
 * sharp 在本仓库里只是 `@gltf-transform/cli` 的传递依赖，从 packages/gen 解析不到
 * （已实测 `require.resolve` 失败）。把它提成 gen 的直接依赖要改 package.json ＋
 * pnpm-lock.yaml，而 B3 正在并行改 tale-client —— lockfile 是两条线唯一的撞车点。
 * `cwebp` 与 `ffmpeg` 都已在机器上，走 CLI 零依赖变更。
 *
 * 需要：`cwebp`（brew install webp）、`ffmpeg`。缺任一会在管线开跑前就报清楚，
 * 而不是等 60 张图生成完才失败。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

function ensureBinary(name: string, installHint: string): void {
  try {
    execFileSync("/usr/bin/which", [name], { stdio: "pipe" });
  } catch {
    throw new Error(`缺少 ${name}，本地图片处理跑不了。安装：${installHint}`);
  }
}

/** 管线开跑前的前置检查 —— 宁可现在失败，也不要生成完 60 张图才发现压不了。 */
export function assertImageToolsAvailable(): void {
  ensureBinary("cwebp", "brew install webp");
  ensureBinary("dwebp", "brew install webp");
  ensureBinary("ffmpeg", "brew install ffmpeg");
  ensureBinary("ffprobe", "brew install ffmpeg");
}

/** 源图像素宽。用来避免把 API 出的图放大 —— 放大只会变糊并且白占体积。 */
export function imageWidth(srcPath: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", srcPath],
    { encoding: "utf8" }
  );
  const width = Number.parseInt(out.trim(), 10);
  if (!Number.isFinite(width) || width <= 0) throw new Error(`读不出 ${srcPath} 的宽度：${out}`);
  return width;
}

/**
 * PNG → webp，按目标宽缩放（**只缩不放**）。
 *
 * `-resize <w> 0` 让 cwebp 保持长宽比（高度自动）。质量 82 是实测在这批水墨／绢本
 * 画面上肉眼无损的下限：再低，水墨晕染的柔边会开始出现色带。
 */
export function encodeWebp(
  srcPath: string,
  destPath: string,
  opts: { width: number; quality?: number }
): number {
  mkdirSync(dirname(destPath), { recursive: true });
  const targetWidth = Math.min(opts.width, imageWidth(srcPath));
  execFileSync(
    "cwebp",
    [
      "-quiet",
      "-q",
      String(opts.quality ?? 82),
      "-m",
      "6",
      "-resize",
      String(targetWidth),
      "0",
      srcPath,
      "-o",
      destPath,
    ],
    { stdio: "pipe" }
  );
  if (!existsSync(destPath)) throw new Error(`cwebp 没有产出 ${destPath}`);
  return statSync(destPath).size;
}

/**
 * webp → PNG 解码。
 *
 * 追加参考图（立绘承接）指向的是仓库里已成图的 webp，而 image-to-image 的
 * `reference_image_urls` 只吃 jpg/jpeg/png。先解回 PNG 再 base64。
 */
export function decodeWebpToPng(srcPath: string, destPath: string): string {
  mkdirSync(dirname(destPath), { recursive: true });
  execFileSync("dwebp", [srcPath, "-quiet", "-o", destPath], { stdio: "pipe" });
  if (!existsSync(destPath)) throw new Error(`dwebp 没有产出 ${destPath}`);
  return destPath;
}

/**
 * PNG → JPEG（锚图专用）。
 *
 * image-to-image 的 `reference_image_urls` 只接受 jpg/jpeg/png（webp 不行，docs 明写），
 * 所以正典锚图以 JPEG 落盘：既能当参考图直接 base64，也能肉眼查看。
 */
export function encodeJpeg(
  srcPath: string,
  destPath: string,
  opts: { width: number; quality?: number }
): number {
  mkdirSync(dirname(destPath), { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      srcPath,
      "-vf",
      `scale=${opts.width}:-2:flags=lanczos`,
      "-q:v",
      String(opts.quality ?? 3),
      destPath,
    ],
    { stdio: "pipe" }
  );
  if (!existsSync(destPath)) throw new Error(`ffmpeg 没有产出 ${destPath}`);
  return statSync(destPath).size;
}
