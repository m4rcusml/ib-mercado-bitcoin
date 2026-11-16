import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BridgeState, Transaction } from "@/lib/domain/contracts";
import { toSignerError } from "@/components/privy/signer";
import type { PrivySigner, SmartAccountStatus } from "@/components/privy/signer";
import { transactionView, walletView } from "@/lib/client/bridge-view";
import { readPendingHashes, writePendingHashes } from "@/lib/client/pending-hashes";
import type { Perform } from "@/hooks/use-bridge-state";

interface PrivyFlowOptions {
  state: BridgeState | null;
  privyMode: boolean;
  perform: Perform;
  setBusy: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

/**
 * Fluxo Privy/ERC-4337 da página: signer exposto pelo `PrivyLoader`, vinculação da wallet,
 * assinatura e registro de UserOperations (com `userOpHash` pendente guardado no localStorage)
 * e situação de gas/deploy da smart account.
 */
export function usePrivyFlow({ state, privyMode, perform, setBusy, setError, setNotice }: PrivyFlowOptions) {
  const [signer, setSigner] = useState<PrivySigner | null>(null);
  const [pendingHashes, setPendingHashes] = useState<Record<string, string>>({});
  const linkAfterLogin = useRef(false);
  const wallet = walletView(state);
  const smartAccountAddress = wallet?.address ?? null;
  const ownerAddress = wallet?.ownerAddress ?? null;
  const linkedOwner = ownerAddress?.toLowerCase() ?? null;
  // A EOA Privy é apenas a assinante: compara-se com `ownerAddress`, não com o endereço da smart account.
  const walletMismatch = privyMode && !!wallet?.active && !!signer?.ownerAddress && !!linkedOwner && signer.ownerAddress.toLowerCase() !== linkedOwner;
  const [aaStatus, setAaStatus] = useState<SmartAccountStatus | null>(null);
  const [aaStatusTick, setAaStatusTick] = useState(0);
  const needsGas = privyMode && !!aaStatus && aaStatus.balanceWei === 0n && !!smartAccountAddress && aaStatus.address.toLowerCase() === smartAccountAddress.toLowerCase();
  const refreshAaStatus = useCallback(() => setAaStatusTick((value) => value + 1), []);

  useEffect(() => { setPendingHashes(readPendingHashes()); }, []);

  // Hashes guardados localmente só servem enquanto a operação ainda espera o registro do envio.
  useEffect(() => {
    if (!state?.user) return;
    setPendingHashes((current) => {
      const kept = Object.fromEntries(Object.entries(current).filter(([id]) => state.transactions.some((tx) => tx.id === id && tx.status === "awaiting_user_signature")));
      if (Object.keys(kept).length === Object.keys(current).length) return current;
      writePendingHashes(kept);
      return kept;
    });
  }, [state]);

  // Saldo de ETH e deploy da smart account (leitura via proxy `/api/rpc`). Reconsulta quando há
  // nova assinatura pendente ou quando o usuário pede, para avisar antes de assinar.
  const awaitingCount = state?.transactions.filter((tx) => tx.status === "awaiting_user_signature").length ?? 0;
  const canReadChain = privyMode && !!wallet?.active && !!smartAccountAddress && !!signer?.ready && !!state?.user;
  useEffect(() => {
    if (!canReadChain || !signer || !smartAccountAddress) { setAaStatus(null); return; }
    let cancelled = false;
    signer.getSmartAccountStatus(smartAccountAddress)
      .then((status) => { if (!cancelled) setAaStatus(status); })
      .catch(() => { if (!cancelled) setAaStatus(null); });
    return () => { cancelled = true; };
  }, [canReadChain, signer, smartAccountAddress, awaitingCount, aaStatusTick]);

  const linkWallet = useCallback(async (current: PrivySigner) => {
    let token: string | null = null;
    try { token = await current.getAccessToken(); } catch { token = null; }
    if (!token) { setError("Não foi possível obter a sessão Privy. Conecte a wallet novamente."); return; }
    if (await perform("link", "/api/wallet/link", { privyAccessToken: token })) setNotice("Smart account vinculada. Ela existe na Sepolia: use somente ativos de teste e envie ETH Sepolia para o endereço da smart account para pagar o gas.");
  }, [perform, setError, setNotice]);

  useEffect(() => {
    if (!linkAfterLogin.current || !signer?.authenticated || !signer.ownerAddress) return;
    linkAfterLogin.current = false;
    void linkWallet(signer);
  }, [signer, linkWallet]);

  function connectWallet() {
    if (!signer?.ready) return;
    setError(""); setNotice("");
    if (signer.authenticated && signer.ownerAddress) { void linkWallet(signer); return; }
    linkAfterLogin.current = true;
    if (!signer.authenticated) signer.login();
    else setNotice("Preparando sua embedded wallet. A vinculação continua automaticamente.");
  }

  function rememberHash(id: string, hash: string | null) {
    setPendingHashes((current) => {
      const next = { ...current };
      if (hash) next[id] = hash; else delete next[id];
      writePendingHashes(next);
      return next;
    });
  }

  async function signTransaction(raw: Transaction) {
    const tx = transactionView(raw);
    const key = `sign-${tx.id}`;
    let userOpHash = pendingHashes[tx.id];
    if (!userOpHash) {
      const request = tx.signatureRequest;
      if (!request) { setError("O servidor ainda não enviou os dados para assinatura. Aguarde a próxima atualização."); return; }
      if (!signer?.authenticated) { setError("Conecte sua wallet Privy antes de assinar."); return; }
      if (walletMismatch) { setError("A wallet Privy conectada não é a assinante vinculada a esta conta. Entre com a mesma conta Privy."); return; }
      const target = { smartAccount: request.smartAccount ?? smartAccountAddress ?? "", ownerAddress: request.ownerAddress ?? ownerAddress ?? "" };
      if (smartAccountAddress && target.smartAccount.toLowerCase() !== smartAccountAddress.toLowerCase()) { setError("Smart account divergente do servidor. Atualize a página."); return; }
      setBusy(key); setError(""); setNotice("");
      try {
        userOpHash = await signer.sendUserOperation(request, target);
      } catch (err) {
        const signerError = toSignerError(err);
        setError(signerError.message);
        if (signerError.code === "no_eth" || signerError.code === "insufficient_gas") setAaStatusTick((value) => value + 1);
        setBusy(null);
        return;
      }
      rememberHash(tx.id, userOpHash);
    }
    const sentHash = userOpHash;
    const next = await perform(key, `/api/transfers/${encodeURIComponent(tx.id)}/submission`, { userOpHash: sentHash }, { "Idempotency-Key": `submit-${sentHash}` });
    if (next) {
      rememberHash(tx.id, null);
      setAaStatusTick((value) => value + 1);
      setNotice("UserOperation enviada ao bundler. O servidor acompanha o receipt na Sepolia; o saldo só muda após a confirmação.");
    } else {
      setError((message) => `${message} A UserOperation já foi enviada ao bundler (${sentHash.slice(0, 10)}…); use "Registrar envio" para tentar de novo sem assinar outra vez.`);
    }
  }

  /** Signer pronto para assinar com a mesma EOA vinculada à conta. */
  const signerReady = !!signer?.ready && !!signer.authenticated && !!signer.ownerAddress && !walletMismatch;

  return {
    signer,
    setSigner,
    pendingHashes,
    smartAccountAddress,
    ownerAddress,
    walletMismatch,
    signerReady,
    aaStatus,
    needsGas,
    refreshAaStatus,
    connectWallet,
    signTransaction,
  };
}

export type PrivyFlow = ReturnType<typeof usePrivyFlow>;
