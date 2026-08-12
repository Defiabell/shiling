/**
 * 美术资源接线的磁盘对账。
 *
 * 为什么必须有这一层：`<img src>` 指向不存在的文件时**浏览器不报错**，玩家看到的只是
 * 一块空图位，控制台里除了一条 404 什么都没有 —— 这是最容易在交付里活下来的缺陷。
 * 所以把「路径规则 × 内容库 id × 磁盘实况」三方在测试里对齐：B2 加一个敌人却没图、
 * B4 改一次命名、B5 拼错一个子目录，都会在这里变红，而不是等 owner 试玩时看见空框。
 *
 * 断言的是**客户端自己导出的那几个拼路径函数**（不是重写一遍规则），所以它同时锁住了
 * `art/assets.ts` 的实现。
 */

import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TALE_CONTENT } from "@shiling/tale-content";
import type { EndingType } from "@shiling/tale-sim";
import {
  ART_DIR,
  PORTRAIT_LABELS,
  endingArt,
  enemyArt,
  eventArt,
  portraitArt,
  portraitStage,
  seedArt,
  TITLE_HERO,
  type PortraitStage,
} from "../src/art/assets.js";

const PUBLIC_ART = new URL("../public/art/", import.meta.url);
const ENDINGS: readonly EndingType[] = ["starve", "slain", "oldage", "ascend"];
const STAGES: readonly PortraitStage[] = ["cub", "adult", "neargod"];

/** 把界面用的 URL（`/art/x/y.webp`）映射回磁盘路径。 */
function onDisk(url: string): URL {
  expect(url.startsWith(ART_DIR), `资源 URL 必须落在 ${ART_DIR} 下：${url}`).toBe(true);
  return new URL(url.slice(ART_DIR.length), PUBLIC_ART);
}

function exists(url: string): boolean {
  return existsSync(onDisk(url));
}

describe("美术资源接线", () => {
  /**
   * [2026-08-13] 44 → 51 个事件，其中 **7 条还没有图**（这一批新加的两个成道出口
   * ＋五条开局变量专属线；美术管线要单独跑一轮）。
   *
   * 白名单逐条列名而不是把断言放宽成「有图的才检查」：放宽等于给「以后某次改名把一批图
   * 变成孤儿」留了藏身处。名单只许收敛 —— 补图之后把 id 从这里删掉，这条测试会立刻要求
   * 磁盘上真有那张图。
   */
  const EVENTS_AWAITING_ART = new Set([
    "qiu-way-yaowang",
    "qiu-way-hualing",
    "qiu-dry-springhead",
    "qiu-lone-path",
    "qiu-lone-winter",
    "qiu-twin-call",
    "qiu-twin-fall",
  ]);

  it("有图的事件其文件都真在磁盘上（7 条待补图的在白名单里）", () => {
    const events = TALE_CONTENT.events;
    expect(events.length).toBe(51);
    const withArt = events.filter((event) => !EVENTS_AWAITING_ART.has(event.id));
    expect(withArt).toHaveLength(44);
    const missing = withArt.filter(
      (event) => event.illustration === undefined || !exists(eventArt(event.illustration)),
    );
    expect(missing.map((event) => event.id), "事件插图缺文件").toEqual([]);
    // 白名单里的必须**确实没有** illustration（有了就该把它从名单里删掉）
    for (const event of events) {
      if (!EVENTS_AWAITING_ART.has(event.id)) continue;
      expect(event.illustration, `${event.id} 已有图，该从待补图名单里删掉`).toBeUndefined();
    }
  });

  it("events/ 里没有孤儿文件（改名会让这条红）", () => {
    const onDiskNames = readdirSync(new URL("events/", PUBLIC_ART)).filter((name) =>
      name.endsWith(".webp"),
    );
    const referenced = new Set(
      TALE_CONTENT.events.map((event) => (event.illustration ?? "").replace("events/", "")),
    );
    expect(onDiskNames.filter((name) => !referenced.has(name)), "有图没人引用").toEqual([]);
  });

  it("8 个敌人都有头像（战斗界面按 EnemyDef.id 取图）", () => {
    const enemies = TALE_CONTENT.enemies;
    expect(enemies.length).toBe(8);
    const missing = enemies.filter((enemy) => !exists(enemyArt(enemy.id)));
    expect(missing.map((enemy) => enemy.id), "敌人头像缺文件").toEqual([]);
  });

  it("四种结局各有一张结局图（死亡／登神过场按 EndingType 取图）", () => {
    const missing = ENDINGS.filter((ending) => !exists(endingArt(ending)));
    expect(missing, "结局图缺文件").toEqual([]);
  });

  it("三阶段立绘齐全，且每阶都有中文说法", () => {
    const missing = STAGES.filter((stage) => !exists(portraitArt(stage)));
    expect(missing, "立绘缺文件").toEqual([]);
    for (const stage of STAGES) expect(PORTRAIT_LABELS[stage].length).toBeGreaterThan(0);
  });

  it("题字主视觉在位", () => {
    expect(exists(TITLE_HERO)).toBe(true);
  });

  it("三枚神种都有卡首图（复用同一对象的成图，不是占位）", () => {
    for (const seed of TALE_CONTENT.seeds) {
      const url = seedArt(seed.id);
      expect(url, `神种 ${seed.id} 没配图`).not.toBeNull();
      if (url) expect(exists(url), `神种 ${seed.id} 的图不在磁盘上：${url}`).toBe(true);
    }
  });
});

describe("形态分阶", () => {
  /**
   * 神种恒占 `organIds[0]`，所以出生即 1 件。
   *
   * [2026-08-13] 门槛从「跟着 `tuning.ascendMinOrgans` 走」改成**表现层常量**：
   * 四道改动把器官件数从所有成道门槛里拿掉了（登神看灵德与神兽、归山看寿与德），
   * 于是「近神立绘 ⇔ 够格登神」那条对应已经不存在，继续吃一个与形貌无关的门槛
   * 只会在下一次调参时静默错位。
   */
  it("器官件数 → 幼兽／成兽／近神", () => {
    expect(portraitStage(1)).toBe("cub");
    expect(portraitStage(2)).toBe("cub");
    expect(portraitStage(3)).toBe("adult");
    expect(portraitStage(4)).toBe("adult");
    expect(portraitStage(5)).toBe("neargod");
    expect(portraitStage(12)).toBe("neargod");
  });

  it("异常件数不抛错（0 或负数退到幼兽）", () => {
    expect(portraitStage(0)).toBe("cub");
    expect(portraitStage(-1)).toBe("cub");
  });
});
