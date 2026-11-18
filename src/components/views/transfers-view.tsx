import type { ReactNode } from "react";
import type { Transaction } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";
import { TransactionList } from "@/components/activity/transaction-list";
import type { RenderTransactionAction } from "@/components/activity/transaction-list";
import { CurrentOperation } from "@/components/transfer/current-operation";
import type { View } from "@/components/layout/navigation";

interface TransfersViewProps {
  transferForm: ReactNode;
  /** Painel de ativação/conexão da wallet; `null` quando a wallet já está ativa. */
  activationPanel: ReactNode;
  reconciliationPanel: ReactNode;
  transactions: Transaction[];
  privyMode: boolean;
  renderTxAction?: RenderTransactionAction;
  onChangeView: (view: View) => void;
}

/** Aba "Transferências": formulário, operação atual e transferências recentes. */
export function TransfersView({
  transferForm,
  activationPanel,
  reconciliationPanel,
  transactions,
  privyMode,
  renderTxAction,
  onChangeView,
}: TransfersViewProps) {
  return (
    <>
      <div className="work-grid transfer-view-grid">
        {transferForm}
        <div className="side-panels">
          {activationPanel}
          {reconciliationPanel}
          <CurrentOperation transaction={transactions[0]} privyMode={privyMode}/>
        </div>
      </div>
      <section className="panel activity-panel">
        <div className="panel-heading">
          <h2>Transferências recentes</h2>
          <button className="text-link" onClick={() => onChangeView("activity")}>Ver todas <Icon name="arrow" size={15}/></button>
        </div>
        <TransactionList transactions={transactions} compact privy={privyMode} renderAction={renderTxAction}/>
      </section>
    </>
  );
}
