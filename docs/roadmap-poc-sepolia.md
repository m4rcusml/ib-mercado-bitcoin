# Roadmap da PoC Sepolia

**Status:** proposto  
**Objetivo:** demonstrar transferências reais de Mock USDC nos dois sentidos entre a conta custodial simulada e uma embedded wallet Privy, usando Sepolia e preservando as regras do ledger.  
**Fora do escopo:** mainnet, ativos reais, paymaster, publicação pública, integração com APIs privadas do Mercado Bitcoin e migração para PostgreSQL.

## Resultado de aceite da PoC

Ao final, uma pessoa consegue entrar, criar ou acessar a embedded wallet, receber Mock USDC da tesouraria simulada e devolver Mock USDC para essa tesouraria. Em ambos os sentidos, a interface só altera o saldo final após o serviço verificar independentemente a transação, o receipt e o evento `Transfer` do contrato certo na Sepolia.

O demo deve apresentar pelo menos um sucesso e uma falha ou expiração controlada em cada direção, além de uma retomada do observador após reiniciar o processo.

## Decisões que destravam o trabalho

1. **A embedded wallet é controlada no navegador pelo SDK Privy.** Não usar chave determinística derivada no servidor. O servidor só recebe identidade e identificadores de operação necessários para reconciliar o resultado.
2. **A tesouraria é uma identidade técnica separada e somente do servidor.** Ela assina `mb_to_wallet` em Sepolia; sua chave fica em gestão de segredos e nunca chega ao browser.
3. **A reserva é persistida antes do envio, mas o envio não ocorre dentro de uma transação SQLite.** Isso evita manter lock de banco durante RPC/bundler e permite recuperar operações após queda.
4. **Um hash comunicado pelo cliente não liquida saldo.** Ele apenas vincula a operação ao observador; a liquidação exige receipt, rede, contrato, evento, remetente, destinatário e valor validados no servidor.
5. **O timeout da PoC deve virar `unknown` antes de qualquer estorno automático.** O worker continua consultando a rede; somente uma regra explícita de expiração, demonstrada e auditável, pode decidir o desfecho financeiro.

## Fase 0 — Recuperar uma base verde

### Entregas

- Corrigir a regressão atual entre `Ledger`, `WalletProvider`, rotas e testes.
- Restaurar `INITIAL_CENTS` e alinhar a assinatura de `submit` em produção e nos doubles de teste.
- Tornar `activateWallet`, criação de transferência e observação coerentemente assíncronas onde for necessário.
- Fazer o bootstrap escolher explicitamente o provider configurado, sem alterar o modo simulado por padrão.
- Fixar a resolução de tipos do `viem` e remover testes que dependem de interface obsoleta.

### Aceite

- `npm test`, `npm run typecheck` e `npm run build` passam.
- O simulador continua com os mesmos fluxos, reservas, estornos e idempotência.
- Não há promises não aguardadas nem acesso ao SQLite após `close()`.

## Fase 1 — Preparar Sepolia e o contrato de integração

### Entregas

- Implantar ou selecionar um Mock USDC de seis decimais em Sepolia e versionar ABI, endereço e script de verificação.
- Criar e financiar a tesouraria de teste com Mock USDC e ETH Sepolia, isolando a chave em variável exclusivamente server-side.
- Criar projeto Privy, habilitar embedded wallet e configurar origem local/de homologação.
- Configurar RPC e bundler Sepolia; declarar todas as variáveis em `.env.example` sem valores secretos.
- Implementar verificação de configuração no boot: chain ID, endereços válidos, bytecode do token e `decimals() === 6`.

### Aceite

- Um comando de diagnóstico consulta a Sepolia e confirma contrato, tesouraria e saldo mínimo de gas/token.
- Nenhuma chave, URL privada ou segredo aparece no bundle do cliente, logs ou repositório.

## Fase 2 — Redesenhar o fluxo persistente

### Entregas

