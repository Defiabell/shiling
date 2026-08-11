# 食灵 Shiling

山海经世界的单机养成游戏（开发中）。同一个仓库里现在有两条路线：

| 路线 | 包 | 端口 | 状态 |
|---|---|---|---|
| **《食灵·列传》图文事件流**（当前主线） | `tale-sim` `tale-content` `tale-client` | 5174 | **M0 青丘一世闭环已交付**，可完整玩通 |
| 3D 生存进化（原路线） | `sim` `content` `client` | 5173 | **冻结**（owner 2026-08-11 判画质天花板不达预期），代码与资产原地保留 |

设计文档（workspace 仓库 `docs/plans/shiling/`）：图文版 `2026-08-11-liezhuan-design.md`
＋实施计划 `2026-08-11-liezhuan-m0-plan.md`；3D 版 `2026-08-06-shiling-design.md`。

## 《食灵·列传》M0（主线）

一缕食灵凭神种降世为青丘幼兽。每季选一个行动（狩猎／探索／休憩／蛰伏），撞上图文事件后
做抉择；吞精气攒到阈值可蛰伏蜕变，在六槽位里长出器官（12 器官池）定形态；抉择定德性。
饿殍／横死／寿终／登神四种收束，死后按 LifeRecord 生成史记笔法的**列传**入图谱，
结算血统点用于转世解锁新神种。44 事件／12 器官／3 神种／8 敌人／60 张 Meshy 生成的
宋人册页风插图。

```bash
pnpm install
pnpm dev:tale     # → http://localhost:5174
pnpm test         # 全 workspace 测试
pnpm typecheck
```

怎么玩、键位、屏幕流、E2E 与调参：见 `packages/tale-client/README.md`。

## 3D 路线（冻结）：M1 进化系统

青丘灰盒：走·游·掘三态生存＋昼夜循环，五物种食物链（苓鼠／潭狩／幼兽玩家 ＋ M1 新增
溪鱼／穴獾）。水墨渲染＋程序化生物＋粒子特效＋程序化音效＋水墨 UI（M0.5 视觉收尾）。

M1 进化系统——游戏的心脏：捕食鲜尸按物种类型积累精气（足/鳞/穴/猛四类，玩家全局值，
储粮吃不到精气，鲜食才养精）；回到自建家巢、精气与储粮达标后按 V 蛰伏（45 秒真实时间，
储粮供能，中断不开奖）；蛰伏结束按五因子（精气构成／行为偏置／已占槽惩罚）加权开奖，
在六个可替换槽位（颌/肢/脊背/皮肤/尾/窍）之一长出一枚器官（12 器官池，山海经志怪词条），
外加出生自带、不可替换的本命「神种」；器官改变移动/冲刺/攻击/挖掘/感知等能力，随用进
（swim/sprint/dig/kill/被击/被动）持续淬炼 temper。昼夜循环驱动光照/雾色/萤火/虫鸣/风声
氛围联动。

## 控制键位

| 键位 | 作用 |
|---|---|
| `W A S D` | 移动 |
| `Shift` | 冲刺（消耗疲劳） |
| `J`（或鼠标左键） | 撕咬 |
| `E` | 互动——进食／饮水／挖掘／筑巢／出入洞 |
| `C` | 叼起／放下——存粮或就地放下猎物 |
| `V` | 蛰伏——在自家巢中，精气与储粮足够时开始蜕变 |
| `Tab` | 查看已装备的器官（七槽位＋淬炼度） |
| `← → ↑ ↓` | 转动视角／俯仰 |
| `Esc` | 暂停 |
| `M` | 静音 |

## 开发

    pnpm install
    pnpm dev        # 3D 版 → http://localhost:5173
    pnpm dev:tale   # 列传版 → http://localhost:5174
    pnpm test       # 全 workspace 测试
    pnpm typecheck

## 结构

图文事件流（主线）：

- `packages/tale-sim` — 回合制确定性引擎（纯函数返回新状态，注入 content，
  禁 Date.now／Math.random／DOM）。引擎旁白与 `render` 模板也在这里。
- `packages/tale-content` — 44 事件／12 器官／3 神种／8 敌人／列传模板／tuning／视觉 token，
  纯数据。调数值只改 `src/tuning.ts`。
- `packages/tale-client` — DOM 界面（vite，5174），零游戏逻辑；真插图在 `public/art/`。
- `packages/gen` — 离线脚本：Meshy 图片生成管线（`art*`）与平衡模拟台（`balance`）。

3D 版（冻结，按需引用其器官谱系与调参经验）：

- `packages/sim` — 确定性生存/生态核心（纯 TS、固定 20Hz tick、seeded RNG）。
  禁止 Date.now / Math.random / 渲染依赖。
- `packages/content` — 物种/世界/节奏参数，纯数据。调手感只改 tuning.ts。
- `packages/client` — Three.js 灰盒渲染壳＋HTML HUD。sim 状态之外不得持有游戏逻辑。
