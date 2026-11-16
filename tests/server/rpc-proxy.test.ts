import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { ENTRY_POINT_V06 } from "../../src/lib/chain/index.ts";
import { BUNDLER_METHODS, FixedWindowRateLimiter, proxyJsonRpc, READ_METHODS, rpcCallCount } from "../../src/lib/server/rpc-proxy.ts";
import type { RpcProxyContext } from "../../src/lib/server/rpc-proxy.ts";

const SMART = getAddress(`0x${"ab".repeat(20)}`);
const OTHER = getAddress(`0x${"cd".repeat(20)}`);
const upstreams = {
  rpcUrl: "https://eth-sepolia.g.alchemy.com/v2/ALCHEMY-SECRET",
  bundlerUrl: "https://api.pimlico.io/v2/sepolia/rpc?apikey=PIMLICO-SECRET",
};

function context(response: unknown = { jsonrpc: "2.0", id: 1, result: "0x1" }, smartAccount: string | null = SMART) {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    response instanceof Error ? Promise.reject(response) : new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } }));
  const ctx: RpcProxyContext = { smartAccount, upstreams, fetch: fetch as unknown as typeof globalThis.fetch };
  return { ctx, fetch };
}

const call = (method: string, params: unknown[] = [], id: number | string = 7) => ({ jsonrpc: "2.0", id, method, params });
const userOp = (sender: string) => ({ sender, nonce: "0x0", callData: "0x", signature: "0x" });

test("allowlist: métodos de bundler vão ao Pimlico e leituras ao Alchemy, preservando o id", async () => {
  for (const method of BUNDLER_METHODS) {
    if (method === "eth_sendUserOperation" || method === "eth_estimateUserOperationGas") continue;
    const { ctx, fetch } = context();
    const response = await proxyJsonRpc(call(method, []), ctx);
    assert.deepEqual(response, { jsonrpc: "2.0", id: 7, result: "0x1" }, method);
    assert.equal(fetch.mock.calls[0][0], upstreams.bundlerUrl, method);
    assert.deepEqual(JSON.parse(String(fetch.mock.calls[0][1]!.body)), { jsonrpc: "2.0", id: 1, method, params: [] });
  }
  for (const method of READ_METHODS) {
    const { ctx, fetch } = context();
    await proxyJsonRpc(call(method), ctx);
    assert.equal(fetch.mock.calls[0][0], upstreams.rpcUrl, method);
  }
});

test("métodos fora da allowlist respondem -32601 sem chamar upstream", async () => {
  for (const method of ["eth_sendRawTransaction", "eth_sendTransaction", "eth_sign", "debug_traceTransaction", "eth_accounts", "personal_sign", "anvil_setBalance"]) {
    const { ctx, fetch } = context();
    const response = await proxyJsonRpc(call(method), ctx) as { error: { code: number } };
    assert.equal(response.error.code, -32601, method);
    assert.equal(fetch.mock.calls.length, 0);
  }
});

test("requests malformados respondem -32600/-32602", async () => {
  const { ctx, fetch } = context();
  assert.equal(((await proxyJsonRpc({ id: 1, method: "eth_chainId" }, ctx)) as { error: { code: number } }).error.code, -32600);
  assert.equal(((await proxyJsonRpc("x", ctx)) as { error: { code: number } }).error.code, -32600);
  assert.equal(((await proxyJsonRpc([], ctx)) as { error: { code: number } }).error.code, -32600);
  assert.equal(((await proxyJsonRpc({ ...call("eth_call"), params: { to: "0x" } }, ctx)) as { error: { code: number } }).error.code, -32602);
  assert.equal(((await proxyJsonRpc(Array.from({ length: 21 }, () => call("eth_chainId")), ctx)) as { error: { code: number } }).error.code, -32600);
  assert.equal(fetch.mock.calls.length, 0);
});

