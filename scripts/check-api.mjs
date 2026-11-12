import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.MB_TEST_URL ?? "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Execute apenas contra o simulador local.");
let cookie = "";
let checks = 0;

async function request(path, body, options = {}) {
  const headers = { Origin: new URL(base).origin, ...(cookie ? { Cookie: cookie } : {}), ...options.headers };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}/api${path}`, {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (options.captureCookie) cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { status: response.status, data };
}

function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}

async function post(path, body, headers) {
  return request(path, body, { method: "POST", headers });
}

async function transfer(amount, direction = "mb_to_wallet", outcome = "confirmed", key = randomUUID()) {
  return post("/transfers", { direction, amount, outcome }, { "Idempotency-Key": key });
}

async function advance() {
  await new Promise((resolve) => setTimeout(resolve, 2200));
  const result = await post("/simulation/advance");
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}

check((await request("/state")).data.user === null, "Estado anônimo deve estar vazio.");
check((await post("/wallet/activate")).status === 401, "Ativação exige sessão no servidor.");
const email = `qa-${randomUUID()}@example.test`;
const code = await post("/auth/request-code", { email });
check(code.data.demoCode === "123456", "Código demo precisa ser explícito.");
check((await post("/auth/login", { email, code: "000000" })).status >= 400, "Código inválido deve ser recusado.");
const login = await request("/auth/login", { email, code: code.data.demoCode }, { captureCookie: true });
check(login.status === 200 && cookie.length > 0, "Login deve criar sessão por cookie.");
check(login.data.balances.custodialAvailable === "10000.00", "Conta nova recebe apenas saldo fictício inicial.");
check((await post("/wallet/activate")).data.wallet.active, "Ativação deve persistir a wallet simulada.");
check((await post("/simulation/network", { chainId: 1 })).status === 200, "Laboratório deve simular rede incorreta.");
check((await transfer("1.00")).status >= 400, "Rede incorreta deve impedir envio.");
await post("/simulation/network", { chainId: 11155111 });
for (const amount of ["0", "-1", "10000.01", "0.009"]) {
  check((await transfer(amount)).status >= 400, `Valor inválido ${amount} deve ser recusado.`);
}
check((await post("/transfers", { amount: "1", direction: "mb_to_wallet" })).status >= 400, "Idempotency-Key é obrigatório.");
check((await request("/simulation/reset", undefined, { method: "POST", headers: { Origin: "https://other.example" } })).status === 403, "Origem externa deve ser recusada.");

const key = randomUUID();
const pending = await transfer("125.5099", "mb_to_wallet", "confirmed", key);
check(pending.status >= 200 && pending.status < 300, "Transferência válida deve ser aceita.");
check(pending.data.balances.custodialAvailable === "9874.50" && pending.data.balances.custodialReserved === "125.50", "Reserva aplica truncamento e reduz disponível imediatamente.");
check(pending.data.balances.walletAvailable === "0.00", "Não pode haver crédito otimista.");
check(pending.data.reconciliation.balanced, "Total deve conservar reservas em trânsito.");
const repeats = await Promise.all([transfer("125.5099", "mb_to_wallet", "confirmed", key), transfer("125.5099", "mb_to_wallet", "confirmed", key)]);
check(repeats.every((r) => r.data.transactions.length === 1), "Retentativas simultâneas não podem duplicar operação.");
check((await transfer("126.00", "mb_to_wallet", "confirmed", key)).status === 409, "Reutilizar chave com outro valor deve conflitar.");
let state = await advance();
check(state.transactions[0].status === "confirmed" && state.balances.walletAvailable === "125.50", "Confirmação deve creditar destino.");
check(state.transactions[0].hash === null && state.transactions[0].explorerUrl === null, "Simulação não pode se passar por transação on-chain.");
check((await post("/simulation/advance")).data.balances.walletAvailable === "125.50", "Liquidação repetida não pode duplicar crédito.");

await transfer("25.00", "wallet_to_mb");
state = await advance();
check(state.balances.custodialAvailable === "9899.50" && state.balances.walletAvailable === "100.50", "Retorno só credita conta após confirmação.");
await transfer("11.00", "mb_to_wallet", "failed");
await transfer("9.00", "wallet_to_mb", "timeout");
state = await advance();
check(state.transactions.filter((t) => t.status === "failed").length === 2, "Falha e expiração devem ser observáveis.");
check(state.balances.custodialAvailable === "9899.50" && state.balances.walletAvailable === "100.50", "Falha e expiração devem estornar integralmente.");
check(state.reconciliation.balanced && state.reconciliation.differenceMicros === "0", "Reconciliação final deve fechar sem resíduo.");

const firstCookie = cookie;
const otherEmail = `qa-other-${randomUUID()}@example.test`;
await post("/auth/request-code", { email: otherEmail });
await request("/auth/login", { email: otherEmail, code: "123456" }, { captureCookie: true });
state = (await request("/state")).data;
check(state.transactions.length === 0 && !state.wallet.active, "Outra conta não pode ver operações nem carteira da primeira.");
cookie = firstCookie;
state = (await post("/simulation/reset")).data;
check(state.user.email === email && state.transactions.length === 0 && !state.wallet.active, "Reset deve restaurar apenas a conta atual e manter login.");
await post("/auth/logout");
check((await request("/state")).data.user === null, "Logout deve invalidar sessão no servidor.");
console.log(`API verificada: ${checks} verificações passaram, incluindo ida/volta, reservas, idempotência, isolamento e estornos.`);
