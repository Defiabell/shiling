#!/usr/bin/env python3
"""《食灵·列传》**故事卡可读性**的视口矩阵实机验收（矮窗口回归锁）。

病史：2026-08-14 owner 在一扇约 1000×477 的窗口里试玩，报「故事叙事只有短短一条，看不清」，
并因此把「抉择看不见、行动全是『先了此事』」读成了死锁。根因在版式，不在引擎 ——
`.play` 的舞台行是 `minmax(0, 1fr)` ＋ `height: 100vh`，也就是**中央舞台是残差**：
状态栏、引导条、行动面板先各取所需，剩下多少舞台才多少。修复前实测（事件卡在场）：

    1440×900 → 舞台 116px    1440×820 → 36px    1280×720 → 8px（卡片高度 0）

所以这个脚本盯的不是「有没有报错」，而是**玩家此刻能不能读到自己的故事、点到自己的抉择**，
而且要在**两个维度**上盯：这个项目此前四次栽在「新元素挤走既有元素」上，最近这一次的教训
正是「宽度测了、高度没测」。矩阵因此宽高各扫一遍，含 owner 那一档矮窗口。

每一档、每一张卡（降世旁白／事件卡／抉择结果）都验四条：

  ① 卡片没有被裁：`scrollHeight ≤ clientHeight`（卡内不许再有藏起来的内容）
  ② 不滚动就能读到故事：正文首行在视口内，且卡片可视高度 ≥ min(卡高, 240px)
  ③ 不滚动就看得见至少一颗抉择（事件卡）—— 这是「看起来像死锁」那一症的判据
  ④ 每一颗抉择／行动／去处都够得到：滚到它 → 在视口内 → 命中测试点得到它本人（没被浮层压住）

运行前先自己起 dev server（**别 pkill 已有的**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5199 --strictPort

用法（参数顺序与 bestiary.py／legibility.py 对齐：输出目录 → 种子 → 端口）：
    python packages/tale-client/e2e/layout.py [输出目录] [种子] [端口]

深扫某一档（换视口／多验几张卡）：
    LAYOUT_ONLY=1000x480 LAYOUT_EVENTS=12 python packages/tale-client/e2e/layout.py ...
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/layout").resolve()
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 20260814
# 端口可传（同 bestiary.py／legibility.py）：5174 常被别的 session 的 dev server 占着，**不要去杀它**
PORT = sys.argv[3] if len(sys.argv) > 3 else "5174"
BASE = f"http://localhost:{PORT}/"

# 一档视口里连验几张事件卡（卡片高矮差很多：两颗抉择的短卡 vs 四颗带门槛提示的长卡）。
# 深扫某一档时：`LAYOUT_ONLY=1000x480 LAYOUT_EVENTS=12 python .../layout.py`
EVENTS_PER_VIEWPORT = int(os.environ.get("LAYOUT_EVENTS", "3"))
ONLY = os.environ.get("LAYOUT_ONLY", "")

# 宽高两个维度都要扫（这次的教训）。1000×480 ＝ owner 实况（Retina 截图折算 ~1000×477）。
VIEWPORTS: list[tuple[int, int, str]] = [
    (1000, 480, "owner 实况：矮窗口 ＋ 单列版式"),
    (1200, 560, "矮 ＋ 图文并排的临界"),
    (1280, 720, "常见笔记本"),
    (1366, 768, "常见笔记本（窄一档）"),
    (1024, 768, "窄屏：单列版式"),
    (1440, 820, "MacBook 有 Dock"),
    (1440, 900, "MacBook 全屏 —— 版式基线"),
    (1920, 1080, "外接显示器：余量充足，验「一屏放下、卡片居中」没被改坏"),
]

# 已知未支持的一档，**故意不放进矩阵**（放进来它会长红，红灯就不再是信号）：
# **宽 ≤900 且高 ≤700** 的小窗口。那时状态栏塌成单列（≤860）或四道横带排两层，
# 光页头就吃掉 400〜475px，故事卡被推到折线以下。实测对照（seed 20260814，事件卡）：
#
#            修复前 → 修复后（卡片可视高度）
#   900×640   0px  → 390px（正文可读，抉择要滚一下）
#   820×620   0px  → 145px（正文仍在折线下）
#
# 即这一档也变好了，只是没到「不滚就能玩」。真要治，治的是**小窗口下的状态栏**
# （三栏塞不下、单列又太高），那是另一批的事 —— 不是再把中央舞台变回残差。

# 「读得到」的判据：正文首行至少露出一行的高度（正文 line-height ≈ 35px）
LINE_PX = 30
# 卡片可视高度下限：卡比它矮时以卡高为准（旁白卡常常只有两三行）
CARD_VIS_MIN = 240

MEASURE = r"""
() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const shell = document.querySelector('.play');
  const box = (n) => { if (!n) return null; const r = n.getBoundingClientRect();
    return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left),
             r: Math.round(r.right), h: Math.round(r.height), w: Math.round(r.width),
             vis: Math.round(Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))) }; };
  const card = document.querySelector('.card');
  const proseP = document.querySelector('.card__prose p');
  const body = document.querySelector('.card__body');
  const targets = (sel, attr) => [...document.querySelectorAll(sel)].map((n) => ({
    id: n.getAttribute(attr) ?? '', box: box(n), disabled: !!n.disabled,
  }));
  return {
    vw, vh,
    shell: {
      scrollTop: shell ? Math.round(shell.scrollTop) : null,
      scrollH: shell ? shell.scrollHeight : null,
      clientH: shell ? shell.clientHeight : null,
      scrollW: shell ? shell.scrollWidth : null,
      clientW: shell ? shell.clientWidth : null,
    },
    docScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    kind: card ? card.className : null,
    card: box(card),
    cardClip: card ? card.scrollHeight - card.clientHeight : null,
    bodyClip: body ? body.scrollHeight - body.clientHeight : null,
    stage: box(document.querySelector('.stage')),
    prose: box(proseP),
    choices: targets('.choice', 'data-choice'),
    acts: targets('[data-action]', 'data-action'),
    dests: targets('[data-dest]', 'data-dest'),
    continue: box(document.querySelector('[data-continue]')),
  };
}
"""

# 滚到某颗按钮 → 量它 → 命中测试（有没有被浮层／别的层压住）。滚动容器是 `.play` 自己。
REACH = r"""
(sel) => {
  const shell = document.querySelector('.play');
  const before = shell ? shell.scrollTop : 0;
  const out = [];
  for (const n of document.querySelectorAll(sel)) {
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    out.push({
      id: n.getAttribute('data-choice') ?? n.getAttribute('data-action') ?? n.getAttribute('data-dest') ?? '?',
      inView: r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.right <= window.innerWidth + 1,
      hit: hit !== null && (hit === n || n.contains(hit)),
      h: Math.round(r.height),
    });
  }
  if (shell) shell.scrollTop = before;
  return out;
}
"""


def snap(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__tale.snapshot()))")


def check(page: Page, tag: str, phase: str, shot: str) -> dict:
    """一张卡的四条判据。返回 {"fails": [...], ...measurements}。"""
    page.evaluate("() => { const s = document.querySelector('.play'); if (s) s.scrollTop = 0; }")
    page.wait_for_timeout(120)
    m = page.evaluate(MEASURE)
    fails: list[str] = []
    if m["card"] is None:
        return {"phase": phase, "shot": shot, "fails": ["没有中央卡片"], **m}

    is_event = "card--event" in (m["kind"] or "")

    # ① 卡内不许有藏起来的内容
    if (m["cardClip"] or 0) > 1:
        fails.append(f"卡片被裁：溢出 {m['cardClip']}px")
    if (m["bodyClip"] or 0) > 1:
        fails.append(f"正文区被裁：溢出 {m['bodyClip']}px")

    # ② 不滚动就读得到故事
    want_vis = min(m["card"]["h"], CARD_VIS_MIN)
    if m["card"]["vis"] < want_vis:
        fails.append(f"卡片可视高度 {m['card']['vis']}px < 下限 {want_vis}px（卡高 {m['card']['h']}）")
    if m["prose"] is None:
        fails.append("卡上没有正文")
    elif m["prose"]["vis"] < LINE_PX:
        fails.append(f"正文首行不在视口内（露出 {m['prose']['vis']}px < {LINE_PX}）")

    # ③ 事件卡：不滚动就看得见至少一颗抉择
    if is_event:
        seen = [c for c in m["choices"] if c["box"]["vis"] >= c["box"]["h"] - 1 and c["box"]["h"] > 0]
        if not m["choices"]:
            fails.append("事件卡上没有抉择")
        elif not seen:
            fails.append(f"一颗抉择都没露全（共 {len(m['choices'])} 颗）")

    # ④ 抉择／行动／去处都够得到（滚得到 ＋ 点得到）
    reach: dict[str, list] = {}
    for name, sel in (("choices", ".choice"), ("acts", "[data-action]"), ("dests", "[data-dest]")):
        got = page.evaluate(REACH, sel)
        reach[name] = got
        for item in got:
            if not item["inView"]:
                fails.append(f"{name}[{item['id']}] 滚到中央仍不在视口内")
            elif not item["hit"]:
                fails.append(f"{name}[{item['id']}] 被别的层压住（命中测试落空）")

    if m["shell"]["scrollW"] and m["shell"]["scrollW"] > m["shell"]["clientW"] + 1:
        fails.append(f"出现横向滚动：{m['shell']['scrollW']} > {m['shell']['clientW']}")
    if m["docScrollX"]:
        fails.append("页面出现横向滚动条")

    # 顺带对账渲染护栏（`model/playable.ts`）：它判的是「这一帧逻辑上还有没有路」，
    # 与「那条路看不看得见」是两回事 —— 卡片被压扁时它**不该**响（抉择还在、还点得开，
    # 只是不在视口里）。所以矩阵跑完 integrity 必须是空的：既证明护栏没被这次版式改动
    # 带出误报，也把「视觉可见性」这一半明确留给上面那几条断言。
    violations = snap(page)["integrity"]
    if violations:
        fails.append(f"护栏误报 {len(violations)} 条：{violations[:2]}")

    return {"phase": phase, "shot": shot, "fails": fails, "reach": reach, "integrity": violations, **m}


def enter(page: Page) -> None:
    page.goto(f"{BASE}?seed={SEED}&reset=1&ai=0&scenario=0", wait_until="load")
    page.wait_for_selector("[data-start]")
    page.click("[data-start]")
    page.wait_for_selector("[data-seed]")
    page.click("[data-seed]")
    page.wait_for_selector(".statusbar")
    page.wait_for_timeout(520)


def run_viewport(page: Page, tag: str, note: str) -> dict:
    """开局 → 降世旁白 → 逐张事件卡（各验一次）＋ 每张的抉择结果。"""
    result: dict = {"note": note, "phases": [], "consoleErrors": []}
    enter(page)

    shot = OUT / f"{tag}-1-birth.png"
    page.screenshot(path=str(shot))
    result["phases"].append(check(page, tag, "birth", shot.name))

    seen = 0
    for _ in range(900):
        if page.query_selector(".molt__card"):
            page.wait_for_timeout(2300)
            page.click(".molt__confirm")
            page.wait_for_timeout(320)
            continue
        state = snap(page)
        if state["screen"] != "play":
            break
        if state["center"] == "event":
            page.wait_for_timeout(420)
            seen += 1
            shot = OUT / f"{tag}-ev{seen}.png"
            page.screenshot(path=str(shot))
            result["phases"].append(check(page, tag, f"event{seen}", shot.name))
            # 挑最后一条抉择（与 fullLife.py 的谨慎玩家同口径），再验一次抉择结果那张旁白
            idxs = page.eval_on_selector_all(
                ".choice:not([disabled])", "ns => ns.map((n) => n.getAttribute('data-choice'))"
            )
            if idxs:
                page.click(f'[data-choice="{idxs[-1]}"]:not([disabled])')
                page.wait_for_timeout(520)
                if page.query_selector(".card"):
                    shot = OUT / f"{tag}-ev{seen}-outcome.png"
                    page.screenshot(path=str(shot))
                    result["phases"].append(check(page, tag, f"outcome{seen}", shot.name))
            if seen >= EVENTS_PER_VIEWPORT:
                break
            continue
        if page.query_selector("[data-continue]:not([disabled])"):
            if not state["state"]["alive"]:
                break
            page.click("[data-continue]")
            page.wait_for_timeout(180)
            continue
        # 遭遇（追猎／搏杀）在快照里是同一个 kind：`encounter`，屏上按钮各是 data-stalk／data-combat。
        # **按发金光的那颗打**（`.is-hot` 是界面自己的推荐）：随便点第一颗会一路失手，
        # 实测那样活不过四岁，一世只撞得到一张事件卡，矩阵也就验不到多抉择的高卡。
        if state["center"] == "encounter":
            hit = (
                page.query_selector("[data-stalk].is-hot:not([disabled])")
                or page.query_selector('[data-stalk="pounce"]:not([disabled])')
                or page.query_selector("[data-combat].is-hot:not([disabled])")
                or page.query_selector('[data-combat="bite:throat"]:not([disabled])')
                or page.query_selector("[data-stalk]:not([disabled])")
                or page.query_selector("[data-combat]:not([disabled])")
            )
            if hit is None:
                break
            hit.click()
            page.wait_for_timeout(200)
            continue
        # 照屏幕上写的数打的玩家（同 legibility.py）：饿了去猎、有伤歇一季、余量厚就出门 ——
        # **出门＝点一处去处**（探索不再是第五颗行动按钮），而事件卡正是从去处来的。
        life = state["state"]
        hurt = "wound" in life["flags"] or "sick" in life["flags"]
        target = None
        if page.query_selector('[data-action="dormant"]:not([disabled])'):
            target = page.query_selector('[data-action="dormant"]:not([disabled])')
        elif life["hunger"] <= 70:
            target = page.query_selector('[data-action="hunt"]:not([disabled])')
        elif hurt:
            target = page.query_selector('[data-action="rest"]:not([disabled])')
        if target is None:
            target = page.query_selector("[data-dest]:not([disabled])")
        if target is None:
            target = page.query_selector("[data-action]:not([disabled])")
        if target is None:
            break
        target.click()
        page.wait_for_timeout(200)
    return result


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for stale in [*OUT.glob("*.png"), *OUT.glob("layout-report.json")]:
        stale.unlink()

    report: dict = {"seed": SEED, "viewports": {}}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for width, height, note in VIEWPORTS:
            tag = f"{width}x{height}"
            if ONLY and ONLY != tag:
                continue
            page = browser.new_page(viewport={"width": width, "height": height})
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            entry = run_viewport(page, tag, note)
            entry["consoleErrors"] = errors
            report["viewports"][tag] = entry
            page.close()
        browser.close()

    (OUT / "layout-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    bad = 0
    for tag, entry in report["viewports"].items():
        for phase in entry["phases"]:
            card = phase.get("card") or {}
            mark = "✗" if phase["fails"] else "✓"
            bad += 1 if phase["fails"] else 0
            print(
                f"{mark} {tag:>9} {phase['phase']:<8} 卡高 {card.get('h', '-'):>4} 露出 {card.get('vis', '-'):>4}"
                f" 抉择 {len(phase.get('choices', []))} 壳滚 {phase.get('shell', {}).get('scrollH', '-')}"
                f"/{phase.get('shell', {}).get('clientH', '-')}"
                + ("  ← " + "；".join(phase["fails"]) if phase["fails"] else "")
            )
        if entry["consoleErrors"]:
            bad += 1
            print(f"✗ {tag:>9} 控制台报错 {len(entry['consoleErrors'])} 条：{entry['consoleErrors'][:2]}")
    print(f"截图与报告 → {OUT}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
