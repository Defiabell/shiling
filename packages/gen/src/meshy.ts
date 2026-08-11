// Thin client for the Meshy API (https://docs.meshy.ai).
// Verified against live docs on 2026-08-08 — endpoints/params below reflect the
// current API, not prior training-data assumptions. See meshy-pipeline-report.md
// for the full findings (in particular: auto-rigging/animation are biped-only,
// not usable for the quadruped creatures this pipeline generates).

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = "https://api.meshy.ai";

// ---------------------------------------------------------------------------
// API key loading — never read from process.env by convention here; parse the
// git-ignored envs/meshy.env file directly so the caller never has to export
// anything. Walk upward from this module to find envs/meshy.env so the loader
// keeps working if this package ever moves.
// ---------------------------------------------------------------------------

function findEnvFile(): string {
  const startDir = dirname(fileURLToPath(import.meta.url));
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "envs", "meshy.env");
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      // not here, keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate envs/meshy.env by walking up from ${startDir}. ` +
      `Expected it at the workspace root (envs/meshy.env).`
  );
}

function readApiKey(): string {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  const envPath = findEnvFile();
  const raw = readFileSync(envPath, "utf8");
  const line = raw.split("\n").find((l) => l.trim().startsWith("MESHY_API_KEY="));
  if (!line) throw new Error(`MESHY_API_KEY not found in ${envPath}`);
  const value = line.slice(line.indexOf("=") + 1).trim();
  if (!value) throw new Error(`MESHY_API_KEY is empty in ${envPath}`);
  return value;
}

const API_KEY = readApiKey();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `Meshy API ${init?.method ?? "GET"} ${path} -> HTTP ${res.status}: ${JSON.stringify(body)}`
    );
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Text to 3D — POST /openapi/v2/text-to-3d (mode: preview | refine)
// ---------------------------------------------------------------------------

export type AiModel = "meshy-5" | "meshy-6" | "latest";
export type Topology = "quad" | "triangle";
export type TextureResolution = "2k" | "4k" | "8k";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface TextTo3DTask {
  id: string;
  type?: string;
  status: TaskStatus;
  progress: number;
  prompt?: string;
  texture_prompt?: string;
  model_urls?: Partial<Record<"glb" | "fbx" | "obj" | "mtl" | "usdz" | "stl" | "3mf", string>>;
  texture_urls?: Array<Record<string, string>>;
  thumbnail_url?: string;
  created_at?: number;
  started_at?: number;
  finished_at?: number;
  consumed_credits?: number;
  task_error?: { message?: string } | null;
}

export interface CreatePreviewParams {
  prompt: string;
  negativePrompt?: string;
  aiModel?: AiModel;
  topology?: Topology;
  targetPolycount?: number;
  shouldRemesh?: boolean;
}

