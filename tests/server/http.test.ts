import { test } from "vitest";
import assert from "node:assert/strict";
import { assertSameOrigin, readJson, sessionToken } from "../../src/lib/server/http.ts";
import { BridgeError } from "../../src/lib/domain/money.ts";

test("mutações aceitam mesma origem e curl sem Origin e recusam origem externa", () => {
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/transfers")));
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/transfers", { headers: { origin: "http://127.0.0.1:3000" } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://localhost:3000/api/transfers", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } })));
  assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/transfers", { headers: { host: "127.0.0.1:3000", origin: "https://attacker.example" } })), (e: unknown) => e instanceof BridgeError && e.status === 403);
  for (const origin of ["http://attacker.example", "null", "not-a-url"]) {
    assert.throws(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/transfers", { headers: { origin } })), (e: unknown) => e instanceof BridgeError && e.status === 403);
  }
});

test("JSON é um objeto limitado a 4KB; tipo de conteúdo incorreto é recusado", async () => {
  const request = (body: string, contentType = "application/json") => new Request("http://localhost/api", { method: "POST", headers: { "content-type": contentType }, body });
  assert.deepEqual(await readJson(request('{"amount":"1.00"}')), { amount: "1.00" });
  await assert.rejects(() => readJson(request("[]")), (e: unknown) => e instanceof BridgeError && e.code === "INVALID_JSON");
  await assert.rejects(() => readJson(request("{")), (e: unknown) => e instanceof BridgeError && e.code === "INVALID_JSON");
  await assert.rejects(() => readJson(request("{}", "text/plain")), (e: unknown) => e instanceof BridgeError && e.status === 415);
  await assert.rejects(() => readJson(request(JSON.stringify({ value: "a".repeat(5_000) }))), (e: unknown) => e instanceof BridgeError && e.status === 413);
});

test("sessão só é extraída do cookie de nome e formato esperados", () => {
  const token = "a".repeat(64);
  assert.equal(sessionToken(new Request("http://localhost", { headers: { cookie: `other=1; mb_demo_session=${token}; another=2` } })), token);
  assert.equal(sessionToken(new Request("http://localhost", { headers: { cookie: `wrong_mb_demo_session=${token}` } })), null);
  assert.equal(sessionToken(new Request("http://localhost", { headers: { cookie: "mb_demo_session=invalid" } })), null);
});

async function withRoute(mode: "simulated" | "privy", run: (call: (path: string, body?: unknown, cookie?: string) => Promise<{ status: number; json: any; cookie: string | null }>) => Promise<void>, env: Record<string, string> = {}) {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { vi } = await import("vitest");
  const dir = mkdtempSync(join(tmpdir(), "mb-bridge-route-"));
  vi.stubEnv("MB_DATABASE_PATH", join(dir, "route.sqlite"));
  vi.stubEnv("WALLET_PROVIDER", mode);
  vi.stubEnv("PRIVY_APP_ID", "public-app-id");
  vi.stubEnv("PRIVY_APP_SECRET", "server-only-secret");
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  const global = globalThis as { mbBridgeLedger?: { close(): void } };
  delete global.mbBridgeLedger;
  const route = await import("../../src/app/api/[...path]/route.ts");
  const call = async (path: string, body?: unknown, cookie?: string) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    const request = new Request(`http://127.0.0.1:3000${path}`, { method: path === "/api/state" ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const response = path === "/api/state" ? await route.GET(request) : await route.POST(request);
    return { status: response.status, json: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null };
  };
  try {
    await run(call);
  } finally {
    (global.mbBridgeLedger as { close(): void } | undefined)?.close();
    delete global.mbBridgeLedger;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function routeLogin(call: Parameters<Parameters<typeof withRoute>[1]>[0]) {
  await call("/api/auth/request-code", { email: "rota@example.com" });
  return (await call("/api/auth/login", { email: "rota@example.com", code: "123456" })).cookie!;
}

test("rotas no modo simulado: estado simulated, link Privy indisponível", async () => {
  await withRoute("simulated", async (call) => {
    const anonymous = await call("/api/state");
    assert.equal(anonymous.json.mode, "simulated");
    assert.equal(anonymous.json.privyAppId, null);
    const cookie = await routeLogin(call);
    assert.equal((await call("/api/wallet/activate", undefined, cookie)).json.wallet.simulated, true);
    const link = await call("/api/wallet/link", { privyAccessToken: "x".repeat(32) }, cookie);
    assert.equal(link.status, 409);
    assert.equal(link.json.error.code, "PRIVY_DISABLED");
    assert.equal((await call("/api/simulation/network", { chainId: 11155111 }, cookie)).status, 200);
  });
}, 60_000);

test("rotas no modo privy: simulação desativada, activate recusado, appId público exposto", async () => {
  await withRoute("privy", async (call) => {
    const anonymous = await call("/api/state");
    assert.equal(anonymous.json.mode, "privy");
    assert.equal(anonymous.json.privyAppId, "public-app-id");
    assert.doesNotMatch(JSON.stringify(anonymous.json), /server-only-secret/);
    const cookie = await routeLogin(call);
    const activate = await call("/api/wallet/activate", undefined, cookie);
    assert.equal(activate.status, 409);
    assert.equal(activate.json.error.code, "WALLET_LINK_REQUIRED");
    assert.match(activate.json.error.message, /\/api\/wallet\/link/);
    for (const path of ["/api/simulation/advance", "/api/simulation/reset", "/api/simulation/network"]) {
      const response = await call(path, { chainId: 1 }, cookie);
      assert.equal(response.status, 403, path);
      assert.equal(response.json.error.code, "SIMULATION_DISABLED");
    }
    assert.equal((await call("/api/reconciliation/advance", undefined, cookie)).status, 200);
    const submission = await call("/api/transfers/unknown-id/submission", { userOpHash: `0x${"1".repeat(64)}` }, cookie);
    assert.equal(submission.status, 404);
    assert.equal(submission.json.error.code, "TRANSFER_NOT_FOUND");
    const legacy = await call("/api/transfers/unknown-id/submission", { txHash: `0x${"1".repeat(64)}` }, cookie);
    assert.equal(legacy.status, 400, "corpo antigo com txHash não é mais aceito");
    assert.equal(legacy.json.error.code, "INVALID_USER_OP_HASH");
    const unauthenticated = await call("/api/transfers/unknown-id/submission", { userOpHash: `0x${"1".repeat(64)}` });
    assert.equal(unauthenticated.status, 401);
    assert.equal((await call("/api/wallet/link", { privyAccessToken: 1 }, cookie)).json.error.code, "INVALID_PRIVY_TOKEN");
  });
}, 60_000);

const RPC_ENV = {
  ALCHEMY_RPC_URL: "https://eth-sepolia.g.alchemy.com/v2/ALCHEMY-SECRET",
  PIMLICO_API_KEY: "pim_PIMLICO_SECRET_KEY",
};

test("POST /api/rpc: exige sessão e fica desativado no modo simulado", async () => {
  await withRoute("simulated", async (call) => {
    const anonymous = await call("/api/rpc", { jsonrpc: "2.0", id: 1, method: "eth_chainId" });
    assert.equal(anonymous.status, 401);
    const cookie = await routeLogin(call);
    const disabled = await call("/api/rpc", { jsonrpc: "2.0", id: 1, method: "eth_chainId" }, cookie);
    assert.equal(disabled.status, 409);
    assert.equal(disabled.json.error.code, "PRIVY_DISABLED");
  }, RPC_ENV);
}, 60_000);

test("POST /api/rpc no modo privy: roteia, confere sender da smart account vinculada e não vaza segredos", async () => {
  const { vi } = await import("vitest");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xaa36a7" }), { headers: { "content-type": "application/json" } }));
  const SMART = `0x${"ab".repeat(20)}`;
  const OWNER = `0x${"0c".repeat(20)}`;
  const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
  await withRoute("privy", async (call) => {
    assert.equal((await call("/api/rpc", { jsonrpc: "2.0", id: 1, method: "eth_chainId" })).status, 401);
    const cookie = await routeLogin(call);
    const read = await call("/api/rpc", { jsonrpc: "2.0", id: 9, method: "eth_chainId", params: [] }, cookie);
    assert.equal(read.status, 200);
    assert.deepEqual(read.json, { jsonrpc: "2.0", id: 9, result: "0xaa36a7" });
    assert.equal(String(fetchMock.mock.calls.at(-1)![0]), RPC_ENV.ALCHEMY_RPC_URL);

    const denied = await call("/api/rpc", { jsonrpc: "2.0", id: 2, method: "eth_sendRawTransaction", params: ["0x00"] }, cookie);
    assert.equal(denied.json.error.code, -32601);

    const userOp = (sender: string) => ({ jsonrpc: "2.0", id: 3, method: "eth_sendUserOperation", params: [{ sender, nonce: "0x0" }, ENTRY_POINT] });
    const unlinked = await call("/api/rpc", userOp(SMART), cookie);
    assert.equal(unlinked.json.error.data.code, "SMART_ACCOUNT_MISMATCH", "sem wallet vinculada não envia UserOperation");

    const global = globalThis as { mbBridgeLedger?: { accountForSession(token: string): string | null; linkWallet(a: string, s: string, o: string): unknown } };
    const ledger = global.mbBridgeLedger!;
    ledger.linkWallet(ledger.accountForSession(cookie.split("=")[1])!, SMART, OWNER);
    const calls = fetchMock.mock.calls.length;
    const foreign = await call("/api/rpc", userOp(`0x${"ef".repeat(20)}`), cookie);
    assert.equal(foreign.json.error.data.code, "SMART_ACCOUNT_MISMATCH");
    assert.equal(fetchMock.mock.calls.length, calls);
    const own = await call("/api/rpc", userOp(SMART), cookie);
    assert.ok("result" in own.json);
    assert.equal(String(fetchMock.mock.calls.at(-1)![0]), "https://api.pimlico.io/v2/sepolia/rpc?apikey=pim_PIMLICO_SECRET_KEY");

    const batch = await call("/api/rpc", [{ jsonrpc: "2.0", id: 1, method: "eth_blockNumber" }, { jsonrpc: "2.0", id: 2, method: "debug_traceCall" }], cookie);
    assert.equal(batch.json.length, 2);
    assert.equal(batch.json[1].error.code, -32601);

    const big = await call("/api/rpc", { jsonrpc: "2.0", id: 1, method: "eth_call", params: ["a".repeat(70_000)] }, cookie);
    assert.equal(big.status, 413);

    fetchMock.mockRejectedValueOnce(new Error(`connect failed ${RPC_ENV.ALCHEMY_RPC_URL}`));
    const down = await call("/api/rpc", { jsonrpc: "2.0", id: 4, method: "eth_blockNumber" }, cookie);
    assert.equal(down.json.error.code, -32603);
    for (const response of [read, denied, foreign, own, batch, down]) {
      assert.doesNotMatch(JSON.stringify(response.json), /SECRET|alchemy\.com|pimlico\.io/);
    }
  }, RPC_ENV);
}, 60_000);

test("POST /api/rpc sem PIMLICO_API_KEY responde 503 MISSING_CONFIG sem valores", async () => {
  await withRoute("privy", async (call) => {
    const cookie = await routeLogin(call);
    const response = await call("/api/rpc", { jsonrpc: "2.0", id: 1, method: "eth_chainId" }, cookie);
    assert.equal(response.status, 503);
    assert.equal(response.json.error.code, "MISSING_CONFIG");
    assert.match(response.json.error.message, /PIMLICO_API_KEY/);
    assert.doesNotMatch(response.json.error.message, /ALCHEMY-SECRET/);
  }, { ALCHEMY_RPC_URL: RPC_ENV.ALCHEMY_RPC_URL, PIMLICO_API_KEY: "" });
}, 60_000);
