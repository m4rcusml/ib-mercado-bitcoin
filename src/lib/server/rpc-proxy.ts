// SERVER-ONLY: proxy JSON-RPC do browser para o bundler Pimlico e o RPC Alchemy.
// As URLs upstream contêm chaves de API e nunca são devolvidas ao cliente nem registradas.
import { isAddress, isAddressEqual } from "viem";
import { ENTRY_POINT_V06, type RpcUpstreams } from "../chain/index.ts";
import { BridgeError } from "../domain/money.ts";

/** Métodos ERC-4337 encaminhados ao bundler Pimlico (Sepolia). */
export const BUNDLER_METHODS: ReadonlySet<string> = new Set([
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "eth_supportedEntryPoints",
  "pimlico_getUserOperationGasPrice",
]);

/** Métodos somente leitura encaminhados ao RPC Alchemy (Sepolia). */
export const READ_METHODS: ReadonlySet<string> = new Set([
  "eth_chainId",
  "eth_call",
  "eth_getCode",
  "eth_getBalance",
  "eth_blockNumber",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
]);

/** Métodos que carregam uma UserOperation: o `sender` precisa ser a smart account da sessão. */
const USER_OPERATION_METHODS: ReadonlySet<string> = new Set(["eth_sendUserOperation", "eth_estimateUserOperationGas"]);

export const RPC_BODY_LIMIT_BYTES = 64 * 1024;
export const RPC_MAX_BATCH = 20;
const UPSTREAM_TIMEOUT_MS = 15_000;

type JsonRpcId = string | number | null;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: JsonRpcError };

export interface RpcProxyContext {
  /** Smart account vinculada à sessão; `null` se a conta ainda não vinculou a wallet. */
  smartAccount: string | null;
  upstreams: RpcUpstreams;
  queueUserOperation?: (operation: unknown) => string;
  /** Injetável em testes. */
  fetch?: typeof fetch;
}

const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

function scrub(text: string): string {
  return text.replace(URL_PATTERN, "[url omitida]").slice(0, 500);
}

function failure(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return data === undefined ? { jsonrpc: "2.0", id, error: { code, message } } : { jsonrpc: "2.0", id, error: { code, message, data } };
}

function validId(value: unknown): value is JsonRpcId {
  return value === null || (typeof value === "string" && value.length <= 128) || (typeof value === "number" && Number.isFinite(value));
}

/** Quantas chamadas um payload representa (para o rate limit). */
export function rpcCallCount(payload: unknown): number {
  return Array.isArray(payload) ? Math.max(1, payload.length) : 1;
}

/**
 * Encaminha um request JSON-RPC 2.0 (ou um lote) respeitando a allowlist. Nunca lança por erro
 * de upstream: devolve um erro JSON-RPC genérico, sem URL nem chave.
 */
export async function proxyJsonRpc(payload: unknown, ctx: RpcProxyContext): Promise<JsonRpcResponse | JsonRpcResponse[]> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return failure(null, -32600, "Lote JSON-RPC vazio.");
    if (payload.length > RPC_MAX_BATCH) return failure(null, -32600, `Lote JSON-RPC limitado a ${RPC_MAX_BATCH} chamadas.`);
    return Promise.all(payload.map((item) => proxySingle(item, ctx)));
  }
  return proxySingle(payload, ctx);
}

