import { encodeFunctionData, isAddress } from "viem";

/** Mock USDC de teste (Sepolia) usa 6 casas decimais, como o USDC real. */
export const MOCK_USDC_DECIMALS = 6;

/** 1 centavo = 10^(6-2) unidades do token. */
const UNITS_PER_CENT = 10_000n;

export const mockUsdcAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Transfer",
    anonymous: false,
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Converte centavos (inteiro) para unidades on-chain de 6 decimais. */
export function centsToUnits(cents: bigint): bigint {
  if (typeof cents !== "bigint") {
    throw new TypeError("Valor em centavos deve ser bigint.");
  }
  if (cents < 0n) {
    throw new RangeError("Valor em centavos não pode ser negativo.");
  }
  return cents * UNITS_PER_CENT;
}

/** Calldata de `transfer(to, units)` do ERC-20. */
export function encodeTransferCall(to: `0x${string}`, units: bigint): `0x${string}` {
  if (!isAddress(to, { strict: false })) {
    throw new TypeError("Endereço de destino inválido.");
  }
  if (typeof units !== "bigint" || units < 0n) {
    throw new RangeError("Quantidade de unidades deve ser um bigint não negativo.");
  }
  return encodeFunctionData({ abi: mockUsdcAbi, functionName: "transfer", args: [to, units] });
}
