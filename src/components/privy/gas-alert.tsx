import type { SmartAccountStatus } from "@/components/privy/signer";
import { Icon } from "@/components/icon";

interface GasAlertProps {
  privyMode: boolean;
  walletActive: boolean;
  smartAccountAddress: string | null;
  needsGas: boolean;
  aaStatus: SmartAccountStatus | null;
  hasAwaitingSignature: boolean;
  copied: boolean;
  onCopyAddress: () => void;
  onRefreshStatus: () => void;
}

/** Aviso de gas: sem paymaster, a smart account paga o gas com o próprio ETH Sepolia. */
export function GasAlert({
  privyMode,
  walletActive,
  smartAccountAddress,
  needsGas,
  aaStatus,
  hasAwaitingSignature,
  copied,
  onCopyAddress,
  onRefreshStatus,
}: GasAlertProps) {
  if (!privyMode || !walletActive || !smartAccountAddress) return null;
  if (!needsGas) {
    if (!aaStatus || aaStatus.deployed || !hasAwaitingSignature) return null;
    return (
      <div className="network-alert" role="note">
        <Icon name="info" size={19}/>
        <div>
          <strong>Primeira UserOperation desta smart account</strong>
          <p>A smart account ainda não foi implantada. O primeiro envio também faz o deploy (initCode) e por isso consome mais gas. Saldo atual: {aaStatus.balanceEth} ETH Sepolia.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="network-alert" role="alert">
      <Icon name="info" size={19}/>
      <div>
        <strong>A smart account precisa de ETH Sepolia para pagar o gas</strong>
        <p>
          Envie ETH de teste de um faucet Sepolia para o endereço da <strong>smart account</strong> (não para a EOA Privy): <code style={{ wordBreak: "break-all" }}>{smartAccountAddress}</code>. {aaStatus && !aaStatus.deployed ? "A primeira UserOperation também implanta a conta (initCode) e consome mais gas que as seguintes." : null}
        </p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="button secondary small" onClick={onCopyAddress}>
          {copied ? "Copiado" : "Copiar endereço"}
          <Icon name={copied ? "check" : "copy"} size={14}/>
        </button>
        <button type="button" className="button secondary small" onClick={onRefreshStatus}>
          Verificar saldo
          <Icon name="refresh" size={14}/>
        </button>
      </div>
    </div>
  );
}
