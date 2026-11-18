import { useState } from "react";
import type { ReactNode } from "react";
import type { Transaction } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";
import { formatAmount, formatTime } from "@/lib/client/format";
import { StatusBadge } from "@/components/activity/status-badge";
import { TransactionDetail } from "@/components/activity/transaction-detail";

export type RenderTransactionAction = (tx: Transaction) => ReactNode;

interface TransactionListProps {
  transactions: Transaction[];
  compact?: boolean;
  privy?: boolean;
  renderAction?: RenderTransactionAction;
}

export function TransactionList({ transactions, compact = false, privy = false, renderAction }: TransactionListProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!transactions.length) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><Icon name="transfer" size={25}/></span>
        <strong>Sua primeira transferência começa aqui</strong>
        <p>Ao movimentar Mock USDC, você acompanha cada etapa neste espaço.</p>
      </div>
    );
  }
  return (
    <div className="transaction-table">
      <div className="table-heading">
        <span>Operação</span>
        <span>Valor</span>
        <span>Estado</span>
        <span>Data</span>
        <span/>
      </div>
      {transactions.slice(0, compact ? 4 : undefined).map((tx) => (
        <div className="transaction-group" key={tx.id}>
          <button
            type="button"
            className="transaction-row"
            aria-expanded={expanded === tx.id}
            onClick={() => setExpanded(expanded === tx.id ? null : tx.id)}
          >
            <span className="transaction-operation">
              <span className={`transaction-icon ${tx.direction === "wallet_to_mb" ? "incoming" : ""}`}>
                <Icon name="arrow" size={18}/>
              </span>
              <span>
                <strong>{tx.direction === "mb_to_wallet" ? "Conta MB para wallet" : "Wallet para conta MB"}</strong>
                <small>{privy ? "Sepolia · Mock USDC de teste" : "Transferência simulada"}</small>
              </span>
            </span>
            <span className="transaction-value">{formatAmount(tx.amount)}<small>Mock USDC</small></span>
            <StatusBadge transaction={tx} privy={privy}/>
            <span className="transaction-date">{formatTime(tx.createdAt)}</span>
            <Icon name="chevron" size={16} className={expanded === tx.id ? "rotated" : ""}/>
          </button>
          {expanded === tx.id ? <TransactionDetail tx={tx} privy={privy} action={renderAction?.(tx)}/> : null}
        </div>
      ))}
    </div>
  );
}
