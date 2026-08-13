/**
 * 客户端这一侧的 AI 接线 —— 只有三件事值得测：开关、模型白名单、跨包的字表不漂移。
 *
 * 「默认关」这条尤其要钉死：任何没显式给配置的入口（测试、生产构建、别的宿主）都不该
 * 在玩家死亡那一刻发出网络请求。
 */

import { describe, expect, it } from "vitest";
import { WAY_LABELS as AI_WAY_LABELS } from "@shiling/tale-ai";
import { AI_MODEL, historianConfig } from "../src/ai/historian.js";
import { WAY_LABELS } from "../src/model/format.js";

describe("historianConfig", () => {
  it("非 dev 一律关（生产构建没有 /ai/chat 那个端点）", () => {
    expect(historianConfig("", false).enabled).toBe(false);
    expect(historianConfig("?ai=1", false).enabled).toBe(false);
  });

  it("dev 默认开，`?ai=0` 关（离线回落验收就靠它）", () => {
    expect(historianConfig("", true).enabled).toBe(true);
    expect(historianConfig("?ai=0", true).enabled).toBe(false);
    expect(historianConfig("?seed=7&ai=0", true).enabled).toBe(false);
  });

  it("缺省模型是 -with-fallback 别名（自托管型号下线过两次）", () => {
    expect(historianConfig("", true).model).toBe(AI_MODEL);
    expect(AI_MODEL).toContain("with-fallback");
  });

  it("`?aimodel=` 只收形状像网关 id 的值，别的退回缺省", () => {
    expect(historianConfig("?aimodel=litellm/gpt-latest", true).model).toBe("litellm/gpt-latest");
    expect(historianConfig("?aimodel=<script>", true).model).toBe(AI_MODEL);
    expect(historianConfig("?aimodel=", true).model).toBe(AI_MODEL);
  });

  it("端点恒为同源相对路径（密钥留在 Node 侧，也不涉跨域）", () => {
    expect(historianConfig("", true).endpoint.startsWith("/")).toBe(true);
  });
});

describe("跨包字表", () => {
  it("tale-ai 的四道汉字名与界面那份逐字相同", () => {
    // 两份是抄的（依赖方向不许 ai → client），所以由这条断言挡漂移
    expect(AI_WAY_LABELS).toEqual(WAY_LABELS);
  });
});
