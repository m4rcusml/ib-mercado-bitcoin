# Segurança e limites da simulação

## Uso previsto

Esta aplicação é uma base acadêmica local. Conta, autenticação, carteira, saldos e liquidação são simulados. Um endereço gerado pelo simulador não equivale a uma carteira controlada pelo usuário. Não envie ativos a ele.

O projeto não é uma plataforma oficial do Mercado Bitcoin e não acessa APIs privadas do parceiro. Não está preparado para dinheiro real, mainnet ou exposição pública sem trabalho adicional. O TAP condiciona divulgação pública com marca à autorização do parceiro; a execução local desta base não concede essa autorização.

## Fronteiras de confiança

- Toda entrada da interface é não confiável. A API valida endereço/rede quando aplicáveis, direção, valor, saldo e estado da operação.
- A identidade de demonstração não comprova posse de e-mail. Um código conhecido ou mostrado na tela serve apenas ao roteiro local.
- O login exige solicitação prévia de um desafio de dez minutos, consumido após o uso. A sessão opaca dura 24 horas, é persistida pelo hash do token e usa cookie `HttpOnly`, `SameSite=Strict`; em HTTPS, o cookie de login recebe `Secure`. Isso protege a sessão local, mas não transforma o código fixo em autenticação de produção.
- As rotas de mutação recusam um cabeçalho `Origin` diferente da origem da aplicação. Corpos JSON são limitados a 4 KB. Esses controles não substituem autenticação real nem limitação de tentativas.
- O cliente nunca determina que uma transação foi confirmada em uma blockchain real. Controles de resultado pertencem exclusivamente ao simulador.
- Valores vêm como strings decimais. A conversão para unidades mínimas usa inteiros; rejeite notações ambíguas, valores negativos e resultados iguais a zero.
- Não coloque seed phrases, chaves privadas, tokens de acesso ou credenciais de RPC no frontend, em exemplos versionados ou nos logs.

## Integridade do ledger

As operações que reservam, liquidam ou estornam precisam ser atômicas. Uma falha no meio da operação não pode deixar uma reserva sem registro de transferência, nem um crédito sem a baixa correspondente.

A chave de idempotência identifica uma tentativa lógica. Repetir a chave com outro valor ou sentido deve gerar conflito, não reaproveitar silenciosamente a operação anterior. A unicidade do hash confirmado impede que duas requisições distintas creditem o mesmo recebimento.

O destino só recebe crédito depois da confirmação. Em falha, a origem recupera a reserva uma única vez. A reconciliação inclui as reservas para detectar perdas durante o processamento.

Os testes mínimos devem cobrir saldo insuficiente, valor inválido, truncamento, sucesso nos dois sentidos, falha com estorno, repetição de confirmação, repetição de requisição e conservação do total.

## Antes de conectar Sepolia

Validar no servidor a sessão real e sua associação ao endereço. Permitir apenas `chainId = 11155111`, contrato Mock USDC configurado e os endereços previstos para aquela conta. Não confiar apenas no hash informado pelo navegador.

Para um crédito, verificar recibo bem-sucedido e evento `Transfer` do contrato correto, com destinatário, remetente e valor esperados. Definir política de confirmações, reversões e expiração com a equipe. A janela de observação não deve apagar a evidência de um envio que possa confirmar mais tarde.

Um identificador local não tem prova on-chain. No simulador, `hash` e `explorerUrl` ficam nulos; `simulationId` identifica a operação fictícia. Depois da integração real, construir o link somente para a rede Sepolia e para hashes verificados.

O envio e a observação reais são assíncronos e devem ocorrer fora das transações SQLite que alteram os saldos. Persistir a intenção e sua evidência permite retomar a observação após interrupções. Um callback controlado pelo navegador não substitui esse observador.

## Persistência local

O banco contém dados de demonstração e fica fora do controle de versão. Reiniciar o servidor preserva os dados. Redefinir a demonstração apaga as operações da conta autenticada, restaura os saldos e desativa sua carteira; a sessão permanece ativa. O controle de reset deve informar esse efeito. SQLite local atende desenvolvimento em uma única instância. Para execução distribuída, substituir por armazenamento compartilhado com transações e restrições equivalentes.

Autenticação de produção, limitação de tentativas, envio de e-mail, recuperação de carteira, KYC/AML e auditoria formal não fazem parte desta base. O TAP também exclui várias dessas entregas; elas não devem ser anunciadas como implementadas.
