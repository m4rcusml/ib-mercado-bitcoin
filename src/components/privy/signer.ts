/**
 * Tipos e mensagens compartilhados entre a página e o adaptador Privy (ERC-4337).
 * Este módulo NÃO importa o SDK Privy nem `viem/account-abstraction`: a página o usa
 * mesmo no modo simulado sem carregar esses pacotes no bundle inicial.
 */

export const SEPOLIA_CHAIN_ID = 11155111;

/**
 * Versão da Coinbase Smart Account usada por `toCoinbaseSmartAccount` (EntryPoint v0.6).
 * Precisa ser a mesma do servidor (`src/lib/chain/smart-account.ts`, factory `0x0ba5ed0c…`),
 * senão o endereço contrafactual diverge e o envio é recusado.
 */
export const COINBASE_SMART_ACCOUNT_VERSION = "1" as const;

export type Hex = `0x${string}`;

/**
 * Pedido de assinatura enviado pelo servidor (compatível com `SignatureRequest` de `src/lib/contracts`).
 * Os campos de smart account são opcionais aqui apenas para tolerar um servidor antigo;
 * sem eles o adaptador recusa o envio.
 */
export interface SignatureRequest {
  chainId: number;
  /** Contrato Mock USDC (validado com `isAddress` antes de assinar). */
  token: string;
  /** Destino (tesouraria), validado com `isAddress` antes de assinar. */
  to: string;
  /** Valor inteiro em unidades do token (6 decimais), como string decimal. */
  amountUnits: string;
  /** Endereço da Coinbase Smart Account (remetente da UserOperation). */
  smartAccount?: string | null;
  /** EOA embedded da Privy que é dona/assinante da smart account. */
  ownerAddress?: string | null;
  entryPoint?: string | null;
}

/** Endereços que o servidor vinculou à conta; o navegador precisa derivar exatamente os mesmos. */
export interface SmartAccountTarget {
  smartAccount: string;
  ownerAddress: string;
}

/** Situação on-chain da smart account (somente leitura, via proxy `/api/rpc`). */
export interface SmartAccountStatus {
  address: string;
  balanceWei: bigint;
  /** Saldo formatado em ETH (string decimal). */
  balanceEth: string;
  /** `false` enquanto a conta é contrafactual: a 1ª UserOperation também faz o deploy (initCode). */
  deployed: boolean;
}

export type SignerErrorCode =
  | "rejected"
  | "wrong_chain"
  | "insufficient_gas"
  | "no_eth"
  | "signature_invalid"
  | "nonce"
  | "bundler_unavailable"
  | "proxy_unauthorized"
  | "owner_mismatch"
  | "smart_account_mismatch"
  | "no_wallet"
  | "not_authenticated"
  | "invalid_request"
  | "unknown";

const messages: Record<SignerErrorCode, string> = {
  rejected: "Você recusou a assinatura na wallet. Nada foi enviado; a reserva continua aguardando sua decisão.",
  wrong_chain: "A conexão não está na rede Sepolia (11155111). Nada foi enviado; atualize a página e tente novamente.",
  insufficient_gas: "A smart account não tem ETH Sepolia suficiente para pagar o gas da UserOperation (AA21). Envie ETH de teste de um faucet para o endereço da smart account e tente novamente.",
  no_eth: "A smart account precisa de ETH Sepolia para pagar o gas. Envie ETH de teste de um faucet para o endereço da smart account (não para a EOA Privy) e tente novamente.",
  signature_invalid: "A assinatura da UserOperation foi recusada pela smart account (AA23/AA24). Confirme que está usando a mesma conta Privy vinculada e tente novamente.",
  nonce: "O nonce da UserOperation está desatualizado (AA25), provavelmente por um envio anterior. Aguarde alguns segundos, atualize a página e tente novamente.",
  bundler_unavailable: "O servidor ou o RPC Sepolia não respondeu. Atualize a atividade antes de tentar de novo.",
  proxy_unauthorized: "Sua sessão não autorizou o acesso ao RPC da aplicação (401/403). Entre novamente na conta de demonstração.",
  owner_mismatch: "A wallet Privy conectada não é a assinante (EOA) vinculada a esta conta. Entre com a mesma conta Privy usada na vinculação.",
  smart_account_mismatch: "Smart account divergente do servidor: o endereço derivado no navegador não é o vinculado à conta. Nada foi enviado.",
  no_wallet: "A embedded wallet Privy ainda não está disponível. Aguarde alguns segundos ou conecte a wallet novamente.",
  not_authenticated: "Conecte sua wallet Privy antes de assinar.",
  invalid_request: "O pedido de assinatura recebido do servidor é inválido. Nada foi enviado; atualize a página.",
  unknown: "Não foi possível confirmar o registro da UserOperation. Consulte a atividade antes de tentar de novo.",
};

