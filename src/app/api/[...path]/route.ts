import { getLedger, anonymousState } from "../../../lib/ledger.ts";
import { BridgeError } from "../../../lib/money.ts";
import { assertSameOrigin, errorResponse, readJson, responseJson, sessionToken } from "../../../lib/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function routePath(request: Request): string {
  return new URL(request.url).pathname.replace(/\/$/, "");
}

export async function GET(request: Request): Promise<Response> {
  try {
    if (routePath(request) !== "/api/state") throw new BridgeError("NOT_FOUND", "Endpoint não encontrado.", 404);
    const ledger = getLedger();
    return responseJson(ledger.state(ledger.accountForSession(sessionToken(request))));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const path = routePath(request);
    const ledger = getLedger();
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
      return responseJson(anonymousState(), 200, { "Set-Cookie": "mb_demo_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" });
    }
    const accountId = ledger.accountForSession(token);
    if (!accountId) throw new BridgeError("UNAUTHORIZED", "Entre na conta de demonstração para continuar.", 401);
    if (path === "/api/wallet/activate") return responseJson(ledger.activateWallet(accountId));
    if (path === "/api/transfers") {
      const body = await readJson(request);
      return responseJson(ledger.transfer(accountId, body, request.headers.get("idempotency-key")));
    }
    if (path === "/api/simulation/advance") return responseJson(ledger.advance(accountId));
    if (path === "/api/simulation/network") {
      const body = await readJson(request);
      return responseJson(ledger.setNetwork(accountId, body.chainId));
    }
    if (path === "/api/simulation/reset") return responseJson(ledger.reset(accountId));
    throw new BridgeError("NOT_FOUND", "Endpoint não encontrado.", 404);
  } catch (error) { return errorResponse(error); }
}
