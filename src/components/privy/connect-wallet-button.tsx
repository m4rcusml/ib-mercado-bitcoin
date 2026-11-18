import { Icon } from "@/components/icon";

interface ConnectWalletButtonProps {
  className: string;
  privyAppId: string | null;
  busy: string | null;
  /** SDK Privy carregado (`signer.ready`). */
  privyReady: boolean;
  onConnect: () => void;
}

/** Botão "Conectar wallet" (login Privy + vinculação da smart account). */
export function ConnectWalletButton({ className, privyAppId, busy, privyReady, onConnect }: ConnectWalletButtonProps) {
  if (!privyAppId) return <p className="detail-note">A Privy não está configurada no servidor (privyAppId ausente).</p>;
  return (
    <button className={className} disabled={!!busy || !privyReady} onClick={onConnect}>
      {busy === "link" ? "Vinculando wallet…" : !privyReady ? "Carregando Privy…" : "Conectar wallet"}
      <Icon name="arrow" size={16}/>
    </button>
  );
}
