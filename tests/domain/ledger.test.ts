import { test, onTestFinished } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "../../src/lib/domain/ledger.ts";
import { BridgeError, formatMicros, parseAmount, splitMicros } from "../../src/lib/domain/money.ts";
import { SimulatedWalletProvider } from "../../src/lib/wallet/wallet-provider.ts";
function login(ledger: Ledger, email = "equipe@example.com") {
  ledger.requestCode(email, 1_000);
  const result = ledger.login(email, "123456", 1_000);
  const accountId = ledger.accountForSession(result.token, 1_000)!;
  return { ...result, accountId };
}
function fixture() {
  const ledger = new Ledger(":memory:");
  onTestFinished(() => ledger.close());
  const account = login(ledger);
  return { ledger, ...account };
}
function expectSyncCode(action: () => unknown, code: string) {
  assert.throws(action, (error: unknown) => error instanceof BridgeError && error.code === code);
}
async function expectCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => error instanceof BridgeError && error.code === code);
}
test("valores são truncados em centavos sem arredondamento nem ponto flutuante", () => {
  assert.deepEqual(parseAmount("1.999999"), { cents: 199n, micros: 1_990_000n, normalized: "1.99" });
  assert.equal(parseAmount("00012,3").normalized, "12.30");
  assert.equal(parseAmount("0.019999999999999999").cents, 1n);
  for (const invalid of ["0", "0.009", "-1", "NaN", "1e2", "1,000.00", " 1", "1.", 1, null]) {
    expectSyncCode(() => parseAmount(invalid), "INVALID_AMOUNT");
  }
});
test("frações de token são preservadas integralmente em campo separado", () => {
  for (const value of [0n, 1n, 9_999n, 10_000n, 1_234_567n, 10_000_000_001n]) {
    const split = splitMicros(value);
    assert.equal(split.cents * 10_000n + split.remainderMicros, value);
  }
  assert.deepEqual(splitMicros(1_234_567n), { cents: 123n, remainderMicros: 4_567n });
  assert.equal(formatMicros(1_234_567n), "1.234567");
  assert.equal(formatMicros(1_000_000n), "1.00");
});
test("reconciliação inclui frações subcentavo sem perder resíduo durante transferências", async () => {
  const { ledger, accountId } = fixture();
  await ledger.activateWallet(accountId);
  ledger.db.prepare(`UPDATE accounts SET custodial_cents = 999999, custodial_remainder = 4567,
    wallet_remainder = 5433 WHERE id = ?`).run(accountId);
  let state = ledger.state(accountId);
  assert.equal(state.balances.custodialRemainderMicros, "4567");
  assert.equal(state.balances.walletRemainderMicros, "5433");
  assert.equal(state.balances.total, "10000.00");
  assert.equal(state.reconciliation.differenceMicros, "0");
  await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "1.00" }, "fraction-0001", 2_000);
  state = await ledger.advance(accountId, 4_000);
  assert.equal(state.balances.walletAvailable, "1.00");
  assert.equal(state.balances.walletRemainderMicros, "5433");
  assert.equal(state.reconciliation.balanced, true);
});
test("login demo exige desafio, valida código, consome desafio e isola sessões", () => {
  const ledger = new Ledger(":memory:");
  onTestFinished(() => ledger.close());
  expectSyncCode(() => ledger.login("a@example.com", "123456", 1_000), "EXPIRED_CODE");
  ledger.requestCode("a@example.com", 1_000);
  expectSyncCode(() => ledger.login("a@example.com", "000000", 1_000), "INVALID_CODE");
  const first = ledger.login("a@example.com", "123456", 1_000);
  expectSyncCode(() => ledger.login("a@example.com", "123456", 1_000), "EXPIRED_CODE");
  const second = login(ledger, "b@example.com");
  const firstId = ledger.accountForSession(first.token, 1_000)!;
  assert.notEqual(firstId, second.accountId);
  assert.equal(ledger.accountForSession("invalid", 1_000), null);
  assert.equal(ledger.accountForSession(first.token, 90_000_000), null);
  ledger.logout(first.token);
  assert.equal(ledger.accountForSession(first.token, 1_000), null);
  assert.equal(ledger.state(null).balances.total, "0.00");
});
test("envio reserva imediatamente e só credita a wallet após confirmação explícita", async () => {
  const { ledger, accountId } = fixture();
  await ledger.activateWallet(accountId);
  let state = await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "125.25" }, "send-0001", 2_000);
  assert.equal(state.balances.custodialAvailable, "9874.75");
  assert.equal(state.balances.custodialReserved, "125.25");
  assert.equal(state.balances.walletAvailable, "0.00");
  assert.equal(state.transactions[0].status, "processing");
  assert.equal(state.reconciliation.balanced, true);
  assert.equal(state.balances.total, "10000.00");
  assert.equal(state.transactions[0].hash, null);
  assert.equal(state.transactions[0].explorerUrl, null);
  assert.match(state.transactions[0].simulationId, /^sim_/);
  assert.equal(ledger.state(accountId).transactions[0].status, "processing");
  assert.equal((await ledger.advance(accountId, 3_999)).transactions[0].status, "processing");
  state = await ledger.advance(accountId, 4_000);
  assert.equal(state.balances.custodialReserved, "0.00");
  assert.equal(state.balances.walletAvailable, "125.25");
  assert.equal(state.transactions[0].status, "confirmed");
  assert.equal(state.reconciliation.differenceMicros, "0");
  assert.deepEqual((await ledger.advance(accountId, 10_000)).balances, state.balances);
});
test("retorno reserva wallet e credita conta custodial só na confirmação", async () => {
  const { ledger, accountId } = fixture();
  await ledger.activateWallet(accountId);
  await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "200" }, "send-0001", 2_000);
  await ledger.advance(accountId, 4_000);
  let state = await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "75.99" }, "return-0001", 5_000);
  assert.equal(state.balances.walletAvailable, "124.01");
  assert.equal(state.balances.walletReserved, "75.99");
  assert.equal(state.balances.custodialAvailable, "9800.00");
  assert.equal(state.reconciliation.balanced, true);
  state = await ledger.advance(accountId, 7_000);
  assert.equal(state.balances.walletReserved, "0.00");
  assert.equal(state.balances.custodialAvailable, "9875.99");
  assert.equal(state.reconciliation.balanced, true);
});
for (const outcome of ["failed", "timeout"] as const) {
  test(`${outcome}: estorna reservas nos dois sentidos e mantém total`, async () => {
    const { ledger, accountId } = fixture();
    await ledger.activateWallet(accountId);
    await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "50", outcome }, "fail-send-0001", 2_000);
    let state = await ledger.advance(accountId, 4_000);
    assert.equal(state.balances.custodialAvailable, "10000.00");
    assert.equal(state.balances.custodialReserved, "0.00");
    assert.equal(state.transactions[0].status, "failed");
    assert.ok(state.transactions[0].failureReason);
    await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "100" }, "seed-wallet-0001", 5_000);
    await ledger.advance(accountId, 7_000);
    await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "60", outcome }, "fail-return-0001", 8_000);
    state = await ledger.advance(accountId, 10_000);
    assert.equal(state.balances.walletAvailable, "100.00");
    assert.equal(state.balances.walletReserved, "0.00");
    assert.equal(state.balances.custodialAvailable, "9900.00");
    assert.equal(state.reconciliation.balanced, true);
  });
}
test("replay idempotente não duplica reserva nem crédito e conflito é rejeitado", async () => {
  const { ledger, accountId } = fixture();
  await ledger.activateWallet(accountId);
  const input = { direction: "mb_to_wallet", amount: "10.999", outcome: "confirmed" };
  const first = await ledger.transfer(accountId, input, "same-key-0001", 2_000);
  const replay = await ledger.transfer(accountId, { ...input, amount: "10.99" }, "same-key-0001", 2_001);
  assert.deepEqual(replay.balances, first.balances);
  assert.equal(replay.transactions.length, 1);
  await expectCode(() => ledger.transfer(accountId, { ...input, amount: "11" }, "same-key-0001", 2_001), "IDEMPOTENCY_CONFLICT");
  await expectCode(() => ledger.transfer(accountId, { ...input, outcome: "failed" }, "same-key-0001", 2_001), "IDEMPOTENCY_CONFLICT");
  const settled = await ledger.advance(accountId, 4_000);
  const settledReplay = await ledger.transfer(accountId, input, "same-key-0001", 6_000);
  assert.deepEqual(settledReplay.balances, settled.balances);
  assert.equal(settledReplay.transactions.length, 1);
});
test("limites, rede e wallet bloqueiam envio sem alterar o ledger", async () => {
  const { ledger, accountId } = fixture();
  const transfer = (amount: unknown, key = "validation-0001") => ledger.transfer(accountId, { direction: "mb_to_wallet", amount }, key, 2_000);
  await expectCode(() => transfer("1"), "WALLET_INACTIVE");
  await ledger.activateWallet(accountId);
  await expectCode(() => transfer("10000.01"), "INSUFFICIENT_BALANCE");
  await expectCode(() => transfer("0"), "INVALID_AMOUNT");
  await expectCode(() => transfer("-1"), "INVALID_AMOUNT");
  await expectCode(() => transfer("1", "bad"), "INVALID_IDEMPOTENCY_KEY");
  ledger.setNetwork(accountId, 1);
  await expectCode(() => transfer("1"), "WRONG_NETWORK");
  expectSyncCode(() => ledger.setNetwork(accountId, "11155111"), "INVALID_CHAIN");
  ledger.setNetwork(accountId, 11155111);
  await transfer("10000");
  await expectCode(() => transfer("0.01", "validation-0002"), "INSUFFICIENT_BALANCE");
  expectSyncCode(() => ledger.setNetwork(accountId, 1), "PENDING_TRANSACTION");
  const state = ledger.state(accountId);
  assert.equal(state.transactions.length, 1);
  assert.equal(state.balances.custodialReserved, "10000.00");
  assert.equal(state.reconciliation.balanced, true);
});
test("chaves são escopadas por conta, reset não afeta outra conta, hashes têm UNIQUE", async () => {
  const { ledger, accountId } = fixture();
  const second = login(ledger, "other@example.com");
  for (const id of [accountId, second.accountId]) {
    await ledger.activateWallet(id);
    await ledger.transfer(id, { direction: "mb_to_wallet", amount: "20" }, "shared-key-0001", 2_000);
    await ledger.advance(id, 4_000);
  }
  const firstTx = ledger.state(accountId).transactions[0];
  const secondTx = ledger.state(second.accountId).transactions[0];
  ledger.db.prepare("UPDATE transfers SET hash = ? WHERE id = ?").run("0xunique-receipt", firstTx.id);
  assert.throws(() => ledger.db.prepare("UPDATE transfers SET hash = ? WHERE id = ?").run("0xunique-receipt", secondTx.id), /UNIQUE/);
  ledger.reset(accountId);
  assert.equal(ledger.state(accountId).transactions.length, 0);
  assert.equal(ledger.state(accountId).wallet.active, false);
  assert.equal(ledger.state(accountId).balances.custodialAvailable, "10000.00");
  assert.equal(ledger.state(second.accountId).balances.walletAvailable, "20.00");
});
test("SQLite preserva sessão, reservas e idempotência entre reinícios", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-bridge-test-"));
  const path = join(dir, "ledger.sqlite");
  let ledger = new Ledger(path);
  try {
    const { accountId, token } = login(ledger);
    await ledger.activateWallet(accountId);
    await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "12.34" }, "restart-0001", 2_000);
    ledger.close();
    ledger = new Ledger(path);
    assert.equal(ledger.accountForSession(token, 3_000), accountId);
    assert.equal(ledger.state(accountId).balances.custodialReserved, "12.34");
    await ledger.advance(accountId, 4_000);
    const replay = await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "12.34" }, "restart-0001", 5_000);
    assert.equal(replay.transactions.length, 1);
    assert.equal(replay.balances.walletAvailable, "12.34");
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("falha temporária de observação mantém reserva em unknown e reconcilia após reinício", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-bridge-unknown-"));
  const path = join(dir, "ledger.sqlite");
  const unavailable = new SimulatedWalletProvider();
  unavailable.observe = () => { throw new Error("RPC temporariamente indisponível"); };
  let ledger = new Ledger(path, unavailable);
  try {
    const { accountId } = login(ledger);
    await ledger.activateWallet(accountId);
    await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "12.34" }, "unknown-0001", 2_000);
    const unknown = await ledger.advance(accountId, 4_000);
    assert.equal(unknown.transactions[0].status, "unknown");
    assert.equal(unknown.balances.custodialReserved, "12.34");
    assert.match(unknown.transactions[0].failureReason ?? "", /Observação pendente/);
    expectSyncCode(() => ledger.setNetwork(accountId, 1), "PENDING_TRANSACTION");
    ledger.close();

    ledger = new Ledger(path);
    const recovered = await ledger.advance(accountId, 5_000);
    assert.equal(recovered.transactions[0].status, "confirmed");
    assert.equal(recovered.balances.custodialReserved, "0.00");
    assert.equal(recovered.balances.walletAvailable, "12.34");
    assert.equal(recovered.reconciliation.balanced, true);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
