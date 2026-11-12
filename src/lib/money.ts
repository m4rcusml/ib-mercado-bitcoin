export class BridgeError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.status = status;
  }
}

export const MICROS_PER_CENT = 10_000n;

/** O TAP determina truncamento antes da validação. Nunca usa Number no valor. */
export function parseAmount(input: unknown): { cents: bigint; micros: bigint; normalized: string } {
  if (typeof input !== "string" || input.length > 48 || !/^\d{1,24}(?:[.,]\d{1,18})?$/.test(input)) {
    throw new BridgeError("INVALID_AMOUNT", "Informe um valor positivo em formato decimal, como 25,50.");
  }
  const [whole, decimal = ""] = input.replace(",", ".").split(".");
  const cents = BigInt(whole) * 100n + BigInt((decimal + "00").slice(0, 2));
  if (cents <= 0n) {
    throw new BridgeError("INVALID_AMOUNT", "O valor deve ser maior que zero após o truncamento para duas casas decimais.");
  }
  if (cents > 9_000_000_000_000n) {
    throw new BridgeError("INVALID_AMOUNT", "O valor informado excede o limite do simulador.");
  }
  return { cents, micros: cents * MICROS_PER_CENT, normalized: formatCents(cents) };
}

export function formatCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export function splitMicros(micros: bigint): { cents: bigint; remainderMicros: bigint } {
  if (micros < 0n) throw new BridgeError("INVALID_AMOUNT", "O saldo não pode ser negativo.");
  return { cents: micros / MICROS_PER_CENT, remainderMicros: micros % MICROS_PER_CENT };
}

export function formatMicros(micros: bigint): string {
  const decimals = (micros % 1_000_000n).toString().padStart(6, "0");
  return `${micros / 1_000_000n}.${decimals.replace(/0+$/, "").padEnd(2, "0")}`;
}
