"use client";

import { useEffect, useState } from "react";
import type { Transaction } from "@/lib/domain/contracts";
import { OPEN_STATUSES } from "@/lib/client/bridge-view";
import { useBridgeState } from "@/hooks/use-bridge-state";
import { useCopyAddress } from "@/hooks/use-copy-address";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { useLoginFlow } from "@/hooks/use-login-flow";
import { usePrivyFlow } from "@/hooks/use-privy-flow";
import { useTransferForm } from "@/hooks/use-transfer-form";
import { ActivityHistory } from "@/components/activity/activity-history";
import { LoginPanel } from "@/components/auth/login-panel";
import { LoginStory } from "@/components/auth/login-story";
import { CustodialCard } from "@/components/balances/custodial-card";
import { ReconciliationPanel } from "@/components/balances/reconciliation-panel";
import { WalletCard } from "@/components/balances/wallet-card";
import { LabView } from "@/components/lab/lab-view";
import { WrongNetworkAlert } from "@/components/lab/wrong-network-alert";
import { EnvironmentBanner } from "@/components/layout/environment-banner";
import { FlashMessages } from "@/components/layout/flash-messages";
import { ConnectionState, LoadingState } from "@/components/layout/load-states";
import { navigation } from "@/components/layout/navigation";
import type { View } from "@/components/layout/navigation";
import { PageFooter } from "@/components/layout/page-footer";
import { PageHeading } from "@/components/layout/page-heading";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ConnectWalletButton } from "@/components/privy/connect-wallet-button";
import { GasAlert } from "@/components/privy/gas-alert";
import { PrivyLoader } from "@/components/privy/privy-loader";
import { SignButton } from "@/components/privy/sign-button";
import { SignatureAlert } from "@/components/privy/signature-alert";
import { TransferForm } from "@/components/transfer/transfer-form";
import { WalletActivationPanel } from "@/components/transfer/wallet-activation-panel";
import { OverviewView } from "@/components/views/overview-view";
import { TransfersView } from "@/components/views/transfers-view";

