// SERVER-ONLY: usa a tesouraria e o segredo do app Privy. Nunca importe em componentes cliente.
import { PrivyClient } from "@privy-io/server-auth";
import { createPublicClient, getAddress, http, isAddress, isAddressEqual } from "viem";
import { sepolia } from "viem/chains";
import {
  centsToUnits,
  createSepoliaClients,
  deriveSmartAccountAddress,
  ENTRY_POINT_V06,
  readRpcUpstreams,
  readSepoliaConfig,
  verifyTransfer,
} from "../chain/index.ts";
import type {
  ExpectedTransfer,
  ReceiptReader,
  SmartAccountClient,
  TreasurySender,
  UserOperationReader,
  UserOperationReceiptLike,
  VerificationResult,
} from "../chain/index.ts";
import type { Direction, SignatureRequest } from "../domain/contracts.ts";
import { BridgeError } from "../domain/money.ts";
import { registerPrivyFactory, SEPOLIA_CHAIN_ID } from "./wallet-provider.ts";
import type { ObservationResult, PersistedOperation, SubmitResult, TransferRoute, WalletProvider } from "./wallet-provider.ts";

type Hex = `0x${string}`;
const HASH_32 = /^0x[0-9a-fA-F]{64}$/;

export interface PrivyProviderDeps {
  /** Endereço do contrato Mock USDC (6 decimais) em Sepolia. */
  token: Hex;
  treasury: TreasurySender;
  publicClient: ReceiptReader;
  /** Bundler (Pimlico): `eth_getUserOperationReceipt`. */
  userOperations: UserOperationReader;
  initialize?: () => Promise<void>;
  broadcast?: (operation: PersistedOperation, signedPayload: string) => Promise<void>;
  /** Injetável em testes; padrão: `verifyTransfer` do módulo chain. */
  verify?: (client: ReceiptReader, expected: ExpectedTransfer) => Promise<VerificationResult>;
}

/**
 * Provider da PoC Sepolia (account abstraction ERC-4337, EntryPoint v0.6, sem paymaster).
 * O endereço operacional do usuário é a Coinbase Smart Account; a EOA embedded Privy é só dona/assinante.
 * - `mb_to_wallet`: a tesouraria (EOA server-side) envia `transfer(smartAccount, units)`; o hash fica `submitted`.
 * - `wallet_to_mb`: a operação fica `awaiting_user_signature` até o browser informar o `userOpHash`
 *   da UserOperation assinada pela EOA embedded; a observação usa o receipt do bundler.
 * Em ambos os sentidos, a liquidação depende de `verifyTransfer` (receipt + evento Transfer exatos).
 */
export class PrivyWalletProvider implements WalletProvider {
  readonly mode = "privy" as const;
  private resolved: PrivyProviderDeps | null = null;
  private readonly load: () => PrivyProviderDeps;

  constructor(deps: PrivyProviderDeps | (() => PrivyProviderDeps)) {
    this.load = typeof deps === "function" ? deps : () => deps;
  }

  private deps(): PrivyProviderDeps {
    if (!this.resolved) {
      try {
        this.resolved = this.load();
      } catch (error) {
        // readSepoliaConfig só cita nomes de variáveis, nunca valores.
        throw new BridgeError("MISSING_CONFIG", error instanceof Error ? error.message : "Configuração Sepolia inválida.", 503);
      }
    }
    return this.resolved;
  }

  activate(): never {
    throw new BridgeError(
      "WALLET_LINK_REQUIRED",
      "No modo Privy a wallet é vinculada pelo login Privy. Use POST /api/wallet/link com o token de acesso Privy.",
      409,
    );
  }

  async initialize(): Promise<void> {
    await this.deps().initialize?.();
  }

  async broadcast(operation: PersistedOperation, signedPayload: string): Promise<void> {
    const broadcast = this.deps().broadcast;
    if (!broadcast) throw new Error("Transmissão Sepolia indisponível.");
    await broadcast(operation, signedPayload);
  }

  route(direction: Direction, walletAddress: string, amountCents: bigint): TransferRoute {
    const { treasury } = this.deps();
    if (!isAddress(walletAddress, { strict: false })) {
      throw new BridgeError("WALLET_INACTIVE", "Vincule a embedded wallet Privy antes de transferir.", 409);
    }
    const wallet = getAddress(walletAddress);
    const treasuryAddress = getAddress(treasury.address);
    return direction === "mb_to_wallet"
      ? { from: treasuryAddress, to: wallet, amountUnits: centsToUnits(amountCents) }
      : { from: wallet, to: treasuryAddress, amountUnits: centsToUnits(amountCents) };
  }

  async submit(operation: PersistedOperation): Promise<SubmitResult> {
    if (operation.direction === "wallet_to_mb") return { status: "awaiting_user_signature" };
    const { treasury } = this.deps();
    if (!operation.toAddress || operation.amountUnits === null) {
      throw new BridgeError("INVALID_OPERATION", "Operação sem destino ou valor on-chain persistido.", 500);
    }
    const { txHash, signedPayload } = await treasury.prepareTransfer(operation.toAddress as Hex, operation.amountUnits);
    return { status: "submitted", txHash: txHash.toLowerCase(), ...(signedPayload && { signedPayload }) };
  }

