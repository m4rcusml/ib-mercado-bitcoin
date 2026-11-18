import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { BridgeState, Direction, ProviderMode, SimulationOutcome, Transaction, TransactionStatus } from "./contracts.ts";
import { BridgeError, formatCents, formatMicros, MICROS_PER_CENT, parseAmount } from "./money.ts";
import { getWalletProvider, SEPOLIA_CHAIN_ID, simulatedWalletProvider } from "../wallet/wallet-provider.ts";
import type { PersistedOperation, SubmitResult, WalletProvider } from "../wallet/wallet-provider.ts";

// Data sentinela: mantém a transferência fora do filtro de observação enquanto submit() está em curso
// ou enquanto aguarda a assinatura do usuário.
const PENDING_SETTLES_AT = 8_640_000_000_000_000n;
const INITIAL_CENTS = 1_000_000n;

const SESSION_DURATION_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_OBSERVATION_TIMEOUT_MS = 15 * 60 * 1_000;
export const DEFAULT_SIGNATURE_TIMEOUT_MS = 10 * 60 * 1_000;
/** Intervalo entre consultas on-chain de uma mesma operação pendente (somente linhas com tx hash). */
const OBSERVATION_BACKOFF_MS = 3_000;
const HASH_32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const OPEN_STATUSES = "('processing', 'awaiting_user_signature', 'submitted', 'unknown')";
const OBSERVABLE_STATUSES = ["processing", "submitted", "unknown"] as const;
const DURABLE_PENDING_PREFIX = "durable_";

type Row = Record<string, string | bigint | null>;

export interface LedgerOptions {
  /** App ID público do Privy exposto no estado (nunca o segredo). */
  privyAppId?: string | null;
  /** Depois deste prazo, um envio sem recibo continua em observação com status unknown. */
  observationTimeoutMs?: number;
  /** awaiting_user_signature mais antigo que isso (desde a criação) vira failed com estorno. */
  signatureTimeoutMs?: number;
}

const TRANSFERS_COLUMNS = `
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK(direction IN ('mb_to_wallet', 'wallet_to_mb')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  status TEXT NOT NULL CHECK(status IN ('processing', 'awaiting_user_signature', 'submitted', 'unknown', 'confirmed', 'failed')),
  outcome TEXT NOT NULL CHECK(outcome IN ('confirmed', 'failed', 'timeout')),
  simulation_id TEXT NOT NULL UNIQUE,
  hash TEXT UNIQUE,
  user_op_hash TEXT,
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  settles_at INTEGER NOT NULL,
  settled_at INTEGER,
  idempotency_key TEXT NOT NULL,
  tx_hash TEXT,
  wallet_address TEXT,
  from_address TEXT,
  to_address TEXT,
  amount_units INTEGER CHECK(amount_units IS NULL OR amount_units > 0),
  submitted_at INTEGER,
  signed_payload TEXT,
  UNIQUE(account_id, idempotency_key)
`;
const TRANSFER_COLUMN_NAMES = [
  "id", "account_id", "direction", "amount_cents", "status", "outcome", "simulation_id", "hash", "user_op_hash",
  "failure_reason", "created_at", "settles_at", "settled_at", "idempotency_key", "tx_hash", "wallet_address",
  "from_address", "to_address", "amount_units", "submitted_at", "signed_payload",
];

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new BridgeError("INVALID_EMAIL", "Informe um e-mail válido para a conta de demonstração.");
  }
  return value.trim().toLowerCase();
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mensagem segura para persistir e expor ao cliente. Erros do viem podem conter a URL do RPC
 * (com chave de API); usamos `shortMessage` quando houver e removemos qualquer URL.
 */
export function publicReason(error: unknown, fallback: string): string {
  if (error instanceof BridgeError) return error.message;
  const short = (error as { shortMessage?: unknown } | null)?.shortMessage;
  const raw = typeof short === "string" ? short : error instanceof Error ? error.message : fallback;
  const firstLine = raw.split("\n")[0].replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url omitida]").slice(0, 300);
  return firstLine || fallback;
}

function minutes(ms: number): string {
  const value = Math.round(ms / 60_000);
  return value === 1 ? "1 minuto" : `${value} minutos`;
}

export class Ledger {
  db: DatabaseSync;
  private readonly provider: WalletProvider;
  private readonly privyAppId: string | null;
  private readonly observationTimeoutMs: number;
  private readonly signatureTimeoutMs: number;
  /** Evita duas observações simultâneas da mesma operação neste processo. */
  private readonly observing = new Set<string>();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private reconciling = false;
  private closed = false;
  /** Avisos de mudança por conta (accountId -> listeners), consumidos pelo SSE de /api/events. */
  private readonly changes = (() => { const emitter = new EventEmitter(); emitter.setMaxListeners(0); return emitter; })();

  /** Inscreve um listener para mudanças da conta; retorna a função de cancelamento. */
  onChange(accountId: string, listener: () => void): () => void {
    this.changes.on(accountId, listener);
    return () => { this.changes.off(accountId, listener); };
  }

