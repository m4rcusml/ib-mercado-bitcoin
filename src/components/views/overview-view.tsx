import type { ReactNode } from "react";
import type { Transaction } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";
import { TransactionList } from "@/components/activity/transaction-list";
import type { RenderTransactionAction } from "@/components/activity/transaction-list";
import type { View } from "@/components/layout/navigation";

interface OverviewViewProps {
  custodialCard: ReactNode;
  walletCard: ReactNode;
  transferForm: ReactNode;
  reconciliationPanel: ReactNode;
  transactions: Transaction[];
  privyMode: boolean;
  renderTxAction?: RenderTransactionAction;
  onChangeView: (view: View) => void;
}

/** Aba "Visão geral": saldos, formulário de transferência, reconciliação e últimas movimentações. */
export function OverviewView({
  custodialCard,
  walletCard,
  transferForm,
  reconciliationPanel,
  transactions,
  privyMode,
  renderTxAction,
  onChangeView,
}: OverviewViewProps) {
  return (
    <>
      <div className="balances-grid">
        {custodialCard}
        {walletCard}
      </div>
      <div className="work-grid">
        {transferForm}
        <div className="side-panels">
          {reconciliationPanel}
          <section className="journey-note">
            <span className="journey-icon"><Icon name="transfer" size={20}/></span>
            <h2>Uma ponte, dois ambientes</h2>
            <p>A custódia da conta e a autonomia da wallet têm papéis diferentes. Aqui, você pode experimentar essa conexão com segurança.</p>
            {privyMode ? null : (
              <button className="text-link" onClick={() => onChangeView("lab")}>Explorar o laboratório <Icon name="arrow" size={15}/></button>
            )}
          </section>
        </div>
      </div>
      <section className="panel activity-panel">
        <div className="panel-heading">
          <div>
            <h2>Últimas movimentações</h2>
            <p>Cada etapa da sua jornada fica registrada.</p>
          </div>
          <button className="text-link" onClick={() => onChangeView("activity")}>Ver atividade <Icon name="arrow" size={15}/></button>
        </div>
        <TransactionList transactions={transactions} compact privy={privyMode} renderAction={renderTxAction}/>
      </section>
    </>
  );
}
