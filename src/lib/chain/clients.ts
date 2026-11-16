// SERVER-ONLY: este módulo lê a chave privada da tesouraria. Nunca importe de
// componentes cliente ("use client") nem exponha seus valores ao browser.
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  isAddressEqual,
  type PublicClient,
} from "viem";
import { createBundlerClient } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { ReceiptReader } from "./receipt-verifier.ts";
import { createUserOperationReader, type UserOperationReader } from "./smart-account.ts";
import { createTreasurySender, type TreasurySender } from "./treasury-sender.ts";

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
} {
  const transport = http(cfg.rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const account = privateKeyToAccount(cfg.treasuryPrivateKey);
  const walletClient = createWalletClient({ account, chain: sepolia, transport });

  const treasury = createTreasurySender({
    token: cfg.token,
    walletClient: {
      account,
      writeContract: (args) =>
        walletClient.writeContract({
          address: args.address,
          abi: args.abi,
          functionName: "transfer",
          args: [args.args[0], args.args[1]],
          account,
          chain: sepolia,
        }),
    },
  });

  const bundlerClient = createBundlerClient({
    client: publicClient,
    chain: sepolia,
    transport: http(pimlicoBundlerUrl(cfg.pimlicoApiKey)),
  });
  const userOperations = createUserOperationReader({
    getUserOperationReceipt: (args) => bundlerClient.getUserOperationReceipt(args),
  });

  return { publicClient: publicClient as ReceiptReader & PublicClient, treasury, userOperations };
}