test("eth_sendUserOperation/estimate exigem sender = smart account da sessão e EntryPoint v0.6", async () => {
  for (const method of ["eth_sendUserOperation", "eth_estimateUserOperationGas"]) {
    const ok = context({ jsonrpc: "2.0", id: 1, result: `0x${"11".repeat(32)}` });
    const response = await proxyJsonRpc(call(method, [userOp(SMART.toLowerCase()), ENTRY_POINT_V06.toLowerCase()]), ok.ctx);
    assert.ok("result" in response, method);
    assert.equal(ok.fetch.mock.calls[0][0], upstreams.bundlerUrl);

    const cases: Array<[RpcProxyContext["smartAccount"], unknown[]]> = [
      [SMART, [userOp(OTHER), ENTRY_POINT_V06]],
      [SMART, [userOp(SMART), "0x0000000071727De22E5E9d8BAf0edAc6f37da032"]],
      [SMART, [userOp(SMART)]],
      [SMART, [{ nonce: "0x0" }, ENTRY_POINT_V06]],
      [null, [userOp(SMART), ENTRY_POINT_V06]],
    ];
    for (const [smartAccount, params] of cases) {
      const { ctx, fetch } = context(undefined, smartAccount);
      const rejected = await proxyJsonRpc(call(method, params), ctx) as { error: { code: number; message: string; data: { code: string } } };
      assert.equal(rejected.error.code, -32602);
      assert.equal(rejected.error.data.code, "SMART_ACCOUNT_MISMATCH");
      assert.match(rejected.error.message, /^SMART_ACCOUNT_MISMATCH: /);
      assert.equal(fetch.mock.calls.length, 0, "não chega ao bundler");
    }
  }
});

test("lote: cada item é validado e roteado individualmente", async () => {
  const { ctx, fetch } = context();
  const response = await proxyJsonRpc([call("eth_chainId", [], 1), call("eth_sendRawTransaction", ["0x"], 2), call("eth_supportedEntryPoints", [], "x")], ctx) as Array<{ id: unknown; result?: unknown; error?: { code: number } }>;
  assert.deepEqual(response.map((item) => item.id), [1, 2, "x"]);
  assert.equal(response[0].result, "0x1");
  assert.equal(response[1].error!.code, -32601);
  assert.equal(response[2].result, "0x1");
  assert.deepEqual(fetch.mock.calls.map((c) => c[0]), [upstreams.rpcUrl, upstreams.bundlerUrl]);
  assert.equal(rpcCallCount([1, 2, 3]), 3);
  assert.equal(rpcCallCount({}), 1);
});

test("erros de upstream nunca ecoam URL nem chave", async () => {
  const failing = context(new Error(`fetch failed ${upstreams.bundlerUrl}`));
  const network = await proxyJsonRpc(call("eth_supportedEntryPoints"), failing.ctx);
  assert.doesNotMatch(JSON.stringify(network), /PIMLICO-SECRET|ALCHEMY-SECRET|pimlico\.io|alchemy\.com/);
  assert.equal((network as { error: { code: number } }).error.code, -32603);

  const upstreamError = context({ jsonrpc: "2.0", id: 1, error: { code: -32500, message: `AA21 didn't pay prefund (see ${upstreams.rpcUrl})`, data: { url: upstreams.bundlerUrl, reason: "AA21" } } });
  const mapped = await proxyJsonRpc(call("eth_estimateUserOperationGas", [userOp(SMART), ENTRY_POINT_V06]), upstreamError.ctx) as { error: { code: number; message: string; data: unknown } };
  assert.equal(mapped.error.code, -32500);
  assert.match(mapped.error.message, /AA21/);
  assert.doesNotMatch(JSON.stringify(mapped), /SECRET|pimlico\.io|alchemy\.com/);
});

test("rate limit por janela fixa", () => {
  const limiter = new FixedWindowRateLimiter(3, 1_000);
  assert.equal(limiter.take("a", 2, 0), true);
  assert.equal(limiter.take("a", 1, 10), true);
  assert.equal(limiter.take("a", 1, 20), false);
  assert.equal(limiter.take("b", 1, 20), true, "contas independentes");
  assert.equal(limiter.take("a", 1, 1_000), true, "nova janela");
});
