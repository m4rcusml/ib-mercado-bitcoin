import type { Ledger } from "../domain/ledger.ts";

/** Intervalo do comentário de keep-alive; mantém proxies e o navegador com a conexão aberta. */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events do estado da conta. Envia o estado atual ao conectar e, depois,
 * sempre que o ledger sinaliza mudança da conta (worker de reconciliação ou ação na API).
 * Estados idênticos ao último enviado são descartados. O stream fecha quando o cliente
 * desconecta (`signal`) ou o ledger é fechado.
 */
export function stateEventStream(ledger: Ledger, accountId: string, signal: AbortSignal, heartbeatMs = SSE_HEARTBEAT_MS): Response {
  const encoder = new TextEncoder();
  let close = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let last = "";
      const send = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { close(); }
      };
      const push = () => {
        let json: string;
        try { json = JSON.stringify(ledger.state(accountId)); } catch { close(); return; }
        if (json === last) return;
        last = json;
        send(`event: state\ndata: ${json}\n\n`);
      };
      const unsubscribe = ledger.onChange(accountId, push);
      const heartbeat = setInterval(() => send(": ping\n\n"), heartbeatMs);
      heartbeat.unref?.();
      close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        signal.removeEventListener("abort", close);
        try { controller.close(); } catch { /* já fechado */ }
      };
      signal.addEventListener("abort", close);
      if (signal.aborted) { close(); return; }
      send("retry: 3000\n\n"); // reconexão automática do EventSource após 3 s
      push();
    },
    cancel() { close(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
