#!/usr/bin/env python3
"""《食灵·列传》M2-B3「敌人扩容 ＋ 平衡」实机验收。

与 `encounter.py`／`forge.py` 同一套办法，也同一个理由：断言要打在**屏幕上真实显示的字**上，
不是引擎内部值。它回答 B3 交付线的三问里屏幕那一半（第①②问的胜率矩阵与坡度以
`packages/gen` 的 `--lab matrix` 为正本 —— 那要跑几千场，实机跑不动）：

  ③ 新兽读起来是否和老的一样有志怪气？→ 抽三头逐字抄屏（名号／形貌／行为段／破绽／旁白）
  ④ 点击对账那一半 → 跑一整世，记点击流水
  ＋ 借来的头像真的加载出来了（`<img>` 加载失败不报错，玩家只看到一块空框）
  ＋ 「食之所偏」那一行真的在屏上，且写得出精气型与「已在手／尚未得」

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5199 --strictPort

用法：
    python packages/tale-client/e2e/bestiary.py [输出目录] [起始种子] [端口]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/b3").resolve()
SEED0 = int(sys.argv[2] if len(sys.argv) > 2 else 20260815)
PORT = sys.argv[3] if len(sys.argv) > 3 else "5199"
BASE = f"http://localhost:{PORT}/"
VIEWPORT = {"width": 1440, "height": 980}

# 抽这三头：一头「甲·顶格」、一头「重」、一头「啄」—— 三个原型各一，也各借一张不同的脸
SAMPLES = [
    ("jiu-wei-hu", "九尾狐"),
    ("bi-fang", "毕方"),
    ("luo-yu", "蠃鱼"),
]


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def screen(page: Page) -> dict:
    """把屏幕上**玩家真的看得见**的东西抄下来。"""
    return page.evaluate(
        """() => {
          const q = (sel) => document.querySelector(sel);
          const txt = (sel) => q(sel)?.textContent ?? null;
          const all = (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent);
          const img = q('[data-foe]');
          return {
            phase: q('.card--encounter')?.getAttribute('data-phase') ?? null,
            foe: txt('.combat__name'),
            // 交锋阶段屏上没有形貌那一行（B1 的排版：那一格让给了「它打算干什么」）
            desc: txt('.stalk__desc'),
            intentDetail: txt('.combat__intent-detail'),
            origin: txt('.enc__origin'),
            stage: txt('.enc__stage'),
            weak: txt('.enc__weak'),
            weakTitle: q('.enc__weak')?.getAttribute('title') ?? null,
            momentum: txt('.enc__momentum-label'),
            intent: txt('.combat__intent-text'),
            guard: txt('.combat__guard'),
            outlook: txt('.combat__outlook'),
            hp: all('.hp__num'),
            bias: [...document.querySelectorAll('[data-enc-bias-part]')].map((n) => ({
              part: n.getAttribute('data-enc-bias-part'),
              text: n.textContent,
              owned: n.classList.contains('is-owned'),
            })),
            biasTitle: q('[data-enc-bias]')?.getAttribute('title') ?? null,
            stats: [...document.querySelectorAll('.enc__stat')].map((n) => ({
              zi: n.querySelector('.enc__stat-zi')?.textContent ?? '',
              value: n.querySelector('.enc__stat-num')?.textContent ?? '',
              uses: [...n.querySelectorAll('.enc__stat-uses em')].map((e) => e.textContent),
            })),
            acts: [...document.querySelectorAll('[data-combat]')].map((n) => ({
              id: n.getAttribute('data-combat'),
              label: n.querySelector('b')?.textContent ?? '',
              effect: n.querySelector('.cact__effect')?.textContent ?? '',
              hot: n.classList.contains('is-hot'),
            })),
            log: all('.combat__log li'),
            portrait: img ? {
              src: img.getAttribute('src'),
              // 真加载成功了没有 —— `<img>` 404 不报错，只留一块空框
              loaded: img.complete && img.naturalWidth > 0,
              naturalWidth: img.naturalWidth,
            } : null,
          };
        }"""
    )


def start_life(page: Page, seed: int, *, foe: str | None = None, extra: str = "") -> None:
    grant = f"&foe={foe}" if foe else ""
    page.goto(f"{BASE}?seed={seed}&reset=1&scenario=0{grant}{extra}", wait_until="networkidle")
    page.wait_for_timeout(300)
    page.click("[data-start]")
    page.wait_for_timeout(320)
    page.click("[data-seed]:not([disabled])")
    page.wait_for_timeout(700)


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


def step_forward(page: Page, tally: dict) -> str:
    """把界面往前推一格（与 `encounter.py` 的驱动逻辑逐条同形，理由见那份的注释）。"""
    if click_first(page, [".molt__confirm"], 460):
        tally["molt"] = tally.get("molt", 0) + 1
        return "molt"
    if click_first(page, [".forge__commit:not([disabled])"], 360):
        tally["forge"] = tally.get("forge", 0) + 1
        return "forge"
    card = page.query_selector(".card--encounter")
    if card is not None:
        phase = card.get_attribute("data-phase")
        if phase == "clash":
            if click_first(
                page, [".cact.is-hot:not([disabled])", '[data-combat="bite:throat"]:not([disabled])']
            ):
                tally["clash"] = tally.get("clash", 0) + 1
                return "clash"
        else:
            if click_first(
                page, [".sact.is-hot:not([disabled])", '[data-stalk="pounce"]:not([disabled])']
            ):
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
        runway = page.evaluate(
            """() => {
              const s = window.__tale.snapshot().state;
              if (!s) return 0;
              return Math.floor(s.hunger / 12) + s.surplusSeasons;
            }"""
        )
        want = "hunt:quick" if runway <= 4 else ("dormant" if runway > 6 else "explore")
        order = {
            # 真追猎排在速猎前面：只有它留食余（速猎不留），而机器玩家死得早
            # 恰恰是因为一直在吃「只顶一季」的那一口 —— 换过来之后同一批种子从三四岁活到十几岁
            "hunt:quick": [
                '[data-action="hunt"]:not([disabled])',
                '[data-action="hunt-quick"]:not([disabled])',
            ],
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


def capture_foe(page: Page, foe_id: str, name: str, shots: list[str], errors: list[str]) -> dict:
    """
    摆一场与指定新兽的遭遇，逐合抄屏直到收束（或打满 14 合）。

    `?organs=` 顺手给两件：让「食之所偏」那一行同时出现「已在手」与「尚未得」两态
    （只有一种状态的话，那一行读起来分不出它到底在说什么）。
    """
    start_life(page, SEED0, foe=foe_id, extra="&organs=gou-chi,ji-zu&essence=60")
    # 降世那一刻先摆的是「降　世」那张旁白卡 —— 遭遇卡在它后面，先按过去
    for _ in range(8):
        if page.query_selector(".card--encounter") is not None:
            break
        if click_first(page, ["[data-continue]:not([disabled])"], 500) is None:
            break
    frames: list[dict] = []
    for round_index in range(14):
        if page.query_selector(".card--encounter") is None:
            break
        view = screen(page)
        frames.append(view)
        if round_index == 0:
            page.screenshot(path=str(OUT / f"foe-{foe_id}-open.png"))
            shots.append(f"foe-{foe_id}-open.png")
        if view["portrait"] and not view["portrait"]["loaded"]:
            errors.append(f"{foe_id} 的头像没加载出来：{view['portrait']['src']}")
        tally: dict[str, int] = {}
        step_forward(page, tally)
    page.screenshot(path=str(OUT / f"foe-{foe_id}-late.png"))
    shots.append(f"foe-{foe_id}-late.png")
    return {"id": foe_id, "name": name, "rounds": len(frames), "frames": frames}


def play_one_life(page: Page, seed: int, shots: list[str]) -> dict:
    """照屏幕金光打完一整世，记下点击账（正本仍是 500 世平衡台，见报告）。"""
    start_life(page, seed)
    tally: dict[str, int] = {}
    encounters = 0
    clashes: list[int] = []
    cur = 0
    last_phase: str | None = None
    seen_foes: set[str] = set()
    for step in range(2200):
        try:
            card = page.query_selector(".card--encounter")
            phase = card.get_attribute("data-phase") if card is not None else None
            if card is not None:
                name = page.query_selector(".combat__name")
                if name is not None:
                    seen_foes.add(name.inner_text())
        except Exception:
            break
        if phase is not None and last_phase is None:
            encounters += 1
        if phase == "clash":
            cur += 1
        if phase is None and last_phase is not None and cur:
            clashes.append(cur)
            cur = 0
        last_phase = phase
        kind = step_forward(page, tally)
        try:
            state = snap(page)
        except Exception:
            break
        if state.get("screen") == "chronicle":
            break
        life = state.get("state")
        if life is not None and not life["alive"] and state["screen"] != "play":
            break
        if kind == "idle" and step > 40:
            break
    if cur:
        clashes.append(cur)
    try:
        page.screenshot(path=str(OUT / "life-chronicle.png"))
        shots.append("life-chronicle.png")
    except Exception:
        pass
    state = snap(page)
    life = state.get("state") or {}
    return {
        "seed": seed,
        "years": life.get("year"),
        "ending": life.get("ending"),
        "clicks": sum(tally.values()),
        "tally": tally,
        "encounters": encounters,
        "clashes": clashes,
        "foesSeen": sorted(seen_foes),
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    shots: list[str] = []
    errors: list[str] = []
    console_errors: list[str] = []
    report: dict = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        page.on(
            "console",
            lambda m: console_errors.append(m.text) if m.type == "error" else None,
        )
        report["samples"] = [
            capture_foe(page, foe_id, name, shots, errors) for foe_id, name in SAMPLES
        ]
        # 机器玩家不是好玩家（多半两三岁饿死／战死），所以跑四个种子取活得最久的那一世
        lives = [play_one_life(page, SEED0 + offset * 7919, shots) for offset in range(4)]
        report["lives"] = lives
        report["life"] = max(lives, key=lambda life: life["clicks"])
        browser.close()

    report["shots"] = shots
    report["portraitErrors"] = errors
    report["consoleErrors"] = console_errors
    (OUT / "bestiary-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    for sample in report["samples"]:
        first = sample["frames"][0] if sample["frames"] else {}
        print(f"[{sample['name']}] {sample['rounds']} 帧　头像 {first.get('portrait', {})}")
        print(f"  破绽：{first.get('weak')}　{first.get('weakTitle')}")
        print(f"  行为段：{[f.get('stage') for f in sample['frames']]}")
        print(f"  食之所偏：{[b['text'] for b in first.get('bias', [])]}")
        for frame in sample["frames"]:
            for line in frame.get("log", [])[-2:]:
                print(f"    日志｜{line}")
    life = report["life"]
    print(f"[实机一世] {life['years']} 岁 · {life['ending']} · 点击 {life['clicks']} · {life['tally']}")
    print(f"  照过面的兽：{'、'.join(life['foesSeen'])}")
    print(f"[头像失败] {len(errors)}　[控制台报错] {len(console_errors)}")
    return 0 if not errors and not console_errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
