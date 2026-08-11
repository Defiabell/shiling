import { describe, expect, it } from "vitest";
import { LOG_CAPACITY, emptyLog, pushLog, recentLogVm } from "../src/model/logVm.js";

describe("pushLog", () => {
  it("追加并给单调递增 id", () => {
    const buffer = pushLog(emptyLog(), 1, 0, [{ text: "甲" }, { text: "乙", tone: "gain" }]);
    expect(buffer.entries.map((entry) => entry.id)).toEqual([1, 2]);
    expect(buffer.entries[1]?.tone).toBe("gain");
    expect(buffer.nextId).toBe(3);
  });

  it("不改入参（旧缓冲还能用）", () => {
    const before = pushLog(emptyLog(), 0, 0, [{ text: "甲" }]);
    const after = pushLog(before, 0, 1, [{ text: "乙" }]);
    expect(before.entries).toHaveLength(1);
    expect(after.entries).toHaveLength(2);
  });

  it("丢掉空白文本（引擎某些分支给空 notice，不能让它占掉可见位）", () => {
    const buffer = pushLog(emptyLog(), 0, 0, [{ text: "  " }, { text: "" }, { text: " 丙 " }]);
    expect(buffer.entries).toHaveLength(1);
    expect(buffer.entries[0]?.text).toBe("丙");
  });

  it("全空时原样返回同一个对象（不制造无意义的新引用）", () => {
    const before = emptyLog();
    expect(pushLog(before, 0, 0, [{ text: "" }])).toBe(before);
  });

  it("按容量截断，保留最新", () => {
    let buffer = emptyLog();
    for (let i = 0; i < LOG_CAPACITY + 12; i += 1) {
      buffer = pushLog(buffer, 0, 0, [{ text: `第${i}条` }]);
    }
    expect(buffer.entries).toHaveLength(LOG_CAPACITY);
    expect(buffer.entries[buffer.entries.length - 1]?.text).toBe(`第${LOG_CAPACITY + 11}条`);
  });
});

describe("recentLogVm", () => {
  it("默认取最近 6 条且最新在前", () => {
    let buffer = emptyLog();
    for (let i = 1; i <= 9; i += 1) buffer = pushLog(buffer, 0, 0, [{ text: `第${i}条` }]);
    const vm = recentLogVm(buffer);
    expect(vm).toHaveLength(6);
    expect(vm[0]?.text).toBe("第9条");
    expect(vm[5]?.text).toBe("第4条");
  });

  it("时间戳用汉字岁数＋季名", () => {
    const buffer = pushLog(emptyLog(), 12, 3, [{ text: "雪深" }]);
    expect(recentLogVm(buffer)[0]?.stamp).toBe("十二岁冬");
  });

  it("空缓冲给空数组", () => {
    expect(recentLogVm(emptyLog())).toEqual([]);
  });
});
