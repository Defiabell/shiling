#!/usr/bin/env python3
"""《食灵·列传》「一世一剧本」验收 E2E（P2）。

真客户端、真 dev server 中间件、真网关：降世 → 等生成落定 → 把一世打完，
再回答计划里的五问（分不分得出／呼不呼应前提／有没有假抉择／断网能不能玩／重放一不一致）。

与 `fullLife.py` 的分工：那一支验的是「一世打得完、图不 404」；本脚本只盯生成池
—— 撞上了几条生成事件、它们长什么样、注入的时机对不对。

运行前先自己起 dev server（**不要 kill 别人的**，5174 上有就直接用）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/scenario.py [输出目录] [种子A] [种子B]
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

# 端口可覆盖：5174 上常有别人的 dev server，验收时另起一个免得互相打断
BASE = os.environ.get("TALE_BASE", "http://localhost:5174/")
VIEWPORT = {"width": 1440, "height": 900}
MAX_STEPS = 900
# 生成是四批并行，实测 sonnet 一批 70〜102s。等到「不再增长」为止，最多等这么久。
GEN_TIMEOUT_S = 240
SCENARIO_KEY = "shiling.tale.scenario.v1"

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/p2").resolve()
SEED_A = int(sys.argv[2]) if len(sys.argv) > 2 else 20260813
SEED_B = int(sys.argv[3]) if len(sys.argv) > 3 else 20260901


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def store(page: Page) -> dict:
    """localStorage 里的生成包 —— 报告要贴全文，也是「持久化生效」的直接证据。"""
    raw = page.evaluate(f"() => localStorage.getItem({SCENARIO_KEY!r})")
    if not raw:
        return {}
    return {item["cacheKey"]: item for item in json.loads(raw)}


def start_life(page: Page, seed: int, extra: str = "", reset: bool = True) -> str:
    page.goto(f"{BASE}?seed={seed}{'&reset=1' if reset else ''}{extra}", wait_until="load")
    page.wait_for_selector("[data-start]")
    page.click("[data-start]")
    page.wait_for_selector("[data-seed]")
    seed_id = page.get_attribute("[data-seed]", "data-seed") or "?"
    page.click("[data-seed]")
    page.wait_for_selector(".statusbar")
    return seed_id


def wait_for_pack(page: Page, timeout_s: int = GEN_TIMEOUT_S) -> dict:
    """等生成落定：`source` 不再是 pending，或者注入条数连着几秒不涨。"""
    started = time.time()
    last = -1
    stable_since = started
    while time.time() - started < timeout_s:
        info = snap(page)["scenario"]
        if info["injected"] != last:
            last = info["injected"]
            stable_since = time.time()
        if info["source"] in ("ai", "cache", "none") and time.time() - stable_since > 3:
            return info
        page.wait_for_timeout(1500)
    return snap(page)["scenario"]


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


def read_card(page: Page) -> dict:
    """把屏幕上这张事件卡逐字读下来 —— 报告里「玩家看到的」就是它。"""
    return page.evaluate(
        """() => ({
            title: document.querySelector('.card__title')?.textContent?.trim() ?? '',
            body: [...document.querySelectorAll('.card__prose p')].map((p) => p.textContent.trim()),
            choices: [...document.querySelectorAll('[data-choice]')].map((b) => ({
              label: b.querySelector('.choice__label')?.textContent?.trim() ?? b.textContent.trim(),
              enabled: !b.disabled,
            })),
            art: document.querySelector('.card__art img')?.getAttribute('src')?.slice(0, 60) ?? null,
          })"""
    )


def play_out(page: Page, seen: list[dict]) -> dict:
    """把一世打完（策略同 fullLife.py 的谨慎玩家），沿途把生成事件的卡面记下来。"""
    rest_streak = 0
    events = 0
    for _ in range(MAX_STEPS):
        if page.query_selector(".molt__card"):
            # 开奖卷轴要转完那一圈（SPIN_MS）才收得动；期间整张浮层挡着 pointer events，
            # 早点的一下会被 <html> 截走（实测报「intercepts pointer events」）
            page.wait_for_selector(".molt__confirm", timeout=12000)
            page.wait_for_timeout(2600)
            button = page.query_selector(".molt__confirm")
            if button is not None:
                button.click(force=True)
            page.wait_for_timeout(420)
            continue
        state = snap(page)
        if state["screen"] != "play":
            break
        life = state["state"]
        if page.query_selector("[data-continue]:not([disabled])"):
            page.click("[data-continue]")
            if not life["alive"]:
                page.wait_for_selector("[data-reincarnate]", timeout=25000)
                break
            page.wait_for_timeout(180)
            continue
        if state["center"] == "combat":
            hot = page.query_selector("[data-combat].is-hot:not([disabled])")
            page.click(f'[data-combat="{hot.get_attribute("data-combat") if hot else "bite:throat"}"]')
            page.wait_for_timeout(180)
            continue
        if state["center"] == "stalk":
            hot = page.query_selector("[data-stalk].is-hot:not([disabled])") or page.query_selector(
                "[data-stalk]:not([disabled])"
            )
            if hot is None:
                break
            hot.click()
            page.wait_for_timeout(160)
            continue
        if state["center"] == "event":
            events += 1
            event_id = state["pendingEventId"] or "?"
            if event_id.startswith("gen-"):
                seen.append({"id": event_id, "year": life["year"], "season": life["season"], **read_card(page)})
            enabled = page.query_selector_all(".choice:not([disabled])")
            if not enabled:
                raise RuntimeError(f"事件 {event_id} 没有可点的抉择")
            (enabled[0] if events % 3 == 2 else enabled[-1]).click()
            page.wait_for_timeout(200)
            continue
        action = decide_action(life, page, rest_streak)
        rest_streak = rest_streak + 1 if action == "rest" else 0
        target = page.query_selector(f'[data-action="{action}"]:not([disabled])') or page.query_selector(
            "[data-action]:not([disabled])"
        )
        if target is None:
            break
        target.click()
        page.wait_for_timeout(160)

    page.wait_for_selector("[data-reincarnate]", timeout=25000)
    final = snap(page)
    entry = final["bloodline"]["chronicle"][-1]
    return {
        "ending": entry["ending"],
        "years": entry["years"],
        "organCount": entry["organCount"],
        "eventsSeen": events,
        "chronicleSource": final["ai"]["source"],
        "scenario": final["scenario"],
    }


def one_life(page: Page, seed: int, label: str, errors: list[str]) -> dict:
    seed_id = start_life(page, seed)
    born = snap(page)["state"]
    t0 = time.time()
    info = wait_for_pack(page)
    gen_wait_s = round(time.time() - t0, 1)
    packs = store(page)
    page.screenshot(path=str(OUT / f"{label}-birth.png"))
    seen: list[dict] = []
    result = play_out(page, seen)
    page.screenshot(path=str(OUT / f"{label}-chronicle.png"))
    return {
        "label": label,
        "seed": seed,
        "seedId": seed_id,
        "skyId": born["skyId"],
        "originId": born["originId"],
        "genWaitS": gen_wait_s,
        "scenarioAfterGen": info,
        "pack": packs.get(f"{seed}:{seed_id}"),
        "generatedSeen": seen,
        "life": result,
        "consoleErrors": list(errors),
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        report["lifeA"] = one_life(page, SEED_A, "a", errors)
        errors.clear()
        report["lifeB"] = one_life(page, SEED_B, "b", errors)
        errors.clear()

        # ── 重放：同一个种子、清掉血统存档（生成缓存不清）→ 应当命中缓存且逐字一致 ──
        seed_id = start_life(page, SEED_A)
        info = wait_for_pack(page, timeout_s=30)
        replay_pack = store(page).get(f"{SEED_A}:{seed_id}")
        report["replay"] = {
            "scenario": info,
            "identical": replay_pack == report["lifeA"]["pack"],
            "packSize": len(replay_pack["events"]) if replay_pack else 0,
            "consoleErrors": list(errors),
        }
        errors.clear()

        # ── 断网等价物：`?scenario=0`（连请求都不发）→ 一世照常打完 ──
        start_life(page, SEED_B + 7, extra="&scenario=0")
        offline_info = snap(page)["scenario"]
        offline = play_out(page, [])
        page.screenshot(path=str(OUT / "offline-chronicle.png"))
        report["offline"] = {
            "scenario": offline_info,
            "life": offline,
            "consoleErrors": list(errors),
        }
        browser.close()

    (OUT / "scenario-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf8")
    for key in ("lifeA", "lifeB"):
        life = report[key]
        pack = life["pack"] or {"events": []}
        print(
            f"{key}: 种子 {life['seed']} {life['skyId']}/{life['originId']} "
            f"生成 {len(pack['events'])} 条（等了 {life['genWaitS']}s）"
            f" 撞上 {len(life['generatedSeen'])} 条 一世 {life['life']['years']} 岁 {life['life']['ending']}"
        )
    print(f"重放一致：{report['replay']['identical']}　来源 {report['replay']['scenario']['source']}")
    print(f"离线一世：{report['offline']['life']['years']} 岁 {report['offline']['life']['ending']}"
          f"　console error {len(report['offline']['consoleErrors'])}")
    print(f"写入 {OUT / 'scenario-report.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
