# Contrato de integração local

A base usa a mesma origem para interface e API: `http://127.0.0.1:3000`. Os tipos públicos ficam em [`src/lib/contracts.ts`](../src/lib/contracts.ts). Todas as operações são fictícias e persistidas no SQLite local.

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

Cada `Transaction` expõe `id`, sentido, valor, status, resultado simulado, horários e chave de idempotência. `simulationId` é um identificador de simulação. `hash` e `explorerUrl` não atestam uma operação real; nesta base não há envio on-chain nem link de transação real.

O helper `splitMicros` e os campos de excedente preservam valores com seis casas, com testes, mas não há endpoint de importação de recebimentos on-chain neste modo. Todos os envios criados pela API são normalizados para duas casas.

Erros usam o formato:

```json
{"error":{"code":"CODIGO_DO_ERRO","message":"Descrição do problema e recuperação."}}
```

Trate códigos HTTP de erro antes de interpretar uma resposta como `BridgeState`. Não atualize o saldo local de forma otimista; substitua-o pelo estado recebido da API.

## Onde conectar a implementação real

| Simulação atual | Integração futura |
| --- | --- |
| Código fixo e cookie de demonstração | Login Privy e validação de sessão no servidor. |
| Ativação local de endereço fictício | Embedded wallet controlada pelo usuário e endereço validado. |
| `outcome` enviado no pedido | Resultado determinado por recibos e eventos verificados, nunca pelo cliente. |
| `simulation/advance` | Observador persistente de transações em Sepolia. |
| SQLite | PostgreSQL com transações atômicas e unicidade dos hashes confirmados. |

Os pontos de código são `src/lib/wallet-provider.ts` para o transporte simulado, `src/lib/ledger.ts` para o ledger e `src/app/api/[...path]/route.ts` para as rotas. O transporte real deve separar envio e observação assíncronos das transações SQLite; não é uma simples troca de resultado ou callback do cliente.

Preserve o contrato de estados e a regra de reserva/estorno ao substituir o transporte. Não libere um crédito com base apenas em um hash enviado pelo navegador. Antes de expor o adaptador real, remova ou isole as rotas de controle da simulação e aplique as verificações de [segurança](security.md).