  /** Sinaliza que o estado da conta pode ter mudado (o consumidor deduplica). */
  notifyChange(accountId: string): void {
    if (!this.closed) this.changes.emit(accountId);
  }

  constructor(filename: string, provider: WalletProvider = simulatedWalletProvider, options: LedgerOptions = {}) {
    this.provider = provider;
    this.privyAppId = provider.mode === "privy" ? options.privyAppId ?? null : null;
    this.observationTimeoutMs = options.observationTimeoutMs ?? DEFAULT_OBSERVATION_TIMEOUT_MS;
    this.signatureTimeoutMs = options.signatureTimeoutMs ?? DEFAULT_SIGNATURE_TIMEOUT_MS;
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
        owner_address TEXT,
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
      CREATE TABLE IF NOT EXISTS transfers (${TRANSFERS_COLUMNS});
      CREATE INDEX IF NOT EXISTS transfers_account_created ON transfers(account_id, created_at DESC);
    `);
    try {
      this.migrate();
      this.bindDatabaseMode();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private bindDatabaseMode(): void {
    this.atomic(() => {
      this.db.exec("CREATE TABLE IF NOT EXISTS ledger_mode (id INTEGER PRIMARY KEY CHECK(id = 1), mode TEXT NOT NULL)");
      const saved = this.statement("SELECT mode FROM ledger_mode WHERE id = 1").get() as Row | undefined;
      if (!saved) {
        const real = this.statement("SELECT 1 FROM accounts WHERE owner_address IS NOT NULL UNION ALL SELECT 1 FROM transfers WHERE amount_units IS NOT NULL LIMIT 1").get();
        const simulated = this.statement("SELECT 1 FROM transfers WHERE amount_units IS NULL LIMIT 1").get();
        if ((real && simulated) || (real && this.mode !== "privy") || (simulated && this.mode !== "simulated")) {
          throw new BridgeError("LEDGER_MODE_MISMATCH", "O SQLite contém operações incompatíveis com o modo da wallet. Configure um banco exclusivo para este modo.", 503);
        }
        this.statement("INSERT INTO ledger_mode (id, mode) VALUES (1, ?)").run(this.mode);
      } else if (saved.mode !== this.mode) {
        throw new BridgeError("LEDGER_MODE_MISMATCH", "O SQLite pertence a outro modo da wallet. Configure um banco exclusivo para este modo.", 503);
      }
    });
  }

  get mode(): ProviderMode {
    return this.provider.mode;
  }

  async initialize(): Promise<void> {
    await this.provider.initialize?.();
  }

  /**
   * SQLite não altera CHECK in-place nem suporta ADD COLUMN IF NOT EXISTS. Bancos antigos são
   * reconstruídos preservando todos os dados, para que operações pendentes antes de um reinício
   * (ou de uma atualização) continuem a ser observadas.
   */
  private migrate(): void {
    // accounts.owner_address (EOA dona da smart account) é anulável e sem CHECK: ADD COLUMN basta.
    const accountColumns = new Set((this.db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>).map((c) => c.name));
    if (!accountColumns.has("owner_address")) this.db.exec("ALTER TABLE accounts ADD COLUMN owner_address TEXT");
    const columns = new Set((this.db.prepare("PRAGMA table_info(transfers)").all() as Array<{ name: string }>).map((c) => c.name));
    const table = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transfers'")
      .get() as { sql: string } | undefined;
    const upToDate = table?.sql.includes("'awaiting_user_signature'") && TRANSFER_COLUMN_NAMES.every((name) => columns.has(name));
    if (table && !upToDate) {
      const source = TRANSFER_COLUMN_NAMES.map((name) => (columns.has(name) ? name : "NULL")).join(", ");
      this.db.exec(`
        BEGIN IMMEDIATE;
        DROP INDEX IF EXISTS transfers_account_created;
        DROP INDEX IF EXISTS transfers_user_op_hash_unique;
        DROP INDEX IF EXISTS transfers_tx_hash_unique;
        DROP INDEX IF EXISTS transfers_direct_tx_hash_unique;
        DROP INDEX IF EXISTS transfers_open_due;
        ALTER TABLE transfers RENAME TO transfers_legacy;
        CREATE TABLE transfers (${TRANSFERS_COLUMNS});
        INSERT INTO transfers(${TRANSFER_COLUMN_NAMES.join(", ")})
          SELECT ${source} FROM transfers_legacy;
        DROP TABLE transfers_legacy;
        CREATE INDEX transfers_account_created ON transfers(account_id, created_at DESC);
        COMMIT;
      `);
    }
    // O userOpHash é o identificador único de uma devolução (wallet_to_mb). O tx_hash só é único
    // para envios diretos (tesouraria): um mesmo bundle pode incluir várias UserOperations legítimas.
    this.db.exec(`
      DROP INDEX IF EXISTS transfers_tx_hash_unique;
      CREATE UNIQUE INDEX IF NOT EXISTS transfers_user_op_hash_unique ON transfers(user_op_hash) WHERE user_op_hash IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS transfers_direct_tx_hash_unique ON transfers(tx_hash) WHERE tx_hash IS NOT NULL AND user_op_hash IS NULL;
      CREATE INDEX IF NOT EXISTS transfers_open_due ON transfers(status, settles_at);
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
    if (!accountId) return anonymousState(this.provider.mode, this.privyAppId);
    const account = this.account(accountId);
    const cents = (key: string) => BigInt(account[key]!);
    const currentMicros = (cents("custodial_cents") + cents("wallet_cents") + cents("custodial_reserved") + cents("wallet_reserved")) * MICROS_PER_CENT
      + cents("custodial_remainder") + cents("wallet_remainder");
    const initialMicros = cents("initial_micros");
    const rows = this.statement("SELECT * FROM transfers WHERE account_id = ? ORDER BY created_at DESC, rowid DESC").all(accountId) as Row[];
    return {
      mode: this.provider.mode,
      privyAppId: this.privyAppId,
      network: { name: "Sepolia", chainId: SEPOLIA_CHAIN_ID, connectedChainId: Number(account.connected_chain) },
      user: { email: String(account.email) },
      wallet: this.walletState(account),
      balances: {
        custodialAvailable: formatCents(cents("custodial_cents")),
        custodialReserved: formatCents(cents("custodial_reserved")),
        walletAvailable: formatCents(cents("wallet_cents")),
        walletReserved: formatCents(cents("wallet_reserved")),
        custodialRemainderMicros: cents("custodial_remainder").toString(),
        walletRemainderMicros: cents("wallet_remainder").toString(),
        total: formatMicros(currentMicros),
      },
      transactions: rows.map((row) => this.rowToTransaction(row, (account.owner_address ?? null) as string | null)),
      reconciliation: {
        balanced: currentMicros === initialMicros,
        initialMicros: initialMicros.toString(),
        currentMicros: currentMicros.toString(),
        differenceMicros: (currentMicros - initialMicros).toString(),
      },
    };
  }

