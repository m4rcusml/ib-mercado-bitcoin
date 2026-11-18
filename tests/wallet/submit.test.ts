import { test, vi, onTestFinished } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, parseAbi } from "viem";
import { encodeTransferCall, ENTRY_POINT_V06, mockUsdcAbi, parseSignedUserOperation } from "../../src/lib/chain/index.ts";
import type { ExpectedTransfer, UserOperationReceiptLike, VerificationResult } from "../../src/lib/chain/index.ts";
import { Ledger } from "../../src/lib/domain/ledger.ts";
import { BridgeError } from "../../src/lib/domain/money.ts";
import { PrivyWalletProvider, resolveLinkedSmartAccount } from "../../src/lib/wallet/privy-wallet-provider.ts";
import type { PrivyAuthClient } from "../../src/lib/wallet/privy-wallet-provider.ts";
import type { PersistedOperation } from "../../src/lib/wallet/wallet-provider.ts";

type Hex = `0x${string}`;
const TOKEN = getAddress(`0x${"1".repeat(40)}`);
const TREASURY = getAddress(`0x${"7".repeat(40)}`);
/** Coinbase Smart Account (endereço operacional) e sua EOA embedded dona. */
const USER = getAddress(`0x${"ab".repeat(20)}`);
const OWNER = getAddress(`0x${"0c".repeat(20)}`);
const OTHER_USER = getAddress(`0x${"ef".repeat(20)}`);
const OTHER_OWNER = getAddress(`0x${"0d".repeat(20)}`);
const MINUTE = 60_000;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
/** userOpHash informado pelo browser e hash da transação do bundle que o incluiu. */
const USER_OP = hash(0xbeef);
const BUNDLE_TX = hash(0xb0b);

type Verdict = VerificationResult | "throw";
type UserOpVerdict = UserOperationReceiptLike | "throw";

function transferLog(from: Hex, to: Hex, value: bigint, address: Hex = TOKEN) {
  return {
    address,
    topics: encodeEventTopics({ abi: mockUsdcAbi, eventName: "Transfer", args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  };
}

/** Rede falsa: tesouraria devolve hashes sequenciais; verificador e bundler respondem por hash. */
function fakeChain() {
  let counter = 0;
  const verdicts = new Map<string, Verdict>();
  const userOps = new Map<string, UserOpVerdict>();
  const prepareTransfer = vi.fn(async (_to: Hex, _units: bigint) => ({ txHash: hash(++counter), signedPayload: undefined as Hex | undefined }));
  const verify = vi.fn(async (_client: unknown, expected: ExpectedTransfer): Promise<VerificationResult> => {
    const verdict = verdicts.get(expected.txHash) ?? { status: "pending" };
    if (verdict === "throw") throw new Error("HTTP request failed. URL: https://eth-sepolia.g.alchemy.com/v2/SECRET-KEY");
    return verdict;
  });
  const getUserOperationReceipt = vi.fn(async (userOpHash: Hex): Promise<UserOperationReceiptLike | null> => {
    const verdict = userOps.get(userOpHash.toLowerCase());
    if (verdict === "throw") throw new Error("HTTP request failed. URL: https://api.pimlico.io/v2/sepolia/rpc?apikey=SECRET-PIMLICO");
    return verdict ?? null;
  });
  const broadcast = vi.fn<(operation: PersistedOperation, payload: string) => Promise<void>>().mockResolvedValue(undefined);
  const provider = () => new PrivyWalletProvider({
    token: TOKEN,
    treasury: { address: TREASURY, prepareTransfer },
    publicClient: {} as never,
    userOperations: { getUserOperationReceipt },
    broadcast,
    verify,
  });
  const set = (txHash: string, verdict: Verdict) => verdicts.set(txHash.toLowerCase(), verdict);
  const confirm = (txHash: string) => set(txHash, { status: "confirmed", blockNumber: 1n });
  /** O bundler passa a devolver o receipt da UserOperation (por padrão: sucesso, Transfer exato da smart account). */
  const includeUserOp = (userOpHash: Hex, units: bigint, overrides: Partial<UserOperationReceiptLike> & { txHash?: Hex } = {}) => {
    const { txHash = BUNDLE_TX, ...rest } = overrides;
    userOps.set(userOpHash.toLowerCase(), {
      userOpHash,
      sender: USER,
      entryPoint: ENTRY_POINT_V06,
      success: true,
      logs: [transferLog(USER, TREASURY, units)],
      receipt: { transactionHash: txHash, blockNumber: 10n },
      ...rest,
    });
  };
  const setUserOp = (userOpHash: Hex, verdict: UserOpVerdict) => userOps.set(userOpHash.toLowerCase(), verdict);
  return { prepareTransfer, broadcast, verify, getUserOperationReceipt, provider, set, confirm, includeUserOp, setUserOp };
}

function login(ledger: Ledger, email: string, wallet: string | null = USER, owner: string = OWNER) {
  ledger.requestCode(email, 1_000);
  const { token } = ledger.login(email, "123456", 1_000);
  const accountId = ledger.accountForSession(token, 1_000)!;
  if (wallet) ledger.linkWallet(accountId, wallet, owner);
  return accountId;
}

function fixture(options: { path?: string; observationTimeoutMs?: number; signatureTimeoutMs?: number } = {}) {
  const chain = fakeChain();
  const ledger = new Ledger(options.path ?? ":memory:", chain.provider(), { privyAppId: "app-public-id", ...options });
  onTestFinished(() => { try { ledger.close(); } catch { /* já fechado */ } });
  const accountId = login(ledger, "equipe@example.com");
  return { ledger, accountId, chain };
}

const code = (expected: string) => (e: unknown) => e instanceof BridgeError && e.code === expected;

/** Leva a wallet lógica a ter saldo via mb_to_wallet confirmado. */
async function seedWallet(ledger: Ledger, accountId: string, chain: ReturnType<typeof fakeChain>, amount = "100") {
  const state = await ledger.transfer(accountId, { direction: "mb_to_wallet", amount }, `seed-${amount}-0001`, 2_000);
  chain.confirm(state.transactions[0].txHash!);
  await ledger.advance(accountId, 3_000);
}

test("estado no modo privy expõe mode, privyAppId e wallet não simulada", () => {
  const { ledger, accountId } = fixture();
  const state = ledger.state(accountId);
  assert.equal(state.mode, "privy");
  assert.equal(state.privyAppId, "app-public-id");
  assert.deepEqual(state.wallet, { active: true, address: USER, ownerAddress: OWNER, simulated: false, smartAccount: { type: "coinbase", entryPoint: "0.6" } });
  assert.equal(ledger.state(null).mode, "privy");
  assert.equal(ledger.state(null).privyAppId, "app-public-id");
});

test("modo privy recusa outcome e ativação simulada", async () => {
  const { ledger, accountId } = fixture();
  await assert.rejects(() => ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "1", outcome: "confirmed" }, "outcome-0001", 2_000), code("SIMULATION_DISABLED"));
  await assert.rejects(() => ledger.activateWallet(accountId), code("WALLET_LINK_REQUIRED"));
  const unlinked = login(ledger, "sem-wallet@example.com", null);
  await assert.rejects(() => ledger.transfer(unlinked, { direction: "mb_to_wallet", amount: "1" }, "nowallet-0001", 2_000), code("WALLET_INACTIVE"));
});

