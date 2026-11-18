import { Icon } from "@/components/icon";

interface ResetPanelProps {
  confirmReset: boolean;
  busy: string | null;
  onAskConfirm: () => void;
  onCancel: () => void;
  onReset: () => void;
}

/** Reinício da demonstração com confirmação em duas etapas. */
export function ResetPanel({ confirmReset, busy, onAskConfirm, onCancel, onReset }: ResetPanelProps) {
  return (
    <section className="panel reset-panel">
      <h2>Recomeçar a demonstração</h2>
      <p>Restaure o saldo inicial de 10.000,00 Mock USDC e desative a wallet deste espaço.</p>
      {confirmReset ? (
        <div className="reset-confirm">
          <strong>Apagar as operações desta conta?</strong>
          <p>O histórico local será removido. Essa ação não pode ser desfeita.</p>
          <div>
            <button className="button danger small" disabled={!!busy} onClick={onReset}>
              {busy === "reset" ? "Reiniciando…" : "Sim, reiniciar"}
            </button>
            <button className="button secondary small" disabled={!!busy} onClick={onCancel}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button className="text-link danger-text" onClick={onAskConfirm}><Icon name="refresh" size={16}/> Reiniciar esta conta</button>
      )}
    </section>
  );
}
