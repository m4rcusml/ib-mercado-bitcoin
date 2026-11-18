import { TransactionReceiptNotFoundError, decodeEventLog, isAddressEqual } from "viem";
import { mockUsdcAbi } from "./mock-usdc.ts";

export interface ExpectedTransfer {
  txHash: `0x${string}`;
  token: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  units: bigint;
  chainId: number;
}

export type VerificationResult =
  | { status: "confirmed"; blockNumber: bigint }
  | { status: "failed"; reason: string }
  | { status: "pending" };

export interface ReceiptReader {
  getChainId(): Promise<number>;
  getTransactionReceipt(args: { hash: `0x${string}` }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    logs: readonly { address: `0x${string}`; topics: readonly `0x${string}`[]; data: `0x${string}` }[];
  }>;
}

type Receipt = Awaited<ReturnType<ReceiptReader["getTransactionReceipt"]>>;

function isReceiptNotFound(error: unknown): boolean {
  if (error instanceof TransactionReceiptNotFoundError) return true;
  // Cópias duplicadas do viem (bundles distintos) podem quebrar instanceof.
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "TransactionReceiptNotFoundError"
  );
}

/**
 * Verifica independentemente, no servidor, que `txHash` foi minerada com sucesso
 * na rede esperada e emitiu um `Transfer` do token correto com origem, destino e
 * valor exatos. Erros de RPC que não sejam "receipt não encontrado" são relançados
 * para que o chamador os trate como estado `unknown`.
 */
export async function verifyTransfer(
  client: ReceiptReader,
  expected: ExpectedTransfer,
): Promise<VerificationResult> {
  const chainId = await client.getChainId();
  if (chainId !== expected.chainId) {
    return {
      status: "failed",
      reason: `Rede incorreta: esperado chainId ${expected.chainId}, recebido ${chainId}.`,
    };
  }

  let receipt: Receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: expected.txHash });
  } catch (error) {
    if (isReceiptNotFound(error)) return { status: "pending" };
    throw error;
  }

  if (receipt.status === "reverted") {
    return { status: "failed", reason: "Transação revertida na rede." };
  }

  let sawTokenTransfer = false;
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, expected.token)) continue;
    let args: { from: `0x${string}`; to: `0x${string}`; value: bigint };
    try {
      ({ args } = decodeEventLog({
        abi: mockUsdcAbi,
        eventName: "Transfer",
        topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]],
        data: log.data,
        strict: true,
      }));
    } catch {
      continue; // log do token que não é Transfer
    }
    sawTokenTransfer = true;
    if (
      isAddressEqual(args.from, expected.from) &&
      isAddressEqual(args.to, expected.to) &&
      args.value === expected.units
    ) {
      return { status: "confirmed", blockNumber: receipt.blockNumber };
    }
  }

  return {
    status: "failed",
    reason: sawTokenTransfer
      ? "Evento Transfer do token não corresponde à origem, ao destino ou ao valor esperados."
      : "Nenhum evento Transfer do contrato esperado foi encontrado na transação.",
  };
}
