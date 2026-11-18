import { isAddress } from "viem";
import { mockUsdcAbi } from "./mock-usdc.ts";

export interface TreasurySender {
  address: `0x${string}`;
  prepareTransfer(to: `0x${string}`, units: bigint): Promise<{ txHash: `0x${string}`; signedPayload?: `0x${string}` }>;
}

/** Interface mínima de wallet client necessária (um viem WalletClient é adaptado em clients.ts). */
export interface TreasuryWalletClient {
  account: { address: `0x${string}` } | undefined;
  signTransfer(args: {
    address: `0x${string}`;
    abi: typeof mockUsdcAbi;
    functionName: "transfer";
    args: readonly [`0x${string}`, bigint];
  }): ReturnType<TreasurySender["prepareTransfer"]>;
}

export function createTreasurySender(opts: {
  walletClient: TreasuryWalletClient;
  token: `0x${string}`;
}): TreasurySender {
  const { walletClient, token } = opts;
  const account = walletClient.account;
  if (!account) {
    throw new Error("Wallet client da tesouraria sem conta configurada.");
  }
  if (!isAddress(token, { strict: false })) {
    throw new Error("Endereço do token inválido.");
  }

  return {
    address: account.address,
    async prepareTransfer(to, units) {
      if (!isAddress(to, { strict: false })) {
        throw new Error("Endereço de destino inválido.");
      }
      if (typeof units !== "bigint" || units <= 0n) {
        throw new Error("Quantidade de unidades deve ser um bigint positivo.");
      }
      return walletClient.signTransfer({
        address: token,
        abi: mockUsdcAbi,
        functionName: "transfer",
        args: [to, units],
      });
    },
  };
}
