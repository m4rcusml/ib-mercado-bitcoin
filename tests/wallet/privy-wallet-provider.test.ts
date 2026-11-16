import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";
import { createClient, custom, encodeAbiParameters, encodeEventTopics, getAddress } from "viem";
import { sepolia } from "viem/chains";
import {
  COINBASE_SMART_ACCOUNT_VERSION,
  deriveSmartAccountAddress,
  ENTRY_POINT_V06,
  mockUsdcAbi,
} from "../../src/lib/chain/index.ts";
import type { ExpectedTransfer, UserOperationReceiptLike, VerificationResult } from "../../src/lib/chain/index.ts";
import { BridgeError } from "../../src/lib/domain/money.ts";
import { PrivyWalletProvider, resolveEmbeddedWalletAddress } from "../../src/lib/wallet/privy-wallet-provider.ts";
import type { PrivyAuthClient } from "../../src/lib/wallet/privy-wallet-provider.ts";
import type { PersistedOperation } from "../../src/lib/wallet/wallet-provider.ts";

type Hex = `0x${string}`;
const TOKEN = getAddress(`0x${"1".repeat(40)}`);
const TREASURY = getAddress(`0x${"7".repeat(40)}`);
const USER = getAddress(`0x${"ab".repeat(20)}`);
const OWNER = getAddress(`0x${"0c".repeat(20)}`);
const TX = `0x${"cd".repeat(32)}` as Hex;
const USER_OP = `0x${"ee".repeat(32)}` as Hex;
const BUNDLE_TX = `0x${"bb".repeat(32)}` as Hex;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function blockNetwork() {
  return vi.spyOn(globalThis as any, "fetch").mockImplementation(async () => {
    throw new Error("testes unitários não devem acessar a rede");
  });
}

function userOpReceipt(overrides: Partial<UserOperationReceiptLike> = {}): UserOperationReceiptLike {
  return {
    userOpHash: USER_OP,
    sender: USER,
    entryPoint: ENTRY_POINT_V06,
    success: true,
    logs: [{
      address: TOKEN,
      topics: encodeEventTopics({ abi: mockUsdcAbi, eventName: "Transfer", args: { from: USER, to: TREASURY } }) as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }], [12_500_000n]),
    }],
    receipt: { transactionHash: BUNDLE_TX, blockNumber: 5n },
    ...overrides,
  };
}

function makeProvider(
  verifyResult: VerificationResult | Error = { status: "confirmed", blockNumber: 1n },
  receipt: UserOperationReceiptLike | null | Error = null,
) {
  const sendTransfer = vi.fn(async (_to: Hex, _units: bigint): Promise<Hex> => TX);
  const verify = vi.fn(async (_client: unknown, _expected: ExpectedTransfer): Promise<VerificationResult> => {
    if (verifyResult instanceof Error) throw verifyResult;
    return verifyResult;
  });
  const getUserOperationReceipt = vi.fn(async (_hash: Hex) => {
    if (receipt instanceof Error) throw receipt;
    return receipt;
  });
  const provider = new PrivyWalletProvider({
    token: TOKEN,
    treasury: { address: TREASURY, sendTransfer },
    publicClient: {} as never,
    userOperations: { getUserOperationReceipt },
    verify,
  });
  return { provider, sendTransfer, verify, getUserOperationReceipt };
}

function operation(overrides: Partial<PersistedOperation> = {}): PersistedOperation {
  return {
    id: "tx-1", accountId: "account-1", direction: "mb_to_wallet", status: "submitted", amountCents: 1_250n,
    amountUnits: 12_500_000n, outcome: "confirmed", walletAddress: USER, ownerAddress: OWNER, fromAddress: TREASURY, toAddress: USER,
    txHash: TX, userOpHash: null, createdAt: 1_000, submittedAt: 1_000, ...overrides,
  };
}

test("dependência @privy-io/server-auth está instalada e expõe PrivyClient", async () => {
  const privy = await import("@privy-io/server-auth");
  assert.equal(typeof privy.PrivyClient, "function");
});

test("route fixa origem, destino e unidades de 6 decimais em cada sentido", () => {
  const { provider } = makeProvider();
  assert.equal(provider.mode, "privy");
  assert.deepEqual(provider.route("mb_to_wallet", USER.toLowerCase(), 1_250n), { from: TREASURY, to: USER, amountUnits: 12_500_000n });
  assert.deepEqual(provider.route("wallet_to_mb", USER, 1n), { from: USER, to: TREASURY, amountUnits: 10_000n });
  assert.throws(() => provider.route("mb_to_wallet", "not-an-address", 1n), (e: unknown) => e instanceof BridgeError && e.code === "WALLET_INACTIVE");
});

