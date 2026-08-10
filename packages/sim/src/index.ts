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
