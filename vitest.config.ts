import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integração Sepolia (rede real) roda só via `npm run test:integration`.
    exclude: [...configDefaults.exclude, "tests/integration/**"],
    environment: "node",
    pool: "forks",        // node:sqlite + process.env isolados por arquivo
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