  async observe(operation: PersistedOperation): Promise<ObservationResult> {
    await this.initialize();
    if (operation.direction === "wallet_to_mb") return this.observeUserOperation(operation);
    // Sem hash não há o que verificar; a regra de expiração do ledger decide o desfecho.
    if (!operation.txHash || !operation.fromAddress || !operation.toAddress || operation.amountUnits === null) {
      return { status: "pending" };
    }
    const { token, publicClient, verify = verifyTransfer } = this.deps();
    const result = await verify(publicClient, {
      txHash: operation.txHash as Hex,
      token,
      from: operation.fromAddress as Hex,
      to: operation.toAddress as Hex,
      units: operation.amountUnits,
      chainId: SEPOLIA_CHAIN_ID,
    });
    if (result.status === "confirmed") return { status: "confirmed" };
    if (result.status === "failed") return { status: "failed", reason: result.reason };
    return { status: "pending" };
  }

  /**
   * `wallet_to_mb`: 1) receipt da UserOperation no bundler (ausente = pending); 2) `sender` deve ser a
   * smart account reservada e o EntryPoint o v0.6; 3) `success`; 4) o `Transfer` esperado precisa estar
   * entre os logs DESTA UserOperation (um bundle pode conter outras do mesmo sender); 5) verificação
   * independente da transação do bundle via RPC (`verifyTransfer`). Erros de rede propagam (→ unknown).
   */
  private async observeUserOperation(operation: PersistedOperation): Promise<ObservationResult> {
    if (!operation.userOpHash || !operation.fromAddress || !operation.toAddress || operation.amountUnits === null) {
      return { status: "pending" };
    }
    const { token, publicClient, userOperations, verify = verifyTransfer } = this.deps();
    const receipt = await userOperations.getUserOperationReceipt(operation.userOpHash as Hex);
    if (!receipt) return { status: "pending" };
    if (receipt.userOpHash && receipt.userOpHash.toLowerCase() !== operation.userOpHash.toLowerCase()) {
      throw new Error("Bundler devolveu receipt de outra UserOperation.");
    }
    const txHash = receipt.receipt?.transactionHash;
    if (typeof txHash !== "string" || !HASH_32.test(txHash)) {
      throw new Error("Receipt da UserOperation sem hash de transação válido.");
    }
    const found = { txHash: txHash.toLowerCase() };
    if (!isAddressEqual(receipt.sender, operation.fromAddress as Hex)) {
      return { status: "failed", reason: "UserOperation enviada por outra conta: o sender não é a smart account vinculada.", ...found };
    }
    if (receipt.entryPoint && !isAddressEqual(receipt.entryPoint, ENTRY_POINT_V06)) {
      return { status: "failed", reason: "UserOperation processada por um EntryPoint inesperado.", ...found };
    }
    if (!receipt.success) return { status: "failed", reason: "UserOperation revertida no EntryPoint.", ...found };

    const expected: ExpectedTransfer = {
      txHash: txHash as Hex,
      token,
      from: operation.fromAddress as Hex,
      to: operation.toAddress as Hex,
      units: operation.amountUnits,
      chainId: SEPOLIA_CHAIN_ID,
    };
    const scoped = await verifyTransfer(userOperationLogsReader(receipt), expected);
    if (scoped.status !== "confirmed") {
      return { status: "failed", reason: "A UserOperation não emitiu o Transfer esperado (token, origem, destino ou valor divergentes).", ...found };
    }
    const result = await verify(publicClient, expected);
    if (result.status === "confirmed") return { status: "confirmed", ...found };
    if (result.status === "failed") return { status: "failed", reason: result.reason, ...found };
    return { status: "pending", ...found };
  }

  signatureRequest(operation: PersistedOperation): SignatureRequest | null {
    if (operation.direction !== "wallet_to_mb" || operation.status !== "awaiting_user_signature") return null;
    if (!operation.toAddress || !operation.fromAddress || !operation.ownerAddress || operation.amountUnits === null) return null;
    return {
      chainId: SEPOLIA_CHAIN_ID,
      token: getAddress(this.deps().token),
      to: operation.toAddress,
      amountUnits: operation.amountUnits.toString(),
      smartAccount: operation.fromAddress,
      ownerAddress: operation.ownerAddress,
      entryPoint: "0.6",
    };
  }
}

/** Expõe somente os logs da UserOperation ao `verifyTransfer` (a rede é checada na verificação via RPC). */
function userOperationLogsReader(receipt: UserOperationReceiptLike): ReceiptReader {
  return {
    getChainId: async () => SEPOLIA_CHAIN_ID,
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: receipt.receipt.blockNumber,
      logs: receipt.logs,
    }),
  };
}

