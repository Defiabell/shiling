#!/usr/bin/env python3
"""《食灵·列传》「饥饿节奏重平衡」实机验收。

同 `places.py`／`stalk.py` 的办法与理由：断言打在**屏幕上真实显示的字**上，不是引擎内部值。
它回答交付线的三问：

  ① 现在还需要「经常点狩猎」吗？（实玩一世，逐次点击记账：多少次点在了「吃」上）
  ② 速猎与追猎的取舍是否看得懂、两者是否都有人会选？（抄两颗按钮上的原文逐项对照，
     并且这一世**两颗都真的按过**，各自的结果也抄下来）
  ③ 休憩现在是不是一个真的选项？（抄休憩按钮上的净额，并记录这一世真的靠它撑过的那几季）

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/hunger.py [输出目录] [种子]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:5174/"
VIEWPORT = {"width": 1440, "height": 900}
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/hunger").resolve()
SEED = int(sys.argv[2] if len(sys.argv) > 2 else 20260814)


def safe_eval(page: Page, script: str):
    """导航中读 DOM 会抛（整屏每一步都重建），撞上就当这一帧读不到。"""
    for _ in range(3):
        try:
            return page.evaluate(script)
        except Exception:
            page.wait_for_timeout(160)
    return None


def snap(page: Page) -> dict:
    return safe_eval(page, "() => JSON.parse(JSON.stringify(window.__tale.snapshot()))") or {}


def life_state(page: Page) -> dict | None:
    return snap(page).get("state")


def panel(page: Page) -> dict:
    """行动面板上玩家真的看得见的字（四颗行动 ＋ 状态栏的食余小牌）。"""
    return safe_eval(
        page,
        """() => ({
          actions: [...document.querySelectorAll('[data-action]')].map((n) => ({
            id: n.getAttribute('data-action'),
            label: n.querySelector('b span')?.textContent ?? '',
            key: n.querySelector('b kbd')?.textContent ?? '',
            hint: n.querySelector('.act__text em')?.textContent ?? '',
            disabled: n.disabled,
          })),
          surplus: document.querySelector('.hunger__surplus')?.textContent ?? null,
          hunger: document.querySelector('.hunger__num')?.textContent ?? null,
          log: [...document.querySelectorAll('.rail__list li')].map((n) => n.textContent),
        })""",
    ) or {"actions": [], "surplus": None, "hunger": None, "log": []}


def has(page: Page, selector: str) -> bool:
    try:
        return page.query_selector(selector) is not None
    except Exception:
        return False


def click(page: Page, selector: str, wait: int = 320) -> bool:
    """点一颗按钮（容忍整屏重建导致的句柄失效，同 places.py）。"""
    for _ in range(3):
        try:
            button = page.query_selector(selector)
        except Exception:
            page.wait_for_timeout(160)
            continue
        if button is None:
            return False
        try:
            button.click(timeout=4000)
        except Exception:
            page.wait_for_timeout(160)
            continue
        page.wait_for_timeout(wait)
        return True
    return False


def start_life(page: Page, seed: int) -> None:
    """起一世。`scenario=0` 关掉 AI 一世一剧本：这一问量的是手写内容的节奏。"""
    page.goto(f"{BASE}?seed={seed}&reset=1&scenario=0", wait_until="networkidle")
    page.wait_for_timeout(300)
    page.click("[data-start]")
    page.wait_for_timeout(320)
    page.click("[data-seed]:not([disabled])")
    page.wait_for_timeout(600)


class Tally:
    """点击记账 —— 这一批的核心指标就是它。"""

    def __init__(self) -> None:
        self.clicks: dict[str, int] = {}
        self.hunt_stalk = 0
        self.hunt_quick = 0
        self.rest = 0
        self.explore = 0
        self.dormant = 0
        self.stalk_screens = 0
        self.stalk_acts = 0
        self.surplus_seasons_seen = 0
        self.rest_when_low = 0

    def hit(self, kind: str) -> None:
        self.clicks[kind] = self.clicks.get(kind, 0) + 1

    @property
    def total(self) -> int:
        return sum(self.clicks.values())

    @property
    def feeding_clicks(self) -> int:
        """点在「吃」上的那些：两颗猎按钮 ＋ 追猎屏里的每一息 ＋ 休憩。"""
        return (
            self.clicks.get("hunt", 0)
            + self.clicks.get("hunt-quick", 0)
            + self.clicks.get("stalk", 0)
            + self.clicks.get("rest", 0)
        )


def runway(state: dict, tuning: dict) -> float:
    """还够几季 —— 与屏幕上「还够 N 季」＋「食余 N 季」两行读到的是同一个数。"""
    per = max(1, tuning.get("hungerPerSeason", 12))
    return (state["hunger"] + state.get("surplusSeasons", 0) * tuning.get("huntSurplusGain", 6)) / per


def play(page: Page, tally: Tally, notes: dict, max_steps: int = 400) -> None:
    """
    一个**明理玩家**玩一世：能蛰伏就蛰伏；快没吃的了就去猎（真饿了认真追一场，
    只是垫一顿就走速猎）；带伤而肚子还行就歇一季；否则去探索。

    与平衡台的 `decideAction`／`decideHuntMode` 同一套判据 —— 那边量 500 世的分布，
    这边量一世的**手感与屏幕文字**。
    """
    tuning = safe_eval(page, "() => window.__tale.tuning?.() ?? null") or {}
    if not tuning:
        # dev 出口没有 tuning 时退回内容库的当前值（只用于 runway 估算，不影响断言）
        tuning = {"hungerPerSeason": 12, "huntSurplusGain": 6}

    for _ in range(max_steps):
        state = life_state(page)
        if state is None or not state.get("alive"):
            break

        # —— 演出与子屏优先 ——
        if has(page, ".treasure__card"):
            click(page, ".treasure__confirm", 400)
            continue
        if has(page, ".synergy__card"):
            click(page, ".synergy__confirm", 400)
            continue
        if has(page, ".molt__confirm"):
            click(page, ".molt__confirm", 500)
            continue
        if has(page, ".card--stalk"):
            if "stalk_shot" not in notes:
                notes["stalk_shot"] = True
                page.screenshot(path=str(OUT / "stalk-screen.png"))
            if click(page, ".sact.is-hot:not([disabled])") or click(
                page, '[data-stalk="pounce"]:not([disabled])'
            ):
                tally.hit("stalk")
                tally.stalk_acts += 1
            continue
        if has(page, ".card--combat"):
            if click(page, ".cact.is-hot:not([disabled])") or click(
                page, '[data-combat="bite:throat"]:not([disabled])'
            ):
                tally.hit("combat")
            continue
        if has(page, ".card--event"):
            if click(page, ".choice:not([disabled])"):
                tally.hit("event")
            continue
        if has(page, "[data-continue]:not([disabled])"):
            click(page, "[data-continue]:not([disabled])", 500)
            tally.hit("continue")
            continue

        # —— 行动面板 ——
        view = panel(page)
        if not view["actions"]:
            break
        if view["surplus"]:
            tally.surplus_seasons_seen += 1
            notes.setdefault("surplus_badge", view["surplus"])
            notes.setdefault("surplus_hunger_at", view["hunger"])
            if "surplus_shot" not in notes:
                notes["surplus_shot"] = True
                page.screenshot(path=str(OUT / "surplus-badge.png"))
        ids = {a["id"]: a for a in view["actions"] if not a["disabled"]}
        notes.setdefault("panel", view["actions"])

        left = runway(state, tuning)
        if "dormant" in ids:
            click(page, '[data-action="dormant"]:not([disabled])', 500)
            tally.hit("dormant")
            tally.dormant += 1
            continue
        hurt = any(flag in ("wound", "sick") for flag in state.get("flags", []))
        if left <= 4 and ("hunt" in ids or "hunt-quick" in ids):
            if left <= 3 and "hunt" in ids:
                click(page, '[data-action="hunt"]:not([disabled])')
                tally.hit("hunt")
                tally.hunt_stalk += 1
                tally.stalk_screens += 1
                notes.setdefault("stalk_entry_hunger", view["hunger"])
            else:
                click(page, '[data-action="hunt-quick"]:not([disabled])')
                tally.hit("hunt-quick")
                tally.hunt_quick += 1
                after = panel(page)
                notes.setdefault("quick_result", after["log"][:2])
            continue
        if hurt and "rest" in ids:
            click(page, '[data-action="rest"]:not([disabled])')
            tally.hit("rest")
            tally.rest += 1
            continue
        if left <= 5 and "rest" in ids:
            # 「不想花五次点击、也不想冒扑空的险」的那一季 —— 休憩是不是真选项就看这里
            click(page, '[data-action="rest"]:not([disabled])')
            tally.hit("rest")
            tally.rest += 1
            tally.rest_when_low += 1
            continue
        dest = safe_eval(
            page,
            "() => document.querySelector('[data-dest]:not([disabled])')?.getAttribute('data-dest') ?? null",
        )
        if dest:
            click(page, f'[data-dest="{dest}"]:not([disabled])')
            tally.hit("explore")
            tally.explore += 1
            continue
        break


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    tally = Tally()
    notes: dict = {}
    errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        start_life(page, SEED)
        # 开局那一屏：两颗猎按钮 ＋ 休憩，三句话并排（验收②③的原文证据）
        while has(page, "[data-continue]:not([disabled])"):
            click(page, "[data-continue]:not([disabled])", 400)
            tally.hit("continue")
        page.screenshot(path=str(OUT / "panel-open.png"))
        notes["panel_open"] = panel(page)["actions"]

        play(page, tally, notes)

        page.screenshot(path=str(OUT / "life-end.png"))
        state = life_state(page) or {}
        notes["ending"] = {
            "alive": state.get("alive"),
            "year": state.get("year"),
            "ending": state.get("ending"),
            "organs": len(state.get("organIds", [])),
            "livesTaken": state.get("livesTaken"),
        }
        browser.close()

    report = {
        "seed": SEED,
        "clicks": {
            "total": tally.total,
            "byKind": tally.clicks,
            "feeding": tally.feeding_clicks,
        },
        "actions": {
            "stalkHunts": tally.hunt_stalk,
            "quickHunts": tally.hunt_quick,
            "rests": tally.rest,
            "restsAsChoice": tally.rest_when_low,
            "explores": tally.explore,
            "dormants": tally.dormant,
        },
        "stalkScreens": tally.stalk_screens,
        "stalkActs": tally.stalk_acts,
        "surplusVisibleSeasons": tally.surplus_seasons_seen,
        "notes": notes,
        "consoleErrors": errors,
    }
    (OUT / "hunger-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2)[:4000])

    # 退出码吃三条判据（同 codex.py：「跑完了」不等于「没查出问题」）
    ok = (
        not errors
        and tally.hunt_quick > 0
        and tally.hunt_stalk > 0
        and tally.surplus_seasons_seen > 0
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
