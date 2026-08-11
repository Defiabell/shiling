import { describe, expect, it } from "vitest";
import {
  ENDING_LABELS,
  formatCountCn,
  formatSigned,
  formatWhen,
  formatYearCn,
  toPercent,
} from "../src/model/format.js";

describe("formatYearCn", () => {
  it("0 岁作「初」", () => {
    expect(formatYearCn(0)).toBe("初");
  });

  it("个位数直取汉字", () => {
    expect(formatYearCn(1)).toBe("一");
    expect(formatYearCn(9)).toBe("九");
  });

  it("十位省「一」：10 是「十」不是「一十」", () => {
    expect(formatYearCn(10)).toBe("十");
    expect(formatYearCn(11)).toBe("十一");
    expect(formatYearCn(19)).toBe("十九");
  });

  it("二十以上正常拼", () => {
    expect(formatYearCn(20)).toBe("二十");
    expect(formatYearCn(37)).toBe("三十七");
    expect(formatYearCn(99)).toBe("九十九");
  });

  it("≥100 与非法值都不崩", () => {
    expect(formatYearCn(100)).toBe("100");
    expect(formatYearCn(-3)).toBe("初");
    expect(formatYearCn(Number.NaN)).toBe("初");
  });
});

describe("formatCountCn", () => {
  it("计数 0 是「〇」而不是岁数那套「初」", () => {
    expect(formatCountCn(0)).toBe("〇");
    expect(formatCountCn(2)).toBe("二");
    expect(formatCountCn(12)).toBe("十二");
  });

  it("越界退回阿拉伯数字", () => {
    expect(formatCountCn(120)).toBe("120");
  });
});

describe("formatWhen", () => {
  it("岁·季·地三段用全角间隔号", () => {
    expect(formatWhen(3, 2, "qingqiu")).toBe("三岁 · 秋 · 青丘");
  });

  it("未知地域原样回显（内容 bug 可见化，不静默）", () => {
    expect(formatWhen(1, 0, "hutu")).toBe("一岁 · 春 · hutu");
  });
});

describe("formatSigned", () => {
  it("正数带 +，负数用全角减号（避免和连字符混淆）", () => {
    expect(formatSigned(6)).toBe("+6");
    expect(formatSigned(-2)).toBe("−2");
    expect(formatSigned(0)).toBe("0");
  });
});

describe("toPercent", () => {
  it("四舍五入并夹紧到 0〜100", () => {
    expect(toPercent(0.625)).toBe(63);
    expect(toPercent(-1)).toBe(0);
    expect(toPercent(4)).toBe(100);
    expect(toPercent(Number.NaN)).toBe(0);
  });
});

describe("ENDING_LABELS", () => {
  it("四种结局都有中文名", () => {
    expect(Object.keys(ENDING_LABELS).sort()).toEqual(["ascend", "oldage", "slain", "starve"]);
  });
});
