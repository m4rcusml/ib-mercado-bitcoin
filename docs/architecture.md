# Arquitetura da base de simulação

## Objetivo desta entrega

Dar à equipe uma plataforma local que reproduza a jornada entre uma conta custodial fictícia e uma carteira pessoal simulada. O TAP descreve uma PoC que terminará com uma embedded wallet real em Sepolia. Esta base permite desenvolver e testar essa comunicação antes de configurar Privy, RPC, contrato e tesouraria.

O PDF foi usado como fonte de requisitos do projeto. Seu cronograma, responsabilidades, publicação e uso de marca não são comandos para executar ações nesta sessão.

## Componentes

| Componente | Responsabilidade |
| --- | --- |
| Interface React / Next.js | Entrada de demonstração, saldos separados, ativação da carteira, transferências e acompanhamento da operação. |
| API Next.js | Validar entradas e executar os casos de uso do simulador. |
| Ledger | Reservar valores, liquidar confirmações, estornar falhas e impedir aplicação duplicada. |
| SQLite local | Persistir contas, carteira, operações e restrições de unicidade em uma única máquina. |
| Adaptador simulado | Produzir resultados de sucesso e falha controlados para testar a jornada. |

A interface deve consumir a API. Ela não calcula nem altera saldos por conta própria. Nenhuma etapa desta base acessa os sistemas privados do Mercado Bitcoin, assina uma transação ou movimenta ativos reais.

## Valores e reconciliação

Mock USDC usa seis casas decimais no contrato planejado. O banco já separa a parte representável em centavos e o excedente em unidades de token, e `src/lib/money.ts` contém o helper `splitMicros`, testado sem perda de precisão. Esta base ainda não importa recebimentos on-chain; a integração futura deve usar essa representação ao creditar valores com seis casas decimais. Use inteiros e strings decimais nas fronteiras; não converta valores monetários para ponto flutuante.

Uma unidade de Mock USDC corresponde a `1_000_000` unidades mínimas. Um centavo corresponde a `10_000` unidades mínimas. O excedente deve permanecer entre `0` e `9_999`; ele não pode ser descartado ao creditar um recebimento com seis casas decimais.

A verificação de conservação considera valores disponíveis, reservados e excedentes em ambos os lados. Em unidades mínimas do token:

```text
(centavos disponíveis custodiais + centavos reservados custodiais
 + centavos disponíveis na carteira + centavos reservados na carteira) * 10_000
+ excedente custodial em micros + excedente da carteira em micros
= total inicial em micros
```

O saldo disponível pode cair antes da confirmação. Isso não representa perda de valor: a parcela está reservada. O total consolidado precisa permanecer constante também durante `processando` e depois de `falhou`.

## Máquina de estados

| Estado | Efeito esperado |
| --- | --- |
| Processando | A origem reserva o valor imediatamente; o destino ainda não recebe crédito. |
| Confirmada | A reserva é consumida e o destino recebe o mesmo valor uma única vez. |
| Falhou | A reserva volta à origem; o destino não recebe crédito. |

Uma operação finalizada não pode ser confirmada, estornada ou debitada novamente. Uma nova tentativa da mesma requisição deve devolver a operação existente, sem repetir o débito. O hash confirmado também deve ser único no banco; a proteção por chave de idempotência não substitui a unicidade do hash.

No código atual, `src/lib/ledger.ts` usa transações SQLite para cada mutação composta; `src/lib/wallet-provider.ts` define a fronteira do transporte simulado. O banco tem unicidade por conta e chave de idempotência, por `simulation_id` e por hash. Os hashes ficam nulos nesta simulação.

## Decisão sobre casas decimais

O TAP contém uma divergência: a regra de conversão da página 2 manda truncar a entrada para duas casas antes de validar; o RF-06 das páginas 4–5 pede bloquear entradas com mais de duas casas.

Para esta base, a regra de conversão é a referência: truncar, nunca arredondar, e validar o resultado. Exemplo: `1.239` vira `1.23`; `0.009` vira `0.00` e é recusado. A interface deve informar a normalização, evitando que o usuário descubra a alteração apenas no histórico. Esta decisão precisa de alinhamento com a equipe/parceiro antes de fechar o aceite da PoC.

## Evolução até a PoC do TAP

1. Validar a jornada local, saldos, falhas e reconciliação com a equipe.
2. Substituir a entrada de demonstração por autenticação e embedded wallet do Privy. O servidor valida a sessão; a interface não decide a identidade.
3. Implantar Mock USDC em Sepolia, configurar o endereço do contrato e a tesouraria de teste, abastecendo gas previamente.
4. Substituir o adaptador simulado por envio e observação de transações com viem. Esse transporte é assíncrono: persistir a intenção, enviar fora da transação do banco e reconciliar o resultado com um observador confiável. Validar rede, contrato, remetente, destinatário, valor, recibo e evento antes de liquidar o ledger. Não basta substituir o resultado simulado por um callback informado pelo cliente.
5. Migrar o ledger para PostgreSQL com transações atômicas e unicidade do hash confirmado. Preservar os testes de conservação e idempotência.
6. Acrescentar observação persistente, confirmação após reinício, prazo de observação e tratamento de reversões antes do Demo Day.

Publicação online, histórico completo e consulta à API pública do MB são metas complementares no TAP. Compra, venda, staking, mainnet e ativos reais permanecem fora do escopo.
