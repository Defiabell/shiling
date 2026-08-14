#!/usr/bin/env python3
"""《食灵·列传》M2-B1「遭遇统一 ＋ 战斗加深」实机验收。

与 `stalk.py`／`combat.py` 同一套办法，也同一个理由：断言要打在**屏幕上真实显示的字**上，
不是引擎内部值。它回答 B1 交付线的四问：

  1. 一场遭遇里玩家是否在做多层决策？（接近的取舍 ＋ 交锋的出招节奏 ＋ 部位选择）
  2. 四项属性各自的作用是否在屏上看得见？（逐项抄下它显示在哪、写的什么）
  3. 一场架现在多少回合？（给分布）
  4. 点击数对账：一世总点击、进遭遇次数、每场平均回合数。

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/encounter.py [输出目录] [起始种子] [only]
      only = "life" 只跑一整世的点击对账；缺省两段都跑
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:5174/"
VIEWPORT = {"width": 1440, "height": 980}
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/b1").resolve()
SEED0 = int(sys.argv[2] if len(sys.argv) > 2 else 20260814)
ONLY = sys.argv[3] if len(sys.argv) > 3 else ""


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def screen(page: Page) -> dict:
    """把屏幕上**玩家真的看得见**的东西抄下来（遭遇外壳 ＋ 当前阶段的中段）。"""
    return page.evaluate(
        """() => {
          const q = (sel) => document.querySelector(sel);
          const txt = (sel) => q(sel)?.textContent ?? null;
          const all = (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent);
          const acts = [...document.querySelectorAll('[data-combat]')].map((n) => ({
            id: n.getAttribute('data-combat'),
            label: n.querySelector('b')?.textContent ?? '',
            effect: n.querySelector('.cact__effect')?.textContent ?? '',
            warn: n.querySelector('.cact__warn')?.textContent ?? null,
            lock: n.querySelector('.cact__lock')?.textContent ?? null,
            hot: n.classList.contains('is-hot'),
            disabled: n.disabled,
          }));
          const stalkActs = [...document.querySelectorAll('[data-stalk]')].map((n) => ({
            id: n.getAttribute('data-stalk'),
            label: n.querySelector('b')?.textContent ?? '',
            effect: n.querySelector('.sact__effect')?.textContent ?? '',
            warn: n.querySelector('.sact__warn')?.textContent ?? null,
            hot: n.classList.contains('is-hot'),
          }));
          const stats = [...document.querySelectorAll('.enc__stat')].map((n) => ({
            key: n.getAttribute('data-enc-stat'),
            zi: n.querySelector('.enc__stat-zi')?.textContent ?? '',
            value: n.querySelector('.enc__stat-num')?.textContent ?? '',
            uses: [...n.querySelectorAll('.enc__stat-uses em')].map((e) => e.textContent),
          }));
          const wounds = [...document.querySelectorAll('[data-wound]')].map((n) => ({
            part: n.getAttribute('data-wound'),
            text: n.textContent,
            landmark: n.classList.contains('is-landmark'),
          }));
          return {
            inEncounter: !!q('.card--encounter'),
            phase: q('.card--encounter')?.getAttribute('data-phase') ?? null,
            foe: txt('.combat__name'),
            round: txt('.combat__kicker em'),
            origin: txt('.enc__origin'),
            phaseBadge: txt('.enc__phase'),
            stage: txt('.enc__stage'),
            weak: txt('.enc__weak'),
            weakFound: q('.enc__weak')?.getAttribute('data-enc-weak') ?? null,
            weakTitle: q('.enc__weak')?.getAttribute('title') ?? null,
            momentum: txt('.enc__momentum-label'),
            momentumHot: q('.enc__momentum')?.classList.contains('is-hot') ?? null,
            momentumHint: q('.enc__momentum')?.getAttribute('title') ?? null,
            wounds,
            stats,
            guard: txt('.combat__guard'),
            stance: txt('.combat__stance'),
            intent: txt('.combat__intent-text'),
            intentDetail: txt('.combat__intent-detail'),
            outlook: txt('.combat__outlook'),
            marks: all('.combat__mark'),
            hp: all('.hp__num'),
            meters: [...document.querySelectorAll('.smeter')].map((n) => ({
              zi: n.querySelector('.smeter__zi')?.textContent ?? '',
              read: n.querySelector('.smeter__read')?.textContent ?? '',
            })),
            acts,
            stalkActs,
            log: all('.combat__log li'),
            endTitle: txt('.card--narration .card__title'),
          };
        }"""
    )


def start_life(page: Page, seed: int, *, organs: list[str] | None = None) -> None:
    grant = f"&organs={','.join(organs)}" if organs else ""
    page.goto(f"{BASE}?seed={seed}&reset=1&scenario=0{grant}", wait_until="networkidle")
    page.wait_for_timeout(300)
    page.click("[data-start]")
    page.wait_for_timeout(320)
    page.click("[data-seed]:not([disabled])")
    page.wait_for_timeout(600)


def click_first(page: Page, selectors: list[str], wait: int = 280) -> str | None:
    """
    点第一个能点的按钮。

    整段包在 try 里：列传屏那一下会重建整棵 DOM（`Execution context was destroyed`），
    而那正是「一世跑完了」的信号 —— 让它把异常吞掉、由外层的收束判据接手，
    比在每个选择器前面加一次存活判断干净。
    """
    for selector in selectors:
        try:
            button = page.query_selector(selector)
            if button is not None:
                button.click()
                page.wait_for_timeout(wait)
                return selector
        except Exception:
            return None
    return None


def step_forward(page: Page, tally: dict) -> str:
    """
    把界面往前推一格，返回刚处理的是哪一屏，并给点击账记一笔。

    **一律按 DOM 判当前屏，不按 `state`**（M1-P2 的教训：反噬那一刻 state 已经在交锋里，
    而中央还停在一张旁白卡上）。M2-B1 之后遭遇是**一张卡两个阶段**，所以这里按
    `data-phase` 分。
    """
    if click_first(page, [".molt__confirm"], 460):
        tally["molt"] = tally.get("molt", 0) + 1
        return "molt"
    card = page.query_selector(".card--encounter")
    if card is not None:
        phase = card.get_attribute("data-phase")
        if phase == "clash":
            if click_first(page, [".cact.is-hot:not([disabled])", '[data-combat="bite:throat"]:not([disabled])']):
                tally["clash"] = tally.get("clash", 0) + 1
                return "clash"
        else:
            if click_first(page, [".sact.is-hot:not([disabled])", '[data-stalk="pounce"]:not([disabled])']):
                tally["approach"] = tally.get("approach", 0) + 1
                return "approach"
    if page.query_selector(".card--event") is not None:
        buttons = page.query_selector_all(".choice:not([disabled])")
        if buttons:
            buttons[-1].click()
            page.wait_for_timeout(280)
            tally["event"] = tally.get("event", 0) + 1
            return "event"
    if page.query_selector("[data-action]:not([disabled])") is not None:
        """
        行动策略：**按屏幕上那两个数决定**（还够几季 ＋ 食余几季），与 `balance-sim` 的
        机器玩家同一条判据。只按金光会让机器一路追猎、两岁就饿死（第一版实机就是这样，
        一世 42 次点击、9 个行动）—— 那量到的是策略的缺陷，不是这一批的点击账。
        """
        runway = page.evaluate(
            """() => {
              const s = window.__tale.snapshot().state;
              if (!s) return 0;
              return Math.floor(s.hunger / 12) + s.surplusSeasons;
            }"""
        )
        want = "hunt:quick" if runway <= 4 else ("dormant" if runway > 6 else "explore")
        order = {
            "hunt:quick": ['[data-action="hunt-quick"]:not([disabled])', '[data-action="hunt"]:not([disabled])'],
            "dormant": ['[data-action="dormant"]:not([disabled])', "[data-dest]:not([disabled])"],
            "explore": ["[data-dest]:not([disabled])", '[data-action="rest"]:not([disabled])'],
        }[want]
        if click_first(page, [*order, "[data-action]:not([disabled])"], 320):
            tally["action"] = tally.get("action", 0) + 1
            return "action"
    if click_first(page, ["[data-continue]:not([disabled])"], 800):
        tally["continue"] = tally.get("continue", 0) + 1
        return "continue"
    page.wait_for_timeout(260)
    return "idle"


def play_one_life(page: Page, seed: int, out: Path, shots: list[str]) -> dict:
    """照屏幕金光打完一整世，记下点击账与每场遭遇的回合数。"""
    start_life(page, seed)
    tally: dict[str, int] = {}
    clashes: list[int] = []
    approaches: list[int] = []
    encounters = 0
    cur_clash = 0
    cur_approach = 0
    last_phase: str | None = None
    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    for step in range(2200):
        try:
            card = page.query_selector(".card--encounter")
            phase = card.get_attribute("data-phase") if card is not None else None
        except Exception:
            break
        if phase is not None and last_phase is None:
            encounters += 1
        if phase == "clash":
            cur_clash += 1
        if phase == "approach":
            cur_approach += 1
        if phase is None and last_phase is not None:
            if cur_clash:
                clashes.append(cur_clash)
            if cur_approach:
                approaches.append(cur_approach)
            cur_clash = 0
            cur_approach = 0
        last_phase = phase

        kind = step_forward(page, tally)
        try:
            state = snap(page)
        except Exception:
            break
        if state.get("screen") == "chronicle":
            break
        life_state = state.get("state")
        if life_state is not None and not life_state["alive"] and state["screen"] != "play":
            break
        if kind == "idle" and step > 40:
            break
    if cur_clash:
        clashes.append(cur_clash)
    if cur_approach:
        approaches.append(cur_approach)

    try:
        page.screenshot(path=str(out / "life-99-chronicle.png"))
        shots.append("life-99-chronicle.png")
    except Exception:
        pass
    state = snap(page)
    life_state = state.get("state") or {}
    clicks = sum(tally.values())
    return {
        "seed": seed,
        "years": life_state.get("year"),
        "ending": life_state.get("ending"),
        "clicks": clicks,
        "tally": tally,
        "encounters": encounters,
        "approaches": approaches,
        "clashes": clashes,
        "consoleErrors": console_errors,
    }


def capture_encounter(page: Page, seed: int, out: Path, tag: str, shots: list[str]) -> dict:
    """推到一场遭遇，逐回合抄屏；接近阶段故意远处硬扑（撞上会反扑的猎物就连着看两个阶段）。"""
    start_life(page, seed)
    tally: dict[str, int] = {}
    frames: list[dict] = []
    saw_approach = False
    saw_clash = False
    for _ in range(400):
        try:
            card = page.query_selector(".card--encounter")
        except Exception:
            break
        if card is not None:
            view = screen(page)
            frames.append(view)
            if view["phase"] == "approach" and not saw_approach:
                saw_approach = True
                page.screenshot(path=str(out / f"{tag}-approach.png"))
                shots.append(f"{tag}-approach.png")
            if view["phase"] == "clash" and not saw_clash:
                saw_clash = True
                page.screenshot(path=str(out / f"{tag}-clash-open.png"))
                shots.append(f"{tag}-clash-open.png")
            if saw_clash and len(frames) > 3 and view["phase"] is None:
                break
        step_forward(page, tally)
        if saw_clash and page.query_selector(".card--encounter") is None:
            break
        if saw_clash and len(frames) > 24:
            break
    if saw_clash:
        page.screenshot(path=str(out / f"{tag}-clash-late.png"))
        shots.append(f"{tag}-clash-late.png")
    return {"frames": frames, "sawApproach": saw_approach, "sawClash": saw_clash}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    shots: list[str] = []
    report: dict = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)

        if ONLY != "life":
            # 一场遭遇的逐回合抄屏：优先找会反扑的猎物（一屏之内连看两个阶段）
            for offset in range(0, 14):
                cap = capture_encounter(page, SEED0 + offset * 7919, OUT, f"enc-{offset}", shots)
                if cap["sawClash"]:
                    report["encounter"] = cap
                    report["encounterSeed"] = SEED0 + offset * 7919
                    break

        report["life"] = play_one_life(page, SEED0, OUT, shots)
        browser.close()

    report["shots"] = shots
    (OUT / "encounter-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    life = report["life"]
    print(f"[实机] 一世 {life['years']} 岁 · {life['ending']}")
    print(f"       点击 {life['clicks']} 次　{life['tally']}")
    print(f"       遭遇 {life['encounters']} 场　接近 {life['approaches']}　交锋 {life['clashes']}")
    print(f"       控制台错误 {len(life['consoleErrors'])} 条")
    if "encounter" in report:
        frames = report["encounter"]["frames"]
        print(f"       抄屏 {len(frames)} 帧（种子 {report['encounterSeed']}）")
    print(f"       截图 {len(shots)} 张 → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
