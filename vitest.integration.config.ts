// Suíte de integração Sepolia (rede real). Não faz parte de `npm test`.
// Uso: npm run test:integration            (somente leitura)
//      POC_INTEGRATION_WRITE=1 npm run test:integration   (inclui o teste que gasta gas da tesouraria)
// As variáveis vêm do ambiente, de .env.local e de .env (sem sobrescrever e sem imprimir valores);
// testes cujo ambiente está incompleto são pulados.
import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./tests/integration/load-env.ts";

loadTestEnv();

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.int.test.ts"],
    environment: "node",
    pool: "forks",
    setupFiles: ["tests/integration/load-env.ts"],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    fileParallelism: false, // evita estourar o rate limit do RPC/bundler gratuitos
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
