import type { Direction } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";

interface DirectionSwitchProps {
  direction: Direction;
  disabled: boolean;
  onToggle: () => void;
}

/** Origem → destino da transferência, com botão para inverter o sentido. */
export function DirectionSwitch({ direction, disabled, onToggle }: DirectionSwitchProps) {
  const fromCustody = direction === "mb_to_wallet";
  return (
    <div className="direction-box">
      <div className="direction-end">
        <span className="small-icon"><Icon name={fromCustody ? "account" : "wallet"}/></span>
        <span><small>De</small><strong>{fromCustody ? "Conta custodial MB" : "Wallet pessoal"}</strong></span>
      </div>
      <button
        className="swap-button"
        type="button"
        title="Inverter sentido da transferência"
        aria-label="Inverter sentido da transferência"
        onClick={onToggle}
        disabled={disabled}
      >
        <Icon name="transfer" size={19}/>
      </button>
      <div className="direction-end direction-destination">
        <span className="small-icon"><Icon name={fromCustody ? "wallet" : "account"}/></span>
        <span><small>Para</small><strong>{fromCustody ? "Wallet pessoal" : "Conta custodial MB"}</strong></span>
      </div>
    </div>
  );
}