  /**
   * No modo privy a wallet só é considerada ativa com a smart account e sua EOA dona vinculadas;
   * vínculos antigos (somente EOA, sem `owner_address`) aparecem inativos até um novo link.
   */
  private walletState(account: Row): BridgeState["wallet"] {
    const address = (account.wallet_address ?? null) as string | null;
    if (this.provider.mode === "simulated") {
      return { active: address !== null, address, ownerAddress: null, simulated: true, smartAccount: null };
    }
    const ownerAddress = (account.owner_address ?? null) as string | null;
    const active = address !== null && ownerAddress !== null;
    return {
      active,
      address: active ? address : null,
      ownerAddress: active ? ownerAddress : null,
      simulated: false,
      smartAccount: active ? { type: "coinbase", entryPoint: "0.6" } : null,
    };
  }

  /** Smart account vinculada (modo privy, vínculo completo com EOA dona); `null` caso contrário. */
  linkedSmartAccount(accountId: string): string | null {
    const wallet = this.walletState(this.account(accountId));
    return wallet.active && !wallet.simulated ? wallet.address : null;
  }

  async activateWallet(accountId: string): Promise<BridgeState> {
    this.account(accountId);
    const address = await this.provider.activate(accountId);
    this.statement("UPDATE accounts SET wallet_address = COALESCE(wallet_address, ?) WHERE id = ?")
      .run(address, accountId);
    return this.state(accountId);
  }

  /**
   * Vincula a smart account (endereço operacional) e a EOA embedded dona, ambas obtidas e
   * verificadas no servidor (Privy + factory on-chain). Nunca chame com endereços do cliente.
   */
  linkWallet(accountId: string, smartAccount: string, ownerAddress: string): BridgeState {
    if (typeof smartAccount !== "string" || typeof ownerAddress !== "string" || !ADDRESS.test(smartAccount) || !ADDRESS.test(ownerAddress)
      || smartAccount.toLowerCase() === ownerAddress.toLowerCase()) {
      throw new BridgeError("INVALID_ADDRESS", "Endereço de wallet inválido.");
    }
    return this.atomic(() => {
      const account = this.account(accountId);
      const current = account.wallet_address as string | null;
      const currentOwner = account.owner_address as string | null;
      if (current?.toLowerCase() === smartAccount.toLowerCase() && currentOwner?.toLowerCase() === ownerAddress.toLowerCase()) {
        return this.state(accountId);
      }
      const other = this.statement(`SELECT id FROM accounts WHERE id <> ? AND (
          lower(wallet_address) IN (lower(?), lower(?)) OR lower(owner_address) IN (lower(?), lower(?)))`)
        .get(accountId, smartAccount, ownerAddress, smartAccount, ownerAddress);
      if (other) throw new BridgeError("WALLET_ALREADY_LINKED", "Esta embedded wallet já está vinculada a outra conta de demonstração.", 409);
      if (this.statement(`SELECT id FROM transfers WHERE account_id = ? AND status IN ${OPEN_STATUSES} LIMIT 1`).get(accountId)) {
        throw new BridgeError("PENDING_TRANSACTION", "Aguarde a operação em andamento antes de trocar a wallet vinculada.", 409);
      }
      this.statement("UPDATE accounts SET wallet_address = ?, owner_address = ? WHERE id = ?").run(smartAccount, ownerAddress, accountId);
      return this.state(accountId);
    });
  }

