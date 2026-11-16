# Arquitetura — MB Wallet Bridge

**Projeto:** MB Wallet Bridge — PoC acadêmica Mercado Bitcoin × Inteli Blockchain

**Prazo da PoC:** 27/11

**Rede:** Ethereum Sepolia (`chainId: 11155111`)
**Escopo:** movimentação de Mock USDC entre uma conta custodial simulada e uma embedded smart account do usuário.

## 1. Visão Geral

O MB Wallet Bridge demonstra uma ponte contábil entre dois domínios de saldo do mesmo usuário:

- **conta custodial simulada:** saldo interno persistido pelo ledger;
- **wallet:** saldo tokenizado em uma smart account ERC-4337 na Sepolia.

A transferência nunca é considerada concluída pelo simples envio de uma operação. O ledger primeiro reserva o saldo da origem, registra a operação e só liquida o crédito no destino depois de verificar no servidor a evidência on-chain: o receipt da transação da tesouraria (`mb_to_wallet`) ou o `UserOperationReceipt` do bundler seguido do receipt da transação do bundle (`wallet_to_mb`). Falha, rejeição ou expiração da observação provocam estorno integral da reserva.

O sistema não integra sistemas privados do Mercado Bitcoin, ativos reais, mainnet, câmbio ou chaves exportáveis. O contrato usado é um Mock USDC de seis casas decimais, destinado somente à Sepolia.

### Decisões arquiteturais

| Decisão | Resultado |
| --- | --- |
| Ledger é a fonte de verdade da conta custodial | A UI e a wallet não alteram saldos internos diretamente. |
| Reserva antes da chamada on-chain | Não há gasto concorrente do mesmo saldo enquanto a UserOperation está pendente. |
| Liquidação somente por receipt validado | O `userOpHash` ou o `txHash`, isoladamente, não dão direito a crédito. |
| Interface `WalletProvider` | O domínio não depende de Privy, viem, RPC ou bundler. |
| `bigint` e unidades inteiras | Não há `number` nem ponto flutuante para valores monetários. |
| EOA embedded é dona/assinante; smart account é a conta operacional | A EOA do Privy não é exportada nem manipulada pelo backend; saldos, origem e destino on-chain usam o endereço da smart account. |
| Segredos de infraestrutura só no servidor | O browser fala com bundler/RPC por `POST /api/rpc` (proxy com allowlist); `PIMLICO_API_KEY` e `ALCHEMY_RPC_URL` nunca chegam ao cliente. |

## 2. Stack e Justificativas

| Camada | Tecnologia | Justificativa |
| --- | --- | --- |
| Aplicação web | Next.js 16, React 19, TypeScript 7 | App Router, rotas HTTP e tipagem para concentrar UI e API na PoC. |
| Autenticação e EOA | `@privy-io/react-auth` | Login por e-mail e EOA embedded sem expor chave privada à aplicação. |
| Cliente Ethereum | `viem` | Clientes tipados para RPC, assinatura e codificação ABI. |
| Account abstraction | `viem/account-abstraction` | Criação de Coinbase Smart Account e envio de UserOperations ERC-4337. |
| Smart account | `toCoinbaseSmartAccount` (viem 2.57.x, `version: "1"`), **EntryPoint v0.6** (`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`) | Endereço contrafactual determinístico e modelo ERC-4337 para a PoC. O viem 2.57.x fixa o EntryPoint v0.6 nessa implementação. |
| Bundler | Pimlico, plano gratuito, Sepolia | Recebe e propaga UserOperations ao EntryPoint. Não é paymaster. Acessado pelo servidor (observação) e pelo browser via proxy `/api/rpc`. |
| RPC | Alchemy, plano gratuito, Sepolia | Leitura de chain, contrato e receipts; derivação do endereço da smart account (factory). Acessado pelo servidor e pelo browser via proxy. |
| Persistência atual | `node:sqlite` / SQLite | Dependência operacional mínima e transações locais atômicas. |
| Persistência futura | PostgreSQL | Concorrência, observadores em múltiplas réplicas e operação publicada. |
| Token de teste | Solidity, OpenZeppelin, Foundry | Mock USDC ERC-20 auditável, testável e com `decimals = 6`. |

