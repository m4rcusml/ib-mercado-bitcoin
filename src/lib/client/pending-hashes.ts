/** `userOpHash` já devolvido pelo bundler e ainda não registrado no servidor, por transferência. */
export const PENDING_HASHES_KEY = "mb-bridge:pending-user-operations";

export function readPendingHashes(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(PENDING_HASHES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function writePendingHashes(value: Record<string, string>) {
  try {
    window.localStorage.setItem(PENDING_HASHES_KEY, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível: o hash fica só em memória */
  }
}
