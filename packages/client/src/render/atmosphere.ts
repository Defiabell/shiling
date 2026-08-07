import * as THREE from "three";
import { PALETTE } from "./palette.js";

// 天空穹顶：足够大以完整包住场景（世界边长 240，相机 far=500），
// 静态挂在原点——本图幅世界尺度下相机走不出这个球，不需要每帧跟随相机重定位。
const SKY_RADIUS = 400;

const SKY_VERTEX_SHADER = `
varying float vWorldY;
void main() {
  // 球心在原点、未做缩放/旋转，local position 已等价于 world position；
  // 归一化后 y 分量就是 [-1,1] 的"纬度"参数，供片元做垂直渐变。
  vWorldY = normalize(position).y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT_SHADER = `
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
varying float vWorldY;

void main() {
  // u: 0=天穹最低点, 0.5=地平线, 1=天顶。
  float u = clamp(vWorldY * 0.5 + 0.5, 0.0, 1.0);
  vec3 base = mix(uSkyHorizon, uSkyTop, smoothstep(0.15, 0.75, u));
  // 地平线附近叠一层暖色余晖，随远离地平线快速衰减。
  float glow = 1.0 - smoothstep(0.0, 0.3, abs(u - 0.5));
  vec3 color = mix(base, uSkyGlow, glow * 0.55);
  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * 手写 ShaderMaterial 不会自动拼接 three.js 内置材质那套
 * colorspace_fragment/tonemapping_fragment 收尾 chunk（那是 ShaderLib 模板专属，
 * WebGLProgram 只把用户 fragmentShader 原样拼在 prefix 之后，不做任何后缀注入）。
 * 因此这里的 uniform 颜色必须用 NoColorSpace 跳过 sRGB→linear 转换，
 * 让 shader 里的 mix 直接在 sRGB 数值空间运算、原样输出，
 * 才能对应 PALETTE 里十六进制字面量本来的观感。
 */
function rawColor(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex, THREE.NoColorSpace);
}

function buildSkyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSkyTop: { value: rawColor(PALETTE.skyTop) },
      uSkyHorizon: { value: rawColor(PALETTE.skyHorizon) },
      uSkyGlow: { value: rawColor(PALETTE.skyGlow) },
    },
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "skyDome";
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * 接入整套暮色氛围：天空穹顶 + 指数雾 + 双光源 + 色调映射/输出色彩空间。
 * 调用方（main.ts）负责把旧的 HemisphereLight/DirectionalLight/Fog/背景色代码删掉，
 * 这里是唯一的替代入口。
 */
export function setupAtmosphere(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  scene.add(buildSkyDome());

  scene.fog = new THREE.FogExp2(PALETTE.fog, PALETTE.fogDensity);

  scene.add(new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, PALETTE.hemiIntensity));
  const sun = new THREE.DirectionalLight(PALETTE.sunColor, PALETTE.sunIntensity);
  sun.position.set(...PALETTE.sunPos);
  scene.add(sun);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

const PAPER_ID = "shiling-paper-overlay";
const VIGNETTE_ID = "shiling-vignette-overlay";
const NOISE_TILE_SIZE = 256;
const NOISE_BASE = 220;
const NOISE_SPREAD = 18;

/**
 * 生成 256×256 灰度噪声（每像素 220±18），返回可直接用作 CSS background-image 的 data URL。
 * 导出供 title.ts（Task 9）复用同一份纹理生成逻辑——两处都是"纸色噪底"，
 * 不重复实现一遍 canvas 噪声算法。
 */
export function generatePaperNoiseDataUrl(): string {
  const canvas = document.createElement("canvas");
  canvas.width = NOISE_TILE_SIZE;
  canvas.height = NOISE_TILE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("generatePaperNoiseDataUrl: 2D context unavailable");
  const image = ctx.createImageData(NOISE_TILE_SIZE, NOISE_TILE_SIZE);
  for (let i = 0; i < image.data.length; i += 4) {
    const gray = Math.round(NOISE_BASE + (Math.random() * 2 - 1) * NOISE_SPREAD);
    image.data[i] = gray;
    image.data[i + 1] = gray;
    image.data[i + 2] = gray;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/**
 * 注入纸纹 + 暗角两层全屏叠加 DOM（z-index 低于 #hud 的 10，pointer-events:none，
 * 不拦截画布的拖拽视角输入）。幂等：重复调用不会重复注入。
 */
export function mountPaperOverlay(): void {
  if (document.getElementById(PAPER_ID)) return;

  const paper = document.createElement("div");
  paper.id = PAPER_ID;
  paper.style.position = "fixed";
  paper.style.inset = "0";
  paper.style.zIndex = "5";
  paper.style.pointerEvents = "none";
  paper.style.backgroundImage = `url(${generatePaperNoiseDataUrl()})`;
  paper.style.backgroundRepeat = "repeat";
  paper.style.backgroundSize = `${NOISE_TILE_SIZE}px ${NOISE_TILE_SIZE}px`;
  paper.style.mixBlendMode = "multiply";
  paper.style.opacity = "0.16";
  document.body.appendChild(paper);

  const vignette = document.createElement("div");
  vignette.id = VIGNETTE_ID;
  vignette.style.position = "fixed";
  vignette.style.inset = "0";
  vignette.style.zIndex = "6";
  vignette.style.pointerEvents = "none";
  vignette.style.background = "radial-gradient(transparent 55%, rgba(10, 12, 16, 0.45) 100%)";
  document.body.appendChild(vignette);
}
