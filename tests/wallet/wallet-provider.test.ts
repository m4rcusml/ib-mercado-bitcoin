import { test, vi, afterEach, onTestFinished } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Transaction } from "../../src/lib/domain/contracts.ts";
import { Ledger } from "../../src/lib/domain/ledger.ts";
import { SEPOLIA_CHAIN_ID, SimulatedWalletProvider, simulatedWalletProvider } from "../../src/lib/wallet/wallet-provider.ts";
import type { PersistedOperation, WalletProvider } from "../../src/lib/wallet/wallet-provider.ts";

const USER_OP_HASH = `0x${"ab".repeat(32)}`;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function operation(overrides: Partial<PersistedOperation> = {}): PersistedOperation {
  return {
    id: "tx-1", accountId: "account-1", direction: "mb_to_wallet", status: "processing", amountCents: 100n,
    amountUnits: null, outcome: "confirmed", walletAddress: null, ownerAddress: null, fromAddress: null, toAddress: null,
    txHash: null, userOpHash: null, createdAt: 1_000, submittedAt: null, ...overrides,
  };
}

function fakeProvider(userOpHash: string | null): WalletProvider & { submitted: number; observed: PersistedOperation[] } {
  let counter = 0;
  const simulated = new SimulatedWalletProvider();
  return {
    mode: "simulated",
    submitted: 0,
    observed: [],
    activate(accountId: string) {
      return `0x${accountId.replace(/[^a-f0-9]/g, "").padEnd(40, "0").slice(0, 40)}`;
    },
    route: () => ({ from: null, to: null, amountUnits: null }),
    submit(_operation, now) {
      this.submitted += 1;
      counter += 1;
      return {
        status: "processing",
        simulationId: `fake_${counter}_${now}`,
        settlesAt: now + 2_000,
        userOpHash: userOpHash === null ? null : `${userOpHash.slice(0, -2)}${counter.toString(16).padStart(2, "0")}`,
      };
    },
    observe(op) {
      this.observed.push(op);
      return op.outcome === "confirmed" ? { status: "confirmed" } : { status: "failed", reason: "falha fake" };
    },
    signatureRequest: () => null,
  };
}

async function fixture(provider?: WalletProvider) {
  const ledger = provider ? new Ledger(":memory:", provider) : new Ledger(":memory:");
  onTestFinished(() => ledger.close());
  ledger.requestCode("equipe@example.com", 1_000);
  const { token } = ledger.login("equipe@example.com", "123456", 1_000);
  const accountId = ledger.accountForSession(token, 1_000)!;
  await ledger.activateWallet(accountId);
  return { ledger, accountId };
}

function transfersColumns(db: DatabaseSync) {
  return db.prepare("PRAGMA table_info(transfers)").all() as Array<{ name: string; type: string; notnull: number }>;
}

test("SimulatedWalletProvider implementa WalletProvider em modo simulated", () => {
  const provider: WalletProvider = new SimulatedWalletProvider();
  assert.equal(provider.mode, "simulated");
  for (const method of ["activate", "route", "submit", "observe", "signatureRequest"] as const) {
    assert.equal(typeof provider[method], "function");
  }
  assert.ok(simulatedWalletProvider instanceof SimulatedWalletProvider);
  assert.equal(SEPOLIA_CHAIN_ID, 11155111);
});

test("activate continua determinístico e retorna endereço hex de 20 bytes", () => {
  const provider = new SimulatedWalletProvider();
  const address = provider.activate("account-1");
  assert.match(address, /^0x[0-9a-f]{40}$/);
  assert.equal(provider.activate("account-1"), address);
  assert.equal(simulatedWalletProvider.activate("account-1"), address);
  assert.notEqual(provider.activate("account-2"), address);
});

test("submit simulado agenda liquidação em 2s sem hash nem UserOperation", () => {
  const provider = new SimulatedWalletProvider();
  const submitted = provider.submit(operation(), 10_000);
  assert.equal(submitted.status, "processing");
  if (submitted.status !== "processing") return;
  assert.equal(submitted.userOpHash, null);
  assert.equal(submitted.settlesAt, 12_000);
  assert.match(submitted.simulationId, /^sim_/);
  assert.deepEqual(provider.route(), { from: null, to: null, amountUnits: null });
  assert.equal(provider.signatureRequest(), null);
});

