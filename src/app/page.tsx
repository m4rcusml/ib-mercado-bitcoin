"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { BridgeState, Direction, SimulationOutcome, Transaction } from "@/lib/domain/contracts";
import { Icon } from "@/components/icon";
import type { IconName } from "@/components/icon";
import { PrivyLoader } from "@/components/privy/privy-loader";
import { toSignerError } from "@/components/privy/signer";
import type { PrivySigner, SignatureRequest, SmartAccountStatus } from "@/components/privy/signer";

/** Estados em que a operação ainda pode mudar e a interface deve reconsultar. */
const OPEN_STATUSES = new Set<string>(["processing", "awaiting_user_signature", "submitted", "unknown"]);
/** `userOpHash` já devolvido pelo bundler e ainda não registrado no servidor, por transferência. */
const PENDING_HASHES_KEY = "mb-bridge:pending-user-operations";

/**
 * Visão da wallet no modo ERC-4337: `address` é a smart account (conta operacional) e
 * `ownerAddress` é a EOA embedded Privy (somente assinante). Campos opcionais toleram um servidor antigo.
 */
type WalletView = BridgeState["wallet"] & {
  ownerAddress?: string | null;
  smartAccount?: { type: "coinbase"; entryPoint: "0.6" } | null;
};
type TransactionView = Omit<Transaction, "signatureRequest"> & { signatureRequest: SignatureRequest | null; userOpHash?: string | null };
const walletView = (state: BridgeState | null): WalletView | null => state ? state.wallet as WalletView : null;
const transactionView = (tx: Transaction): TransactionView => tx as TransactionView;
const shortAddress = (value: string) => `${value.slice(0, 7)}…${value.slice(-5)}`;

function readPendingHashes(): Record<string, string> {
  try { const raw = window.localStorage.getItem(PENDING_HASHES_KEY); const parsed: unknown = raw ? JSON.parse(raw) : {}; return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {}; } catch { return {}; }
}

function writePendingHashes(value: Record<string, string>) {
  try { window.localStorage.setItem(PENDING_HASHES_KEY, JSON.stringify(value)); } catch { /* armazenamento indisponível: o hash fica só em memória */ }
}

type View = "overview" | "transfers" | "activity" | "lab";
const navigation: { id: View; title: string; icon: IconName }[] = [
  { id: "overview", title: "Visão geral", icon: "overview" },
  { id: "transfers", title: "Transferências", icon: "transfer" },
  { id: "activity", title: "Atividade", icon: "activity" },
  { id: "lab", title: "Laboratório", icon: "lab" },
];

function formatAmount(value: string) {
  const [whole = "0", fraction = "00"] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function centsOf(value: string): bigint | null {
  const clean = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d*)?$/.test(clean) || clean.length > 80) return null;
  const [whole, fraction = ""] = clean.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function decimalOf(cents: bigint) {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

/** Mensagens da PoC para códigos do servidor; demais erros usam a mensagem enviada pela API. */
const apiErrorMessages: Record<string, string> = {
  INVALID_PRIVY_TOKEN: "Sua sessão Privy expirou ou é inválida. Conecte a wallet novamente.",
  EMBEDDED_WALLET_NOT_FOUND: "A embedded wallet Privy ainda não foi criada para este login. Aguarde alguns segundos e tente conectar de novo.",
  WALLET_ALREADY_LINKED: "Esta embedded wallet já está vinculada a outra conta de demonstração. Entre com outra conta Privy.",
  PENDING_TRANSACTION: "Há uma operação em andamento. Aguarde a conclusão antes de trocar a wallet.",
  MISSING_CONFIG: "A PoC Sepolia não está configurada no servidor. Avise a equipe responsável pelo ambiente.",
  INVALID_TX_HASH: "A wallet devolveu um hash inválido. Nada foi registrado; tente assinar novamente.",
  INVALID_USER_OP_HASH: "O bundler devolveu um userOpHash inválido. Nada foi registrado; tente assinar novamente.",
  DUPLICATE_USER_OP_HASH: "Este userOpHash já está vinculado a outra transferência e não pode ser reutilizado.",
  SMART_ACCOUNT_MISMATCH: "Smart account divergente do servidor. Entre com a mesma conta Privy usada na vinculação.",
  TRANSFER_NOT_FOUND: "Esta transferência não foi encontrada. Atualize a página.",
  INVALID_TRANSFER_STATUS: "Esta transferência não está mais aguardando assinatura. Atualize a página para ver o estado atual.",
  DUPLICATE_TX_HASH: "Este hash já está vinculado a outra transferência e não pode ser reutilizado.",
  WALLET_LINK_REQUIRED: "No modo Sepolia, conecte a wallet pela Privy.",
  SIMULATION_DISABLED: "Controles de simulação não estão disponíveis no modo Sepolia.",
};

async function callApi<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store", headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code: unknown = data?.error?.code;
    throw new Error((typeof code === "string" ? apiErrorMessages[code] : undefined) ?? data?.error?.message ?? "Não foi possível concluir a solicitação. Tente novamente.");
  }
  return data as T;
}

const statusLabels: Record<string, string> = {
  processing: "Processando",
  awaiting_user_signature: "Aguardando assinatura",
  submitted: "Enviada — verificando na Sepolia",
  unknown: "Indeterminada — reconsultando",
  confirmed: "Confirmada",
  failed: "Falhou",
};

function Status({ transaction, privy = false }: { transaction: Transaction; privy?: boolean }) {
  const label = !privy && transaction.status === "unknown" ? "Aguardando rede" : privy && transaction.status === "submitted" ? "UserOperation enviada — aguardando bundler/Sepolia" : statusLabels[transaction.status] ?? transaction.status;
  const tone = transaction.status === "confirmed" || transaction.status === "failed" ? transaction.status : "processing";
  return <span className={`status status-${tone}`}><Icon name={transaction.status === "confirmed" ? "check" : transaction.status === "failed" ? "close" : "clock"} size={13}/>{label}</span>;
}

