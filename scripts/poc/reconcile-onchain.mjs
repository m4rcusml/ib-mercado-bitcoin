// Reconciliação ledger × Sepolia (SOMENTE LEITURA). Não envia transações e não altera o SQLite.
// Uso: npm run reconcile:onchain
//
// Para cada conta com smart account vinculada compara o saldo de wallet do ledger
// (wallet_cents + wallet_reserved, em centavos, + wallet_remainder em micros = unidades de 6 casas)
// com `balanceOf(smartAccount)` do Mock USDC na Sepolia. Imprime também os saldos on-chain da
// tesouraria e um resumo das transferências por status. Sai com código 1 se houver divergência.
//
// Limitações conhecidas:
// - Depósitos feitos fora do app diretamente na smart account (ex.: mint/transfer manual) aparecem
//   como DIVERGENTE, pois o ledger só registra movimentos originados no bridge.
// - Operações em aberto (processing/submitted/unknown/awaiting_user_signature) podem divergir de forma
//   transitória: a rede já liquidou e o observador ainda não. Elas são sinalizadas na linha da conta.
//
// Ambiente: ambiente > .env.local > .env (sem sobrescrever, sem imprimir valores). Banco:
// MB_DATABASE_PATH ou data/bridge-sepolia.sqlite, aberto em modo somente leitura. Nunca imprime segredos
// nem URLs do RPC; e-mails saem mascarados.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createPublicClient, formatEther, formatUnits, getAddress, http, isAddress } from "viem";
import { sepolia } from "viem/chains";

const DECIMALS = 6;
const UNITS_PER_CENT = 10_000n;
const SEPOLIA_CHAIN_ID = 11155111;
const OPEN_STATUSES = new Set(["processing", "awaiting_user_signature", "submitted", "unknown"]);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

function loadEnvFiles() {
  const loaded = [];
  for (const name of [".env.local", ".env"]) {
    const path = resolve(ROOT, name);
    if (!existsSync(path)) continue;
    process.loadEnvFile(path);
    loaded.push(name);
  }
  return loaded;
}

/** Mensagem de erro segura: só o nome do tipo, para não vazar URL/chave embutida. */
const safeError = (error) => (error && typeof error === "object" && "name" in error ? String(error.name) : "erro");

/** `isaac@example.com` -> `is***@example.com`. */
function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

const fmt = (units) => formatUnits(units, DECIMALS);

async function main() {
  const loaded = loadEnvFiles();
  console.log(loaded.length
    ? `Info  ${loaded.join(" e ")} carregado(s) (valores não exibidos).`
    : "Info  nenhum .env/.env.local encontrado; usando apenas o ambiente.");

  const rpcUrl = process.env.ALCHEMY_RPC_URL?.trim();
  const token = process.env.MOCK_USDC_ADDRESS?.trim();
  const treasury = process.env.TREASURY_ADDRESS?.trim();
  let rpcOk = false;
  try {
    rpcOk = !!rpcUrl && new URL(rpcUrl).protocol === "https:";
  } catch {}
  if (!rpcOk || !token || !isAddress(token, { strict: false })) {
    console.log("FAIL  ALCHEMY_RPC_URL (HTTPS) e MOCK_USDC_ADDRESS são obrigatórios.");
    return 2;
  }

  const dbPath = process.env.MB_DATABASE_PATH?.trim() ? resolve(process.env.MB_DATABASE_PATH.trim()) : resolve(ROOT, "data/bridge-sepolia.sqlite");
  if (!existsSync(dbPath)) {
    console.log("FAIL  banco SQLite não encontrado (MB_DATABASE_PATH ou data/bridge-sepolia.sqlite).");
    return 2;
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { retryCount: 2, timeout: 20_000 }) });

  try {
    const chainId = await client.getChainId();
    if (chainId !== SEPOLIA_CHAIN_ID) {
      console.log(`FAIL  chainId = ${chainId}, esperado ${SEPOLIA_CHAIN_ID}.`);
      return 2;
    }
    const tokenAddress = getAddress(token);
    const balanceOf = (address) => client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [address] });

    console.log("\n== Tesouraria ==");
    if (treasury && isAddress(treasury, { strict: false })) {
      const [eth, units] = await Promise.all([client.getBalance({ address: treasury }), balanceOf(treasury)]);
      console.log(`${getAddress(treasury)}  ${fmt(units)} mUSDC  ${formatEther(eth)} ETH`);
    } else {
      console.log("TREASURY_ADDRESS ausente ou inválido; saldos da tesouraria não consultados.");
    }

    const accounts = db.prepare(`SELECT id, email, wallet_address, owner_address, wallet_cents, wallet_reserved, wallet_remainder
      FROM accounts WHERE wallet_address IS NOT NULL AND owner_address IS NOT NULL ORDER BY email`).all();
    const openByAccount = new Map(
      db.prepare(`SELECT account_id, COUNT(*) AS n FROM transfers
        WHERE status IN ('processing', 'awaiting_user_signature', 'submitted', 'unknown') GROUP BY account_id`).all()
        .map((row) => [row.account_id, Number(row.n)]),
    );

    console.log(`\n== Contas com smart account vinculada (${accounts.length}) ==`);
    let divergent = 0;
    for (const account of accounts) {
      const smart = String(account.wallet_address);
      const available = BigInt(account.wallet_cents) * UNITS_PER_CENT;
      const reserved = BigInt(account.wallet_reserved) * UNITS_PER_CENT;
      const remainder = BigInt(account.wallet_remainder ?? 0);
      const ledgerUnits = available + reserved + remainder;
      let line = `${maskEmail(account.email)}  ${isAddress(smart, { strict: false }) ? getAddress(smart) : smart}\n`
        + `    ledger: disponível ${fmt(available + remainder)} + reservado ${fmt(reserved)} = ${fmt(ledgerUnits)} mUSDC`;
      let ok = false;
      try {
        const chainUnits = await balanceOf(smart);
        ok = chainUnits === ledgerUnits;
        line += `\n    on-chain: ${fmt(chainUnits)} mUSDC  -> ${ok ? "OK" : `DIVERGENTE (diferença ${fmt(chainUnits - ledgerUnits)})`}`;
      } catch (error) {
        line += `\n    on-chain: erro ao consultar (${safeError(error)})  -> DIVERGENTE`;
      }
      const open = openByAccount.get(account.id) ?? 0;
      if (open > 0) line += `\n    aviso: ${open} operação(ões) em aberto; a divergência pode ser transitória.`;
      if (!ok) divergent += 1;
      console.log(line);
    }

    console.log("\n== Transferências por status ==");
    const summary = db.prepare(`SELECT direction, status, COUNT(*) AS n, SUM(amount_cents) AS cents
      FROM transfers GROUP BY direction, status ORDER BY direction, status`).all();
    if (summary.length === 0) console.log("(nenhuma)");
    for (const row of summary) {
      const cents = BigInt(row.cents ?? 0);
      const flag = OPEN_STATUSES.has(String(row.status)) ? " (em aberto)" : "";
      console.log(`${String(row.direction).padEnd(13)} ${String(row.status).padEnd(24)} ${String(row.n).padStart(4)}  ${fmt(cents * UNITS_PER_CENT)} mUSDC${flag}`);
    }

    console.log(divergent > 0
      ? `\n${divergent} conta(s) DIVERGENTE(s). Depósitos externos na smart account também aparecem como divergência.`
      : "\nLedger e Sepolia conciliados.");
    return divergent > 0 ? 1 : 0;
  } finally {
    db.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.log(`FAIL  erro inesperado (${safeError(error)})`);
  process.exitCode = 2;
}