  async transfer(accountId: string, input: { direction?: unknown; amount?: unknown; outcome?: unknown }, key: string | null, now = Date.now()): Promise<BridgeState> {
    if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw new BridgeError("INVALID_IDEMPOTENCY_KEY", "Envie o cabeçalho Idempotency-Key com 8 a 128 caracteres alfanuméricos.");
    }
    if (input.direction !== "mb_to_wallet" && input.direction !== "wallet_to_mb") {
      throw new BridgeError("INVALID_DIRECTION", "Escolha um sentido de transferência válido.");
    }
    const direction: Direction = input.direction;
    if (this.provider.mode === "privy" && input.outcome !== undefined) {
      throw new BridgeError("SIMULATION_DISABLED", "No modo Privy o resultado é determinado pela rede; não envie outcome.");
    }
    const outcome = input.outcome ?? "confirmed";
    if (outcome !== "confirmed" && outcome !== "failed" && outcome !== "timeout") {
      throw new BridgeError("INVALID_OUTCOME", "Escolha um cenário simulado válido.");
    }
    const amount = parseAmount(input.amount);
    await this.provider.initialize?.();
    const reserved = this.atomic(() => {
      const account = this.account(accountId);
      const existing = this.statement("SELECT * FROM transfers WHERE account_id = ? AND idempotency_key = ?")
        .get(accountId, key) as Row | undefined;
      if (existing) {
        if (existing.direction !== direction || BigInt(existing.amount_cents!) !== amount.cents || existing.outcome !== outcome) {
          throw new BridgeError("IDEMPOTENCY_CONFLICT", "Esta chave já foi usada para outra transferência. Use uma nova chave.", 409);
        }
        return this.state(accountId);
      }
      if (direction === "mb_to_wallet" && this.provider.broadcast && this.statement(
        "SELECT 1 FROM transfers WHERE direction = 'mb_to_wallet' AND (status = 'processing' OR signed_payload IS NOT NULL) LIMIT 1",
      ).get()) {
        throw new BridgeError("TREASURY_BUSY", "A tesouraria está concluindo um envio. Aguarde a atualização e tente novamente.", 409);
      }
      if (!account.wallet_address || (this.provider.mode === "privy" && !account.owner_address)) {
        throw this.provider.mode === "privy"
          ? new BridgeError("WALLET_INACTIVE", "Vincule a embedded wallet Privy (smart account) antes de transferir.", 409)
          : new BridgeError("WALLET_INACTIVE", "Ative a wallet simulada antes de transferir.", 409);
      }
      if (account.connected_chain !== BigInt(SEPOLIA_CHAIN_ID)) {
        throw new BridgeError("WRONG_NETWORK", "A rede simulada é incompatível. Selecione Sepolia para continuar.", 409);
      }
      const source = direction === "mb_to_wallet" ? "custodial_cents" : "wallet_cents";
      const reservedColumn = direction === "mb_to_wallet" ? "custodial_reserved" : "wallet_reserved";
      if (amount.cents > BigInt(account[source]!)) {
        throw new BridgeError("INSUFFICIENT_BALANCE", "O valor excede o saldo disponível na origem.", 409);
      }
      const route = this.provider.route(direction, String(account.wallet_address), amount.cents);
      const transferId = randomUUID();
      this.statement(`UPDATE accounts SET ${source} = ${source} - ?, ${reservedColumn} = ${reservedColumn} + ? WHERE id = ?`)
        .run(amount.cents, amount.cents, accountId);
      this.statement(`INSERT INTO transfers(id, account_id, direction, amount_cents, status, outcome, simulation_id, created_at, settles_at, idempotency_key,
          wallet_address, from_address, to_address, amount_units)
        VALUES (?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(transferId, accountId, direction, amount.cents, outcome, `${this.mode === "privy" ? DURABLE_PENDING_PREFIX : "pending_"}${transferId}`, BigInt(now), PENDING_SETTLES_AT, key,
          account.wallet_address, route.from, route.to, route.amountUnits);
      return { transferId, source, reservedColumn };
    });

    if ("transactions" in reserved) return reserved;

    // Nenhuma transação SQL fica aberta durante a chamada ao provider (rede/RPC).
    const operation = this.operation(this.statement("SELECT * FROM transfers WHERE id = ?").get(reserved.transferId) as Row);
    let submitted: SubmitResult;
    try {
      submitted = await this.provider.submit(operation, now);
    } catch (error) {
      if (!(error instanceof BridgeError)) console.error("Falha ao preparar operação", operation.id);
      return this.atomic(() => {
        const pending = this.statement("SELECT status FROM transfers WHERE id = ?").get(reserved.transferId) as Row | undefined;
        if (pending?.status === "processing") {
          this.statement(`UPDATE accounts SET ${reserved.reservedColumn} = ${reserved.reservedColumn} - ?, ${reserved.source} = ${reserved.source} + ? WHERE id = ?`)
            .run(amount.cents, amount.cents, accountId);
          this.statement("UPDATE transfers SET status = 'failed', failure_reason = ?, settled_at = ? WHERE id = ?")
            .run(publicReason(error, "Não foi possível enviar a operação."), BigInt(now), reserved.transferId);
        }
        return this.state(accountId);
      });
    }

    return this.atomic(() => {
      if (submitted.status === "processing") {
        this.statement("UPDATE transfers SET simulation_id = ?, user_op_hash = ?, settles_at = ? WHERE id = ? AND status = 'processing'")
          .run(submitted.simulationId, submitted.userOpHash, BigInt(submitted.settlesAt), reserved.transferId);
      } else if (submitted.status === "submitted") {
        this.statement("UPDATE transfers SET status = ?, tx_hash = ?, signed_payload = ?, submitted_at = ?, settles_at = ? WHERE id = ? AND status = 'processing'")
          .run(submitted.signedPayload ? "unknown" : "submitted", submitted.txHash.toLowerCase(), submitted.signedPayload ?? null, BigInt(now), BigInt(now), reserved.transferId);
      } else {
        this.statement("UPDATE transfers SET status = 'awaiting_user_signature' WHERE id = ? AND status = 'processing'")
          .run(reserved.transferId);
      }
      return this.state(accountId);
    });
  }

  /**
   * Vincula o `userOpHash` informado pelo browser a uma operação `wallet_to_mb`. Não liquida saldo:
   * somente o observador, após o receipt do bundler e a verificação on-chain, confirma a operação.
   */
  submitUserOperation(accountId: string, transferId: unknown, userOpHashValue: unknown, now = Date.now(), signedPayload?: string, legacyOnly = false): BridgeState {
    if (typeof transferId !== "string" || transferId.length > 64) {
      throw new BridgeError("TRANSFER_NOT_FOUND", "Transferência não encontrada.", 404);
    }
    if (typeof userOpHashValue !== "string" || !HASH_32.test(userOpHashValue)) {
      throw new BridgeError("INVALID_USER_OP_HASH", "Informe userOpHash no formato 0x seguido de 64 caracteres hexadecimais.");
    }
    const userOpHash = userOpHashValue.toLowerCase();
    return this.atomic(() => {
      this.account(accountId);
      const row = this.statement("SELECT * FROM transfers WHERE id = ? AND account_id = ?").get(transferId, accountId) as Row | undefined;
      if (!row) throw new BridgeError("TRANSFER_NOT_FOUND", "Transferência não encontrada.", 404);
      // Reenvio do mesmo hash após uma falha de rede no cliente é idempotente.
      if (row.user_op_hash === userOpHash) return this.state(accountId);
      const durable = String(row.simulation_id).startsWith(DURABLE_PENDING_PREFIX);
      if (legacyOnly && durable) {
        throw new BridgeError("SIGNED_USER_OPERATION_REQUIRED", "Envie a UserOperation assinada pelo endpoint RPC da transferência.", 409);
      }
      const awaitingLegacyHash = legacyOnly && !durable && row.status === "unknown" && row.user_op_hash === null;
      if (row.direction !== "wallet_to_mb" || (row.status !== "awaiting_user_signature" && !awaitingLegacyHash)) {
        throw new BridgeError("INVALID_TRANSFER_STATUS", "Esta transferência não está aguardando assinatura.", 409);
      }
      if (signedPayload && now - Number(row.created_at) >= this.signatureTimeoutMs) {
        throw new BridgeError("SIGNATURE_EXPIRED", "O prazo para assinar esta transferência terminou.", 409);
      }
      if (this.statement("SELECT id FROM transfers WHERE user_op_hash = ? OR tx_hash = ?").get(userOpHash, userOpHash)) {
        throw new BridgeError("DUPLICATE_USER_OP_HASH", "Este hash já está vinculado a outra transferência.", 409);
      }
      this.statement("UPDATE transfers SET status = ?, user_op_hash = ?, signed_payload = ?, submitted_at = ?, settles_at = ? WHERE id = ?")
        .run(signedPayload ? "unknown" : "submitted", userOpHash, signedPayload ?? null, BigInt(now), BigInt(now), transferId);
      return this.state(accountId);
    });
  }

  /** Processa as operações pendentes da conta (chamado por requisição). */
  async advance(accountId: string, now = Date.now()): Promise<BridgeState> {
    this.account(accountId);
    await this.process(this.dueRows(accountId, now), now);
    return this.state(accountId);
  }

  /**
   * Processa todas as operações pendentes de todas as contas. Como o estado vive no SQLite,
   * a primeira execução após um reinício retoma as operações interrompidas.
   */
  async reconcileAll(now = Date.now()): Promise<number> {
    const rows = this.dueRows(null, now);
    await this.process(rows, now);
    return rows.length;
  }

  /** Worker em segundo plano (modo privy). Executa imediatamente e depois a cada `intervalMs`. */
  startReconciler(intervalMs = 5_000): void {
    if (this.reconcileTimer || this.closed) return;
    const tick = async () => {
      if (this.reconciling || this.closed) return;
      this.reconciling = true;
      try { await this.reconcileAll(Date.now()); }
      catch { if (!this.closed) console.error("Falha na reconciliação em segundo plano"); }
      finally { this.reconciling = false; }
    };
    this.reconcileTimer = setInterval(() => void tick(), intervalMs);
    this.reconcileTimer.unref?.();
    void tick();
  }

  private dueRows(accountId: string | null, now: number): Row[] {
    const scope = accountId === null ? "" : "account_id = ? AND ";
    const args = accountId === null ? [BigInt(now)] : [accountId, BigInt(now)];
    return this.statement(`SELECT * FROM transfers WHERE ${scope}(
        (status IN ('processing', 'submitted', 'unknown') AND settles_at <= ?)
        OR status = 'awaiting_user_signature'
        OR (status = 'processing' AND settles_at = ${PENDING_SETTLES_AT})
      ) ORDER BY created_at, rowid`).all(...args) as Row[];
  }

  private async process(rows: Row[], now: number): Promise<void> {
    for (const row of rows) {
      const id = String(row.id);
      if (this.closed) return;
      if (this.observing.has(id)) continue;
      this.observing.add(id);
      try {
        await this.processRow(row, now);
      } finally {
        this.observing.delete(id);
      }
      // Worker e advance() passam por aqui: avisa o SSE da conta (sem efeito se nada mudou).
      this.notifyChange(String(row.account_id));
    }
  }

  private async processRow(row: Row, now: number): Promise<void> {
    const createdAt = Number(row.created_at);
    const legacyPrivy = this.mode === "privy" && !String(row.simulation_id).startsWith(DURABLE_PENDING_PREFIX);
    if (row.status === "awaiting_user_signature") {
      if (now - createdAt >= this.signatureTimeoutMs) {
        if (legacyPrivy) this.holdLegacyTransfer(row);
        else this.settle(row, false, `Assinatura não recebida em ${minutes(this.signatureTimeoutMs)}. O valor reservado foi devolvido.`, now, ["awaiting_user_signature"]);
      }
      return;
    }
    if (row.status === "processing" && BigInt(row.settles_at!) === PENDING_SETTLES_AT) {
      // No fluxo atual, nada pode ser transmitido antes de persistir o hash.
      if (now - createdAt >= this.observationTimeoutMs) {
        if (legacyPrivy) this.holdLegacyTransfer(row);
        else this.settle(row, false, `Envio interrompido sem hash registrado após ${minutes(this.observationTimeoutMs)}. O valor reservado foi devolvido.`, now, ["processing"]);
      }
      return;
    }

    const operation = this.operation(row);
    let result;
    try {
      result = await this.provider.observe(operation, now);
      if (result.status === "pending" && typeof row.signed_payload === "string" && this.provider.broadcast) {
        await this.provider.broadcast(operation, row.signed_payload);
        if (this.closed) return;
        this.statement("UPDATE transfers SET signed_payload = NULL WHERE id = ? AND signed_payload = ?")
          .run(operation.id, row.signed_payload);
      }
    } catch (error) {
      if (this.closed) return;
      this.atomic(() => {
        this.statement(`UPDATE transfers SET status = 'unknown', failure_reason = ?, settles_at = ? WHERE id = ? AND status IN ('processing', 'submitted', 'unknown')`)
          .run(
            `Observação pendente: ${publicReason(error, "falha desconhecida.")}`,
            this.nextObservation(row, now),
            String(row.id),
          );
      });
      this.markObservationOverdue(row, now);
      return;
    }
    if (this.closed) return;
    const discoveredTxHash = this.discoveredTxHash(row, result.txHash);
    if (result.status === "pending") {
      if (submittedOnChain(row)) {
        this.statement("UPDATE transfers SET status = 'submitted', failure_reason = NULL, settles_at = ?, tx_hash = COALESCE(tx_hash, ?) WHERE id = ? AND status IN ('submitted', 'unknown')")
          .run(this.nextObservation(row, now), discoveredTxHash, String(row.id));
      }
      this.markObservationOverdue(row, now);
      return;
    }
    this.settle(row, result.status === "confirmed", result.status === "failed" ? result.reason : null, now, OBSERVABLE_STATUSES, discoveredTxHash);
  }

  private holdLegacyTransfer(row: Row): void {
    this.statement("UPDATE transfers SET status = 'unknown', failure_reason = ?, settles_at = ? WHERE id = ? AND status = ?")
      .run("Operação anterior à persistência de envios. A reserva permanece até a conciliação.", PENDING_SETTLES_AT, String(row.id), row.status);
  }

  /** Hash de transação descoberto na observação (bundle da UserOperation), validado e normalizado. */
  private discoveredTxHash(row: Row, value: string | undefined): string | null {
    if (row.tx_hash !== null || typeof value !== "string" || !HASH_32.test(value)) return null;
    return value.toLowerCase();
  }

  private nextObservation(row: Row, now: number): bigint {
    // Linhas simuladas mantêm o comportamento anterior (nova tentativa na próxima chamada).
    return submittedOnChain(row) ? BigInt(now + OBSERVATION_BACKOFF_MS) : BigInt(row.settles_at!);
  }

  /** Ausência de recibo não comprova que o envio falhou. Mantém a reserva e a observação. */
  private markObservationOverdue(row: Row, now: number): void {
    if (!submittedOnChain(row)) return;
    const since = row.submitted_at === null ? Number(row.created_at) : Number(row.submitted_at);
    if (now - since < this.observationTimeoutMs) return;
    this.statement("UPDATE transfers SET status = 'unknown', failure_reason = ? WHERE id = ? AND status IN ('submitted', 'unknown')")
      .run(`Sem confirmação após ${minutes(this.observationTimeoutMs)}. A reserva permanece enquanto a rede é verificada.`, String(row.id));
  }

  /**
   * Liquidação atômica: a transição de status é feita primeiro e protegida pelo status atual;
   * o saldo só se move se esta chamada efetivamente mudou a linha (changes === 1).
   */
  private settle(row: Row, confirmed: boolean, reason: string | null, now: number, from: readonly TransactionStatus[], txHash: string | null = null): void {
    this.atomic(() => {
      const guard = from.map((status) => `'${status}'`).join(", ");
      const settled = this.statement(`UPDATE transfers SET status = ?, failure_reason = ?, settled_at = ?, tx_hash = COALESCE(tx_hash, ?), signed_payload = NULL WHERE id = ? AND status IN (${guard})`)
        .run(confirmed ? "confirmed" : "failed", reason, BigInt(now), txHash, String(row.id));
      if (Number(settled.changes) !== 1) return;
      const outbound = row.direction === "mb_to_wallet";
      const reserved = outbound ? "custodial_reserved" : "wallet_reserved";
      const destination = confirmed
        ? outbound ? "wallet_cents" : "custodial_cents"
        : outbound ? "custodial_cents" : "wallet_cents";
      const amount = BigInt(row.amount_cents!);
      this.statement(`UPDATE accounts SET ${reserved} = ${reserved} - ?, ${destination} = ${destination} + ? WHERE id = ?`)
        .run(amount, amount, String(row.account_id));
    });
  }

  setNetwork(accountId: string, chainId: unknown): BridgeState {
    this.account(accountId);
    if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0 || chainId > 2_147_483_647) {
      throw new BridgeError("INVALID_CHAIN", "Informe um chainId inteiro e positivo.");
    }
    if (this.statement(`SELECT id FROM transfers WHERE account_id = ? AND status IN ${OPEN_STATUSES} LIMIT 1`).get(accountId)) {
      throw new BridgeError("PENDING_TRANSACTION", "Aguarde a operação em andamento antes de mudar a rede simulada.", 409);
    }
    this.statement("UPDATE accounts SET connected_chain = ? WHERE id = ?").run(BigInt(chainId), accountId);
    return this.state(accountId);
  }

  reset(accountId: string): BridgeState {
    return this.atomic(() => {
      this.account(accountId);
      this.statement("DELETE FROM transfers WHERE account_id = ?").run(accountId);
      this.statement(`UPDATE accounts SET wallet_address = NULL, owner_address = NULL, connected_chain = 11155111,
        custodial_cents = ?, wallet_cents = 0, custodial_reserved = 0, wallet_reserved = 0,
        custodial_remainder = 0, wallet_remainder = 0, initial_micros = ? WHERE id = ?`)
        .run(INITIAL_CENTS, INITIAL_CENTS * MICROS_PER_CENT, accountId);
      return this.state(accountId);
    });
  }

  close(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    this.closed = true;
    this.changes.removeAllListeners();
    this.db.close();
  }

  private operation(row: Row, ownerAddress: string | null = null): PersistedOperation {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      direction: row.direction as Direction,
      status: row.status as TransactionStatus,
      amountCents: BigInt(row.amount_cents!),
      amountUnits: row.amount_units === null || row.amount_units === undefined ? null : BigInt(row.amount_units),
      outcome: row.outcome as SimulationOutcome,
      walletAddress: (row.wallet_address ?? null) as string | null,
      ownerAddress,
      fromAddress: (row.from_address ?? null) as string | null,
      toAddress: (row.to_address ?? null) as string | null,
      txHash: (row.tx_hash ?? null) as string | null,
      userOpHash: (row.user_op_hash ?? null) as string | null,
      createdAt: Number(row.created_at),
      submittedAt: row.submitted_at === null || row.submitted_at === undefined ? null : Number(row.submitted_at),
    };
  }

  private rowToTransaction(row: Row, ownerAddress: string | null): Transaction {
    const amountCents = BigInt(row.amount_cents!);
    const operation = this.operation(row, ownerAddress);
    const txHash = operation.txHash;
    return {
      id: operation.id,
      direction: operation.direction,
      amount: formatCents(amountCents),
      amountMicros: (amountCents * MICROS_PER_CENT).toString(),
      status: operation.status,
      simulationOutcome: operation.outcome,
      simulationId: String(row.simulation_id),
      hash: txHash ?? (row.hash as string | null),
      txHash,
      explorerUrl: txHash ? `https://sepolia.etherscan.io/tx/${txHash}` : null,
      userOpHash: operation.userOpHash,
      fromAddress: operation.fromAddress,
      toAddress: operation.toAddress,
      amountUnits: operation.amountUnits === null ? null : operation.amountUnits.toString(),
      signatureRequest: operation.status === "awaiting_user_signature" ? this.provider.signatureRequest(operation) : null,
      failureReason: row.failure_reason as string | null,
      createdAt: new Date(Number(row.created_at)).toISOString(),
      settlesAt: new Date(Number(row.settles_at)).toISOString(),
      submittedAt: operation.submittedAt === null ? null : new Date(operation.submittedAt).toISOString(),
      settledAt: row.settled_at === null ? null : new Date(Number(row.settled_at)).toISOString(),
      idempotencyKey: String(row.idempotency_key),
    };
  }
}

export function anonymousState(mode: ProviderMode = "simulated", privyAppId: string | null = null): BridgeState {
  return {
    mode,
    privyAppId: mode === "privy" ? privyAppId : null,
    network: { name: "Sepolia", chainId: SEPOLIA_CHAIN_ID, connectedChainId: SEPOLIA_CHAIN_ID },
    user: null,
    wallet: { active: false, address: null, ownerAddress: null, simulated: mode === "simulated", smartAccount: null },
    balances: { custodialAvailable: "0.00", custodialReserved: "0.00", walletAvailable: "0.00", walletReserved: "0.00", walletRemainderMicros: "0", custodialRemainderMicros: "0", total: "0.00" },
    transactions: [],
    reconciliation: { balanced: true, initialMicros: "0", currentMicros: "0", differenceMicros: "0" },
  };
}

/** Operação com evidência on-chain registrada (tx da tesouraria ou UserOperation); linhas simuladas não têm. */
function submittedOnChain(row: Row): boolean {
  return row.submitted_at !== null && row.submitted_at !== undefined;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value || !/^\d{1,12}$/.test(value.trim())) return fallback;
  const parsed = Number(value.trim());
  return parsed > 0 ? parsed : fallback;
}