function TransactionList({ transactions, compact = false, privy = false, renderAction }: { transactions: Transaction[]; compact?: boolean; privy?: boolean; renderAction?: (tx: Transaction) => ReactNode }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!transactions.length) return <div className="empty-state"><span className="empty-icon"><Icon name="transfer" size={25}/></span><strong>Sua primeira transferência começa aqui</strong><p>Ao movimentar Mock USDC, você acompanha cada etapa neste espaço.</p></div>;
  return <div className="transaction-table"><div className="table-heading"><span>Operação</span><span>Valor</span><span>Estado</span><span>Data</span><span/></div>{transactions.slice(0, compact ? 4 : undefined).map((tx) => <div className="transaction-group" key={tx.id}><button type="button" className="transaction-row" aria-expanded={expanded === tx.id} onClick={() => setExpanded(expanded === tx.id ? null : tx.id)}><span className="transaction-operation"><span className={`transaction-icon ${tx.direction === "wallet_to_mb" ? "incoming" : ""}`}><Icon name="arrow" size={18}/></span><span><strong>{tx.direction === "mb_to_wallet" ? "Conta MB para wallet" : "Wallet para conta MB"}</strong><small>{privy ? "Sepolia · Mock USDC de teste" : "Transferência simulada"}</small></span></span><span className="transaction-value">{formatAmount(tx.amount)}<small>Mock USDC</small></span><Status transaction={tx} privy={privy}/><span className="transaction-date">{formatTime(tx.createdAt)}</span><Icon name="chevron" size={16} className={expanded === tx.id ? "rotated" : ""}/></button>{expanded === tx.id ? <div className="transaction-detail"><dl><div><dt>Identificador local</dt><dd>{tx.simulationId}</dd></div><div><dt>Idempotência</dt><dd>{tx.idempotencyKey}</dd></div>{privy ? <div><dt>UserOperation (userOpHash)</dt><dd>{tx.userOpHash ?? "Ainda não enviada ao bundler"}</dd></div> : null}<div><dt>Registro na blockchain</dt><dd>{tx.txHash ?? tx.hash ?? (privy ? "Ainda sem transação on-chain" : "Simulada · sem registro on-chain")}</dd></div></dl>{tx.failureReason ? <p className="detail-failure">{tx.failureReason} O valor foi devolvido ao saldo de origem.</p> : null}{privy && tx.status === "submitted" ? <p className="detail-note">UserOperation entregue ao bundler. O saldo só muda depois que o servidor verificar o receipt e o evento Transfer na Sepolia.</p> : null}{privy && tx.status === "unknown" ? <p className="detail-note">A rede ainda não deu evidência suficiente. O valor segue reservado enquanto o servidor reconsulta.</p> : null}{renderAction?.(tx)}{tx.explorerUrl ? <a className="text-link" href={tx.explorerUrl} target="_blank" rel="noreferrer">Ver no explorador <Icon name="external" size={14}/></a> : <p className="detail-note">{privy ? "O link para o explorador aparece quando o servidor observar a transação na Sepolia." : "O link para o explorador estará disponível após a integração real com Sepolia."}</p>}</div> : null}</div>)}</div>;
}

