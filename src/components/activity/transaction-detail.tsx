import type { ReactNode } from "react";
import type { Transaction } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";

interface TransactionDetailProps {
  tx: Transaction;
  privy: boolean;
  action?: ReactNode;
}

/** Detalhes expandidos de uma operação: identificadores, hashes, notas de estado e link do explorador. */
export function TransactionDetail({ tx, privy, action }: TransactionDetailProps) {
  return (
    <div className="transaction-detail">
      <dl>
        <div><dt>Identificador local</dt><dd>{tx.simulationId}</dd></div>
        <div><dt>Idempotência</dt><dd>{tx.idempotencyKey}</dd></div>
        {privy ? (
          <div><dt>UserOperation (userOpHash)</dt><dd>{tx.userOpHash ?? "Ainda não enviada ao bundler"}</dd></div>
        ) : null}
        <div>
          <dt>Registro na blockchain</dt>
          <dd>{tx.txHash ?? tx.hash ?? (privy ? "Ainda sem transação on-chain" : "Simulada · sem registro on-chain")}</dd>
        </div>
      </dl>
      {tx.failureReason ? <p className="detail-failure">{tx.failureReason} O valor foi devolvido ao saldo de origem.</p> : null}
      {privy && tx.status === "submitted" ? (
        <p className="detail-note">UserOperation entregue ao bundler. O saldo só muda depois que o servidor verificar o receipt e o evento Transfer na Sepolia.</p>
      ) : null}
      {privy && tx.status === "unknown" ? (
        <p className="detail-note">A rede ainda não deu evidência suficiente. O valor segue reservado enquanto o servidor reconsulta.</p>
      ) : null}
      {action}
      {tx.explorerUrl ? (
        <a className="text-link" href={tx.explorerUrl} target="_blank" rel="noreferrer">Ver no explorador <Icon name="external" size={14}/></a>
      ) : (
        <p className="detail-note">
          {privy
            ? "O link para o explorador aparece quando o servidor observar a transação na Sepolia."
            : "O link para o explorador estará disponível após a integração real com Sepolia."}
        </p>
      )}
    </div>
  );
}
