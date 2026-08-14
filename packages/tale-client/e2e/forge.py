#!/usr/bin/env python3
"""《食灵·列传》M2-B2「凝招」实机验收。

与 `encounter.py`／`skills.py` 同一套办法，也同一个理由：断言要打在**屏幕上真实显示的字**上，
不是引擎内部值。它回答 B2 交付线的四问：

  1. 能否拼出两套风格完全不同的招式并**都好用**？（贴两套的拼法、面板原文与实战表现）
  2. 拼装界面是否摊开了后果？（每换一个部件，预览数值是否当场更新 —— 逐项抄下变化前后）
  3. 是否存在严格占优的拼法？（这一问由 `tale-content/test/forge.test.ts` 全枚举回答，
     这里只复核招式框上**写的**代价与引擎给的一致）
  4. 凝招的代价与槽位上限是否让玩家真的要取舍？（把册满、精气不足两种局面都撞出来）

外加一世点击对账：凝招点了几次、一世总共点了几次。

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/forge.py [输出目录] [起始种子]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:5174/"
VIEWPORT = {"width": 1440, "height": 980}
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/b2").resolve()
SEED0 = int(sys.argv[2] if len(sys.argv) > 2 else 20260815)

# 两套风格完全不同的 build（dev 专用 `?organs=`）：
#   猛系 —— 齿起手、鬃发力、毒收尾，一记重手
#   灵系 —— 犀起手（按灵算）、瞳发力（顺带瞎它的眼）、目收尾（读它的意图）
MENG_ORGANS = ["gou-chi", "tie-zong", "du-xian", "xue-zhao"]
LING_ORGANS = ["ling-xi", "ye-tong", "wu-mu", "fu-biao"]


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def forge_screen(page: Page) -> dict:
    """把招式框上**玩家真的看得见**的东西逐字抄下来。"""
    return page.evaluate(
        """() => {
          const q = (sel) => document.querySelector(sel);
          const txt = (sel) => q(sel)?.textContent ?? null;
          const slots = [...document.querySelectorAll('[data-forge-slot]')].map((n) => ({
            slot: n.getAttribute('data-forge-slot'),
            label: n.querySelector('.fslot__label')?.textContent ?? '',
            picked: n.querySelector('.fslot__picked')?.textContent ?? '',
            pickedText: n.querySelector('.fslot__text')?.textContent ?? '',
            hint: n.querySelector('.fslot__hint')?.textContent ?? '',
            options: [...n.querySelectorAll('[data-forge-opt]')].map((o) => ({
              id: o.getAttribute('data-forge-opt'),
              zi: o.querySelector('.fopt__zi')?.textContent ?? '',
              what: o.querySelector('.fopt__what')?.textContent ?? '',
              outcome: o.querySelector('.fopt__outcome')?.textContent ?? '',
              lock: o.querySelector('.fopt__lock')?.textContent ?? null,
              on: o.classList.contains('is-on'),
              poor: o.classList.contains('is-poor'),
              disabled: o.disabled,
            })),
          }));
          const book = [...document.querySelectorAll('[data-forged]')].map((n) => ({
            id: n.getAttribute('data-forged'),
            seal: n.querySelector('.fbook__seal')?.textContent ?? '',
            name: n.querySelector('b')?.textContent ?? '',
            effect: n.querySelector('em')?.textContent ?? '',
            src: n.querySelector('.fbook__src')?.textContent ?? '',
          }));
          const lore = [...document.querySelectorAll('[data-lore]')].map((n) => ({
            id: n.getAttribute('data-lore'),
            name: n.querySelector('b')?.textContent ?? '',
            recipe: n.querySelector('.flore__recipe')?.textContent ?? '',
            effect: n.querySelector('em')?.textContent ?? '',
            reveal: n.querySelector('.flore__reveal')?.textContent ?? null,
            cost: n.querySelector('.flore__cost')?.textContent ?? null,
            lock: n.querySelector('.flore__lock')?.textContent ?? null,
            known: !n.classList.contains('is-unknown'),
          }));
          const commit = q('[data-forge-commit]');
          return {
            open: !!q('[data-forge]'),
            essence: txt('[data-forge-essence]'),
            slotLine: txt('[data-forge-slots]'),
            parts: txt('[data-forge-parts]'),
            empty: txt('[data-forge-empty]'),
            result: txt('.forge__result-effect'),
            cost: txt('.forge__result-cost'),
            name: q('[data-forge-name]')?.value ?? null,
            canForge: commit ? !commit.disabled : false,
            blocked: txt('[data-forge-blocked]'),
            entry: q('[data-forge-open]')?.textContent ?? null,
            entryHot: q('[data-forge-open]')?.classList.contains('is-hot') ?? null,
            slots,
            book,
            lore,
            html: document.body.innerHTML.length,
          };
        }"""
    )


def combat_screen(page: Page) -> dict:
    """搏杀屏上的按钮（凝成的招在这里长什么样、好不好用）。"""
    return page.evaluate(
        """() => {
          const acts = [...document.querySelectorAll('[data-combat]')].map((n) => ({
            id: n.getAttribute('data-combat'),
            seal: n.querySelector('.cact__seal')?.textContent ?? '',
            label: n.querySelector('b')?.textContent ?? '',
            effect: n.querySelector('.cact__effect')?.textContent ?? '',
            flavor: n.querySelector('.cact__flavor')?.textContent ?? null,
            lock: n.querySelector('.cact__lock')?.textContent ?? null,
            hot: n.classList.contains('is-hot'),
            forged: n.classList.contains('is-forged') || n.classList.contains('is-lore'),
            disabled: n.disabled,
          }));
          return {
            foe: document.querySelector('.combat__name')?.textContent ?? null,
            round: document.querySelector('.combat__kicker em')?.textContent ?? null,
            hp: [...document.querySelectorAll('.hp__num')].map((n) => n.textContent),
            log: [...document.querySelectorAll('.combat__log li')].map((n) => n.textContent),
            acts,
          };
        }"""
    )


def start_life(page: Page, seed: int, *, organs: list[str] | None = None, essence: int = 0) -> None:
    grant = f"&organs={','.join(organs)}" if organs else ""
    money = f"&essence={essence}" if essence else ""
    page.goto(f"{BASE}?seed={seed}&reset=1&scenario=0{grant}{money}", wait_until="networkidle")
    page.wait_for_timeout(300)
    page.click("[data-start]")
    page.wait_for_timeout(320)
    page.click("[data-seed]:not([disabled])")
    page.wait_for_timeout(600)


def click_first(page: Page, selectors: list[str], wait: int = 280) -> str | None:
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


def step_forward(page: Page, tally: dict, *, forging: bool = True, hunting: bool = False) -> str:
    """
    把界面往前推一格（照搬 `encounter.py` 的机器玩家，只多一条凝招）。

    `forging=False` 用在「拼一手指定的招再去打一架」那一支：那一支的招式册已经摆好了，
    再让机器自己去凝会把槽位与精气都花掉，于是永远走不到搏杀屏（第一版实机就是这样）。
    """
    if click_first(page, [".molt__confirm"], 460):
        tally["molt"] = tally.get("molt", 0) + 1
        return "molt"
    if click_first(page, [".synergy__confirm"], 460):
        tally["synergy"] = tally.get("synergy", 0) + 1
        return "synergy"
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
    # [M2-B2] 入口发金光（`recommendForge`）就去凝一手 —— 缺省已预填好，两次点击的那条路
    entry = page.query_selector("[data-forge-open].is-hot:not([disabled])") if forging else None
    if entry is not None:
        entry.click()
        page.wait_for_timeout(240)
        tally["forge"] = tally.get("forge", 0) + 1
        learn = page.query_selector("[data-forge-learn]:not([disabled])")
        if learn is not None:
            learn.click()
            tally["forge"] = tally.get("forge", 0) + 1
        elif click_first(page, ["[data-forge-commit]:not([disabled])"], 240):
            tally["forge"] = tally.get("forge", 0) + 1
        else:
            click_first(page, ["[data-forge-close]"], 200)
            tally["forge"] = tally.get("forge", 0) + 1
        page.wait_for_timeout(220)
        return "forge"
    if page.query_selector("[data-action]:not([disabled])") is not None:
        runway = page.evaluate(
            """() => {
              const s = window.__tale.snapshot().state;
              if (!s) return 0;
              return Math.floor(s.hunger / 12) + s.surplusSeasons;
            }"""
        )
        """
        `hunting=True`：一路走**追猎**（不是速猎）。速猎是一次点击就结算的快路径，
        它压根不进遭遇屏 —— 而「这一手在实战里好不好用」只有进了交锋才答得上来。
        """
        want = "hunt" if hunting else ("hunt:quick" if runway <= 4 else ("dormant" if runway > 6 else "explore"))
        order = {
            "hunt": ['[data-action="hunt"]:not([disabled])', '[data-action="hunt-quick"]:not([disabled])'],
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


def open_forge(page: Page) -> dict:
    click_first(page, ["[data-forge-open]:not([disabled])"], 320)
    return forge_screen(page)


def pick(page: Page, slot: str, part_id: str) -> dict:
    """换一个槽里的部件，返回换完之后招式框上的字（验收第二问的原始素材）。"""
    click_first(page, [f'[data-forge-opt="{slot}:{part_id}"]:not([disabled])'], 240)
    return forge_screen(page)


def build_style(page: Page, seed: int, organs: list[str], picks: list[tuple[str, str]], out: Path, tag: str, shots: list[str]) -> dict:
    """
    拼一套招并打一场架，抄下：招式框原文、每换一个部件之后的预览、按钮原文、实战日志。
    """
    start_life(page, seed, organs=organs, essence=120)
    open_forge(page)
    steps: list[dict] = []
    for slot, part_id in picks:
        after = pick(page, slot, part_id)
        steps.append(
            {
                "slot": slot,
                "part": part_id,
                "result": after["result"],
                "cost": after["cost"],
                "name": after["name"],
            }
        )
    panel = forge_screen(page)
    page.screenshot(path=str(out / f"{tag}-panel.png"))
    shots.append(f"{tag}-panel.png")
    forged_name = panel["name"]
    click_first(page, ["[data-forge-commit]:not([disabled])"], 400)
    after_commit = snap(page)

    # 打一场架，看这一手在按钮上长什么样、好不好用
    tally: dict[str, int] = {}
    battle: dict = {"acts": [], "log": [], "used": False, "clashes": 0}
    for _ in range(900):
        card = page.query_selector(".card--encounter")
        if card is not None and card.get_attribute("data-phase") == "clash":
            view = combat_screen(page)
            mine = [a for a in view["acts"] if a["forged"]]
            if mine and not battle["acts"]:
                battle["acts"] = mine
                battle["foe"] = view["foe"]
                battle["round"] = view["round"]
                page.screenshot(path=str(out / f"{tag}-combat.png"))
                shots.append(f"{tag}-combat.png")
            usable = [a for a in mine if not a["disabled"]]
            if usable:
                page.click(f'[data-combat="{usable[0]["id"]}"]')
                page.wait_for_timeout(340)
                battle["used"] = True
                after = combat_screen(page)
                battle["hpAfter"] = after["hp"]
                battle["hpBefore"] = view["hp"]
                battle["log"] = after["log"][-6:]
                page.screenshot(path=str(out / f"{tag}-used.png"))
                shots.append(f"{tag}-used.png")
                break
        # 招式册已经摆好了 —— 这一支不让机器再去凝（否则槽位与精气都花在凝招上），
        # 且一路走追猎（速猎不进遭遇屏，那就永远看不到这一手在实战里什么样）
        step_forward(page, tally, forging=False, hunting=True)
        if snap(page).get("screen") != "play":
            break
    return {
        "organs": organs,
        "seed": seed,
        "panel": panel,
        "steps": steps,
        "forgedName": forged_name,
        "forged": after_commit["forge"]["forged"],
        "battle": battle,
    }


def tradeoff_probe(page: Page, seed: int, out: Path, shots: list[str]) -> dict:
    """
    验收第四问：**代价与槽位上限是否让玩家真的要取舍**。

    把两种「按不下去」都撞出来并抄下屏幕原文：① 精气不足；② 招式册已满。
    """
    # ① 一穷二白那一世：招式框照样打得开，但「凝成」灰着并写明缺多少精气
    start_life(page, seed, organs=MENG_ORGANS)
    poor = open_forge(page)
    # ② 有钱那一世：一路凝到册满，把第二种「按不下去」也撞出来
    start_life(page, seed, organs=MENG_ORGANS, essence=400)
    rich = open_forge(page)
    filled: list[dict] = []
    for _ in range(6):
        view = forge_screen(page)
        if not view["canForge"]:
            break
        click_first(page, ["[data-forge-commit]:not([disabled])"], 340)
        click_first(page, ["[data-forge-open]:not([disabled])"], 300)
        filled.append(forge_screen(page))
    full = forge_screen(page)
    page.screenshot(path=str(out / "tradeoff-full.png"))
    shots.append("tradeoff-full.png")
    # 忘掉一手腾槽位（不退精气）
    forget = page.query_selector("[data-forge-forget]")
    before_essence = snap(page)["state"]["essence"]
    if forget is not None:
        forget.click()
        page.wait_for_timeout(300)
    after_forget = forge_screen(page)
    return {
        "poor": {"blocked": poor["blocked"], "canForge": poor["canForge"], "cost": poor["cost"]},
        "richCost": rich["cost"],
        "fills": len(filled),
        "full": {"blocked": full["blocked"], "slotLine": full["slotLine"], "canForge": full["canForge"]},
        "afterForget": {"slotLine": after_forget["slotLine"], "canForge": after_forget["canForge"]},
        "essenceBeforeForget": before_essence,
        "essenceAfterForget": snap(page)["state"]["essence"],
    }


def play_one_life(
    page: Page,
    seed: int,
    out: Path,
    shots: list[str],
    essence: int = 0,
    organs: list[str] | None = None,
) -> dict:
    """
    照屏幕金光打完一整世，记点击账。

    `essence`／`organs` 非空是**明标的半作弊**：这个脚本的机器玩家不是好玩家（它多半走
    速猎、两三岁就饿死），而凝招要**三件部件**（＝神种 ＋ 两次蜕变 ＝ 一百多点精气）
    才按得动 —— 不给起手本钱就永远拍不到「凝招出现在真实点击流水里」的样子。
    **点击账的正本仍是 500 世平衡台**（同 B1 的分工）；这一支只回答
    「凝招在一整世里点了几次、会不会打断节奏」。
    """
    start_life(page, seed, essence=essence, organs=organs)
    tally: dict[str, int] = {}
    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    for step in range(2400):
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
    try:
        page.screenshot(path=str(out / "life-chronicle.png"))
        shots.append("life-chronicle.png")
    except Exception:
        pass
    state = snap(page)
    life_state = state.get("state") or {}
    return {
        "seed": seed,
        "years": life_state.get("year"),
        "ending": life_state.get("ending"),
        "clicks": sum(tally.values()),
        "tally": tally,
        "forged": state["forge"]["forged"],
        "consoleErrors": console_errors,
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    shots: list[str] = []
    report: dict = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)

        report["meng"] = build_style(
            page,
            SEED0,
            MENG_ORGANS,
            [("open", "part-chi"), ("force", "part-zong"), ("addon", "part-du")],
            OUT,
            "meng",
            shots,
        )
        report["ling"] = build_style(
            page,
            SEED0 + 7919,
            LING_ORGANS,
            [("open", "part-xi"), ("force", "part-tong"), ("addon", "part-mu")],
            OUT,
            "ling",
            shots,
        )
        report["tradeoff"] = tradeoff_probe(page, SEED0 + 15838, OUT, shots)
        # 点击账那一支**不作弊**（不给精气、不给器官）：它要量的是「一个真玩家一世点了
        # 多少次」。机器玩家运气差的一世两三岁就饿死，那一世里凝招压根没机会出现 ——
        # 所以扫几个种子，取**第一世真凝出招来的那一个**（都没凝到就取最长的那一世）。
        # 与 B1 同一条分工：点击账的正本仍是 500 世平衡台，实机这一份是佐证。
        lives = []
        for offset in range(5):
            lives.append(play_one_life(page, SEED0 + offset * 7919, OUT, shots))
            if lives[-1]["forged"]:
                break
        report["lives"] = lives
        report["life"] = next(
            (life for life in lives if life["forged"]),
            max(lives, key=lambda life: life["years"] or 0),
        )
        # 明标半作弊的一世：给 30 起手精气，只为把「凝招出现在真实点击流水里」拍下来
        report["seededLife"] = play_one_life(
            page, SEED0, OUT, shots, essence=60, organs=["du-xian", "tie-zong"]
        )
        browser.close()

    report["shots"] = shots
    (OUT / "forge-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    life = report["life"]
    lives = report["lives"]
    print(f"[实机] 一世 {life['years']} 岁 · {life['ending']} · 总点击 {life['clicks']} · 明细 {life['tally']}")
    print(f"[实机] 凝成 {len(life['forged'])} 手：{[f['name'] for f in life['forged']]}")
    seeded = report["seededLife"]
    print(
        f"[实机·半作弊 60 精气＋两件器官] 一世 {seeded['years']} 岁 · 总点击 {seeded['clicks']} · "
        f"明细 {seeded['tally']} · 凝成 {[f['name'] for f in seeded['forged']]}"
    )
    print(f"[实机] 猛系：{report['meng']['panel']['result']} ／ {report['meng']['panel']['cost']}")
    print(f"[实机] 灵系：{report['ling']['panel']['result']} ／ {report['ling']['panel']['cost']}")
    print(f"[实机] 取舍：{report['tradeoff']['full']}")
    errors = [error for run in (*lives, seeded) for error in run["consoleErrors"]]
    print(f"[实机] 控制台报错 {len(errors)} 条")
    print(f"[实机] 报告：{OUT / 'forge-report.json'}")
    # 控制台报错要能被 CI／调用方看见 —— 只打印不 gate 的话，一次 500 报错的跑
    # 与一次干净的跑在退出码上一模一样（e2e/ 目录里八成的脚本都 gate，跟多数派）
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
