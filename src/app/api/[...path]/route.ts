import { getLedger } from "../../../lib/domain/ledger.ts";
import { BridgeError } from "../../../lib/domain/money.ts";
import { assertSameOrigin, errorResponse, readJson, readJsonValue, responseJson, sessionToken } from "../../../lib/server/http.ts";
import { readRpcUpstreams, type RpcUpstreams } from "../../../lib/chain/index.ts";
// Bootstrap: registra a fábrica do provider Privy (construída só quando WALLET_PROVIDER=privy).
import { getPrivyAuthClient, getSmartAccountDeriver, resolveLinkedSmartAccount } from "../../../lib/wallet/privy-wallet-provider.ts";
import { FixedWindowRateLimiter, proxyJsonRpc, RPC_BODY_LIMIT_BYTES, rpcCallCount } from "../../../lib/server/rpc-proxy.ts";
import { stateEventStream } from "../../../lib/server/sse.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBMISSION_PATH = /^\/api\/transfers\/([A-Za-z0-9-]{1,64})\/submission$/;
/** Chamadas JSON-RPC por conta por minuto no proxy `/api/rpc` (cada item de lote conta). */
const RPC_LIMIT_PER_MINUTE = 240;
const globalRpc = globalThis as typeof globalThis & { mbRpcLimiter?: FixedWindowRateLimiter };

function rpcLimiter(): FixedWindowRateLimiter {
  globalRpc.mbRpcLimiter ??= new FixedWindowRateLimiter(RPC_LIMIT_PER_MINUTE, 60_000);
  return globalRpc.mbRpcLimiter;
}

function rpcUpstreams(): RpcUpstreams {
  try {
    return readRpcUpstreams(process.env);
  } catch (error) {
    // readRpcUpstreams só cita nomes de variáveis, nunca valores.
    throw new BridgeError("MISSING_CONFIG", error instanceof Error ? error.message : "Configuração Sepolia inválida.", 503);
  }
}

function routePath(request: Request): string {
  return new URL(request.url).pathname.replace(/\/$/, "");
}

export async function GET(request: Request): Promise<Response> {
  try {
    const path = routePath(request);
    const ledger = getLedger();
    if (path === "/api/events") {
      // SSE: o estado da conta é enviado ao conectar e a cada mudança sinalizada pelo ledger.
      const accountId = ledger.accountForSession(sessionToken(request));
      if (!accountId) throw new BridgeError("UNAUTHORIZED", "Entre na conta de demonstração para continuar.", 401);
      return stateEventStream(ledger, accountId, request.signal);
    }
    if (path !== "/api/state") throw new BridgeError("NOT_FOUND", "Endpoint não encontrado.", 404);
    return responseJson(ledger.state(ledger.accountForSession(sessionToken(request))));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const path = routePath(request);
    const ledger = getLedger();
    const privy = ledger.mode === "privy";
    const token = sessionToken(request);
    if (path === "/api/auth/request-code") {
      const body = await readJson(request);
      return responseJson(ledger.requestCode(body.email));
    }
    if (path === "/api/auth/login") {
      const body = await readJson(request);
      const login = ledger.login(body.email, body.code);
      const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
      return responseJson(login.state, 200, { "Set-Cookie": `mb_demo_session=${login.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure}` });
    }
    if (path === "/api/auth/logout") {
      ledger.logout(token);
      return responseJson(ledger.state(null), 200, { "Set-Cookie": "mb_demo_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" });
    }
    const accountId = ledger.accountForSession(token);
    if (!accountId) throw new BridgeError("UNAUTHORIZED", "Entre na conta de demonstração para continuar.", 401);
    if (path === "/api/rpc") {
      if (!privy) throw new BridgeError("PRIVY_DISABLED", "O proxy JSON-RPC só está disponível com WALLET_PROVIDER=privy.", 409);
      const payload = await readJsonValue(request, RPC_BODY_LIMIT_BYTES);
      if (!rpcLimiter().take(accountId, rpcCallCount(payload))) {
        throw new BridgeError("RATE_LIMITED", "Muitas chamadas ao proxy JSON-RPC. Aguarde alguns segundos.", 429);
      }
      return responseJson(await proxyJsonRpc(payload, { smartAccount: ledger.linkedSmartAccount(accountId), upstreams: rpcUpstreams() }));
    }
    // Demais rotas autenticadas alteram o estado: avisa as conexões SSE da conta (outras abas).
    const response = await handleAccountAction(request, path, ledger, accountId, privy);
    ledger.notifyChange(accountId);
    return response;
  } catch (error) { return errorResponse(error); }
}

async function handleAccountAction(request: Request, path: string, ledger: ReturnType<typeof getLedger>, accountId: string, privy: boolean): Promise<Response> {
    if (path === "/api/wallet/activate") {
      if (privy) {
        throw new BridgeError("WALLET_LINK_REQUIRED", "No modo Privy a wallet é vinculada pelo login Privy. Use POST /api/wallet/link com o token de acesso Privy.", 409);
      }
      return responseJson(await ledger.activateWallet(accountId));
    }
    if (path === "/api/wallet/link") {
      if (!privy) throw new BridgeError("PRIVY_DISABLED", "A vinculação Privy só está disponível com WALLET_PROVIDER=privy.", 409);
      const body = await readJson(request);
      // A EOA vem do Privy e a smart account da factory on-chain, ambas no servidor; nunca do corpo.
      const linked = await resolveLinkedSmartAccount(getPrivyAuthClient(), body.privyAccessToken, (owner) => getSmartAccountDeriver()(owner));
      return responseJson(ledger.linkWallet(accountId, linked.smartAccount, linked.ownerAddress));
    }
    if (path === "/api/transfers") {
      const body = await readJson(request);
      return responseJson(await ledger.transfer(accountId, body, request.headers.get("idempotency-key")));
    }
    const submission = SUBMISSION_PATH.exec(path);
    if (submission) {
      const body = await readJson(request);
      return responseJson(ledger.submitUserOperation(accountId, submission[1], body.userOpHash));
    }
    // Retenta operações pendentes (inclusive `unknown`) sem liberar reserva sem evidência.
    if (path === "/api/reconciliation/advance") return responseJson(await ledger.advance(accountId));
    if (path.startsWith("/api/simulation/") && privy) {
      throw new BridgeError("SIMULATION_DISABLED", "Rotas de simulação ficam desativadas no modo Privy.", 403);
    }
    if (path === "/api/simulation/advance") return responseJson(await ledger.advance(accountId));
    if (path === "/api/simulation/network") {
      const body = await readJson(request);
      return responseJson(ledger.setNetwork(accountId, body.chainId));
    }
    if (path === "/api/simulation/reset") return responseJson(ledger.reset(accountId));
    throw new BridgeError("NOT_FOUND", "Endpoint não encontrado.", 404);
}
