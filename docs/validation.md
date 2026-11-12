# Validação da base local

Verificações executadas em 12/11/2026, com Node.js 26.8.2, Next.js 16.4.6 e Microsoft Edge. O requisito de execução declarado é Node.js 24 ou superior; esta sessão não repetiu os testes em outras versões do Node ou sistemas operacionais.

| Verificação | Resultado |
| --- | --- |
| `npm test` | 15 testes passaram, sem falhas. |
| `npm run test:api` | 31 verificações HTTP passaram contra o servidor local, incluindo cabeçalho `Origin` de navegador. |
| `npm run typecheck` | Passou. |
| `npm run build` | Build de produção passou, incluindo verificação TypeScript. |
| Jornada no navegador | Login demonstrativo, ativação, truncamento visível, ida, retorno, polling, cenário de falha e bloqueio de rede incorreta exercitados. |
| Layout | Desktop 1440 × 1100 e mobile 390 × 844; documento sem overflow horizontal nas duas larguras. |
| Revisão independente | Contraste secundário corrigido e reavaliado; disposição final `ship` sobre a correção solicitada. |

## Evidências funcionais

O envio de `125,5099` foi apresentado como `125,50` e executado com truncamento. O retorno de `25,00` terminou com `9.899,50` na conta e `100,50` na wallet, mantendo `10.000,00` no total. Uma falha simulada de `7,01` devolveu a reserva e preservou esses saldos. A rede incorreta desabilitou o botão de envio.

Os testes de unidade e HTTP também verificaram expiração com estorno, precisão sem ponto flutuante, conservação com reservas e frações subcentavo, repetição idempotente, conflitos de chave, isolamento de contas, unicidade do hash no schema e persistência entre reaberturas do SQLite. Expiração e reset foram verificados por código/API; não se reivindica uma inspeção visual de cada estado possível.

## Limites

Nenhum teste enviou uma transação para blockchain ou usou serviços reais de autenticação. Não foram implantados contrato Mock USDC, Privy, RPC, PostgreSQL ou serviço online. As verificações confirmam o comportamento da base simulada, sem certificar integração com a infraestrutura real do Mercado Bitcoin nem segurança para produção.

As capturas de desenvolvimento ficam em `.impeccable/review/`, fora do controle de versão. O roteiro de reprodução está no README e o contrato HTTP em `docs/integration.md`.
