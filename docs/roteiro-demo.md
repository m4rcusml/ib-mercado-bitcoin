# Roteiro de demonstração da PoC Sepolia

Roteiro de 10 a 15 minutos para apresentar a PoC (modo `privy`) à equipe: sucesso nos dois sentidos, falha controlada em cada direção e retomada após reinício, conforme o aceite do [roadmap](roadmap-poc-sepolia.md). O passo a passo de instalação está em [reproduzir-localmente.md](reproduzir-localmente.md).

> Testnet apenas. Mock USDC e ETH Sepolia não têm valor, e a aplicação não é um produto oficial do Mercado Bitcoin. Não mostre `.env`, chaves ou URLs de RPC na tela.

Endereço do Mock USDC (6 decimais): `0xbfc1B31e08B80383717FfB71Fc82a68c06Bb4f7d` — [página do token no Etherscan Sepolia](https://sepolia.etherscan.io/token/0xbfc1B31e08B80383717FfB71Fc82a68c06Bb4f7d).

---

## 1. Checklist antes da apresentação

### Véspera (T-1 dia)

| Item | Como conferir | Esperado |
|---|---|---|
| Formato do ambiente | `npm run preflight:poc` | Tudo OK, nenhum valor impresso. |
| Rede, token, tesouraria e bundler | `npm run diagnose:sepolia` | Todas as linhas `PASS`. |
| Ledger × chain | `npm run reconcile:onchain` (somente leitura) | Sai com código 0, sem contas `DIVERGENTE`. Também mostra os saldos on-chain da tesouraria. |
| ETH da tesouraria | linha de ETH do `diagnose:sepolia` | **≥ 0,02 ETH** (paga o gas de todo envio MB → wallet). |
| mUSDC da tesouraria | linha de mUSDC do `diagnose:sepolia` | ≥ soma dos valores do sucesso MB → wallet (ex.: 25,00). Veja também a condição da falha MB → wallet (seção 4.2). |
| Gas da smart account do usuário demo | linha *Gas: … ETH Sepolia* no card da wallet | **≥ 0,005 ETH** na **smart account** (não na EOA). A primeira UserOperation também implanta a conta e custa mais. |
| Privy | painel Privy → *Allowed origins* | `http://127.0.0.1:3000` (e `http://localhost:3000`, se for usar). |
| `.env` | inspeção visual, sem projetar | **Uma única** linha `WALLET_PROVIDER=privy`. |
| Ensaio completo | executar este roteiro uma vez | Sucesso nos dois sentidos com o mesmo usuário que será usado no dia. |

Faça o ensaio com o **mesmo e-mail demo e o mesmo usuário Privy** da apresentação: assim a smart account já está implantada e financiada, e o login Privy por código de e-mail não vira surpresa.

### 15 minutos antes (T-15 min)

1. Rode de novo `npm run diagnose:sepolia` (todas `PASS`) e `npm run reconcile:onchain` (OK).
2. Confirme que não há operações pendentes na aba *Atividade* (filtro *Aguardando assinatura* / *Enviadas* vazio).
3. Inicie o servidor num terminal **PowerShell** dedicado: `npm run dev`. Deixe esse terminal visível ao lado do navegador: ele será interrompido na seção 5.
4. Navegador: use um **perfil limpo** (ou janela anônima) só para a demo, com pop-ups liberados para `127.0.0.1`. Faça login demo e conecte a wallet Privy antes de começar. Se usar janela anônima, a sessão Privy e os hashes pendentes guardados no navegador somem ao fechar a janela; não feche no meio de uma transferência *wallet → MB*.
5. Abra **duas abas** do app com a mesma sessão (para mostrar a sincronização ao vivo) e uma terceira aba com o token no Etherscan.
6. Feche notificações, gerenciadores de senha e qualquer aba com `.env` ou painéis com chaves.

### Reset seguro (somente se necessário)

O reset local apaga só o ledger; **os saldos on-chain continuam**. Depois de apagar o banco, a mesma conta demo volta com 10.000,00 na custódia e 0 na wallet, mas a smart account do mesmo usuário Privy ainda guarda os tokens recebidos antes: a tela mostra wallet 0 enquanto o Etherscan mostra saldo, e `reconcile:onchain` aponta divergência. Recebimentos fora do app não são importados.

Por isso, prefira **não resetar**. Se precisar:

1. Pare o servidor (Ctrl+C).
2. Faça backup: copie `data/bridge-sepolia.sqlite*` para fora de `data/` (ex.: `data-backup-AAAAMMDD/`).
3. Apague `data/bridge-sepolia.sqlite`, `data/bridge-sepolia.sqlite-wal` e `data/bridge-sepolia.sqlite-shm`.
4. Use um **e-mail demo novo e um usuário Privy novo** (outro e-mail no login Privy): a smart account será outra, sem tokens herdados. Ela precisa receber ≥ 0,005 ETH Sepolia antes do *wallet → MB*, então faça isso na véspera, não minutos antes.

---

## 2. Visão geral do tempo

| Bloco | Tempo |
|---|---|
| 3.1 Abertura e login | 1–2 min |
| 3.2 Sucesso MB → wallet | 2 min |
| 3.3 Sucesso wallet → MB | 2 min |
| 5. Retomada após reinício (reinicia já com o timeout curto de assinatura) | 2–3 min |
| 4.1 Falha wallet → MB (expira em ~1 min) | 1–2 min, em paralelo com 4.2 |
| 4.2 Falha MB → wallet | 1–2 min |
| Encerramento e perguntas | 2–3 min |

A ordem sugerida é 3 → 5 → 4: o reinício da seção 5 já sobe o servidor com `POC_SIGNATURE_TIMEOUT_MS=60000`, o que prepara a falha *wallet → MB* sem um reinício extra.

---

## 3. Caminho feliz

### 3.1 Abertura e login

**Mostrar:** a faixa "Testnet Sepolia — ativos de teste, não é produto oficial"; o login demo (código na tela); o card da wallet com **Smart account (ERC-4337)** e **Assinante (EOA Privy)**.

**Dizer:**
- "O lado MB é simulado: a conta custodial e o login demo são do nosso ledger. O lado wallet é real: tokens e transações na Sepolia."
- "A EOA da Privy só assina. Quem guarda os tokens e paga o gas é a smart account ERC-4337, derivada pelo **servidor** a partir da EOA que o Privy informa — nenhum endereço vem do navegador."
- Apontar o painel **Saldos reconciliados**: total de 10.000,00 Mock USDC, que não muda durante toda a demo.

### 3.2 MB → wallet (tesouraria envia)

1. Em *Transferir*, sentido **Conta MB → wallet**, valor **25,00**.
2. **Mostrar:** o valor sai do disponível custodial e aparece como **reservado**; o status vai para **Enviada — verificando na Sepolia**, com link *Ver no explorador*.
3. Abrir o link: a transação da tesouraria (EOA do servidor) chamando `transfer` no Mock USDC. A tesouraria paga o gas.
4. Em ~15–30 s, o status muda para **Confirmada** sem recarregar a página, **nas duas abas ao mesmo tempo**.

**Dizer:**
- "O hash é persistido antes da mineração. Quem confirma é o worker do servidor, que busca o receipt e valida rede, contrato, evento `Transfer`, remetente, destinatário e valor exatos."
- "A atualização chega por **SSE** (`GET /api/events`); se a conexão cair, a tela volta ao polling."
- "Só depois da verificação a reserva é consumida e a wallet é creditada, uma única vez."

### 3.3 Wallet → MB (UserOperation assinada no navegador)

1. Sentido **Wallet → conta MB**, valor **10,00**. Status **Aguardando assinatura**; o valor fica reservado na wallet.
2. Clicar em **Assinar no navegador** e aprovar no pop-up da Privy.
3. Status **UserOperation enviada — aguardando bundler/Sepolia**; depois **Confirmada**. Abrir o link: a transação do bundle (EntryPoint v0.6) com o `Transfer` da smart account para a tesouraria.
4. Conferir na aba do token no Etherscan os transfers mais recentes e, no app, **Saldos reconciliados** ainda com 10.000,00 no total.

**Dizer:**
- "O navegador monta a UserOperation, a EOA assina e o envio ao bundler Pimlico passa pelo nosso proxy autenticado `/api/rpc`: a chave do bundler e a URL do RPC nunca saem do servidor."
- "O navegador só informa o `userOpHash`. Isso é um ponteiro, não uma prova: o servidor busca o receipt no bundler, confere `sender`, EntryPoint, `success`, o `Transfer` dentro dos logs **desta** UserOperation e ainda verifica a transação via RPC."
- "Sem paymaster: a smart account pagou o gas com ETH de teste — repare no saldo de gas no card."

---

## 4. Falha controlada em cada direção

### 4.1 Wallet → MB: assinatura não enviada (expiração com estorno)

Pré-requisito: o servidor está rodando com `POC_SIGNATURE_TIMEOUT_MS=60000` (já feito na seção 5; se for fazer isolado, veja o comando lá). O padrão é 600000 (10 min), longo demais para a demo.

1. Criar **Wallet → conta MB** de **5,00** e **não assinar**. Status **Aguardando assinatura**; 5,00 reservado na wallet.
2. Opcional: clicar em **Assinar no navegador** e **recusar** no pop-up da Privy. A tela mostra "Você recusou a assinatura na wallet. Nada foi enviado; a reserva continua aguardando sua decisão." O status continua *Aguardando assinatura*: recusar não falha a operação, só a expiração decide.
3. Enquanto o minuto passa, fazer a falha 4.2.
4. Após ~60–65 s (timeout + intervalo do worker de 5 s), o status vira **Falhou** com o motivo "Assinatura não recebida em 1 minuto. O valor reservado foi devolvido." O saldo da wallet volta, nada aparece no Etherscan.

**Dizer:** "Nada foi transmitido, então o estorno é seguro. A regra de expiração é explícita, configurável e registrada no motivo da operação."

Não assine depois que a operação expirar: a interface não oferece mais a assinatura, e uma operação `failed` não é reaberta.

### 4.2 MB → wallet: envio da tesouraria recusado antes da transmissão

#### O que o código faz

- `PrivyWalletProvider.submit` chama `treasury.sendTransfer`, que usa `walletClient.writeContract` do viem com conta local. O viem **estima o gas antes de assinar e transmitir** (`eth_estimateGas`).
- Se a tesouraria não tem mUSDC suficiente, o contrato reverte com `InsufficientBalance()` já na estimativa; se não tem ETH, a estimativa ou o próprio nó recusa por fundos insuficientes; se o RPC está inacessível, a chamada HTTP falha. Em todos esses casos **a exceção ocorre antes de qualquer transmissão**.
- `Ledger.transfer` captura a exceção ainda na mesma requisição: a operação vai **direto de `processing` para `failed`**, a reserva volta para a custódia na hora e o motivo gravado é a mensagem curta do viem, sem URLs (por exemplo `The contract function "transfer" reverted…` ou `HTTP request failed.`). Não há hash nem link de explorador, e a operação **não** fica pendurada até a expiração.
- Caminhos diferentes, que não servem para a demo: se a transação for transmitida e **revertida on-chain**, o worker marca `failed` ("Transação revertida na rede.") e estorna; se ficar sem recibo, a reserva permanece e a operação passa a `unknown` após `POC_OBSERVATION_TIMEOUT_MS`.

> Um `POC_OBSERVATION_TIMEOUT_MS` curto demonstra o estado `unknown` enquanto o recibo está pendente. Para demonstrar estorno, use uma falha na preparação, antes de o worker transmitir.

#### Valor maior que o saldo da tesouraria

Mostra uma falha "de negócio" real, sem reiniciar nada. Condição: o saldo mUSDC da tesouraria precisa ser **menor** que o disponível custodial do usuário demo (senão o ledger recusa antes, com "O valor excede o saldo disponível na origem", e nenhuma operação é criada).

Preparação na véspera:

1. Anote o mUSDC da tesouraria (`npm run diagnose:sepolia`) e o disponível custodial do usuário demo após o ensaio.
2. Se a tesouraria tiver **igual ou mais**, crie a margem pelo próprio app: com um **segundo e-mail demo** (conta de apoio, com outro usuário Privy), faça um MB → wallet de um valor maior que a diferença (ex.: 100,00). Esses tokens ficam na smart account de apoio, e a tesouraria passa a ter menos que a custódia do usuário demo.
3. Confirme de novo com `diagnose:sepolia`. Lembre que o caminho feliz do dia reduz os dois saldos pelo mesmo valor líquido, mantendo a margem.

Na demo:

1. **Conta MB → wallet** com valor **entre** o saldo da tesouraria e o disponível custodial (o mais simples é o disponível custodial inteiro, ex.: 9.985,00).
2. A resposta volta em 1–2 s com **Falhou**, motivo de revert do contrato, disponível custodial restaurado, sem link de explorador. A outra aba atualiza junto.

**Dizer:** "A tesouraria não tinha saldo. O erro aconteceu na estimativa de gas, antes de assinar e transmitir: nada foi para a rede, então o estorno imediato é seguro. O total reconciliado continua 10.000,00."

## 5. Retomada após reinício

1. Iniciar um **Conta MB → wallet** de **5,00**.
2. Assim que o status mostrar **Enviada — verificando na Sepolia**, interromper o servidor no terminal (**Ctrl+C**; responda `S`/`Y` se o shell perguntar). A janela é de ~15–30 s; se a operação já tiver confirmado, repita com outro valor.
3. **Mostrar:** a aba do Etherscan — a transação segue e minera com o servidor desligado. O app mostra a operação ainda como *Enviada* e a página fica sem conexão.
4. Reiniciar já com o timeout curto de assinatura para a seção 4.1:

   ```powershell
   $env:POC_SIGNATURE_TIMEOUT_MS = "60000"; npm run dev
   ```

   (Git Bash: `POC_SIGNATURE_TIMEOUT_MS=60000 npm run dev`.)
5. A aba aberta reconecta sozinha (SSE/polling). Em segundos, a operação vira **Confirmada**, a wallet recebe **5,00 uma única vez** e o painel segue **Saldos reconciliados**. Se quiser, rode `npm run reconcile:onchain` em outro terminal para mostrar ledger e chain iguais (com operações ainda em aberto, a divergência pode ser transitória e o script sinaliza isso).

**Dizer (por que funciona):**
- "Reserva, hash e timestamps estão no **SQLite**, gravados antes de a transação minerar. Nada depende da memória do processo."
- "Na primeira requisição após subir, o ledger é criado e o worker roda `reconcileAll`, que busca todas as operações pendentes de todas as contas e consulta o receipt."
- "A liquidação é **protegida por status**: o `UPDATE` só passa se a operação ainda está `processing`/`submitted`/`unknown`, e o saldo só se move se exatamente uma linha mudou. Duas observações simultâneas ou repetidas não creditam duas vezes."

Ao final da demo, feche esse terminal ou rode `Remove-Item Env:POC_SIGNATURE_TIMEOUT_MS` para não carregar o timeout curto adiante.

---

## 6. Encerramento

- Rodar `npm run reconcile:onchain`: o ledger bate com a chain.
- Recapitular: sucesso e falha nos dois sentidos, retomada sem crédito duplicado, saldo total conservado.
- Citar as limitações (abaixo) e o que falta no [roadmap](roadmap-poc-sepolia.md).

---

## 7. Perguntas frequentes (cola)

**EOA ou smart account?** A EOA embedded da Privy é só a dona/assinante. O endereço operacional é uma Coinbase Smart Account (ERC-4337, EntryPoint v0.6), derivada no servidor pela factory on-chain. Ela guarda os tokens e executa a UserOperation; a EOA nunca envia transações nem guarda Mock USDC.

**Por que sem paymaster?** Escopo e simplicidade: o paymaster ficou fora do roadmap. A smart account paga o próprio gas em ETH Sepolia e a tesouraria paga o gas dos envios MB → wallet. Um paymaster patrocinado seria o próximo passo para o usuário não precisar de ETH.

**Por que o servidor não confia no hash do cliente?** Porque o navegador é não confiável. O `userOpHash` só aponta onde procurar; a liquidação exige receipt do bundler com `sender` e EntryPoint corretos, `success`, o `Transfer` exato nos logs da própria UserOperation e a verificação independente da transação via RPC (rede, contrato, remetente, destinatário e valor em 6 decimais). Hashes são únicos no banco.

**O que é simulado e o que é real?** Simulados: a conta custodial do MB (ledger SQLite), o login demo com código na tela e a tesouraria como representante do MB. Reais: o token Mock USDC na Sepolia, as transações, a smart account, a assinatura Privy e o bundler. Nada usa ativos de valor ou APIs do Mercado Bitcoin.

**E se a rede ou o bundler cair?** A operação vira `unknown` e o worker continua consultando. A reserva permanece até haver evidência suficiente para liquidar ou estornar.

**Limitações conhecidas** (detalhes em [security.md](security.md)):
- Operações sem recibo podem exigir conciliação manual. O worker retoma hashes e operações assinadas que já estejam persistidos.
- Processo único: SQLite local, barramento SSE e rate limiter em memória. Várias réplicas exigiriam PostgreSQL e pub/sub.
- Depósitos feitos fora do app direto na smart account não são importados no ledger.
- Login demo não é autenticação de produção.