async function proxySingle(item: unknown, ctx: RpcProxyContext): Promise<JsonRpcResponse> {
  if (!item || typeof item !== "object" || Array.isArray(item)) return failure(null, -32600, "Request JSON-RPC inválido.");
  const request = item as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  const id: JsonRpcId = validId(request.id) ? request.id : null;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || (request.id !== undefined && !validId(request.id))) {
    return failure(id, -32600, "Request JSON-RPC inválido.");
  }
  const method = request.method;
  const params = request.params === undefined ? [] : request.params;
  if (!Array.isArray(params)) return failure(id, -32602, "params deve ser uma lista.");

  const bundler = BUNDLER_METHODS.has(method);
  if (!bundler && !READ_METHODS.has(method)) return failure(id, -32601, "Método não permitido pelo proxy.");

  if (USER_OPERATION_METHODS.has(method)) {
    const rejection = checkUserOperation(params, ctx.smartAccount);
    // `data.code` (e o prefixo da mensagem) permitem ao cliente mapear o erro sem depender do texto.
    if (rejection) return failure(id, -32602, `SMART_ACCOUNT_MISMATCH: ${rejection}`, { code: "SMART_ACCOUNT_MISMATCH" });
  }
  if (method === "eth_sendUserOperation") {
    if (!ctx.queueUserOperation) return failure(id, -32602, "Use o endpoint RPC da transferência para enviar a UserOperation.");
    try {
      return { jsonrpc: "2.0", id, result: ctx.queueUserOperation(params[0]) };
    } catch (error) {
      if (error instanceof BridgeError) return failure(id, -32602, error.message, { code: error.code });
      throw error;
    }
  }

  return forward(bundler ? ctx.upstreams.bundlerUrl : ctx.upstreams.rpcUrl, id, method, params, ctx.fetch ?? fetch);
}

/** Impede usar o proxy como bundler gratuito para outras contas e fixa o EntryPoint v0.6. */
function checkUserOperation(params: unknown[], smartAccount: string | null): string | null {
  if (!smartAccount) return "Vincule a smart account antes de enviar UserOperations.";
  const userOp = params[0] as { sender?: unknown } | undefined;
  if (!userOp || typeof userOp !== "object" || typeof userOp.sender !== "string" || !isAddress(userOp.sender, { strict: false })) {
    return "UserOperation sem sender válido.";
  }
  if (!isAddressEqual(userOp.sender, smartAccount as `0x${string}`)) {
    return "O sender da UserOperation não é a smart account vinculada a esta sessão.";
  }
  const entryPoint = params[1];
  if (typeof entryPoint !== "string" || !isAddress(entryPoint, { strict: false }) || !isAddressEqual(entryPoint, ENTRY_POINT_V06)) {
    return "Somente o EntryPoint v0.6 é aceito.";
  }
  return null;
}

async function forward(url: string, id: JsonRpcId, method: string, params: unknown[], fetchImpl: typeof fetch): Promise<JsonRpcResponse> {
  let body: unknown;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    body = await response.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return failure(id, -32603, `Upstream indisponível (HTTP ${response.status}).`);
    }
  } catch {
    return failure(id, -32603, "Upstream indisponível.");
  }
  const upstream = body as { result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
  if (upstream.error && typeof upstream.error === "object") {
    const code = typeof upstream.error.code === "number" && Number.isInteger(upstream.error.code) ? upstream.error.code : -32603;
    const message = typeof upstream.error.message === "string" ? scrub(upstream.error.message) : "Erro no upstream.";
    return failure(id, code, message, scrubData(upstream.error.data));
  }
  if (!("result" in upstream)) return failure(id, -32603, "Resposta inválida do upstream.");
  return { jsonrpc: "2.0", id, result: upstream.result ?? null };
}

/** Repassa `error.data` (ex.: motivo de revert) sem URLs e com tamanho limitado. */
function scrubData(data: unknown): unknown {
  if (data === undefined || data === null) return undefined;
  try {
    const text = JSON.stringify(data).replace(URL_PATTERN, "[url omitida]");
    return text.length > 8_192 ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Janela fixa por chave (conta). Instância única por processo, como o ledger SQLite. */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  take(key: string, amount = 1, now = Date.now()): boolean {
    const current = this.windows.get(key);
    if (!current || now - current.start >= this.windowMs) {
      if (this.windows.size > 10_000) this.prune(now);
      this.windows.set(key, { start: now, count: amount });
      return amount <= this.limit;
    }
    current.count += amount;
    return current.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) if (now - window.start >= this.windowMs) this.windows.delete(key);
  }
}
