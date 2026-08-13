/**
 * dev server 的 AI 网关代打中间件 —— **密钥只活在 Node 侧**。
 *
 * ## 为什么必须是中间件，而不是浏览器直连网关
 * 直连要把 `sk-` key 打进前端包，等于把组织的 LiteLLM 预算发给每一个拿到构建产物的人；
 * 顺带还得处理跨域。中间件把两件事一起解决：浏览器只知道同源的 `/ai/chat`，
 * 密钥在服务端注入，`envs/aigw.env` 本身在 workspace 的 .gitignore 里。
 *
 * ## 生产构建怎么办
 * 本插件只挂在 `configureServer` 上，`vite build` 出来的静态站没有这两个端点 ——
 * 于是 `fetch("/ai/chat")` 拿到 404，史官静默回落模板版，游戏照常（架构红线 4）。
 * 真要上线 AI 版，得另配一个同样形状的服务端点，这里不做假设。
 *
 * ## 遥测
 * `/ai/telemetry` 把每一世的 token／耗时／成本追加到 `.ai-log/chronicle.jsonl`（已 gitignore）。
 * 记在服务端而不是 localStorage：验收要拿这份日志报「每世成本与延迟」的实测值。
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE = "https://aigw.meshy.team/v1";
/** 网关的可观测头，原样透给浏览器 —— 成本就在其中一条里（body 里没有）。 */
const RELAYED_HEADERS = [
  "x-litellm-response-cost",
  "x-litellm-call-id",
  "x-litellm-model-api-base",
  "x-litellm-attempted-fallbacks",
  "x-litellm-attempted-retries",
];
const MAX_BODY_BYTES = 512 * 1024;

interface Credentials {
  key: string;
  baseUrl: string;
  /** 只用于启动时那一行日志，绝不含 key */
  source: string;
}

/** 从某个目录逐级向上找 `envs/aigw.env`（本仓库在 workspace 的 personal-projects/ 下）。 */
function findEnvFile(from: string): string | null {
  let dir = from;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, "envs", "aigw.env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/gu, "");
  }
  return out;
}

async function loadCredentials(): Promise<Credentials | null> {
  const envKey = process.env.AIGW_API_KEY;
  if (envKey !== undefined && envKey.length > 0) {
    return {
      key: envKey,
      baseUrl: process.env.AIGW_BASE_URL ?? DEFAULT_BASE,
      source: "环境变量 AIGW_API_KEY",
    };
  }
  const file = process.env.AIGW_ENV_FILE ?? findEnvFile(resolve(HERE));
  if (file === null) return null;
  try {
    const parsed = parseEnvFile(await readFile(file, "utf8"));
    const key = parsed.AIGW_API_KEY;
    if (key === undefined || key.length === 0) return null;
    return { key, baseUrl: parsed.AIGW_BASE_URL ?? DEFAULT_BASE, source: file };
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // 史官的请求体只有几 KB；上限存在是为了别让一个写错的循环把 dev server 撑爆
      if (size > MAX_BODY_BYTES) {
        rejectPromise(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectPromise);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(body);
}

export interface AigwPluginOptions {
  /** 遥测落盘位置（相对 tale-client 包根） */
  logFile?: string;
}

export function aigwPlugin(options: AigwPluginOptions = {}): Plugin {
  const logFile = resolve(HERE, options.logFile ?? ".ai-log/chronicle.jsonl");
  let credentials: Credentials | null = null;
  let loaded = false;

  const ensureCredentials = async (): Promise<Credentials | null> => {
    if (!loaded) {
      credentials = await loadCredentials();
      loaded = true;
    }
    return credentials;
  };

  return {
    name: "shiling-aigw",
    apply: "serve",
    configureServer(server) {
      void ensureCredentials().then((creds) => {
        server.config.logger.info(
          creds === null
            ? "[aigw] 未找到 key（envs/aigw.env 或 AIGW_API_KEY）—— 列传走模板版"
            : `[aigw] 已就绪：key 取自 ${creds.source}`,
        );
      });

      server.middlewares.use("/ai/chat", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        void (async () => {
          const creds = await ensureCredentials();
          if (creds === null) {
            // 503 而不是 500：这是「没配」，客户端据此静默回落，不该当成故障
            sendJson(res, 503, { error: "aigw-key-missing" });
            return;
          }
          try {
            const body = await readBody(req);
            const upstream = await fetch(`${creds.baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${creds.key}`,
              },
              body,
            });
            for (const name of RELAYED_HEADERS) {
              const value = upstream.headers.get(name);
              if (value !== null) res.setHeader(name, value);
            }
            const text = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
            res.end(text);
          } catch (error) {
            // 上游的错误消息可能带 URL 与请求内容，但绝不含 key（key 只在 header 里）
            sendJson(res, 502, { error: "aigw-upstream", detail: String(error).slice(0, 300) });
          }
        })();
      });

      server.middlewares.use("/ai/telemetry", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        void (async () => {
          try {
            const body = await readBody(req);
            await mkdir(dirname(logFile), { recursive: true });
            await appendFile(logFile, `${body.trim()}\n`, "utf8");
            sendJson(res, 200, { ok: true });
          } catch (error) {
            sendJson(res, 500, { error: String(error).slice(0, 200) });
          }
        })();
      });
    },
  };
}
