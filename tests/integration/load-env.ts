// Carrega .env.local e depois .env com a mesma precedência do Next (ambiente > .env.local > .env).
// `process.loadEnvFile` não sobrescreve variáveis já definidas. Nenhum valor é impresso.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function loadTestEnv(root: string = fileURLToPath(new URL("../../", import.meta.url))): void {
  for (const name of [".env.local", ".env"]) {
    const path = `${root.replace(/[\\/]$/, "")}/${name}`;
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

// Executado como setupFile em cada worker (forks), antes de importar o arquivo de teste.
loadTestEnv();