test("observe simulado decide pelo outcome persistido na operação", () => {
  const provider = new SimulatedWalletProvider();
  assert.deepEqual(provider.observe(operation({ outcome: "confirmed" })), { status: "confirmed" });
  for (const outcome of ["failed", "timeout"] as const) {
    const result = provider.observe(operation({ outcome }));
    assert.equal(result.status, "failed");
    assert.ok(result.status === "failed" && result.reason.length > 0);
  }
});

test("getWalletProvider usa o simulado por padrão e com WALLET_PROVIDER=simulated", async () => {
  for (const value of [undefined, "simulated"]) {
    vi.stubEnv("WALLET_PROVIDER", value as string);
    vi.resetModules();
    const { getWalletProvider, SimulatedWalletProvider: Fresh } = await import("../../src/lib/wallet/wallet-provider.ts");
    assert.ok(getWalletProvider() instanceof Fresh);
  }
});

test("tabela transfers possui as colunas da PoC e índice único parcial de tx_hash", () => {
  const ledger = new Ledger(":memory:");
  onTestFinished(() => ledger.close());
  const columns = transfersColumns(ledger.db);
  for (const name of ["user_op_hash", "tx_hash", "wallet_address", "from_address", "to_address", "amount_units", "submitted_at"]) {
    const column = columns.find((c) => c.name === name);
    assert.ok(column, `coluna ${name} ausente`);
    assert.equal(column.notnull, 0);
  }
  const indexes = ledger.db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'transfers'").all() as Array<{ name: string; sql: string | null }>;
  assert.ok(indexes.some((index) => index.name === "transfers_user_op_hash_unique" && /UNIQUE[\s\S]*user_op_hash IS NOT NULL/i.test(index.sql ?? "")));
  // tx_hash é único só para envios diretos: um bundle pode conter várias UserOperations.
  assert.ok(indexes.some((index) => index.name === "transfers_direct_tx_hash_unique" && /UNIQUE[\s\S]*user_op_hash IS NULL/i.test(index.sql ?? "")));
  assert.ok(!indexes.some((index) => index.name === "transfers_tx_hash_unique"));
  const accountColumns = ledger.db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>;
  assert.ok(accountColumns.some((c) => c.name === "owner_address"));
});