test("mb_to_wallet: submit envia pela tesouraria e devolve o hash sem aguardar", async () => {
  const fetchMock = blockNetwork();
  const { provider, sendTransfer } = makeProvider();
  const result = await provider.submit(operation({ status: "processing", txHash: null }));
  assert.deepEqual(result, { status: "submitted", txHash: TX });
  assert.deepEqual(sendTransfer.mock.calls, [[USER, 12_500_000n]]);
  assert.equal(fetchMock.mock.calls.length, 0);
});

test("wallet_to_mb: submit não envia nada e pede assinatura do usuário", async () => {
  const { provider, sendTransfer } = makeProvider();
  const op = operation({ direction: "wallet_to_mb", status: "awaiting_user_signature", fromAddress: USER, toAddress: TREASURY, txHash: null });
  assert.deepEqual(await provider.submit(op), { status: "awaiting_user_signature" });
  assert.equal(sendTransfer.mock.calls.length, 0);
  assert.deepEqual(provider.signatureRequest(op), {
    chainId: 11155111, token: TOKEN, to: TREASURY, amountUnits: "12500000", smartAccount: USER, ownerAddress: OWNER, entryPoint: "0.6",
  });
  assert.equal(provider.signatureRequest({ ...op, status: "submitted" }), null);
  assert.equal(provider.signatureRequest({ ...op, ownerAddress: null }), null, "sem EOA dona não há como assinar");
  assert.equal(provider.signatureRequest(operation()), null);
});

const returning = (overrides: Partial<PersistedOperation> = {}) => operation({
  direction: "wallet_to_mb", fromAddress: USER, toAddress: TREASURY, txHash: null, userOpHash: USER_OP, ...overrides,
});

test("wallet_to_mb: observação pelo receipt do bundler", async () => {
  // Sem userOpHash ou sem receipt: pending, sem verificação.
  const none = makeProvider();
  assert.deepEqual(await none.provider.observe(returning({ userOpHash: null })), { status: "pending" });
  assert.equal(none.getUserOperationReceipt.mock.calls.length, 0);
  assert.deepEqual(await none.provider.observe(returning()), { status: "pending" });
  assert.deepEqual(none.getUserOperationReceipt.mock.calls, [[USER_OP]]);
  assert.equal(none.verify.mock.calls.length, 0);

  // Receipt ok: verifyTransfer na tx do bundle, origem = smart account.
  const ok = makeProvider({ status: "confirmed", blockNumber: 5n }, userOpReceipt());
  assert.deepEqual(await ok.provider.observe(returning()), { status: "confirmed", txHash: BUNDLE_TX });
  assert.deepEqual(ok.verify.mock.calls[0][1], { txHash: BUNDLE_TX, token: TOKEN, from: USER, to: TREASURY, units: 12_500_000n, chainId: 11155111 });

  const pendingRpc = makeProvider({ status: "pending" }, userOpReceipt());
  assert.deepEqual(await pendingRpc.provider.observe(returning()), { status: "pending", txHash: BUNDLE_TX });

  const reverted = makeProvider(undefined, userOpReceipt({ success: false }));
  assert.deepEqual(await reverted.provider.observe(returning()), { status: "failed", reason: "UserOperation revertida no EntryPoint.", txHash: BUNDLE_TX });
  assert.equal(reverted.verify.mock.calls.length, 0);

  const wrongSender = makeProvider(undefined, userOpReceipt({ sender: OWNER }));
  const result = await wrongSender.provider.observe(returning());
  assert.equal(result.status, "failed");
  assert.equal(wrongSender.verify.mock.calls.length, 0);

  const wrongAmount = makeProvider(undefined, userOpReceipt());
  assert.equal((await wrongAmount.provider.observe(returning({ amountUnits: 1n }))).status, "failed", "Transfer da UserOperation precisa bater o valor");

  await assert.rejects(() => makeProvider(undefined, new Error("bundler fora do ar")).provider.observe(returning()), /bundler fora do ar/);
  await assert.rejects(() => makeProvider(undefined, userOpReceipt({ userOpHash: BUNDLE_TX })).provider.observe(returning()), /outra UserOperation/);
});

test("deriveSmartAccountAddress usa a factory Coinbase v1 (EntryPoint v0.6) via eth_call, sem rede real", async () => {
  assert.equal(COINBASE_SMART_ACCOUNT_VERSION, "1");
  assert.equal(ENTRY_POINT_V06.toLowerCase(), "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789");
  const SMART = getAddress(`0x${"5a".repeat(20)}`);
  const calls: Array<{ to: string; data: string }> = [];
  const client = createClient({
    chain: sepolia,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        if (method === "eth_call") {
          const [call] = params as [{ to: string; data: string }];
          calls.push(call);
          return encodeAbiParameters([{ type: "address" }], [SMART]);
        }
        if (method === "eth_chainId") return "0xaa36a7";
        throw new Error(`método inesperado ${method}`);
      },
    }),
  });
  assert.equal(await deriveSmartAccountAddress(client, OWNER), SMART);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to.toLowerCase(), "0x0ba5ed0c6aa8c49038f819e587e2633c4a9f428a", "factory da versão 1");
  assert.ok(calls[0].data.toLowerCase().includes(OWNER.slice(2).toLowerCase()), "owner codificado no getAddress");
  await assert.rejects(() => deriveSmartAccountAddress(client, "0x123" as Hex), TypeError);
});

