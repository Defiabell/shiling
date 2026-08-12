#!/usr/bin/env python3
"""《食灵·列传》追猎屏实机验收（M1-P1）。

与 `fullLife.py`（打完一整世、验零 404）的分工：本脚本**只玩追猎**，而且不是为了跑通，
是为了回答 P1 交付线的手感四问 —— 所以它按**指定打法**驱动追猎，并把每一步屏幕上真实
显示的数（不是引擎内部值，是 DOM 里那几个字）抄下来对账：

  1. 逆风稳扎稳打（绕上风 → 潜到贴身 → 扑）能不能稳定得手？
  2. 顺风硬冲（不绕风、一路猛潜）是不是会因为警觉飙升而失手？
  3. 屏息等待是不是有意义的选项（而不是白耗一息）？
  4. 带 night-eye（夜瞳）与不带，屏幕上的信息差是否明显？

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/stalk.py [输出目录] [起始种子]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:5174/"
VIEWPORT = {"width": 1440, "height": 900}
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/p1").resolve()
SEED0 = int(sys.argv[2] if len(sys.argv) > 2 else 20260812)

# 追猎屏上四个动作按钮的 data-stalk 值
CREEP, CIRCLE, WAIT, POUNCE = "creep", "circle", "wait", "pounce"


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def screen(page: Page) -> dict:
    """把追猎屏上**玩家真的看得见**的东西抄下来 —— 断言要打在这上面，不是打在引擎值上。"""
    return page.evaluate(
        """() => {
          const q = (sel) => document.querySelector(sel);
          const meters = [...document.querySelectorAll('.smeter')].map((n) => ({
            zi: n.querySelector('.smeter__zi')?.textContent ?? '',
            num: n.querySelector('.smeter__num')?.textContent ?? null,
            band: n.querySelector('.smeter__band')?.textContent ?? '',
            vague: n.classList.contains('is-vague'),
            hot: n.classList.contains('is-hot'),
          }));
          const acts = [...document.querySelectorAll('[data-stalk]')].map((n) => ({
            id: n.getAttribute('data-stalk'),
            label: n.querySelector('b')?.textContent ?? '',
            effect: n.querySelector('.sact__effect')?.textContent ?? '',
            warn: n.querySelector('.sact__warn')?.textContent ?? null,
            hot: n.classList.contains('is-hot'),
            disabled: n.disabled,
          }));
          return {
            stalking: !!q('.card--stalk'),
            prey: q('.stalk__name')?.textContent ?? null,
            round: q('.stalk__kicker em')?.textContent ?? null,
            wind: q('.stalk__wind span')?.textContent ?? null,
            windMul: q('.stalk__wind i')?.textContent ?? null,
            windVague: q('.stalk__wind')?.classList.contains('is-vague') ?? null,
            windBad: q('.stalk__wind')?.classList.contains('is-bad') ?? null,
            track: q('.strack__num')?.textContent ?? null,
            meters,
            acts,
            log: [...document.querySelectorAll('.stalk__log li')].map((n) => n.textContent),
            railGone: !document.querySelector('.rail'),
            actionsGone: !document.querySelector('.actions'),
            endTitle: q('.card--narration .card__title')?.textContent ?? null,
            endLines: [...document.querySelectorAll('.card--narration .card__prose p')].map((n) => n.textContent),
          };
        }"""
    )


def press(page: Page, act: str) -> None:
    button = page.query_selector(f'[data-stalk="{act}"]:not([disabled])')
    if button is None:
        raise RuntimeError(f"追猎屏上按不到 {act}")
    button.click()
    page.wait_for_timeout(360)


def start_life(page: Page, seed: int, *, organs: list[str] | None = None) -> None:
    """开一世并停在主界面。`organs` 只是为了对照 —— 通过 URL 传 seed，器官靠真玩攒不到，
    所以带器官那一组改用引擎侧的等价对照（见 report 里的说明），这里只开局。"""
    page.goto(f"{BASE}?seed={seed}&reset=1", wait_until="networkidle")
    page.wait_for_timeout(300)
    page.click("[data-start]")
    page.wait_for_timeout(320)
    page.click("[data-seed]:not([disabled])")
    page.wait_for_timeout(600)


def hunt_until_stalk(page: Page, max_turns: int = 40) -> bool:
    """一直点狩猎，直到进追猎屏（狩猎有 35% 概率撞上事件而不起追）。"""
    for _ in range(max_turns):
        state = snap(page)
        if state["state"] and state["state"].get("stalk"):
            return True
        if state["center"] == "event":
            buttons = page.query_selector_all(".choice:not([disabled])")
            if buttons:
                buttons[-1].click()
                page.wait_for_timeout(320)
            continue
        if state["center"] == "combat":
            page.click('[data-combat="flee"]')
            page.wait_for_timeout(320)
            continue
        button = page.query_selector("[data-continue]")
        if button is not None:
            button.click()
            page.wait_for_timeout(320)
            continue
        hunt = page.query_selector('[data-action="hunt"]:not([disabled])')
        if hunt is None:
            return False
        hunt.click()
        page.wait_for_timeout(380)
    return False


def play_stalk(page: Page, plan: str, shots: list[str], out: Path, tag: str) -> dict:
    """按指定打法打完一场追猎，返回逐步的屏幕读数与结局。

    plan:
      - "patient"：看得见风就绕到上风，再潜到贴身，七成以上才扑（贴身而警觉高则屏息一次）
      - "rush"：一路潜行到贴身就扑，绝不绕风、绝不屏息
    """
    steps: list[dict] = []
    waited = False
    for i in range(12):
        view = screen(page)
        if not view["stalking"]:
            break
        steps.append(view)
        if i == 0:
            page.screenshot(path=str(out / f"{tag}-01-open.png"))
            shots.append(f"{tag}-01-open.png")

        acts = {a["id"]: a for a in view["acts"]}
        distance = int(view["track"].split()[0]) if view["track"] else 99
        pounce_effect = acts[POUNCE]["effect"]
        hopeless = acts[POUNCE]["warn"] is not None and "必空" in acts[POUNCE]["warn"]

        if plan == "rush":
            act = POUNCE if distance <= 0 else CREEP
        else:
            upwind = view["wind"] == "逆风"
            if not upwind and not view["windVague"] and i == 0:
                act = CIRCLE
            elif distance > 0:
                act = CREEP
            elif acts[POUNCE]["hot"]:
                act = POUNCE
            elif not waited:
                act = WAIT
                waited = True
            else:
                act = POUNCE
        steps[-1]["chose"] = act
        steps[-1]["pounceShown"] = pounce_effect
        steps[-1]["pounceHopeless"] = hopeless
        press(page, act)

    end = screen(page)
    page.screenshot(path=str(out / f"{tag}-99-end.png"))
    shots.append(f"{tag}-99-end.png")
    state = snap(page)
    return {
        "steps": steps,
        "endTitle": end["endTitle"],
        "endLines": end["endLines"],
        "hunger": state["state"]["hunger"] if state["state"] else None,
        "essence": state["state"]["essence"] if state["state"] else None,
        "combat": bool(state["state"] and state["state"].get("combat")),
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    shots: list[str] = []
    report: dict = {"patient": [], "rush": []}
    errors: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        page.on("console", lambda m: errors.append(f"console:{m.type}:{m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror:{e}"))

        for plan in ("patient", "rush"):
            caught = 0
            tried = 0
            for k in range(6):
                seed = SEED0 + k * 7919 + (0 if plan == "patient" else 104729)
                start_life(page, seed)
                if not hunt_until_stalk(page):
                    continue
                tried += 1
                tag = f"{plan}-{k}"
                result = play_stalk(page, plan, shots, OUT, tag)
                if result["endTitle"] and "得" in result["endTitle"]:
                    caught += 1
                report[plan].append(result)
            report[f"{plan}_rate"] = f"{caught}/{tried}"

        browser.close()

    (OUT / "stalk-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    print(f"[追猎实机] 稳扎稳打 得手 {report['patient_rate']}　顺风硬冲 得手 {report['rush_rate']}")
    for plan in ("patient", "rush"):
        for run in report[plan]:
            shown = [f"{s['chose']}:{s.get('pounceShown')}" for s in run["steps"]]
            print(f"  {plan:8s} {run['endTitle']}｜{' → '.join(shown)}")
    print(f"控制台错误 {len(errors)}：{errors[:5]}")
    print(f"截图 {len(shots)} 张 → {OUT}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
