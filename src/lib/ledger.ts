import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { BridgeState, Direction, SimulationOutcome, Transaction } from "./contracts.ts";
import { BridgeError, formatCents, formatMicros, MICROS_PER_CENT, parseAmount } from "./money.ts";
import { SEPOLIA_CHAIN_ID, simulatedWalletProvider } from "./wallet-provider.ts";

const INITIAL_CENTS = 1_000_000n;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1_000;
type Row = Record<string, string | bigint | null>;

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new BridgeError("INVALID_EMAIL", "Informe um e-mail válido para a conta de demonstração.");
  }
  return value.trim().toLowerCase();
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class Ledger {
  db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        wallet_address TEXT,
        connected_chain INTEGER NOT NULL DEFAULT 11155111,
        custodial_cents INTEGER NOT NULL DEFAULT 1000000 CHECK(custodial_cents >= 0),
        custodial_remainder INTEGER NOT NULL DEFAULT 0 CHECK(custodial_remainder BETWEEN 0 AND 9999),
        wallet_cents INTEGER NOT NULL DEFAULT 0 CHECK(wallet_cents >= 0),
        wallet_remainder INTEGER NOT NULL DEFAULT 0 CHECK(wallet_remainder BETWEEN 0 AND 9999),
        custodial_reserved INTEGER NOT NULL DEFAULT 0 CHECK(custodial_reserved >= 0),
        wallet_reserved INTEGER NOT NULL DEFAULT 0 CHECK(wallet_reserved >= 0),
        initial_micros INTEGER NOT NULL DEFAULT 10000000000
      );
      CREATE TABLE IF NOT EXISTS challenges (
        email TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        direction TEXT NOT NULL CHECK(direction IN ('mb_to_wallet', 'wallet_to_mb')),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        status TEXT NOT NULL CHECK(status IN ('processing', 'confirmed', 'failed')),
        outcome TEXT NOT NULL CHECK(outcome IN ('confirmed', 'failed', 'timeout')),
        simulation_id TEXT NOT NULL UNIQUE,
        hash TEXT UNIQUE,
        failure_reason TEXT,
        created_at INTEGER NOT NULL,
        settles_at INTEGER NOT NULL,
        settled_at INTEGER,
        idempotency_key TEXT NOT NULL,
        UNIQUE(account_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS transfers_account_created ON transfers(account_id, created_at DESC);
    `);
  }

  private statement(sql: string) {
    const statement = this.db.prepare(sql);
    statement.setReadBigInts(true);
    return statement;
  }

  private atomic<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private account(accountId: string): Row {
    const account = this.statement("SELECT * FROM accounts WHERE id = ?").get(accountId) as Row | undefined;
    if (!account) throw new BridgeError("UNAUTHORIZED", "Entre na conta de demonstração para continuar.", 401);
    return account;
  }

  requestCode(emailValue: unknown, now = Date.now()): { demoCode: string; message: string } {
    const email = normalizeEmail(emailValue);
    this.statement("INSERT INTO challenges(email, expires_at) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET expires_at = excluded.expires_at")
      .run(email, BigInt(now + 10 * 60 * 1_000));
    return { demoCode: "123456", message: "Código demonstrativo: 123456. Nenhum e-mail foi enviado. Válido por 10 minutos." };
  }

  login(emailValue: unknown, code: unknown, now = Date.now()): { token: string; state: BridgeState } {
    const email = normalizeEmail(emailValue);
    if (code !== "123456") throw new BridgeError("INVALID_CODE", "Use o código demonstrativo 123456.", 401);
    return this.atomic(() => {
      const challenge = this.statement("SELECT expires_at FROM challenges WHERE email = ?").get(email) as Row | undefined;
      if (!challenge || BigInt(challenge.expires_at!) <= BigInt(now)) {
        throw new BridgeError("EXPIRED_CODE", "Solicite um novo código demonstrativo para este e-mail.", 401);
      }
      this.statement("INSERT OR IGNORE INTO accounts(id, email) VALUES (?, ?)").run(randomUUID(), email);
      const account = this.statement("SELECT id FROM accounts WHERE email = ?").get(email) as Row;
      const accountId = String(account.id);
      const token = randomBytes(32).toString("hex");
      this.statement("INSERT INTO sessions(token_hash, account_id, expires_at) VALUES (?, ?, ?)")
        .run(tokenHash(token), accountId, BigInt(now + SESSION_DURATION_MS));
      this.statement("DELETE FROM challenges WHERE email = ?").run(email);
      this.statement("DELETE FROM sessions WHERE expires_at <= ?").run(BigInt(now));
      return { token, state: this.state(accountId) };
    });
  }

  accountForSession(token: string | null, now = Date.now()): string | null {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = this.statement("SELECT account_id FROM sessions WHERE token_hash = ? AND expires_at > ?")
      .get(tokenHash(token), BigInt(now)) as Row | undefined;
    return session ? String(session.account_id) : null;
  }

  logout(token: string | null): void {
    if (token) this.statement("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  }

  state(accountId: string | null): BridgeState {
    if (!accountId) return anonymousState();
    const account = this.account(accountId);
    const cents = (key: string) => BigInt(account[key]!);
    const currentMicros = (cents("custodial_cents") + cents("wallet_cents") + cents("custodial_reserved") + cents("wallet_reserved")) * MICROS_PER_CENT
      + cents("custodial_remainder") + cents("wallet_remainder");
    const initialMicros = cents("initial_micros");
    const rows = this.statement("SELECT * FROM transfers WHERE account_id = ? ORDER BY created_at DESC, rowid DESC").all(accountId) as Row[];
    return {
      mode: "simulation",
      network: { name: "Sepolia", chainId: SEPOLIA_CHAIN_ID, connectedChainId: Number(account.connected_chain) },
      user: { email: String(account.email) },
      wallet: { active: account.wallet_address !== null, address: account.wallet_address as string | null, simulated: true },
      balances: {
        custodialAvailable: formatCents(cents("custodial_cents")),
        custodialReserved: formatCents(cents("custodial_reserved")),
        walletAvailable: formatCents(cents("wallet_cents")),
        walletReserved: formatCents(cents("wallet_reserved")),
        custodialRemainderMicros: cents("custodial_remainder").toString(),
        walletRemainderMicros: cents("wallet_remainder").toString(),
        total: formatMicros(currentMicros),
      },
      transactions: rows.map(rowToTransaction),
      reconciliation: {
        balanced: currentMicros === initialMicros,
        initialMicros: initialMicros.toString(),
        currentMicros: currentMicros.toString(),
        differenceMicros: (currentMicros - initialMicros).toString(),
      },
    };
  }

  activateWallet(accountId: string): BridgeState {
    this.account(accountId);
    this.statement("UPDATE accounts SET wallet_address = COALESCE(wallet_address, ?) WHERE id = ?")
      .run(simulatedWalletProvider.activate(accountId), accountId);
    return this.state(accountId);
  }

  transfer(accountId: string, input: { direction?: unknown; amount?: unknown; outcome?: unknown }, key: string | null, now = Date.now()): BridgeState {
    if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw new BridgeError("INVALID_IDEMPOTENCY_KEY", "Envie o cabeçalho Idempotency-Key com 8 a 128 caracteres alfanuméricos.");
    }
    if (input.direction !== "mb_to_wallet" && input.direction !== "wallet_to_mb") {
      throw new BridgeError("INVALID_DIRECTION", "Escolha um sentido de transferência válido.");
    }
    const direction: Direction = input.direction;
    const outcome = input.outcome ?? "confirmed";
    if (outcome !== "confirmed" && outcome !== "failed" && outcome !== "timeout") {
      throw new BridgeError("INVALID_OUTCOME", "Escolha um cenário simulado válido.");
    }
    const amount = parseAmount(input.amount);
    return this.atomic(() => {
      const account = this.account(accountId);
      const existing = this.statement("SELECT * FROM transfers WHERE account_id = ? AND idempotency_key = ?")
        .get(accountId, key) as Row | undefined;
      if (existing) {
        if (existing.direction !== direction || BigInt(existing.amount_cents!) !== amount.cents || existing.outcome !== outcome) {
          throw new BridgeError("IDEMPOTENCY_CONFLICT", "Esta chave já foi usada para outra transferência. Use uma nova chave.", 409);
        }
        return this.state(accountId);
      }
      if (!account.wallet_address) throw new BridgeError("WALLET_INACTIVE", "Ative a wallet simulada antes de transferir.", 409);
      if (account.connected_chain !== BigInt(SEPOLIA_CHAIN_ID)) {
        throw new BridgeError("WRONG_NETWORK", "A rede simulada é incompatível. Selecione Sepolia para continuar.", 409);
      }
      const source = direction === "mb_to_wallet" ? "custodial_cents" : "wallet_cents";
      const reserved = direction === "mb_to_wallet" ? "custodial_reserved" : "wallet_reserved";
      if (amount.cents > BigInt(account[source]!)) {
        throw new BridgeError("INSUFFICIENT_BALANCE", "O valor excede o saldo disponível na origem.", 409);
      }
      const submitted = simulatedWalletProvider.submit(outcome, now);
      this.statement(`UPDATE accounts SET ${source} = ${source} - ?, ${reserved} = ${reserved} + ? WHERE id = ?`)
        .run(amount.cents, amount.cents, accountId);
      this.statement(`INSERT INTO transfers(id, account_id, direction, amount_cents, status, outcome, simulation_id, created_at, settles_at, idempotency_key)
        VALUES (?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?)`)
        .run(randomUUID(), accountId, direction, amount.cents, outcome, submitted.simulationId, BigInt(now), BigInt(submitted.settlesAt), key);
      return this.state(accountId);
    });
  }

  advance(accountId: string, now = Date.now()): BridgeState {
    return this.atomic(() => {
      this.account(accountId);
      const due = this.statement("SELECT * FROM transfers WHERE account_id = ? AND status = 'processing' AND settles_at <= ?")
        .all(accountId, BigInt(now)) as Row[];
      for (const row of due) {
        const receipt = simulatedWalletProvider.observe(row.outcome as SimulationOutcome);
        const outbound = row.direction === "mb_to_wallet";
        const reserved = outbound ? "custodial_reserved" : "wallet_reserved";
        const destination = receipt.confirmed
          ? outbound ? "wallet_cents" : "custodial_cents"
          : outbound ? "custodial_cents" : "wallet_cents";
        const amount = BigInt(row.amount_cents!);
        this.statement(`UPDATE accounts SET ${reserved} = ${reserved} - ?, ${destination} = ${destination} + ? WHERE id = ?`)
          .run(amount, amount, accountId);
        this.statement("UPDATE transfers SET status = ?, failure_reason = ?, settled_at = ? WHERE id = ? AND status = 'processing'")
          .run(receipt.confirmed ? "confirmed" : "failed", receipt.failureReason, BigInt(now), String(row.id));
      }
      return this.state(accountId);
    });
  }

  setNetwork(accountId: string, chainId: unknown): BridgeState {
    this.account(accountId);
    if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0 || chainId > 2_147_483_647) {
      throw new BridgeError("INVALID_CHAIN", "Informe um chainId inteiro e positivo.");
    }
    if (this.statement("SELECT id FROM transfers WHERE account_id = ? AND status = 'processing' LIMIT 1").get(accountId)) {
      throw new BridgeError("PENDING_TRANSACTION", "Aguarde a operação em andamento antes de mudar a rede simulada.", 409);
    }
    this.statement("UPDATE accounts SET connected_chain = ? WHERE id = ?").run(BigInt(chainId), accountId);
    return this.state(accountId);
  }

  reset(accountId: string): BridgeState {
    return this.atomic(() => {
      this.account(accountId);
      this.statement("DELETE FROM transfers WHERE account_id = ?").run(accountId);
      this.statement(`UPDATE accounts SET wallet_address = NULL, connected_chain = 11155111,
        custodial_cents = ?, wallet_cents = 0, custodial_reserved = 0, wallet_reserved = 0,
        custodial_remainder = 0, wallet_remainder = 0, initial_micros = ? WHERE id = ?`)
        .run(INITIAL_CENTS, INITIAL_CENTS * MICROS_PER_CENT, accountId);
      return this.state(accountId);
    });
  }

  close(): void {
    this.db.close();
  }
}

function rowToTransaction(row: Row): Transaction {
  const amountCents = BigInt(row.amount_cents!);
  return {
    id: String(row.id),
    direction: row.direction as Direction,
    amount: formatCents(amountCents),
    amountMicros: (amountCents * MICROS_PER_CENT).toString(),
    status: row.status as Transaction["status"],
    simulationOutcome: row.outcome as SimulationOutcome,
    simulationId: String(row.simulation_id),
    hash: row.hash as string | null,
    explorerUrl: null,
    failureReason: row.failure_reason as string | null,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    settlesAt: new Date(Number(row.settles_at)).toISOString(),
    settledAt: row.settled_at === null ? null : new Date(Number(row.settled_at)).toISOString(),
    idempotencyKey: String(row.idempotency_key),
  };
}

export function anonymousState(): BridgeState {
  return {
    mode: "simulation",
    network: { name: "Sepolia", chainId: SEPOLIA_CHAIN_ID, connectedChainId: SEPOLIA_CHAIN_ID },
    user: null,
    wallet: { active: false, address: null, simulated: true },
    balances: { custodialAvailable: "0.00", custodialReserved: "0.00", walletAvailable: "0.00", walletReserved: "0.00", walletRemainderMicros: "0", custodialRemainderMicros: "0", total: "0.00" },
    transactions: [],
    reconciliation: { balanced: true, initialMicros: "0", currentMicros: "0", differenceMicros: "0" },
  };
}

const globalLedger = globalThis as typeof globalThis & { mbBridgeLedger?: Ledger };

export function getLedger(): Ledger {
  // shortcut: uma instância por processo; usar PostgreSQL antes de executar em múltiplas réplicas.
  if (!globalLedger.mbBridgeLedger) {
    globalLedger.mbBridgeLedger = new Ledger(process.env.MB_DATABASE_PATH || resolve("data/bridge.sqlite"));
  }
  return globalLedger.mbBridgeLedger;
}
