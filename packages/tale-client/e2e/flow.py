#!/usr/bin/env python3
"""《食灵·列传》tale-client 全链路 E2E：题字→选神种→行动→事件抉择→战斗→蛰伏→死亡→列传→转世。

为什么是 Python 而不是 @playwright/test：本机已装 playwright 1.59（conda）＋系统 Chrome，
`channel="chrome"` 直接驱动，不必往 workspace 里塞一个几百兆的浏览器下载。B5 接真内容后
这个脚本原样可用（只是回合数会变）。

运行前先自己起 dev server：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/flow.py [输出目录]

驱动方式是**如实玩**：只读 `window.__tale.snapshot()` 判断该点哪个按钮，绝不注入状态 ——
截图里出现的每个数字都是引擎真算出来的。
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:5174/"
SEED = 20260811
VIEWPORT = {"width": 1440, "height": 900}
MAX_TURNS = 220

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/b3").resolve()


"""卡片入场动画（水墨浮现）620ms；截图前必须等它走完，否则拍到的是半透明糊影，
会被误判成「对比度不够」。"""
SETTLE_MS = 780


class Shots:
    """按序号存图，并记录已拍过的里程碑（每个里程碑只拍一次）。"""

    def __init__(self, page: Page, out: Path) -> None:
        self.page = page
        self.out = out
        self.n = 0
        self.taken: set[str] = set()
        out.mkdir(parents=True, exist_ok=True)

    def shot(self, name: str, settle: bool = True) -> None:
        if settle:
            self.page.wait_for_timeout(SETTLE_MS)
        self.n += 1
        path = self.out / f"{self.n:02d}-{name}.png"
        self.page.screenshot(path=str(path))
        print(f"  [shot] {path.name}")

    def once(self, name: str, settle: bool = True) -> bool:
        if name in self.taken:
            return False
        self.taken.add(name)
        self.shot(name, settle=settle)
        return True

    @property
    def missing(self) -> list[str]:
        want = [
            "title", "seed-select", "birth", "event-gated", "outcome",
            "combat", "molt-reveal", "ink-blot", "death-cinematic",
            "chronicle", "reincarnate",
        ]
        return [name for name in want if name not in self.taken]

    def missing_before_death(self) -> list[str]:
        """死亡链之前必须先拍齐的几张（拍齐了才允许断粮走死）。"""
        want = ["event-gated", "combat", "molt-reveal"]
        return [name for name in want if name not in self.taken]


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def visible(page: Page, selector: str) -> bool:
    node = page.query_selector(selector)
    return node is not None and node.is_visible()


def click(page: Page, selector: str) -> None:
    page.click(selector)
    page.wait_for_timeout(240)


def run(page: Page, shots: Shots) -> dict:
    # ── 题字画面 ────────────────────────────────────────────────
    page.goto(f"{BASE}?seed={SEED}&reset=1", wait_until="load")
    page.wait_for_selector("[data-start]")
    page.wait_for_timeout(1500)  # 让 Ken Burns 推进一点，截图才看得出镜头在动
    shots.once("title")

    # ── 神种选择 ────────────────────────────────────────────────
    click(page, "[data-start]")
    page.wait_for_selector("[data-seed]")
    page.wait_for_timeout(500)
    shots.once("seed-select")

    # ── 降世 ────────────────────────────────────────────────────
    seed_id = page.get_attribute("[data-seed]", "data-seed")
    click(page, "[data-seed]")
    page.wait_for_selector(".statusbar")
    page.wait_for_timeout(700)
    shots.once("birth")
    print(f"  神种 = {seed_id}")

    # ── 主循环：如实玩到死 ──────────────────────────────────────
    starve_mode = False
    for turn in range(MAX_TURNS):
        # 蜕变开奖浮层
        if visible(page, ".molt__card"):
            page.wait_for_timeout(2400)  # 等滚动定格
            shots.once("molt-reveal")
            click(page, ".molt__confirm")
            page.wait_for_timeout(400)
            continue

        state = snap(page)
        if state["screen"] != "play":
            break

        # 「继续／迎敌／瞑目」
        if visible(page, "[data-continue]"):
            label = page.inner_text("[data-continue]").strip()
            if not state["state"]["alive"]:
                # 死亡链：墨渍 → 演出
                shots.once("outcome")
                page.wait_for_selector("[data-continue]:not([disabled])", timeout=10000)
                page.click("[data-continue]")
                # 墨渍是「正在晕开」的过程，settle 会等到它铺满 —— 这一张要的就是中途
                page.wait_for_timeout(820)
                shots.once("ink-blot", settle=False)
                page.wait_for_selector(".cine--death, .cine--ascend", timeout=6000)
                # 三行文案按时长前 60% 依次淡入，末行约 2.6s 才到位
                page.wait_for_timeout(2900)
                shots.once("death-cinematic", settle=False)
                page.wait_for_selector("[data-reincarnate]", timeout=12000)
                page.wait_for_timeout(900)
                break
            shots.once("outcome")
            print(f"  [{turn}] 继续（{label}）")
            click(page, "[data-continue]")
            continue

        # 战斗
        if state["center"] == "combat":
            shots.once("combat")
            organ = page.query_selector('[data-combat="organ"]:not([disabled])')
            target = '[data-combat="organ"]' if organ else '[data-combat="fight"]'
            click(page, target)
            continue

        # 事件抉择
        if state["center"] == "event":
            event_id = state["pendingEventId"]
            locked = page.query_selector_all(".choice.is-locked")
            if locked:
                shots.once("event-gated")  # 门槛置灰＋原因的展示位
            # 每种事件另存一张：不同事件的门槛组合值得逐个看排版
            shots.once(f"event-{event_id}")
            # 丛中窥影：选「破丛而入」必定开战 —— 拿战斗那一屏
            if event_id == "qiu-hunt-thicket" and "combat" not in shots.taken:
                click(page, '[data-choice="0"]')
            else:
                click(page, ".choice:not([disabled])")
            print(f"  [{turn}] 事件 {event_id}")
            continue

        # 行动：先攒够里程碑，再断粮走饿殍
        if visible(page, '[data-action="dormant"]:not([disabled])'):
            print(f"  [{turn}] 蛰伏")
            click(page, '[data-action="dormant"]')
            continue

        if not starve_mode and not shots.missing_before_death():
            starve_mode = True
            print(f"  [{turn}] 里程碑齐，转断粮（只探索）以走完死亡链")

        action = "explore" if starve_mode else "hunt"
        if page.query_selector(f'[data-action="{action}"]:not([disabled])') is None:
            action = "rest"
        click(page, f'[data-action="{action}"]')

    # ── 列传卷轴 ────────────────────────────────────────────────
    page.wait_for_selector("[data-reincarnate]", timeout=15000)
    page.wait_for_timeout(700)
    shots.once("chronicle")
    gain = page.inner_text("[data-gain]").strip()
    title = page.inner_text(".scroll__title").strip()
    praise = page.inner_text(".praise__text").strip()

    # ── 转世回神种选择（带前传目录） ────────────────────────────
    click(page, "[data-reincarnate]")
    page.wait_for_selector("[data-seed]", timeout=8000)
    page.wait_for_timeout(500)
    page.click(".pastlife__head")  # 展开前世列传，证明目录可读
    page.wait_for_timeout(400)
    shots.once("reincarnate")
    points = page.inner_text("[data-points]").strip()

    final = snap(page)
    return {
        "chronicleTitle": title,
        "praise": praise,
        "bloodlineGain": gain,
        "pointsAfter": points,
        "lives": len(final["bloodline"]["chronicle"]),
        "ending": final["bloodline"]["chronicle"][-1]["ending"],
        "years": final["bloodline"]["chronicle"][-1]["years"],
        "organCount": final["bloodline"]["chronicle"][-1]["organCount"],
    }


def reduced_motion_pass(browser, out: Path) -> None:
    """减少动画偏好下再走一小段：确认信息不丢、只是不动。"""
    context = browser.new_context(viewport=VIEWPORT, reduced_motion="reduce")
    page = context.new_page()
    shots = Shots(page, out)
    shots.n = 90
    page.goto(f"{BASE}?seed={SEED + 1}&reset=1", wait_until="load")
    page.wait_for_selector("[data-start]")
    page.wait_for_timeout(600)
    shots.shot("reduced-title")
    click(page, "[data-start]")
    page.wait_for_selector("[data-seed]")
    click(page, "[data-seed]")
    page.wait_for_selector(".statusbar")
    for _ in range(6):
        if visible(page, "[data-continue]"):
            click(page, "[data-continue]")
            continue
        if page.query_selector('[data-action="hunt"]:not([disabled])'):
            click(page, '[data-action="hunt"]')
        elif page.query_selector(".choice:not([disabled])"):
            click(page, ".choice:not([disabled])")
        else:
            break
    page.wait_for_timeout(400)
    shots.shot("reduced-play")
    reduced = page.evaluate("() => matchMedia('(prefers-reduced-motion: reduce)').matches")
    canvases = page.evaluate("() => document.querySelectorAll('canvas.fx-particles').length")
    print(f"  reduced-motion={reduced} 粒子画布数={canvases}")
    context.close()


def main() -> int:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1)
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
        page.on(
            "console",
            lambda msg: errors.append(f"console.{msg.type}: {msg.text}")
            if msg.type == "error"
            else None,
        )

        print("== 全链路 ==")
        result = run(page, Shots(page, OUT))
        print(json.dumps(result, ensure_ascii=False, indent=2))

        print("== 减少动画 ==")
        reduced_motion_pass(browser, OUT)

        if errors:
            print("!! 控制台错误：")
            for line in errors:
                print("  " + line)
        else:
            print("控制台零错误。")

        context.close()
        browser.close()
        return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
