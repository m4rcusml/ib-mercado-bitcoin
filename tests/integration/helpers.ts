// Utilitários da suíte de integração Sepolia (rede real). Nunca imprime valores de variáveis:
// ALCHEMY_RPC_URL e a URL do Pimlico embutem chaves de API.
import { createPublicClient, custom, decodeEventLog, http, isAddressEqual, parseAbiItem, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { mockUsdcAbi } from "../../src/lib/chain/index.ts";

type Hex = `0x${string}`;

/** Variáveis exigidas pela suíte somente leitura. */
export const READ_ENV = ["ALCHEMY_RPC_URL", "PIMLICO_API_KEY", "MOCK_USDC_ADDRESS", "TREASURY_ADDRESS"] as const;
/** Variáveis adicionais exigidas pela suíte de escrita (opt-in). */
export const WRITE_ENV = [...READ_ENV, "TREASURY_PRIVATE_KEY"] as const;

/** Nomes (nunca valores) das variáveis ausentes. */
export function missingEnv(names: readonly string[]): string[] {
  return names.filter((name) => !process.env[name]?.trim());
}

export function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável ${name} ausente.`);
  return value;
}

const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * Erros do transporte HTTP do viem citam a URL do RPC (com a chave). Reempacota o erro mantendo
 * `code`/`data` (o viem ainda classifica o erro JSON-RPC), mas sem URL e sem `cause`.
 */
function scrubbedError(error: unknown): Error {
  const source = error as { name?: unknown; shortMessage?: unknown; message?: unknown; code?: unknown; data?: unknown } | null;
  const text = typeof source?.shortMessage === "string" ? source.shortMessage : typeof source?.message === "string" ? source.message : "erro de RPC";
  const scrubbed = Object.assign(new Error(text.split("\n")[0].replace(URL_PATTERN, "[url omitida]")), {
    code: source?.code,
    data: source?.data,
  });
  scrubbed.name = typeof source?.name === "string" ? source.name : "RpcError";
  return scrubbed;
}

export function sepoliaPublicClient(): PublicClient {
  const inner = http(env("ALCHEMY_RPC_URL"), { retryCount: 2, timeout: 20_000 })({ chain: sepolia, retryCount: 2 });
  const transport = custom({
    async request(args: { method: string; params?: unknown }) {
      try {
        return await inner.request(args as never);
      } catch (error) {
        throw scrubbedError(error);
      }
    },
  }, { retryCount: 0 }); // o transporte interno já faz as novas tentativas
  return createPublicClient({ chain: sepolia, transport });
}

/** Mensagem de erro segura (somente o tipo), para não vazar URLs com chave em asserts. */
export function safeError(error: unknown): string {
  return error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "erro";
}

export interface HistoricalTransfer {
  txHash: Hex;
  from: Hex;
  to: Hex;
  value: bigint;
  blockNumber: bigint;
}

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/**
 * Encontra o `Transfer` mais recente do token cuja origem é a tesouraria.
 * 1) `alchemy_getAssetTransfers` (o plano gratuito da Alchemy limita `eth_getLogs` a 10 blocos);
 * 2) fallback: `eth_getLogs` em janelas adaptativas (começa em 10k blocos e reduz até 10 quando o RPC
 *    recusa), varrendo no máximo `maxBlocks` para trás com um orçamento de chamadas.
 * Em ambos os casos o evento é relido do receipt real e decodificado com o ABI do token.
 */
export async function findTreasuryTransfer(
  client: PublicClient,
  token: Hex,
  treasury: Hex,
  { maxBlocks = 50_000n, maxCalls = 300 } = {},
): Promise<HistoricalTransfer | null> {
  let txHash: Hex | null = null;
  try {
    const result = (await client.request({
      method: "alchemy_getAssetTransfers" as never,
      params: [{
        fromBlock: "0x0",
        toBlock: "latest",
        fromAddress: treasury,
        contractAddresses: [token],
        category: ["erc20"],
        order: "desc",
        excludeZeroValue: true,
        maxCount: "0x5",
      }] as never,
    })) as { transfers?: { hash?: string }[] };
    const hash = result.transfers?.find((t) => typeof t.hash === "string")?.hash;
    if (hash) txHash = hash as Hex;
  } catch {
    // RPC sem a API estendida da Alchemy: cai para eth_getLogs.
  }

  if (!txHash) {
    const latest = await client.getBlockNumber();
    const floor = latest > maxBlocks ? latest - maxBlocks : 0n;
    let span = 10_000n;
    let toBlock = latest;
    let calls = 0;
    while (toBlock > floor && calls < maxCalls && !txHash) {
      const fromBlock = toBlock - span + 1n > floor ? toBlock - span + 1n : floor;
      calls += 1;
      try {
        const logs = await client.getLogs({ address: token, event: TRANSFER_EVENT, args: { from: treasury }, fromBlock, toBlock });
        if (logs.length > 0) txHash = logs[logs.length - 1].transactionHash;
        toBlock = fromBlock - 1n;
      } catch {
        if (span <= 10n) throw new Error("eth_getLogs recusado mesmo com janela de 10 blocos.");
        span = span / 10n < 10n ? 10n : span / 10n;
      }
    }
  }
  if (!txHash) return null;

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, token)) continue;
    try {
      const { args } = decodeEventLog({ abi: mockUsdcAbi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
      if (isAddressEqual(args.from, treasury)) {
        return { txHash, from: args.from, to: args.to, value: args.value, blockNumber: receipt.blockNumber };
      }
    } catch {
      continue;
    }
  }
  return null;
}
