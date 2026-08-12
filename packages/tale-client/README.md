# 食灵·列传 — tale-client

《食灵·列传》的界面壳：vite ＋ TypeScript ＋ 原生 DOM，零框架、零游戏逻辑。
一切规则由 `@shiling/tale-sim`（引擎）裁定，内容由 `@shiling/tale-content` 提供，
本包只做「把引擎给的状态画出来、把玩家的点击喂回引擎」。

## 怎么跑

```bash
pnpm install
pnpm -C personal-projects/shiling dev:tale     # → http://localhost:5174
pnpm -C personal-projects/shiling typecheck
pnpm -C personal-projects/shiling test
```

3D 版占着 5173，两个可以同时开着比对。`strictPort` 开着 —— 端口被占直接失败，
不会静默漂到 5175（E2E 脚本按固定端口连）。

调试参数：

| 参数 | 作用 |
|---|---|
| `?seed=<数字>` | 固定随机种子，同一世完全可复现（手测／截图／E2E 用） |
| `?reset=1` | 清掉血统存档（localStorage）从第一世开始 |

## 玩法与键位

一世＝若干「季」，每季选一个行动，行动结算后可能撞上一个图文事件；事件里的抉择带门槛
（属性／器官／精气），选完落账，季推进。饱食耗尽两季即饿殍，寿数尽则寿终，打不过就横死；
死后生成一篇史记笔法的**列传**入图谱，按蜕变／寿数／登神结算**血统点**，转世时用来解开新神种。

| 键 | 作用 |
|---|---|
| `1` `2` `3` `4` | 事件卡在场时＝选第 N 个抉择；战斗中＝第 N 个战斗指令；其余时候＝第 N 个行动 |
| `Enter` | 「继续／迎敌／瞑目」那颗按钮 |
| `Enter` `空格` `Esc` | 过场演出播放中＝跳过 |
| 鼠标 | 一切按钮均可点；未满足门槛的抉择置灰但**保留朱砂色的要求条**，写着还缺什么 |

四个行动：**狩猎**（得食与精气，也可能反被咬）、**探索**（撞事件的概率最高）、
**休憩**（回饱食、治病，治不了伤）、**蛰伏**（任一精气满阈值才点亮，消耗一季开器官）。

## 屏幕流

```
题字（食灵·列传）
  └─ 择神种（血统点解锁 ＋ 前传目录，可展开读前世列传）
       └─ 主界面（状态栏／中央卡／行动面板／右栏近事）
            ├─ 事件卡 → 抉择 → 结果旁白
            ├─ 战斗卡（敌人头像＋敌我血条＋战逃诈技四指令）
            ├─ 蛰伏 → 蜕变开奖卷轴（三候选滚动定格）
            └─ 死亡：满屏墨渍 → 结局过场演出（登神走白光升镜那一套）
                 └─ 列传卷轴（编年摘录＋赞曰＋其形画像）
                      └─ 转世 → 回择神种
```

## 目录

```
src/model/*     纯视图模型（无 DOM）→ vitest 全覆盖
src/screens/*   纯渲染函数（吃视图模型，吐 HTMLElement）
src/fx/*        动效与 canvas 粒子（全部尊重 prefers-reduced-motion）
src/art/*       资源路径规则（assets.ts）＋ 程序化水墨占位（placeholders.ts）
src/persist/*   血统存档（localStorage，注入 StorageLike 以便单测）
src/content.ts  **唯一**一处 import 内容库的地方
src/app.ts      **唯一**调引擎、唯一持可变状态的地方
```

## 美术资源

真图在 `public/art/`（B4 用 Meshy image-to-image 全量生成，60 张）：

| 目录 | 内容 | 消费方 |
|---|---|---|
| `events/<event.id>.webp` | 44 张事件插图（4:3） | 事件卡与抉择结果卡 |
| `enemies/<EnemyDef.id>.webp` | 8 张敌人头像（1:1） | 战斗卡左侧胸像 |
| `portraits/self-{1-cub,2-adult,3-neargod}.webp` | 三阶段立绘（3:4） | 状态栏「此身」、降世卡、列传「其形」 |
| `endings/<EndingType>.webp` | 4 张结局图（16:9） | 死亡／登神过场演出 |
| `ui/title-hero.webp` | 题字主视觉（16:9） | 题字画面背景（Ken Burns 缓推镜） |
| `_style/` | 正典锚图与候选（不进界面） | B4 生成管线 |

路径规则集中在 `src/art/assets.ts`，**别在别处拼字符串**；`test/artAssets.test.ts` 拿内容库的
id 逐个核磁盘文件 —— `<img>` 加载失败不报错，漏接线在运行时是静默的，只有测试会吵。

图位按画幅比开框、**整幅显示不裁切**：宽屏（≥1100px）图文并排，窄屏上下堆叠并封顶 42vh
（`object-fit: contain`）。别改回固定高度的横幅 —— 4:3 插图会被切掉上下三分之一，
44 条 brief 里 21 条的主体就在那两条边上。

## E2E

Playwright（Python，用系统 Chrome，不往 workspace 塞浏览器下载）。**先自己起 dev server**：

```bash
python packages/tale-client/e2e/fullLife.py   <输出目录> [种子]  # 打完一整世：零 404／零控制台错误／列传／转世
python packages/tale-client/e2e/flow.py       <输出目录>         # 赶里程碑：每种屏拍一张 ＋ 减少动画对照
python packages/tale-client/e2e/stalk.py      <输出目录> [种子]  # 追猎屏（M1-P1）
python packages/tale-client/e2e/combat.py     <输出目录> [种子]  # 搏杀屏（M1-P2）
python packages/tale-client/e2e/legibility.py <输出目录> [种子]  # 「看得懂」：详情浮层与引导链
python packages/tale-client/e2e/variance.py   <输出目录> [种子]  # 「每局不同」：连玩两局，验开局变量与四道
```

所有脚本都**如实玩**：只读 `window.__tale.snapshot()`（dev-only 只读快照）判断该点哪个按钮，
不注入状态 —— 截图里每个数字都是引擎真算出来的。

`variance.py` 另外在三档窄屏（1280／1024／760）各量一次降世屏与四道横带：前三批各犯过一次
「新元素把按钮挤出屏幕」，那是这个项目唯一反复出现的排版事故。

## 平衡与调参

```bash
pnpm -C packages/gen balance                                  # 200 世统计（默认谨慎玩家）
pnpm -C packages/gen balance -- --profile random --lives 500
pnpm -C packages/gen balance -- --profile wayseek --lives 500  # 四道平衡：每一世奔一条道
pnpm -C packages/gen balance -- --tune moltThreshold=78        # 试参，不落盘
```

⚠️ `pnpm ... balance -- --lab` 会把 `--` 当参数传进来（pnpm 行为变了），带 flag 时直接调 node：
`cd packages/gen && node --import ./src/tsResolveHook.mjs src/balance-sim.ts --profile wayseek --lives 500`

**四道的门槛只能按 `wayseek` 的数调**：别的画像不奔任何道（cautious 挑末条、random 乱点），
化灵在它们手里恒为 0% —— 那既不能证明门槛太难也不能证明合适。目标是每条道各自 0.5〜5%、
合计 8〜15%，同时「活过 8 岁 ≥60%」「平均蜕变 2〜4」两条老目标在四个画像下都还成立。

数值一律改 `tale-content/src/tuning.ts`（含理由与实测表），**不改引擎**。
