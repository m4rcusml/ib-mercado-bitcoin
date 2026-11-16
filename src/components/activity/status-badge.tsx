import type { Transaction } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";

export const statusLabels: Record<string, string> = {
  processing: "Processando",
  awaiting_user_signature: "Aguardando assinatura",
  submitted: "Enviada — verificando na Sepolia",
  unknown: "Indeterminada — reconsultando",
  confirmed: "Confirmada",
  failed: "Falhou",
};

interface StatusBadgeProps {
  transaction: Transaction;
  privy?: boolean;
}

export function StatusBadge({ transaction, privy = false }: StatusBadgeProps) {
  const label = !privy && transaction.status === "unknown"
    ? "Aguardando rede"
    : privy && transaction.status === "submitted"
      ? "UserOperation enviada — aguardando bundler/Sepolia"
      : statusLabels[transaction.status] ?? transaction.status;
  const tone = transaction.status === "confirmed" || transaction.status === "failed" ? transaction.status : "processing";
  const icon = transaction.status === "confirmed" ? "check" : transaction.status === "failed" ? "close" : "clock";
  return (
    <span className={`status status-${tone}`}>
      <Icon name={icon} size={13}/>{label}
    </span>
  );
}
