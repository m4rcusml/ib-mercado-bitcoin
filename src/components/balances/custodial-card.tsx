import { Icon } from "@/components/icon";
import { formatAmount } from "@/lib/client/format";

interface CustodialCardProps {
  available: string;
  reserved: string;
}

export function CustodialCard({ available, reserved }: CustodialCardProps) {
  return (
    <section className="balance-card custodial-card">
      <div className="balance-heading">
        <span className="balance-label"><Icon name="account" size={21}/> Conta custodial MB</span>
        <span className="balance-chip">Simulada</span>
      </div>
      <div className="balance-number">{formatAmount(available)}<span>Mock USDC</span></div>
      <p className="balance-subtitle">Saldo disponível na sua conta</p>
      <div className="balance-card-bottom">
        <span><Icon name="shield" size={15}/> Custódia da plataforma</span>
        <span>{formatAmount(reserved)} reservado</span>
      </div>
    </section>
  );
}
