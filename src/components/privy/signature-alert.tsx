import type { ReactNode } from "react";
import type { Transaction } from "@/lib/domain/contracts";
import type { PrivySigner } from "@/components/privy/signer";
import { Icon } from "@/components/icon";
import { formatAmount } from "@/lib/client/format";

interface SignatureAlertProps {
  awaitingSignature: Transaction[];
  pendingHashes: Record<string, string>;
  signer: PrivySigner | null;
  walletMismatch: boolean;
  needsGas: boolean;
  busy: string | null;
  onConnect: () => void;
  renderSignButton: (tx: Transaction) => ReactNode;
}

function hintFor(first: Transaction, props: SignatureAlertProps) {
  const { pendingHashes, signer, walletMismatch, needsGas } = props;
  if (pendingHashes[first.id]) return "O bundler já recebeu esta UserOperation. Falta apenas registrar o userOpHash no servidor.";
  if (!signer?.ready) return "Carregando a wallet Privy…";
  if (!signer.authenticated) return "Conecte sua wallet Privy para assinar.";
  if (walletMismatch) return "A wallet Privy conectada não é a assinante vinculada a esta conta.";
  if (!first.signatureRequest) return "Aguardando os dados de assinatura do servidor.";
  if (needsGas) return "Antes de assinar, envie ETH Sepolia para a smart account (veja o aviso abaixo).";
  return "Ao assinar, a EOA Privy autoriza uma UserOperation da sua smart account (ERC-4337), enviada ao bundler; a smart account paga o gas em ETH de teste.";
}

/** Aviso de transferências que aguardam a assinatura da UserOperation no navegador. */
export function SignatureAlert(props: SignatureAlertProps) {
  const { awaitingSignature, pendingHashes, signer, busy, onConnect, renderSignButton } = props;
  const first = awaitingSignature[0];
  if (!first) return null;
  const hint = hintFor(first, props);
  return (
    <div className="network-alert" role="status">
      <Icon name="wallet" size={19}/>
      <div>
        <strong>
          {awaitingSignature.length === 1
            ? "Uma transferência aguarda sua assinatura"
            : `${awaitingSignature.length} transferências aguardam sua assinatura`}
        </strong>
        <p>{formatAmount(first.amount)} Mock USDC da sua smart account para a conta MB. {hint} O saldo só muda depois da verificação no servidor.</p>
      </div>
      {signer?.ready && !signer.authenticated && !pendingHashes[first.id]
        ? <button type="button" className="button secondary small" disabled={!!busy} onClick={onConnect}>Conectar wallet</button>
        : renderSignButton(first)}
    </div>
  );
}
