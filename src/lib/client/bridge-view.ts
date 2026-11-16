import type { BridgeState, Transaction } from "@/lib/domain/contracts";
import type { SignatureRequest } from "@/components/privy/signer";

/** Estados em que a operação ainda pode mudar e a interface deve reconsultar. */
export const OPEN_STATUSES = new Set<string>(["processing", "awaiting_user_signature", "submitted", "unknown"]);

/**
 * Visão da wallet no modo ERC-4337: `address` é a smart account (conta operacional) e
 * `ownerAddress` é a EOA embedded Privy (somente assinante). Campos opcionais toleram um servidor antigo.
 */
export type WalletView = BridgeState["wallet"] & {
  ownerAddress?: string | null;
  smartAccount?: { type: "coinbase"; entryPoint: "0.6" } | null;
};

export type TransactionView = Omit<Transaction, "signatureRequest"> & {
  signatureRequest: SignatureRequest | null;
  userOpHash?: string | null;
};

export const walletView = (state: BridgeState | null): WalletView | null => state ? state.wallet as WalletView : null;
export const transactionView = (tx: Transaction): TransactionView => tx as TransactionView;
