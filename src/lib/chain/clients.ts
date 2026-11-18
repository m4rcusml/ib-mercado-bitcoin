// SERVER-ONLY: este módulo lê a chave privada da tesouraria. Nunca importe de
// componentes cliente ("use client") nem exponha seus valores ao browser.
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isAddress,
  isAddressEqual,
  keccak256,
  type Hex,
  type PublicClient,
} from "viem";
import { createBundlerClient, type RpcUserOperation } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { ReceiptReader } from "./receipt-verifier.ts";
import { createUserOperationReader, ENTRY_POINT_V06, type UserOperationReader } from "./smart-account.ts";
import { createTreasurySender, type TreasurySender } from "./treasury-sender.ts";
import { mockUsdcAbi, MOCK_USDC_DECIMALS } from "./mock-usdc.ts";
import { BridgeError } from "../domain/money.ts";
import type { PersistedOperation } from "../wallet/wallet-provider.ts";

export interface SepoliaConfig {
  rpcUrl: string;
  /** Chave do bundler Pimlico (somente servidor). Use `pimlicoBundlerUrl()` para montar a URL. */
  pimlicoApiKey: string;
  token: `0x${string}`;
  treasuryAddress: `0x${string}`;
  treasuryPrivateKey: `0x${string}`;
}

const ZERO_ADDRESS = /^0x0{40}$/i;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const ZERO_KEY = /^0x0{64}$/i;
/** Formato aceito para a chave Pimlico (ex.: `pim_...`); nunca é exibida em mensagens. */
const PIMLICO_KEY = /^[A-Za-z0-9_-]{8,256}$/;

/** URL do bundler Pimlico em Sepolia. Contém a chave: nunca registre nem devolva ao cliente. */
export function pimlicoBundlerUrl(apiKey: string): string {
  return `https://api.pimlico.io/v2/sepolia/rpc?apikey=${encodeURIComponent(apiKey)}`;
}

/** Upstreams usados pelo proxy JSON-RPC do browser (somente servidor). */
export interface RpcUpstreams {
  rpcUrl: string;
  bundlerUrl: string;
}

/**
 * Lê apenas `ALCHEMY_RPC_URL` e `PIMLICO_API_KEY` (o proxy não precisa da tesouraria).
 * As mensagens citam somente os nomes das variáveis.
 */
export function readRpcUpstreams(env: Readonly<Record<string, string | undefined>> = process.env): RpcUpstreams {
  const rpcUrl = env.ALCHEMY_RPC_URL?.trim();
  const apiKey = env.PIMLICO_API_KEY?.trim();
  const errors: string[] = [];
  if (!validHttpsUrl(rpcUrl)) errors.push("ALCHEMY_RPC_URL deve ser uma URL HTTPS válida.");
  if (!apiKey || !PIMLICO_KEY.test(apiKey)) errors.push("PIMLICO_API_KEY deve estar configurada (8 a 256 caracteres [A-Za-z0-9_-]).");
  if (errors.length > 0 || !rpcUrl || !apiKey) throw new Error(`Configuração Sepolia inválida: ${errors.join(" ")}`);
  return { rpcUrl, bundlerUrl: pimlicoBundlerUrl(apiKey) };
}

function validAddress(value: string | undefined): value is `0x${string}` {
  return typeof value === "string" && isAddress(value, { strict: false }) && !ZERO_ADDRESS.test(value);
}

function validHttpsUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Lê e valida a configuração Sepolia. As mensagens de erro citam apenas o nome
 * das variáveis, nunca seus valores.
 */
