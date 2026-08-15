#!/usr/bin/env python3
"""《食灵·列传》「交锋节奏」（宝可梦式一来一往）实机验收。

与 `encounter.py`／`bestiary.py` 同一套办法、同一个理由：断言打在**屏幕上真的显示出来的
东西**上，不是引擎内部值。它回答交付线的五问：

  1. 连续帧能不能证明「我一拍、它一拍」真的分离？（逐帧抄 `[data-beat-side]` ＋ 贴图）
  2. 先手标记看得见、解释得出吗？（抄 `[data-initiative]` 那一行的字）
  3. 一招打死它时，它那一拍是不是真的没发生？（`data-beat-progress` 只有 1/1，且没有彼那一拍）
  4. 跳拍顺不顺、一合是不是仍然只点一次？（数「必点」与「可选点」两笔账）
  5. 一场架含演出实际多久？（每合墙钟时间 ＋ 一整场合计）

运行前先自己起 dev server（**别 pkill 别人占着的 5174**）：
    packages/tale-client $ ../../node_modules/.bin/vite --port 5193 --strictPort

用法：
    python packages/tale-client/e2e/cadence.py [输出目录] [种子] [端口]
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots/cadence").resolve()
SEED = int(sys.argv[2] if len(sys.argv) > 2 else 20260815)
PORT = sys.argv[3] if len(sys.argv) > 3 else "5193"
BASE = f"http://localhost:{PORT}/"
VIEWPORT = {"width": 1440, "height": 980}

# 拍与拍之间是 470〜620ms；30ms 一采足够在每一拍上取到好几帧，
# 又不至于把 CPU 吃满（吃满会让计时器自己漂，那就成了「探针污染被测对象」）
POLL_MS = 30


def beat_frame(page: Page) -> dict:
    """把**这一瞬间屏幕上的拍**抄下来。没有拍面板时 stage 为 None。"""
    return page.evaluate(
        """() => {
          const q = (sel) => document.querySelector(sel);
          const txt = (sel) => q(sel)?.textContent ?? null;
          const stage = q('[data-beat-stage]');
          const card = q('[data-beat-advance]');
          const first = q('[data-initiative]');
          const hp = [...document.querySelectorAll('.hp')].map((n) => ({
            who: n.querySelector('.hp__label')?.textContent ?? '',
            num: n.querySelector('.hp__num')?.textContent ?? '',
            width: n.querySelector('.hp__fill')?.style.width ?? '',
            from: n.querySelector('.hp__fill')?.style.getPropertyValue('--hp-from') ?? '',
            pop: n.querySelector('.hp__pop')?.textContent ?? null,
            beating: n.classList.contains('is-beating'),
          }));
          return {
            stage: stage === null ? null : {
              side: card?.getAttribute('data-beat-side') ?? null,
              index: card?.getAttribute('data-beat-index') ?? null,
              move: txt('[data-beat-move]'),
              lines: [...document.querySelectorAll('[data-beat-lines] em')].map((n) => n.textContent),
              progress: q('[data-beat-progress]')?.getAttribute('data-beat-progress') ?? null,
              skippable: q('[data-beat-skip]') !== null,
            },
            initiative: first === null ? null : {
              side: first.getAttribute('data-initiative'),
              label: txt('.combat__first-text'),
              why: txt('.combat__first-why'),
            },
            intent: txt('.combat__intent-text'),
            hp,
            // 演出中指令区必须整排灰 —— 这一条与「一合只点一次」是同一件事的两半
            actsEnabled: [...document.querySelectorAll('[data-combat]')].filter((n) => !n.disabled).length,
            log: [...document.querySelectorAll('.combat__log li')].map((n) => n.textContent),
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
    for _ in range(8):
        if page.query_selector(".card--encounter") is not None:
            return
        button = page.query_selector("[data-continue]:not([disabled])")
        if button is None:
            return
        button.click()
        page.wait_for_timeout(420)


def play_one_round(page: Page, act_selector: str) -> dict:
    """
    按一颗指令，然后**一路采样直到演出结束**，把逐帧的拍记下来。

    这个循环里**不截图**：`page.screenshot()` 要六七百毫秒，而拍与拍之间才五六百 ——
    在采样循环里截图等于让探针把被测对象搅乱（第一版就栽在这儿：一合只采到一拍，
    看起来像「末拍没渲染」，其实一半是截图吃掉的时间）。帧序列另开一趟用跳拍驱动，
    那一趟不看时间只看顺序。
    """
    button = page.query_selector(act_selector)
    if button is None:
        return {"clicked": None}
    t0 = time.monotonic()
    button.click()
    frames: list[dict] = []
    seen: list[dict] = []
    locked_frames = 0
    idle = 0
    for _ in range(400):
        frame = beat_frame(page)
        frames.append(frame)
        stage = frame["stage"]
        if stage is not None:
            locked_frames += 1
            idle = 0
            key = (stage["side"], stage["index"])
            if not seen or (seen[-1]["side"], seen[-1]["index"]) != key:
                seen.append({**stage, "atMs": round((time.monotonic() - t0) * 1000)})
        elif seen:
            break
        else:
            # 一直没有拍面板：要么这一按没进演出（那本身是缺陷），要么已经收束了。
            # 等满 1.5s 就走人 —— 不做无谓的 400 次空转（第一版在这儿白等了 14 秒）
            idle += 1
            if idle * POLL_MS > 1500:
                break
        page.wait_for_timeout(POLL_MS)
    ms = round((time.monotonic() - t0) * 1000)
    # 从**第一拍上屏**算到拍面板消失 ＝ 演出真正花掉的时间。
    # 与 `ms` 分开报：`ms` 里含 Playwright 自己等按钮「稳定」的那几百毫秒
    # （卡片每次重建都放一段 620ms 的入场动画），那是探针的开销，不是玩家等的时间。
    playback_ms = ms - seen[0]["atMs"] if seen else None
    # 演出中指令区必须整排灰（若有任何一帧里按钮是活的，就是「点得穿」）
    live = [f["actsEnabled"] for f in frames if f["stage"] is not None]
    return {
        "clicked": act_selector,
        "ms": ms,
        "playbackMs": playback_ms,
        "beats": seen,
        "lockedFrames": locked_frames,
        "actsEnabledDuringPlayback": max(live) if live else 0,
        "endFrame": frames[-1],
    }


def frame_sequence(page: Page, shots: Path, rounds: int = 3) -> list[dict]:
    """
    **贴帧序列那一趟**：一合一合打，每一拍截一张图，用「跳拍」推进而不是等计时器。

    与上面那一趟分工明确：这一趟只证「拍与拍真的分离、顺序是我一拍它一拍」，
    时间账归上面那一趟。用跳拍推进的好处是每一张图都稳稳落在一拍上，
    不会拍到两拍之间的过渡帧。
    """
    shots.mkdir(parents=True, exist_ok=True)
    seq: list[dict] = []
    for round_index in range(rounds):
        card = page.query_selector(".card--encounter")
        if card is None or card.get_attribute("data-phase") != "clash":
            break
        pick = ".cact.is-hot:not([disabled])"
        if page.query_selector(pick) is None:
            pick = '[data-combat="bite:throat"]:not([disabled])'
        button = page.query_selector(pick)
        if button is None:
            break
        before = beat_frame(page)
        button.click()
        shot = 0
        seen_index = None
        for _ in range(12):
            page.wait_for_timeout(60)
            frame = beat_frame(page)
            stage = frame["stage"]
            if stage is None:
                break
            if stage["index"] == seen_index:
                continue
            seen_index = stage["index"]
            shot += 1
            name = f"r{round_index + 1}-beat{shot}-{stage['side']}.png"
            # 只截**遭遇卡**那一块，且走 clip 而不是 ElementHandle.screenshot：
            # 后者要等元素「稳定」，而拍面板一出生就在播入场动画 —— 等它稳定就等过了这一拍。
            # animations="disabled" 让血条那一段直接落到终值，正是这一拍该被记下来的样子。
            box = page.evaluate(
                """() => {
                     const n = document.querySelector('.card--encounter');
                     if (!n) return null;
                     const r = n.getBoundingClientRect();
                     return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
                   }"""
            )
            if box is not None and box["width"] > 0 and box["height"] > 0:
                page.screenshot(path=str(shots / name), clip=box, animations="disabled")
            seq.append({
                "round": round_index + 1,
                "shot": name,
                "side": stage["side"],
                "move": stage["move"],
                "progress": stage["progress"],
                "lines": stage["lines"],
                "hp": frame["hp"],
                "initiative": before["initiative"],
            })
            # 用 `evaluate` 直接派发点击：拍面板一出生就带 220ms 的入场动画，
            # Playwright 的 actionability 会等它「稳定」——而那一等就等过了这一拍。
            # 「按钮点不点得着」由问四那一趟的真实点击负责，这里只要推进。
            page.evaluate("() => document.querySelector('[data-beat-advance]')?.click()")
        page.wait_for_timeout(240)
    return seq


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict = {"seed": SEED, "port": PORT}
    errors: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ── 问一・问二・问五：一场架从头打到尾，逐合逐拍抄屏 ──────────────
        # 九尾狐是全库最快的一头（speed 24）—— 基础 build 抢不到先手，
        # 而拆了它的腿就抢得回来。一场架里两种先手都会出现，正是这一批要看的东西。
        start_life(page, SEED, foe="jiu-wei-hu", extra="&organs=gou-chi,ji-zu&essence=60")
        rounds: list[dict] = []
        t_fight = time.monotonic()
        for i in range(16):
            card = page.query_selector(".card--encounter")
            if card is None or card.get_attribute("data-phase") != "clash":
                break
            before = beat_frame(page)
            pick = ".cact.is-hot:not([disabled])"
            if page.query_selector(pick) is None:
                pick = '[data-combat="bite:throat"]:not([disabled])'
            got = play_one_round(page, pick)
            if got["clicked"] is None:
                break
            rounds.append({
                "round": i + 1,
                "initiativeBefore": before["initiative"],
                "intentBefore": before["intent"],
                **got,
                "endFrame": {k: got["endFrame"][k] for k in ("hp", "actsEnabled", "log")},
            })
        report["fight"] = {
            "rounds": rounds,
            "totalMs": round((time.monotonic() - t_fight) * 1000),
        }

        # ── 问一（贴图那一半）：另起一场，逐拍截图 ────────────────────
        start_life(page, SEED, foe="jiu-wei-hu", extra="&organs=gou-chi,ji-zu&essence=60")
        report["frames"] = frame_sequence(page, OUT / "frames", rounds=3)

        # ── 问一・五（第二场）：一头**先手在我**的兽，顺带量一场长架 ──────
        # 山魈 speed 13，与基础 build 的灵 13 打平 —— 同速归玩家，于是这一场恒是「我一拍它一拍」
        start_life(page, SEED, foe="shan-xiao", extra="&organs=gou-chi,ji-zu&essence=60")
        roundsB: list[dict] = []
        tB = time.monotonic()
        for i in range(16):
            card = page.query_selector(".card--encounter")
            if card is None or card.get_attribute("data-phase") != "clash":
                break
            before = beat_frame(page)
            pick = ".cact.is-hot:not([disabled])"
            if page.query_selector(pick) is None:
                pick = '[data-combat="bite:throat"]:not([disabled])'
            got = play_one_round(page, pick)
            if got["clicked"] is None:
                break
            roundsB.append({
                "round": i + 1,
                "initiativeBefore": before["initiative"],
                **{k: got[k] for k in ("ms", "playbackMs", "beats", "actsEnabledDuringPlayback")},
            })
        report["fightB"] = {"foe": "shan-xiao", "rounds": roundsB,
                            "totalMs": round((time.monotonic() - tB) * 1000)}

        # ── 问三：一招打死它，它那一拍不该发生 ────────────────────────
        # 灌灌是教具层最弱的一头（hp 13）；给满器官与精气之后一记决杀／咬喉就收场
        start_life(page, SEED, foe="guan-guan", extra="&organs=gou-chi,ji-zu,wu-mu&essence=90")
        one_shot: list[dict] = []
        for i in range(10):
            card = page.query_selector(".card--encounter")
            if card is None or card.get_attribute("data-phase") != "clash":
                break
            pick = ".cact.is-hot:not([disabled])"
            if page.query_selector(pick) is None:
                pick = '[data-combat="bite:throat"]:not([disabled])'
            got = play_one_round(page, pick)
            if got["clicked"] is None:
                break
            one_shot.append({"round": i + 1, "beats": got["beats"], "ms": got["ms"]})
            if page.query_selector(".card--encounter") is None:
                break
        report["oneShot"] = one_shot

        # ── 问四：跳拍 ＋ 必点次数 ────────────────────────────────
        # 同一场架打两遍（同种子）：一遍不跳拍、一遍每一拍都点。
        # 「必点」＝ 指令按钮那一颗；跳拍点击是可选的加速，不计入。
        def run_fight(skip: bool) -> dict:
            start_life(page, SEED, foe="jiu-wei-hu", extra="&organs=gou-chi,ji-zu&essence=60")
            required = 0
            optional = 0
            t0 = time.monotonic()
            for _ in range(10):
                card = page.query_selector(".card--encounter")
                if card is None or card.get_attribute("data-phase") != "clash":
                    break
                pick = ".cact.is-hot:not([disabled])"
                if page.query_selector(pick) is None:
                    pick = '[data-combat="bite:throat"]:not([disabled])'
                button = page.query_selector(pick)
                if button is None:
                    break
                button.click()
                required += 1
                for _ in range(400):
                    stage = page.query_selector("[data-beat-stage]")
                    if stage is None:
                        break
                    if skip:
                        target = page.query_selector("[data-beat-skip]")
                        if target is not None:
                            target.click()
                            optional += 1
                    page.wait_for_timeout(POLL_MS)
            return {
                "requiredClicks": required,
                "optionalClicks": optional,
                "ms": round((time.monotonic() - t0) * 1000),
            }

        report["clicks"] = {"noSkip": run_fight(False), "skipping": run_fight(True)}

        # ── 附：reduced-motion 下即时展示（不等任何时间） ──────────────
        page.emulate_media(reduced_motion="reduce")
        start_life(page, SEED, foe="jiu-wei-hu", extra="&organs=gou-chi,ji-zu&essence=60")
        t0 = time.monotonic()
        got = play_one_round(page, '[data-combat="bite:throat"]:not([disabled])')
        report["reducedMotion"] = {
            "ms": round((time.monotonic() - t0) * 1000),
            "beats": got.get("beats", []),
            # 即时展示不等时间，但**一条旁白都不许吞** —— 日志是这一条的判据
            "logLines": len(got.get("endFrame", {}).get("log", []) or []),
        }
        page.emulate_media(reduced_motion="no-preference")

        report["consoleErrors"] = errors
        report["integrity"] = page.evaluate(
            "() => window.__tale?.debugSnapshot?.().integrity ?? null"
        )
        browser.close()

    (OUT / "cadence-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # ── 控制台摘要（人读的那一份） ──────────────────────────────
    print(f"\n=== 交锋节奏实机验收（seed {SEED}，端口 {PORT}）===")
    print(f"\n[问一・二・五] 一场架 {len(report['fight']['rounds'])} 合，"
          f"含演出合计 {report['fight']['totalMs']} ms")
    for entry in report["fight"]["rounds"]:
        init = entry.get("initiativeBefore") or {}
        beats = " → ".join(
            f"{b['side']}·{b['move']}@{b['atMs']}ms" for b in entry["beats"]
        )
        print(f"  第{entry['round']}合 演出 {entry['playbackMs']}ms（含探针 {entry['ms']}ms）│ "
              f"先手 {init.get('label')}（{init.get('why')}）│ "
              f"指令区活按钮 {entry['actsEnabledDuringPlayback']}")
        print(f"        拍：{beats}")
    print(f"\n[问一・五・第二场 山魈] {len(report['fightB']['rounds'])} 合，"
          f"含演出合计 {report['fightB']['totalMs']} ms")
    for entry in report["fightB"]["rounds"]:
        init = entry.get("initiativeBefore") or {}
        beats = " → ".join(f"{b['side']}·{b['move']}@{b['atMs']}ms" for b in entry["beats"])
        print(f"  第{entry['round']}合 演出 {entry['playbackMs']}ms │ 先手 {init.get('label')}"
              f"（{init.get('why')}）")
        print(f"        拍：{beats}")
    print("\n[问三] 一招打死：")
    for entry in report["oneShot"]:
        beats = " → ".join(f"{b['side']}·{b['move']}({b['progress']})" for b in entry["beats"])
        print(f"  第{entry['round']}合 {beats}")
    print(f"\n[问四] 必点／可选点：不跳拍 {report['clicks']['noSkip']}"
          f"；跳拍 {report['clicks']['skipping']}")
    print("\n[问一・贴图] 帧序列：")
    for f in report["frames"]:
        print(f"  {f['shot']:<28} {f['side']:<6} {f['move']:<6} {f['progress']}  "
              f"{'／'.join(h['num'] for h in f['hp'])}")
    print(f"\n[附] reduced-motion：{report['reducedMotion']['ms']} ms，"
          f"{len(report['reducedMotion']['beats'])} 拍，日志 {report['reducedMotion']['logLines']} 行")
    print(f"\n控制台报错 {len(errors)} 条；护栏 integrity {report['integrity']}")
    print(f"报告：{OUT / 'cadence-report.json'}")
    # 退出码跟着**收集到的东西**走（同 legibility.py／combat.py 那几份）：
    # 只打印不 gate 的话，「没跑成」与「没发现问题」在 CI 眼里是同一件事。
    bad = len(errors) + len(report["integrity"] or [])
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