test("vínculo antigo somente com EOA (sem owner_address) aparece inativo e não transfere", async () => {
  const { ledger } = fixture();
  const legacy = login(ledger, "legado@example.com", null);
  ledger.db.prepare("UPDATE accounts SET wallet_address = ? WHERE id = ?").run(OTHER_OWNER, legacy);
  assert.deepEqual(ledger.state(legacy).wallet, { active: false, address: null, ownerAddress: null, simulated: false, smartAccount: null });
  assert.equal(ledger.linkedSmartAccount(legacy), null);
  await assert.rejects(() => ledger.transfer(legacy, { direction: "mb_to_wallet", amount: "1" }, "legacy-0001", 2_000), code("WALLET_INACTIVE"));
  // Revincular grava a smart account e a EOA dona.
  const relinked = ledger.linkWallet(legacy, OTHER_USER, OTHER_OWNER);
  assert.equal(relinked.wallet.address, OTHER_USER);
  assert.equal(relinked.wallet.ownerAddress, OTHER_OWNER);
});

test("mb_to_wallet: tesouraria envia, fica submitted e só credita após verificação", async () => {
  const { ledger, accountId, chain } = fixture();
  let state = await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "12.50" }, "send-0001", 2_000);
  const tx = state.transactions[0];
  assert.deepEqual(chain.prepareTransfer.mock.calls, [[USER, 12_500_000n]]);
  assert.equal(tx.status, "submitted");
  assert.equal(tx.txHash, hash(1));
  assert.equal(tx.hash, hash(1));
  assert.equal(tx.explorerUrl, `https://sepolia.etherscan.io/tx/${hash(1)}`);
  assert.equal(tx.fromAddress, TREASURY);
  assert.equal(tx.toAddress, USER);
  assert.equal(tx.amountUnits, "12500000");
  assert.equal(tx.signatureRequest, null);
  assert.equal(tx.submittedAt, new Date(2_000).toISOString());
  assert.equal(state.balances.custodialReserved, "12.50");
  assert.equal(state.balances.walletAvailable, "0.00");

  state = await ledger.advance(accountId, 2_500);
  assert.equal(state.transactions[0].status, "submitted", "pending mantém submitted");
  assert.equal(state.balances.custodialReserved, "12.50");

  chain.confirm(hash(1));
  state = await ledger.advance(accountId, 6_000);
  assert.equal(state.transactions[0].status, "confirmed");
  assert.equal(state.balances.custodialReserved, "0.00");
  assert.equal(state.balances.walletAvailable, "12.50");
  assert.equal(state.reconciliation.balanced, true);
  const expected = chain.verify.mock.calls.at(-1)![1];
  assert.deepEqual(expected, { txHash: hash(1), token: TOKEN, from: TREASURY, to: USER, units: 12_500_000n, chainId: 11155111 });

  const calls = chain.verify.mock.calls.length;
  assert.deepEqual((await ledger.advance(accountId, 60_000)).balances, state.balances);
  assert.equal(chain.verify.mock.calls.length, calls, "operação final não é observada de novo");
  const replay = await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "12.50" }, "send-0001", 70_000);
  assert.equal(chain.prepareTransfer.mock.calls.length, 1, "replay idempotente não reenvia");
  assert.equal(replay.transactions.length, 1);
});