export default function Home() {
  const { state, setState, loading, requestReload, busy, setBusy, error, setError, notice, setNotice, controllers, perform } = useBridgeState();
  const [view, setView] = useState<View>("overview");
  const [confirmReset, setConfirmReset] = useState(false);
  const [activityFilter, setActivityFilter] = useState("all");
  const activeEmail = state?.user?.email;
  const privyMode = state?.mode === "privy";
  const privyAppId = privyMode ? state?.privyAppId ?? null : null;
  const hasProcessing = state?.transactions.some((transaction) => OPEN_STATUSES.has(transaction.status)) ?? false;
  const visibleNavigation = privyMode ? navigation.filter((item) => item.id !== "lab") : navigation;
  const wrongNetwork = state && !privyMode ? state.network.connectedChainId !== state.network.chainId : false;
  const awaitingSignature = privyMode ? state?.transactions.filter((tx) => tx.status === "awaiting_user_signature") ?? [] : [];
  const viewTitle = navigation.find((item) => item.id === view)?.title;

  const privy = usePrivyFlow({ state, privyMode, perform, setBusy, setError, setNotice });
  const { signer } = privy;
  const auth = useLoginFlow({ perform, controllers, setBusy, setError, setNotice });
  const form = useTransferForm({ state, privyMode, wrongNetwork, perform, setNotice });
  const { copied, copyAddress } = useCopyAddress(state?.wallet.address, setError);
  useLiveUpdates({ activeEmail, hasProcessing, privyMode, setState, setError });

  useEffect(() => { if (view === "lab" && privyMode) setView("overview"); }, [view, privyMode]);

  const changeView = (next: View) => { setView(next); setError(""); setNotice(""); setConfirmReset(false); };

  async function logout() {
    if (await perform("logout", "/api/auth/logout")) {
      if (signer?.authenticated) await signer.logout().catch(() => undefined);
      auth.setLoginStep("email"); setView("overview"); setNotice("");
    }
  }

  const signButton = (tx: Transaction) => (
    <SignButton
      tx={tx}
      hasHash={!!privy.pendingHashes[tx.id]}
      busy={busy}
      signerReady={privy.signerReady}
      needsGas={privy.needsGas}
      onSign={(target) => void privy.signTransaction(target)}
    />
  );
  const renderTxAction = privyMode
    ? (tx: Transaction) => tx.status === "awaiting_user_signature" ? <div className="detail-note">{signButton(tx)}</div> : null
    : undefined;
  const connectWalletButton = (className: string) => (
    <ConnectWalletButton className={className} privyAppId={privyAppId} busy={busy} privyReady={!!signer?.ready} onConnect={privy.connectWallet}/>
  );

  function renderWorkspace() {
    if (!state) return null;
    const walletActive = state.wallet.active;
    const transferForm = <TransferForm form={form} busy={busy} walletActive={walletActive} wrongNetwork={wrongNetwork} privyMode={privyMode}/>;
    const reconciliationPanel = <ReconciliationPanel balances={state.balances} balanced={state.reconciliation.balanced}/>;
    return (
      <>
        <PageHeading title={viewTitle} view={view} privyMode={privyMode} wrongNetwork={wrongNetwork}/>
        <SignatureAlert
          awaitingSignature={awaitingSignature}
          pendingHashes={privy.pendingHashes}
          signer={signer}
          walletMismatch={privy.walletMismatch}
          needsGas={privy.needsGas}
          busy={busy}
          onConnect={privy.connectWallet}
          renderSignButton={signButton}
        />
        <GasAlert
          privyMode={privyMode}
          walletActive={!!walletActive}
          smartAccountAddress={privy.smartAccountAddress}
          needsGas={privy.needsGas}
          aaStatus={privy.aaStatus}
          hasAwaitingSignature={awaitingSignature.length > 0}
          copied={copied}
          onCopyAddress={copyAddress}
          onRefreshStatus={privy.refreshAaStatus}
        />
        {wrongNetwork ? (
          <WrongNetworkAlert
            connectedChainId={state.network.connectedChainId}
            busy={busy}
            onUseSepolia={() => perform("network", "/api/simulation/network", { chainId: 11155111 })}
          />
        ) : null}
        {view === "overview" ? (
          <OverviewView
            custodialCard={<CustodialCard available={state.balances.custodialAvailable} reserved={state.balances.custodialReserved}/>}
            walletCard={(
              <WalletCard
                wallet={state.wallet}
                available={state.balances.walletAvailable}
                reserved={state.balances.walletReserved}
                privyMode={privyMode}
                ownerAddress={privy.ownerAddress}
                aaStatus={privy.aaStatus}
                copied={copied}
                busy={busy}
                onCopyAddress={copyAddress}
                onActivate={async () => { if (await perform("activate", "/api/wallet/activate")) setNotice("Wallet simulada ativada. O endereço é fictício e não recebe ativos reais."); }}
                connectWalletButton={connectWalletButton("button secondary small activate-wallet")}
              />
            )}
            transferForm={transferForm}
            reconciliationPanel={reconciliationPanel}
            transactions={state.transactions}
            privyMode={privyMode}
            renderTxAction={renderTxAction}
            onChangeView={changeView}
          />
        ) : null}
        {view === "transfers" ? (
          <TransfersView
            transferForm={transferForm}
            activationPanel={walletActive ? null : (
              <WalletActivationPanel
                privyMode={privyMode}
                busy={busy}
                onActivate={() => perform("activate", "/api/wallet/activate")}
                connectWalletButton={connectWalletButton("button secondary full-width")}
              />
            )}
            reconciliationPanel={reconciliationPanel}
            transactions={state.transactions}
            privyMode={privyMode}
            renderTxAction={renderTxAction}
            onChangeView={changeView}
          />
        ) : null}
        {view === "activity" ? (
          <ActivityHistory
            transactions={state.transactions}
            privyMode={privyMode}
            renderAction={renderTxAction}
            activityFilter={activityFilter}
            setActivityFilter={setActivityFilter}
          />
        ) : null}
        {view === "lab" && !privyMode ? (
          <LabView
            outcome={form.outcome}
            onOutcomeChange={form.setOutcome}
            connectedChainId={state.network.connectedChainId}
            busy={busy}
            onNetworkChange={(chainId) => perform("network", "/api/simulation/network", { chainId })}
            onChangeView={changeView}
            reconciliationPanel={reconciliationPanel}
            confirmReset={confirmReset}
            onConfirmResetChange={setConfirmReset}
            onReset={async () => {
              if (await perform("reset", "/api/simulation/reset")) {
                setConfirmReset(false); form.setAmount(""); setNotice("Demonstração reiniciada. O saldo inicial está disponível na conta custodial.");
              }
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
      <Sidebar items={visibleNavigation} view={view} onChangeView={changeView} disabled={!state?.user} privyMode={privyMode}/>
      <div className="main-shell">
        <Topbar
          title={state?.user ? viewTitle : "Acesso à demonstração"}
          userEmail={state?.user?.email ?? null}
          busy={!!busy}
          onLogout={logout}
        />
        {privyAppId ? <PrivyLoader appId={privyAppId} onSigner={privy.setSigner}/> : null}
        <EnvironmentBanner privyMode={privyMode}/>
        <main id="main-content" className="main-content">
          <FlashMessages error={error} notice={notice} onDismissError={() => setError("")} onDismissNotice={() => setNotice("")}/>
          {loading ? <LoadingState/> : !state ? (
            <ConnectionState onRetry={() => { setError(""); requestReload(); }}/>
          ) : !state.user ? (
            <div className="login-layout">
              <LoginStory/>
              <LoginPanel
                loginStep={auth.loginStep}
                email={auth.email}
                code={auth.code}
                busy={!!busy}
                onEmailChange={auth.setEmail}
                onCodeChange={auth.setCode}
                onRequestCode={auth.requestCode}
                onLogin={auth.login}
                onChangeEmail={() => { auth.setLoginStep("email"); setNotice(""); auth.setCode(""); }}
              />
            </div>
          ) : renderWorkspace()}
          <PageFooter privyMode={privyMode}/>
        </main>
      </div>
    </div>
  );
}