export function createPrivyWalletProvider(env: NodeJS.ProcessEnv = process.env): PrivyWalletProvider {
  // Construção preguiçosa: a configuração Sepolia só é lida na primeira operação real.
  return new PrivyWalletProvider(() => {
    const config = readSepoliaConfig(env);
    return { token: config.token, ...createSepoliaClients(config) };
  });
}

registerPrivyFactory(() => createPrivyWalletProvider());

// --- Vinculação da embedded wallet ------------------------------------------

/** Subconjunto do `PrivyClient` usado para vincular a wallet; injetável em testes. */
export interface PrivyAuthClient {
  verifyAuthToken(token: string): Promise<{ userId: string }>;
  getUser(userId: string): Promise<{ linkedAccounts: ReadonlyArray<unknown> }>;
}

/**
 * Valida o access token Privy no servidor e devolve o endereço da embedded wallet
 * (`linkedAccounts` com `type: "wallet"` e `walletClientType: "privy"`).
 * Nunca usa endereço enviado pelo cliente.
 */
export async function resolveEmbeddedWalletAddress(client: PrivyAuthClient, accessToken: unknown): Promise<Hex> {
  if (typeof accessToken !== "string" || accessToken.length < 16 || accessToken.length > 4_096) {
    throw new BridgeError("INVALID_PRIVY_TOKEN", "Envie o token de acesso Privy em privyAccessToken.");
  }
  let userId: string;
  try {
    userId = (await client.verifyAuthToken(accessToken)).userId;
  } catch {
    throw new BridgeError("INVALID_PRIVY_TOKEN", "Token de acesso Privy inválido ou expirado. Entre novamente no Privy.", 401);
  }
  const user = await client.getUser(userId);
  for (const linked of user.linkedAccounts) {
    const account = linked as { type?: unknown; walletClientType?: unknown; chainType?: unknown; address?: unknown };
    if (account.type !== "wallet" || account.walletClientType !== "privy") continue;
    if (account.chainType !== undefined && account.chainType !== "ethereum") continue;
    if (typeof account.address === "string" && isAddress(account.address, { strict: false })) {
      return getAddress(account.address);
    }
  }
  throw new BridgeError("EMBEDDED_WALLET_NOT_FOUND", "Nenhuma embedded wallet Privy Ethereum foi encontrada para este usuário. Crie a wallet no login Privy e tente novamente.", 409);
}

/** Resultado da vinculação: EOA embedded (dona/assinante) e Coinbase Smart Account derivada no servidor. */
export interface LinkedSmartAccount {
  ownerAddress: Hex;
  smartAccount: Hex;
}

/**
 * Valida o token Privy, obtém a EOA embedded e deriva a smart account pela factory on-chain.
 * `derive` é injetável (testes); nenhum endereço do cliente é aceito.
 */
export async function resolveLinkedSmartAccount(
  client: PrivyAuthClient,
  accessToken: unknown,
  derive: (ownerEoa: Hex) => Promise<Hex>,
): Promise<LinkedSmartAccount> {
  const ownerAddress = await resolveEmbeddedWalletAddress(client, accessToken);
  let smartAccount: Hex;
  try {
    smartAccount = await derive(ownerAddress);
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    console.error("Falha ao derivar a smart account", (error as { name?: unknown } | null)?.name ?? "erro");
    throw new BridgeError("SMART_ACCOUNT_UNAVAILABLE", "Não foi possível calcular o endereço da smart account na Sepolia. Tente novamente.", 502);
  }
  if (!isAddress(smartAccount, { strict: false }) || isAddressEqual(smartAccount, ownerAddress)) {
    throw new BridgeError("SMART_ACCOUNT_UNAVAILABLE", "Endereço de smart account inválido.", 502);
  }
  return { ownerAddress, smartAccount: getAddress(smartAccount) };
}

let smartAccountClient: SmartAccountClient | null = null;

/** Deriva a smart account usando o RPC Sepolia do servidor (`ALCHEMY_RPC_URL`). */
export function getSmartAccountDeriver(env: NodeJS.ProcessEnv = process.env): (ownerEoa: Hex) => Promise<Hex> {
  if (!smartAccountClient) {
    let rpcUrl: string;
    try {
      rpcUrl = readRpcUpstreams(env).rpcUrl;
    } catch (error) {
      throw new BridgeError("MISSING_CONFIG", error instanceof Error ? error.message : "Configuração Sepolia inválida.", 503);
    }
    smartAccountClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  }
  const client = smartAccountClient;
  return (ownerEoa) => deriveSmartAccountAddress(client, ownerEoa);
}

let privyAuthClient: PrivyAuthClient | null = null;

export function getPrivyAuthClient(env: NodeJS.ProcessEnv = process.env): PrivyAuthClient {
  if (!privyAuthClient) {
    const appId = env.PRIVY_APP_ID?.trim();
    const secret = env.PRIVY_APP_SECRET?.trim();
    if (!appId || !secret) {
      throw new BridgeError("MISSING_CONFIG", "PRIVY_APP_ID e PRIVY_APP_SECRET devem estar configurados no servidor.", 503);
    }
    privyAuthClient = new PrivyClient(appId, secret);
  }
  return privyAuthClient;
}
