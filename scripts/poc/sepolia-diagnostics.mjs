// Diagnóstico da PoC Sepolia: consulta a rede e confirma chain, contrato,
// saldos da tesouraria e o bundler Pimlico (EntryPoint v0.6). Nunca imprime
// segredos nem as URLs do RPC/bundler.
// Uso: npm run diagnose:sepolia
import { existsSync } from "node:fs";
import { createPublicClient, formatEther, formatUnits, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SEPOLIA_CHAIN_ID = 11155111;
const EXPECTED_DECIMALS = 6;
/** EntryPoint usado por `toCoinbaseSmartAccount` (viem 2.57.x). */
const ENTRY_POINT_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

/**
 * Mesma precedência do Next: ambiente > .env.local > .env. Não sobrescreve
 * variáveis já definidas e não imprime valores. Retorna os arquivos lidos.
 */
function loadEnvFiles() {
  const loaded = [];
  for (const name of [".env.local", ".env"]) {
    const path = new URL(`../../${name}`, import.meta.url);
    if (!existsSync(path)) continue;
    process.loadEnvFile(path);
    loaded.push(name);
  }
  return loaded;
}

let failures = 0;
const pass = (msg) => console.log(`PASS  ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.log(`FAIL  ${msg}`);
};
/** Mensagem de erro segura: só o nome do tipo, para não vazar URL/chave embutida. */
const safeError = (error) => (error && typeof error === "object" && "name" in error ? String(error.name) : "erro");

async function main() {
  const loaded = loadEnvFiles();
  console.log(loaded.length
    ? `Info  ${loaded.join(" e ")} carregado(s) (valores não exibidos).`
    : "Info  nenhum .env/.env.local encontrado; usando apenas o ambiente.");

  const rpcUrl = process.env.ALCHEMY_RPC_URL?.trim();
  const token = process.env.MOCK_USDC_ADDRESS?.trim();
  const treasury = process.env.TREASURY_ADDRESS?.trim();
  const key = process.env.TREASURY_PRIVATE_KEY?.trim();

  let rpcOk = false;
  try {
    rpcOk = !!rpcUrl && new URL(rpcUrl).protocol === "https:";
  } catch {}
  rpcOk ? pass("ALCHEMY_RPC_URL presente (HTTPS)") : fail("ALCHEMY_RPC_URL ausente ou não-HTTPS");
  const tokenOk = !!token && isAddress(token, { strict: false });
  tokenOk ? pass("MOCK_USDC_ADDRESS com formato válido") : fail("MOCK_USDC_ADDRESS ausente ou inválido");
  const treasuryOk = !!treasury && isAddress(treasury, { strict: false });
  treasuryOk ? pass("TREASURY_ADDRESS com formato válido") : fail("TREASURY_ADDRESS ausente ou inválido");

  if (key) {
    try {
      const derived = privateKeyToAccount(key).address;
      treasuryOk && derived.toLowerCase() === treasury.toLowerCase()
        ? pass("TREASURY_PRIVATE_KEY corresponde a TREASURY_ADDRESS")
        : fail("TREASURY_PRIVATE_KEY não corresponde a TREASURY_ADDRESS");
    } catch {
      fail("TREASURY_PRIVATE_KEY com formato inválido");
    }
  } else {
    fail("TREASURY_PRIVATE_KEY ausente");
  }

  await checkPimlico(process.env.PIMLICO_API_KEY?.trim());

  if (!rpcOk) return;
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 1, timeout: 15_000 }) });

  try {
    const chainId = await client.getChainId();
    chainId === SEPOLIA_CHAIN_ID ? pass(`chainId = ${chainId} (Sepolia)`) : fail(`chainId = ${chainId}, esperado ${SEPOLIA_CHAIN_ID}`);
  } catch (error) {
    fail(`não foi possível consultar chainId (${safeError(error)})`);
    return;
  }

  if (tokenOk) {
    try {
      const code = await client.getCode({ address: token });
      code && code !== "0x" ? pass("token possui bytecode") : fail("token sem bytecode no endereço configurado");
    } catch (error) {
      fail(`falha ao ler bytecode do token (${safeError(error)})`);
    }
    try {
      const decimals = await client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
      Number(decimals) === EXPECTED_DECIMALS ? pass(`decimals() = ${decimals}`) : fail(`decimals() = ${decimals}, esperado ${EXPECTED_DECIMALS}`);
    } catch (error) {
      fail(`falha ao ler decimals() (${safeError(error)})`);
    }
  }

  if (treasuryOk) {
    try {
      const wei = await client.getBalance({ address: treasury });
      wei > 0n ? pass(`tesouraria possui ${formatEther(wei)} ETH`) : fail("tesouraria sem ETH Sepolia para gas");
    } catch (error) {
      fail(`falha ao ler saldo ETH da tesouraria (${safeError(error)})`);
    }
    if (tokenOk) {
      try {
        const units = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [treasury] });
        units > 0n
          ? pass(`tesouraria possui ${formatUnits(units, EXPECTED_DECIMALS)} mUSDC`)
          : fail("tesouraria sem saldo de Mock USDC");
      } catch (error) {
        fail(`falha ao ler saldo de Mock USDC da tesouraria (${safeError(error)})`);
      }
    }
  }
}

/** Chama `eth_supportedEntryPoints` no Pimlico Sepolia e exige o EntryPoint v0.6. */
async function checkPimlico(apiKey) {
  if (!apiKey) {
    fail("PIMLICO_API_KEY ausente");
    return;
  }
  pass("PIMLICO_API_KEY presente (valor não exibido)");
  try {
    const response = await fetch(`https://api.pimlico.io/v2/sepolia/rpc?apikey=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_supportedEntryPoints", params: [] }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || !Array.isArray(body.result)) {
      fail(`Pimlico não respondeu eth_supportedEntryPoints (HTTP ${response.status}); confira PIMLICO_API_KEY`);
      return;
    }
    body.result.some((entry) => typeof entry === "string" && entry.toLowerCase() === ENTRY_POINT_V06.toLowerCase())
      ? pass(`Pimlico Sepolia suporta EntryPoint v0.6 (${ENTRY_POINT_V06})`)
      : fail("Pimlico Sepolia não lista o EntryPoint v0.6 em eth_supportedEntryPoints");
  } catch (error) {
    fail(`falha ao consultar o bundler Pimlico (${safeError(error)})`);
  }
}

try {
  await main();
} catch (error) {
  fail(`erro inesperado (${safeError(error)})`);
}

if (failures > 0) {
  console.log(`\n${failures} verificação(ões) falharam. Nenhum segredo foi exibido.`);
  process.exitCode = 1;
} else {
  console.log("\nDiagnóstico Sepolia concluído sem falhas.");
}
