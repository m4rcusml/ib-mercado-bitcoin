import { test } from "vitest";
import assert from "node:assert/strict";
import { Ledger } from "../../src/lib/domain/ledger.ts";
import { stateEventStream } from "../../src/lib/server/sse.ts";

function login(ledger: Ledger, email = "sse@example.com") {
  ledger.requestCode(email, 1_000);
  const result = ledger.login(email, "123456", 1_000);
  return ledger.accountForSession(result.token, 1_000)!;
}

type StateEvent = { balances: { custodialAvailable: string }; transactions: unknown[] };

/** Lê eventos `state` do stream SSE, ignorando comentários e `retry`. */
async function nextState(reader: ReadableStreamDefaultReader<Uint8Array>, buffer: { text: string }): Promise<StateEvent> {
  const decoder = new TextDecoder();
  for (;;) {
    const match = /event: state\ndata: (.*)\n\n/.exec(buffer.text);
    if (match) {
      buffer.text = buffer.text.slice(match.index + match[0].length);
      return JSON.parse(match[1]) as StateEvent;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error("stream encerrado antes do evento");
    buffer.text += decoder.decode(value, { stream: true });
  }
}

test("SSE envia o estado ao conectar, a cada mudança, deduplica e fecha ao abortar", async () => {
  const ledger = new Ledger(":memory:");
  try {
    const accountId = login(ledger);
    const abort = new AbortController();
    const response = stateEventStream(ledger, accountId, abort.signal, 60_000);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const reader = response.body!.getReader();
    const buffer = { text: "" };

    const initial = await nextState(reader, buffer);
    assert.equal(initial.transactions.length, 0);

    // Notificação sem mudança real não gera evento; a próxima mudança real gera.
    ledger.notifyChange(accountId);
    await ledger.activateWallet(accountId);
    await ledger.transfer(accountId, { direction: "mb_to_wallet", amount: "1.00" }, "sse-0001", 2_000);
    ledger.notifyChange(accountId);
    const changed = await nextState(reader, buffer);
    assert.equal(changed.transactions.length, 1);
    assert.equal(buffer.text.includes("event: state"), false);

    abort.abort();
    const end = await reader.read();
    assert.equal(end.done, true);
  } finally {
    ledger.close();
  }
});

test("SSE de outra conta não recebe mudanças alheias", async () => {
  const ledger = new Ledger(":memory:");
  try {
    const a = login(ledger, "a@example.com");
    const b = login(ledger, "b@example.com");
    let calls = 0;
    const off = ledger.onChange(b, () => { calls += 1; });
    ledger.notifyChange(a);
    assert.equal(calls, 0);
    ledger.notifyChange(b);
    assert.equal(calls, 1);
    off();
    ledger.notifyChange(b);
    assert.equal(calls, 1);
  } finally {
    ledger.close();
  }
});
