// SERVER-ONLY: derivação e observação da Coinbase Smart Account (ERC-4337, EntryPoint v0.6).
import { getAddress, isAddress, isAddressEqual } from "viem";
import { entryPoint06Address, toCoinbaseSmartAccount } from "viem/account-abstraction";

type Hex = `0x${string}`;

/** EntryPoint usado por `toCoinbaseSmartAccount` no viem 2.57.x. */
export const ENTRY_POINT_V06: Hex = entryPoint06Address;
export const ENTRY_POINT_VERSION = "0.6" as const;
/**
 * Versão da Coinbase Smart Account (factory `0x0ba5ed0c…`). O browser deve usar a mesma
 * versão em `toCoinbaseSmartAccount`, caso contrário o endereço derivado diverge.
 */
export const COINBASE_SMART_ACCOUNT_VERSION = "1" as const;

const ZERO_ADDRESS = /^0x0{40}$/i;

/** Client aceito por `toCoinbaseSmartAccount` (ex.: `createPublicClient` em Sepolia). */
export type SmartAccountClient = Parameters<typeof toCoinbaseSmartAccount>[0]["client"];

/**
 * Calcula, no servidor, o endereço contrafactual da Coinbase Smart Account cujo único dono é
 * `ownerEoa` (embedded wallet Privy). Lê `getAddress` da factory via `eth_call`; não implanta nada.
 * `client` é injetável: em testes, um client viem com transporte `custom` falso.
 */
export async function deriveSmartAccountAddress(client: SmartAccountClient, ownerEoa: Hex): Promise<Hex> {
  if (!isAddress(ownerEoa, { strict: false }) || ZERO_ADDRESS.test(ownerEoa)) {
    throw new TypeError("Endereço do dono da smart account inválido.");
  }
  const account = await toCoinbaseSmartAccount({
    client,
    owners: [getAddress(ownerEoa)],
    version: COINBASE_SMART_ACCOUNT_VERSION,
  });
  const address = await account.getAddress();
  if (!isAddress(address, { strict: false }) || ZERO_ADDRESS.test(address) || isAddressEqual(address, ownerEoa)) {
    throw new Error("A factory devolveu um endereço de smart account inválido.");
  }
  return getAddress(address);
}

/** Subconjunto de `UserOperationReceipt` usado pela observação (formato do viem, já com bigint). */
export interface UserOperationReceiptLike {
  userOpHash: Hex;
  sender: Hex;
  entryPoint?: Hex;
  success: boolean;
  /** Logs emitidos somente durante a execução desta UserOperation. */
  logs: readonly { address: Hex; topics: readonly Hex[]; data: Hex }[];
  receipt: { transactionHash: Hex; blockNumber: bigint };
}

/** Leitura de receipts de UserOperation no bundler; `null` quando ainda não incluída. */
export interface UserOperationReader {
  getUserOperationReceipt(userOpHash: Hex): Promise<UserOperationReceiptLike | null>;
}

/** Adapta um bundler client do viem: `UserOperationReceiptNotFoundError` vira `null`. */
export function createUserOperationReader(bundler: {
  getUserOperationReceipt(args: { hash: Hex }): Promise<UserOperationReceiptLike>;
}): UserOperationReader {
  return {
    async getUserOperationReceipt(userOpHash) {
      try {
        return await bundler.getUserOperationReceipt({ hash: userOpHash });
      } catch (error) {
        const name = (error as { name?: unknown } | null)?.name;
        if (name === "UserOperationReceiptNotFoundError") return null;
        throw error;
      }
    },
  };
}
