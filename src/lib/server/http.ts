import { BridgeError } from "../domain/money.ts";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    const requestUrl = new URL(request.url);
    // Next pode representar a URL como localhost mesmo quando o navegador acessa 127.0.0.1.
    const host = request.headers.get("host") ?? requestUrl.host;
    if (new URL(origin).origin === new URL(`${requestUrl.protocol}//${host}`).origin) return;
  } catch { /* Uma origem inválida é recusada abaixo. */ }
  throw new BridgeError("INVALID_ORIGIN", "Esta operação deve ser feita pela aplicação local.", 403);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const value = await readJsonValue(request, 4_096);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeError("INVALID_JSON", "Envie um objeto JSON válido.");
  }
  return value as Record<string, unknown>;
}

/** Lê qualquer valor JSON (objeto ou lista) limitado a `limit` bytes. */
export async function readJsonValue(request: Request, limit: number): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new BridgeError("INVALID_CONTENT_TYPE", "Envie o corpo no formato application/json.", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new BridgeError("INVALID_JSON", "Envie um objeto JSON válido.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new BridgeError("BODY_TOO_LARGE", `O corpo da requisição excede ${Math.floor(limit / 1024)} KB.`, 413);
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new BridgeError("INVALID_JSON", "Envie um JSON válido."); }
  return value;
}

export function sessionToken(request: Request): string | null {
  return request.headers.get("cookie")?.match(/(?:^|;\s*)mb_demo_session=([a-f0-9]{64})(?:;|$)/)?.[1] ?? null;
}

export function responseJson(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof BridgeError) return responseJson({ error: { code: error.code, message: error.message } }, error.status);
  console.error("Erro interno do simulador");
  return responseJson({ error: { code: "INTERNAL_ERROR", message: "Não foi possível concluir a operação. Tente novamente." } }, 500);
}
