import { useRef, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { BridgeState, Direction, SimulationOutcome } from "@/lib/domain/contracts";
import { centsOf, decimalOf } from "@/lib/client/format";
import type { Perform } from "@/hooks/use-bridge-state";

interface TransferFormOptions {
  state: BridgeState | null;
  privyMode: boolean;
  wrongNetwork: boolean;
  perform: Perform;
  setNotice: Dispatch<SetStateAction<string>>;
}

/**
 * Formulário de transferência: sentido, valor (validação e truncamento em centavos), resultado
 * simulado e envio para `/api/transfers` com `Idempotency-Key` estável enquanto o pedido não muda.
 */
export function useTransferForm({ state, privyMode, wrongNetwork, perform, setNotice }: TransferFormOptions) {
  const [direction, setDirection] = useState<Direction>("mb_to_wallet");
  const [amount, setAmount] = useState("");
  const [outcome, setOutcome] = useState<SimulationOutcome>("confirmed");
  const transferIntent = useRef<{ body: string; key: string } | null>(null);

  const balance = state ? (direction === "mb_to_wallet" ? state.balances.custodialAvailable : state.balances.walletAvailable) : "0.00";
  const parsedAmount = centsOf(amount);
  const availableCents = centsOf(balance) ?? 0n;
  const normalizedAmount = parsedAmount === null ? "0.00" : decimalOf(parsedAmount);
  const extraDecimals = (amount.replace(",", ".").split(".")[1]?.length ?? 0) > 2;
  const amountError = !amount
    ? ""
    : parsedAmount === null
      ? "Informe um valor válido, usando vírgula ou ponto para os centavos."
      : parsedAmount <= 0n
        ? "O valor precisa ser maior que zero."
        : parsedAmount > availableCents
          ? "O valor é maior que o saldo disponível na origem."
          : "";

  function toggleDirection() {
    setDirection(direction === "mb_to_wallet" ? "wallet_to_mb" : "mb_to_wallet");
    setAmount("");
  }

  async function transfer(event: FormEvent) {
    event.preventDefault();
    if (!parsedAmount || amountError || !state?.wallet.active || wrongNetwork) return;
    const body = privyMode
      ? { direction, amount: amount.trim().replace(",", ".") }
      : { direction, amount: amount.trim().replace(",", "."), outcome };
    const serialized = JSON.stringify(body);
    if (transferIntent.current?.body !== serialized) transferIntent.current = { body: serialized, key: crypto.randomUUID() };
    const next = await perform("transfer", "/api/transfers", body, { "Idempotency-Key": transferIntent.current.key });
    if (next) {
      transferIntent.current = null;
      setAmount("");
      setNotice(
        !privyMode
          ? "Transferência iniciada. O valor está reservado até a conclusão da simulação."
          : direction === "wallet_to_mb"
            ? "Valor reservado. Assine no navegador para enviar a UserOperation pela sua smart account."
            : "Valor reservado. A tesouraria enviará na Sepolia; o saldo muda somente após a verificação.",
      );
    }
  }

  return {
    direction,
    toggleDirection,
    amount,
    setAmount,
    outcome,
    setOutcome,
    balance,
    parsedAmount,
    availableCents,
    normalizedAmount,
    extraDecimals,
    amountError,
    transfer,
  };
}

export type TransferFormModel = ReturnType<typeof useTransferForm>;
