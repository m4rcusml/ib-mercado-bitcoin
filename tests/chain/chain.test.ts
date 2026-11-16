import { describe, expect, it } from "vitest";
import {
  TransactionReceiptNotFoundError,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  centsToUnits,
  createTreasurySender,
  encodeTransferCall,
  mockUsdcAbi,
  pimlicoBundlerUrl,
  readRpcUpstreams,
  readSepoliaConfig,
  verifyTransfer,
  type ExpectedTransfer,
  type ReceiptReader,
} from "../../src/lib/chain/index.ts";

const SEPOLIA = 11155111;
const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const OTHER_TOKEN = "0x9999999999999999999999999999999999999999" as const;
const FROM = "0x2222222222222222222222222222222222222222" as const;
const TO = "0x3333333333333333333333333333333333333333" as const;
const STRANGER = "0x4444444444444444444444444444444444444444" as const;
const HASH = `0x${"ab".repeat(32)}` as const;

type Receipt = Awaited<ReturnType<ReceiptReader["getTransactionReceipt"]>>;
type Log = Receipt["logs"][number];

function transferLog(opts: {
  address?: `0x${string}`;
  from?: `0x${string}`;
  to?: `0x${string}`;
  value?: bigint;
}): Log {
  const topics = encodeEventTopics({
    abi: mockUsdcAbi,
    eventName: "Transfer",
    args: { from: opts.from ?? FROM, to: opts.to ?? TO },
  }) as `0x${string}`[];
  return {
    address: opts.address ?? TOKEN,
    topics,
    data: encodeAbiParameters([{ type: "uint256" }], [opts.value ?? 1_000_000n]),
  };
}

function fakeReader(opts: {
  chainId?: number;
  receipt?: Partial<Receipt>;
  error?: unknown;
}): ReceiptReader {
  return {
    async getChainId() {
      return opts.chainId ?? SEPOLIA;
    },
    async getTransactionReceipt() {
      if (opts.error) throw opts.error;
      return { status: "success", blockNumber: 42n, logs: [], ...opts.receipt };
    },
  };
}

const expected: ExpectedTransfer = {
  txHash: HASH,
  token: TOKEN,
  from: FROM,
  to: TO,
  units: 1_000_000n,
  chainId: SEPOLIA,
};

describe("verifyTransfer", () => {
  it("confirma Transfer correto (endereços em checksum/minúsculas)", async () => {
    const reader = fakeReader({ receipt: { logs: [transferLog({ address: getAddress(TOKEN) })] } });
    await expect(verifyTransfer(reader, expected)).resolves.toEqual({ status: "confirmed", blockNumber: 42n });
  });

  it("ignora logs não relacionados e confirma o Transfer correspondente", async () => {
    const reader = fakeReader({
      receipt: { logs: [transferLog({ address: OTHER_TOKEN }), transferLog({ value: 5n }), transferLog({})] },
    });
    await expect(verifyTransfer(reader, expected)).resolves.toMatchObject({ status: "confirmed" });
  });

  it("falha quando a transação reverteu", async () => {
    const reader = fakeReader({ receipt: { status: "reverted", logs: [transferLog({})] } });
    const result = await verifyTransfer(reader, expected);
    expect(result).toMatchObject({ status: "failed" });
    if (result.status === "failed") expect(result.reason).toMatch(/revertida/);
  });

  it("retorna pending quando o receipt ainda não existe", async () => {
    const reader = fakeReader({ error: new TransactionReceiptNotFoundError({ hash: HASH }) });
    await expect(verifyTransfer(reader, expected)).resolves.toEqual({ status: "pending" });
  });

  it("falha em rede incorreta sem consultar o receipt", async () => {
    let called = false;
    const reader: ReceiptReader = {
      getChainId: async () => 1,
      getTransactionReceipt: async () => {
        called = true;
        return { status: "success", blockNumber: 1n, logs: [transferLog({})] };
      },
    };
    const result = await verifyTransfer(reader, expected);
    expect(result).toMatchObject({ status: "failed" });
    if (result.status === "failed") expect(result.reason).toMatch(/Rede incorreta/);
    expect(called).toBe(false);
  });

  it("falha quando o Transfer vem de outro contrato", async () => {
    const reader = fakeReader({ receipt: { logs: [transferLog({ address: OTHER_TOKEN })] } });
    const result = await verifyTransfer(reader, expected);
    expect(result).toMatchObject({ status: "failed" });
    if (result.status === "failed") expect(result.reason).toMatch(/Nenhum evento Transfer/);
  });

  it.each([
    ["origem", { from: STRANGER }],
    ["destino", { to: STRANGER }],
    ["valor", { value: 999_999n }],
  ])("falha com %s divergente", async (_label, override) => {
    const reader = fakeReader({ receipt: { logs: [transferLog(override)] } });
    const result = await verifyTransfer(reader, expected);
    expect(result).toMatchObject({ status: "failed" });
    if (result.status === "failed") expect(result.reason).toMatch(/não corresponde/);
  });

  it("falha quando não há logs", async () => {
    await expect(verifyTransfer(fakeReader({}), expected)).resolves.toMatchObject({ status: "failed" });
  });

  it("relança outros erros de RPC", async () => {
    const reader = fakeReader({ error: new Error("rpc indisponível") });
    await expect(verifyTransfer(reader, expected)).rejects.toThrow("rpc indisponível");
  });
});

