// Integração Sepolia COM ESCRITA (opt-in): ATENÇÃO, este teste envia uma transação real assinada
// pela tesouraria (0,01 Mock USDC para uma smart account nova) e GASTA ETH SEPOLIA DA TESOURARIA
// em gas. Roda somente com POC_INTEGRATION_WRITE=1 e com ALCHEMY_RPC_URL, PIMLICO_API_KEY,
// MOCK_USDC_ADDRESS, TREASURY_ADDRESS e TREASURY_PRIVATE_KEY definidos.
//   PowerShell: $env:POC_INTEGRATION_WRITE="1"; npm run test:integration
//   bash:       POC_INTEGRATION_WRITE=1 npm run test:integration
// Fluxo: Ledger real (SQLite temporário) + PrivyWalletProvider real (tesouraria, verifyTransfer).
// A smart account é derivada de uma EOA aleatória e vinculada direto via ledger.linkWallet
// (dispensa token Privy). O Mock USDC enviado fica preso nessa smart account (ninguém guarda a chave).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { erc20Abi, getAddress, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deriveSmartAccountAddress } from "../../src/lib/chain/index.ts";
import { Ledger } from "../../src/lib/domain/ledger.ts";
import { createPrivyWalletProvider } from "../../src/lib/wallet/privy-wallet-provider.ts";
import { env, missingEnv, sepoliaPublicClient, WRITE_ENV } from "./helpers.ts";

type Hex = `0x${string}`;
const enabled = process.env.POC_INTEGRATION_WRITE === "1";
const missing = missingEnv(WRITE_ENV);
const skip = !enabled || missing.length > 0;
if (enabled && missing.length > 0) console.warn(`[integração] teste de escrita pulado; ausentes: ${missing.join(", ")}`);

const AMOUNT = "0.01";
const AMOUNT_UNITS = 10_000n; // 0,01 * 10^6
const CONFIRM_TIMEOUT_MS = 180_000;
const POLL_MS = 4_000;

describe.skipIf(skip)("Sepolia MB → wallet ponta a ponta (gasta gas da tesouraria)", () => {
  let dir: string;
  let ledger: Ledger;
  let client: PublicClient;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mb-bridge-int-"));
    client = sepoliaPublicClient();
    ledger = new Ledger(join(dir, "bridge.sqlite"), createPrivyWalletProvider(process.env), {
      observationTimeoutMs: 10 * 60_000,
    });
  });

  afterAll(() => {
    ledger?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("transfere 0,01 mUSDC da tesouraria e o ledger confirma após verificação on-chain", { timeout: CONFIRM_TIMEOUT_MS + 60_000 }, async () => {
    const token = getAddress(env("MOCK_USDC_ADDRESS"));
    const email = `int-${randomUUID().slice(0, 8)}@example.test`;
    ledger.requestCode(email);
    const { token: session } = ledger.login(email, "123456");
    const accountId = ledger.accountForSession(session);
    expect(accountId).not.toBeNull();

    const owner: Hex = privateKeyToAccount(generatePrivateKey()).address;
    const smartAccount = await deriveSmartAccountAddress(client, owner);
    const linked = ledger.linkWallet(accountId!, smartAccount, owner);
    expect(linked.wallet.active).toBe(true);
    expect(linked.wallet.address).toBe(smartAccount);

    const balanceOf = () => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [smartAccount] });
    const before = await balanceOf();

    let state = await ledger.transfer(accountId!, { direction: "mb_to_wallet", amount: AMOUNT }, `int-${randomUUID()}`);
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].status, state.transactions[0].failureReason ?? "").toBe("submitted");
    expect(state.transactions[0].txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(state.balances.custodialAvailable).toBe("9999.99");
    expect(state.balances.custodialReserved).toBe("0.01");

    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      state = await ledger.advance(accountId!);
      const status = state.transactions[0].status;
      if (status === "confirmed" || status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }

    const tx = state.transactions[0];
    expect(tx.status, tx.failureReason ?? "").toBe("confirmed");
    expect(state.balances.custodialAvailable).toBe("9999.99");
    expect(state.balances.custodialReserved).toBe("0.00");
    expect(state.balances.walletAvailable).toBe("0.01");
    expect(state.balances.walletReserved).toBe("0.00");
    expect(state.reconciliation.balanced).toBe(true);

    expect((await balanceOf()) - before).toBe(AMOUNT_UNITS);
  });
});