test("wallet_to_mb: awaiting_user_signature -> userOpHash -> receipt do bundler -> confirmação verificada", async () => {
  const { ledger, accountId, chain } = fixture();
  await seedWallet(ledger, accountId, chain);
  let state = await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "40" }, "return-0001", 4_000);
  const tx = state.transactions[0];
  assert.equal(tx.status, "awaiting_user_signature");
  assert.deepEqual(tx.signatureRequest, {
    chainId: 11155111, token: TOKEN, to: TREASURY, amountUnits: "40000000", smartAccount: USER, ownerAddress: OWNER, entryPoint: "0.6",
  });
  assert.equal(tx.txHash, null);
  assert.equal(tx.userOpHash, null);
  assert.equal(tx.explorerUrl, null);
  assert.equal(tx.fromAddress, USER, "origem é a smart account");
  assert.equal(tx.toAddress, TREASURY);
  assert.equal(state.balances.walletReserved, "40.00");
  assert.equal(state.balances.walletAvailable, "60.00");
  assert.equal(chain.prepareTransfer.mock.calls.length, 1, "somente o seed usou a tesouraria");

  await ledger.advance(accountId, 5_000);
  assert.equal(chain.getUserOperationReceipt.mock.calls.length, 0, "sem userOpHash não há observação");

  state = ledger.submitUserOperation(accountId, tx.id, USER_OP.toUpperCase().replace("0X", "0x"), 6_000);
  let current = state.transactions[0];
  assert.equal(current.status, "submitted");
  assert.equal(current.userOpHash, USER_OP);
  assert.equal(current.txHash, null, "tx do bundle só é conhecida após o receipt");
  assert.equal(current.explorerUrl, null);
  assert.equal(current.signatureRequest, null);
  assert.equal(state.balances.walletReserved, "40.00", "hash do cliente não liquida");

  const verifyCalls = chain.verify.mock.calls.length;
  state = await ledger.advance(accountId, 6_500);
  assert.equal(state.transactions[0].status, "submitted", "receipt ausente = pending");
  assert.deepEqual(chain.getUserOperationReceipt.mock.calls.at(-1), [USER_OP]);
  assert.equal(chain.verify.mock.calls.length, verifyCalls);

  chain.includeUserOp(USER_OP, 40_000_000n);
  state = await ledger.advance(accountId, 10_000);
  current = state.transactions[0];
  assert.equal(current.status, "submitted", "verificação RPC ainda pendente");
  assert.equal(current.txHash, BUNDLE_TX, "hash do bundle é persistido");
  assert.equal(current.explorerUrl, `https://sepolia.etherscan.io/tx/${BUNDLE_TX}`);

  chain.confirm(BUNDLE_TX);
  state = await ledger.advance(accountId, 14_000);
  current = state.transactions[0];
  assert.equal(current.status, "confirmed");
  assert.equal(current.userOpHash, USER_OP);
  assert.equal(current.txHash, BUNDLE_TX);
  assert.equal(state.balances.walletReserved, "0.00");
  assert.equal(state.balances.custodialAvailable, "9940.00");
  assert.equal(state.reconciliation.balanced, true);
  assert.deepEqual(chain.verify.mock.calls.at(-1)![1], { txHash: BUNDLE_TX, token: TOKEN, from: USER, to: TREASURY, units: 40_000_000n, chainId: 11155111 });
});

