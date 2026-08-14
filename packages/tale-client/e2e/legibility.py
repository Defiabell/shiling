#!/usr/bin/env python3
"""《食灵·列传》「看得懂」批次实机验收。

与 `fullLife.py`（把一世打完、验零 404）的分工：本脚本**像一个头一次打开游戏的人那样**
玩第一世，并回答这一批的三问 —— 每一问的答案都从**屏幕上真实显示的字**抄出来，
不读引擎内部值：

  ① 开局三回合内，只看屏幕能不能读出「我该干什么、为什么」？
  ② 点开任一属性／精气／器官，能不能回答「它有啥用」？
  ③ 引导链走完，「吃什么→涨什么→开什么」是否被完整讲明白过一次？

顺带盯一件 P1/P2 各踩过一次的事：**新元素不许把按钮挤出屏幕**。每一张截图前都量一遍
四颗行动按钮与详情浮层的位置，任何一颗越出视口或被浮层压住就记一条 overlap。

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5174 --strictPort

用法（参数顺序同 bestiary.py）：
    python packages/tale-client/e2e/legibility.py [输出目录] [种子] [端口]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

VIEWPORT = {"width": 1440, "height": 900}
SETTLE_MS = 620
MAX_STEPS = 900

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/legibility").resolve()
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 20260812
# 端口可传（同 bestiary.py）：5174 常被别的 session 的 dev server 占着，**不要去杀它**
PORT = sys.argv[3] if len(sys.argv) > 3 else "5174"
BASE = f"http://localhost:{PORT}/"


class Shots:
    def __init__(self, page: Page, out: Path) -> None:
        self.page = page
        self.out = out
        self.n = 0
        self.taken: set[str] = set()
        out.mkdir(parents=True, exist_ok=True)
        # 先清掉上一次的截图：文件名带序号，残留会让两次运行的编号交错（撞过一次，
        # 同一个 09- 前缀出现两张不同内容的图，报告里的引用就对不上了）
        for stale in [*out.glob("*.png"), *out.glob("legibility-report.json")]:
            stale.unlink()

    def shot(self, name: str, settle: bool = True) -> str:
        if settle:
            self.page.wait_for_timeout(SETTLE_MS)
        self.n += 1
        path = self.out / f"{self.n:02d}-{name}.png"
        self.page.screenshot(path=str(path))
        return path.name

    def once(self, name: str, settle: bool = True) -> bool:
        if name in self.taken:
            return False
        self.taken.add(name)
        self.shot(name, settle=settle)
        return True


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def visible_text(page: Page) -> dict:
    """把玩家此刻**看得见的说明文字**抄下来（断言打在这上面）。"""
    return page.evaluate(
        """() => {
          const txt = (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent.trim());
          const acts = [...document.querySelectorAll('[data-action]')].map((n) => ({
            id: n.getAttribute('data-action'),
            label: n.querySelector('b span')?.textContent ?? '',
            hint: n.querySelector('em')?.textContent ?? '',
            disabled: n.disabled,
            hot: n.classList.contains('is-hot'),
          }));
          const guideNode = document.querySelector('.guide');
          return {
            when: document.querySelector('.when__main')?.textContent ?? '',
            gauges: [...document.querySelectorAll('.gauge')].map((n) => ({
              zi: n.querySelector('.gauge__zi')?.textContent ?? '',
              num: n.querySelector('.gauge__num')?.textContent ?? '',
              title: n.getAttribute('title') ?? '',
            })),
            hungerTitle: document.querySelector('.hunger')?.getAttribute('title') ?? '',
            essTitles: [...document.querySelectorAll('.ess')].map((n) => n.getAttribute('title') ?? ''),
            ascend: document.querySelector('.ascend__zi')?.textContent ?? '',
            actions: acts,
            organs: txt('.organ-chip'),
            guide: guideNode
              ? {
                  step: guideNode.querySelector('.guide__step')?.textContent ?? '',
                  text: guideNode.querySelector('.guide__text')?.textContent ?? '',
                  hint: guideNode.querySelector('.guide__hint')?.textContent ?? '',
                  complete: guideNode.classList.contains('is-complete'),
                }
              : None,
          };
        }""".replace("None", "null")
    )


def sheet_text(page: Page) -> dict:
    """详情浮层上的字。"""
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
    """按钮有没有被挤出**可达范围**／被浮层压住（P1/P2 各踩过一次的那件事）。

    [2026-08-14 矮窗口修复] 判据从「在视口里」放宽成「在整壳的可滚范围里」：主界面
    （`.play`）现在自己是滚动容器 —— 中央故事卡按内容排版、谁也不许裁它，纵向预算不够时
    让步的是「一屏放得下」这件事，行动与去处滚一下就够得到（见 `styles/screens.css`
    `.play` 的注释与 `e2e/layout.py` 的视口矩阵）。所以「在折线以下」不再等于「按钮消失」，
    但「滚到底也够不到」「被浮层压住」「横向溢出」仍然是缺陷，判据只收紧不放松。
    """
    return page.evaluate(
        """() => {
          const shell = document.querySelector('.play');
          const vw = window.innerWidth;
          const sheet = document.querySelector('.dsheet');
          const sr = sheet ? sheet.getBoundingClientRect() : null;
          const targets = [...document.querySelectorAll('[data-action], [data-choice], [data-stalk], [data-combat], [data-continue]')];
          const offscreen = [], covered = [];
          // 整壳当前的可滚范围（换算成视口坐标）：往上还能滚 scrollTop、往下还能滚剩余量
          const up = shell ? shell.scrollTop : 0;
          const down = shell ? shell.scrollHeight - shell.clientHeight - shell.scrollTop : 0;
          for (const n of targets) {
            const r = n.getBoundingClientRect();
            const id = n.getAttribute('data-action') || n.getAttribute('data-choice')
                     || n.getAttribute('data-stalk') || n.getAttribute('data-combat') || 'continue';
            if (r.width === 0 || r.height === 0) continue;
            const reachable = r.top >= -up - 1 && r.bottom <= window.innerHeight + down + 1;
            if (!reachable || r.right > vw + 1 || r.left < -1) {
              offscreen.push({ id, top: Math.round(r.top), bottom: Math.round(r.bottom) });
            }
            if (sr && !(r.right < sr.left || r.left > sr.right || r.bottom < sr.top || r.top > sr.bottom)) {
              covered.push(id);
            }
          }
          const doc = document.documentElement;
          return {
            offscreen,
            covered,
            bodyScrollX: doc.scrollWidth > doc.clientWidth,
            shellScrollX: shell ? shell.scrollWidth > shell.clientWidth + 1 : false,
            shellScroll: shell ? { top: Math.round(shell.scrollTop), h: shell.scrollHeight, client: shell.clientHeight } : null,
          };
        }"""
    )


# 「登神之路」刻意**不在**这一批里：引导链第四步就是「点开顶上那条登神之路」，
# 提前点掉会让那一步在玩家看到之前就已达成（实机撞到过：链条从第三步直接跳到收尾）。
# 它由主循环在第四步亮起时才点，那才是真实的玩家动线。
DETAIL_TARGETS = [
    ("stat:meng", "属性·猛"),
    ("stat:ling", "属性·灵"),
    ("stat:ti", "属性·体"),
    ("stat:de", "属性·德"),
    ("hunger", "饱食"),
    ("essence:zu", "精气·足"),
]


def open_one_detail(page: Page, shots: Shots, key: str, shot_name: str) -> dict:
    """点开一处详情 → 抄字 ＋ 量排版 ＋ 截图 → 再点一次确认收得回去。

    **每次都按选择器重新查**：主界面每回合整棵重建（`renderPlay` 后 `replaceChildren`），
    握着上一次的 ElementHandle 第二次点就是「not attached to the DOM」。
    """
    selector = f'[data-detail="{key}"]'
    page.click(selector)
    page.wait_for_timeout(220)
    text = sheet_text(page)
    layout = layout_check(page)
    shot = shots.shot(shot_name)
    # 再点一次同一处＝收起（浮层不该赖在屏幕上）
    page.click(selector)
    page.wait_for_timeout(160)
    closed = sheet_text(page) is None
    return {"key": key, "shot": shot, "sheet": text, "layout": layout, "togglesClosed": closed}


def open_details(page: Page, shots: Shots, tag: str, report: dict) -> None:
    for key, label in DETAIL_TARGETS:
        if page.query_selector(f'[data-detail="{key}"]') is None:
            continue
        entry = open_one_detail(page, shots, key, f"detail-{tag}-{key.replace(':', '-')}")
        report["details"].append({"label": label, **entry})


def open_organ_details(page: Page, shots: Shots, report: dict, tag: str) -> None:
    """器官 chip 逐个点开 —— 这是「进化有啥好处」的正主。"""
    keys = page.eval_on_selector_all(
        "[data-detail^='organ:']", "ns => ns.map((n) => n.getAttribute('data-detail'))"
    )
    for key in keys:
        organ_id = key.split(":", 1)[1]
        report["organs"].append(open_one_detail(page, shots, key, f"detail-organ-{tag}-{organ_id}"))


def pick_choice(page: Page, event_index: int) -> None:
    """同 fullLife.py：谨慎玩家点末条，每第三个事件点首条（让贪心分支也进验证）。"""
    idxs = page.eval_on_selector_all(
        ".choice:not([disabled])", "ns => ns.map((n) => n.getAttribute('data-choice'))"
    )
    if not idxs:
        raise RuntimeError("事件卡上没有可点的抉择（引擎/内容 bug）")
    pick = idxs[0] if event_index % 3 == 2 else idxs[-1]
    # 按选择器点而不是握句柄：引导链收尾会就地摘掉 .guide 节点，句柄可能已失效
    page.click(f'[data-choice="{pick}"]:not([disabled])')


def decide_action(state: dict, page: Page, rest_streak: int) -> str:
    """**照屏幕上写的字打**的玩家 —— 这一批要验的正是「读了屏幕就知道该干什么」。

    界面现在明写着：每季 −12（冬 −18）、追猎得手 +30、休憩 +14、蛰伏占一季。
    照这几个数推出来的策略就是下面这四行：饿到一次得手都填不满就去猎（追猎会失手，
    所以不能等到只剩一季的余量）、有病歇一季、余量厚才拿去探索（抉择才长灵与德）。
    `fullLife.py` 那份策略（≤50 才猎）是在这些数还没写在屏幕上时定的，实测四岁饿死。
    """
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
    """按屏幕上发金光的那颗打（追猎与搏杀的推荐链就是界面自己的说明书）。"""
    hot = page.query_selector(f"{selector}.is-hot:not([disabled])")
    if hot is not None:
        return hot.get_attribute(attr) or fallback
    return fallback


def play(page: Page, shots: Shots) -> dict:
    report: dict = {
        "seed": SEED,
        "firstThreeTurns": [],
        "details": [],
        "organs": [],
        "guideTrace": [],
        "layoutIssues": [],
        "consoleErrors": [],
    }

    page.goto(f"{BASE}?seed={SEED}&reset=1", wait_until="load")
    page.wait_for_selector("[data-start]")
    shots.once("title")
    page.click("[data-start]")
    page.wait_for_selector("[data-seed]")
    page.click("[data-seed]")
    page.wait_for_selector(".statusbar")
    shots.once("birth-guide-step1")

    # ── ①：开局三回合，只看屏幕能读出什么 ──
    report["firstThreeTurns"].append({"phase": "birth", "screen": visible_text(page), "layout": layout_check(page)})

    # ── ②：逐处点开详情（开局这一刻，玩家手上只有神种一枚器官）──
    open_details(page, shots, "t0", report)
    open_organ_details(page, shots, report, "t0")

    events_seen: list[str] = []
    turns = 0
    rest_streak = 0
    molts = 0
    guide_seen: list[str] = []
    organ_detail_after_molt = False
    ascend_opened = False

    def note_guide() -> None:
        vt = visible_text(page)
        guide = vt.get("guide")
        if not guide:
            return
        stamp = f"{guide['step']}|{guide['text']}"
        if stamp in guide_seen:
            return
        guide_seen.append(stamp)
        report["guideTrace"].append(
            {"turn": turns, "when": vt["when"], **guide, "shot": shots.shot(f"guide-{len(guide_seen)}")}
        )

    note_guide()

    for _ in range(MAX_STEPS):
        issues = layout_check(page)
        if issues["offscreen"] or issues["covered"] or issues["bodyScrollX"] or issues["shellScrollX"]:
            report["layoutIssues"].append({"turn": turns, "center": snap(page)["center"], **issues})

        if page.query_selector(".molt__card"):
            page.wait_for_timeout(2400)
            molts += 1
            shots.once("molt-reveal")
            page.click(".molt__confirm")
            page.wait_for_timeout(320)
            continue

        state = snap(page)
        if state["screen"] != "play":
            break
        life = state["state"]
        note_guide()

        # 蜕出第一枚器官之后，回头再点一次器官详情：那时「解开的抉择」才有真内容
        if molts > 0 and not organ_detail_after_molt and state["center"] == "narration":
            organ_detail_after_molt = True
            open_organ_details(page, shots, report, "molted")
            open_details(page, shots, "molted", report)

        if page.query_selector("[data-continue]:not([disabled])"):
            if not life["alive"]:
                shots.once("last-words")
                page.click("[data-continue]")
                page.wait_for_selector(".cine--death, .cine--ascend", timeout=8000)
                page.wait_for_timeout(2900)
                shots.once("death", settle=False)
                page.wait_for_selector("[data-reincarnate]", timeout=15000)
                break
            page.click("[data-continue]")
            page.wait_for_timeout(200)
            continue

        # 「登神之路」详情什么时候点：要么引导链第四步正叫你点它（那一步的达成判据就是这次
        # 点击），要么链条已经自己走完（此时点它不会再抢掉任何一步）。刻意不在开局点 ——
        # 实机撞到过：提前点掉会让第四步在玩家看到之前就达成，链条从第三步直接跳到收尾。
        if not ascend_opened and state["center"] == "narration":
            guide_now = visible_text(page).get("guide")
            asked = bool(guide_now) and "登神之路" in guide_now.get("text", "")
            done = guide_now is None or bool(guide_now.get("complete"))
            if asked or done:
                ascend_opened = True
                report["details"].append(
                    {"label": "登神之路", **open_one_detail(page, shots, "ascend", "detail-guide-ascend")}
                )
                note_guide()
                continue

        # [2026-08-14] 快照里追猎与搏杀是**同一个** kind（`encounter`），分不分得开看屏上是哪排按钮。
        # 这两支原先写的是 `center == "stalk"`／`"combat"` —— 自遭遇合并成一个 kind 起就再也没进过，
        # 于是脚本每次撞到遭遇都会走到「行动全灰 → 没有可点的目标 → break」，最后卡在等转世按钮
        # 上超时（跑一次要五分钟才发现）。修的是脚本，不是界面。
        if state["center"] == "encounter":
            if page.query_selector("[data-stalk]"):
                shots.once("stalk-fullscreen")
                page.click(f'[data-stalk="{hot_or(page, ".sact", "data-stalk", "pounce")}"]')
            else:
                shots.once("combat-fullscreen")
                page.click(f'[data-combat="{hot_or(page, ".cact", "data-combat", "bite:throat")}"]')
            page.wait_for_timeout(200)
            continue

        if state["center"] == "event":
            events_seen.append(state["pendingEventId"] or "?")
            if page.query_selector(".choice.is-locked"):
                shots.once("event-gated")
            if page.query_selector(".req.is-met"):
                shots.once("event-organ-gate-met")
            shots.once("event")
            pick_choice(page, len(events_seen) - 1)
            page.wait_for_timeout(220)
            continue

        turns += 1
        if turns <= 3:
            report["firstThreeTurns"].append(
                {"phase": f"turn{turns}", "screen": visible_text(page), "layout": layout_check(page)}
            )
        action = decide_action(life, page, rest_streak)
        rest_streak = rest_streak + 1 if action == "rest" else 0
        target = page.query_selector(f'[data-action="{action}"]:not([disabled])')
        if target is None:
            target = page.query_selector("[data-action]:not([disabled])")
            if target is None:
                break
        if action == "dormant":
            shots.once("dormant-preview")
        target.click()
        page.wait_for_timeout(200)

    page.wait_for_selector("[data-reincarnate]", timeout=20000)
    shots.once("chronicle")
    final = snap(page)
    entry = final["bloodline"]["chronicle"][-1]
    report["life"] = {
        "ending": entry["ending"],
        "years": entry["years"],
        "organCount": entry["organCount"],
        "turns": turns,
        "events": len(events_seen),
        "molts": molts,
    }
    report["guideFinal"] = final["guide"]
    return report


def main() -> int:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        shots = Shots(page, OUT)
        report = play(page, shots)
        report["consoleErrors"] = errors
        browser.close()

    (OUT / "legibility-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report["life"], ensure_ascii=False))
    print(f"引导链轨迹 {len(report['guideTrace'])} 步；详情 {len(report['details'])} 处；器官 {len(report['organs'])} 件")
    print(f"排版问题 {len(report['layoutIssues'])} 条；控制台报错 {len(report['consoleErrors'])} 条")
    print(f"截图 {shots.n} 张 → {OUT}")
    return 0 if not report["layoutIssues"] and not report["consoleErrors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
