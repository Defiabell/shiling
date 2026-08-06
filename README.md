# 食灵 Shiling

山海经世界的单机 3D 生存进化游戏（开发中）。设计文档见
`docs/plans/shiling/2026-08-06-shiling-design.md`（workspace 仓库）。

## 当前状态：M0 战斗沙盒（灰盒）

青丘灰盒：走·游·掘三态生存，苓鼠—幼兽—潭狩最小食物链。

## 开发

    pnpm install
    pnpm dev        # http://localhost:5173
    pnpm test       # sim 全部测试
    pnpm typecheck

## 结构

- `packages/sim` — 确定性生存/生态核心（纯 TS、固定 20Hz tick、seeded RNG）。
  禁止 Date.now / Math.random / 渲染依赖。
- `packages/content` — 物种/世界/节奏参数，纯数据。调手感只改 tuning.ts。
- `packages/client` — Three.js 灰盒渲染壳＋HTML HUD。sim 状态之外不得持有游戏逻辑。
