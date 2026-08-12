#!/usr/bin/env python3
"""《食灵·列传》「每局不同」批次实机验收（2026-08-13）。

与既有三个脚本的分工：`fullLife.py` 验一世能打完、`legibility.py` 验「看得懂」、
`combat.py`／`stalk.py` 验两个战术屏。本脚本**连着玩两局**，回答这一批的三问 ——
每一问的答案都从屏幕上真实显示的字抄出来，不读引擎内部值：

  ① 两局的开局屏是否明显不同，且这个不同在玩的过程中被真的感觉到？
     （降世屏抄天时／出身；过程中抄饱食详情的季耗、行动按钮的得手量、蛰伏阈值、
      追猎屏的起手警觉 —— 这些数会因天时而不同，屏幕上必须对得上）
  ② 四道是否都看得懂、都够得着？（逐条切 tab 抄门槛与详情）
  ③ 死亡屏＋转世屏是否给出了「下一局换条路试试」的具体理由？

顺带盯 P1/P2/「看得懂」各踩过一次的那件事：**新元素不许把按钮挤出屏幕**。每一步量一遍
按钮位置，并在三档窄屏（1280／1024／760）各量一次四道横带与降世屏。

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法：
    python packages/tale-client/e2e/variance.py [输出目录] [种子]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:5174/"
VIEWPORT = {"width": 1440, "height": 900}
NARROW = [(1280, 800), (1024, 768), (760, 900)]
SETTLE_MS = 560
MAX_STEPS = 900

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/variance").resolve()
SEED = int(sys.argv[2] if len(sys.argv) > 2 else 20260813)
WAYS = ["shen", "yaowang", "guishan", "hualing"]


class Shots:
    def __init__(self, page: Page, out: Path) -> None:
        self.page = page
        self.out = out
        self.n = 0
        self.taken: set[str] = set()
        out.mkdir(parents=True, exist_ok=True)
        for stale in [*out.glob("*.png"), *out.glob("variance-report.json")]:
            stale.unlink()

    def shot(self, name: str, settle: bool = True) -> str:
        if settle:
            self.page.wait_for_timeout(SETTLE_MS)
        self.n += 1
        path = self.out / f"{self.n:02d}-{name}.png"
        self.page.screenshot(path=str(path))
        return path.name

    def once(self, name: str, settle: bool = True) -> str | None:
        if name in self.taken:
            return None
        self.taken.add(name)
        return self.shot(name, settle=settle)


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def birth_screen(page: Page) -> dict:
    """降世屏上的字：两条前提（含机制那一行）＋ 四道清单。"""
    return page.evaluate(
        """() => ({
          title: document.querySelector('.card__title')?.textContent.trim() ?? '',
          lines: [...document.querySelectorAll('.card__prose p')].map((n) => n.textContent.trim()),
          omens: [...document.querySelectorAll('.omens__body')].map((n) => ({
            name: n.querySelector('.omens__name')?.textContent.trim() ?? '',
            effect: n.querySelector('.omens__effect')?.textContent.trim() ?? '',
            desc: n.querySelector('.omens__desc')?.textContent.trim() ?? '',
          })),
          omenKinds: [...document.querySelectorAll('.omens__kind')].map((n) => n.textContent.trim()),
        })"""
    )


def ways_band(page: Page) -> dict:
    """状态栏那条四道横带：四颗 tab ＋ 当前展开那条的门槛。"""
    return page.evaluate(
        """() => ({
          tabs: [...document.querySelectorAll('[data-waytab]')].map((n) => ({
            way: n.getAttribute('data-waytab'),
            text: n.textContent.trim(),
            title: n.getAttribute('title') ?? '',
            active: n.classList.contains('is-active'),
            lost: n.getAttribute('data-way-lost') === '1',
          })),
          shown: document.querySelector('.ascend')?.getAttribute('data-way') ?? '',
          scope: document.querySelector('.ascend__zi')?.textContent.trim() ?? '',
          gates: [...document.querySelectorAll('.agate')].map((n) => ({
            zi: n.querySelector('.agate__zi')?.textContent.trim() ?? '',
            num: n.querySelector('.agate__num')?.textContent.trim() ?? '',
            met: n.getAttribute('data-met') === '1',
            title: n.getAttribute('title') ?? '',
          })),
        })"""
    )


def felt_numbers(page: Page) -> dict:
    """**天时在过程中被感觉到**的那几个数 —— 全部从屏幕上抄，不问引擎。"""
    return page.evaluate(
        """() => ({
          when: document.querySelector('.when__main')?.textContent.trim() ?? '',
          hungerTitle: document.querySelector('.hunger')?.getAttribute('title') ?? '',
          actions: [...document.querySelectorAll('[data-action]')].map((n) => ({
            id: n.getAttribute('data-action'),
            hint: n.querySelector('em')?.textContent.trim() ?? '',
          })),
          essTitles: [...document.querySelectorAll('.ess')].map((n) => n.getAttribute('title') ?? ''),
          guide: document.querySelector('.guide__hint')?.textContent.trim() ?? '',
        })"""
    )


def stalk_screen(page: Page) -> dict:
    """追猎屏的四个量（兽潮之年起手警觉更高 —— 这是它被感觉到的地方）。"""
    return page.evaluate(
        """() => ({
          prey: document.querySelector('.stalk__name')?.textContent.trim() ?? '',
          meters: [...document.querySelectorAll('.smeter')].map((n) => n.textContent.trim().replace(/\\s+/g, ' ')),
        })"""
    )


def sheet_text(page: Page) -> dict | None:
    return page.evaluate(
        """() => {
          const sheet = document.querySelector('.dsheet');
          if (!sheet) return null;
          const labels = [...sheet.querySelectorAll('.dsheet__label')].map((n) => n.textContent.trim());
          const texts = [...sheet.querySelectorAll('.dsheet__text')].map((n) => n.textContent.trim());
          return {
            key: sheet.getAttribute('data-detail-open'),
            title: sheet.querySelector('.dsheet__title')?.textContent.trim() ?? '',
            lede: sheet.querySelector('.dsheet__lede')?.textContent.trim() ?? '',
            rows: labels.map((label, i) => `${label}：${texts[i] ?? ''}`),
            foot: sheet.querySelector('.dsheet__foot')?.textContent.trim() ?? '',
          };
        }"""
    )


def layout_check(page: Page) -> dict:
    return page.evaluate(
        """() => {
          const vw = window.innerWidth, vh = window.innerHeight;
          const sheet = document.querySelector('.dsheet');
          const sr = sheet ? sheet.getBoundingClientRect() : null;
          const targets = [...document.querySelectorAll('[data-action], [data-choice], [data-stalk], [data-combat], [data-continue], [data-waytab], [data-seed], [data-reincarnate]')];
          const offscreen = [], covered = [];
          for (const n of targets) {
            const r = n.getBoundingClientRect();
            const id = n.getAttribute('data-action') || n.getAttribute('data-choice')
                     || n.getAttribute('data-stalk') || n.getAttribute('data-combat')
                     || n.getAttribute('data-waytab') || n.getAttribute('data-seed') || 'continue';
            if (r.width === 0 || r.height === 0) continue;
            if (r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1) {
              offscreen.push({ id, top: Math.round(r.top), bottom: Math.round(r.bottom) });
            }
            if (sr && !(r.right < sr.left || r.left > sr.right || r.bottom < sr.top || r.top > sr.bottom)) {
              covered.push(id);
            }
          }
          const doc = document.documentElement;
          /*
           * [2026-08-13] 卡片内容溢出 —— 这一批实机撞到的那类事故：降世屏的前提块把
           * `.card__body` 的内容顶到 652px 而它只有 476px，屏幕上看得见下面那一段被裁掉半行。
           * 按钮位置量不出这件事（按钮在卡片外面），所以单列一项。
           *
           * 分两类**是有理由的**：降世屏那张卡是这一批加的东西（判失败）；别的卡（长正文 ＋
           * 四个带门槛提示的抉择那种事件卡）在这一批之前就会溢出，而这一批把状态栏从 194px
           * 缩到 156px，反而多给了它 38px —— 记录并打印出来，但不算这一批的账。
           */
          const overflowing = [...document.querySelectorAll('.card__body, .dsheet')]
            .filter((n) => n.scrollHeight > n.clientHeight + 2)
            .map((n) => ({
              cls: n.className,
              need: n.scrollHeight,
              have: n.clientHeight,
              birth: n.closest('.card--narration') !== null && document.querySelector('.omens') !== null,
            }));
          return {
            offscreen,
            covered,
            cardOverflow: overflowing,
            bodyScrollX: doc.scrollWidth > doc.clientWidth,
            statusBarHeight: Math.round(document.querySelector('.statusbar')?.getBoundingClientRect().height ?? 0),
            waysHeight: Math.round(document.querySelector('.ways')?.getBoundingClientRect().height ?? 0),
          };
        }"""
    )


def narrow_sweep(page: Page, shots: Shots, tag: str) -> list[dict]:
    """三档窄屏各量一次（前三批各犯过一次「新元素把按钮挤出屏幕」）。

    ## 判据分两种，因为两种版式对「在屏幕上」的承诺不同
    - **宽屏（>1080）三栏版式**：承诺一屏放得下 → 任何按钮落到 fold 以下就是事故。
    - **窄屏（≤1080）单列版式**：从 M0 起就是**纵向滚动页**（status／guide／stage／rail／acts
      竖着堆），按钮在 fold 以下是版式本身的意思。这里要守的是**滚过去就摸得到**：
      不许横向滚、不许被别的元素压住、`scrollIntoView` 之后必须整颗在视口里。
      只把「初始 fold 以下」当事故会得到一个永远红的检查，而永远红的检查等于没有检查。
    """
    rows = []
    for width, height in NARROW:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(260)
        before = layout_check(page)
        # 像玩家那样滚到行动面板，再量一次「摸得到吗」
        reach = page.evaluate(
            """() => {
              const acts = [...document.querySelectorAll('[data-action]')];
              if (acts.length === 0) return { scrolled: false, offscreenAfterScroll: [] };
              acts[0].scrollIntoView({ block: 'center' });
              const vh = window.innerHeight, vw = window.innerWidth;
              const bad = [];
              for (const n of acts) {
                const r = n.getBoundingClientRect();
                if (r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1) {
                  bad.push({ id: n.getAttribute('data-action'), top: Math.round(r.top), bottom: Math.round(r.bottom) });
                }
                // 被 overflow 裁掉（不是「在下面」而是「够不着」）
                const clipped = n.offsetParent === null;
                if (clipped) bad.push({ id: n.getAttribute('data-action'), clipped: true });
              }
              return { scrolled: true, offscreenAfterScroll: bad, docHeight: document.documentElement.scrollHeight };
            }"""
        )
        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(120)
        single_column = width <= 1080
        rows.append(
            {
                "viewport": f"{width}x{height}",
                "singleColumn": single_column,
                # 单列版式下「初始 fold 以下」是版式的意思，不是事故 —— 只记不判
                "belowFoldInitially": before["offscreen"] if single_column else [],
                "offscreen": [] if single_column else before["offscreen"],
                "offscreenAfterScroll": reach["offscreenAfterScroll"],
                "covered": before["covered"],
                "cardOverflow": before["cardOverflow"],
                "bodyScrollX": before["bodyScrollX"],
                "statusBarHeight": before["statusBarHeight"],
                "waysHeight": before["waysHeight"],
                "docHeight": reach.get("docHeight"),
            }
        )
        shots.shot(f"narrow-{tag}-{width}")
    page.set_viewport_size(VIEWPORT)
    page.wait_for_timeout(260)
    return rows


def tour_ways(page: Page, shots: Shots, tag: str) -> list[dict]:
    """四条道逐个切 tab ＋ 点开详情 —— 验收第二问的正主。"""
    rows = []
    for way in WAYS:
        tab = page.query_selector(f'[data-waytab="{way}"]')
        if tab is None:
            continue
        tab.click()
        page.wait_for_timeout(180)
        band = ways_band(page)
        page.click(f'[data-detail="way:{way}"]')
        page.wait_for_timeout(200)
        sheet = sheet_text(page)
        layout = layout_check(page)
        shot = shots.shot(f"way-{tag}-{way}")
        page.click(f'[data-detail="way:{way}"]')
        page.wait_for_timeout(140)
        rows.append({"way": way, "band": band, "sheet": sheet, "layout": layout, "shot": shot})
    return rows


def pick_choice(page: Page, index: int) -> None:
    idxs = page.eval_on_selector_all(
        ".choice:not([disabled])", "ns => ns.map((n) => n.getAttribute('data-choice'))"
    )
    if not idxs:
        raise RuntimeError("事件卡上没有可点的抉择（引擎/内容 bug）")
    pick = idxs[0] if index % 3 == 2 else idxs[-1]
    page.click(f'[data-choice="{pick}"]:not([disabled])')


def decide_action(state: dict, page: Page, rest_streak: int) -> str:
    """照屏幕上写的字打（同 legibility.py 的那套：饱食余量厚才拿去探索）。"""
    if page.query_selector('[data-action="dormant"]:not([disabled])'):
        return "dormant"
    flags = state["flags"]
    hurt = "wound" in flags or "sick" in flags
    if state["hunger"] <= 70:
        return "hunt"
    if hurt and rest_streak < 2:
        return "rest"
    return "explore"


def hot_or(page: Page, selector: str, attr: str, fallback: str) -> str:
    hot = page.query_selector(f"{selector}.is-hot:not([disabled])")
    return (hot.get_attribute(attr) or fallback) if hot is not None else fallback


def play_life(page: Page, shots: Shots, tag: str, report: dict) -> dict:
    """从择神种屏开始打完一世，回程停在转世屏（列传卷轴）。"""
    life: dict = {"tag": tag, "felt": [], "layoutIssues": [], "stalks": []}

    page.wait_for_selector("[data-seed]")
    life["seedScreen"] = page.evaluate(
        """() => ({
          caption: document.querySelector('.nextlife__caption')?.textContent.trim() ?? '',
          omens: [...document.querySelectorAll('.nextlife__omen')].map((n) => n.textContent.trim()),
          advice: document.querySelector('[data-advice]')?.textContent.trim() ?? null,
        })"""
    )
    shots.shot(f"{tag}-00-seed-screen")
    page.click("[data-seed]")
    page.wait_for_selector(".statusbar")

    life["birth"] = birth_screen(page)
    life["birthWays"] = ways_band(page)
    shots.shot(f"{tag}-01-birth")
    life["narrowBirth"] = narrow_sweep(page, shots, f"{tag}-birth")

    turns = 0
    rest_streak = 0
    molts = 0
    events = 0
    toured = False

    for _ in range(MAX_STEPS):
        issues = layout_check(page)
        birth_overflow = [row for row in issues["cardOverflow"] if row["birth"]]
        if issues["offscreen"] or issues["covered"] or issues["bodyScrollX"] or birth_overflow:
            life["layoutIssues"].append({"turn": turns, "center": snap(page)["center"], **issues})

        if page.query_selector(".molt__card"):
            page.wait_for_timeout(2400)
            molts += 1
            shots.once(f"{tag}-molt")
            page.click(".molt__confirm")
            page.wait_for_timeout(300)
            continue

        state = snap(page)
        if state["screen"] != "play":
            break
        body = state["state"]

        if page.query_selector("[data-continue]:not([disabled])"):
            if not body["alive"]:
                life["lastWordsScreen"] = page.evaluate(
                    """() => [...document.querySelectorAll('.card__prose p')].map((n) => n.textContent.trim())"""
                )
                shots.shot(f"{tag}-90-last-words")
                page.click("[data-continue]")
                page.wait_for_selector(".cine--death, .cine--ascend", timeout=8000)
                page.wait_for_timeout(2900)
                life["deathScreen"] = page.evaluate(
                    """() => ({
                      label: document.querySelector('.cine')?.getAttribute('aria-label') ?? '',
                      lines: [...document.querySelectorAll('.cine__line')].map((n) => n.textContent.trim()),
                    })"""
                )
                shots.shot(f"{tag}-91-death", settle=False)
                page.wait_for_selector("[data-reincarnate]", timeout=15000)
                break
            page.click("[data-continue]")
            page.wait_for_timeout(200)
            continue

        if state["center"] == "stalk":
            if len(life["stalks"]) < 2:
                life["stalks"].append({"turn": turns, **stalk_screen(page)})
                shots.once(f"{tag}-stalk")
            page.click(f'[data-stalk="{hot_or(page, ".sact", "data-stalk", "pounce")}"]')
            page.wait_for_timeout(180)
            continue

        if state["center"] == "combat":
            shots.once(f"{tag}-combat")
            page.click(f'[data-combat="{hot_or(page, ".cact", "data-combat", "bite:throat")}"]')
            page.wait_for_timeout(180)
            continue

        if state["center"] == "event":
            if body.get("skyId") and state["pendingEventId"]:
                life.setdefault("events", []).append(state["pendingEventId"])
            shots.once(f"{tag}-event")
            pick_choice(page, events)
            events += 1
            page.wait_for_timeout(200)
            continue

        # 四道巡览放在第二个回合（此时横带、详情、按钮都在，且还没被事件卡占住舞台）
        if not toured and turns == 2:
            toured = True
            life["waysTour"] = tour_ways(page, shots, tag)
            life["narrowWays"] = narrow_sweep(page, shots, f"{tag}-ways")
            continue

        turns += 1
        if turns <= 4 or turns % 8 == 0:
            life["felt"].append({"turn": turns, **felt_numbers(page)})
            if turns == 1:
                # 饱食详情：季耗那一行必须写这一世**真的**扣多少（大旱年 −15）
                page.click('[data-detail="hunger"]')
                page.wait_for_timeout(200)
                life["hungerSheet"] = sheet_text(page)
                shots.shot(f"{tag}-02-hunger-detail")
                page.click('[data-detail="hunger"]')
                page.wait_for_timeout(140)
        action = decide_action(body, page, rest_streak)
        rest_streak = rest_streak + 1 if action == "rest" else 0
        target = page.query_selector(f'[data-action="{action}"]:not([disabled])')
        if target is None:
            target = page.query_selector("[data-action]:not([disabled])")
            if target is None:
                break
        target.click()
        page.wait_for_timeout(180)

    page.wait_for_selector("[data-reincarnate]", timeout=20000)
    life["chronicle"] = page.evaluate(
        """() => ({
          title: document.querySelector('.scroll__title')?.textContent.trim() ?? '',
          meta: document.querySelector('.scroll__meta')?.textContent.trim() ?? '',
          opening: document.querySelector('.scroll__opening')?.textContent.trim() ?? '',
          closing: document.querySelector('.scroll__closing')?.textContent.trim() ?? '',
          praise: document.querySelector('.scroll__praise')?.textContent.trim() ?? '',
          gain: document.querySelector('.chronicle__gain')?.textContent.trim() ?? '',
          gap: document.querySelector('.chronicle__gap')?.textContent.trim() ?? '',
          all: document.querySelector('.screen--chronicle')?.innerText.replace(/\\n{2,}/g, '\\n') ?? '',
        })"""
    )
    shots.shot(f"{tag}-99-chronicle")
    final = snap(page)
    entry = final["bloodline"]["chronicle"][-1]
    life["summary"] = {
        "ending": entry["ending"],
        "years": entry["years"],
        "organCount": entry["organCount"],
        "turns": turns,
        "molts": molts,
        "events": events,
        "skyId": final["state"]["skyId"] if final["state"] else None,
        "originId": final["state"]["originId"] if final["state"] else None,
        "livesTaken": final["state"]["livesTaken"] if final["state"] else None,
        "wayAchieved": final["state"]["wayAchieved"] if final["state"] else None,
    }
    report["lives"].append(life)
    return life


def main() -> int:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        shots = Shots(page, OUT)
        report: dict = {"seed": SEED, "lives": []}

        page.goto(f"{BASE}?seed={SEED}&reset=1", wait_until="load")
        page.wait_for_selector("[data-start]")
        shots.shot("title")
        page.click("[data-start]")

        first = play_life(page, shots, "life1", report)
        # 转世：同一 baseSeed 下第二世换个种子数 → 天时／出身重掷
        page.click("[data-reincarnate]")
        second = play_life(page, shots, "life2", report)

        report["consoleErrors"] = errors
        report["twoLivesDiffer"] = {
            "sky": first["summary"]["skyId"] != second["summary"]["skyId"],
            "origin": first["summary"]["originId"] != second["summary"]["originId"],
            "birthOmens": [
                [omen["name"] for omen in first["birth"]["omens"]],
                [omen["name"] for omen in second["birth"]["omens"]],
            ],
        }
        (OUT / "variance-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        issues = sum(len(life["layoutIssues"]) for life in report["lives"])
        narrow_bad = [
            row
            for life in report["lives"]
            for key in ("narrowBirth", "narrowWays")
            for row in life.get(key, [])
            if row["offscreen"]
            or row["bodyScrollX"]
            or row["offscreenAfterScroll"]
            or row["covered"]
            or [item for item in row["cardOverflow"] if item["birth"]]
        ]
        print(f"[variance] seed={SEED} 截图 {shots.n} 张 → {OUT}")
        for life in report["lives"]:
            s = life["summary"]
            print(
                f"  {life['tag']}: {s['skyId']} / {s['originId']} → {s['ending']}"
                f"（{s['years']} 岁 · 器官 {s['organCount']} · 夺命 {s['livesTaken']}"
                f" · 成道 {s['wayAchieved']}）"
            )
        print(f"  两局天时不同：{report['twoLivesDiffer']['sky']}　出身不同：{report['twoLivesDiffer']['origin']}")
        # 既有的（非降世屏）卡片溢出单独打印：不算这一批的账，但每次都摆出来
        legacy = [
            item
            for life in report["lives"]
            for row in life["layoutIssues"]
            for item in row["cardOverflow"]
            if not item["birth"]
        ] + [
            item
            for life in report["lives"]
            for key in ("narrowBirth", "narrowWays")
            for row in life.get(key, [])
            for item in row["cardOverflow"]
            if not item["birth"]
        ]
        print(f"  排版问题 {issues} 条　窄屏问题 {len(narrow_bad)} 条　控制台错误 {len(errors)} 条")
        if legacy:
            worst = max(legacy, key=lambda item: item["need"] - item["have"])
            print(
                f"  ⚠️ 既有（非本批）卡片溢出 {len(legacy)} 处，最大 {worst['need'] - worst['have']}px"
                f"（{worst['need']}／{worst['have']}）—— 长正文 ＋ 四抉择那种事件卡，与这一批无关"
            )
        browser.close()
        return 0 if not narrow_bad and issues == 0 and not errors else 1


if __name__ == "__main__":
    sys.exit(main())
