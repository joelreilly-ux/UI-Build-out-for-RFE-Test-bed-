import assert from "node:assert/strict";
import { createBenchmarkState } from "../app/interaction-state.ts";

const benchmark = createBenchmarkState();
assert.equal(benchmark.modules.length, 32, "benchmark must contain 32 modules");
assert.equal(benchmark.connections.length, 32, "benchmark must contain 32 Threads");

console.log("Stress fixture verified: 32 modules / 32 Threads.");
console.log("1. Run: pnpm dev");
console.log("2. Open: http://localhost:3000");
console.log("3. In Preset, choose RFE_32x32_Benchmark.");
console.log("4. Start Test Session and interact for 10–15 minutes.");
