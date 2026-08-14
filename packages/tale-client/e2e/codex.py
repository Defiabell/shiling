#!/usr/bin/env python3
"""《食灵·列传》S3「血统元进度」实机验收 —— 连玩三世。

同 `skills.py`／`places.py` 的办法与理由：断言打在**屏幕上真实显示的字**上，不是引擎内部值。
它回答 S3 交付线的四问：

  1. 第三世开始，玩家能否说出「我这一世要去凑什么」？（贴转世屏建议 ＋ 图鉴总览）
  2. 血统点是否再也不会无处可花？（三世的收支表：产出／花掉／剩余／当时买得起什么）
  3. 「图鉴知识」是否真的改变了追猎／搏杀屏上看到的信息？
     （同一颗种子、同一头猎物，已识与未识两张对照截图）
  4. 未发现的内容是否守住了不泄露？（图鉴三录的「？」行 ＋ 全页 DOM 搜名字）

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/codex.py [输出目录] [起始种子]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:5174/"
VIEWPORT = {"width": 1440, "height": 900}
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
OUT = Path(ARGS[0] if len(ARGS) > 0 else "screenshots/s3").resolve()
SEED0 = int(ARGS[1] if len(ARGS) > 1 else 20260815)


# ===== 只读探针 =====


def snap(page: Page) -> dict:
    return page.evaluate("() => window.__tale.snapshot()")


def life_state(page: Page) -> dict | None:
    return page.evaluate(
        """() => {
          const s = window.__tale.snapshot().state;
          if (!s) return null;
          return {
            alive: s.alive, year: s.year, ending: s.ending, hunger: s.hunger,
            essence: s.essence,
            organIds: s.organIds, metEnemyIds: s.metEnemyIds,
            visited: s.visitedDestinationIds, lore: s.loreEnemyIds,
            charted: s.chartedDestinationId,
          };
        }"""
    )


def bloodline(page: Page) -> dict:
    return page.evaluate("() => window.__tale.snapshot().bloodline")


def seed_screen(page: Page) -> dict:
    """转世屏（＝血统四事 ＋ 图鉴四录 ＋ 「这一世凑什么」）上的全部字。"""
    return page.evaluate(
        """() => {
          const q = (sel) => document.querySelector(sel);
          const txt = (sel) => q(sel)?.textContent?.trim() ?? null;
          const rows = (sel) => [...document.querySelectorAll(sel)];
          const shelf = (attr) => rows('.boon__row').map((n) => ({
            name: n.querySelector('.boon__name')?.textContent ?? '',
            meta: n.querySelector('.boon__meta')?.textContent ?? '',
            button: n.querySelector('.boon__buy')?.textContent ?? '',
            id: n.querySelector(`.boon__buy[${attr}]`)?.getAttribute(attr) ?? null,
            disabled: n.querySelector('.boon__buy')?.disabled ?? true,
          })).filter((r) => r.id !== null);
          return {
            points: txt('[data-points]'),
            summary: txt('[data-codex-summary]'),
            synergyCaption: txt('[data-codex-count]'),
            placeCaption: txt('[data-place-count]'),
            beastCaption: txt('[data-beast-count]'),
            sigilCaption: txt('[data-sigil-count]'),
            loreCaption: txt('[data-lore-count]'),
            advice: txt('[data-advice]'),
            quests: rows('[data-quest]').map((n) => n.textContent.trim()),
            synergyRows: rows('[data-synergy]').map((n) => ({
              id: n.getAttribute('data-synergy'),
              known: n.classList.contains('is-known'),
              name: n.querySelector('.codex__name')?.textContent ?? '',
              recipe: n.querySelector('.codex__recipe')?.textContent ?? '',
            })),
            placeRows: rows('[data-place]').map((n) => ({
              id: n.getAttribute('data-place'),
              name: n.querySelector('.codex__name')?.textContent ?? '',
              gate: n.querySelector('.codex__recipe')?.textContent ?? '',
              treasure: n.querySelector('[data-treasure]')?.getAttribute('data-treasure'),
            })),
            beastRows: rows('[data-beast]').map((n) => ({
              id: n.getAttribute('data-beast'),
              known: n.classList.contains('is-known'),
              name: n.querySelector('.codex__name')?.textContent ?? '',
              meta: n.querySelector('.codex__recipe')?.textContent ?? '',
            })),
            boons: shelf('data-boon'),
            charts: shelf('data-chart'),
            sigils: shelf('data-sigil'),
            lores: shelf('data-lore'),
            bodyText: document.body.innerText,
          };
        }"""
    )


def stalk_screen(page: Page) -> dict | None:
    return page.evaluate(
        """() => {
          const card = document.querySelector('.card--stalk');
          if (!card) return null;
          const q = (sel) => card.querySelector(sel)?.textContent?.trim() ?? null;
          return {
            prey: q('.stalk__name'),
            badge: q('.stalk__badge'),
            loreBadge: q('.stalk__lore'),
            meters: [...card.querySelectorAll('.smeter')].map((n) => n.textContent.trim()),
            pounce: [...card.querySelectorAll('.sact')].map((n) => n.textContent.trim()),
            wind: q('.stalk__wind'),
          };
        }"""
    )


def combat_screen(page: Page) -> dict | None:
    return page.evaluate(
        """() => {
          const card = document.querySelector('.card--combat');
          if (!card) return null;
          const q = (sel) => card.querySelector(sel)?.textContent?.trim() ?? null;
          return {
            enemy: q('.combat__name'),
            loreBadge: q('.combat__lore'),
            intent: q('.combat__intent-text'),
            intentDetail: q('.combat__intent-detail'),
            intentKind: card.querySelector('[data-intent]')?.getAttribute('data-intent'),
          };
        }"""
    )


def dest_buttons(page: Page) -> list[dict]:
    return page.evaluate(
        """() => [...document.querySelectorAll('[data-dest]')].map((n) => ({
          id: n.getAttribute('data-dest'),
          disabled: n.disabled,
          lock: n.querySelector('.dest__lock')?.textContent ?? null,
          chart: n.querySelector('.dest__chart')?.textContent ?? null,
        }))"""
    )


# ===== 驱动 =====


def click_first(page: Page, selectors: list[str], wait: int = 300) -> bool:
    """点第一个能点的按钮；容忍「元素在点击前被重渲染掉」（同 skills.py 的理由）。"""
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


PLAY_POLICY = """
机器玩家的行动次序（顺序就是优先级）：
  ① 饱食 <45 → 狩猎；② 蛰伏开得了就蛰伏；③ 界面金光那一颗；④ 开得了的最深一处去探；⑤ 兜底
