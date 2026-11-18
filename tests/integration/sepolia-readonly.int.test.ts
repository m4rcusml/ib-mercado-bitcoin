// Integração Sepolia SOMENTE LEITURA: consulta a rede real (Alchemy + Pimlico), não envia transações
// e não gasta gas. Pulada quando ALCHEMY_RPC_URL, PIMLICO_API_KEY, MOCK_USDC_ADDRESS ou
// TREASURY_ADDRESS estão ausentes. Uso: npm run test:integration
import { beforeAll, describe, expect, test } from "vitest";
import { erc20Abi, getAddress, isAddressEqual, type PublicClient } from "viem";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  COINBASE_SMART_ACCOUNT_VERSION,
  ENTRY_POINT_V06,
  pimlicoBundlerUrl,
  readRpcUpstreams,
  verifyTransfer,
  deriveSmartAccountAddress,
  type ExpectedTransfer,
  type ReceiptReader,
} from "../../src/lib/chain/index.ts";
import { proxyJsonRpc, type JsonRpcResponse } from "../../src/lib/server/rpc-proxy.ts";
import { env, findTreasuryTransfer, missingEnv, READ_ENV, sepoliaPublicClient, type HistoricalTransfer } from "./helpers.ts";

type Hex = `0x${string}`;
const SEPOLIA_CHAIN_ID = 11_155_111;
const missing = missingEnv(READ_ENV);
if (missing.length > 0) console.warn(`[integração] suíte somente leitura pulada; ausentes: ${missing.join(", ")}`);

const randomAddress = (): Hex => privateKeyToAccount(generatePrivateKey()).address;

