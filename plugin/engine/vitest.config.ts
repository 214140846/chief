import { defineConfig } from "vitest/config";

// 命令行测试每条都要起 node + tsx，慢一点。叫 .spec.ts 是为了不被 claude plugin test 当成面板的测试。
export default defineConfig({ test: { include: ["test/**/*.spec.ts"], testTimeout: 30_000 } });
