import type { Transaction } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";
import { TransactionList } from "@/components/activity/transaction-list";
import type { RenderTransactionAction } from "@/components/activity/transaction-list";

interface ActivityHistoryProps {
  transactions: Transaction[];
  privyMode: boolean;
  renderAction?: RenderTransactionAction;
  /** Filtro mantido pela página para sobreviver à troca de abas. */
  activityFilter: string;
  setActivityFilter: (filter: string) => void;
}

/** Histórico completo de operações com filtro por estado (aba "Atividade"). */
export function ActivityHistory({ transactions, privyMode, renderAction, activityFilter, setActivityFilter }: ActivityHistoryProps) {
  const filteredTransactions = transactions.filter((tx) => activityFilter === "all" || tx.status === activityFilter);
  return (
    <section className="panel activity-panel full-activity">
      <div className="panel-heading">
        <div>
          <h2>Histórico de operações</h2>
          <p>{transactions.length} {transactions.length === 1 ? "operação registrada" : "operações registradas"} neste espaço de demonstração.</p>
        </div>
        <label className="filter-label">Exibir<select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}>
          <option value="all">Todas as operações</option>
          <option value="processing">Processando</option>
          {privyMode ? (
            <>
              <option value="awaiting_user_signature">Aguardando assinatura</option>
              <option value="submitted">Enviadas</option>
              <option value="unknown">Indeterminadas</option>
            </>
          ) : null}
          <option value="confirmed">Confirmadas</option>
          <option value="failed">Falhas</option>
        </select></label>
      </div>
      {filteredTransactions.length || !transactions.length ? (
        <TransactionList transactions={filteredTransactions} privy={privyMode} renderAction={renderAction}/>
      ) : (
        <div className="empty-state">
          <Icon name="activity" size={26}/>
          <strong>Nenhuma operação neste filtro</strong>
          <p>Selecione outro estado para consultar suas movimentações.</p>
          <button className="text-link" onClick={() => setActivityFilter("all")}>Exibir todas as operações</button>
        </div>
      )}
    </section>
  );
}
