import { Icon } from "@/components/icon";
import { decimalOf, formatAmount } from "@/lib/client/format";
import type { TransferFormModel } from "@/hooks/use-transfer-form";
import { DirectionSwitch } from "@/components/transfer/direction-switch";

interface TransferFormProps {
  form: TransferFormModel;
  busy: string | null;
  walletActive: boolean;
  wrongNetwork: boolean;
  privyMode: boolean;
}

const SHORTCUTS = [25n, 50n, 100n];

function helpText(form: TransferFormModel, privyMode: boolean) {
  if (form.extraDecimals) return `O valor será truncado para ${formatAmount(form.normalizedAmount)} Mock USDC, sem arredondar.`;
  return privyMode
    ? "Use até duas casas decimais. Da wallet para a conta MB, a smart account paga o gas em ETH Sepolia."
    : "Use até duas casas decimais. Nenhuma taxa nesta simulação.";
}

function submitLabel(busy: string | null, walletActive: boolean, privyMode: boolean) {
  if (busy === "transfer") return "Iniciando transferência…";
  if (!walletActive) return privyMode ? "Conecte a wallet para transferir" : "Ative a wallet para transferir";
  return "Transferir Mock USDC";
}

/** Painel "Movimentar entre saldos": sentido, valor com validação/atalhos e envio. */
export function TransferForm({ form, busy, walletActive, wrongNetwork, privyMode }: TransferFormProps) {
  const { amount, amountError } = form;
  return (
    <section className="panel transfer-panel" aria-labelledby="transfer-title">
      <div className="panel-heading">
        <div>
          <h2 id="transfer-title">Movimentar entre saldos</h2>
          <p>Da sua conta para sua wallet. E de volta.</p>
        </div>
        <span className="token-label"><span className="token-symbol">$</span> Mock USDC</span>
      </div>
      <form onSubmit={form.transfer}>
        <DirectionSwitch direction={form.direction} disabled={!!busy} onToggle={form.toggleDirection}/>
        <div className="amount-label">
          <label htmlFor="amount">Quanto você quer transferir?</label>
          <span>Disponível: <strong>{formatAmount(form.balance)}</strong></span>
        </div>
        <div className={`amount-field ${amountError ? "field-invalid" : ""}`}>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={amount}
            onChange={(event) => form.setAmount(event.target.value)}
            aria-invalid={!!amountError}
            aria-describedby={amountError ? "amount-error" : "amount-help"}
            disabled={!!busy || !walletActive}
          />
          <span>Mock USDC</span>
        </div>
        <div className="amount-shortcuts">
          {SHORTCUTS.map((percent) => (
            <button
              key={percent.toString()}
              type="button"
              disabled={!!busy || !walletActive}
              onClick={() => form.setAmount(decimalOf(form.availableCents * percent / 100n).replace(".", ","))}
            >
              {percent === 100n ? "Máximo" : `${percent}%`}
            </button>
          ))}
        </div>
        {amountError
          ? <p className="field-error" id="amount-error"><Icon name="info" size={14}/>{amountError}</p>
          : <p className="field-help" id="amount-help">{helpText(form, privyMode)}</p>}
        <div className="transfer-summary">
          <span>Você transfere</span>
          <strong>{formatAmount(form.normalizedAmount)} <small>Mock USDC</small></strong>
        </div>
        <button
          className="button primary full-width"
          type="submit"
          disabled={!!busy || !walletActive || wrongNetwork || !form.parsedAmount || !!amountError}
        >
          {submitLabel(busy, walletActive, privyMode)}
          <Icon name="arrow" size={18}/>
        </button>
        <p className="safe-note">
          <Icon name="shield" size={14}/> {privyMode ? "Testnet Sepolia. Somente Mock USDC de teste, sem valor real." : "Operação local. Você não movimenta dinheiro real."}
        </p>
      </form>
    </section>
  );
}
