import type { ReactNode } from "react";
import { Icon } from "@/components/icon";

interface WalletActivationPanelProps {
  privyMode: boolean;
  busy: string | null;
  onActivate: () => void;
  /** Botão de conexão Privy (modo Privy). */
  connectWalletButton: ReactNode;
}

/** Painel exibido na aba "Transferências" enquanto a wallet não está ativa/vinculada. */
export function WalletActivationPanel({ privyMode, busy, onActivate, connectWalletButton }: WalletActivationPanelProps) {
  if (privyMode) {
    return (
      <section className="panel activation-panel">
        <span className="empty-icon"><Icon name="wallet" size={26}/></span>
        <h2>Primeiro, conecte sua wallet</h2>
        <p>A Privy cria ou recupera sua EOA embedded (assinante). O servidor deriva a smart account ERC-4337 controlada por ela, a partir da sua sessão, sem receber chaves.</p>
        {connectWalletButton}
      </section>
    );
  }
  return (
    <section className="panel activation-panel">
      <span className="empty-icon"><Icon name="wallet" size={26}/></span>
      <h2>Primeiro, ative sua wallet</h2>
      <p>Essa etapa prepara um endereço fictício para os seus testes. Nenhuma wallet é criada na blockchain.</p>
      <button className="button secondary full-width" disabled={!!busy} onClick={onActivate}>
        {busy === "activate" ? "Ativando…" : "Ativar wallet simulada"}
      </button>
    </section>
  );
}
