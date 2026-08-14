#!/usr/bin/env python3
"""《食灵·列传》S2「探索方向」实机验收。

同 `skills.py`／`combat.py`／`stalk.py` 的办法与理由：断言打在**屏幕上真实显示的字**上，
不是引擎内部值。它回答 S2 交付线的四问：

  1. 探索是否真的变成了「往哪走」的决定？（贴出目的地选择屏 ＋ 据什么做的选择）
  2. 器官／组合解锁一处新去处时，那处读起来是否真的是新世界？
     （抓该地 3 条事件全文，与兽径的对比）
  3. 每个目的地按钮是否都摊开了后果与门槛？（全程逐屏审计，违规计数）
  4. 未开启的去处是否让人想去凑那个条件？（缺什么写成器官名、门槛全列、位置恒定）

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/places.py [输出目录] [起始种子]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:5174/"
VIEWPORT = {"width": 1440, "height": 900}
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/s2").resolve()
SEED0 = int(sys.argv[2] if len(sys.argv) > 2 else 20260814)

# 各处的门槛（`?organs=` 是 dev 专用：只借 id 与 tag，不叠 statMods）
GATES = {
    "dest-xian-feng": ["ji-zu"],
    "dest-gu-ci": ["ling-xi"],
    "dest-you-tan": ["lin-jia", "fu-biao"],
    "dest-mi-ku": ["wu-mu", "ye-tong"],
    "dest-jiao-yuan": ["tie-zong"],
}


# 各处**专属**事件的 id（`trigger.destinations` 声明了该处的那些）。
#
# 为什么要这张表：不声明 `actions` 的季候事件（「秋实」「孤影过冬」）在任何一处探索之后都
# 可能撞上 —— 它们**确实**是那一处会看到的东西，但它们不回答「这一处读起来是不是另一个
# 地方」。报告里两者分开列，判据只看专属那一半。
PLACE_POOLS: dict[str, tuple[str, ...]] = {
    "dest-shou-jing": (
        "qiu-explore-spring", "qiu-explore-yinglong", "qiu-explore-mushroom",
        "qiu-explore-fog-woods", "qiu-explore-hermit", "qiu-explore-cicada",
        "qiu-explore-firefly", "qiu-explore-crow-omen", "qiu-explore-empty-nest",
        "qiu-path-worn",
    ),
    "dest-xian-feng": (
        "qiu-explore-baize", "qiu-explore-mulberry", "qiu-explore-stone-forest",
        "qiu-feng-eyrie", "qiu-feng-gap", "qiu-feng-cloud-root",
    ),
    "dest-gu-ci": (
        "qiu-explore-stele", "qiu-explore-altar", "qiu-explore-fox-grave",
        "qiu-ci-incense", "qiu-ci-clay-figure", "qiu-ci-slips",
    ),
    "dest-you-tan": (
        "qiu-explore-waterfall", "qiu-explore-mirror-pool",
        "qiu-tan-sunken", "qiu-tan-scale-drift", "qiu-tan-no-bottom", "qiu-tan-heart-pearl",
    ),
    "dest-mi-ku": (
        "qiu-explore-cave", "qiu-explore-mang-den",
        "qiu-ku-blind-fish", "qiu-ku-stone-teat", "qiu-ku-old-mark", "qiu-ku-earth-marrow",
    ),
    "dest-jiao-yuan": (
        "qiu-explore-thunder-tree", "qiu-explore-yinglong",
        "qiu-yuan-ash-egg", "qiu-yuan-unburnt", "qiu-yuan-great-bones", "qiu-yuan-thunder-marrow",
    ),
}


def snap(page: Page) -> dict:
    """
    读调试快照。

    ⚠️ 必须容忍「读的时候页面正在导航」：`start_life` 会 `goto`，而上一世的循环可能刚好
    在那一刻还在读 —— Playwright 会抛「Execution context was destroyed」。撞上就当这一帧
    读不到（返回空），下一轮自然会重来。这与 `click_first` 容忍句柄失效是同一回事。
    """
    for _ in range(3):
        try:
            return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")
        except Exception:
            page.wait_for_timeout(200)
    return {}


def life_state(page: Page) -> dict | None:
    """当前这一世的 state；在标题屏／择神种屏／列传卷轴上可能是 null。"""
    return snap(page).get("state")


def safe_eval(page: Page, script: str):
    """同 `snap` 的理由：导航中读 DOM 会抛，撞上就当这一帧读不到。"""
    for _ in range(3):
        try:
            return page.evaluate(script)
        except Exception:
            page.wait_for_timeout(200)
    return None


def dest_screen(page: Page) -> dict:
    """把行动面板上玩家真的看得见的字抄下来（三颗行动 ＋ 一排去处）。"""
    return safe_eval(
        page,
        """() => {
          const q = (sel) => document.querySelector(sel);
          const dests = [...document.querySelectorAll('[data-dest]')].map((n) => ({
            id: n.getAttribute('data-dest'),
            name: n.querySelector('.dest__head b')?.textContent ?? '',
            key: n.querySelector('.dest__head kbd')?.textContent ?? '',
            seal: n.querySelector('.dest__seal')?.textContent ?? null,
            mark: n.querySelector('.dest__mark')?.textContent ?? null,
            desc: n.querySelector('.dest__desc')?.textContent ?? '',
            facts: [...n.querySelectorAll('.dest__facts i')].map((f) => f.textContent),
            foe: n.querySelector('.dest__foe')?.textContent ?? null,
            lock: n.querySelector('.dest__lock')?.textContent ?? null,
            peril: [...n.classList].find((c) => c.startsWith('dest--')) ?? '',
            disabled: n.disabled,
          }));
          return {
            caption: q('.dests__title')?.textContent ?? null,
            actions: [...document.querySelectorAll('[data-action]')].map((n) => ({
              id: n.getAttribute('data-action'),
              label: n.querySelector('b span')?.textContent ?? '',
              hint: n.querySelector('.act__text em')?.textContent ?? '',
              disabled: n.disabled,
            })),
            dests,
          };
        }""",
    ) or {"caption": None, "actions": [], "dests": []}


def event_card(page: Page) -> dict | None:
    """事件卡上的全文（标题／正文／每颗抉择的字）。"""
    return safe_eval(
        page,
        """() => {
          const card = document.querySelector('.card--event');
          if (!card) return null;
          return {
            title: card.querySelector('.card__title')?.textContent ?? '',
            body: [...card.querySelectorAll('.card__prose p')].map((p) => p.textContent).join(''),
            choices: [...card.querySelectorAll('.choice')].map((n) => ({
              label: n.querySelector('.choice__label')?.textContent ?? '',
              disabled: n.disabled,
            })),
          };
        }"""
    )


def treasure_overlay(page: Page) -> dict | None:
    """秘藏揭示演出上的字（没在播则 None）。"""
    return safe_eval(
        page,
        """() => {
          const card = document.querySelector('.treasure__card');
          if (!card) return null;
          return {
            kicker: card.querySelector('.treasure__kicker')?.textContent ?? '',
            place: card.querySelector('.treasure__placeName')?.textContent ?? '',
            placeDesc: card.querySelector('.treasure__placeDesc')?.textContent ?? '',
            reveal: card.querySelector('.treasure__reveal')?.textContent ?? '',
            name: card.querySelector('.treasure__name')?.textContent ?? '',
            desc: card.querySelector('.treasure__desc')?.textContent ?? '',
            foot: card.querySelector('.treasure__foot')?.textContent ?? '',
          };
        }"""
    )


def places_codex(page: Page) -> dict:
    """转世屏上的「山川」那一段。"""
    return safe_eval(
        page,
        """() => ({
          caption: document.querySelector('[data-place-count]')?.textContent ?? null,
          rows: [...document.querySelectorAll('[data-place]')].map((n) => ({
            id: n.getAttribute('data-place'),
            name: n.querySelector('.codex__name')?.textContent ?? '',
            gate: n.querySelector('.codex__recipe')?.textContent ?? '',
            been: n.querySelector('.place__been')?.textContent ?? null,
            treasureKnown: n.querySelector('.place__treasure')?.getAttribute('data-treasure') === 'known',
            treasure: n.querySelector('.place__treasure')?.textContent ?? '',
          })),
          html: document.querySelector('.screen--seed')?.innerHTML ?? '',
        })""",
    ) or {"caption": None, "rows": [], "html": ""}


def has(page: Page, selector: str) -> bool:
    """页面上有没有这个元素（导航中读会抛，当作「没有」）。"""
    try:
        return page.query_selector(selector) is not None
    except Exception:
        return False


def click_first(page: Page, selectors: list[str], wait: int = 300) -> bool:
    """点第一个能点的按钮（容忍整屏重建导致的句柄失效，同 skills.py）。"""
    for selector in selectors:
        for _ in range(3):
            try:
                button = page.query_selector(selector)
            except Exception:
                page.wait_for_timeout(160)
                continue
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
    """
    起一世。

    `scenario=0` 关掉 AI 一世一剧本：这份验收要量的是**手写的六个池子**读起来是不是六个
    地方，混进生成事件就说不清了（第一版没关，收上来的四条里有两条是 `gen-*`）。
    """
    grant = f"&organs={','.join(organs)}" if organs else ""
    page.goto(
        f"{BASE}?seed={seed}{'&reset=1' if reset else ''}{grant}&scenario=0",
        wait_until="networkidle",
    )
    page.wait_for_timeout(300)
    page.click("[data-start]")
    page.wait_for_timeout(320)
    page.click("[data-seed]:not([disabled])")
    page.wait_for_timeout(600)


def audit_dests(view: dict, violations: list[dict]) -> None:
    """
    验收第③问：每颗去处按钮是否都摊开了后果与门槛。

    五条判据（与 S1 技能池那一套同形）：
      ① 有地貌；② 写了遇事概率；③ 写了风险档；④ 写了这一季的饱食账；
      ⑤ 置灰的必须说明**缺哪几件器官**（不是「不可行」这种废话）。
    并且置灰时**后果照写** —— 原因不许顶掉后果。
    """
    for dest in view["dests"]:
        facts = "".join(dest["facts"])
        if not dest["desc"].strip():
            violations.append({"id": dest["id"], "why": "没有地貌那一行"})
        if "遇事" not in facts:
            violations.append({"id": dest["id"], "why": f"没写遇事概率：{facts}"})
        if not any(word in facts for word in ("常路", "险地", "绝境")):
            violations.append({"id": dest["id"], "why": f"没写风险档：{facts}"})
        if "耗饱食" not in facts:
            violations.append({"id": dest["id"], "why": f"没写这一季的饱食账：{facts}"})
        if dest["disabled"] and not dest["lock"]:
            violations.append({"id": dest["id"], "why": "置灰却没说为什么"})
        # 置灰的理由分两种，措辞不同、对玩家的下一步也不同：
        #   门槛未达 → 必须写「需 <器官名>」（那是一件可以去做的事）
        #   全局不可行（战斗中／已死／未结算的事件卡）→ 一句就够（此刻做什么都不行）
        global_reasons = ("先了此事", "战事未了", "已　殁", "此刻不可行")
        if dest["lock"] and "需 " not in dest["lock"] and dest["lock"] not in global_reasons:
            violations.append({"id": dest["id"], "why": f"置灰的理由没写清缺什么：{dest['lock']}"})


def step_forward(page: Page, violations: list[dict]) -> str:
    """把界面往前推一格（每回到行动面板就审一次去处按钮）。"""
    if treasure_overlay(page) is not None:
        click_first(page, [".treasure__confirm"], 400)
        return "treasure"
    if has(page, ".synergy__card"):
        click_first(page, [".synergy__confirm"], 400)
        return "synergy"
    if click_first(page, [".molt__confirm"], 500):
        return "molt"
    if has(page, ".card--combat"):
        if click_first(page, [".cact.is-hot:not([disabled])", '[data-combat="bite:throat"]:not([disabled])']):
            return "combat"
    if has(page, ".card--stalk"):
        if click_first(page, [".sact.is-hot:not([disabled])", '[data-stalk="pounce"]:not([disabled])']):
            return "stalk"
    if has(page, ".card--event"):
        # 走 `click_first`（它容忍句柄失效）而不是自己 click：整屏每一步都重建，
        # 直接点拿到的句柄迟早撞上「Element is not attached to the DOM」
        if click_first(page, [".choice:not([disabled])"], 300):
            return "event"
    if click_first(page, ["[data-continue]:not([disabled])"], 900):
        return "continue"
    # 死亡之后还有两屏：列传卷轴（`[data-reincarnate]`）→ 择神种
    if click_first(page, ["[data-reincarnate]:not([disabled])"], 900):
        return "reincarnate"
    return "idle"


def audit_now(page: Page, violations: list[dict]) -> None:
    """
    在**玩家真的能动**的那一帧审一次按钮。

    `busy` 那几帧要跳过：演出播放期间整排按钮都被禁用（防连点），此时「置灰却没说为什么」
    是必然的，而它不是缺陷 —— 那一刻玩家本来就不该点。第一版没跳，收上来 399 条全是这个。
    """
    if not has(page, "[data-dest]"):
        return
    if snap(page).get("busy"):
        return
    audit_dests(dest_screen(page), violations)


def play_one_turn(page: Page, dest_id: str, violations: list[dict]) -> str:
    """
    **一个明理玩家**的一步：饿了就猎，否则去指定那一处探。

    第一版是「只探不猎」，机器玩家两三岁就饿死 —— 于是深处那几个池子一条都收不到，
    秘藏（`minYear` 3〜4）更是一次都撞不上。这不是内容够不到，是驱动脚本自己不会玩
    （P1 那条教训：先怀疑机器玩家）。
    """
    state = life_state(page)
    if state is not None and has(page, "[data-dest]"):
        audit_now(page, violations)
        # 深处的路费是 12（绝境）—— 饿着去等于送死，所以门槛比常路高一档
        floor = 45 if dest_id in ("dest-shou-jing",) else 62
        if state.get("hunger", 100) <= floor:
            if click_first(page, ['[data-action="hunt"]:not([disabled])'], 340):
                return "hunt"
        if click_first(page, [f'[data-dest="{dest_id}"]:not([disabled])'], 340):
            return "explore"
        if click_first(page, ['[data-action="rest"]:not([disabled])'], 340):
            return "rest"
    return step_forward(page, violations)


def explore_at(page: Page, dest_id: str, violations: list[dict]) -> bool:
    """去某一处探一季（若那颗按钮此刻点不了就返回 False）。"""
    if not has(page, "[data-dest]"):
        return False
    audit_now(page, violations)
    return click_first(page, [f'[data-dest="{dest_id}"]:not([disabled])'], 360)


# ===== 问一：探索是不是「往哪走」的决定 =====


def probe_choice_screen(page: Page, seed: int, out: Path, shots: list[str],
                        violations: list[dict]) -> dict:
    """裸 build（只有神种）与全开 build 两张对照 —— 「可去几处」是这道题的题面。"""
    start_life(page, seed)
    bare = dest_screen(page)
    audit_dests(bare, violations)
    page.screenshot(path=str(out / "choose-bare.png"))
    shots.append("choose-bare.png")

    everything = sorted({organ for organs in GATES.values() for organ in organs})
    start_life(page, seed, organs=everything)
    full = dest_screen(page)
    audit_dests(full, violations)
    page.screenshot(path=str(out / "choose-open.png"))
    shots.append("choose-open.png")
    return {"bare": bare, "full": full}


# ===== 问二：那一处读起来是不是新世界 =====


def collect_events(page: Page, seed: int, dest_id: str, organs: list[str], want: int,
                   violations: list[dict], max_turns: int = 170) -> list[dict]:
    """
    在某一处反复探索，把撞上的事件卡全文抄下来。

    只探这一处（不猎不休）：这一问要的是「那一处的池子长什么样」，混进别处的事件就说不清了。
    饿死就换个种子重开，继续在同一处收集。
    """
    seen: dict[str, dict] = {}
    for attempt in range(8):
        start_life(page, seed + attempt * 101, organs=organs)
        just_explored = False
        for _ in range(max_turns):
            if sum(1 for item in seen.values() if item["placeOnly"]) >= want:
                return list(seen.values())
            # **只收刚在目标去处探完那一步撞上的事件**。
            #
            # 第一版收了所有事件卡，于是狩猎事件（这个玩家饿了就猎）与不限行动的季候事件
            # 全混进来了 —— 那份清单没法回答「那一处读起来是不是另一个地方」。
            if just_explored:
                card = event_card(page)
                if card is not None:
                    event_id = snap(page).get("pendingEventId")
                    if event_id and event_id not in seen:
                        seen[event_id] = {
                            "id": event_id,
                            "placeOnly": event_id in PLACE_POOLS.get(dest_id, ()),
                            **card,
                        }
            move = play_one_turn(page, dest_id, violations)
            just_explored = move == "explore"
            if move == "idle":
                break
    return list(seen.values())


# ===== 问四：未开启的那几处 =====


def probe_locked(page: Page, seed: int, out: Path, shots: list[str],
                 violations: list[dict]) -> dict:
    """凑齐门槛的一半 —— 「还差哪一件」才是这道题真正的题面。"""
    start_life(page, seed, organs=["lin-jia"])  # 幽潭要鳞甲＋浮鳔，这里只给一半
    view = dest_screen(page)
    audit_dests(view, violations)
    page.screenshot(path=str(out / "locked-half.png"))
    shots.append("locked-half.png")
    return view


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    shots: list[str] = []
    violations: list[dict] = []
    errors: list[str] = []
    report: dict = {"seed": SEED0}

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: errors.append(str(err)))

        report["q1_choice"] = probe_choice_screen(page, SEED0, OUT, shots, violations)
        report["q4_locked"] = probe_locked(page, SEED0, OUT, shots, violations)

        # 问二：兽径（无门槛）与幽潭（鳞甲＋浮鳔）各收三条事件全文
        report["q2_shoujing"] = collect_events(
            page, SEED0, "dest-shou-jing", [], 4, violations
        )
        report["q2_youtan"] = collect_events(
            page, SEED0, "dest-you-tan", GATES["dest-you-tan"], 4, violations
        )
        report["q2_miku"] = collect_events(
            page, SEED0, "dest-mi-ku", GATES["dest-mi-ku"], 3, violations
        )

        # 秘藏演出：在兽径上一直探，撞上「旧径重踏」（minYear 4）
        treasure: dict | None = None
        for attempt in range(8):
            start_life(page, SEED0 + attempt * 313, organs=[])
            for _ in range(200):
                found = treasure_overlay(page)
                if found is not None:
                    page.wait_for_timeout(800)
                    page.screenshot(path=str(OUT / "treasure-reveal.png"))
                    shots.append("treasure-reveal.png")
                    treasure = found
                    break
                if play_one_turn(page, "dest-shou-jing", violations) == "idle":
                    break
            if treasure:
                break
        report["treasure"] = treasure

        # 山川图鉴：跑到转世屏
        for _ in range(400):
            if has(page, ".screen--seed"):
                break
            play_one_turn(page, "dest-shou-jing", violations)
        if has(page, ".screen--seed"):
            codex = places_codex(page)
            page.screenshot(path=str(OUT / "codex-places.png"), full_page=True)
            shots.append("codex-places.png")
            html = codex.pop("html", "")
            leaked = [
                name
                for name in ("熟径", "云根", "祝简", "渊心珠", "地心髓", "雷髓")
                if name in html and not any(
                    row["treasureKnown"] and name in row["treasure"] for row in codex["rows"]
                )
            ]
            codex["leakedTreasureNames"] = leaked
            report["codex"] = codex

        browser.close()

    report["violations"] = violations
    report["consoleErrors"] = errors
    report["screenshots"] = shots
    (OUT / "places-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"按钮审计违规 {len(violations)} 条 · 控制台报错 {len(errors)} 条 · 截图 {len(shots)} 张")
    print(f"报告：{OUT / 'places-report.json'}")
    for violation in violations[:10]:
        print("  ✗", violation)


if __name__ == "__main__":
    main()
