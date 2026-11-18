import { Icon } from "@/components/icon";

interface WrongNetworkAlertProps {
  connectedChainId: number;
  busy: string | null;
  onUseSepolia: () => void;
}

/** Bloqueio do modo simulado quando a "rede da wallet" escolhida no laboratório não é Sepolia. */
export function WrongNetworkAlert({ connectedChainId, busy, onUseSepolia }: WrongNetworkAlertProps) {
  return (
    <div className="network-alert" role="alert">
      <Icon name="info" size={19}/>
      <div>
        <strong>Esta jornada usa a rede Sepolia.</strong>
        <p>A rede simulada atual é {connectedChainId}. Volte para Sepolia para transferir.</p>
      </div>
      <button className="button secondary small" disabled={!!busy} onClick={onUseSepolia}>Usar Sepolia</button>
    </div>
  );
}