for (const legacyStatusCheck of ["", "CHECK(status IN ('processing', 'unknown', 'confirmed', 'failed'))"]) {
  test(`banco legado ${legacyStatusCheck ? "com CHECK antigo" : "sem user_op_hash"} migra preservando operação pendente`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "mb-bridge-migration-"));
    const path = join(dir, "ledger.sqlite");
    try {
      const legacy = new DatabaseSync(path);
      legacy.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, wallet_address TEXT,
          connected_chain INTEGER NOT NULL DEFAULT 11155111, custodial_cents INTEGER NOT NULL DEFAULT 1000000,
          custodial_remainder INTEGER NOT NULL DEFAULT 0, wallet_cents INTEGER NOT NULL DEFAULT 0,
          wallet_remainder INTEGER NOT NULL DEFAULT 0, custodial_reserved INTEGER NOT NULL DEFAULT 0,
          wallet_reserved INTEGER NOT NULL DEFAULT 0, initial_micros INTEGER NOT NULL DEFAULT 10000000000);
        CREATE TABLE transfers (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, direction TEXT NOT NULL,
          amount_cents INTEGER NOT NULL, status TEXT NOT NULL ${legacyStatusCheck}, outcome TEXT NOT NULL,
          simulation_id TEXT NOT NULL UNIQUE, hash TEXT UNIQUE, failure_reason TEXT, created_at INTEGER NOT NULL,
          settles_at INTEGER NOT NULL, settled_at INTEGER, idempotency_key TEXT NOT NULL,
          UNIQUE(account_id, idempotency_key));
        INSERT INTO accounts(id, email, wallet_address, custodial_cents, custodial_reserved) VALUES ('legacy-account', 'legacy@example.com', '0x${"1".repeat(40)}', 999900, 100);
        INSERT INTO transfers(id, account_id, direction, amount_cents, status, outcome, simulation_id, created_at, settles_at, idempotency_key)
          VALUES ('legacy-tx', 'legacy-account', 'mb_to_wallet', 100, 'processing', 'confirmed', 'sim_legacy', 1000, 3000, 'legacy-0001');
      `);
      legacy.close();
      const ledger = new Ledger(path);
      try {
        assert.ok(transfersColumns(ledger.db).some((c) => c.name === "tx_hash"));
        assert.ok((ledger.db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>).some((c) => c.name === "owner_address"), "accounts ganha owner_address");
        const [tx] = ledger.state("legacy-account").transactions;
        assert.equal(tx.id, "legacy-tx");
        assert.equal(tx.userOpHash, null);
        assert.equal(tx.txHash, null);
        // Novo CHECK aceita os estados da PoC.
        ledger.db.prepare("UPDATE transfers SET status = 'awaiting_user_signature' WHERE id = 'legacy-tx'").run();
        ledger.db.prepare("UPDATE transfers SET status = 'processing' WHERE id = 'legacy-tx'").run();
        const settled = await ledger.advance("legacy-account", 4_000);
        assert.equal(settled.transactions[0].status, "confirmed");
        assert.equal(settled.balances.walletAvailable, "1.00");
        assert.equal(settled.reconciliation.balanced, true);
      } finally {
        ledger.close();
      }
      // Reabrir um banco já migrado não reconstrói nem perde dados.
      const reopened = new Ledger(path);
      try {
        assert.equal(reopened.state("legacy-account").transactions[0].status, "confirmed");
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("Transaction no modo simulado expõe campos on-chain nulos", async () => {
  const { ledger, accountId } = await fixture();
  const state = await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "10" }, "userop-null-0001", 2_000);
  assert.equal(state.mode, "simulated");
  assert.equal(state.privyAppId, null);
  assert.equal(state.wallet.simulated, true);
  const tx: Transaction = state.transactions[0];
  for (const field of ["userOpHash", "txHash", "hash", "explorerUrl", "fromAddress", "toAddress", "amountUnits", "signatureRequest", "submittedAt"] as const) {
    assert.ok(Object.hasOwn(tx, field), field);
    assert.equal(tx[field], null, field);
  }
});

test("Ledger aceita WalletProvider injetado e persiste userOpHash retornado por submit", async () => {
  const provider = fakeProvider(USER_OP_HASH);
  const { ledger, accountId } = await fixture(provider);
  const state = await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "25.50" }, "userop-0001", 2_000);
  assert.equal(provider.submitted, 1);
  const tx = state.transactions[0];
  assert.match(tx.simulationId, /^fake_1_/);
  assert.equal(tx.userOpHash, `${USER_OP_HASH.slice(0, -2)}01`);
});

test("Ledger usa activate do provider injetado para definir o endereço da wallet", async () => {
  const provider = fakeProvider(null);
  const { ledger, accountId } = await fixture(provider);
  assert.equal(ledger.state(accountId).wallet.address, provider.activate(accountId));
});

test("userOpHash permanece após liquidação e no replay idempotente sem novo submit", async () => {
  const provider = fakeProvider(USER_OP_HASH);
  const { ledger, accountId } = await fixture(provider);
  const input = { direction: "mb_to_wallet", amount: "5" };
  const first = (await ledger.transfer(accountId, input, "userop-replay-0001", 2_000)).transactions[0];
  const settled = (await ledger.advance(accountId, 4_000)).transactions[0];
  assert.equal(settled.status, "confirmed");
  assert.equal(settled.userOpHash, first.userOpHash);
  const replay = await ledger.transfer(accountId, input, "userop-replay-0001", 5_000);
  assert.equal(provider.submitted, 1);
  assert.equal(replay.transactions.length, 1);
});

test("observe recebe a operação persistida (id, direção, valor, outcome)", async () => {
  const provider = fakeProvider(USER_OP_HASH);
  const { ledger, accountId } = await fixture(provider);
  await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "3", outcome: "failed" }, "userop-observe-0001", 2_000);
  const tx = (await ledger.advance(accountId, 4_000)).transactions[0];
  assert.equal(provider.observed.length, 1);
  const [observed] = provider.observed;
  assert.equal(observed.id, tx.id);
  assert.equal(observed.accountId, accountId);
  assert.equal(observed.direction, "mb_to_wallet");
  assert.equal(observed.amountCents, 300n);
  assert.equal(observed.outcome, "failed");
  assert.equal(observed.status, "processing");
  assert.equal(tx.status, "failed");
  assert.equal(tx.failureReason, "falha fake");
  assert.equal(ledger.state(accountId).balances.custodialAvailable, "10000.00");
});
