import { existsSync } from "node:fs";

// Mesma precedência do Next: variáveis do terminal > .env.local > .env.
// loadEnvFile não sobrescreve variáveis já definidas; nenhum valor é impresso.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const mode = process.env.WALLET_PROVIDER ?? "simulated";

function fail(messages) {
  console.error("Preflight da PoC Sepolia falhou:");
  for (const message of messages) console.error(`- ${message}`);
  console.error("Nenhum valor de variável de ambiente foi exibido.");
  process.exitCode = 1;
}

function isAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
}

function isPrivateKey(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value) && !/^0x0{64}$/i.test(value);
}

function isHttpsUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

if (mode === "simulated") {
  console.log("Preflight: modo simulated ativo; nenhuma configuração externa é necessária.");
} else if (mode !== "privy") {
  fail(["WALLET_PROVIDER deve ser 'simulated' ou 'privy'."]);
} else {
  const errors = [];
  // PIMLICO_API_KEY: bundler ERC-4337 das UserOperations da smart account (somente servidor).
  const requiredText = ["PRIVY_APP_ID", "PRIVY_APP_SECRET", "PIMLICO_API_KEY"];
  for (const name of requiredText) {
    if (!process.env[name]?.trim()) errors.push(`${name} está ausente ou vazio.`);
  }

  if (!isHttpsUrl(process.env.ALCHEMY_RPC_URL)) {
    errors.push("ALCHEMY_RPC_URL deve ser uma URL HTTPS válida.");
  }
  if (!isAddress(process.env.MOCK_USDC_ADDRESS)) {
    errors.push("MOCK_USDC_ADDRESS deve ser um endereço Ethereum não nulo.");
  }
  if (!isAddress(process.env.TREASURY_ADDRESS)) {
    errors.push("TREASURY_ADDRESS deve ser um endereço Ethereum não nulo.");
  }
  if (!isPrivateKey(process.env.TREASURY_PRIVATE_KEY)) {
    errors.push("TREASURY_PRIVATE_KEY deve ter o formato 0x seguido de 64 caracteres hexadecimais e não pode ser nula.");
  }

  if (errors.length > 0) {
    fail(errors);
  } else {
    console.log("Preflight: variáveis obrigatórias da PoC Sepolia presentes e com formato local válido.");
    console.log("Este comando não autenticou, não consultou a rede e não confirmou contrato, saldos ou permissões.");
  }
}