test("wallet_to_mb: UserOperation revertida, sender errado e Transfer fora da UserOperation estornam", async () => {
  const { ledger, accountId, chain } = fixture();
  await seedWallet(ledger, accountId, chain);
  const reverted = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "1" }, "uo-revert-0001", 4_000)).transactions[0];
  const stranger = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "2" }, "uo-sender-0001", 4_000)).transactions[0];
  const unscoped = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "3" }, "uo-scope-0001", 4_000)).transactions[0];
  const wrongEntryPoint = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "4" }, "uo-ep-0001", 4_000)).transactions[0];
  ledger.submitUserOperation(accountId, reverted.id, hash(0xa1), 4_100);
  ledger.submitUserOperation(accountId, stranger.id, hash(0xa2), 4_100);
  ledger.submitUserOperation(accountId, unscoped.id, hash(0xa3), 4_100);
  ledger.submitUserOperation(accountId, wrongEntryPoint.id, hash(0xa4), 4_100);
  chain.includeUserOp(hash(0xa1), 1_000_000n, { success: false, txHash: hash(0xb1) });
  chain.includeUserOp(hash(0xa2), 2_000_000n, { sender: OTHER_USER, txHash: hash(0xb2) });
  // O bundle contém o Transfer (de outra UserOperation do mesmo sender), mas esta UserOperation não o emitiu.
  chain.includeUserOp(hash(0xa3), 3_000_000n, { logs: [], txHash: hash(0xb3) });
  chain.includeUserOp(hash(0xa4), 4_000_000n, { entryPoint: getAddress(`0x${"5".repeat(40)}`), txHash: hash(0xb4) });
  for (const txHash of [hash(0xb1), hash(0xb2), hash(0xb3), hash(0xb4)]) chain.confirm(txHash);

  const state = await ledger.advance(accountId, 5_000);
  const byId = new Map(state.transactions.map((tx) => [tx.id, tx]));
  assert.equal(byId.get(reverted.id)!.status, "failed");
  assert.equal(byId.get(reverted.id)!.failureReason, "UserOperation revertida no EntryPoint.");
  assert.equal(byId.get(reverted.id)!.txHash, hash(0xb1), "hash do bundle é registrado mesmo em falha");
  assert.equal(byId.get(stranger.id)!.status, "failed");
  assert.match(byId.get(stranger.id)!.failureReason!, /sender não é a smart account/);
  assert.equal(byId.get(unscoped.id)!.status, "failed");
  assert.match(byId.get(unscoped.id)!.failureReason!, /não emitiu o Transfer esperado/);
  assert.equal(byId.get(wrongEntryPoint.id)!.status, "failed");
  assert.match(byId.get(wrongEntryPoint.id)!.failureReason!, /EntryPoint inesperado/);
  const verifiedHashes = chain.verify.mock.calls.map((call) => call[1].txHash);
  for (const txHash of [hash(0xb1), hash(0xb2), hash(0xb3), hash(0xb4)]) assert.ok(!verifiedHashes.includes(txHash), "sem verificação RPC após rejeição");
  assert.equal(state.balances.walletAvailable, "100.00");
  assert.equal(state.balances.walletReserved, "0.00");
  assert.equal(state.reconciliation.balanced, true);
});

test("wallet_to_mb: erro do bundler vira unknown sem vazar a chave e confirma depois", async () => {
  const { ledger, accountId, chain } = fixture();
  await seedWallet(ledger, accountId, chain);
  const tx = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "5" }, "uo-rpc-0001", 4_000)).transactions[0];
  ledger.submitUserOperation(accountId, tx.id, USER_OP, 4_100);
  chain.setUserOp(USER_OP, "throw");
  let state = await ledger.advance(accountId, 4_200);
  assert.equal(state.transactions[0].status, "unknown");
  assert.equal(state.balances.walletReserved, "5.00");
  assert.doesNotMatch(state.transactions[0].failureReason!, /pimlico|SECRET-PIMLICO|apikey/);

  chain.includeUserOp(USER_OP, 5_000_000n);
  chain.confirm(BUNDLE_TX);
  state = await ledger.advance(accountId, 9_000);
  assert.equal(state.transactions[0].status, "confirmed");
  assert.equal(state.balances.custodialAvailable, "9905.00");
  assert.equal(state.reconciliation.balanced, true);
});

test("duas UserOperations no mesmo bundle: tx_hash compartilhado não viola unicidade", async () => {
  const { ledger, accountId, chain } = fixture();
  await seedWallet(ledger, accountId, chain);
  const a = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "1" }, "bundle-a-0001", 4_000)).transactions[0];
  const b = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "2" }, "bundle-b-0001", 4_000)).transactions[0];
  ledger.submitUserOperation(accountId, a.id, hash(0xc1), 4_100);
  ledger.submitUserOperation(accountId, b.id, hash(0xc2), 4_100);
  chain.includeUserOp(hash(0xc1), 1_000_000n);
  chain.includeUserOp(hash(0xc2), 2_000_000n);
  chain.confirm(BUNDLE_TX);
  const state = await ledger.advance(accountId, 5_000);
  assert.deepEqual(state.transactions.filter((tx) => tx.direction === "wallet_to_mb").map((tx) => [tx.status, tx.txHash]), [["confirmed", BUNDLE_TX], ["confirmed", BUNDLE_TX]]);
  assert.equal(state.balances.custodialAvailable, "9903.00");
  assert.equal(state.reconciliation.balanced, true);
});

