# Validação

Estado das verificações em 16/11/2026, no branch `feat/poc-sepolia-account-abstraction`, com Node.js 24 ou superior e Next.js 16.4.6. A validação anterior (12/11/2026) cobria apenas o modo simulado; esta substitui aquela e inclui a PoC Sepolia (modo `privy`).

## Verificações locais (sem rede)

| Verificação | Resultado |
| --- | --- |
| `npm test` | **94 testes passaram**, sem rede. Arquivos: `tests/domain/ledger.test.ts`; `tests/wallet/` (`wallet-provider`, `privy-wallet-provider`, `submit`); `tests/chain/chain.test.ts`; `tests/server/` (`http`, `rpc-proxy`, `sse`). |
| `npm run typecheck` | Passou. |
| `npm run build` | Build de produção passou. |
| `npm run test:api` | Exercita a API HTTP de ponta a ponta contra o servidor local (modo simulado): login, ida e volta, reservas, falhas, expiração, idempotência, rede e isolamento entre contas. |

No Windows, rode o Vitest pelo **PowerShell**; no Git Bash a diferença de maiúscula na letra do drive faz a suíte carregar duas vezes ("failed to find the current suite").

Os testes unitários cobrem, com RPC, bundler e Privy falsos: conservação do total, precisão em seis decimais sem ponto flutuante, reserva e estorno, idempotência, liquidação única com observações concorrentes, expiração por assinatura e por observação, retomada após reabrir o SQLite, receipt revertido, `Transfer` adulterado (token, origem, destino ou valor), `sender`/EntryPoint divergentes na UserOperation, allowlist e sanitização do proxy `/api/rpc` e entrega de eventos SSE.

## Verificações com a Sepolia

| Verificação | O que faz | Resultado esperado |
| --- | --- | --- |
| `npm run preflight:poc` | Presença e formato das variáveis, sem rede e sem imprimir valores. | Tudo OK. |
| `npm run diagnose:sepolia` | chainId 11155111, bytecode e `decimals() = 6` do token, ETH e mUSDC da tesouraria, Pimlico com EntryPoint v0.6. | Todas as linhas `PASS`. |
| `npm run reconcile:onchain` | Somente leitura: compara, por conta, o saldo de wallet do ledger com `balanceOf(smartAccount)` do Mock USDC e mostra os saldos da tesouraria. | Código 0, sem contas `DIVERGENTE`. Depósitos fora do app aparecem como divergência. |
| `npm run test:integration` | Suíte de integração contra a Sepolia real. **Somente leitura por padrão**; com `POC_INTEGRATION_WRITE=1` também envia transações de teste (gasta ETH e mUSDC de teste). | Leitura verde; a execução com escrita ainda precisa ser registrada aqui. |

## Evidência ponta a ponta (16/11/2026)

Executado ao vivo na Sepolia com `WALLET_PROVIDER=privy`:

1. Login demo → login Privy por e-mail → servidor derivou a Coinbase Smart Account (ERC-4337, EntryPoint v0.6, dona = EOA embedded Privy).
2. **MB → wallet:** a tesouraria enviou Mock USDC para a smart account, pagando o gas; o worker verificou receipt e `Transfer` e a operação ficou **Confirmada**.
3. **Wallet → MB:** UserOperation assinada no navegador, enviada ao bundler Pimlico pelo proxy autenticado `/api/rpc`, sem paymaster (a smart account pagou o gas); **Confirmada** após a verificação no servidor.
4. Painel **Saldos reconciliados** manteve o total; a interface atualizou por SSE.

As transações podem ser conferidas na [página do token no Etherscan Sepolia](https://sepolia.etherscan.io/token/0xbfc1B31e08B80383717FfB71Fc82a68c06Bb4f7d) (`0xbfc1B31e08B80383717FfB71Fc82a68c06Bb4f7d`).

Ainda não registrados como executados ao vivo: falha controlada em cada direção e retomada após reinício. O procedimento está em [roteiro-demo.md](roteiro-demo.md).

## Limites

- Os testes unitários usam doubles; não certificam o comportamento de Privy, Pimlico ou Alchemy sob falhas reais. A evidência real é a jornada acima e as verificações com rede.
- Limitações conhecidas que exigem reconciliação manual: estorno por expiração seguido de mineração tardia, e queda após a transmissão da tesouraria antes de gravar o hash ([security.md](security.md)).
- Processo único: SQLite local, barramento SSE e rate limiter em memória.
- Depósitos feitos fora do app direto na smart account não são importados no ledger.
- Nada aqui valida segurança para produção, mainnet, ativos reais ou integração com a infraestrutura do Mercado Bitcoin.