O usuário paga o gas da devolução (`wallet_to_mb`): a smart account deve receber ETH de faucet em Sepolia antes do envio (o primeiro envio também implanta a conta via `initCode`). Não há `paymaster`, patrocínio de gas ou fallback para rede principal. O envio `mb_to_wallet` é uma transação comum da tesouraria (EOA do servidor), que paga o próprio gas.

## 3. Diagrama de Componentes

```text
 ┌──────────────────────────────── Browser ────────────────────────────────┐
 │  React / Next.js                                                        │
 │  Privy: login por e-mail + EOA embedded (dona/assinante)                │
 │  viem: toCoinbaseSmartAccount(owner = EOA) + bundler client             │
 │       │ assina a UserOperation           │ JSON-RPC (sem chaves)         │
 └───────┼──────────────────────────────────┼──────────────────────────────┘
         │ REST (sessão)                    │ POST /api/rpc (sessão, allowlist)
         ▼                                  ▼
 ┌────────────────── Next.js API (servidor) ───────────────────────────────┐
 │ /api/wallet/link: token Privy → EOA → factory.getAddress → smart account │
 │ /api/transfers, /submission {userOpHash}, /reconciliation/advance       │
 │ /api/rpc: proxy → Pimlico (métodos 4337) | Alchemy (leituras)           │
 │       │                                                                  │
 │  Ledger (`src/lib/domain/ledger.ts`) ── transação SQL ── SQLite                 │
 │       │                                                                  │
 │  WalletProvider simulated | privy (`src/lib/wallet/privy-wallet-provider.ts`)   │
 │   - tesouraria EOA: MockUSDC.transfer(smartAccount, units)              │
 │   - observação: eth_getUserOperationReceipt + verifyTransfer            │
 └───────┼─────────────────────────────────────────────────────────────────┘
         ▼
 ┌──────────────────── Ethereum Sepolia ───────────────────────────────────┐
 │ Pimlico Bundler ──► EntryPoint v0.6 ──► Coinbase Smart Account          │
 │                                              └──► Mock USDC ERC-20       │
 │ Alchemy RPC: chain, código, factory, logs e receipts                    │
 └─────────────────────────────────────────────────────────────────────────┘
```

A assinatura acontece no browser, onde a EOA embedded está disponível; o browser nunca recebe a chave do Pimlico nem a URL do Alchemy, pois todo JSON-RPC passa pelo proxy autenticado `/api/rpc`. O servidor persiste a intenção, deriva o endereço da smart account, valida a evidência observada e altera o ledger. Nenhum status enviado pelo navegador é aceito como confirmação.

## 4. Camada de Wallet AA ERC-4337

### Papéis

| Ator | Endereço | Assina | Paga gas |
| --- | --- | --- | --- |
| EOA embedded Privy | `wallet.ownerAddress` | UserOperations da smart account (no browser) | — |
| Coinbase Smart Account | `wallet.address` (endereço operacional) | — (valida a assinatura da dona) | Sim, com ETH Sepolia próprio |
| Tesouraria | `TREASURY_ADDRESS` (EOA do servidor) | `MockUSDC.transfer` em `mb_to_wallet` | Sim |

### Vinculação (`POST /api/wallet/link`)

1. O servidor valida o `privyAccessToken` (`PrivyClient.verifyAuthToken`) e lê do Privy a EOA embedded (`linkedAccounts` com `walletClientType: "privy"`).
2. Deriva a smart account com `deriveSmartAccountAddress(client, ownerEoa)` (`src/lib/chain/smart-account.ts`): `toCoinbaseSmartAccount({ client, owners: [ownerEoa], version: "1" })` e `getAddress()` da factory `0x0ba5ed0c6aa8c49038f819e587e2633c4a9f428a` via `eth_call`. Nada é implantado.
3. Persiste `accounts.wallet_address = smartAccount` e `accounts.owner_address = ownerEoa`. Nenhum endereço do cliente é aceito.

O browser precisa usar exatamente a mesma configuração (`version: "1"`, um único dono, `nonce` 0) para que o endereço calculado lá coincida com o do servidor.

### Fronteira `WalletProvider`