test("observe verifica token, origem, destino, valor e chainId persistidos", async () => {
  const { provider, verify } = makeProvider();
  assert.deepEqual(await provider.observe(operation()), { status: "confirmed" });
  assert.deepEqual(verify.mock.calls[0][1], { txHash: TX, token: TOKEN, from: TREASURY, to: USER, units: 12_500_000n, chainId: 11155111 });
});

test("observe mapeia failed/pending e propaga erro transitório", async () => {
  assert.deepEqual(await makeProvider({ status: "failed", reason: "revertida" }).provider.observe(operation()), { status: "failed", reason: "revertida" });
  assert.deepEqual(await makeProvider({ status: "pending" }).provider.observe(operation()), { status: "pending" });
  await assert.rejects(() => makeProvider(new Error("RPC fora do ar")).provider.observe(operation()), /RPC fora do ar/);
  const { provider, verify } = makeProvider();
  assert.deepEqual(await provider.observe(operation({ txHash: null })), { status: "pending" });
  assert.equal(verify.mock.calls.length, 0);
});

test("activate é recusado no modo privy e aponta para /api/wallet/link", () => {
  const { provider } = makeProvider();
  assert.throws(() => provider.activate(), (e: unknown) => e instanceof BridgeError && e.code === "WALLET_LINK_REQUIRED" && /wallet\/link/.test(e.message));
});

test("configuração Sepolia é lida de forma preguiçosa e falha com MISSING_CONFIG", async () => {
  const load = vi.fn(() => { throw new Error("Configuração Sepolia inválida: ALCHEMY_RPC_URL deve ser uma URL HTTPS válida."); });
  const provider = new PrivyWalletProvider(load);
  assert.equal(load.mock.calls.length, 0);
  assert.throws(() => provider.route("mb_to_wallet", USER, 1n), (e: unknown) => e instanceof BridgeError && e.code === "MISSING_CONFIG" && e.status === 503);
});

test("getWalletProvider seleciona PrivyWalletProvider com WALLET_PROVIDER=privy sem exigir env Sepolia", async () => {
  vi.stubEnv("WALLET_PROVIDER", "privy");
  vi.resetModules();
  const { PrivyWalletProvider: Fresh } = await import("../../src/lib/wallet/privy-wallet-provider.ts");
  const { getWalletProvider, SimulatedWalletProvider } = await import("../../src/lib/wallet/wallet-provider.ts");
  const provider = getWalletProvider();
  assert.ok(provider instanceof Fresh);
  assert.ok(!(provider instanceof SimulatedWalletProvider));
  assert.equal(provider.mode, "privy");
});

function fakePrivy(linkedAccounts: unknown[], options: { invalid?: boolean } = {}) {
  const client: PrivyAuthClient & { verified: string[] } = {
    verified: [],
    async verifyAuthToken(token) {
      if (options.invalid) throw new Error("jwt expired");
      this.verified.push(token);
      return { userId: "did:privy:user-1" };
    },
    async getUser(userId) {
      assert.equal(userId, "did:privy:user-1");
      return { linkedAccounts };
    },
  };
  return client;
}

const TOKEN_JWT = "eyJhbGciOiJFUzI1NiJ9.payload.signature";

test("vinculação usa somente a embedded wallet Privy retornada pelo servidor", async () => {
  const client = fakePrivy([
    { type: "email", address: "a@example.com" },
    { type: "wallet", walletClientType: "metamask", chainType: "ethereum", address: `0x${"9".repeat(40)}` },
    { type: "wallet", walletClientType: "privy", chainType: "solana", address: "So1anaAddr" },
    { type: "wallet", walletClientType: "privy", chainType: "ethereum", address: USER.toLowerCase() },
  ]);
  assert.equal(await resolveEmbeddedWalletAddress(client, TOKEN_JWT), USER);
  assert.deepEqual(client.verified, [TOKEN_JWT]);
});

test("vinculação recusa token inválido, ausente e usuário sem embedded wallet", async () => {
  const code = (expected: string) => (e: unknown) => e instanceof BridgeError && e.code === expected;
  await assert.rejects(() => resolveEmbeddedWalletAddress(fakePrivy([], { invalid: true }), TOKEN_JWT), code("INVALID_PRIVY_TOKEN"));
  await assert.rejects(() => resolveEmbeddedWalletAddress(fakePrivy([]), undefined), code("INVALID_PRIVY_TOKEN"));
  await assert.rejects(() => resolveEmbeddedWalletAddress(fakePrivy([{ type: "wallet", walletClientType: "metamask", address: USER }]), TOKEN_JWT), code("EMBEDDED_WALLET_NOT_FOUND"));
});