export default function Home() {
  const [state, setState] = useState<BridgeState | null>(null);
  const [signer, setSigner] = useState<PrivySigner | null>(null);
  const [pendingHashes, setPendingHashes] = useState<Record<string, string>>({});
  const linkAfterLogin = useRef(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<View>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("equipe@demo.local");
  const [loginStep, setLoginStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [direction, setDirection] = useState<Direction>("mb_to_wallet");
  const [amount, setAmount] = useState("");
  const [outcome, setOutcome] = useState<SimulationOutcome>("confirmed");
  const [confirmReset, setConfirmReset] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activityFilter, setActivityFilter] = useState("all");
  const controllers = useRef(new Set<AbortController>());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transferIntent = useRef<{ body: string; key: string } | null>(null);
  const activeEmail = state?.user?.email;
  const privyMode = state?.mode === "privy";
  const privyAppId = privyMode ? state?.privyAppId ?? null : null;
  const hasProcessing = state?.transactions.some((transaction) => OPEN_STATUSES.has(transaction.status)) ?? false;
  const visibleNavigation = privyMode ? navigation.filter((item) => item.id !== "lab") : navigation;
  const wallet = walletView(state);
  const smartAccountAddress = wallet?.address ?? null;
  const ownerAddress = wallet?.ownerAddress ?? null;
  const linkedOwner = ownerAddress?.toLowerCase() ?? null;
  // A EOA Privy é apenas a assinante: compara-se com `ownerAddress`, não com o endereço da smart account.
  const walletMismatch = privyMode && !!wallet?.active && !!signer?.ownerAddress && !!linkedOwner && signer.ownerAddress.toLowerCase() !== linkedOwner;
  const [aaStatus, setAaStatus] = useState<SmartAccountStatus | null>(null);
  const [aaStatusTick, setAaStatusTick] = useState(0);
  const needsGas = privyMode && !!aaStatus && aaStatus.balanceWei === 0n && !!smartAccountAddress && aaStatus.address.toLowerCase() === smartAccountAddress.toLowerCase();

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

  useEffect(() => { if (view === "lab" && privyMode) setView("overview"); }, [view, privyMode]);

  // Saldo de ETH e deploy da smart account (leitura via proxy `/api/rpc`). Reconsulta quando há
  // nova assinatura pendente ou quando o usuário pede, para avisar antes de assinar.
  const awaitingCount = state?.transactions.filter((tx) => tx.status === "awaiting_user_signature").length ?? 0;
  const canReadChain = privyMode && !!wallet?.active && !!smartAccountAddress && !!signer?.ready && !!state?.user;
  useEffect(() => {
    if (!canReadChain || !signer || !smartAccountAddress) { setAaStatus(null); return; }
    let cancelled = false;
    signer.getSmartAccountStatus(smartAccountAddress).then((status) => { if (!cancelled) setAaStatus(status); }).catch(() => { if (!cancelled) setAaStatus(null); });
    return () => { cancelled = true; };
  }, [canReadChain, signer, smartAccountAddress, awaitingCount, aaStatusTick]);

  useEffect(() => {
    const activeControllers = controllers.current;
    return () => { activeControllers.forEach((controller) => controller.abort()); if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    callApi<BridgeState>("/api/state", { signal: controller.signal }).then(setState).catch((err: Error) => { if (err.name !== "AbortError") setError("Não foi possível carregar a conta. Verifique se o servidor local está disponível."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  // SSE: o servidor empurra o estado da conta a cada mudança (worker de reconciliação ou outra aba).
  const [sseLive, setSseLive] = useState(false);
  useEffect(() => {
    if (!activeEmail || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    source.onopen = () => setSseLive(true);
    source.onerror = () => setSseLive(false); // o EventSource reconecta sozinho; o polling assume enquanto isso
    source.addEventListener("state", (event) => {
      try { setState(JSON.parse((event as MessageEvent<string>).data) as BridgeState); setSseLive(true); }
      catch { /* evento malformado: mantém o estado atual */ }
    });
    return () => { source.close(); setSseLive(false); };
  }, [activeEmail]);

  useEffect(() => {
    // No modo Privy o worker do servidor reconcilia e o SSE entrega; polling só como fallback.
    // No modo simulado o polling continua, pois é ele que avança a simulação.
    if (!hasProcessing || !activeEmail || (privyMode && sseLive)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const interval = privyMode ? 4000 : 1000;
    // Modo simulado avança a simulação; modo Privy apenas pede reconciliação/estado ao servidor.
    const fetchNext = () => privyMode
      ? callApi<BridgeState>("/api/reconciliation/advance", { method: "POST", signal: controller.signal }).catch((err: unknown) => { if (controller.signal.aborted) throw err; return callApi<BridgeState>("/api/state", { signal: controller.signal }); })
      : callApi<BridgeState>("/api/simulation/advance", { method: "POST", signal: controller.signal });
    const advance = async () => {
      try {
        const next = await fetchNext();
        if (controller.signal.aborted) return;
        setState(next);
        if (next.transactions.some((tx) => OPEN_STATUSES.has(tx.status))) timer = setTimeout(advance, interval);
      } catch (err) {
        if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "Não foi possível atualizar a operação."); timer = setTimeout(advance, 3000); }
      }
    };
    timer = setTimeout(advance, interval);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [hasProcessing, activeEmail, privyMode, sseLive]);

  const perform = useCallback(async (key: string, url: string, body?: object, extraHeaders?: Record<string, string>) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    setBusy(key); setError(""); setNotice("");
    try {
      const next = await callApi<BridgeState>(url, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}), headers: extraHeaders, signal: controller.signal });
      if (!controller.signal.aborted) setState(next);
      return next;
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Não foi possível concluir a ação.");
      return null;
    } finally { controllers.current.delete(controller); if (!controller.signal.aborted) setBusy(null); }
  }, []);

  const linkWallet = useCallback(async (current: PrivySigner) => {
    let token: string | null = null;
    try { token = await current.getAccessToken(); } catch { token = null; }
    if (!token) { setError("Não foi possível obter a sessão Privy. Conecte a wallet novamente."); return; }
    if (await perform("link", "/api/wallet/link", { privyAccessToken: token })) setNotice("Smart account vinculada. Ela existe na Sepolia: use somente ativos de teste e envie ETH Sepolia para o endereço da smart account para pagar o gas.");
  }, [perform]);

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
      try { userOpHash = await signer.sendUserOperation(request, target); }
      catch (err) {
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
    if (next) { rememberHash(tx.id, null); setAaStatusTick((value) => value + 1); setNotice("UserOperation enviada ao bundler. O servidor acompanha o receipt na Sepolia; o saldo só muda após a confirmação."); }
    else setError((message) => `${message} A UserOperation já foi enviada ao bundler (${sentHash.slice(0, 10)}…); use "Registrar envio" para tentar de novo sem assinar outra vez.`);
  }

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    const controller = new AbortController();
    controllers.current.add(controller);
    setBusy("request-code"); setError("");
    try {
      await callApi<{ demoCode: string }>("/api/auth/request-code", { method: "POST", body: JSON.stringify({ email }), signal: controller.signal });
      setLoginStep("code"); setNotice("Código de demonstração pronto. Nenhum e-mail é enviado neste ambiente.");
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Não foi possível preparar o acesso."); }
    finally { controllers.current.delete(controller); if (!controller.signal.aborted) setBusy(null); }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (await perform("login", "/api/auth/login", { email, code })) { setNotice("Você entrou na conta de demonstração."); setCode(""); }
  }

  const balance = state ? (direction === "mb_to_wallet" ? state.balances.custodialAvailable : state.balances.walletAvailable) : "0.00";
  const parsedAmount = centsOf(amount);
  const availableCents = centsOf(balance) ?? 0n;
  const normalizedAmount = parsedAmount === null ? "0.00" : decimalOf(parsedAmount);
  const extraDecimals = (amount.replace(",", ".").split(".")[1]?.length ?? 0) > 2;
  const wrongNetwork = state && !privyMode ? state.network.connectedChainId !== state.network.chainId : false;
  const amountError = !amount ? "" : parsedAmount === null ? "Informe um valor válido, usando vírgula ou ponto para os centavos." : parsedAmount <= 0n ? "O valor precisa ser maior que zero." : parsedAmount > availableCents ? "O valor é maior que o saldo disponível na origem." : "";
  const currentTransaction = state?.transactions[0];
  const filteredTransactions = state?.transactions.filter((tx) => activityFilter === "all" || tx.status === activityFilter) ?? [];
  const awaitingSignature = privyMode ? state?.transactions.filter((tx) => tx.status === "awaiting_user_signature") ?? [] : [];

  async function transfer(event: FormEvent) {
    event.preventDefault();
    if (!parsedAmount || amountError || !state?.wallet.active || wrongNetwork) return;
    const body = privyMode ? { direction, amount: amount.trim().replace(",", ".") } : { direction, amount: amount.trim().replace(",", "."), outcome };
    const serialized = JSON.stringify(body);
    if (transferIntent.current?.body !== serialized) transferIntent.current = { body: serialized, key: crypto.randomUUID() };
    const next = await perform("transfer", "/api/transfers", body, { "Idempotency-Key": transferIntent.current.key });
    if (next) { transferIntent.current = null; setAmount(""); setNotice(!privyMode ? "Transferência iniciada. O valor está reservado até a conclusão da simulação." : direction === "wallet_to_mb" ? "Valor reservado. Assine no navegador para enviar a UserOperation pela sua smart account." : "Valor reservado. A tesouraria enviará na Sepolia; o saldo muda somente após a verificação."); }
  }

  async function copyAddress() {
    if (!state?.wallet.address) return;
    try { await navigator.clipboard.writeText(state.wallet.address); setCopied(true); if (copyTimer.current) clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 2200); }
    catch { setError("Não foi possível copiar automaticamente. Selecione e copie o endereço exibido."); }
  }

  /** Aviso de gas: sem paymaster, a smart account paga o gas com o próprio ETH Sepolia. */
  function gasPanel() {
    if (!privyMode || !wallet?.active || !smartAccountAddress) return null;
    if (!needsGas) {
      if (!aaStatus || aaStatus.deployed || !awaitingSignature.length) return null;
      return <div className="network-alert" role="note"><Icon name="info" size={19}/><div><strong>Primeira UserOperation desta smart account</strong><p>A smart account ainda não foi implantada. O primeiro envio também faz o deploy (initCode) e por isso consome mais gas. Saldo atual: {aaStatus.balanceEth} ETH Sepolia.</p></div></div>;
    }
    return <div className="network-alert" role="alert"><Icon name="info" size={19}/><div><strong>A smart account precisa de ETH Sepolia para pagar o gas</strong><p>Envie ETH de teste de um faucet Sepolia para o endereço da <strong>smart account</strong> (não para a EOA Privy): <code style={{ wordBreak: "break-all" }}>{smartAccountAddress}</code>. {aaStatus && !aaStatus.deployed ? "A primeira UserOperation também implanta a conta (initCode) e consome mais gas que as seguintes." : null}</p></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" className="button secondary small" onClick={copyAddress}>{copied ? "Copiado" : "Copiar endereço"}<Icon name={copied ? "check" : "copy"} size={14}/></button><button type="button" className="button secondary small" onClick={() => setAaStatusTick((value) => value + 1)}>Verificar saldo<Icon name="refresh" size={14}/></button></div></div>;
  }

  const changeView = (next: View) => { setView(next); setError(""); setNotice(""); setConfirmReset(false); };

  function signButton(tx: Transaction) {
    const hasHash = !!pendingHashes[tx.id];
    const signerReady = !!signer?.ready && !!signer.authenticated && !!signer.ownerAddress && !walletMismatch;
    const disabled = !!busy || (!hasHash && (!tx.signatureRequest || !signerReady || needsGas));
    const label = busy === `sign-${tx.id}` ? (hasHash ? "Registrando envio…" : "Confirme na wallet…") : hasHash ? "Registrar envio" : "Assinar no navegador";
    return <button type="button" className="button primary small" disabled={disabled} onClick={() => void signTransaction(tx)}>{label}<Icon name="arrow" size={16}/></button>;
  }

  function signaturePanel() {
    const first = awaitingSignature[0];
    if (!first) return null;
    const hint = pendingHashes[first.id] ? "O bundler já recebeu esta UserOperation. Falta apenas registrar o userOpHash no servidor." : !signer?.ready ? "Carregando a wallet Privy…" : !signer.authenticated ? "Conecte sua wallet Privy para assinar." : walletMismatch ? "A wallet Privy conectada não é a assinante vinculada a esta conta." : !first.signatureRequest ? "Aguardando os dados de assinatura do servidor." : needsGas ? "Antes de assinar, envie ETH Sepolia para a smart account (veja o aviso abaixo)." : "Ao assinar, a EOA Privy autoriza uma UserOperation da sua smart account (ERC-4337), enviada ao bundler; a smart account paga o gas em ETH de teste.";
    return <div className="network-alert" role="status"><Icon name="wallet" size={19}/><div><strong>{awaitingSignature.length === 1 ? "Uma transferência aguarda sua assinatura" : `${awaitingSignature.length} transferências aguardam sua assinatura`}</strong><p>{formatAmount(first.amount)} Mock USDC da sua smart account para a conta MB. {hint} O saldo só muda depois da verificação no servidor.</p></div>{signer?.ready && !signer.authenticated && !pendingHashes[first.id] ? <button type="button" className="button secondary small" disabled={!!busy} onClick={connectWallet}>Conectar wallet</button> : signButton(first)}</div>;
  }

  const renderTxAction = privyMode ? (tx: Transaction) => tx.status === "awaiting_user_signature" ? <div className="detail-note">{signButton(tx)}</div> : null : undefined;

  function currentOperationText(tx: Transaction) {
    switch (tx.status) {
      case "awaiting_user_signature": return "O valor está reservado. Assine no navegador para enviar a UserOperation pela sua smart account.";
      case "submitted": return "UserOperation enviada — aguardando bundler/Sepolia. O servidor verifica o receipt e o evento Transfer antes de alterar saldos.";
      case "unknown": return privyMode ? "Ainda sem evidência suficiente da rede. O valor segue reservado e a consulta continua." : "A rede ainda não respondeu. O valor segue reservado.";
      case "processing": return privyMode ? "O valor está reservado enquanto a operação é preparada na Sepolia." : "O valor está reservado. A confirmação acontecerá após a janela de simulação.";
      case "confirmed": return "O valor chegou ao destino e os saldos foram atualizados.";
      default: return "A operação não foi concluída. O valor reservado voltou à origem.";
    }
  }

  function connectWalletButton(className: string) {
    if (!privyAppId) return <p className="detail-note">A Privy não está configurada no servidor (privyAppId ausente).</p>;
    return <button className={className} disabled={!!busy || !signer?.ready} onClick={connectWallet}>{busy === "link" ? "Vinculando wallet…" : !signer?.ready ? "Carregando Privy…" : "Conectar wallet"}<Icon name="arrow" size={16}/></button>;
  }

  function transferForm() {
    return <section className="panel transfer-panel" aria-labelledby="transfer-title"><div className="panel-heading"><div><h2 id="transfer-title">Movimentar entre saldos</h2><p>Da sua conta para sua wallet. E de volta.</p></div><span className="token-label"><span className="token-symbol">$</span> Mock USDC</span></div><form onSubmit={transfer}><div className="direction-box"><div className="direction-end"><span className="small-icon"><Icon name={direction === "mb_to_wallet" ? "account" : "wallet"}/></span><span><small>De</small><strong>{direction === "mb_to_wallet" ? "Conta custodial MB" : "Wallet pessoal"}</strong></span></div><button className="swap-button" type="button" title="Inverter sentido da transferência" aria-label="Inverter sentido da transferência" onClick={() => { setDirection(direction === "mb_to_wallet" ? "wallet_to_mb" : "mb_to_wallet"); setAmount(""); }} disabled={!!busy}><Icon name="transfer" size={19}/></button><div className="direction-end direction-destination"><span className="small-icon"><Icon name={direction === "mb_to_wallet" ? "wallet" : "account"}/></span><span><small>Para</small><strong>{direction === "mb_to_wallet" ? "Wallet pessoal" : "Conta custodial MB"}</strong></span></div></div><div className="amount-label"><label htmlFor="amount">Quanto você quer transferir?</label><span>Disponível: <strong>{formatAmount(balance)}</strong></span></div><div className={`amount-field ${amountError ? "field-invalid" : ""}`}><input id="amount" name="amount" inputMode="decimal" autoComplete="off" placeholder="0,00" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={!!amountError} aria-describedby={amountError ? "amount-error" : "amount-help"} disabled={!!busy || !state?.wallet.active}/><span>Mock USDC</span></div><div className="amount-shortcuts">{[25n, 50n, 100n].map((percent) => <button key={percent.toString()} type="button" disabled={!!busy || !state?.wallet.active} onClick={() => setAmount(decimalOf(availableCents * percent / 100n).replace(".", ","))}>{percent === 100n ? "Máximo" : `${percent}%`}</button>)}</div>{amountError ? <p className="field-error" id="amount-error"><Icon name="info" size={14}/>{amountError}</p> : <p className="field-help" id="amount-help">{extraDecimals ? `O valor será truncado para ${formatAmount(normalizedAmount)} Mock USDC, sem arredondar.` : privyMode ? "Use até duas casas decimais. Da wallet para a conta MB, a smart account paga o gas em ETH Sepolia." : "Use até duas casas decimais. Nenhuma taxa nesta simulação."}</p>}<div className="transfer-summary"><span>Você transfere</span><strong>{formatAmount(normalizedAmount)} <small>Mock USDC</small></strong></div><button className="button primary full-width" type="submit" disabled={!!busy || !state?.wallet.active || wrongNetwork || !parsedAmount || !!amountError}>{busy === "transfer" ? "Iniciando transferência…" : !state?.wallet.active ? (privyMode ? "Conecte a wallet para transferir" : "Ative a wallet para transferir") : "Transferir Mock USDC"}<Icon name="arrow" size={18}/></button><p className="safe-note"><Icon name="shield" size={14}/> {privyMode ? "Testnet Sepolia. Somente Mock USDC de teste, sem valor real." : "Operação local. Você não movimenta dinheiro real."}</p></form></section>;
  }

  function reconciliationPanel() {
    if (!state) return null;
    return <section className="panel reconciliation-panel"><div className="panel-heading"><div><h2>Seus saldos fecham</h2><p>O total permanece igual durante toda a jornada.</p></div><span className={`reconciliation-mark ${state.reconciliation.balanced ? "" : "unbalanced"}`}><Icon name={state.reconciliation.balanced ? "check" : "info"} size={18}/></span></div><dl className="reconciliation-rows"><div><dt>Conta custodial disponível</dt><dd>{formatAmount(state.balances.custodialAvailable)}</dd></div><div><dt>Wallet disponível</dt><dd>{formatAmount(state.balances.walletAvailable)}</dd></div><div><dt>Reservado em transferências</dt><dd>{formatAmount(decimalOf((centsOf(state.balances.custodialReserved) ?? 0n) + (centsOf(state.balances.walletReserved) ?? 0n)))}</dd></div><div className="reconciliation-total"><dt>Total em Mock USDC</dt><dd>{formatAmount(state.balances.total)}</dd></div></dl><span className={`reconciled-label ${state.reconciliation.balanced ? "" : "unbalanced"}`}><span className="status-dot"/>{state.reconciliation.balanced ? "Saldos reconciliados" : "Divergência na reconciliação"}</span></section>;
  }

  return <div className="app-shell"><a className="skip-link" href="#main-content">Pular para o conteúdo</a><aside className="sidebar"><a className="brand" href="/" aria-label="MB Wallet Bridge, início"><span className="brand-symbol">mb<span/></span><span className="brand-name">wallet<br/><strong>bridge</strong></span></a><div className="workspace-label"><span className="workspace-dot"/> Espaço de demonstração</div><nav aria-label="Navegação principal">{visibleNavigation.map((item) => <button key={item.id} type="button" className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => changeView(item.id)} aria-current={view === item.id ? "page" : undefined} disabled={!state?.user}><Icon name={item.icon} size={19}/><span>{item.title}</span>{view === item.id ? <span className="nav-indicator"/> : null}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><Icon name="code" size={20}/><strong>Construído para explorar</strong><p>Uma base para conectar custódia e autonomia.</p><span>Inteli Blockchain × MB</span></div><div className="academic-tag"><span/> {privyMode ? "PoC acadêmica · Sepolia" : "Simulador acadêmico"}</div></div></aside><div className="main-shell"><header className="topbar"><div className="topbar-breadcrumb">Minha conta <Icon name="chevron" size={13}/><strong>{state?.user ? navigation.find((item) => item.id === view)?.title : "Acesso à demonstração"}</strong></div><div className="account-menu">{state?.user ? <><span className="user-email">{state.user.email}</span><span className="avatar">{state.user.email.slice(0, 2).toUpperCase()}</span><button className="icon-button logout-button" title="Sair da conta" aria-label="Sair da conta" disabled={!!busy} onClick={async () => { if (await perform("logout", "/api/auth/logout")) { if (signer?.authenticated) await signer.logout().catch(() => undefined); setLoginStep("email"); setView("overview"); setNotice(""); } }}><Icon name="logout" size={18}/></button></> : <span className="demo-account"><Icon name="shield" size={15}/> Conta de demonstração</span>}</div></header>{privyAppId ? <PrivyLoader appId={privyAppId} onSigner={setSigner}/> : null}{privyMode ? <div className="simulation-banner" role="note"><Icon name="info" size={15}/><span><strong>Testnet Sepolia — ativos de teste, não é produto oficial.</strong> As transferências usam Mock USDC sem valor e não representam o Mercado Bitcoin.</span><span className="local-indicator"><span/> Sepolia</span></div> : <div className="simulation-banner"><Icon name="info" size={15}/><span><strong>Ambiente de simulação.</strong> Nenhum ativo real ou conexão com a blockchain.</span><span className="local-indicator"><span/> Local</span></div>}<main id="main-content" className="main-content">{error ? <div className="message message-error" role="alert"><Icon name="info" size={18}/><span>{error}</span><button type="button" aria-label="Fechar mensagem de erro" onClick={() => setError("")}><Icon name="close" size={16}/></button></div> : null}<div aria-live="polite" aria-atomic="true">{notice ? <div className="message message-success"><Icon name="check" size={18}/><span>{notice}</span><button type="button" aria-label="Fechar aviso" onClick={() => setNotice("")}><Icon name="close" size={16}/></button></div> : null}</div>{loading ? <div className="loading-state" aria-busy="true" aria-label="Carregando conta"><div className="skeleton skeleton-title"/><div className="loading-columns"><div className="skeleton skeleton-card"/><div className="skeleton skeleton-card"/></div><div className="skeleton skeleton-content"/><p>Preparando seu ambiente de demonstração…</p></div> : !state ? <div className="connection-state"><Icon name="refresh" size={32}/><h1>Vamos tentar novamente?</h1><p>O ambiente local ainda não respondeu.</p><button className="button primary" onClick={() => { setError(""); setReload((value) => value + 1); }}>Recarregar conta</button></div> : !state.user ? <div className="login-layout"><section className="login-story"><span className="story-icon"><Icon name="transfer" size={30}/></span><h1>Da conta à wallet.<br/>Uma jornada conectada.</h1><p>Explore a ponte entre uma conta custodial e uma wallet pessoal em um ambiente feito para sua equipe desenvolver.</p><div className="login-bridge"><div><span className="bridge-endpoint"><Icon name="account" size={25}/></span><strong>Conta MB</strong><small>Custódia simulada</small></div><span className="bridge-connection"><span/><Icon name="transfer" size={22}/><span/></span><div><span className="bridge-endpoint wallet-endpoint"><Icon name="wallet" size={25}/></span><strong>Sua wallet</strong><small>Autocustódia simulada</small></div></div><div className="login-facts"><span><Icon name="check" size={15}/> Mock USDC nos dois sentidos</span><span><Icon name="check" size={15}/> Saldos separados e reconciliados</span><span><Icon name="check" size={15}/> Sem extensão, seed ou ativos reais</span></div></section><section className="login-panel panel"><div className="login-panel-heading"><h2>{loginStep === "email" ? "Entre na demonstração" : "Confirme seu acesso"}</h2><p>{loginStep === "email" ? "Use um e-mail para criar seu espaço local de testes." : <>Conta de demonstração para <strong>{email}</strong>.</>}</p></div>{loginStep === "email" ? <form onSubmit={requestCode}><label htmlFor="email">Seu e-mail</label><div className="email-field"><Icon name="mail" size={18}/><input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={!!busy}/></div><button className="button primary full-width" disabled={!!busy} type="submit">{busy ? "Preparando acesso…" : "Continuar com e-mail"}<Icon name="arrow" size={18}/></button></form> : <form onSubmit={login}><label htmlFor="code">Código de demonstração</label><input className="code-input" id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required placeholder="000000" autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} disabled={!!busy}/><div className="demo-code"><span>Use o código local</span><strong>123456</strong><small>Nenhum e-mail é enviado.</small></div><button className="button primary full-width" type="submit" disabled={!!busy || code.length !== 6}>{busy ? "Entrando…" : "Entrar na conta"}<Icon name="arrow" size={18}/></button><button className="text-button change-email" type="button" onClick={() => { setLoginStep("email"); setNotice(""); setCode(""); }}>Usar outro e-mail</button></form>}<p className="login-disclaimer"><Icon name="shield" size={16}/> Acesso demonstrativo. Não use dados pessoais ou credenciais reais.</p></section></div> : <><div className="page-heading"><div><h1>{navigation.find((item) => item.id === view)?.title}</h1><p>{view === "overview" ? "Sua conta e sua wallet, conectadas por novas possibilidades." : view === "transfers" ? "Movimente Mock USDC entre seus dois ambientes." : view === "activity" ? (privyMode ? "Acompanhe o caminho de cada transferência na Sepolia." : "Acompanhe o caminho de cada transferência simulada.") : "Controle os cenários e valide a integração da sua equipe."}</p></div><span className={`network-pill ${wrongNetwork ? "network-wrong" : ""}`}><span/>{wrongNetwork ? "Rede incompatível" : privyMode ? "Sepolia · testnet" : "Sepolia · simulada"}</span></div>{signaturePanel()}{gasPanel()}{wrongNetwork ? <div className="network-alert" role="alert"><Icon name="info" size={19}/><div><strong>Esta jornada usa a rede Sepolia.</strong><p>A rede simulada atual é {state.network.connectedChainId}. Volte para Sepolia para transferir.</p></div><button className="button secondary small" disabled={!!busy} onClick={() => perform("network", "/api/simulation/network", { chainId: 11155111 })}>Usar Sepolia</button></div> : null}{view === "overview" ? <><div className="balances-grid"><section className="balance-card custodial-card"><div className="balance-heading"><span className="balance-label"><Icon name="account" size={21}/> Conta custodial MB</span><span className="balance-chip">Simulada</span></div><div className="balance-number">{formatAmount(state.balances.custodialAvailable)}<span>Mock USDC</span></div><p className="balance-subtitle">Saldo disponível na sua conta</p><div className="balance-card-bottom"><span><Icon name="shield" size={15}/> Custódia da plataforma</span><span>{formatAmount(state.balances.custodialReserved)} reservado</span></div></section><section className={`balance-card wallet-card ${state.wallet.active ? "wallet-is-active" : ""}`}><div className="balance-heading"><span className="balance-label"><Icon name="wallet" size={21}/> Wallet pessoal</span><span className="balance-chip">{state.wallet.active ? (privyMode ? "Vinculada · Sepolia" : "Ativa · simulada") : privyMode ? "Não conectada" : "Ainda não ativada"}</span></div>{state.wallet.active ? <><div className="balance-number">{formatAmount(state.balances.walletAvailable)}<span>Mock USDC</span></div><p className="balance-subtitle">{privyMode ? "Saldo disponível na smart account (ERC-4337 · Sepolia)" : "Saldo disponível na wallet simulada"}</p>{privyMode ? <p className="balance-subtitle" style={{ fontSize: "0.8em", marginTop: 4 }}><span title={state.wallet.address ?? undefined}>Smart account (ERC-4337): <strong>{state.wallet.address ? shortAddress(state.wallet.address) : "—"}</strong></span>{ownerAddress ? <><br/><small title={ownerAddress}>Assinante (EOA Privy): {shortAddress(ownerAddress)}</small></> : null}{aaStatus ? <><br/><small>Gas: {aaStatus.balanceEth} ETH Sepolia{aaStatus.deployed ? "" : " · ainda não implantada"}</small></> : null}</p> : null}<div className="balance-card-bottom"><button className="address-button" type="button" onClick={copyAddress} title={state.wallet.address ?? undefined}><span>{state.wallet.address?.slice(0, 7)}…{state.wallet.address?.slice(-5)}</span><Icon name={copied ? "check" : "copy"} size={14}/><span className="sr-only">{copied ? "Endereço copiado" : privyMode ? "Copiar endereço da smart account" : "Copiar endereço fictício"}</span></button><span>{formatAmount(state.balances.walletReserved)} reservado</span></div></> : privyMode ? <><div className="inactive-wallet"><div><h2>Conecte sua wallet.</h2><p>Entre com a Privy: sua EOA embedded assina por uma smart account ERC-4337 na Sepolia.</p></div><span className="wallet-illustration"><Icon name="wallet" size={35}/></span></div>{connectWalletButton("button secondary small activate-wallet")}</> : <><div className="inactive-wallet"><div><h2>O próximo passo é seu.</h2><p>Ative sua wallet simulada e explore os dois lados da jornada.</p></div><span className="wallet-illustration"><Icon name="wallet" size={35}/></span></div><button className="button secondary small activate-wallet" disabled={!!busy} onClick={async () => { if (await perform("activate", "/api/wallet/activate")) setNotice("Wallet simulada ativada. O endereço é fictício e não recebe ativos reais."); }}>{busy === "activate" ? "Ativando…" : "Ativar wallet simulada"}<Icon name="arrow" size={16}/></button></>}</section></div><div className="work-grid">{transferForm()}<div className="side-panels">{reconciliationPanel()}<section className="journey-note"><span className="journey-icon"><Icon name="transfer" size={20}/></span><h2>Uma ponte, dois ambientes</h2><p>A custódia da conta e a autonomia da wallet têm papéis diferentes. Aqui, você pode experimentar essa conexão com segurança.</p>{privyMode ? null : <button className="text-link" onClick={() => changeView("lab")}>Explorar o laboratório <Icon name="arrow" size={15}/></button>}</section></div></div><section className="panel activity-panel"><div className="panel-heading"><div><h2>Últimas movimentações</h2><p>Cada etapa da sua jornada fica registrada.</p></div><button className="text-link" onClick={() => changeView("activity")}>Ver atividade <Icon name="arrow" size={15}/></button></div><TransactionList transactions={state.transactions} compact privy={privyMode} renderAction={renderTxAction}/></section></> : null}{view === "transfers" ? <><div className="work-grid transfer-view-grid">{transferForm()}<div className="side-panels">{!state.wallet.active && privyMode ? <section className="panel activation-panel"><span className="empty-icon"><Icon name="wallet" size={26}/></span><h2>Primeiro, conecte sua wallet</h2><p>A Privy cria ou recupera sua EOA embedded (assinante). O servidor deriva a smart account ERC-4337 controlada por ela, a partir da sua sessão, sem receber chaves.</p>{connectWalletButton("button secondary full-width")}</section> : null}{!state.wallet.active && !privyMode ? <section className="panel activation-panel"><span className="empty-icon"><Icon name="wallet" size={26}/></span><h2>Primeiro, ative sua wallet</h2><p>Essa etapa prepara um endereço fictício para os seus testes. Nenhuma wallet é criada na blockchain.</p><button className="button secondary full-width" disabled={!!busy} onClick={() => perform("activate", "/api/wallet/activate")}>{busy === "activate" ? "Ativando…" : "Ativar wallet simulada"}</button></section> : null}{reconciliationPanel()}<section className="panel current-operation"><h2>Operação atual</h2>{currentTransaction ? <><Status transaction={currentTransaction} privy={privyMode}/><strong className="current-amount">{formatAmount(currentTransaction.amount)} <small>Mock USDC</small></strong><p>{currentOperationText(currentTransaction)}</p>{privyMode ? (currentTransaction.explorerUrl ? <a className="text-link" href={currentTransaction.explorerUrl} target="_blank" rel="noreferrer">Ver no explorador <Icon name="external" size={14}/></a> : <small>{currentTransaction.txHash ?? currentTransaction.hash ?? (currentTransaction.userOpHash ? `userOpHash ${currentTransaction.userOpHash.slice(0, 10)}…` : "Sepolia · ainda sem UserOperation")}</small>) : <small>Simulada · sem registro on-chain</small>}</> : <p>Inicie uma transferência para acompanhar seu estado.</p>}</section></div></div><section className="panel activity-panel"><div className="panel-heading"><h2>Transferências recentes</h2><button className="text-link" onClick={() => changeView("activity")}>Ver todas <Icon name="arrow" size={15}/></button></div><TransactionList transactions={state.transactions} compact privy={privyMode} renderAction={renderTxAction}/></section></> : null}{view === "activity" ? <section className="panel activity-panel full-activity"><div className="panel-heading"><div><h2>Histórico de operações</h2><p>{state.transactions.length} {state.transactions.length === 1 ? "operação registrada" : "operações registradas"} neste espaço de demonstração.</p></div><label className="filter-label">Exibir<select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}><option value="all">Todas as operações</option><option value="processing">Processando</option>{privyMode ? <><option value="awaiting_user_signature">Aguardando assinatura</option><option value="submitted">Enviadas</option><option value="unknown">Indeterminadas</option></> : null}<option value="confirmed">Confirmadas</option><option value="failed">Falhas</option></select></label></div>{filteredTransactions.length || !state.transactions.length ? <TransactionList transactions={filteredTransactions} privy={privyMode} renderAction={renderTxAction}/> : <div className="empty-state"><Icon name="activity" size={26}/><strong>Nenhuma operação neste filtro</strong><p>Selecione outro estado para consultar suas movimentações.</p><button className="text-link" onClick={() => setActivityFilter("all")}>Exibir todas as operações</button></div>}</section> : null}{view === "lab" && !privyMode ? <div className="laboratory-layout"><section className="panel lab-controls"><div className="panel-heading"><div><h2>Cenários de teste</h2><p>Escolha o que acontece na próxima transferência.</p></div><span className="small-icon"><Icon name="lab"/></span></div><fieldset><legend>Resultado da próxima operação</legend><div className="scenario-options">{([{ value: "confirmed", title: "Confirmar", text: "Conclui a operação e atualiza o destino.", icon: "check" }, { value: "failed", title: "Simular falha", text: "Falha no envio e devolve a reserva.", icon: "close" }, { value: "timeout", title: "Simular expiração", text: "Encerra a janela e devolve a reserva.", icon: "clock" }] as const).map((option) => <label key={option.value} className={`scenario-option ${outcome === option.value ? "selected" : ""}`}><input type="radio" name="outcome" value={option.value} checked={outcome === option.value} onChange={() => setOutcome(option.value)}/><Icon name={option.icon} size={19}/><span><strong>{option.title}</strong><small>{option.text}</small></span></label>)}</div></fieldset><div className="lab-network"><label htmlFor="network">Rede da wallet simulada</label><select id="network" value={state.network.connectedChainId} disabled={!!busy} onChange={(event) => perform("network", "/api/simulation/network", { chainId: Number(event.target.value) })}><option value={11155111}>Sepolia · 11155111</option><option value={1}>Ethereum Mainnet · 1 (teste de bloqueio)</option></select><p>Esta seleção apenas testa a validação de rede. Nenhuma conexão externa é estabelecida.</p></div><button className="button primary" onClick={() => changeView("transfers")}>Testar uma transferência <Icon name="arrow" size={17}/></button></section><div className="side-panels">{reconciliationPanel()}<section className="panel reset-panel"><h2>Recomeçar a demonstração</h2><p>Restaure o saldo inicial de 10.000,00 Mock USDC e desative a wallet deste espaço.</p>{confirmReset ? <div className="reset-confirm"><strong>Apagar as operações desta conta?</strong><p>O histórico local será removido. Essa ação não pode ser desfeita.</p><div><button className="button danger small" disabled={!!busy} onClick={async () => { if (await perform("reset", "/api/simulation/reset")) { setConfirmReset(false); setAmount(""); setNotice("Demonstração reiniciada. O saldo inicial está disponível na conta custodial."); } }}>{busy === "reset" ? "Reiniciando…" : "Sim, reiniciar"}</button><button className="button secondary small" disabled={!!busy} onClick={() => setConfirmReset(false)}>Cancelar</button></div></div> : <button className="text-link danger-text" onClick={() => setConfirmReset(true)}><Icon name="refresh" size={16}/> Reiniciar esta conta</button>}</section></div><section className="panel integration-panel"><div className="panel-heading"><div><h2>Pronto para a próxima conexão</h2><p>A interface já conversa com uma API local. Sua equipe pode evoluir o transporte.</p></div><Icon name="code" size={23}/></div><div className="integration-grid"><div><h3>O que já funciona</h3><p>Ledger persistente, reserva de saldo, idempotência, estorno e reconciliação. Os valores são tratados como inteiros.</p></div><div><h3>O que sua equipe conecta</h3><p>Autenticação e embedded wallet, provedor Sepolia, contrato Mock USDC e observação das confirmações reais.</p></div></div><div className="endpoint-example"><span>POST</span><code>/api/transfers</code><small>Idempotency-Key obrigatório</small></div><p className="integration-note"><Icon name="info" size={15}/> Código e contratos de API estão documentados no README e em docs/integration.md do projeto.</p></section></div> : null}</>}<footer className="page-footer"><span>MB Wallet Bridge <span>·</span> Projeto acadêmico Inteli Blockchain</span><span>{privyMode ? "PoC independente em testnet. Sem ativos reais." : "Simulador independente. Sem ativos reais."}</span></footer></main></div></div>;
}
