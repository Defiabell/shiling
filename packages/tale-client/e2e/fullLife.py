#!/usr/bin/env python3
"""《食灵·列传》完整一世 E2E（B5）：真内容＋真插图，自动打完一整世直到死亡或登神。

与 `flow.py` 的分工：`flow.py` 赶里程碑（为了拍齐每种屏，中途会故意断粮走死），
本脚本**像玩家那样把一世打完** —— 饿了猎、伤了休、精气满了蛰伏、血少了逃，
不注入任何状态，只读 `window.__tale.snapshot()` 判断该点哪个按钮。

它同时是「零 404」的验收手段：逐条记录每个网络响应，任何 `/art/` 资源不是 200 就失败
（`<img>` 加载失败不抛错，玩家看到的只是一块空图位 —— 只有逐个查响应才拦得住）。

运行前先自己起 dev server：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/fullLife.py [输出目录] [种子]
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:5174/"
VIEWPORT = {"width": 1440, "height": 900}
SETTLE_MS = 760
MAX_STEPS = 900

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/b5").resolve()
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 20260812


class Shots:
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
        self.page.screenshot(path=str(self.out / f"{self.n:02d}-{name}.png"))

    def once(self, name: str, settle: bool = True) -> bool:
        if name in self.taken:
            return False
        self.taken.add(name)
        self.shot(name, settle=settle)
        return True


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def art_state(page: Page) -> dict:
    """当前卡上那张图到底解码出来了没有（404 的图 naturalWidth 恒为 0）。"""
    return page.evaluate(
        """() => {
          const nodes = [...document.querySelectorAll('img')];
          return nodes.map((n) => ({ src: n.getAttribute('src').slice(0, 80),
                                     ok: n.complete && n.naturalWidth > 0 }));
        }"""
    )


def pick_choice(page: Page, event_index: int) -> None:
    """抉择策略：谨慎玩家。

    本内容库每个事件的抉择顺序是「诱人／带门槛／稳妥」，末条基本是不冒险那条 ——
    优先点末条即「读得懂危险的人会怎么选」，一世才走得到 60 回合以上。
    每第 3 个事件改点第一条，好让贪心分支（含会死人的那些）也进这次实机验证。
    """
    enabled = page.query_selector_all(".choice:not([disabled])")
    if not enabled:
        raise RuntimeError("事件卡上没有可点的抉择（引擎/内容 bug）")
    (enabled[0] if event_index % 3 == 2 else enabled[-1]).click()


def decide_action(state: dict, page: Page, rest_streak: int) -> str:
    """明理但不作弊的玩家：能蛰伏就蛰伏、饿了就猎、伤病歇两季、饱了就探。

    连续休憩上限是两季：休憩只治 `sick` 不治 `wound`，带伤一直休会把饱食顶在门槛之上，
    于是「饿了就猎」永不触发 —— 玩家陷入无限休憩，不猎不探、零精气、零蜕变
    （这条陷阱同时在 B2 的冒烟策略里，B5 一并修了）。
    """
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


def decide_combat(state: dict, page: Page) -> str:
    """[M1-P2] 战斗指令 id 从 fight/flee/feint/organ 换成了 bite:*／stance:*／skill:*／flee。

    这里不再自己判断，直接**按屏幕上发金光的那颗打** —— 那是 `recommendCombatAct` 的输出，
    也是这一批想验的东西（跟着界面打就该是当前最好的打法）。金光缺席时退回咬喉。
    """
    hot = page.query_selector(".cact.is-hot:not([disabled])")
    if hot is not None:
        return hot.get_attribute("data-combat") or "bite:throat"
    return "bite:throat"


def play(page: Page, shots: Shots) -> dict:
    page.goto(f"{BASE}?seed={SEED}&reset=1", wait_until="load")
    page.wait_for_selector("[data-start]")
    page.wait_for_timeout(1600)  # 让题字的 Ken Burns 推一点，截图看得出镜头在动
    shots.once("title")

    page.click("[data-start]")
    page.wait_for_selector("[data-seed]")
    shots.once("seed-select")

    seed_id = page.get_attribute("[data-seed]", "data-seed")
    page.click("[data-seed]")
    page.wait_for_selector(".statusbar")
    shots.once("birth")

    events_seen: list[str] = []
    actions = Counter()
    combat_rounds = 0
    molts = 0
    turns = 0
    rest_streak = 0
    prose_chars = 0
    broken_art: list[str] = []
    portrait_stages: set[str] = set()

    for _ in range(MAX_STEPS):
        # 蜕变开奖浮层（模态，必须先收）
        if page.query_selector(".molt__card"):
            page.wait_for_timeout(2500)
            molts += 1
            shots.once("molt-reveal")
            page.click(".molt__confirm")
            page.wait_for_timeout(320)
            continue

        state = snap(page)
        if state["screen"] != "play":
            break
        life = state["state"]

        for item in art_state(page):
            if not item["ok"]:
                broken_art.append(item["src"])
        node = page.query_selector("[data-portrait]")
        if node:
            portrait_stages.add(node.get_attribute("data-portrait") or "?")

        # 「继续／迎敌／瞑目」
        if page.query_selector("[data-continue]:not([disabled])"):
            if not life["alive"]:
                shots.once("last-words")
                page.click("[data-continue]")
                # 墨渍是「正在晕开」的过程，要的就是中途那一张
                page.wait_for_timeout(820)
                shots.once("ink-blot", settle=False)
                page.wait_for_selector(".cine--death, .cine--ascend", timeout=8000)
                page.wait_for_timeout(2900)  # 三行文案按时长前 60% 依次淡入
                shots.once("death-cinematic", settle=False)
                page.wait_for_selector("[data-reincarnate]", timeout=15000)
                break
            page.click("[data-continue]")
            page.wait_for_timeout(220)
            continue

        if state["center"] == "combat":
            combat_rounds += 1
            shots.once("combat")
            page.click(f'[data-combat="{decide_combat(life, page)}"]')
            page.wait_for_timeout(220)
            continue

        if state["center"] == "event":
            event_id = state["pendingEventId"] or "?"
            events_seen.append(event_id)
            prose_chars += page.evaluate(
                "() => [...document.querySelectorAll('.card__prose p')].reduce((n, p) => n + p.textContent.length, 0)"
            )
            if page.query_selector(".choice.is-locked"):
                shots.once("event-gated")
            shots.once(f"event-{event_id}")
            pick_choice(page, len(events_seen) - 1)
            page.wait_for_timeout(240)
            continue

        turns += 1
        action = decide_action(life, page, rest_streak)
        rest_streak = rest_streak + 1 if action == "rest" else 0
        actions[action] += 1
        target = page.query_selector(f'[data-action="{action}"]:not([disabled])')
        if target is None:  # 该行动此刻不可用（战斗中／饱食门槛），退到还能点的那个
            target = page.query_selector("[data-action]:not([disabled])")
            if target is None:
                break
        target.click()
        page.wait_for_timeout(200)
        prose_chars += page.evaluate(
            "() => [...document.querySelectorAll('.card__prose p')].reduce((n, p) => n + p.textContent.length, 0)"
        )
        shots.once("narration")

    # ── 列传卷轴 ──
    page.wait_for_selector("[data-reincarnate]", timeout=20000)
    shots.once("chronicle")
    scroll = {
        "title": page.inner_text(".scroll__title").strip(),
        "meta": page.inner_text(".scroll__meta").strip(),
        "opening": page.inner_text(".scroll__opening").strip(),
        "middle": [line.strip() for line in page.inner_text(".scroll__middle").split("\n") if line.strip()],
        "closing": page.inner_text(".scroll__closing").strip(),
        "praise": page.inner_text(".praise__text").strip(),
        "gain": page.inner_text("[data-gain]").strip(),
    }

    # ── 转世回神种选择（带前传目录） ──
    page.click("[data-reincarnate]")
    page.wait_for_selector("[data-seed]", timeout=10000)
    page.click(".pastlife__head")
    page.wait_for_timeout(400)
    shots.once("reincarnate")

    final = snap(page)
    entry = final["bloodline"]["chronicle"][-1]
    return {
        "seedId": seed_id,
        "ending": entry["ending"],
        "years": entry["years"],
        "organCount": entry["organCount"],
        "turns": turns,
        "actions": dict(actions),
        "eventsSeen": len(events_seen),
        "distinctEvents": len(set(events_seen)),
        "combatRounds": combat_rounds,
        "molts": molts,
        "portraitStages": sorted(portrait_stages),
        "proseCharsRead": prose_chars,
        "bloodlinePoints": final["bloodline"]["points"],
        "brokenArt": sorted(set(broken_art)),
        "scroll": scroll,
    }


def main() -> int:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=1)
        page = ctx.new_page()
        errors: list[str] = []
        responses: list[tuple[int, str]] = []
        page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
        page.on(
            "console",
            lambda msg: errors.append(f"console.{msg.type}: {msg.text}") if msg.type == "error" else None,
        )
        page.on("response", lambda r: responses.append((r.status, r.url)))
        page.on("requestfailed", lambda r: errors.append(f"requestfailed: {r.url}"))

        result = play(page, Shots(page, OUT))

        art = [(status, url) for status, url in responses if "/art/" in url]
        bad = [(status, url) for status, url in art if status != 200]
        result["artRequests"] = len(art)
        result["artDistinct"] = len({url for _, url in art})
        result["artNon200"] = [f"{status} {url}" for status, url in bad]
        result["httpNon200"] = [f"{status} {url}" for status, url in responses if status >= 400]
        result["consoleErrors"] = errors
        print(json.dumps(result, ensure_ascii=False, indent=2))

        ctx.close()
        browser.close()
        ok = not errors and not bad and not result["brokenArt"] and not result["httpNon200"]
        print("== 结论：" + ("全绿 ==" if ok else "有问题，见上 =="))
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
