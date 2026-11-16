# MB Wallet Bridge

Projeto acadêmico Inteli Blockchain × MB: comunicação entre uma conta custodial simulada do Mercado Bitcoin e uma carteira pessoal. Funciona em dois modos:

- **`simulated`** (padrão): ledger e jornada completos com dados fictícios, sem credenciais nem rede.
- **`privy`** (PoC Sepolia): transferências reais de Mock USDC na testnet, nos dois sentidos. A carteira do usuário é uma smart account ERC-4337 (Coinbase Smart Account, dona = EOA embedded Privy, bundler Pimlico); a tesouraria simula o lado do MB. Cada crédito só é liquidado depois da verificação on-chain.

A aplicação não é uma plataforma oficial do Mercado Bitcoin e usa apenas ativos de teste.

**➡️ Passo a passo completo para rodar na sua máquina: [docs/reproduzir-localmente.md](docs/reproduzir-localmente.md).**

## Executar

Requer **Node.js 24 ou superior** e npm. O banco usa o módulo SQLite nativo do Node.js; algumas versões podem emitir um aviso de API experimental.

```sh
npm install
npm run dev
```

Abra [http://127.0.0.1:3000](http://127.0.0.1:3000). Informe um e-mail de demonstração, solicite o código e entre com **123456**. O desafio expira em dez minutos e é consumido no login; para entrar novamente, solicite outro. Nenhum e-mail é enviado.

O SQLite é criado automaticamente em `data/bridge.sqlite`. Os dados persistem ao reiniciar a aplicação. A configuração é opcional; consulte [`.env.example`](.env.example) e, se necessário, copie para `.env.local` para alterar `MB_DATABASE_PATH`.

## Configuração da PoC Sepolia

O modo padrão é `simulated`. Para a PoC real, defina `WALLET_PROVIDER=privy` e forneça em `.env`/`.env.local` (ou num cofre de segredos) o projeto Privy, RPC Alchemy Sepolia, chave Pimlico, endereço do Mock USDC com seis decimais, tesouraria de teste e fundos Sepolia. O passo a passo, incluindo o deploy do token com `scripts/poc/deploy-mock-usdc.sh` e o `npm run diagnose:sepolia`, está em [docs/reproduzir-localmente.md](docs/reproduzir-localmente.md). `PRIVY_APP_SECRET`, `PIMLICO_API_KEY` e `TREASURY_PRIVATE_KEY` são segredos exclusivamente server-side: não use prefixo `NEXT_PUBLIC_`, não exponha no navegador e não os copie para issues, capturas ou logs.

O modo real deve validar no servidor `chainId` 11155111, bytecode e `decimals()` do token, remetente, destinatário, valor, receipt e evento `Transfer` antes de liquidar qualquer saldo. Um hash devolvido pelo navegador é evidência para observação, nunca confirmação financeira.

Depois de preencher o ambiente de teste, execute `npm run preflight:poc`. O comando só verifica presença e formato das variáveis, não mostra segredos e não faz chamadas para Privy, RPC ou bundler. Ele não substitui a verificação on-chain exigida pelo roadmap.

### Executar a PoC no navegador (modo `privy`)

Com `WALLET_PROVIDER=privy` e o ambiente validado, `npm run dev` exibe a faixa **"Testnet Sepolia — ativos de teste, não é produto oficial"** e esconde os controles exclusivos do simulador (laboratório, escolha de resultado, troca de rede e reinício). O SDK `@privy-io/react-auth` só é carregado no navegador quando `GET /api/state` devolve `mode: "privy"` e um `privyAppId` público; no modo simulado ele não é baixado.

#### Fluxo ERC-4337 (account abstraction)

A conta operacional do usuário é uma **Coinbase Smart Account** (ERC-4337, EntryPoint v0.6, `toCoinbaseSmartAccount` do `viem/account-abstraction`). A EOA embedded da Privy é apenas a **dona/assinante** dessa smart account: ela nunca envia transações nem guarda Mock USDC. Não há paymaster: a própria smart account paga o gas com ETH Sepolia.

```text
EOA Privy (assina o userOpHash) ─► Coinbase Smart Account (sender) ─► UserOperation
  ─► POST /api/rpc (proxy autenticado) ─► bundler Pimlico ─► EntryPoint v0.6 ─► MockUSDC.transfer(tesouraria)
```

1. Entre com o e-mail de demonstração e use **Conectar wallet**. A Privy autentica e cria ou recupera a EOA embedded; a interface envia apenas o access token para `POST /api/wallet/link`. O servidor deriva o endereço contrafactual da smart account (sem deploy, sem gas) e o exibe como **Smart account (ERC-4337)**; a EOA aparece menor, como **Assinante (EOA Privy)**.
2. **Financie a smart account, não a EOA.** Copie o endereço da smart account na interface e envie ETH Sepolia de um faucet para ele. Sem saldo, a interface bloqueia a assinatura e mostra o aviso "A smart account precisa de ETH Sepolia para pagar o gas". A primeira UserOperation também implanta a conta (`initCode`) e por isso custa mais gas que as seguintes.
3. Para **wallet → conta MB**, crie a transferência e use **Assinar no navegador**. O navegador monta a smart account com a EOA Privy como dona, confere que os endereços da EOA e da smart account são os mesmos vinculados no servidor (senão recusa com "Smart account divergente do servidor"), estima o gas pelo bundler e envia `MockUSDC.transfer(tesouraria, valor)` como UserOperation. O `userOpHash` é enviado imediatamente a `POST /api/transfers/{id}/submission` (`{ "userOpHash": "0x…" }`) e fica guardado no navegador até ser registrado, para nunca pedir uma segunda assinatura (**Registrar envio**). O navegador não espera o receipt: quem observa e valida é o servidor.
4. Os estados exibidos são *Aguardando assinatura*, *UserOperation enviada — aguardando bundler/Sepolia*, *Indeterminada — reconsultando*, *Confirmada* e *Falhou*, com link para o explorador quando existir. Um worker no servidor reconcilia as pendências e a interface recebe cada mudança por **SSE** (`GET /api/events`), voltando ao polling só se a conexão cair. A interface nunca marca uma transferência como confirmada por conta própria.

Todas as chamadas de RPC e bundler do navegador passam por `POST /api/rpc`, um proxy JSON-RPC same-origin autenticado pelo cookie de sessão e restrito a métodos de leitura e de bundler. A `PIMLICO_API_KEY` (obtida em [dashboard.pimlico.io](https://dashboard.pimlico.io)) e a URL do RPC ficam **somente no servidor**; nunca use `NEXT_PUBLIC_` para elas.

## Roteiro para a equipe

1. Informe um e-mail de demonstração, solicite o código e entre com o código informado na tela.
2. Confira o saldo custodial fictício inicial de **10.000,00 Mock USDC** e ative a carteira simulada.
3. Envie **125,50 Mock USDC** da conta para a carteira. Durante o processamento, o valor fica reservado na origem.
4. Aguarde a confirmação simulada e confira os saldos separados.
5. Transfira **25,00 Mock USDC** da carteira de volta para a conta. O crédito ocorre após a confirmação.
6. No ambiente de simulação, experimente falha e expiração. O valor reservado deve retornar à origem.
7. Verifique a reconciliação e consulte os registros de operações para depuração.
8. Simule uma rede diferente da Sepolia e confira o bloqueio de uma nova transferência; depois restaure Sepolia.

Redefinir a demonstração apaga suas operações, restaura os saldos e desativa a carteira; o login continua ativo. Reiniciar o servidor preserva os dados. A ativação da carteira e os identificadores desta base são fictícios. **Não envie ativos aos endereços mostrados.**

## Desenvolver e verificar

```sh
npm test
npm run typecheck
npm run build
npm start
```

`npm start` usa a versão gerada por `npm run build`. Os comandos de desenvolvimento e produção escutam em `127.0.0.1` para uso local.

Os testes do ledger cobrem reserva, confirmação, estorno, idempotência, precisão e conservação de saldos. Para verificar também as rotas HTTP, mantenha o servidor iniciado por `npm run dev` ou `npm start` e execute em outro terminal:

```sh
npm run test:api
```

Esse script usa contas fictícias próprias e verifica login, ida e volta, reservas, falhas, expiração, idempotência, rede e isolamento entre contas. Por padrão, acessa `http://127.0.0.1:3000`; `MB_TEST_URL` permite outra porta local. A execução desses comandos e seus resultados são informados na entrega da sessão; esta lista é o roteiro reproduzível para a equipe.

Com o ambiente da PoC Sepolia configurado, há ainda duas verificações com rede:

```sh
npm run test:integration   # suíte contra a Sepolia; somente leitura por padrão (POC_INTEGRATION_WRITE=1 envia transações de teste)
npm run reconcile:onchain  # confronta o ledger SQLite com os saldos on-chain
```

## Integração

O ponto de partida é a API da aplicação. A interface lê saldos e estados do servidor, enquanto o ledger concentra as alterações persistidas. Os valores financeiros trafegam como strings e são processados em unidades inteiras.

- [Reproduzir localmente (simulado e PoC Sepolia)](docs/reproduzir-localmente.md).
- [Contrato da API, exemplos e pontos de substituição](docs/integration.md).
- [Arquitetura, invariantes e plano até a PoC](docs/architecture.md).
- [Roadmap de implementação e aceite da PoC Sepolia](docs/roadmap-poc-sepolia.md).
- [Roteiro de demonstração da PoC Sepolia (checklist, sucesso, falhas e retomada)](docs/roteiro-demo.md).
- [Segurança e limites do simulador](docs/security.md).
- [Verificações executadas e limites da validação](docs/validation.md).
- [Tipos compartilhados](src/lib/domain/contracts.ts).
- [Sistema visual para evolução da interface](DESIGN.md).

O TAP diverge quanto a entradas com mais de duas casas decimais. A base segue a regra de conversão: **truncar, nunca arredondar**, antes de validar. `1,239` vira `1,23`; `0,009` vira zero e é recusado. A equipe deve alinhar essa decisão antes do aceite final.

## Estrutura do projeto

```text
contracts/          Mock USDC (Solidity, somente testnet)
docs/               arquitetura, integração (API), segurança, roadmap, validação, guia local
scripts/dev/        teste HTTP de ponta a ponta (npm run test:api)
scripts/poc/        preflight, diagnóstico Sepolia e deploy do Mock USDC
src/app/            Next.js: página e rota única da API (/api/[...path])
src/components/     UI; privy/ = login, smart account e UserOperation no navegador
src/lib/domain/     ledger SQLite, tipos compartilhados, aritmética de valores
src/lib/wallet/     providers simulado e Privy/Sepolia
src/lib/chain/      viem: token, tesouraria, verificação de receipts, smart account
src/lib/server/     HTTP, proxy JSON-RPC (/api/rpc) e SSE (/api/events)
tests/              espelha src/lib (domain, wallet, chain, server)
```

## Escopo desta base

Next.js, React, TypeScript, SQLite local e viem. O login do "MB" é uma demonstração (código exibido na tela); a carteira real usa Privy apenas no modo `privy`. Não há API privada do MB, mainnet nem publicação online. O ledger, o worker e o barramento SSE rodam em um único processo; múltiplas réplicas exigiriam PostgreSQL e um pub/sub externo. O uso público de marca deve respeitar a autorização prevista no TAP. A base não tem garantia de segurança para produção.

Os campos de excedente e o helper de conversão preservam a precisão de seis casas decimais, com testes. Recebimentos on-chain feitos fora do app (envios diretos para a smart account) não são importados no ledger.
