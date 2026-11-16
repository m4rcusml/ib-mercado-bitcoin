import { Icon } from "@/components/icon";

/** Resumo do que a API local já entrega e do que a equipe conecta. */
export function IntegrationPanel() {
  return (
    <section className="panel integration-panel">
      <div className="panel-heading">
        <div>
          <h2>Pronto para a próxima conexão</h2>
          <p>A interface já conversa com uma API local. Sua equipe pode evoluir o transporte.</p>
        </div>
        <Icon name="code" size={23}/>
      </div>
      <div className="integration-grid">
        <div>
          <h3>O que já funciona</h3>
          <p>Ledger persistente, reserva de saldo, idempotência, estorno e reconciliação. Os valores são tratados como inteiros.</p>
        </div>
        <div>
          <h3>O que sua equipe conecta</h3>
          <p>Autenticação e embedded wallet, provedor Sepolia, contrato Mock USDC e observação das confirmações reais.</p>
        </div>
      </div>
      <div className="endpoint-example">
        <span>POST</span>
        <code>/api/transfers</code>
        <small>Idempotency-Key obrigatório</small>
      </div>
      <p className="integration-note"><Icon name="info" size={15}/> Código e contratos de API estão documentados no README e em docs/integration.md do projeto.</p>
    </section>
  );
}