```ts
// src/lib/wallet/wallet-provider.ts (resumo)
export interface WalletProvider {
  readonly mode: "simulated" | "privy";
  activate(accountId: string): string | Promise<string>;      // só simulado
  route(direction, walletAddress, amountCents): TransferRoute; // fixa from/to/unidades na reserva
  submit(operation, now): SubmitResult | Promise<SubmitResult>;
  observe(operation, now): ObservationResult | Promise<ObservationResult>; // lança em erro transitório
  signatureRequest(operation): SignatureRequest | null;
}
```

- `submit` em `mb_to_wallet` envia a transação da tesouraria e devolve `{ status: "submitted", txHash }`; em `wallet_to_mb` devolve `awaiting_user_signature`.
- `observe` em `wallet_to_mb`:
  1. `eth_getUserOperationReceipt(userOpHash)` no bundler — ausente ⇒ `pending`;
  2. `sender` diferente da smart account reservada ⇒ `failed`; EntryPoint diferente do v0.6 ⇒ `failed`;
  3. `success === false` ⇒ `failed` ("UserOperation revertida no EntryPoint.");
  4. o `Transfer(smartAccount → tesouraria, units)` do Mock USDC precisa estar entre os **logs da própria UserOperation** (um bundle pode conter outras UserOperations do mesmo sender);
  5. `verifyTransfer` independente, via Alchemy, sobre `receipt.receipt.transactionHash` (chainId, status, token, origem, destino e valor).
  O hash da transação do bundle é devolvido em `ObservationResult.txHash` e persistido pelo ledger (`tx_hash`).
- Erros de RPC/bundler propagam e o ledger marca `unknown`, mantendo a reserva.

### Browser (resumo)

```ts
const account = await toCoinbaseSmartAccount({ client: publicClient, owners: [privyEoaLocalAccount], version: "1" });
// publicClient e bundlerClient usam http("/api/rpc") — o proxy autenticado do servidor.
const userOpHash = await bundlerClient.sendUserOperation({
  account,
  calls: [{ to: signatureRequest.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer",
    args: [signatureRequest.to, BigInt(signatureRequest.amountUnits)] }) }],
  // Sem paymaster: a smart account paga o gas com ETH Sepolia próprio.
});
await fetch(`/api/transfers/${id}/submission`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userOpHash }) });
```

O componente cliente fica em `src/components/privy/`. Antes de assinar, o browser deve conferir que `account.address === signatureRequest.smartAccount`.

## 5. Ledger e Invariantes

`src/lib/domain/ledger.ts` contém a lógica de negócio: reserva, confirmação, estorno, idempotência e reconciliação. `src/lib/domain/money.ts` centraliza a aritmética. O adaptador de wallet não decide saldo, nem chama SQL.

| Invariante | Regra verificável |
| --- | --- |
| Sem ponto flutuante | Entrada é string decimal; cálculo é `bigint`; valores ERC-20 usam unidades mínimas. |
| Decimais | Mock USDC tem 6 decimais; `1 centavo = 10_000` micros. |
| Conservação | `custodial + custodial_reserved + wallet + wallet_reserved`, incluindo restos em micros, permanece igual ao total inicial. |
| Não negatividade | Saldos disponíveis e reservas nunca ficam abaixo de zero. |
| Reserva exclusiva | Uma transferência em processamento reduz a origem e aumenta apenas a reserva correspondente. |
| Crédito condicionado | O destino é creditado uma única vez e somente depois de receipt on-chain validado. |
| Estorno | `failed` ou `timeout` devolvem exatamente a reserva à origem e não creditam o destino. |
| Idempotência | `(account_id, idempotency_key)` é único; reaplicação retorna a mesma transferência. |
| Hash único | `user_op_hash`, quando existente, é único (índice parcial). `tx_hash` é único para envios diretos da tesouraria; em `wallet_to_mb` ele pode se repetir, pois um bundle pode conter várias UserOperations legítimas — a unicidade da devolução é garantida pelo `user_op_hash`. |

Em micros, a reconciliação é:

```text
((custodial_cents + custodial_reserved + wallet_cents + wallet_reserved) * 10_000)
+ custodial_remainder_micros
+ wallet_remainder_micros
= initial_micros
```