describe.skipIf(missing.length > 0)("Sepolia (somente leitura)", () => {
  let client: PublicClient;
  let token: Hex;
  let treasury: Hex;

  beforeAll(() => {
    client = sepoliaPublicClient();
    token = getAddress(env("MOCK_USDC_ADDRESS"));
    treasury = getAddress(env("TREASURY_ADDRESS"));
  });

  describe("rede, token e tesouraria", () => {
    test("RPC aponta para Sepolia (chainId 11155111)", async () => {
      expect(await client.getChainId()).toBe(SEPOLIA_CHAIN_ID);
    });

    test("Mock USDC tem bytecode, 6 decimais e símbolo mUSDC", async () => {
      const code = await client.getCode({ address: token });
      expect(code && code !== "0x").toBe(true);
      expect(await client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })).toBe(6);
      expect(await client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" })).toBe("mUSDC");
    });

    test("tesouraria tem ETH para gas e saldo de Mock USDC", async () => {
      expect(await client.getBalance({ address: treasury })).toBeGreaterThan(0n);
      expect(await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [treasury] })).toBeGreaterThan(0n);
    });
  });

  test("Pimlico Sepolia suporta o EntryPoint v0.6", async () => {
    const response = await fetch(pimlicoBundlerUrl(env("PIMLICO_API_KEY")), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_supportedEntryPoints", params: [] }),
      signal: AbortSignal.timeout(20_000),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result?: unknown };
    expect(Array.isArray(body.result)).toBe(true);
    const supported = (body.result as string[]).filter((entry) => typeof entry === "string");
    expect(supported.some((entry) => isAddressEqual(entry as Hex, ENTRY_POINT_V06))).toBe(true);
  });

  describe("derivação da Coinbase Smart Account (factory real)", () => {
    const owner = randomAddress();
    const otherOwner = randomAddress();

    test("é determinística, depende do dono e coincide com toCoinbaseSmartAccount", async () => {
      const first = await deriveSmartAccountAddress(client, owner);
      const second = await deriveSmartAccountAddress(client, owner);
      expect(second).toBe(first);
      expect(isAddressEqual(first, owner)).toBe(false);

      const other = await deriveSmartAccountAddress(client, otherOwner);
      expect(isAddressEqual(other, first)).toBe(false);

      const independent = await toCoinbaseSmartAccount({ client, owners: [owner], version: COINBASE_SMART_ACCOUNT_VERSION });
      expect(getAddress(independent.address)).toBe(first);
    });
  });

  describe("verifyTransfer contra uma transação histórica real", () => {
    let historical: HistoricalTransfer | null = null;

    beforeAll(async () => {
      historical = await findTreasuryTransfer(client, token, treasury);
    });

    const expectedFor = (h: HistoricalTransfer, patch: Partial<ExpectedTransfer> = {}): ExpectedTransfer => ({
      txHash: h.txHash,
      token,
      from: h.from,
      to: h.to,
      units: h.value,
      chainId: SEPOLIA_CHAIN_ID,
      ...patch,
    });

    test("confirma o Transfer exato da tesouraria", async (ctx) => {
      if (!historical) return ctx.skip("nenhum Transfer da tesouraria encontrado (faça uma transferência MB → wallet antes)");
      const result = await verifyTransfer(client as unknown as ReceiptReader, expectedFor(historical));
      expect(result).toEqual({ status: "confirmed", blockNumber: historical.blockNumber });
    });

    test("falha com valor divergente", async (ctx) => {
      if (!historical) return ctx.skip("nenhum Transfer da tesouraria encontrado");
      const result = await verifyTransfer(client as unknown as ReceiptReader, expectedFor(historical, { units: historical.value + 1n }));
      expect(result.status).toBe("failed");
    });

    test("falha com destinatário divergente", async (ctx) => {
      if (!historical) return ctx.skip("nenhum Transfer da tesouraria encontrado");
      const result = await verifyTransfer(client as unknown as ReceiptReader, expectedFor(historical, { to: randomAddress() }));
      expect(result.status).toBe("failed");
    });

    test("falha quando a rede esperada é outra", async (ctx) => {
      if (!historical) return ctx.skip("nenhum Transfer da tesouraria encontrado");
      const result = await verifyTransfer(client as unknown as ReceiptReader, expectedFor(historical, { chainId: 1 }));
      expect(result.status).toBe("failed");
    });

    test("fica pending para um hash inexistente", async () => {
      const txHash = generatePrivateKey(); // 32 bytes aleatórios
      const result = await verifyTransfer(client as unknown as ReceiptReader, {
        txHash,
        token,
        from: treasury,
        to: randomAddress(),
        units: 1n,
        chainId: SEPOLIA_CHAIN_ID,
      });
      expect(result).toEqual({ status: "pending" });
    });
  });

  describe("proxy JSON-RPC contra os upstreams reais (sem servidor HTTP)", () => {
    const single = (value: JsonRpcResponse | JsonRpcResponse[]): JsonRpcResponse => {
      expect(Array.isArray(value)).toBe(false);
      return value as JsonRpcResponse;
    };
    const ctx = () => ({ smartAccount: null, upstreams: readRpcUpstreams() });

    test("eth_chainId é encaminhado ao RPC Sepolia", async () => {
      const response = single(await proxyJsonRpc({ jsonrpc: "2.0", id: 7, method: "eth_chainId", params: [] }, ctx()));
      expect(response).toEqual({ jsonrpc: "2.0", id: 7, result: "0xaa36a7" });
    });

    test("eth_supportedEntryPoints é encaminhado ao bundler", async () => {
      const response = single(await proxyJsonRpc({ jsonrpc: "2.0", id: 8, method: "eth_supportedEntryPoints", params: [] }, ctx()));
      expect("result" in response && Array.isArray(response.result)).toBe(true);
      const entries = (response as { result: string[] }).result;
      expect(entries.some((entry) => isAddressEqual(entry as Hex, ENTRY_POINT_V06))).toBe(true);
    });

    test("método fora da allowlist é recusado com -32601 sem chamar upstream", async () => {
      const response = single(await proxyJsonRpc({ jsonrpc: "2.0", id: 9, method: "eth_sendRawTransaction", params: ["0x00"] }, ctx()));
      expect("error" in response && response.error.code).toBe(-32601);
    });

    test("erros do upstream não expõem URL nem chave", async () => {
      // eth_call com endereço inválido força um erro do RPC real.
      const response = single(await proxyJsonRpc({ jsonrpc: "2.0", id: 10, method: "eth_call", params: [{ to: "0x1234" }, "latest"] }, ctx()));
      const text = JSON.stringify(response);
      // Asserts booleanos: uma falha não pode imprimir o segredo na mensagem do vitest.
      const secrets = [env("PIMLICO_API_KEY"), new URL(env("ALCHEMY_RPC_URL")).pathname].filter((s) => s.length > 4);
      expect(/https?:\/\//i.test(text)).toBe(false);
      expect(secrets.some((secret) => text.includes(secret))).toBe(false);
    });
  });
});
