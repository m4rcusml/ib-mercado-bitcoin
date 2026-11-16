/** Formatadores e conversões de valores usados pela interface (somente código seguro para o navegador). */

export const shortAddress = (value: string) => `${value.slice(0, 7)}…${value.slice(-5)}`;

export function formatAmount(value: string) {
  const [whole = "0", fraction = "00"] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(2, "0").slice(0, 2)}`;
}

export function centsOf(value: string): bigint | null {
  const clean = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d*)?$/.test(clean) || clean.length > 80) return null;
  const [whole, fraction = ""] = clean.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

export function decimalOf(cents: bigint) {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
