import { createHash, randomUUID } from "node:crypto";
import type { Direction, ProviderMode, SignatureRequest, SimulationOutcome, TransactionStatus } from "../domain/contracts.ts";

export const SEPOLIA_CHAIN_ID = 11155111;

/** Operação como persistida no SQLite, entregue ao provider para envio e observação. */
export interface PersistedOperation {
  id: string;
  accountId: string;
  direction: Direction;
  status: TransactionStatus;
  amountCents: bigint;
  /** Unidades de 6 decimais; nulo para linhas simuladas antigas. */
  amountUnits: bigint | null;
  outcome: SimulationOutcome;
  /** Snapshot do endereço da wallet (smart account no modo privy) no momento da reserva. */
  walletAddress: string | null;
  /** EOA embedded dona da smart account (modo privy); nulo no modo simulado. */
  ownerAddress: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  /** Hash da transação Sepolia: da tesouraria (mb_to_wallet) ou do bundle que incluiu a UserOperation. */
  txHash: string | null;
  /** Hash da UserOperation ERC-4337 informada pelo browser (wallet_to_mb). */
  userOpHash: string | null;
  createdAt: number;
  submittedAt: number | null;
}

/** Endereços on-chain esperados para uma operação, fixados no momento da reserva. */
export interface TransferRoute {
  from: string | null;
  to: string | null;
  amountUnits: bigint | null;
}

export type SubmitResult =
  /** Modo simulado: liquidação elegível em `settlesAt`. */
  | { status: "processing"; simulationId: string; settlesAt: number; userOpHash: string | null }
  /** Envio on-chain feito pelo servidor (tesouraria); ainda não verificado. */
  | { status: "submitted"; txHash: string }
  /** O usuário precisa assinar a UserOperation no browser e informar o `userOpHash`. */
  | { status: "awaiting_user_signature" };

/**
 * `txHash`, quando presente, é o hash da transação descoberto durante a observação
 * (ex.: bundle que incluiu a UserOperation); o ledger o persiste se ainda não houver.
 */
export type ObservationResult =
  | { status: "confirmed"; txHash?: string }
  | { status: "failed"; reason: string; txHash?: string }
  | { status: "pending"; txHash?: string };

/**
 * Fronteira entre o ledger e o transporte (simulado ou Sepolia).
 * `observe` lança em erro transitório: o ledger mantém a reserva e marca `unknown`.
 */
export interface WalletProvider {
  readonly mode: ProviderMode;
  /** Somente modo simulado; o modo privy vincula a wallet por `POST /api/wallet/link`. */
  activate(accountId: string): string | Promise<string>;
  route(direction: Direction, walletAddress: string, amountCents: bigint): TransferRoute;
  submit(operation: PersistedOperation, now: number): Promise<SubmitResult> | SubmitResult;
  observe(operation: PersistedOperation, now: number): Promise<ObservationResult> | ObservationResult;
  signatureRequest(operation: PersistedOperation): SignatureRequest | null;
}

/** Provider simulado: não acessa redes nem assina, portanto não gera UserOperation. */
export class SimulatedWalletProvider implements WalletProvider {
  readonly mode = "simulated" as const;

  activate(accountId: string): string {
    return `0x${createHash("sha256").update(`demo-wallet:${accountId}`).digest("hex").slice(0, 40)}`;
  }

  route(): TransferRoute {
    return { from: null, to: null, amountUnits: null };
  }

  submit(_operation: PersistedOperation, now: number): SubmitResult {
    return { status: "processing", simulationId: `sim_${randomUUID()}`, settlesAt: now + 2_000, userOpHash: null };
  }

  observe(operation: PersistedOperation): ObservationResult {
    if (operation.outcome === "confirmed") return { status: "confirmed" };
    return {
      status: "failed",
      reason: operation.outcome === "timeout"
        ? "A janela de observação simulada expirou. O valor reservado foi devolvido."
        : "A transação falhou no cenário simulado. O valor reservado foi devolvido.",
    };
  }

  signatureRequest(): null {
    return null;
  }
}

export const simulatedWalletProvider = new SimulatedWalletProvider();

let privyFactory: (() => WalletProvider) | null = null;

export function registerPrivyFactory(factory: () => WalletProvider): void {
  privyFactory = factory;
}

export function configuredMode(env: NodeJS.ProcessEnv = process.env): ProviderMode {
  return env.WALLET_PROVIDER === "privy" ? "privy" : "simulated";
}

export function getWalletProvider(): WalletProvider {
  if (configuredMode() === "privy") {
    if (!privyFactory) {
      throw new Error(
        "WALLET_PROVIDER=privy mas registerPrivyFactory() não foi chamado. " +
        "Importe privy-wallet-provider.ts no bootstrap da aplicação.",
      );
    }
    return privyFactory();
  }
  return simulatedWalletProvider;
}
