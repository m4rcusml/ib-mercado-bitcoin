/** Contrato público do simulador e da PoC Sepolia. Valores monetários sempre são strings decimais. */
export type Direction = "mb_to_wallet" | "wallet_to_mb";
export type SimulationOutcome = "confirmed" | "failed" | "timeout";
/** Modo do provider de wallet configurado no servidor (`WALLET_PROVIDER`). */
export type ProviderMode = "simulated" | "privy";
/**
 * - `processing`: modo simulado, reserva feita e aguardando a janela de simulação.
 * - `awaiting_user_signature`: modo privy, `wallet_to_mb` reservado aguardando o `userOpHash` da UserOperation assinada no browser.
 * - `submitted`: hash registrado (tx da tesouraria ou `userOpHash`); aguardando verificação independente.
 * - `unknown`: a observação falhou temporariamente; a reserva é mantida.
 * - `confirmed` / `failed`: estados finais.
 */
export type TransactionStatus =
  | "processing"
  | "awaiting_user_signature"
  | "submitted"
  | "unknown"
  | "confirmed"
  | "failed";

/**
 * O que o browser precisa para montar e assinar a UserOperation ERC-4337 com a chamada
 * `MockUSDC.transfer(to, amountUnits)` executada pela smart account (sem paymaster).
 * A EOA embedded (`ownerAddress`) assina; a smart account (`smartAccount`) é o `sender`.
 */
export interface SignatureRequest {
  chainId: 11155111;
  /** Endereço do contrato Mock USDC (alvo da chamada). */
  token: string;
  /** Endereço da tesouraria (destino do `transfer`). */
  to: string;
  /** Unidades de 6 decimais como string inteira (use BigInt). */
  amountUnits: string;
  /** Coinbase Smart Account esperada como `sender` da UserOperation. */
  smartAccount: string;
  /** EOA embedded Privy dona/assinante da smart account. */
  ownerAddress: string;
  /** Versão do EntryPoint (`toCoinbaseSmartAccount` do viem usa v0.6). */
  entryPoint: "0.6";
}

/** Metadados da smart account vinculada (modo privy). */
export interface SmartAccountInfo {
  type: "coinbase";
  entryPoint: "0.6";
}

export interface Transaction {
  id: string;
  direction: Direction;
  amount: string;
  amountMicros: string;
  status: TransactionStatus;
  simulationOutcome: SimulationOutcome;
  simulationId: string;
  /** Igual a `txHash`; mantido por compatibilidade. */
  hash: string | null;
  /**
   * Hash da transação Sepolia (somente modo privy): da tesouraria em `mb_to_wallet`; em
   * `wallet_to_mb`, do bundle que incluiu a UserOperation, conhecido após o receipt do bundler.
   */
  txHash: string | null;
  /** https://sepolia.etherscan.io/tx/<txHash>, quando há hash de transação. */
  explorerUrl: string | null;
  /** Hash da UserOperation informada pelo browser (`wallet_to_mb`, modo privy). */
  userOpHash: string | null;
  /** Endereços on-chain esperados (modo privy); nulos no modo simulado. */
  fromAddress: string | null;
  toAddress: string | null;
  /** Unidades de 6 decimais como string inteira; nulo no modo simulado. */
  amountUnits: string | null;
  /** Presente somente quando `status === "awaiting_user_signature"`. */
  signatureRequest: SignatureRequest | null;
  failureReason: string | null;
  createdAt: string;
  settlesAt: string;
  submittedAt: string | null;
  settledAt: string | null;
  idempotencyKey: string;
}

export interface BridgeState {
  mode: ProviderMode;
  /** App ID público do Privy (nunca o segredo); nulo no modo simulado. */
  privyAppId: string | null;
  network: { name: "Sepolia"; chainId: 11155111; connectedChainId: number };
  user: { email: string } | null;
  wallet: {
    active: boolean;
    /** Endereço operacional: Coinbase Smart Account no modo privy; endereço fictício no simulado. */
    address: string | null;
    /** EOA embedded Privy dona da smart account; nulo no modo simulado. */
    ownerAddress: string | null;
    simulated: boolean;
    smartAccount: SmartAccountInfo | null;
  };
  balances: {
    custodialAvailable: string;
    custodialReserved: string;
    walletAvailable: string;
    walletReserved: string;
    walletRemainderMicros: string;
    custodialRemainderMicros: string;
    total: string;
  };
  transactions: Transaction[];
  reconciliation: {
    balanced: boolean;
    initialMicros: string;
    currentMicros: string;
    differenceMicros: string;
  };
}

export interface ApiError {
  error: { code: string; message: string };
}

export interface TransferInput {
  direction: Direction;
  amount: string;
  /** Somente modo simulado; recusado no modo privy. */
  outcome?: SimulationOutcome;
}

/** Corpo de `POST /api/transfers/{id}/submission`: hash da UserOperation (0x + 64 hex). */
export interface SubmissionInput {
  userOpHash: string;
}

/** Corpo de `POST /api/wallet/link`. */
export interface WalletLinkInput {
  privyAccessToken: string;
}
