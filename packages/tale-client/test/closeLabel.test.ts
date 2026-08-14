/**
 * 收束那颗按钮的字样 —— 「成道 ＝ 登临」这条对应的回归锁。
 *
 * 它值一个专门的测试文件，因为它**曾经静默失效过**：2026-08-14 那次死局修复把
 * 「先算完整张卡、再落状态」的顺序调了过来，而当时的 `closeLabel()` 是一个读 `this.state`
 * 的方法 —— 于是它读到的恒是上一帧（那一帧必然还活着，`ending` 恒为 null），成道那一世的
 * 按钮会永远印成「瞑目」。四条道里三条走 `doChoice`，500 世冒烟里成道占一成三，是主路。
 *
 * 那次失效没有任何测试变红。所以这条对应现在是一个**纯函数 ＋ 一条断言**：纯函数读不到
 * 实例状态（时序坑在签名上就犯不了），断言把映射本身钉住。
 */

import { describe, expect, it } from "vitest";
import { closeLabelFor } from "../src/app.js";

describe("closeLabelFor", () => {
  it("成道印「登临」", () => {
    expect(closeLabelFor("ascend")).toBe("登　临");
  });

  it("另外三种结局与「还没死」都印「瞑目」", () => {
    expect(closeLabelFor("starve")).toBe("瞑　目");
    expect(closeLabelFor("slain")).toBe("瞑　目");
    expect(closeLabelFor("oldage")).toBe("瞑　目");
    expect(closeLabelFor(null)).toBe("瞑　目");
  });
});