describe("mock-usdc helpers", () => {
  it("centsToUnits converte para 6 decimais e rejeita negativos", () => {
    expect(centsToUnits(0n)).toBe(0n);
    expect(centsToUnits(1n)).toBe(10_000n);
    expect(centsToUnits(12_345n)).toBe(123_450_000n);
    expect(() => centsToUnits(-1n)).toThrow(RangeError);
  });

  it("encodeTransferCall gera calldata ERC-20 decodificável", () => {
    const data = encodeTransferCall(TO, 123_450_000n);
    expect(data.startsWith("0xa9059cbb")).toBe(true);
    const decoded = decodeFunctionData({ abi: mockUsdcAbi, data });
    expect(decoded.functionName).toBe("transfer");
    expect(decoded.args).toEqual([getAddress(TO), 123_450_000n]);
  });
});

describe("createTreasurySender", () => {
  it("envia transfer do token e devolve o hash sem aguardar", async () => {
    const calls: unknown[] = [];
    const sender = createTreasurySender({
      token: TOKEN,
      walletClient: {
        account: { address: FROM },
        writeContract: async (args) => {
          calls.push(args);
          return HASH;
        },
      },
    });
    expect(sender.address).toBe(FROM);
    await expect(sender.sendTransfer(TO, 10n)).resolves.toBe(HASH);
    expect(calls).toEqual([{ address: TOKEN, abi: mockUsdcAbi, functionName: "transfer", args: [TO, 10n] }]);
    await expect(sender.sendTransfer(TO, 0n)).rejects.toThrow();
  });
});

describe("readSepoliaConfig", () => {
  const KEY = `0x${"01".repeat(32)}` as const;
  const ADDRESS = privateKeyToAccount(KEY).address;
  const env = {
    ALCHEMY_RPC_URL: "https://eth-sepolia.example/v2/secret-token",
    PIMLICO_API_KEY: "pim_secretPimlicoKey123",
    MOCK_USDC_ADDRESS: TOKEN,
    TREASURY_ADDRESS: ADDRESS.toLowerCase(),
    TREASURY_PRIVATE_KEY: KEY,
  };

  it("aceita configuração válida", () => {
    expect(readSepoliaConfig(env)).toEqual({
      rpcUrl: env.ALCHEMY_RPC_URL,
      pimlicoApiKey: env.PIMLICO_API_KEY,
      token: TOKEN,
      treasuryAddress: ADDRESS,
      treasuryPrivateKey: KEY,
    });
  });

  it("rejeita chave que não corresponde ao endereço sem ecoar segredos", () => {
    const bad = { ...env, TREASURY_ADDRESS: STRANGER };
    expect(() => readSepoliaConfig(bad)).toThrow(/não corresponde/);
    try {
      readSepoliaConfig({ ...bad, ALCHEMY_RPC_URL: "http://insecure/secret-token" });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(KEY);
      expect(message).not.toContain(KEY.slice(2));
      expect(message).not.toContain("secret-token");
    }
  });

  it("rejeita variáveis ausentes ou malformadas", () => {
    expect(() => readSepoliaConfig({})).toThrow(/ALCHEMY_RPC_URL.*PIMLICO_API_KEY.*MOCK_USDC_ADDRESS.*TREASURY_ADDRESS.*TREASURY_PRIVATE_KEY/);
    expect(() => readSepoliaConfig({ ...env, PIMLICO_API_KEY: "bad key!" })).toThrow(/PIMLICO_API_KEY/);
    try {
      readSepoliaConfig({ ...env, PIMLICO_API_KEY: "a b" });
    } catch (error) {
      expect((error as Error).message).not.toContain("secretPimlicoKey");
    }
  });

  it("readRpcUpstreams lê só RPC e Pimlico e monta a URL do bundler Sepolia", () => {
    expect(readRpcUpstreams({ ALCHEMY_RPC_URL: env.ALCHEMY_RPC_URL, PIMLICO_API_KEY: env.PIMLICO_API_KEY })).toEqual({
      rpcUrl: env.ALCHEMY_RPC_URL,
      bundlerUrl: "https://api.pimlico.io/v2/sepolia/rpc?apikey=pim_secretPimlicoKey123",
    });
    expect(pimlicoBundlerUrl("k_1")).toBe("https://api.pimlico.io/v2/sepolia/rpc?apikey=k_1");
    expect(() => readRpcUpstreams({ ALCHEMY_RPC_URL: env.ALCHEMY_RPC_URL })).toThrow(/PIMLICO_API_KEY/);
    try {
      readRpcUpstreams({ ALCHEMY_RPC_URL: "http://insecure/secret-token", PIMLICO_API_KEY: env.PIMLICO_API_KEY });
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-token");
    }
    expect(() => readSepoliaConfig({ ...env, TREASURY_PRIVATE_KEY: "0x1234" })).toThrow(/TREASURY_PRIVATE_KEY/);
  });
});