export class SignerError extends Error {
  readonly code: SignerErrorCode;
  constructor(code: SignerErrorCode, cause?: unknown) {
    super(messages[code], cause === undefined ? undefined : { cause });
    this.name = "SignerError";
    this.code = code;
  }
}

/** Converte erros de provider EIP-1193/viem/bundler/Privy em um `SignerError` com mensagem em português. */
export function toSignerError(error: unknown): SignerError {
  if (error instanceof SignerError) return error;
  const parts: string[] = [];
  let code: unknown;
  let status: unknown;
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (typeof current === "object") {
      const record = current as { code?: unknown; status?: unknown; message?: unknown; shortMessage?: unknown; details?: unknown; name?: unknown; cause?: unknown };
      if (code === undefined && record.code !== undefined) code = record.code;
      if (status === undefined && typeof record.status === "number") status = record.status;
      for (const value of [record.name, record.message, record.shortMessage, record.details]) if (typeof value === "string") parts.push(value);
      current = record.cause;
    } else { parts.push(String(current)); break; }
  }
  const text = parts.join(" ").toLowerCase();
  if (status === 401 || status === 403) return new SignerError("proxy_unauthorized", error);
  // O proxy /api/rpc devolve JSON-RPC -32602 com mensagem prefixada "SMART_ACCOUNT_MISMATCH:".
  if (/smart_account_mismatch/.test(text)) return new SignerError("smart_account_mismatch", error);
  if (code === 4001 || /user ?rejected|rejected the request|user denied|denied by user|user cancel|cancell?ed by user/.test(text)) return new SignerError("rejected", error);
  if (/\baa21\b|didn'?t pay prefund|insufficient funds|exceeds the balance|prefund/.test(text)) return new SignerError("insufficient_gas", error);
  if (/\baa2[34]\b|signature error|invalid signature|signature validation/.test(text)) return new SignerError("signature_invalid", error);
  if (/\baa25\b|invalid (account )?nonce|nonce too low/.test(text)) return new SignerError("nonce", error);
  if (code === 4901 || code === 4902 || /chain ?mismatch|unsupported chain|does not match the target chain|chainid/.test(text)) return new SignerError("wrong_chain", error);
  if ((typeof status === "number" && status >= 500) || status === 429 || /failed to fetch|fetch failed|networkerror|network error|timed? ?out|timeout|http request failed|bundler|econnrefused|service unavailable/.test(text)) return new SignerError("bundler_unavailable", error);
  return new SignerError("unknown", error);
}

/** Ações da embedded wallet + smart account expostas para a página quando o modo Privy está ativo. */
export interface PrivySigner {
  ready: boolean;
  authenticated: boolean;
  /** Endereço da EOA embedded Privy (assinante). O servidor vincula a partir do access token. */
  ownerAddress: string | null;
  login(): void;
  logout(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  /** Lê saldo de ETH e se a smart account já foi implantada (via `/api/rpc`). */
  getSmartAccountStatus(address: string): Promise<SmartAccountStatus>;
  /**
   * Monta a Coinbase Smart Account (dona = EOA Privy), confere os endereços com o servidor
   * e registra a UserOperation assinada para que o servidor a envie ao bundler.
   */
  sendUserOperation(transferId: string, request: SignatureRequest, target: SmartAccountTarget): Promise<Hex>;
}