Cada mudança composta de saldo e estado deve ocorrer na mesma transação SQLite (`BEGIN IMMEDIATE` no estado atual). Envio de UserOperation e espera de receipt não devem ficar dentro da transação do banco: persistir a intenção/reserva, enviar, persistir o hash e observar por worker/reconciliador recuperável após reinício.

## 6. Fluxos de Transferência

### Estados da transferência

```text
mb_to_wallet:  reserva ─► processing ─(tesouraria envia)─► submitted ─(receipt + Transfer)─► confirmed
                                  └─ erro antes do hash ─► failed          ├─ revert/divergência ─► failed
                                                                           └─ RPC falha ─► unknown ─► …
wallet_to_mb:  reserva ─► awaiting_user_signature ─(userOpHash)─► submitted ─(UserOp receipt + Transfer)─► confirmed
                                  └─ sem assinatura no prazo ─► failed     ├─ revert / sender errado ─► failed
                                                                           └─ bundler/RPC falha ─► unknown ─► …
```

| Estado | Reserva | Saldo destino | Evidência persistida |
| --- | --- | --- | --- |
| `processing` / `awaiting_user_signature` | Mantida | Não altera | chave de idempotência, origem/destino/unidades. |
| `submitted` / `unknown` | Mantida | Não altera | `tx_hash` (tesouraria) ou `user_op_hash` (+ `tx_hash` do bundle quando conhecido). |
| `confirmed` | Consome | Crédito único | receipt validado e `tx_hash`. |
| `failed` | Devolve à origem | Não altera | motivo (revert, sender, divergência ou expiração). |

### MB → Wallet

1. A API valida sessão, Sepolia, smart account vinculada, valor e `Idempotency-Key`.
2. Em uma transação SQL: `custodial_cents -= X` e `custodial_reserved += X`; cria `transfer` em `processing` com `from = tesouraria`, `to = smartAccount`.
3. Fora da transação SQL, a tesouraria (EOA do servidor) envia `MockUSDC.transfer(smartAccount, X * 10_000)`; o `txHash` é salvo e o status vira `submitted`.
4. O reconciliador chama `verifyTransfer` (receipt + evento `Transfer` exatos).
5. Se confirmado: `custodial_reserved -= X`, `wallet_cents += X`.
6. Se falhar ou expirar: `custodial_reserved -= X`, `custodial_cents += X`; grava o motivo.

### Wallet → MB

1. A API valida sessão, Sepolia, smart account vinculada, valor e `Idempotency-Key`.
2. Em uma transação SQL: `wallet_cents -= X` e `wallet_reserved += X`; cria `transfer` em `awaiting_user_signature` com `from = smartAccount`, `to = tesouraria` e expõe `signatureRequest`.
3. No browser, a EOA embedded assina a UserOperation da smart account com `MockUSDC.transfer(TREASURY_ADDRESS, X * 10_000)`; o bundler (via `/api/rpc`) devolve o `userOpHash`, enviado a `POST /api/transfers/{id}/submission`. Status `submitted`.
4. O reconciliador consulta o receipt da UserOperation e valida sender, sucesso, logs da UserOperation e a transação do bundle (seção 4).
5. Se confirmado: `wallet_reserved -= X` e `custodial_cents += X`; grava `tx_hash`.
6. Se falhar ou expirar: `wallet_reserved -= X` e `wallet_cents += X`; grava o motivo.

## 7. Segurança e Restrições

| Área | Controle |
| --- | --- |
| Rede | Aceitar exclusivamente Sepolia (`11155111`); rejeitar qualquer chain diferente. |
| Chaves | Nunca exportar a chave Privy; o backend não recebe a chave da EOA do usuário. |
| Gas | Sem paymaster. Cada smart account precisa de ETH de faucet antes da operação. |
| Token | Validar `MOCK_USDC_ADDRESS`, bytecode/ABI esperado, 6 decimais e logs `Transfer`. |
| Destinos | Em `wallet_to_mb`, aceitar somente `TREASURY_ADDRESS` e `sender` igual à smart account vinculada; em `mb_to_wallet`, somente a smart account vinculada ao usuário. |
| Proxy JSON-RPC | `/api/rpc` exige sessão e modo privy, aplica allowlist de métodos, limita corpo (64 KB), lote (20) e taxa por conta, e só aceita `eth_sendUserOperation`/`eth_estimateUserOperationGas` com `sender` = smart account da sessão e EntryPoint v0.6. |
| Confirmação | Não confiar em hash ou callback do cliente; liquidar apenas após receipt e validação independente. |
| Idempotência | Exigir cabeçalho `Idempotency-Key`; proteger por índice único no banco. |
| Autorização | Associar wallet, sessão e transferência ao mesmo `account_id`; nunca aceitar endereço arbitrário no payload. |
| Segredos | Variáveis somente no servidor, sem prefixo público; não registrar chaves, tokens ou conteúdo de assinatura. |
| Escopo | Sem mainnet, paymaster, ativos reais, saque/depósito bancário ou APIs privadas do MB. |

