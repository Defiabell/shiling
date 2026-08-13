#!/usr/bin/env python3
"""《食灵·列传》「AI 史官」批次实机验收（2026-08-13）。

与既有脚本的分工：`fullLife.py` 验一世能打完、`variance.py` 验「每局不同」。本脚本
只回答这一批的四问，且每一问都从**屏幕上真实显示的字**与 `window.__tale.snapshot().ai`
取答案，不读引擎内部、不 mock 网络：

  ① 卷轴上那一篇到底是谁写的？（`ai.source` ＝ ai ／ template）
  ② 玩家等了多久？（量从按下「瞑目」到卷轴出现的墙钟时间，与 AI 关掉时对照 ——
     两者若一样，就证明作传是躲在死亡演出后面完成的，玩家不可能感知到）
  ③ 断网／关掉 AI 时，游戏是不是照常走完、且没有任何报错弹窗？
  ④ 连玩数世，每一世的列传全文（贴进报告）。

运行前先自己起 dev server（**别 pkill 已有的**；5174 常被别的 session 占着）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5199 --strictPort

用法：
    python packages/tale-client/e2e/historian.py [输出目录] [种子] [端口]
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/historian").resolve()
SEED = int(sys.argv[2] if len(sys.argv) > 2 else 20260813)
PORT = int(sys.argv[3] if len(sys.argv) > 3 else 5199)
BASE = f"http://localhost:{PORT}/"
VIEWPORT = {"width": 1440, "height": 900}
MAX_STEPS = 900
# 一世在浏览器里要打十分钟上下（真演出、真等待），而这一批要证的两件事各只需一世：
# AI 路径真的在实机跑通、关掉 AI 后照常走完。三篇列传全文由 `historian-lab.ts` 出（同一条
# `writeChronicle` 路径，只是把「谁按按钮」换成脚本），不必在浏览器里重复三遍。
AI_LIVES = int(sys.argv[4]) if len(sys.argv) > 4 else 1


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def click_first(page: Page, *selectors: str) -> bool:
    """按顺序试着点第一个点得动的选择器。

    **必须按选择器点、不能拿 ElementHandle 点**：`renderPlay` 每回合整棵重建 DOM，
    上一拍取到的句柄这一拍就 detached（实测报错原话：Element is not attached to the DOM）。
    """
    for selector in selectors:
        if page.query_selector(selector) is None:
            continue
        try:
            page.click(selector, timeout=5000)
            return True
        except Exception:
            continue
    return False


def decide_action(state: dict, page: Page, rest_streak: int) -> str:
    if page.query_selector('[data-action="dormant"]:not([disabled])'):
        return "dormant"
    flags = state["flags"]
    hurt = "wound" in flags or "sick" in flags
    if state["hunger"] <= 50:
        return "hunt"
    if hurt and rest_streak < 2:
        return "rest"
    if state["hunger"] >= 70:
        return "explore"
    return "hunt" if state["year"] % 2 == 0 else "explore"


def decide_combat(page: Page) -> str:
    hot = page.query_selector(".cact.is-hot:not([disabled])")
    if hot is not None:
        return hot.get_attribute("data-combat") or "bite:throat"
    return "bite:throat"


def read_scroll(page: Page) -> dict:
    """把卷轴上显示的字原样抄下来 —— 报告里贴的就是这一份，不是引擎里的字符串。"""
    closing = page.query_selector(".scroll__closing")
    return {
        "title": page.inner_text(".scroll__title").strip(),
        "meta": page.inner_text(".scroll__meta").strip(),
        "opening": page.inner_text(".scroll__opening").strip(),
        "middle": [line.strip() for line in page.inner_text(".scroll__middle").split("\n") if line.strip()],
        "closing": closing.inner_text().strip() if closing else "",
        "praise": page.inner_text(".praise__text").strip(),
        "gap": page.inner_text("[data-gap]").strip(),
        "gain": page.inner_text("[data-gain]").strip(),
    }


def play_one_life(page: Page, shot_prefix: str) -> dict:
    """从降世打到卷轴。返回这一世的账：结局、列传全文、按下「瞑目」到卷轴的墙钟时间。"""
    page.wait_for_selector("[data-seed]")
    page.click("[data-seed]")
    page.wait_for_selector(".statusbar")

    rest_streak = 0
    stalls = 0
    death_click_at: float | None = None
    for step in range(MAX_STEPS):
        # 一步只取一次快照：`snapshot()` 要序列化整个 TaleState，而这个循环要跑几百步
        state = snap(page)
        if step % 40 == 0:
            print(
                f"  [{shot_prefix} step {step}] screen={state['screen']} center={state['center']} "
                f"busy={state['busy']} year={(state['state'] or {}).get('year')}",
                flush=True,
            )
        # 蜕变开奖浮层**必须排在 busy 之前**：它是模态的，且客户端在它开着时 `busy` 恒为真。
        # 反过来写（先看 busy）会让循环在浮层前空转到收摊 —— 实测卡在九岁那一次就是这样。
        if page.query_selector(".molt__card"):
            # 开奖转盘 2.1s 之后才落下确认键 —— 等选择器而不是拍一个固定时长（拍短了会超时）。
            # 整段包 try：这张卡在按下的同一刻会被自己的收场动画拆掉，playwright 偶尔正好
            # 撞上「元素刚 detached」而无限重试到超时；下一圈重新看一眼即可。
            try:
                page.wait_for_selector(".molt__confirm", timeout=20000)
                page.click(".molt__confirm", timeout=5000)
            except Exception:
                page.wait_for_timeout(200)
            page.wait_for_timeout(160)
            continue

        # 演出播放期间客户端把所有按钮压住（`busy`）。此时「一颗能点的都没有」是**正常的**，
        # 等一拍再看即可 —— 第一版在这里直接 break，于是每一世都停在第一段动画上。
        if state["busy"]:
            stalls += 1
            if stalls > 200:
                break
            page.wait_for_timeout(120)
            continue
        stalls = 0

        if state["screen"] != "play":
            break
        life = state["state"]

        # 死了就只剩一条路：等「瞑目」出现再按。**判据是快照里的 alive，不是按钮在不在** ——
        # 第一版反过来写（先找按钮再看死活），于是死亡那一帧若按钮还没渲染出来，
        # 循环就滑到「点行动按钮」那一支，一颗也点不动，空转到收摊。
        if not life["alive"]:
            page.wait_for_selector("[data-continue]:not([disabled])", timeout=20000)
            # 这里是**唯一**要计时的一刻：玩家读完最后一句旁白，按下「瞑目」。
            # 之后是墨渍 1.2s ＋ 结局演出 4.4s，AI 若准点，卷轴就该在 5.6s 上下出现。
            page.screenshot(path=str(OUT / f"{shot_prefix}-1-last-words.png"))
            death_click_at = time.monotonic()
            page.click("[data-continue]")
            page.wait_for_selector("[data-reincarnate]", timeout=30000)
            break

        if page.query_selector("[data-continue]:not([disabled])"):
            page.click("[data-continue]")
            page.wait_for_timeout(120)
            continue

        if state["center"] == "combat":
            click_first(page, f'[data-combat="{decide_combat(page)}"]', "[data-combat]:not([disabled])")
            page.wait_for_timeout(120)
            continue

        if state["center"] == "stalk":
            # 先按屏幕上发金光的那颗（`recommendStalkAct` 的输出），没有就点第一颗能点的
            if not click_first(page, ".sact.is-hot:not([disabled])", "[data-stalk]:not([disabled])"):
                page.wait_for_timeout(200)
            page.wait_for_timeout(120)
            continue

        if state["center"] == "event":
            # 末条基本是不冒险那条（内容库的抉择顺序是「诱人／带门槛／稳妥」），同 fullLife.py
            choices = page.locator(".choice:not([disabled])")
            if choices.count() == 0:
                raise RuntimeError("事件卡上没有可点的抉择")
            try:
                choices.last.click(timeout=5000)
            except Exception:
                page.wait_for_timeout(200)
            page.wait_for_timeout(140)
            continue

        action = decide_action(life, page, rest_streak)
        rest_streak = rest_streak + 1 if action == "rest" else 0
        # 该行动此刻不可用（饱食门槛之类）就退到还能点的那个；一颗都点不动就等一拍
        if not click_first(
            page, f'[data-action="{action}"]:not([disabled])', "[data-action]:not([disabled])"
        ):
            page.wait_for_timeout(200)
        page.wait_for_timeout(120)

    if page.query_selector("[data-reincarnate]") is None:
        # 走到这里说明循环是**异常**收摊的（不是死亡收束）——把现场留下来再抛
        page.screenshot(path=str(OUT / f"{shot_prefix}-9-stuck.png"))
        raise RuntimeError(f"{shot_prefix} 没走到卷轴：{json.dumps(snap(page)['state'] and {k: snap(page)['state'][k] for k in ('year', 'alive', 'ending')}, ensure_ascii=False)}")
    scroll_at = time.monotonic()
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / f"{shot_prefix}-2-chronicle.png"), full_page=True)

    final = snap(page)
    life = final["state"] or {}
    return {
        "ending": life.get("ending"),
        "way": life.get("wayAchieved"),
        "years": life.get("year"),
        "organCount": len(life.get("organIds") or []),
        "livesTaken": life.get("livesTaken"),
        "ai": final["ai"],
        "scroll": read_scroll(page),
        # 从按「瞑目」到卷轴可见的墙钟时间 —— 演出本身固定 5.6s，超出部分就是玩家的干等
        "deathToScrollMs": None if death_click_at is None else round((scroll_at - death_click_at) * 1000),
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict = {"base": BASE, "seed": SEED, "lives": [], "errors": [], "console": []}

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        # 断网回落的判据之一是「没有任何报错弹窗」，所以把 console error 与未捕获异常都收下来
        page.on("console", lambda msg: report["console"].append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: report["errors"].append(str(err)))

        # ── 一、AI 开着连玩三世 ──
        page.goto(f"{BASE}?seed={SEED}&reset=1", wait_until="load")
        page.wait_for_selector("[data-start]")
        page.click("[data-start]")
        for index in range(AI_LIVES):
            life = play_one_life(page, f"ai{index + 1}")
            life["mode"] = "ai-on"
            report["lives"].append(life)
            print(
                f"[ai-on 第{index + 1}世] {life['ending']}/{life['way']} "
                f"source={life['ai']['source']} {life['ai']['totalMs']}ms "
                f"cost={life['ai']['costUsd']} 死→卷轴 {life['deathToScrollMs']}ms",
                flush=True,
            )
            page.click("[data-reincarnate]")

        # ── 二、关掉 AI（等价于断网／没配 key）再玩一世：必须静默回落且照常走完 ──
        page.goto(f"{BASE}?seed={SEED + 7}&ai=0", wait_until="load")
        page.wait_for_selector("[data-start]")
        page.click("[data-start]")
        life = play_one_life(page, "offline")
        life["mode"] = "ai-off"
        report["lives"].append(life)
        print(
            f"[ai-off] {life['ending']}/{life['way']} source={life['ai']['source']} "
            f"死→卷轴 {life['deathToScrollMs']}ms",
            flush=True,
        )
        browser.close()

    (OUT / "historian-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n未捕获异常 {len(report['errors'])} 条；console error {len(report['console'])} 条")
    print(f"报告：{OUT / 'historian-report.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
