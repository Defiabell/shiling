export * from "./state.js";
export * from "./sim.js";
export * from "./terrain.js";
export * from "./vec.js";
export * from "./dormancy.js";
// M1 B6：此前 getModifiers/tickTemper 只被 sim 包内部（movement/eating/digging/ai）
// 通过相对路径消费，从未经公开 API 出口——main.ts 的 __shiling 调试探针（B6 端到端
// 联调需要直接 probe 器官效果数值，而不是靠"实测移动速度"这种带噪声的间接验证）是第一个
// 需要从包外调用 getModifiers 的消费方，因此在这里补上公开出口，与 isDormancyEligible
// （dormancy.js 已整体 export *）同一惯例。
export * from "./organs.js";
export { createRng, type Rng } from "./rng.js";
// M15 P1（反制包）：陷坑数据模型/踩踏判定 + 濒死爆发，client 侧（HUD/simEvents 差分）
// 需要 addPit 之外的类型信息（Pit 已经随 state.ts 的 `export *` 一并导出），tickPitSnares/
// tickAdrenaline 本身只被 sim.ts 内部消费，公开导出是为了让 dev-only 验证钩子（main.ts
// 的 __shiling，同 isDormancyEligible/getModifiers 的既有惯例）与未来 Playwright 脚本
// 有直接的包外调用入口，不强行反查 sim 内部实现。
export * from "./pits.js";
export * from "./adrenaline.js";