/** Lê os parâmetros de reconciliação do ambiente (valores inválidos caem no padrão). */
export function ledgerOptionsFromEnv(mode: ProviderMode, env: NodeJS.ProcessEnv = process.env): LedgerOptions {
  return {
    privyAppId: mode === "privy" ? env.PRIVY_APP_ID?.trim() || null : null,
    observationTimeoutMs: positiveInt(env.POC_OBSERVATION_TIMEOUT_MS, DEFAULT_OBSERVATION_TIMEOUT_MS),
    signatureTimeoutMs: positiveInt(env.POC_SIGNATURE_TIMEOUT_MS, DEFAULT_SIGNATURE_TIMEOUT_MS),
  };
}

const globalLedger = globalThis as typeof globalThis & { mbBridgeLedger?: Ledger };

/**
 * Bootstrap: usa o provider configurado em WALLET_PROVIDER. No modo privy, o módulo
 * privy-wallet-provider.ts precisa ter sido importado antes (route.ts faz isso).
 */
export function getLedger(): Ledger {
  // shortcut: uma instância por processo; usar PostgreSQL antes de executar em múltiplas réplicas.
  if (!globalLedger.mbBridgeLedger) {
    const provider = getWalletProvider();
    const defaultPath = provider.mode === "privy" ? "data/bridge-sepolia.sqlite" : "data/bridge.sqlite";
    const ledger = new Ledger(process.env.MB_DATABASE_PATH?.trim() || resolve(defaultPath), provider, ledgerOptionsFromEnv(provider.mode));
    if (provider.mode === "privy") ledger.startReconciler(positiveInt(process.env.POC_RECONCILE_INTERVAL_MS, 5_000));
    globalLedger.mbBridgeLedger = ledger;
  }
  return globalLedger.mbBridgeLedger;
}