test("submission recusa conta errada, status errado, formato inválido e hash duplicado", async () => {
  const { ledger, accountId, chain } = fixture();
  await seedWallet(ledger, accountId, chain);
  const outbound = (await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "1" }, "out-0001", 4_000)).transactions[0];
  const first = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "1" }, "ret-0001", 4_000)).transactions[0];
  const second = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "2" }, "ret-0002", 4_000)).transactions[0];
  const intruder = login(ledger, "intruso@example.com", OTHER_USER, OTHER_OWNER);

  assert.throws(() => ledger.submitUserOperation(intruder, first.id, USER_OP, 5_000), code("TRANSFER_NOT_FOUND"));
  assert.throws(() => ledger.submitUserOperation(accountId, "missing", USER_OP, 5_000), code("TRANSFER_NOT_FOUND"));
  assert.throws(() => ledger.submitUserOperation(accountId, outbound.id, USER_OP, 5_000), code("INVALID_TRANSFER_STATUS"));
  for (const invalid of ["0x123", `0x${"g".repeat(64)}`, `${"a".repeat(66)}`, 42, null, undefined]) {
    assert.throws(() => ledger.submitUserOperation(accountId, first.id, invalid, 5_000), code("INVALID_USER_OP_HASH"));
  }
  // O hash da tesouraria não pode ser reaproveitado como devolução do usuário.
  assert.throws(() => ledger.submitUserOperation(accountId, first.id, outbound.txHash, 5_000), code("DUPLICATE_USER_OP_HASH"));

  ledger.submitUserOperation(accountId, first.id, USER_OP, 5_000);
  const replay = ledger.submitUserOperation(accountId, first.id, USER_OP, 5_100);
  assert.equal(replay.transactions.find((tx) => tx.id === first.id)!.status, "submitted", "mesmo hash é idempotente");
  assert.throws(() => ledger.submitUserOperation(accountId, second.id, USER_OP, 5_000), code("DUPLICATE_USER_OP_HASH"));
  assert.throws(() => ledger.submitUserOperation(accountId, first.id, hash(0xfeed), 5_000), code("INVALID_TRANSFER_STATUS"));
  const unique = ledger.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'transfers_user_op_hash_unique'").get() as { sql: string };
  assert.match(unique.sql, /UNIQUE INDEX[\s\S]*user_op_hash IS NOT NULL/);
  assert.equal(ledger.state(accountId).reconciliation.balanced, true);
});

test("verificação failed estorna exatamente a reserva nos dois sentidos", async () => {
  const { ledger, accountId, chain } = fixture();
  await seedWallet(ledger, accountId, chain);
  const out = (await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "5" }, "fail-out-0001", 4_000)).transactions[0];
  const back = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "7" }, "fail-back-0001", 4_000)).transactions[0];
  ledger.submitUserOperation(accountId, back.id, USER_OP, 4_500);
  chain.set(out.txHash!, { status: "failed", reason: "Transação revertida na rede." });
  chain.includeUserOp(USER_OP, 7_000_000n);
  chain.set(BUNDLE_TX, { status: "failed", reason: "Evento Transfer do token não corresponde à origem, ao destino ou ao valor esperados." });
  const state = await ledger.advance(accountId, 5_000);
  const byId = new Map(state.transactions.map((tx) => [tx.id, tx]));
  assert.equal(byId.get(out.id)!.status, "failed");
  assert.equal(byId.get(out.id)!.failureReason, "Transação revertida na rede.");
  assert.equal(byId.get(back.id)!.status, "failed");
  assert.equal(state.balances.custodialAvailable, "9900.00");
  assert.equal(state.balances.walletAvailable, "100.00");
  assert.equal(state.balances.custodialReserved, "0.00");
  assert.equal(state.balances.walletReserved, "0.00");
  assert.equal(state.reconciliation.balanced, true);
});

test("erro de RPC vira unknown sem liberar reserva e confirma depois sem crédito duplicado", async () => {
  const { ledger, accountId, chain } = fixture();
  const tx = (await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "3" }, "rpc-0001", 2_000)).transactions[0];
  chain.set(tx.txHash!, "throw");
  let state = await ledger.advance(accountId, 2_000);
  assert.equal(state.transactions[0].status, "unknown");
  assert.equal(state.balances.custodialReserved, "3.00");
  assert.match(state.transactions[0].failureReason!, /^Observação pendente: HTTP request failed/);
  assert.doesNotMatch(state.transactions[0].failureReason!, /alchemy|SECRET-KEY/, "URL do RPC não vaza");

  const calls = chain.verify.mock.calls.length;
  await ledger.advance(accountId, 3_000);
  assert.equal(chain.verify.mock.calls.length, calls, "backoff entre consultas");

  chain.set(tx.txHash!, { status: "pending" });
  state = await ledger.advance(accountId, 5_100);
  assert.equal(state.transactions[0].status, "submitted", "pending após unknown volta a submitted");
  assert.equal(state.transactions[0].failureReason, null);

  chain.confirm(tx.txHash!);
  state = await ledger.advance(accountId, 9_000);
  assert.equal(state.transactions[0].status, "confirmed");
  state = await ledger.advance(accountId, 20_000);
  assert.equal(state.balances.walletAvailable, "3.00");
  assert.equal(state.balances.custodialAvailable, "9997.00");
  assert.equal(state.reconciliation.balanced, true);
});

test("observações concorrentes da mesma operação não duplicam verificação nem crédito", async () => {
  const { ledger, accountId, chain } = fixture();
  const tx = (await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "8" }, "race-0001", 2_000)).transactions[0];
  chain.confirm(tx.txHash!);
  await Promise.all([ledger.advance(accountId, 3_000), ledger.advance(accountId, 3_000), ledger.reconcileAll(3_000)]);
  assert.equal(chain.verify.mock.calls.length, 1);
  const state = ledger.state(accountId);
  assert.equal(state.balances.walletAvailable, "8.00");
  assert.equal(state.reconciliation.balanced, true);
});