export async function createTextTo3DPreview(params: CreatePreviewParams): Promise<string> {
  const body: Record<string, unknown> = {
    mode: "preview",
    prompt: params.prompt,
  };
  if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
  if (params.aiModel) body.ai_model = params.aiModel;
  if (params.topology) body.topology = params.topology;
  if (params.targetPolycount) body.target_polycount = params.targetPolycount;
  if (params.shouldRemesh !== undefined) body.should_remesh = params.shouldRemesh;

  const res = await request<{ result: string }>("/openapi/v2/text-to-3d", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.result;
}

export interface CreateRefineParams {
  previewTaskId: string;
  textureResolution?: TextureResolution;
  texturePrompt?: string;
  enablePbr?: boolean;
  aiModel?: AiModel;
}

export async function createTextTo3DRefine(params: CreateRefineParams): Promise<string> {
  const body: Record<string, unknown> = {
    mode: "refine",
    preview_task_id: params.previewTaskId,
  };
  if (params.textureResolution) body.texture_resolution = params.textureResolution;
  if (params.texturePrompt) body.texture_prompt = params.texturePrompt;
  if (params.enablePbr !== undefined) body.enable_pbr = params.enablePbr;
  if (params.aiModel) body.ai_model = params.aiModel;

  const res = await request<{ result: string }>("/openapi/v2/text-to-3d", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.result;
}

export async function getTextTo3DTask(id: string): Promise<TextTo3DTask> {
  return request<TextTo3DTask>(`/openapi/v2/text-to-3d/${id}`);
}

// ---------------------------------------------------------------------------
// Auto-Rigging — POST /openapi/v1/rigging
// Docs (verified 2026-08-08): "currently only works well with standard
// humanoid (bipedal) assets with clearly defined limbs and body structure."
// Non-humanoid assets are explicitly called out as unsuitable. Implemented
// here for completeness/future humanoid creatures, but NOT invoked by
// generate-creatures.ts for the current quadruped batch.
// ---------------------------------------------------------------------------

export interface RiggingTask {
  id: string;
  status: TaskStatus;
  progress: number;
  consumed_credits?: number;
  result?: {
    rigged_character_fbx_url?: string;
    rigged_character_glb_url?: string;
    basic_animations?: Record<string, string>;
  };
}

export async function createRiggingTask(params: {
  inputTaskId?: string;
  modelUrl?: string;
  heightMeters?: number;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (params.inputTaskId) body.input_task_id = params.inputTaskId;
  if (params.modelUrl) body.model_url = params.modelUrl;
  if (params.heightMeters) body.height_meters = params.heightMeters;

  const res = await request<{ result: string }>("/openapi/v1/rigging", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.result;
}

export async function getRiggingTask(id: string): Promise<RiggingTask> {
  return request<RiggingTask>(`/openapi/v1/rigging/${id}`);
}

// ---------------------------------------------------------------------------
// Animation — POST /openapi/v1/animations (requires a completed rig task,
// action_id from Meshy's ~600-entry animation library). Library is biped
// oriented (walk/run/fight/dance/etc for humanoids); not applicable to our
// quadruped creatures. Implemented for completeness only.
// ---------------------------------------------------------------------------

export interface AnimationTask {
  id: string;
  status: TaskStatus;
  progress: number;
  consumed_credits?: number;
  result?: {
    animation_glb_url?: string;
    animation_fbx_url?: string;
  };
}

export async function createAnimationTask(params: {
  rigTaskId: string;
  actionId: number;
}): Promise<string> {
  const res = await request<{ result: string }>("/openapi/v1/animations", {
    method: "POST",
    body: JSON.stringify({ rig_task_id: params.rigTaskId, action_id: params.actionId }),
  });
  return res.result;
}

export async function getAnimationTask(id: string): Promise<AnimationTask> {
  return request<AnimationTask>(`/openapi/v1/animations/${id}`);
}

// ---------------------------------------------------------------------------
// Text to Image — POST /openapi/v1/text-to-image
// Image to Image — POST /openapi/v1/image-to-image
//
// Verified against live docs + live API on 2026-08-11 (B4 art pipeline). Two
// facts that differ from the 3D endpoints above and bite if assumed:
//   1. `ai_model` is REQUIRED and its vocabulary is disjoint from AiModel
//      ("nano-banana*" / "gpt-image-2", not "meshy-*").
//   2. There is NO `negative_prompt` parameter. Negative constraints have to be
//      written into `prompt` as explicit prohibitions — see artStyle.ts's
//      NEGATIVE_CLAUSE.
// Allowed `aspect_ratio` values depend on the model; see artStyle.ts.
//
// image_urls are pre-signed and expire (`expires_at`), so download promptly.
// ---------------------------------------------------------------------------

export interface ImageTask {
  id: string;
  type?: string;
  ai_model?: string;
  prompt?: string;
  status: TaskStatus;
  progress: number;
  created_at?: number;
  finished_at?: number;
  expires_at?: number;
  preceding_tasks?: number;
  image_urls?: string[];
  consumed_credits?: number;
  task_error?: { message?: string } | null;
}

export interface CreateTextToImageParams {
  aiModel: string;
  prompt: string;
  /** Omit when `generateMultiView` is set — the API rejects both together. */
  aspectRatio?: string;
  generateMultiView?: boolean;
  poseMode?: "a-pose" | "t-pose";
}

export async function createTextToImage(params: CreateTextToImageParams): Promise<string> {
  const body: Record<string, unknown> = {
    ai_model: params.aiModel,
    prompt: params.prompt,
  };
  if (params.generateMultiView) body.generate_multi_view = true;
  else if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
  if (params.poseMode) body.pose_mode = params.poseMode;

  const res = await request<{ result: string }>("/openapi/v1/text-to-image", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.result;
}

export async function getTextToImageTask(id: string): Promise<ImageTask> {
  return request<ImageTask>(`/openapi/v1/text-to-image/${id}`);
}

export interface CreateImageToImageParams {
  aiModel: string;
  prompt: string;
  /**
   * 1–5 references. Each is either a publicly reachable https URL or a
   * `data:image/...;base64,...` URI. The anchor pipeline uses a data URI so the
   * anchor keeps working after the source task's signed URL expires.
   */
  referenceImageUrls: string[];
  aspectRatio?: string;
  generateMultiView?: boolean;
}

export async function createImageToImage(params: CreateImageToImageParams): Promise<string> {
  if (params.referenceImageUrls.length < 1 || params.referenceImageUrls.length > 5) {
    throw new Error(
      `image-to-image needs 1..5 reference images, got ${params.referenceImageUrls.length}`
    );
  }
  const body: Record<string, unknown> = {
    ai_model: params.aiModel,
    prompt: params.prompt,
    reference_image_urls: params.referenceImageUrls,
  };
  if (params.generateMultiView) body.generate_multi_view = true;
  else if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;

  const res = await request<{ result: string }>("/openapi/v1/image-to-image", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.result;
}

export async function getImageToImageTask(id: string): Promise<ImageTask> {
  return request<ImageTask>(`/openapi/v1/image-to-image/${id}`);
}

// ---------------------------------------------------------------------------
// Balance — GET /openapi/v1/balance
// ---------------------------------------------------------------------------

export async function getBalance(): Promise<number> {
  const res = await request<{ balance: number }>("/openapi/v1/balance");
  return res.balance;
}

// ---------------------------------------------------------------------------
// Generic polite polling — 5s interval, 20min timeout per task, console progress.
// ---------------------------------------------------------------------------

export async function pollTask<T extends { status: TaskStatus; progress: number }>(
  label: string,
  fetchTask: () => Promise<T>,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000;
  const deadline = Date.now() + timeoutMs;
  let lastLogged = -1;

  while (true) {
    const task = await fetchTask();
    if (task.progress !== lastLogged) {
      console.log(`  [${label}] status=${task.status} progress=${task.progress}%`);
      lastLogged = task.progress;
    }
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(`[${label}] task ended with status=${task.status}: ${JSON.stringify(task)}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`[${label}] timed out after ${timeoutMs}ms waiting for task to complete`);
    }
    await sleep(intervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Download helper — fetches a binary URL to disk, creating parent dirs.
// ---------------------------------------------------------------------------

export async function downloadFile(url: string, destPath: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, buf);
  return buf.byteLength;
}
