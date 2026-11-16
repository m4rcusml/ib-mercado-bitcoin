import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    pool: "forks",        // node:sqlite + process.env isolados por arquivo
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
