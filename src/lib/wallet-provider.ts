import { createHash, randomUUID } from "node:crypto";
import type { SimulationOutcome } from "./contracts.ts";

export const SEPOLIA_CHAIN_ID = 11155111;

/** Fronteira a substituir por Privy/viem. Este provider não acessa redes nem assina. */
export const simulatedWalletProvider = {
  activate(accountId: string): string {
    return `0x${createHash("sha256").update(`demo-wallet:${accountId}`).digest("hex").slice(0, 40)}`;
  },
  submit(outcome: SimulationOutcome, now: number) {
    return {
      simulationId: `sim_${randomUUID()}`,
      settlesAt: now + 2_000,
      outcome,
      hash: null,
      explorerUrl: null,
    };
  },
  observe(outcome: SimulationOutcome): { confirmed: boolean; failureReason: string | null } {
    return {
      confirmed: outcome === "confirmed",
      failureReason: outcome === "timeout"
        ? "A janela de observação simulada expirou. O valor reservado foi devolvido."
        : outcome === "failed"
          ? "A transação falhou no cenário simulado. O valor reservado foi devolvido."
          : null,
    };
  },
};
