# Contrato de integração local

A base usa a mesma origem para interface e API: `http://127.0.0.1:3000`. Os tipos públicos ficam em [`src/lib/domain/contracts.ts`](../src/lib/domain/contracts.ts). Todas as operações são fictícias e persistidas no SQLite local.

> **Modos:** `WALLET_PROVIDER=simulated` (padrão) mantém todo o contrato abaixo sem rede. `WALLET_PROVIDER=privy` ativa a PoC Sepolia descrita em [Modo Privy](#modo-privy--poc-sepolia): as rotas `/api/simulation/*` ficam desativadas e o resultado de cada operação é decidido somente pela verificação on-chain no servidor. Consulte o [roadmap](roadmap-poc-sepolia.md).

## Sessão de demonstração

| Método e rota | Corpo JSON | Resultado |
| --- | --- | --- |
| `GET /api/state` | — | `BridgeState`; sem login, `user` é nulo e os saldos são zero. |
| `POST /api/auth/request-code` | `{"email":"equipe@example.com"}` | Código de demonstração `123456` e mensagem. Nenhum e-mail é enviado. |
| `POST /api/auth/login` | `{"email":"equipe@example.com","code":"123456"}` | Estado autenticado e cookie de sessão opaco `HttpOnly`, `SameSite=Strict`. |
| `POST /api/auth/logout` | — | Invalida a sessão no servidor, remove o cookie e devolve `BridgeState` anônimo. |

O login exige chamar `request-code` antes, para o mesmo e-mail. O desafio expira em dez minutos e é consumido no login; solicite outro para um novo login. A sessão dura 24 horas. O cookie `mb_demo_session` é mantido pelo navegador; em um cliente HTTP, preserve os cookies entre as chamadas. A autenticação acima permite exercitar a jornada; não comprova a posse do endereço de e-mail.

## Carteira e transferências

| Método e rota | Corpo JSON | Resultado |
| --- | --- | --- |
| `POST /api/wallet/activate` | — | `BridgeState` com carteira fictícia ativa. |
| `POST /api/transfers` | `{"direction":"mb_to_wallet","amount":"125.50","outcome":"confirmed"}` | `BridgeState` com operação `processing` e reserva na origem. Exige `Idempotency-Key`. |
| `POST /api/simulation/advance` | — | Liquida operações cujo `settlesAt` já passou; devolve `BridgeState`. |
| `POST /api/simulation/network` | `{"chainId":11155111}` | Altera a rede simulada, desde que não haja operação em processamento. Outra rede bloqueia novas transferências. |
| `POST /api/simulation/reset` | — | Apaga operações, restaura saldos e rede Sepolia e desativa a carteira da conta autenticada. Mantém o login. |

Direções: `mb_to_wallet` e `wallet_to_mb`. Resultado simulado opcional: `confirmed`, `failed` ou `timeout`; o padrão é confirmação. A liquidação é elegível aproximadamente dois segundos após criar a operação, conforme `settlesAt`, e ocorre na chamada explícita a `/api/simulation/advance`. Ler `/api/state` não liquida operações.

`timeout` exercita expiração da observação e estorno. Ele termina com status `failed`, como uma falha, com o motivo correspondente. Não representa observação de uma blockchain.

As rotas acima exigem sessão, exceto a leitura de estado anônimo e as rotas de autenticação. Envie corpos com `Content-Type: application/json`, com no máximo 4 KB. `Idempotency-Key` aceita de 8 a 128 caracteres em `[A-Za-z0-9._:-]`; reutilizar a chave com outro valor normalizado, direção ou resultado simulado devolve conflito `409`.

## Exemplo a partir da interface autenticada

Execute no console do navegador aberto nesta aplicação, após solicitar o código, entrar e ativar a carteira. Cada nova intenção de transferência recebe uma chave. Para repetir a mesma intenção após uma interrupção de rede, reutilize a chave e o mesmo corpo.

```javascript
const key = crypto.randomUUID();
const response = await fetch('/api/transfers', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  },
  body: JSON.stringify({
    direction: 'mb_to_wallet',
    amount: '125.50',
    outcome: 'confirmed',
  }),
});
const state = await response.json();
console.log(response.status, state);
```

Após `settlesAt`, avance a simulação:

```javascript
const settlementResponse = await fetch('/api/simulation/advance', { method: 'POST' });
console.log(await settlementResponse.json());
```

O primeiro resultado contém a reserva; o segundo, após o prazo, deve mostrar a operação confirmada e o crédito na carteira. Para retornar o valor, crie outra intenção com `direction: 'wallet_to_mb'` e uma nova chave.

## Tipos e regras de valores

`amount` é uma string decimal, nunca um número JSON. Recomenda-se ponto na API, por exemplo `"10.25"`; o parser também aceita `"10,25"`. Não envie separadores de milhar nem notação exponencial. A regra adotada é truncar em duas casas antes de validar; a divergência do TAP está registrada em [arquitetura](architecture.md).

`amountMicros`, os campos `*RemainderMicros` e os campos de reconciliação são strings de inteiros, apropriadas para conversão com `BigInt`. Não use `parseFloat` ou `Number` no caminho do saldo. Consulte o contrato TypeScript para distinguir valores decimais de unidades mínimas.

O objeto `balances` separa disponível e reservado para conta custodial e carteira. `reconciliation.balanced` deve continuar verdadeiro durante processamento, confirmação e falha; `differenceMicros` deve ser `"0"`.

Cada `Transaction` expõe `id`, sentido, valor, status, resultado simulado, horários e chave de idempotência. `simulationId` é um identificador de simulação. No modo simulado, `hash`, `txHash`, `explorerUrl`, `fromAddress`, `toAddress`, `amountUnits`, `signatureRequest` e `submittedAt` são sempre `null`. O `BridgeState` inclui `mode` (`"simulated"` ou `"privy"`) e `privyAppId` (nulo no modo simulado).

O helper `splitMicros` e os campos de excedente preservam valores com seis casas, com testes, mas não há endpoint de importação de recebimentos on-chain neste modo. Todos os envios criados pela API são normalizados para duas casas.

Erros usam o formato:

```json
{"error":{"code":"CODIGO_DO_ERRO","message":"Descrição do problema e recuperação."}}
```

Trate códigos HTTP de erro antes de interpretar uma resposta como `BridgeState`. Não atualize o saldo local de forma otimista; substitua-o pelo estado recebido da API.

## Modo Privy — PoC Sepolia

Ativado com `WALLET_PROVIDER=privy`. Exige no servidor `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PIMLICO_API_KEY`, `ALCHEMY_RPC_URL`, `MOCK_USDC_ADDRESS`, `TREASURY_ADDRESS` e `TREASURY_PRIVATE_KEY`. A configuração Sepolia é lida de forma preguiçosa: sem ela, `GET /api/state` funciona e as operações on-chain respondem `503 MISSING_CONFIG` (a mensagem cita apenas nomes de variáveis). O modo simulado nunca lê essas variáveis.

**Account abstraction (ERC-4337):** a EOA embedded do Privy é somente dona/assinante. O endereço operacional do usuário é uma **Coinbase Smart Account** (`toCoinbaseSmartAccount` do viem 2.57.x, `version: "1"`, **EntryPoint v0.6** `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`), derivada no servidor. Devoluções (`wallet_to_mb`) são UserOperations enviadas ao bundler Pimlico **sem paymaster**: a smart account paga o gas com ETH Sepolia próprio.

Parâmetros opcionais (milissegundos):

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `POC_OBSERVATION_TIMEOUT_MS` | `900000` (15 min) | `submitted`/`unknown` sem confirmação após esse tempo desde o envio vira `failed` com estorno. |
| `POC_SIGNATURE_TIMEOUT_MS` | `600000` (10 min) | `awaiting_user_signature` sem `userOpHash` após esse tempo desde a criação vira `failed` com estorno ("Assinatura não recebida"). |
| `POC_RECONCILE_INTERVAL_MS` | `5000` | Intervalo do worker de reconciliação em segundo plano. |

### Estados

| Status | Significado | Reserva |
| --- | --- | --- |
| `processing` | Modo simulado (ou envio da tesouraria ainda em curso no servidor). | Mantida |
| `awaiting_user_signature` | `wallet_to_mb` aguardando o browser assinar a UserOperation e informar o `userOpHash`. Expõe `signatureRequest`. | Mantida |
| `submitted` | Hash registrado (tx da tesouraria ou `userOpHash`); aguardando verificação. | Mantida |
| `unknown` | Falha temporária ao consultar RPC/bundler; nova tentativa automática. | Mantida |
| `confirmed` | Receipt(s) e evento `Transfer` verificados no servidor. | Consumida, destino creditado |
| `failed` | Revert, sender errado, evento divergente, expiração ou erro antes do envio. `failureReason` registra o motivo. | Devolvida à origem |

### Endpoints

| Método e rota | Corpo JSON | Resultado |
| --- | --- | --- |
| `POST /api/wallet/link` | `{"privyAccessToken":"<token do SDK Privy>"}` | O servidor valida o token (`PrivyClient.verifyAuthToken`), obtém a EOA embedded (`linkedAccounts` com `type: "wallet"` e `walletClientType: "privy"`), **deriva a smart account** pela factory on-chain e grava ambas. Nenhum endereço do cliente é aceito. Erros: `INVALID_PRIVY_TOKEN` (400/401), `EMBEDDED_WALLET_NOT_FOUND` (409), `WALLET_ALREADY_LINKED` (409), `PENDING_TRANSACTION` (409), `SMART_ACCOUNT_UNAVAILABLE` (502), `MISSING_CONFIG` (503). No modo simulado: `409 PRIVY_DISABLED`. |
| `POST /api/transfers` | `{"direction":"mb_to_wallet","amount":"12.50"}` | Igual ao modo simulado, mas `outcome` é recusado (`400 SIMULATION_DISABLED`) e exige wallet vinculada (`409 WALLET_INACTIVE`). `mb_to_wallet`: a tesouraria envia `MockUSDC.transfer(smartAccount, unidades)` e a operação volta `submitted` com `txHash`. `wallet_to_mb`: volta `awaiting_user_signature` com `signatureRequest`. |
| `POST /api/transfers/{id}/submission` | `{"userOpHash":"0x…64 hex"}` | Vincula o hash da UserOperation: `awaiting_user_signature` → `submitted`. Exige sessão e que a operação (`wallet_to_mb`) pertença à conta. Reenviar o mesmo hash é idempotente. O corpo antigo `{"txHash":…}` não é mais aceito. Erros: `INVALID_USER_OP_HASH` (400), `TRANSFER_NOT_FOUND` (404), `INVALID_TRANSFER_STATUS` (409), `DUPLICATE_USER_OP_HASH` (409). **Não liquida saldo.** |
| `POST /api/rpc` | Request JSON-RPC 2.0 ou lote (até 20) | Proxy do browser para bundler/RPC; ver abaixo. |
| `POST /api/reconciliation/advance` | — | Observa as operações pendentes da conta e devolve `BridgeState`. Disponível nos dois modos. |
| `POST /api/wallet/activate` | — | No modo privy: `409 WALLET_LINK_REQUIRED`, apontando para `/api/wallet/link`. |
| `POST /api/simulation/*` | — | No modo privy: `403 SIMULATION_DISABLED`. |

### Proxy JSON-RPC `POST /api/rpc`

Permite ao browser usar `http("/api/rpc")` como transporte do viem (public client e bundler client) sem conhecer `PIMLICO_API_KEY` nem `ALCHEMY_RPC_URL`.

- Exige sessão (`mb_demo_session`, mesmo cookie das demais rotas; `401 UNAUTHORIZED`), mesma origem e `WALLET_PROVIDER=privy` (`409 PRIVY_DISABLED`). Corpo `application/json` de no máximo 64 KB (`413 BODY_TOO_LARGE`). Até 240 chamadas por minuto por conta, contando cada item de lote (`429 RATE_LIMITED`). Configuração ausente: `503 MISSING_CONFIG`.
- Métodos encaminhados ao **Pimlico** (Sepolia): `eth_sendUserOperation`, `eth_estimateUserOperationGas`, `eth_getUserOperationReceipt`, `eth_getUserOperationByHash`, `eth_supportedEntryPoints`, `pimlico_getUserOperationGasPrice`.
- Métodos encaminhados ao **Alchemy** (Sepolia): `eth_chainId`, `eth_call`, `eth_getCode`, `eth_getBalance`, `eth_blockNumber`, `eth_estimateGas`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_getTransactionCount`, `eth_getBlockByNumber`, `eth_getTransactionReceipt`.
- Qualquer outro método (ex.: `eth_sendRawTransaction`, `debug_*`) responde erro JSON-RPC `-32601`. Request malformado: `-32600`; `params` que não seja lista: `-32602`.
- `eth_sendUserOperation` e `eth_estimateUserOperationGas` exigem `params[0].sender` igual à smart account vinculada à sessão e `params[1]` igual ao EntryPoint v0.6; caso contrário respondem `{"code":-32602,"message":"SMART_ACCOUNT_MISMATCH: …","data":{"code":"SMART_ACCOUNT_MISMATCH"}}` sem chamar o bundler.
- Erros JSON-RPC do upstream são repassados (código, mensagem e `data`) sem URLs; falha de rede/timeout vira `-32603` genérico. O `id` do cliente é preservado. Respostas JSON-RPC usam HTTP 200; erros de sessão/configuração usam o formato `{"error":{"code","message"}}` com o status HTTP indicado.

### Contrato JSON no modo privy

```ts
// BridgeState.wallet
{
  active: boolean,                 // true somente com smart account e EOA dona vinculadas
  address: string | null,          // Coinbase Smart Account (endereço operacional)
  ownerAddress: string | null,     // EOA embedded Privy (dona/assinante)
  simulated: false,
  smartAccount: { type: "coinbase", entryPoint: "0.6" } | null,
}
// No modo simulado: { active, address /*fictício*/, ownerAddress: null, simulated: true, smartAccount: null }

// Transaction
{
  status: "awaiting_user_signature" | "submitted" | "unknown" | "confirmed" | "failed",
  userOpHash: string | null,      // wallet_to_mb: hash da UserOperation (0x… minúsculo)
  txHash: string | null,          // mb_to_wallet: tx da tesouraria; wallet_to_mb: tx do bundle, após o receipt do bundler
  hash: string | null,            // igual a txHash (compatibilidade)
  explorerUrl: string | null,     // https://sepolia.etherscan.io/tx/<txHash>, quando txHash é conhecido
  fromAddress: string | null,     // tesouraria (mb_to_wallet) ou smart account (wallet_to_mb)
  toAddress: string | null,       // smart account (mb_to_wallet) ou tesouraria (wallet_to_mb)
  amountUnits: string | null,     // inteiro com 6 decimais, ex. "12500000" = 12,50
  submittedAt: string | null,     // ISO, quando o hash foi registrado
  signatureRequest: {             // somente em awaiting_user_signature
    chainId: 11155111,
    token: string,                // contrato Mock USDC (alvo da chamada)
    to: string,                   // tesouraria (destino do transfer)
    amountUnits: string,
    smartAccount: string,         // sender esperado da UserOperation
    ownerAddress: string,         // EOA que assina
    entryPoint: "0.6",
  } | null,
}
```

`BridgeState.mode` é `"privy"` e `BridgeState.privyAppId` traz o App ID público (nunca o segredo).

### Fluxo `wallet_to_mb` no browser

```javascript
const state = await (await fetch('/api/transfers', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
  body: JSON.stringify({ direction: 'wallet_to_mb', amount: '40.00' }),
})).json();
const tx = state.transactions[0];
const { token, to, amountUnits, smartAccount } = tx.signatureRequest;
// publicClient/bundlerClient com transport http('/api/rpc'); account = toCoinbaseSmartAccount({ client, owners: [eoaPrivy], version: '1' })
// confira account.address === smartAccount antes de assinar
// userOpHash = await bundlerClient.sendUserOperation({ account, calls: [{ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, BigInt(amountUnits)] }) }] })
await fetch(`/api/transfers/${tx.id}/submission`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userOpHash }),
});
// Depois, consulte /api/reconciliation/advance (ou /api/state) até `confirmed`/`failed`.
```

Se o envio do hash falhar por rede, reenvie o mesmo `userOpHash`: a rota é idempotente. Se o usuário recusar a assinatura, a operação expira após `POC_SIGNATURE_TIMEOUT_MS` e a reserva volta à wallet. A smart account precisa de ETH Sepolia para pagar o gas (inclusive o deploy na primeira UserOperation).

### Observação, expiração e retomada

- Envio e observação nunca ocorrem dentro de uma transação SQLite: reserva → commit → chamada de rede → persistência.
- `mb_to_wallet`: `verifyTransfer` com `chainId` 11155111, contrato Mock USDC, origem (tesouraria), destino (smart account) e unidades persistidos na reserva.
- `wallet_to_mb`: `eth_getUserOperationReceipt(userOpHash)` no bundler. Ausente ⇒ continua `submitted`. `sender` diferente da smart account ou EntryPoint diferente do v0.6 ⇒ `failed`. `success: false` ⇒ `failed` ("UserOperation revertida no EntryPoint."). O `Transfer` esperado precisa constar nos logs da própria UserOperation; em seguida `verifyTransfer` independente (Alchemy) sobre a transação do bundle, cujo hash é persistido em `txHash`.
- Resultado `pending` mantém `submitted` (nova consulta após ~3 s). Erro de RPC/bundler marca `unknown` e mantém a reserva.
- A liquidação é um único `UPDATE` protegido pelo status atual; o saldo só se move quando esse `UPDATE` altera exatamente uma linha. Observações simultâneas da mesma operação no mesmo processo são evitadas.
- `user_op_hash` é único (índice parcial); `tx_hash` é único apenas para envios diretos da tesouraria, pois um bundle pode carregar várias UserOperations.
- Expiração explícita e auditável: `submitted`/`unknown` além de `POC_OBSERVATION_TIMEOUT_MS` e `awaiting_user_signature` além de `POC_SIGNATURE_TIMEOUT_MS` viram `failed` com estorno e motivo em `failureReason`. Antes de expirar uma operação com hash, uma última observação é feita; se ela confirmar, a operação é confirmada. Uma operação interrompida antes de persistir o hash (queda do processo durante o envio da tesouraria) também expira com estorno após `POC_OBSERVATION_TIMEOUT_MS`.
- `reconcileAll()` processa as pendências de todas as contas; no modo privy, um worker em segundo plano o executa no boot e a cada `POC_RECONCILE_INTERVAL_MS`, retomando operações persistidas antes de um reinício.
- Mensagens de erro de RPC/bundler são reduzidas antes de persistir/expor; URLs (que podem conter chave de API) são omitidas.

### Atualização em tempo real — `GET /api/events` (SSE)

- Server-Sent Events autenticado pelo cookie `mb_demo_session` (sem sessão ⇒ 401). Disponível nos dois modos.
- Ao conectar, envia `event: state` com o mesmo JSON de `GET /api/state`; depois envia um novo `event: state` sempre que o estado da conta muda. Estados idênticos ao último enviado são descartados.
- Gatilhos: cada transferência processada pelo worker de reconciliação/`advance()` e cada ação autenticada na API (transferência, submissão de `userOpHash`, vínculo de wallet, simulação). Mudanças feitas em outra aba chegam por aqui.
- `retry: 3000` orienta a reconexão automática do `EventSource`; um comentário `: ping` a cada 15 s mantém a conexão viva.
- A interface usa o SSE no modo privy e só volta ao polling de `POST /api/reconciliation/advance` enquanto a conexão estiver caída. No modo simulado o polling de `/api/simulation/advance` continua, pois é ele que avança a simulação.
- Limitação: o barramento de eventos é em memória (um processo). Com várias réplicas seria necessário um pub/sub externo (ex.: PostgreSQL `LISTEN/NOTIFY` ou Redis).

### Limitações conhecidas da PoC

Ver [segurança](security.md#limitações-conhecidas-reconciliação-manual): estorno seguido de mineração tardia e queda do processo após a transmissão da tesouraria exigem reconciliação manual. Instância única com SQLite; múltiplas réplicas exigiriam lock distribuído e PostgreSQL.

Os pontos de código são `src/lib/wallet/wallet-provider.ts` (contrato do provider e modo simulado), `src/lib/wallet/privy-wallet-provider.ts` (tesouraria, observação e vinculação Privy), `src/lib/chain/` (viem; `smart-account.ts` deriva a smart account e lê receipts de UserOperation), `src/lib/server/rpc-proxy.ts` (proxy JSON-RPC), `src/lib/domain/ledger.ts` (estados, reserva, liquidação, worker) e `src/app/api/[...path]/route.ts` (rotas).