- Evoluir a transferência para estados explícitos: `reserved`, `awaiting_user_signature`, `submitted`, `confirmed`, `failed` e `unknown`.
- Persistir a intenção, reserva, ator que deve assinar, hash de UserOperation/tx, tx hash, motivo e timestamps.
- Adicionar unicidade para hashes on-chain e uma estratégia de lock para impedir duas liquidações da mesma operação.
- Implementar worker de reconciliação que busca pendências no banco, sobrevive a reinício e processa cada uma idempotentemente.
- Preservar o modo simulado como adaptador compatível, sem endpoints de simulação ativos no modo Privy.

### Fluxos-alvo

**MB → wallet:** reservar saldo custodial → enviar `MockUSDC.transfer(wallet, valor)` pela tesouraria → persistir hash → validar receipt e evento → consumir reserva e creditar wallet.

**Wallet → MB:** reservar saldo da wallet → pedir assinatura/envio à embedded wallet no browser → registrar hash recebido → validar receipt e evento no servidor → consumir reserva e creditar custodial.

### Aceite

- Reiniciar o processo entre `submitted` e a confirmação não cria crédito duplicado nem perde a operação.
- Receipt revertido mantém o saldo destino intacto e libera exatamente a reserva correta.
- Um hash de outra rede, token, origem, destino ou valor nunca confirma uma transferência.

## Fase 3 — Implementar os adaptadores reais

### Entregas

- Implementar calldata ERC-20 para os dois sentidos usando unidades de seis decimais, sem `number` ou ponto flutuante.
- No cliente, integrar Privy para autenticação e embedded wallet; obter conta e enviar UserOperation apenas após o usuário autorizar.
- No servidor, implementar o adaptador da tesouraria e o observador de receipts/eventos via `viem`.
- Validar chain Sepolia, contrato Mock USDC, smart account associada ao usuário, tesouraria, valor e sucesso do receipt.
- Exibir na UI estado pendente, hash e link de explorer somente depois de eles existirem; não chamar isso de confirmação antes da validação.

### Aceite

- `mb_to_wallet` confirma uma transferência real observável no explorer e atualiza os dois saldos lógicos uma única vez.
- `wallet_to_mb` exige wallet autenticada e confirma somente evento da smart account para a tesouraria esperada.
- Falhas de gas, assinatura recusada, revert e indisponibilidade temporária recebem mensagem recuperável e não distorcem o ledger.

## Fase 4 — Testes de integração e roteiro de demo

### Entregas

- Manter testes unitários de conservação, precisão, reserva, estorno, idempotência e concorrência.
- Criar testes de contrato/adaptador com RPC e bundler falsos, cobrindo receipt válido, revert, timeout e evento adulterado.
- Criar suíte Sepolia marcada como integração, executada somente com variáveis de ambiente de teste.
- Atualizar README, contrato HTTP, segurança e validação com o fluxo real e as limitações remanescentes.
- Escrever roteiro de demo com reset seguro da conta de teste e checklist de saldos/gas antes da apresentação.

### Aceite final

- CI local verde: teste, typecheck e build.
- Em Sepolia, cada direção passa por sucesso e falha controlada.
- Após reinício no meio de uma operação, a reconciliação chega ao mesmo resultado sem duplicidade.
- O repositório declara claramente que a PoC usa ativos de teste e não é produto oficial nem apto a produção.

## Ordem prática de execução

1. Fase 0 inteira; não avançar com provider real enquanto o branch não estiver verde.
2. Fase 1 e o modelo de persistência da Fase 2 em paralelo conceitual, mas sem usar segredos reais no código.
3. Fluxo `wallet → MB` primeiro, porque valida a embedded wallet e o caminho UserOperation.
4. Fluxo `MB → wallet` com tesouraria server-side em seguida.
5. Worker, retomada e demonstração final por último.

## Riscos que precisam de dono

- **Credenciais e fundos Sepolia:** dono responsável por Privy, RPC/bundler e tesouraria de teste.
- **Contrato Mock USDC:** endereço, ABI, seis decimais e permissões da tesouraria precisam ser confirmados antes da Fase 3.
- **Política de timeout:** a equipe precisa definir quando uma operação `unknown` pode ser estornada na PoC.
- **Autorização de marca:** não publicar ou apresentar como plataforma oficial sem a aprovação prevista no TAP.
