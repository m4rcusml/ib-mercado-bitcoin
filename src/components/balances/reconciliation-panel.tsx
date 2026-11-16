import type { BridgeState } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";
import { centsOf, decimalOf, formatAmount } from "@/lib/client/format";

interface ReconciliationPanelProps {
  balances: BridgeState["balances"];
  balanced: boolean;
}

/** Prova de que conta + wallet + reservas somam o total inicial. */
export function ReconciliationPanel({ balances, balanced }: ReconciliationPanelProps) {
  const reserved = decimalOf((centsOf(balances.custodialReserved) ?? 0n) + (centsOf(balances.walletReserved) ?? 0n));
  return (
    <section className="panel reconciliation-panel">
      <div className="panel-heading">
        <div>
          <h2>Seus saldos fecham</h2>
          <p>O total permanece igual durante toda a jornada.</p>
        </div>
        <span className={`reconciliation-mark ${balanced ? "" : "unbalanced"}`}>
          <Icon name={balanced ? "check" : "info"} size={18}/>
        </span>
      </div>
      <dl className="reconciliation-rows">
        <div><dt>Conta custodial disponível</dt><dd>{formatAmount(balances.custodialAvailable)}</dd></div>
        <div><dt>Wallet disponível</dt><dd>{formatAmount(balances.walletAvailable)}</dd></div>
        <div><dt>Reservado em transferências</dt><dd>{formatAmount(reserved)}</dd></div>
        <div className="reconciliation-total"><dt>Total em Mock USDC</dt><dd>{formatAmount(balances.total)}</dd></div>
      </dl>
      <span className={`reconciled-label ${balanced ? "" : "unbalanced"}`}>
        <span className="status-dot"/>
        {balanced ? "Saldos reconciliados" : "Divergência na reconciliação"}
      </span>
    </section>
  );
}
