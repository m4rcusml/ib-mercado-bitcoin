/** Contrato público do simulador. Valores monetários sempre são strings decimais. */
export type Direction = "mb_to_wallet" | "wallet_to_mb";
export type SimulationOutcome = "confirmed" | "failed" | "timeout";
export type TransactionStatus = "processing" | "confirmed" | "failed";

export interface Transaction {
  id: string;
  direction: Direction;
  amount: string;
  amountMicros: string;
  status: TransactionStatus;
  simulationOutcome: SimulationOutcome;
  simulationId: string;
  hash: string | null;
  explorerUrl: string | null;
  failureReason: string | null;
  createdAt: string;
  settlesAt: string;
  settledAt: string | null;
  idempotencyKey: string;
}

export interface BridgeState {
  mode: "simulation";
  network: { name: "Sepolia"; chainId: 11155111; connectedChainId: number };
  user: { email: string } | null;
  wallet: { active: boolean; address: string | null; simulated: true };
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
  outcome?: SimulationOutcome;
}