test("assinatura não recebida estorna, mas ausência de receipt mantém a reserva", async () => {
  const { ledger, accountId, chain } = fixture({ observationTimeoutMs: 15 * MINUTE, signatureTimeoutMs: 10 * MINUTE });
  await seedWallet(ledger, accountId, chain);
  const out = (await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "5" }, "exp-out-0001", 10_000)).transactions[0];
  const back = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "6" }, "exp-back-0001", 10_000)).transactions[0];

  let state = await ledger.advance(accountId, 10_000 + 10 * MINUTE - 1);
  assert.equal(state.transactions.find((tx) => tx.id === back.id)!.status, "awaiting_user_signature");
  state = await ledger.advance(accountId, 10_000 + 10 * MINUTE);
  const expiredBack = state.transactions.find((tx) => tx.id === back.id)!;
  assert.equal(expiredBack.status, "failed");
  assert.match(expiredBack.failureReason!, /Assinatura não recebida em 10 minutos/);
  assert.throws(() => ledger.submitUserOperation(accountId, back.id, USER_OP, 10_000 + 11 * MINUTE), code("INVALID_TRANSFER_STATUS"));
  assert.equal(state.transactions.find((tx) => tx.id === out.id)!.status, "submitted");

  chain.set(out.txHash!, "throw");
  state = await ledger.advance(accountId, 10_000 + 15 * MINUTE);
  const expiredOut = state.transactions.find((tx) => tx.id === out.id)!;
  assert.equal(expiredOut.status, "unknown");
  assert.match(expiredOut.failureReason!, /Sem confirmação após 15 minutos/);
  assert.equal(state.balances.custodialAvailable, "9895.00");
  assert.equal(state.balances.walletAvailable, "100.00");
  assert.equal(state.balances.custodialReserved, "5.00");
  assert.equal(state.balances.walletReserved, "0.00");
  assert.equal(state.reconciliation.balanced, true);
});

test("receipt confirmado no limite da expiração confirma em vez de estornar", async () => {
  const { ledger, accountId, chain } = fixture({ observationTimeoutMs: MINUTE });
  const tx = (await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "2" }, "late-0001", 2_000)).transactions[0];
  chain.confirm(tx.txHash!);
  const state = await ledger.advance(accountId, 2_000 + 5 * MINUTE);
  assert.equal(state.transactions[0].status, "confirmed");
  assert.equal(state.balances.walletAvailable, "2.00");
});

test("falha da tesouraria antes do hash estorna sem vazar a URL do RPC", async () => {
  const { ledger, accountId, chain } = fixture();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  chain.prepareTransfer.mockRejectedValueOnce(Object.assign(new Error("long message https://eth-sepolia.g.alchemy.com/v2/SECRET-KEY"), { shortMessage: "insufficient funds for gas" }));
  const state = await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "4" }, "gas-0001", 2_000);
  assert.equal(state.transactions[0].status, "failed");
  assert.equal(state.transactions[0].failureReason, "insufficient funds for gas");
  assert.equal(state.balances.custodialAvailable, "10000.00");
  assert.equal(state.balances.custodialReserved, "0.00");
  assert.doesNotMatch(JSON.stringify(log.mock.calls), /SECRET-KEY/);
});

