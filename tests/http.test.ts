import test from "node:test";
import assert from "node:assert/strict";
import { assertSameOrigin, readJson, sessionToken } from "../src/lib/http.ts";
import { BridgeError } from "../src/lib/money.ts";

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
