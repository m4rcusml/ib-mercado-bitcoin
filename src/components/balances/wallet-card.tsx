import type { ReactNode } from "react";
import type { BridgeState } from "@/lib/domain/contracts";
import type { SmartAccountStatus } from "@/components/privy/signer";
import { Icon } from "@/components/icon";
import { formatAmount, shortAddress } from "@/lib/client/format";

interface WalletCardProps {
  wallet: BridgeState["wallet"];
  available: string;
  reserved: string;
  privyMode: boolean;
  /** EOA Privy assinante da smart account (somente modo Privy). */
  ownerAddress: string | null;
  aaStatus: SmartAccountStatus | null;
  copied: boolean;
  busy: string | null;
  onCopyAddress: () => void;
  onActivate: () => void;
  /** Botão de conexão Privy exibido quando a wallet ainda não foi vinculada. */
  connectWalletButton: ReactNode;
}

/** Linhas da smart account (ERC-4337), da EOA assinante e do gas disponível. */
function SmartAccountLines({ address, ownerAddress, aaStatus }: { address: string | null; ownerAddress: string | null; aaStatus: SmartAccountStatus | null }) {
  return (
    <p className="balance-subtitle" style={{ fontSize: "0.8em", marginTop: 4 }}>
      <span title={address ?? undefined}>Smart account (ERC-4337): <strong>{address ? shortAddress(address) : "—"}</strong></span>
      {ownerAddress ? (
        <>
          <br/>
          <small title={ownerAddress}>Assinante (EOA Privy): {shortAddress(ownerAddress)}</small>
        </>
      ) : null}
      {aaStatus ? (
        <>
          <br/>
          <small>Gas: {aaStatus.balanceEth} ETH Sepolia{aaStatus.deployed ? "" : " · ainda não implantada"}</small>
        </>
      ) : null}
    </p>
  );
}

export function WalletCard({
  wallet,
  available,
  reserved,
  privyMode,
  ownerAddress,
  aaStatus,
  copied,
  busy,
  onCopyAddress,
  onActivate,
  connectWalletButton,
}: WalletCardProps) {
  return (
    <section className={`balance-card wallet-card ${wallet.active ? "wallet-is-active" : ""}`}>
      <div className="balance-heading">
        <span className="balance-label"><Icon name="wallet" size={21}/> Wallet pessoal</span>
        <span className="balance-chip">
          {wallet.active
            ? (privyMode ? "Vinculada · Sepolia" : "Ativa · simulada")
            : privyMode ? "Não conectada" : "Ainda não ativada"}
        </span>
      </div>
      {wallet.active ? (
        <>
          <div className="balance-number">{formatAmount(available)}<span>Mock USDC</span></div>
          <p className="balance-subtitle">
            {privyMode ? "Saldo disponível na smart account (ERC-4337 · Sepolia)" : "Saldo disponível na wallet simulada"}
          </p>
          {privyMode ? <SmartAccountLines address={wallet.address} ownerAddress={ownerAddress} aaStatus={aaStatus}/> : null}
          <div className="balance-card-bottom">
            <button className="address-button" type="button" onClick={onCopyAddress} title={wallet.address ?? undefined}>
              <span>{wallet.address?.slice(0, 7)}…{wallet.address?.slice(-5)}</span>
              <Icon name={copied ? "check" : "copy"} size={14}/>
              <span className="sr-only">
                {copied ? "Endereço copiado" : privyMode ? "Copiar endereço da smart account" : "Copiar endereço fictício"}
              </span>
            </button>
            <span>{formatAmount(reserved)} reservado</span>
          </div>
        </>
      ) : privyMode ? (
        <>
          <div className="inactive-wallet">
            <div>
              <h2>Conecte sua wallet.</h2>
              <p>Entre com a Privy: sua EOA embedded assina por uma smart account ERC-4337 na Sepolia.</p>
            </div>
            <span className="wallet-illustration"><Icon name="wallet" size={35}/></span>
          </div>
          {connectWalletButton}
        </>
      ) : (
        <>
          <div className="inactive-wallet">
            <div>
              <h2>O próximo passo é seu.</h2>
              <p>Ative sua wallet simulada e explore os dois lados da jornada.</p>
            </div>
            <span className="wallet-illustration"><Icon name="wallet" size={35}/></span>
          </div>
          <button className="button secondary small activate-wallet" disabled={!!busy} onClick={onActivate}>
            {busy === "activate" ? "Ativando…" : "Ativar wallet simulada"}
            <Icon name="arrow" size={16}/>
          </button>
        </>
      )}
    </section>
  );
}
