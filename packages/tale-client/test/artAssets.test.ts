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
  it("44 个事件都有插图，且文件真在磁盘上", () => {
    const events = TALE_CONTENT.events;
    expect(events.length).toBe(44);
    const missing = events.filter(
      (event) => event.illustration === undefined || !exists(eventArt(event.illustration)),
    );
    expect(missing.map((event) => event.id), "事件插图缺文件").toEqual([]);
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
  const ASCEND_MIN = TALE_CONTENT.tuning.ascendMinOrgans;

  /**
   * 「近神」这一阶的门槛吃引擎的 `ascendMinOrgans`（本库 5），神种恒占 organIds[0]，
   * 所以出生即 1 件。
   */
  it("器官件数 → 幼兽／成兽／近神", () => {
    expect(portraitStage(1, ASCEND_MIN)).toBe("cub");
    expect(portraitStage(2, ASCEND_MIN)).toBe("cub");
    expect(portraitStage(3, ASCEND_MIN)).toBe("adult");
    expect(portraitStage(4, ASCEND_MIN)).toBe("adult");
    expect(portraitStage(5, ASCEND_MIN)).toBe("neargod");
    expect(portraitStage(12, ASCEND_MIN)).toBe("neargod");
  });

  /**
   * 门槛跟着 tuning 走，不是写死的 5 —— 这条锁住的是「近神立绘 ⇔ 够格登神」这条对应
   * 不会在下一次调 `ascendMinOrgans` 时静默错位。
   */
  it("近神门槛跟随 tuning.ascendMinOrgans", () => {
    expect(portraitStage(4, 4)).toBe("neargod");
    expect(portraitStage(6, 7)).toBe("adult");
  });

  it("异常件数不抛错（0 或负数退到幼兽）", () => {
    expect(portraitStage(0, ASCEND_MIN)).toBe("cub");
    expect(portraitStage(-1, ASCEND_MIN)).toBe("cub");
  });
});