test("reinício entre submitted e confirmação retoma a operação sem duplicidade", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-bridge-privy-restart-"));
  const path = join(dir, "ledger.sqlite");
  let ledger: Ledger | null = null;
  try {
    const first = fixture({ path });
    await seedWallet(first.ledger, first.accountId, first.chain);
    const out = (await first.ledger.transfer(first.accountId, { direction: "mb_to_wallet", amount: "9" }, "restart-out-0001", 4_000)).transactions[0];
    const back = (await first.ledger.transfer(first.accountId, { direction: "wallet_to_mb", amount: "11" }, "restart-back-0001", 4_000)).transactions[0];
    first.ledger.submitUserOperation(first.accountId, back.id, USER_OP, 4_100);
    first.ledger.close();

    const chain = fakeChain();
    chain.confirm(out.txHash!);
    chain.includeUserOp(USER_OP, 11_000_000n);
    chain.confirm(BUNDLE_TX);
    ledger = new Ledger(path, chain.provider());
    assert.equal(ledger.state(first.accountId).balances.custodialReserved, "9.00");
    assert.equal(await ledger.reconcileAll(5_000), 2);
    assert.equal(chain.prepareTransfer.mock.calls.length, 0, "não reenvia após reinício");
    await ledger.reconcileAll(60_000);
    const replay = await ledger.transfer(first.accountId, { direction: "mb_to_wallet", amount: "9" }, "restart-out-0001", 70_000);
    assert.equal(chain.prepareTransfer.mock.calls.length, 0);
    assert.equal(replay.transactions.filter((tx) => tx.status === "confirmed").length, 3);
    assert.equal(replay.balances.walletAvailable, "98.00");
    assert.equal(replay.balances.custodialAvailable, "9902.00");
    assert.equal(replay.reconciliation.balanced, true);
    assert.equal(chain.verify.mock.calls.length, 2);
  } finally {
    ledger?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tesouraria persiste antes do envio, retenta a mesma transação após reinício e aguarda recibo tardio", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-bridge-durable-send-"));
  const path = join(dir, "ledger.sqlite");
  const first = fixture({ path, observationTimeoutMs: MINUTE });
  const txHash = hash(123);
  const signedPayload = "0x1234";
  first.chain.prepareTransfer.mockResolvedValueOnce({ txHash, signedPayload });
  const queued = await first.ledger.transfer(first.accountId, { direction: "mb_to_wallet", amount: "5" }, "durable-out-0001", 2_000);
  assert.equal(queued.transactions[0].txHash, txHash);
  assert.equal(first.chain.broadcast.mock.calls.length, 0);
  first.chain.broadcast.mockRejectedValueOnce(new Error("RPC sem resposta"));
  await first.ledger.reconcileAll(2_000);
  assert.equal(first.ledger.state(first.accountId).transactions[0].status, "unknown");
  first.ledger.close();
  try {
    assert.throws(() => new Ledger(path), code("LEDGER_MODE_MISMATCH"));
    const next = fakeChain();
    const ledger = new Ledger(path, next.provider(), { observationTimeoutMs: MINUTE });
    try {
      await ledger.reconcileAll(2_000 + MINUTE);
      assert.equal(next.broadcast.mock.calls[0][0].txHash, txHash);
      assert.equal(next.broadcast.mock.calls[0][1], signedPayload);
      assert.equal(ledger.state(first.accountId).balances.custodialReserved, "5.00");
      next.confirm(txHash);
      await ledger.reconcileAll(2_000 + 2 * MINUTE);
      assert.equal(ledger.state(first.accountId).balances.walletAvailable, "5.00");
      assert.equal(next.prepareTransfer.mock.calls.length, 0);
      assert.equal(next.broadcast.mock.calls.length, 1);
    } finally { ledger.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("UserOperation assinada é registrada antes do broadcast e observada sem retorno do navegador", async () => {
  const { ledger, accountId, chain } = fixture({ signatureTimeoutMs: MINUTE });
  await seedWallet(ledger, accountId, chain);
  const back = (await ledger.transfer(accountId, { direction: "wallet_to_mb", amount: "6" }, "durable-back-0001", 4_000)).transactions[0];
  const abi = parseAbi(["function execute(address target, uint256 value, bytes data)"]);
  const raw = {
    sender: USER, nonce: "0x0", initCode: "0x", signature: "0xaabb", paymasterAndData: "0x",
    callGasLimit: "0x1", verificationGasLimit: "0x1", preVerificationGas: "0x1", maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x1",
    callData: encodeFunctionData({ abi, functionName: "execute", args: [TOKEN, 0n, encodeTransferCall(TREASURY, 6_000_000n)] }),
  };
  assert.throws(() => parseSignedUserOperation({ ...raw, callData: "0x" }, back.signatureRequest), code("INVALID_USER_OPERATION"));
  const signed = parseSignedUserOperation(raw, back.signatureRequest);
  assert.throws(() => ledger.submitUserOperation(accountId, back.id, signed.hash, 4_000 + MINUTE, signed.payload), code("SIGNATURE_EXPIRED"));
  assert.throws(() => ledger.submitUserOperation(accountId, back.id, signed.hash, 4_100, undefined, true), code("SIGNED_USER_OPERATION_REQUIRED"));
  ledger.submitUserOperation(accountId, back.id, signed.hash, 4_100, signed.payload);
  assert.equal(chain.broadcast.mock.calls.length, 0);
  await ledger.reconcileAll(4_000 + MINUTE);
  assert.equal(chain.broadcast.mock.calls[0][0].userOpHash, signed.hash);
  assert.equal(chain.broadcast.mock.calls[0][1], signed.payload);
  chain.includeUserOp(signed.hash, 6_000_000n);
  chain.confirm(BUNDLE_TX);
  await ledger.reconcileAll(4_000 + 2 * MINUTE);
  assert.equal(ledger.state(accountId).transactions[0].status, "confirmed");
  assert.equal(ledger.state(accountId).balances.walletAvailable, "94.00");
});

test("operação interrompida antes de persistir o hash expira com estorno auditável", async () => {
  const { ledger, accountId, chain } = fixture({ observationTimeoutMs: MINUTE });
  let release!: () => void;
  chain.prepareTransfer.mockImplementationOnce(() => new Promise<Awaited<ReturnType<typeof chain.prepareTransfer>>>((_resolve, reject) => { release = () => reject(new Error("processo caiu")); }));
  const inFlight = ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "1" }, "crash-0001", 2_000);
  await ledger.reconcileAll(2_000 + MINUTE - 1);
  assert.equal(ledger.state(accountId).transactions[0].status, "processing", "envio em curso não é tocado");
  await ledger.reconcileAll(2_000 + MINUTE);
  const state = ledger.state(accountId);
  assert.equal(state.transactions[0].status, "failed");
  assert.match(state.transactions[0].failureReason!, /Envio interrompido sem hash/);
  release();
  await inFlight;
  const final = ledger.state(accountId);
  assert.equal(final.balances.custodialAvailable, "10000.00", "estorno ocorre uma única vez");
  assert.equal(final.reconciliation.balanced, true);
});