export function readSepoliaConfig(env: Readonly<Record<string, string | undefined>> = process.env): SepoliaConfig {
  const rpcUrl = env.ALCHEMY_RPC_URL?.trim();
  const token = env.MOCK_USDC_ADDRESS?.trim();
  const treasuryAddress = env.TREASURY_ADDRESS?.trim();
  const treasuryPrivateKey = env.TREASURY_PRIVATE_KEY?.trim();
  const pimlicoApiKey = env.PIMLICO_API_KEY?.trim();

  const errors: string[] = [];
  if (!validHttpsUrl(rpcUrl)) errors.push("ALCHEMY_RPC_URL deve ser uma URL HTTPS válida.");
  if (!pimlicoApiKey || !PIMLICO_KEY.test(pimlicoApiKey)) {
    errors.push("PIMLICO_API_KEY deve estar configurada (8 a 256 caracteres [A-Za-z0-9_-]).");
  }
  if (!validAddress(token)) errors.push("MOCK_USDC_ADDRESS deve ser um endereço Ethereum não nulo.");
  if (!validAddress(treasuryAddress)) errors.push("TREASURY_ADDRESS deve ser um endereço Ethereum não nulo.");
  const keyOk =
    typeof treasuryPrivateKey === "string" && PRIVATE_KEY.test(treasuryPrivateKey) && !ZERO_KEY.test(treasuryPrivateKey);
  if (!keyOk) {
    errors.push("TREASURY_PRIVATE_KEY deve ser 0x seguido de 64 caracteres hexadecimais e não pode ser nula.");
  }
  if (errors.length > 0 || !rpcUrl || !pimlicoApiKey || !token || !treasuryAddress || !treasuryPrivateKey) {
    throw new Error(`Configuração Sepolia inválida: ${errors.join(" ")}`);
  }

  const key = treasuryPrivateKey as `0x${string}`;
  let derived: `0x${string}`;
  try {
    derived = privateKeyToAccount(key).address;
  } catch {
    throw new Error("Configuração Sepolia inválida: TREASURY_PRIVATE_KEY não é uma chave secp256k1 válida.");
  }
  if (!isAddressEqual(derived, treasuryAddress as `0x${string}`)) {
    throw new Error("Configuração Sepolia inválida: TREASURY_PRIVATE_KEY não corresponde a TREASURY_ADDRESS.");
  }

  return {
    rpcUrl,
    pimlicoApiKey,
    token: token as `0x${string}`,
    treasuryAddress: derived, // forma checksum
    treasuryPrivateKey: key,
  };
}

export function createSepoliaClients(cfg: SepoliaConfig): {
  publicClient: ReceiptReader & PublicClient;
  treasury: TreasurySender;
  userOperations: UserOperationReader;
  initialize(): Promise<void>;
  broadcast(operation: PersistedOperation, signedPayload: string): Promise<void>;
} {
  const transport = http(cfg.rpcUrl, { retryCount: 0 });
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const account = privateKeyToAccount(cfg.treasuryPrivateKey);
  const walletClient = createWalletClient({ account, chain: sepolia, transport });

  const treasury = createTreasurySender({
    token: cfg.token,
    walletClient: {
      account,
      async signTransfer(args) {
        await initialize();
        const simulation = await publicClient.simulateContract({ ...args, account });
        if (!simulation.result) throw new BridgeError("TREASURY_TRANSFER_REJECTED", "O contrato recusou a transferência da tesouraria.", 409);
        const request = await walletClient.prepareTransactionRequest({
          to: args.address,
          data: encodeFunctionData(args),
          type: "eip1559",
        });
        const signedPayload = await account.signTransaction({ ...request, chainId: sepolia.id });
        return { txHash: keccak256(signedPayload), signedPayload };
      },
    },
  });

  const bundlerClient = createBundlerClient({
    client: publicClient,
    chain: sepolia,
    transport: http(pimlicoBundlerUrl(cfg.pimlicoApiKey), { retryCount: 0 }),
  });
  const userOperations = createUserOperationReader({
    getUserOperationReceipt: (args) => bundlerClient.getUserOperationReceipt(args),
  });

  let validation: Promise<void> | undefined;
  function initialize() {
    validation ??= validateSepolia(publicClient, cfg.token).catch((error) => {
      validation = undefined;
      throw error;
    });
    return validation;
  }

  return {
    publicClient: publicClient as ReceiptReader & PublicClient,
    treasury,
    userOperations,
    initialize,
    async broadcast(operation, signedPayload) {
      await initialize();
      if (operation.direction === "mb_to_wallet") {
        const hash = await publicClient.sendRawTransaction({ serializedTransaction: signedPayload as Hex });
        if (hash.toLowerCase() !== operation.txHash) throw new Error("O RPC retornou um hash diferente da transação assinada.");
      } else {
        const userOperation = JSON.parse(signedPayload) as RpcUserOperation<"0.6">;
        const hash = await bundlerClient.request({ method: "eth_sendUserOperation", params: [userOperation, ENTRY_POINT_V06] });
        if (hash.toLowerCase() !== operation.userOpHash) throw new Error("O bundler retornou um hash diferente da UserOperation assinada.");
      }
    },
  };
}

export async function validateSepolia(client: Pick<PublicClient, "getChainId" | "getCode" | "readContract">, token: Hex): Promise<void> {
  try {
    const [chainId, code, decimals] = await Promise.all([
      client.getChainId(),
      client.getCode({ address: token }),
      client.readContract({ address: token, abi: mockUsdcAbi, functionName: "decimals" }),
    ]);
    if (chainId === sepolia.id && code && code !== "0x" && decimals === MOCK_USDC_DECIMALS) return;
  } catch {
    throw new BridgeError("SEPOLIA_UNAVAILABLE", "Falha ao verificar a rede e o contrato Mock USDC.", 503);
  }
  throw new BridgeError("INVALID_SEPOLIA_CONFIG", "Verifique a rede Sepolia, o bytecode do Mock USDC e as seis casas decimais.", 503);
}