O token de sessão deve ser armazenado com hash, ter expiração e ser invalidado no logout. Endpoints de mutação devem validar entrada no servidor, limitar tentativas e devolver erros sem detalhes de infraestrutura. Para publicação online, adicionar HTTPS, proteção CSRF adequada ao mecanismo de sessão, rate limit, observabilidade e rotação de segredos.

## 8. Variáveis de Ambiente

| Variável | Obrigatória em | Descrição |
| --- | --- | --- |
| `WALLET_PROVIDER` | Sempre | `simulated` para a base local ou `privy` para a integração Sepolia. Falhar ao iniciar para outro valor. |
| `PRIVY_APP_ID` | `privy` | Identificador público da aplicação Privy usado pelo cliente autenticado. |
| `PRIVY_APP_SECRET` | `privy` | Segredo Privy para validar o token de acesso no servidor. |
| `PIMLICO_API_KEY` | `privy` | Chave do bundler Pimlico Sepolia. Somente servidor (observação e proxy `/api/rpc`); nunca `NEXT_PUBLIC_`. |
| `ALCHEMY_RPC_URL` | `privy` | URL HTTPS do RPC Alchemy apontando exclusivamente para Sepolia. Somente servidor. |
| `MOCK_USDC_ADDRESS` | `privy` | Endereço Sepolia do Mock USDC implantado pela PoC. |
| `TREASURY_ADDRESS` | `privy` | Endereço Sepolia que recebe tokens no fluxo wallet → MB e origina o fluxo MB → wallet. |
| `TREASURY_PRIVATE_KEY` | `privy` | Chave da tesouraria de teste (somente servidor). |
| `MB_DATABASE_PATH` | Opcional | Caminho SQLite. Padrão atual: `data/bridge.sqlite`. |

Exemplo de configuração local (não versionar `.env.local`):

```dotenv
WALLET_PROVIDER=simulated
MB_DATABASE_PATH=data/bridge.sqlite

# Habilitar somente após deploy/configuração em Sepolia
# PRIVY_APP_ID=...
# PIMLICO_API_KEY=...
# ALCHEMY_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/...
# MOCK_USDC_ADDRESS=0x...
# TREASURY_ADDRESS=0x...
```

## 9. Evolução Futura

| Etapa | Mudança | Condição de aceite |
| --- | --- | --- |
| Até o Demo Day | Adaptador Privy/viem com smart account (EntryPoint v0.6), Mock USDC e observador recuperável | Fluxos nos dois sentidos em Sepolia, com sucesso, revert e estorno demonstráveis. |
| Persistência | SQLite → PostgreSQL | Migrações, locks/isolamento equivalentes, índices de idempotência/hash e testes de concorrência. |
| Confiabilidade | Worker de reconciliação e estado `unknown` | Retomada após reinício e tratamento de receipt tardio sem crédito duplicado. |
| Custos | Paymaster após a PoC | Política de patrocínio, limites, antifraude e monitoramento aprovados; não faz parte do prazo atual. |
| Publicação | Deploy online | HTTPS, gestão de segredos, telemetria, rate limit, alertas e banco gerenciado. |
| Produto | Histórico e consulta pública controlada | Modelo de autorização, retenção de dados e observabilidade definidos. |

A migração para PostgreSQL e a publicação não alteram os invariantes do ledger nem a regra central: reservas protegem o saldo; somente uma confirmação on-chain validada permite liquidar o crédito no destino.
