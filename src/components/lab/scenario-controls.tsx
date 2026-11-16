import type { SimulationOutcome } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";

const OUTCOME_OPTIONS = [
  { value: "confirmed", title: "Confirmar", text: "Conclui a operação e atualiza o destino.", icon: "check" },
  { value: "failed", title: "Simular falha", text: "Falha no envio e devolve a reserva.", icon: "close" },
  { value: "timeout", title: "Simular expiração", text: "Encerra a janela e devolve a reserva.", icon: "clock" },
] as const;

interface ScenarioControlsProps {
  outcome: SimulationOutcome;
  onOutcomeChange: (outcome: SimulationOutcome) => void;
  connectedChainId: number;
  busy: string | null;
  onNetworkChange: (chainId: number) => void;
  onTryTransfer: () => void;
}

/** Cenários do modo simulado: resultado da próxima operação e rede da wallet simulada. */
export function ScenarioControls({
  outcome,
  onOutcomeChange,
  connectedChainId,
  busy,
  onNetworkChange,
  onTryTransfer,
}: ScenarioControlsProps) {
  return (
    <section className="panel lab-controls">
      <div className="panel-heading">
        <div>
          <h2>Cenários de teste</h2>
          <p>Escolha o que acontece na próxima transferência.</p>
        </div>
        <span className="small-icon"><Icon name="lab"/></span>
      </div>
      <fieldset>
        <legend>Resultado da próxima operação</legend>
        <div className="scenario-options">
          {OUTCOME_OPTIONS.map((option) => (
            <label key={option.value} className={`scenario-option ${outcome === option.value ? "selected" : ""}`}>
              <input
                type="radio"
                name="outcome"
                value={option.value}
                checked={outcome === option.value}
                onChange={() => onOutcomeChange(option.value)}
              />
              <Icon name={option.icon} size={19}/>
              <span>
                <strong>{option.title}</strong>
                <small>{option.text}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="lab-network">
        <label htmlFor="network">Rede da wallet simulada</label>
        <select
          id="network"
          value={connectedChainId}
          disabled={!!busy}
          onChange={(event) => onNetworkChange(Number(event.target.value))}
        >
          <option value={11155111}>Sepolia · 11155111</option>
          <option value={1}>Ethereum Mainnet · 1 (teste de bloqueio)</option>
        </select>
        <p>Esta seleção apenas testa a validação de rede. Nenhuma conexão externa é estabelecida.</p>
      </div>
      <button className="button primary" onClick={onTryTransfer}>Testar uma transferência <Icon name="arrow" size={17}/></button>
    </section>
  );
}
