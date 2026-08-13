#!/usr/bin/env python3
"""《食灵·列传》S1「技能组合」实机验收。

同 `combat.py`／`stalk.py` 的办法与理由：断言打在**屏幕上真实显示的字**上，不是引擎内部值。
它回答 S1 交付线的四问：

  1. 同一场战斗，两种不同 build（猛系 vs 灵系）的技能池是否明显不同？
  2. 发现一个组合技的瞬间，是否「意外但合理」？（揭示演出 ＋ 配方 ＋ 因果一句）
  3. 每个技能按钮是否都摊开了后果？有没有哪个按钮点下去才知道会发生什么？
  4. 血统点现在有没有去处？（买「血脉」跑通一次跨世）

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/skills.py [输出目录] [起始种子]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:5174/"
VIEWPORT = {"width": 1440, "height": 900}
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/s1").resolve()
SEED0 = int(sys.argv[2] if len(sys.argv) > 2 else 20260813)

# 两种 build 的对照 grant（`?organs=` 是 dev 专用：只借 tag 与技，不叠 statMods）
MENG_BUILD = ["gou-chi", "du-xian", "tie-zong"]  # 猛系：齿、毒腺、铁鬃
LING_BUILD = ["wu-mu", "ling-xi", "fu-biao"]  # 灵系：雾目、灵犀、浮鳔


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def life_state(page: Page) -> dict | None:
    """当前这一世的 state；在标题屏／择神种屏／列传卷轴上可能是 null。"""
    return snap(page).get("state")


def combat_screen(page: Page) -> dict:
    """把搏杀屏上玩家真的看得见的字抄下来。"""
    return page.evaluate(
        """() => {
          const q = (sel) => document.querySelector(sel);
          const acts = [...document.querySelectorAll('[data-combat]')].map((n) => ({
            id: n.getAttribute('data-combat'),
            glyph: n.querySelector('.cact__seal')?.textContent ?? '',
            label: n.querySelector('b')?.textContent ?? '',
            effect: n.querySelector('.cact__effect')?.textContent ?? '',
            lock: n.querySelector('.cact__lock')?.textContent ?? null,
            warn: n.querySelector('.cact__warn')?.textContent ?? null,
            synergy: n.classList.contains('is-synergy'),
            hot: n.classList.contains('is-hot'),
            disabled: n.disabled,
          }));
          return {
            fighting: !!q('.card--combat'),
            enemy: q('.combat__name')?.textContent ?? null,
            marks: [...document.querySelectorAll('.combat__mark')].map((n) => n.textContent),
            intent: q('.combat__intent-text')?.textContent ?? null,
            outlook: q('.combat__outlook')?.textContent ?? null,
            acts,
          };
        }"""
    )


def codex_screen(page: Page) -> dict:
    """转世屏上的异变图鉴与血脉。"""
    return page.evaluate(
        """() => {
          const q = (sel) => document.querySelector(sel);
          return {
            points: q('[data-points]')?.textContent ?? null,
            caption: q('[data-codex-count]')?.textContent ?? null,
            rows: [...document.querySelectorAll('.codex__row')].map((n) => ({
              known: n.classList.contains('is-known'),
              id: n.getAttribute('data-synergy'),
              name: n.querySelector('.codex__name')?.textContent ?? '',
              recipe: n.querySelector('.codex__recipe')?.textContent ?? '',
              effect: n.querySelector('.codex__effect')?.textContent ?? '',
              note: n.querySelector('.codex__note')?.textContent ?? '',
            })),
            boons: [...document.querySelectorAll('.boon__row')].map((n) => ({
              name: n.querySelector('.boon__name')?.textContent ?? '',
              meta: n.querySelector('.boon__meta')?.textContent ?? '',
              skill: n.querySelector('.boon__skill')?.textContent ?? null,
              button: n.querySelector('.boon__buy')?.textContent ?? '',
              organId: n.querySelector('.boon__buy')?.getAttribute('data-boon') ?? '',
              disabled: n.querySelector('.boon__buy')?.disabled ?? true,
            })),
            chosen: q('.seed__boon-head span')?.textContent ?? null,
          };
        }"""
    )


def synergy_overlay(page: Page) -> dict | None:
    """异变揭示演出上的字（没在播则 None）。"""
    return page.evaluate(
        """() => {
          const card = document.querySelector('.synergy__card');
          if (!card) return null;
          return {
            kicker: card.querySelector('.synergy__kicker')?.textContent ?? '',
            recipe: [...card.querySelectorAll('.synergy__organ')].map((n) => n.textContent),
            reveal: card.querySelector('.synergy__reveal')?.textContent ?? '',
            name: card.querySelector('.synergy__name')?.textContent ?? '',
            desc: card.querySelector('.synergy__desc')?.textContent ?? '',
            stat: card.querySelector('.synergy__stat')?.textContent ?? '',
            foot: card.querySelector('.synergy__foot')?.textContent ?? '',
          };
        }"""
    )


def click_first(page: Page, selectors: list[str], wait: int = 300) -> bool:
    """
    点第一个能点的按钮。

    ⚠️ 必须容忍「元素在点击前被重渲染掉」：`TaleApp` 每一步都整屏重建，
    句柄拿到与真正点下去之间隔着一次 render，实机跑到第 300 步左右必然撞上
    （Playwright 报 `Element is not attached to the DOM`）。撞上就重取一次句柄。
    """
    for selector in selectors:
        for _ in range(3):
            button = page.query_selector(selector)
            if button is None:
                break
            try:
                button.click(timeout=4000)
            except Exception:
                page.wait_for_timeout(160)
                continue
            page.wait_for_timeout(wait)
            return True
    return False


def start_life(page: Page, seed: int, *, organs: list[str] | None = None, reset: bool = True) -> None:
    grant = f"&organs={','.join(organs)}" if organs else ""
    page.goto(f"{BASE}?seed={seed}{'&reset=1' if reset else ''}{grant}", wait_until="networkidle")
    page.wait_for_timeout(300)
    page.click("[data-start]")
    page.wait_for_timeout(320)
    page.click("[data-seed]:not([disabled])")
    page.wait_for_timeout(600)


def audit_buttons(view: dict, violations: list[dict]) -> None:
    """
    验收第③问：每颗按钮是否都摊开了后果。

    技能按钮要同时写清「伤害（或明说不出伤）· 冷却 · 代价」；不可用时**后果照写**，
    原因另起一行。别的按钮只要求后果非空（部位与姿态那几颗由 M1-P2 的测试守着）。
    """
    for act in view["acts"]:
        effect = act["effect"] or ""
        if not effect.strip():
            violations.append({"id": act["id"], "why": "按钮没有任何后果文案"})
            continue
        if not act["id"].startswith("skill:"):
            continue
        if "伤 " not in effect and "不出伤" not in effect:
            violations.append({"id": act["id"], "why": f"技能按钮没写伤害：{effect}"})
        if "冷却" not in effect:
            violations.append({"id": act["id"], "why": f"技能按钮没写冷却：{effect}"})
        if "自伤" not in effect and "精气" not in effect:
            violations.append({"id": act["id"], "why": f"技能按钮没写代价：{effect}"})
        if act["disabled"] and not act["lock"]:
            violations.append({"id": act["id"], "why": "置灰却没说为什么"})


def step_forward(page: Page, violations: list[dict]) -> str:
    """把界面往前推一格（顺带每进一次搏杀屏就审一次按钮）。"""
    if synergy_overlay(page) is not None:
        click_first(page, [".synergy__confirm"], 400)
        return "synergy"
    if click_first(page, [".molt__confirm"], 500):
        return "molt"
    if page.query_selector(".card--combat") is not None:
        audit_buttons(combat_screen(page), violations)
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


def reach_combat(page: Page, violations: list[dict], max_turns: int = 140) -> bool:
    for _ in range(max_turns):
        if page.query_selector(".card--combat") is not None:
            return True
        if page.query_selector(".stalk__badge") is not None:
            if click_first(page, ['[data-stalk="pounce"]:not([disabled])'], 360):
                continue
        step_forward(page, violations)
    return False


# ===== 问一：两种 build 的技能池 =====


def probe_build(page: Page, seed: int, organs: list[str], tag: str, out: Path,
                shots: list[str], violations: list[dict]) -> dict:
    start_life(page, seed, organs=organs)
    if not reach_combat(page, violations):
        return {"tag": tag, "reached": False}
    view = combat_screen(page)
    audit_buttons(view, violations)
    page.screenshot(path=str(out / f"pool-{tag}.png"))
    shots.append(f"pool-{tag}.png")
    skills = [a for a in view["acts"] if a["id"].startswith("skill:")]
    return {
        "tag": tag,
        "reached": True,
        "grant": organs,
        "enemy": view["enemy"],
        "skills": skills,
        "skillIds": sorted(a["id"] for a in skills),
    }


# ===== 问二：发现一个组合技的瞬间 =====


def hunt_synergy(page: Page, seeds: list[int], out: Path, shots: list[str],
                 violations: list[dict]) -> dict | None:
    """
    真跑到一次「异变」揭示。

    办法：只 grant **配方里的一件**（猛系两件：狩齿＋铁鬃），剩下那件靠蛰伏开奖自己开出来
    —— 那才是玩家真正会撞上的路径（发现必须是「意料之外」的，不能是脚本摆好的）。
    换种子重试是因为开奖是加权抽的：某个种子这一世可能一件都没蜕成。
    """
    for seed in seeds:
        start_life(page, seed, organs=["gou-chi", "tie-zong"])
        for _ in range(400):
            found = synergy_overlay(page)
            if found is not None:
                # 卡片有 520ms 的浮现过渡：不等它落定，截图会拍到半透明的一张
                page.wait_for_timeout(800)
                page.screenshot(path=str(out / "synergy-reveal.png"))
                shots.append("synergy-reveal.png")
                found["seed"] = seed
                found["organs"] = (life_state(page) or {}).get("organIds")
                click_first(page, [".synergy__confirm"], 500)
                # 揭示之后：搏杀屏上应该多一颗「异」印的按钮
                if reach_combat(page, violations):
                    view = combat_screen(page)
                    audit_buttons(view, violations)
                    combo = [a for a in view["acts"] if a["synergy"]]
                    found["comboButtons"] = combo
                    page.screenshot(path=str(out / "synergy-in-pool.png"))
                    shots.append("synergy-in-pool.png")
                return found
            state = life_state(page)
            if state is not None and not state["alive"]:
                break
            step_forward(page, violations)
    return None


# ===== 问四：血统点的去处（血脉跨世） =====


def play_to_death(page: Page, violations: list[dict], max_turns: int = 1200) -> dict:
    """照屏幕提示打完一整世，停在列传卷轴（那一屏才有「转世」按钮）。"""
    last: dict = {}
    for _ in range(max_turns):
        state = life_state(page)
        if state is not None:
            last = state
        # 卷轴屏的根节点是 `.screen--chronicle`（不是 `.chronicle`）—— 选错的后果是
        # 这个循环把死亡之后的界面又点回标题屏，然后空转到 max_turns
        if page.query_selector(".screen--chronicle") is not None:
            return last
        if state is not None and not state["alive"] and page.query_selector("[data-continue]") is None:
            return last
        step_forward(page, violations)
    return last


def boon_round_trip(page: Page, seed: int, out: Path, shots: list[str],
                    violations: list[dict]) -> dict:
    """一世 → 转世屏买「血脉」→ 下一世起手自带那件器官。"""
    start_life(page, seed)
    dead = play_to_death(page, violations)
    # 列传卷轴 → 转世（择神种屏）
    click_first(page, ["[data-reincarnate]", "[data-continue]"], 900)
    page.wait_for_timeout(500)
    before = codex_screen(page)
    page.screenshot(path=str(out / "codex-before.png"))
    shots.append("codex-before.png")

    buyable = [b for b in before["boons"] if not b["disabled"]]
    result: dict = {
        "seed": seed,
        "lifeYears": dead.get("year"),
        "pointsBefore": before["points"],
        "caption": before["caption"],
        "boons": before["boons"],
        "unknownRowsLeakNothing": all(
            row["recipe"] == "" and row["effect"] == "" and row["name"] == "？"
            for row in before["rows"]
            if not row["known"]
        ),
    }
    if not buyable:
        result["bought"] = None
        return result

    target = buyable[0]
    page.click(f'[data-boon="{target["organId"]}"]')
    page.wait_for_timeout(500)
    after = codex_screen(page)
    page.screenshot(path=str(out / "codex-bought.png"))
    shots.append("codex-bought.png")
    result["bought"] = target
    result["pointsAfter"] = after["points"]
    result["chosenLine"] = after["chosen"]

    # 起下一世（不 reset：这一屏就是转世流程本身）
    page.click("[data-seed]:not([disabled])")
    page.wait_for_timeout(700)
    born = life_state(page) or {}
    result["nextLifeOrganIds"] = born.get("organIds")
    result["boonCarried"] = target["organId"] in (born.get("organIds") or [])
    page.screenshot(path=str(out / "boon-next-life.png"))
    shots.append("boon-next-life.png")

    # 那一件器官的技当场就在技能池里
    if reach_combat(page, violations):
        view = combat_screen(page)
        audit_buttons(view, violations)
        result["nextLifeSkills"] = [a["id"] for a in view["acts"] if a["id"].startswith("skill:")]
        page.screenshot(path=str(out / "boon-skill-pool.png"))
        shots.append("boon-skill-pool.png")
    return result


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    shots: list[str] = []
    violations: list[dict] = []
    errors: list[str] = []
    report: dict = {}

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: errors.append(str(err)))

        # 问一：两种 build 的技能池
        report["builds"] = [
            probe_build(page, SEED0, MENG_BUILD, "meng", OUT, shots, violations),
            probe_build(page, SEED0, LING_BUILD, "ling", OUT, shots, violations),
        ]

        # 问二：真跑到一次异变揭示
        report["synergy"] = hunt_synergy(
            page, [SEED0 + i for i in range(1, 14)], OUT, shots, violations
        )

        # 问四：血脉跨世
        report["boon"] = boon_round_trip(page, SEED0 + 100, OUT, shots, violations)

        browser.close()

    report["buttonViolations"] = violations
    report["consoleErrors"] = errors
    report["shots"] = shots
    (OUT / "skills-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\n=== S1 实机验收 ===  截图 {len(shots)} 张 → {OUT}")
    for build in report["builds"]:
        if build["reached"]:
            print(f"[{build['tag']}] 技能池 {len(build['skills'])} 颗：")
            for skill in build["skills"]:
                mark = "异" if skill["synergy"] else "技"
                print(f"   {mark} {skill['label']}　{skill['effect']}" + (f"　（{skill['lock']}）" if skill["lock"] else ""))
        else:
            print(f"[{build['tag']}] 没能进搏杀屏")
    syn = report["synergy"]
    if syn:
        print(f"\n[异变] {syn['name']}　配方 {' ＋ '.join(syn['recipe'])}")
        print(f"   因果：{syn['reveal']}")
        print(f"   那一手：{syn['stat']}")
        print(f"   池子里的组合按钮：{[b['label'] for b in syn.get('comboButtons', [])]}")
    else:
        print("\n[异变] 十三个种子都没撞到一次发现 —— 发现节奏太疏（这本身就是结论）")
    boon = report["boon"]
    print(f"\n[血脉] 一世活了 {boon['lifeYears']} 岁 · 血统 {boon['pointsBefore']} → {boon.get('pointsAfter')}")
    print(f"   图鉴：{boon['caption']}　未发现的行不泄露配方：{boon['unknownRowsLeakNothing']}")
    if boon.get("bought"):
        print(f"   买下 {boon['bought']['name']}（{boon['bought']['button']}）→ 下一世自带：{boon['boonCarried']}")
        print(f"   下一世技能池：{boon.get('nextLifeSkills')}")
    print(f"\n按钮审计违规 {len(violations)} 条　控制台报错 {len(errors)} 条")
    for violation in violations[:10]:
        print(f"   ✗ {violation['id']}：{violation['why']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
