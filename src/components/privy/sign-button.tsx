import type { Transaction } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";

interface SignButtonProps {
  tx: Transaction;
  /** O bundler já devolveu um `userOpHash` para esta transferência (falta só registrar). */
  hasHash: boolean;
  busy: string | null;
  signerReady: boolean;
  needsGas: boolean;
  onSign: (tx: Transaction) => void;
}

/** "Assinar no navegador" ou, se o hash já existe, "Registrar envio". */
export function SignButton({ tx, hasHash, busy, signerReady, needsGas, onSign }: SignButtonProps) {
  const disabled = !!busy || (!hasHash && (!tx.signatureRequest || !signerReady || needsGas));
  const label = busy === `sign-${tx.id}`
    ? (hasHash ? "Registrando envio…" : "Confirme na wallet…")
    : hasHash ? "Registrar envio" : "Assinar no navegador";
  return (
    <button type="button" className="button primary small" disabled={disabled} onClick={() => onSign(tx)}>
      {label}
      <Icon name="arrow" size={16}/>
    </button>
  );
}
