import type { Transaction } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";
import { formatAmount } from "@/lib/client/format";
import { StatusBadge } from "@/components/activity/status-badge";

function currentOperationText(tx: Transaction, privyMode: boolean) {
  switch (tx.status) {
    case "awaiting_user_signature": return "O valor está reservado. Assine no navegador para enviar a UserOperation pela sua smart account.";
    case "submitted": return "UserOperation enviada — aguardando bundler/Sepolia. O servidor verifica o receipt e o evento Transfer antes de alterar saldos.";
    case "unknown": return privyMode ? "Ainda sem evidência suficiente da rede. O valor segue reservado e a consulta continua." : "A rede ainda não respondeu. O valor segue reservado.";
    case "processing": return privyMode ? "O valor está reservado enquanto a operação é preparada na Sepolia." : "O valor está reservado. A confirmação acontecerá após a janela de simulação.";
    case "confirmed": return "O valor chegou ao destino e os saldos foram atualizados.";
    default: return "A operação não foi concluída. O valor reservado voltou à origem.";
  }
}

/** Link do explorador ou, enquanto não há, o hash conhecido (modo Privy). */
function OnChainReference({ tx }: { tx: Transaction }) {
  if (tx.explorerUrl) {
    return <a className="text-link" href={tx.explorerUrl} target="_blank" rel="noreferrer">Ver no explorador <Icon name="external" size={14}/></a>;
  }
  return (
    <small>
      {tx.txHash ?? tx.hash ?? (tx.userOpHash ? `userOpHash ${tx.userOpHash.slice(0, 10)}…` : "Sepolia · ainda sem UserOperation")}
    </small>
  );
}

interface CurrentOperationProps {
  transaction: Transaction | undefined;
  privyMode: boolean;
}

/** Estado da transferência mais recente (aba "Transferências"). */
export function CurrentOperation({ transaction, privyMode }: CurrentOperationProps) {
  return (
    <section className="panel current-operation">
      <h2>Operação atual</h2>
      {transaction ? (
        <>
          <StatusBadge transaction={transaction} privy={privyMode}/>
          <strong className="current-amount">{formatAmount(transaction.amount)} <small>Mock USDC</small></strong>
          <p>{currentOperationText(transaction, privyMode)}</p>
          {privyMode ? <OnChainReference tx={transaction}/> : <small>Simulada · sem registro on-chain</small>}
        </>
      ) : <p>Inicie uma transferência para acompanhar seu estado.</p>}
    </section>
  );
}
