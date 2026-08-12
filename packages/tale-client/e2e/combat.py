#!/usr/bin/env python3
"""《食灵·列传》搏杀屏 ＋ 结局重构实机验收（M1-P2）。

与 `stalk.py`（追猎屏）同一套办法，也同一个理由：断言要打在**屏幕上真实显示的字**上，
不是引擎内部值。它回答 P2 交付线的四问：

  1. 一场搏杀里玩家真的在做判断吗？（读意图选姿态、避开守备部位、什么时候该逃）
  2. 咬喉／咬腿／扑眼三个部位是否各有明确的适用局面？
  3. 带洞察类器官（灵犀）与不带，同一场战斗的体验差异是否明显？
  4. 寿终正寝现在会让人想再来一次吗？（差距报告是否让人看清「差在哪」）

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/combat.py [输出目录] [起始种子]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:5174/"
VIEWPORT = {"width": 1440, "height": 900}
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/p2").resolve()
SEED0 = int(sys.argv[2] if len(sys.argv) > 2 else 20260812)
# 第三个参数给 "life" ＝ 只跑那一整世（三组搏杀要跑十来分钟，调死亡屏时不必每次重跑）
ONLY = sys.argv[3] if len(sys.argv) > 3 else ""


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def screen(page: Page) -> dict:
    """把屏幕上**玩家真的看得见**的东西抄下来。"""
    return page.evaluate(
        """() => {
          const q = (sel) => document.querySelector(sel);
          const txt = (sel) => q(sel)?.textContent ?? null;
          const acts = [...document.querySelectorAll('[data-combat]')].map((n) => ({
            id: n.getAttribute('data-combat'),
            label: n.querySelector('b')?.textContent ?? '',
            effect: n.querySelector('.cact__effect')?.textContent ?? '',
            warn: n.querySelector('.cact__warn')?.textContent ?? null,
            hot: n.classList.contains('is-hot'),
            disabled: n.disabled,
          }));
          const gates = [...document.querySelectorAll('.agate')].map((n) => ({
            gate: n.getAttribute('data-gate'),
            met: n.getAttribute('data-met') === '1',
            num: n.querySelector('.agate__num')?.textContent ?? '',
          }));
          return {
            fighting: !!q('.card--combat'),
            stalking: !!q('.card--stalk'),
            foe: txt('.combat__name'),
            round: txt('.combat__kicker em'),
            guard: txt('.combat__guard'),
            stance: txt('.combat__stance'),
            marks: [...document.querySelectorAll('.combat__mark')].map((n) => n.textContent),
            intent: txt('.combat__intent-text'),
            intentDetail: txt('.combat__intent-detail'),
            intentVague: q('.combat__intent')?.classList.contains('is-vague') ?? null,
            intentHot: q('.combat__intent')?.classList.contains('is-hot') ?? null,
            outlook: txt('.combat__outlook'),
            outlookHot: q('.combat__outlook')?.classList.contains('is-hot') ?? null,
            hp: [...document.querySelectorAll('.hp__num')].map((n) => n.textContent),
            acts,
            log: [...document.querySelectorAll('.combat__log li')].map((n) => n.textContent),
            ascendCaption: txt('.ascend__zi'),
            gates,
            endTitle: txt('.card--narration .card__title'),
            endLines: [...document.querySelectorAll('.card--narration .card__prose p')].map((n) => n.textContent),
          };
        }"""
    )


def press(page: Page, act: str) -> None:
    button = page.query_selector(f'[data-combat="{act}"]:not([disabled])')
    if button is None:
        raise RuntimeError(f"搏杀屏上按不到 {act}")
    button.click()
    page.wait_for_timeout(340)


def start_life(page: Page, seed: int, *, organs: list[str] | None = None) -> None:
    grant = f"&organs={','.join(organs)}" if organs else ""
    page.goto(f"{BASE}?seed={seed}&reset=1{grant}", wait_until="networkidle")
    page.wait_for_timeout(300)
    page.click("[data-start]")
    page.wait_for_timeout(320)
    page.click("[data-seed]:not([disabled])")
    page.wait_for_timeout(600)


def click_first(page: Page, selectors: list[str], wait: int = 300) -> bool:
    """点第一个能点的按钮。返回是否点到了东西。"""
    for selector in selectors:
        button = page.query_selector(selector)
        if button is not None:
            button.click()
            page.wait_for_timeout(wait)
            return True
    return False


def step_forward(page: Page) -> str:
    """
    把界面往前推一格，返回刚处理的是哪一屏。

    **一律按 DOM 判当前屏，不按 `state`**：「反噬」那一刻 `state.combat` 已非 null，
    而中央还停在一张「迎　敌」的旁白卡上（要先按继续才进战斗卡）。按 state 判会去点一颗
    还不存在的按钮 —— 实机跑第一遍就是这么崩的。另一个坑是**降世那张旁白卡没有继续按钮**
    （它等玩家自己选行动），所以「有旁白卡就按继续」这条也不成立：行动面板要排在它前面。
    """
    # 蜕变开奖的卷轴：`playMoltReveal` 只在玩家点「承此形」之后才 resolve，不点它
    # `busy` 会**永远**停在 true —— 于是所有按钮禁用、界面看着完好却彻底冻住。
    # 实机第一遍就卡在这儿（第 400〜1800 次点击原地不动，都在 6 岁）。
    if click_first(page, [".molt__confirm"], 500):
        return "molt"
    if page.query_selector(".card--combat") is not None:
        if click_first(page, [".cact.is-hot:not([disabled])", '[data-combat="bite:throat"]:not([disabled])']):
            return "combat"
    if page.query_selector(".card--stalk") is not None:
        if click_first(page, [".sact.is-hot:not([disabled])", '[data-stalk="pounce"]:not([disabled])']):
            return "stalk"
    if page.query_selector(".card--event") is not None:
        buttons = page.query_selector_all(".choice:not([disabled])")
        if buttons:
            buttons[-1].click()
            page.wait_for_timeout(300)
            return "event"
    if click_first(page, [".act.is-hot:not([disabled])", "[data-action]:not([disabled])"], 340):
        return "action"
    if click_first(page, ["[data-continue]:not([disabled])"], 900):
        return "continue"
    page.wait_for_timeout(300)
    return "idle"


def reach_combat(page: Page, max_turns: int = 120) -> bool:
    """一直往前推，直到进搏杀屏。

    撞上**会反扑**的猎物（岩羊）时故意远距离硬扑：那是玩家真会遇到的入口
    （「值不值得扑」判断失误），扑空的那一瞬转搏杀，正好连着验「追猎 → 搏杀」的衔接。
    """
    for _ in range(max_turns):
        if page.query_selector(".card--combat") is not None:
            return True
        if page.query_selector(".stalk__badge") is not None:
            # 会反扑：远处硬扑
            if click_first(page, ['[data-stalk="pounce"]:not([disabled])'], 360):
                continue
        step_forward(page)
    return False


def play_combat(page: Page, plan: str, out: Path, tag: str, shots: list[str]) -> dict:
    """按指定打法打完一场搏杀，返回逐回合的屏幕读数与结局。

    plan:
      - "screen"：只按发金光的那颗（唯一诚实的验法 —— 若跟着界面打成绩差，是界面在误导）
      - "throat"：只会咬喉（验证「一招通吃」不成立）
    """
    steps: list[dict] = []
    for i in range(16):
        view = screen(page)
        if not view["fighting"]:
            break
        steps.append(view)
        if i == 0:
            page.screenshot(path=str(out / f"{tag}-01-open.png"))
            shots.append(f"{tag}-01-open.png")
        acts = {a["id"]: a for a in view["acts"]}
        if plan == "throat":
            act = "bite:throat"
        else:
            hot = [a["id"] for a in view["acts"] if a["hot"]]
            if len(hot) > 1:
                raise RuntimeError(f"同一时刻有 {len(hot)} 颗按钮发金光：{hot}")
            act = hot[0] if hot else "bite:throat"
        if acts.get(act, {}).get("disabled"):
            act = "bite:throat"
        steps[-1]["chose"] = act
        press(page, act)
    end = screen(page)
    page.screenshot(path=str(out / f"{tag}-99-end.png"))
    shots.append(f"{tag}-99-end.png")
    return {"steps": steps, "endTitle": end["endTitle"], "endLines": end["endLines"]}


def play_to_death(page: Page, out: Path, shots: list[str], max_turns: int = 2000) -> dict:
    """照屏幕提示打完一整世，停在列传卷轴 —— 为的是验差距报告与登神进度。

    上限给到 2000 不是保险起见：一世约 145 个引擎回合，而追猎一场 4〜5 次点击、搏杀一场
    3〜8 次，再加中间那些「继续」，实测要 700〜900 次点击才走得完。第一版给 600 就是在
    半路被砍断的（收束字段全是 None，而不是报错 —— 这种「静默走不完」最难看出来）。
    """
    shot_death = False
    seen_ascend = None
    for turn in range(max_turns):
        if page.query_selector(".screen--chronicle") is not None:
            break
        if turn % 200 == 0:
            state = snap(page)
            year = state["state"]["year"] if state["state"] else "?"
            print(f"    [life] 第 {turn} 次点击，{year} 岁", flush=True)
        # 登神进度在一世中途至少抄一次：它是「常驻可见」这条的实机证据
        if seen_ascend is None and page.query_selector(".ascend") is not None:
            seen_ascend = page.evaluate(
                """() => ({
                  caption: document.querySelector('.ascend__zi')?.textContent ?? null,
                  gates: [...document.querySelectorAll('.agate')].map((n) => ({
                    gate: n.getAttribute('data-gate'),
                    met: n.getAttribute('data-met') === '1',
                    num: n.querySelector('.agate__num')?.textContent ?? '',
                  })),
                })"""
            )
        if not shot_death and page.query_selector("[data-continue]") is not None:
            state = snap(page)
            if state["state"] and not state["state"]["alive"]:
                # 死亡屏：先把差距报告那一屏拍下来，再按瞑目走演出
                page.screenshot(path=str(out / "life-90-death.png"))
                shots.append("life-90-death.png")
                shot_death = True
        step_forward(page)

    page.wait_for_timeout(600)
    page.screenshot(path=str(out / "life-99-chronicle.png"), full_page=True)
    shots.append("life-99-chronicle.png")
    scroll = page.evaluate(
        """() => ({
          ending: document.querySelector('.scroll__stamp')?.textContent ?? null,
          meta: [...document.querySelectorAll('.scroll__meta span')].map((n) => n.textContent),
          closing: document.querySelector('.scroll__closing')?.textContent ?? null,
          praise: document.querySelector('.praise__text')?.textContent ?? null,
          gain: document.querySelector('[data-gain]')?.textContent ?? null,
          gap: document.querySelector('.chronicle__gap b')?.textContent ?? null,
          gapMeta: document.querySelector('.chronicle__gap em')?.textContent ?? null,
        })"""
    )
    scroll["ascendStrip"] = seen_ascend
    return scroll


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    shots: list[str] = []
    report: dict = {}
    errors: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        page.on("console", lambda m: errors.append(f"console:{m.type}:{m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror:{e}"))

        # — 三组搏杀：照提示打／只会咬喉／带灵犀照提示打 —
        for plan, organs in (() if ONLY == "life" else (("screen", None), ("throat", None), ("seer", ["ling-xi"]))):
            report.setdefault(plan, [])
            wins = 0
            tried = 0
            for k in range(4):
                seed = SEED0 + k * 7919
                start_life(page, seed, organs=organs)
                if not reach_combat(page):
                    print(f"  [skip] {plan}-{k} 60 回合内没打起来", flush=True)
                    continue
                tried += 1
                result = play_combat(
                    page, "throat" if plan == "throat" else "screen", OUT, f"{plan}-{k}", shots
                )
                if result["endTitle"] and "得" in result["endTitle"]:
                    wins += 1
                report[plan].append(result)
                print(f"  [done] {plan}-{k} {result['endTitle']}", flush=True)
            report[f"{plan}_rate"] = f"{wins}/{tried}"

        # — 一整世：验登神进度常驻 ＋ 死亡屏差距报告 ＋ 卷轴 —
        print("  [life] 开始跑一整世", flush=True)
        start_life(page, SEED0 + 991, organs=None)
        page.screenshot(path=str(OUT / "life-01-birth.png"))
        shots.append("life-01-birth.png")
        report["life"] = play_to_death(page, OUT, shots)

        browser.close()

    (OUT / "combat-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    if ONLY != "life":
        print(
            f"[搏杀实机] 照提示打 {report['screen_rate']}　只会咬喉 {report['throat_rate']}"
            f"　照提示打＋灵犀 {report['seer_rate']}"
        )
    for plan in ("screen", "throat", "seer") if ONLY != "life" else ():
        for run in report[plan]:
            shown = [f"{s.get('chose')}" for s in run["steps"]]
            print(f"  {plan:6s} {run['endTitle']}｜{' → '.join(shown)}")
    for plan in ("screen", "seer") if ONLY != "life" else ():
        first = report[plan][0]["steps"][0] if report[plan] and report[plan][0]["steps"] else None
        if first:
            print(
                f"  {plan:6s} 第一屏：{first['foe']}｜{first['guard']}｜意图「{first['intent']}」"
                f"（模糊 {first['intentVague']}）｜{first['intentDetail']}｜{first['outlook']}"
            )
            for act in first["acts"]:
                print(f"           {act['id']:14s} {act['effect']}{'  ⚠ ' + act['warn'] if act['warn'] else ''}")
    print(f"  一世收束：{report['life']}")
    print(f"控制台错误 {len(errors)}：{errors[:5]}")
    print(f"截图 {len(shots)} 张 → {OUT}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