test("reconcileAll processa operações de várias contas", async () => {
  const { ledger, accountId, chain } = fixture();
  const other = login(ledger, "outra@example.com", OTHER_USER, OTHER_OWNER);
  const a = (await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "1" }, "multi-0001", 2_000)).transactions[0];
  const b = (await ledger.transfer(other, { direction: "mb_to_wallet", amount: "2" }, "multi-0001", 2_000)).transactions[0];
  chain.confirm(a.txHash!);
  chain.confirm(b.txHash!);
  assert.equal(await ledger.reconcileAll(3_000), 2);
  assert.equal(ledger.state(accountId).balances.walletAvailable, "1.00");
  assert.equal(ledger.state(other).balances.walletAvailable, "2.00");
  assert.deepEqual(chain.prepareTransfer.mock.calls.map((call) => call[0]), [USER, OTHER_USER]);
});

test("vinculação: EOA vem do Privy, smart account é derivada no servidor e ambas são únicas por conta", async () => {
  const chain = fakeChain();
  const ledger = new Ledger(":memory:", chain.provider());
  onTestFinished(() => ledger.close());
  const accountId = login(ledger, "privy@example.com", null);
  const client: PrivyAuthClient = {
    verifyAuthToken: async () => ({ userId: "did:privy:1" }),
    getUser: async () => ({ linkedAccounts: [{ type: "wallet", walletClientType: "privy", chainType: "ethereum", address: OWNER.toLowerCase() }] }),
  };
  const derive = vi.fn(async (owner: Hex) => (owner === OWNER ? USER : OTHER_USER));
  const linked = await resolveLinkedSmartAccount(client, "privy-access-token-0001", derive);
  assert.deepEqual(linked, { ownerAddress: OWNER, smartAccount: USER });
  assert.deepEqual(derive.mock.calls, [[OWNER]]);
  const state = ledger.linkWallet(accountId, linked.smartAccount, linked.ownerAddress);
  assert.deepEqual(state.wallet, { active: true, address: USER, ownerAddress: OWNER, simulated: false, smartAccount: { type: "coinbase", entryPoint: "0.6" } });
  assert.equal(ledger.linkedSmartAccount(accountId), USER);
  assert.equal(ledger.linkWallet(accountId, USER.toLowerCase(), OWNER.toLowerCase()).wallet.address, USER, "revincular é idempotente");

  // Transferências usam a smart account (não a EOA) como origem/destino.
  const out = (await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "1" }, "link-0001", 2_000)).transactions[0];
  assert.equal(out.toAddress, USER);
  assert.deepEqual(chain.prepareTransfer.mock.calls, [[USER, 1_000_000n]]);

  const second = login(ledger, "segunda@example.com", null);
  assert.throws(() => ledger.linkWallet(second, USER, OTHER_OWNER), code("WALLET_ALREADY_LINKED"));
  assert.throws(() => ledger.linkWallet(second, OTHER_USER, OWNER), code("WALLET_ALREADY_LINKED"), "a mesma EOA não pode ser dona em duas contas");
  assert.throws(() => ledger.linkWallet(second, "0x123", OWNER), code("INVALID_ADDRESS"));
  assert.throws(() => ledger.linkWallet(second, OTHER_USER, OTHER_USER), code("INVALID_ADDRESS"), "smart account e dona distintas");
  assert.throws(() => ledger.linkWallet(accountId, OTHER_USER, OTHER_OWNER), code("PENDING_TRANSACTION"));
});

test("vinculação: falha ao derivar a smart account vira 502 sem detalhes do RPC", async () => {
  const client: PrivyAuthClient = {
    verifyAuthToken: async () => ({ userId: "did:privy:1" }),
    getUser: async () => ({ linkedAccounts: [{ type: "wallet", walletClientType: "privy", chainType: "ethereum", address: OWNER }] }),
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  const failing = async () => { throw new Error("HTTP request failed. URL: https://eth-sepolia.g.alchemy.com/v2/SECRET-KEY"); };
  await assert.rejects(() => resolveLinkedSmartAccount(client, "privy-access-token-0001", failing), (e: unknown) =>
    e instanceof BridgeError && e.code === "SMART_ACCOUNT_UNAVAILABLE" && e.status === 502 && !/SECRET|alchemy/.test(e.message));
  await assert.rejects(() => resolveLinkedSmartAccount(client, "privy-access-token-0001", async () => OWNER), code("SMART_ACCOUNT_UNAVAILABLE"));
});