第一版没有①②，三世全部在 1〜2 岁饿死，收支表全是 0 —— 一个连饭都不吃的机器玩家
量不出「血统点够不够花」这一问（那一问的分母是「一世产 3〜8 点」，而饿死的一世产 0〜1）。
"""


def step_forward(page: Page) -> str:
    """把界面往前推一格（演出 → 战术屏 → 事件 → 行动 → 继续）。见 PLAY_POLICY。"""
    if page.query_selector(".synergy__card") is not None:
        click_first(page, [".synergy__confirm"], 420)
        return "synergy"
    if page.query_selector(".treasure__card") is not None:
        click_first(page, [".treasure__confirm"], 420)
        return "treasure"
    if click_first(page, [".molt__confirm"], 480):
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
    # 见 PLAY_POLICY
    state = life_state(page)
    if state is not None:
        # ① 饿着就去猎 —— 这是这游戏唯一的正解，机器玩家不认它就会在两岁前饿死
        #    （第一版脚本没有这一条，三世全部 starve@year 1〜2，收支表因此全是 0）
        if state["hunger"] < 45 and click_first(page, ['[data-action="hunt"]:not([disabled])'], 320):
            return "hunt"
        # ② 精气攒够就蛰伏（蜕器官 → 开门槛 → 才有得凑）
        if click_first(page, ['[data-action="dormant"]:not([disabled])'], 320):
            return "dormant"
    if click_first(page, [".act.is-hot:not([disabled])"], 320):
        return "action"
    # ③ 不饿就去探 —— 恒挑**开得了的最深一处**（那才撞得到新地方、新兽、新秘藏）
    dests = [d for d in dest_buttons(page) if not d["disabled"]]
    if dests and click_first(page, [f'[data-dest="{dests[-1]["id"]}"]:not([disabled])'], 320):
        return "explore"
    if click_first(page, ["[data-action]:not([disabled])"], 320):
        return "action"
    if click_first(page, ["[data-continue]:not([disabled])"], 800):
        return "continue"
    page.wait_for_timeout(260)
    return "idle"


def play_to_death(page: Page, max_turns: int = 1400, stall_limit: int = 60) -> dict:
    """
    照屏幕提示打完一整世，停在列传卷轴。

    `stall_limit` 是**卡死护栏**：`step_forward` 连着 60 次什么都点不到（返回 "idle"）就收工。
    没有它的时候实机撞到过「一屏也点不动、脚本静静空转 1400 轮 ≈ 6 分钟」——
    而输出看起来与「这一世很长」一模一样。空转不该长得像在干活。

    ⚠️ 阈值不能小：死亡收尾**本来就有一段什么也点不到的时间**（墨渍 1.2s ＋ 结局演出 4.4s
    ＝ 5.6s ≈ 21 轮）。第一版把阈值设成 12，于是护栏在**每一次正常死亡的演出中途**就开火，
    `three_lives` 拿着一个还没到卷轴屏的页面去按「转世」，下一世的 `descend` 直接超时 ——
    一个为了防卡死加的东西，自己成了那一批唯一的卡死来源。演出期间也不算 idle
    （`overlayBusy`），60 轮是「演出跑完之后还有 10 秒什么都点不动」才收工。
    """
    last: dict = {}
    stalled = 0
    for _ in range(max_turns):
        state = life_state(page)
        if state is not None:
            last = state
        if page.query_selector(".screen--chronicle") is not None:
            return last
        step = step_forward(page)
        overlay_busy = page.evaluate("() => document.querySelector('.app__overlays')?.childElementCount > 0")
        stalled = stalled + 1 if (step == "idle" and not overlay_busy) else 0
        if stalled >= stall_limit:
            last = {**last, "stalled": True, "screen": snap(page)["screen"]}
            return last
    return last


def open_seed_screen(page: Page, seed: int, *, reset: bool, lore: list[str] | None = None) -> None:
    """开到择神种屏（**不**按「承此种降世」—— 那一屏正是这一批要验的东西）。"""
    grant = f"&lore={','.join(lore)}" if lore else ""
    page.goto(f"{BASE}?seed={seed}{'&reset=1' if reset else ''}{grant}", wait_until="domcontentloaded")
    # `networkidle` 在 dev server 上不可靠：HMR 是长连接，AI 生成还会挂在途请求 ——
    # 实机撞到过一次 30s 超时把整个脚本崩在最后一步（前面跑完的结果一并丢了）
    page.wait_for_selector("[data-start], [data-seed]", timeout=15000)
    page.wait_for_timeout(320)
    page.click("[data-start]")
    page.wait_for_timeout(400)


def descend(page: Page) -> None:
    page.click("[data-seed]:not([disabled])")
    page.wait_for_timeout(700)


# ===== 问一＋问二：连玩三世 =====


def buy_all_affordable(page: Page) -> list[dict]:
    """
    把这一屏买得起的都买掉（血脉／图录／印记／知识各一轮），记下每一笔。

    刻意**按四类的顺序各买一次而不是买光**：这更像玩家（每一世都要在四样里挑），
    也让收支表看得出「哪一类这一世买得起」。
    """
    bought: list[dict] = []
    for attr, label in (
        ("data-boon", "血脉"),
        ("data-chart", "图录"),
        ("data-sigil", "世家印记"),
        ("data-lore", "图鉴知识"),
    ):
        before = int(bloodline(page)["points"])
        button = page.query_selector(f".boon__buy[{attr}]:not([disabled])")
        if button is None:
            continue
        text = (button.text_content() or "").strip()
        name = button.evaluate("(n) => n.closest('.boon__row').querySelector('.boon__name').textContent")
        try:
            button.click(timeout=4000)
        except Exception:
            continue
        page.wait_for_timeout(360)
        after = int(bloodline(page)["points"])
        bought.append({"kind": label, "name": name, "button": text, "cost": before - after, "left": after})
    return bought


def three_lives(page: Page, out: Path, shots: list[str]) -> dict:
    """
    连玩三世 —— **全程一个页面会话，不中途重新导航**。

    第一版每一世都 `page.goto(...)` 重开，于是 `TaleApp.lastLife` 每世都被重置成 null，
    转世屏那条「上一世你已有雾目，再得夜瞳即成夜猎之眼」的建议**永远推不出来**
    （它的输入正是上一世的终态）。那不是产品缺陷，是脚本把被测对象打断了 ——
    真玩家按的是「转世」，不是浏览器刷新。
    一次导航定一个 `baseSeed`，三世的种子由 `baseSeed + 世数 × φ` 各自不同（同 `TaleApp`）。
    """
    ledger: list[dict] = []
    screens: list[dict] = []
    open_seed_screen(page, SEED0, reset=True)
    for index in range(3):
        seed = SEED0
        view = seed_screen(page)
        before_points = int(bloodline(page)["points"])
        shot = f"seed-life{index + 1}.png"
        page.screenshot(path=str(out / shot), full_page=True)
        shots.append(shot)
        spent = buy_all_affordable(page)
        after = seed_screen(page)
        screens.append({"life": index + 1, "seed": seed, "before": view, "after": after, "bought": spent})

        descend(page)
        dead = play_to_death(page)
        gained = int(bloodline(page)["points"]) - (before_points - sum(b["cost"] for b in spent))
        ledger.append(
            {
                "life": index + 1,
                "seed": seed,
                "开局血统": before_points,
                "这一世买了": [f'{b["kind"]}·{b["name"]}（−{b["cost"]}）' for b in spent],
                "花掉": sum(b["cost"] for b in spent),
                "这一世产出": gained,
                "收尾血统": int(bloodline(page)["points"]),
                "活到": dead.get("year"),
                "结局": dead.get("ending"),
            }
        )
        click_first(page, ["[data-reincarnate]", "[data-continue]"], 900)
        page.wait_for_timeout(500)

    # 第四次进转世屏 ＝ 「第三世打完之后」的那一屏，也是玩家真正带着积累做决定的一屏
    fourth = seed_screen(page)
    page.screenshot(path=str(out / "seed-after-life3.png"), full_page=True)
    shots.append("seed-after-life3.png")
    return {"ledger": ledger, "screens": screens, "afterLife3": fourth, "bloodline": bloodline(page)}


# ===== 问三：已识 vs 未识的同一头猎物 =====


def lore_contrast(page: Page, out: Path, shots: list[str]) -> dict:
    """
    同一颗种子跑两遍，只差一份「图鉴知识」（`?lore=` 是 dev 专用参数，同 `?organs=`）。

    ## 为什么不让机器玩家自己走过去
    第一版是「降世 → 让 `step_forward` 一路推到第一次追猎」，拿回来的两张图**猎物同一头、
    息数同一格，但属性不同**（体 22 vs 26、德 0 vs −1）—— 两次跑的动作序列被驱动层的
    重渲染/重试搞岔了，于是对照的不再是「同一局的两种信息」，而是两局。
    改成**降世后立刻按狩猎**：零个自由动作，两次跑的引擎状态逐字相同（下面用快照对账），
    屏幕上唯一的差别就只剩这一批要量的那一件事。
    """

    def first_stalk(seed: int, lore: list[str] | None, tag: str | None) -> dict | None:
        open_seed_screen(page, seed, reset=True, lore=lore)
        descend(page)
        # 降世那一屏是一张要按「继续」的旁白卡，所以只点 `[data-continue]` 把它读完 ——
        # **不走 `step_forward`**：那个函数会自己挑行动（探索／休憩），一挑就改了状态，
        # 两次跑立刻分家（第一版就是这么让两张对照图变成两局的：体 22 vs 26、德 0 vs −1）
        view = None
        # 「狩猎」这一季**可能先撞上一桩狩猎事件**（引擎：要么撞上事，要么起追）——
        # 那时按下去看到的是事件卡不是追猎屏。数一下中间点掉了几张事件卡（`detours`）：
        # 只要不是 0，这一局就有过一次抉择，而抉择会改属性 —— 对照就不再是干净的
        # （实测撞到过一次：两次跑的 rngState/距离/警觉全同，灵却差 2）。
        detours = 0
        for _ in range(24):
            if page.query_selector(".card--stalk") is not None:
                view = stalk_screen(page)
                break
            if page.query_selector(".card--event") is not None:
                buttons = page.query_selector_all(".choice:not([disabled])")
                if buttons:
                    detours += 1
                    buttons[-1].click()
                    page.wait_for_timeout(420)
                    continue
            if click_first(page, ['[data-action="hunt"]:not([disabled])'], 700):
                continue
            if not click_first(page, ["[data-continue]:not([disabled])"], 500):
                page.wait_for_timeout(260)
        if view is None:
            return None
        page.wait_for_timeout(260)
        if tag is not None:
            page.screenshot(path=str(out / f"stalk-{tag}.png"))
            shots.append(f"stalk-{tag}.png")
        raw = snap(page)["state"]
        view["detours"] = detours
        view["engine"] = {
            "preyId": raw["stalk"]["preyId"],
            "distance": raw["stalk"]["distance"],
            "alertness": raw["stalk"]["alertness"],
            "stats": raw["stats"],
            "rngState": raw["rngState"],
        }
        return view

    # 先探一个「降世之后第一次狩猎就直接起追」的种子：中间点掉一张事件卡就会改属性，
    # 那时两张对照图上的差别就不只是这一批要量的那一件事了
    seed = None
    for candidate in range(SEED0 + 4242, SEED0 + 4262):
        probe = first_stalk(candidate, None, None)
        if probe is not None and probe["detours"] == 0:
            seed = candidate
            break
    if seed is None:
        return {"ok": False, "why": "二十个种子里没有一个「第一次狩猎直接起追」的"}
    blind = first_stalk(seed, None, "unknown")
    if blind is None:
        return {"ok": False, "why": "没跑到第一次追猎"}
    prey_id = blind["engine"]["preyId"]
    known = first_stalk(seed, [prey_id], "known")

    def first_fight(lore: list[str] | None, tag: str) -> dict | None:
        """搏杀那一半：走遇袭（探索最深处）比走追猎失手可靠得多。"""
        open_seed_screen(page, SEED0 + 909, reset=True, lore=lore)
        descend(page)
        for _ in range(300):
            view = combat_screen(page)
            if view is not None:
                page.wait_for_timeout(260)
                page.screenshot(path=str(out / f"combat-{tag}.png"))
                shots.append(f"combat-{tag}.png")
                raw = snap(page)["state"]
                view["engine"] = {
                    "enemyId": raw["combat"]["enemyId"],
                    "round": raw["combat"]["round"],
                    "guardPart": raw["combat"]["guardPart"],
                    "intentKind": raw["combat"]["intent"]["kind"],
                    "rngState": raw["rngState"],
                }
                return view
            state = life_state(page)
            if state is not None and not state["alive"]:
                return None
            step_forward(page)
        return None

    blind_fight = first_fight(None, "unknown")
    known_fight = (
        first_fight([blind_fight["engine"]["enemyId"]], "known") if blind_fight is not None else None
    )

    # 对照必须是**同一局**：引擎状态逐字相同，唯一的差别才是屏幕上的读数
    same_stalk = (
        known is not None
        and blind["engine"]["preyId"] == known["engine"]["preyId"]
        and blind["engine"]["distance"] == known["engine"]["distance"]
        and blind["engine"]["alertness"] == known["engine"]["alertness"]
        and blind["engine"]["stats"] == known["engine"]["stats"]
        and blind["engine"]["rngState"] == known["engine"]["rngState"]
    )
    same_fight = (
        known_fight is not None
        and blind_fight is not None
        and blind_fight["engine"] == known_fight["engine"]
    )
    return {
        "ok": same_stalk,
        "seed": seed,
        "sameStalkState": same_stalk,
        "sameFightState": same_fight,
        "preyId": prey_id,
        "stalkUnknown": blind,
        "stalkKnown": known,
        "combatUnknown": blind_fight,
        "combatKnown": known_fight,
    }


# ===== 问二的补角：图录货架 =====


def chart_shelf_probe(page: Page, out: Path, shots: list[str]) -> dict:
    """
    图录货架要有货，先得**真的到过**一处有门槛的地方（`chartCost` 对无门槛的恒 0，不上架）。

    机器玩家三世都没凑齐任何一处的门槛（它的死因是饿死，不是不想去），所以这一问用
    `?organs=ji-zu` 直接把疾足塞进去 —— 与 S2 验收「想直接看深处」同一个 dev 参数、
    同一个理由：门槛靠真玩要攒好几年，而这一问量的是**货架与买卖**，不是攒器官。
    """
    page.goto(f"{BASE}?seed={SEED0 + 55}&reset=1&organs=ji-zu", wait_until="domcontentloaded")
    page.wait_for_selector("[data-start], [data-seed]", timeout=15000)
    page.wait_for_timeout(320)
    page.click("[data-start]")
    page.wait_for_timeout(400)
    descend(page)
    # 先去一趟险峰（疾足开的那一处），把「到过」记进图鉴
    visited = False
    for _ in range(80):
        if click_first(page, ['[data-dest="dest-xian-feng"]:not([disabled])'], 400):
            visited = True
            break
        step_forward(page)
    play_to_death(page)
    click_first(page, ["[data-reincarnate]", "[data-continue]"], 900)
    page.wait_for_timeout(500)
    # 一世多半攒不到那 3 点（险峰的图录价）—— 再活几世，这本来就是「跨世积累」该有的样子
    for _ in range(4):
        if page.query_selector('.boon__buy[data-chart]:not([disabled])') is not None:
            break
        descend(page)
        play_to_death(page)
        click_first(page, ["[data-reincarnate]", "[data-continue]"], 900)
        page.wait_for_timeout(500)
    view = seed_screen(page)
    page.screenshot(path=str(out / "chart-shelf.png"), full_page=True)
    shots.append("chart-shelf.png")

    bought = None
    button = page.query_selector('.boon__buy[data-chart]:not([disabled])')
    if button is not None:
        before = int(bloodline(page)["points"])
        button.click()
        page.wait_for_timeout(400)
        bought = {
            "charted": bloodline(page)["chartedDestinationId"],
            "cost": before - int(bloodline(page)["points"]),
            "shelfAfter": seed_screen(page)["charts"],
        }
        # 下一世：那一处的按钮应当可点，且写着「图录在手 —— 此番不必其门」
        descend(page)
        page.wait_for_timeout(500)
        bought["destButtons"] = dest_buttons(page)
        page.screenshot(path=str(out / "chart-in-play.png"), full_page=True)
        shots.append("chart-in-play.png")
    return {"visitedXianFeng": visited, "shelf": view["charts"], "placeCaption": view["placeCaption"], "bought": bought}


# ===== 问四：不泄露 =====


def leak_audit(view: dict, content_names: dict) -> dict:
    """未发现的三录一律「？」，且**整页 innerText 里搜不到它们的名字**。"""
    body = view["bodyText"]
    leaks: list[str] = []
    for row in view["synergyRows"]:
        if row["known"]:
            continue
        if row["name"] != "？" or row["recipe"]:
            leaks.append(f"异变行泄露：{row}")
    for row in view["beastRows"]:
        if row["known"]:
            continue
        if row["name"] != "？" or row["meta"]:
            leaks.append(f"异兽行泄露：{row}")
    known_syn = {r["id"] for r in view["synergyRows"] if r["known"]}
    for sid, name in content_names["synergies"].items():
        if sid not in known_syn and name in body:
            leaks.append(f"未发现的异变名号出现在页面上：{name}")
    known_beast = {r["id"] for r in view["beastRows"] if r["known"]}
    for eid, name in content_names["enemies"].items():
        if eid not in known_beast and name in body:
            leaks.append(f"未照面的异兽名号出现在页面上：{name}")
    for tid, name in content_names["treasures"].items():
        if name in body and f"秘藏 · {name}" not in body:
            leaks.append(f"未得秘藏名号出现在页面上：{name}")
    return {"leaks": leaks, "clean": not leaks}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    shots: list[str] = []
    errors: list[str] = []
    report: dict = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        chart_only = "--chart-only" in sys.argv
        # 每一段各自兜住异常：跑了十几分钟的实机结果不该被后面某一步的超时一并带走
        for key, work in (
            ("threeLives", lambda: three_lives(page, OUT, shots)),
            ("lore", lambda: lore_contrast(page, OUT, shots)),
            ("chart", lambda: chart_shelf_probe(page, OUT, shots)),
        ):
            if chart_only and key != "chart":
                continue
            try:
                report[key] = work()
            except Exception as error:  # noqa: BLE001 —— 这里就是要把任何一段的失败变成一条记录
                report[key] = {"ok": False, "error": repr(error)}
                errors.append(f"{key}: {error!r}")

        # 不泄露：拿第一世那一屏（什么都还没发现）来审，那是最严的一档
        try:
            open_seed_screen(page, SEED0 + 31337, reset=True)
            fresh = seed_screen(page)
            page.screenshot(path=str(OUT / "seed-fresh.png"), full_page=True)
            shots.append("seed-fresh.png")
            names = page.evaluate("() => window.__tale.names()")
            report["freshScreen"] = {k: v for k, v in fresh.items() if k != "bodyText"}
            report["leakAudit"] = leak_audit(fresh, names)
        except Exception as error:  # noqa: BLE001
            report["leakAudit"] = {"clean": False, "leaks": [f"审计本身失败：{error!r}"]}
            errors.append(f"leakAudit: {error!r}")
        browser.close()

    report["consoleErrors"] = errors
    report["screenshots"] = shots
    name = "codex-chart.json" if "--chart-only" in sys.argv else "codex-report.json"
    (OUT / name).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    leaks = report.get("leakAudit", {}).get("leaks", [])
    print(
        json.dumps(
            {
                "screenshots": shots,
                "consoleErrors": len(errors),
                "leaks": leaks,
                "loreOk": report.get("lore", {}).get("ok"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    # 退出码吃「泄露」与「控制台报错」（同 `legibility.py`）——「跑完了」不等于「没查出问题」
    return 0 if not leaks and not errors else 1


if __name__ == "__main__":
    sys.exit(main())
