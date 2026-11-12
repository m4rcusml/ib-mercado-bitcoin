# MB Wallet Bridge

Base local para a equipe do projeto Inteli Blockchain desenvolver a comunicação entre uma conta custodial simulada do Mercado Bitcoin e uma carteira pessoal. Interface e API usam dados fictícios, sem credenciais externas e sem movimentar ativos reais.

O TAP descreve uma PoC com embedded wallet e Mock USDC em Sepolia. Esta entrega prepara a jornada e o ledger; a conexão real com Privy, viem, contrato e RPC é a próxima integração. A aplicação não é uma plataforma oficial do Mercado Bitcoin.

## Executar

Requer **Node.js 24 ou superior** e npm. O banco usa o módulo SQLite nativo do Node.js; algumas versões podem emitir um aviso de API experimental.

```sh
npm install
npm run dev
```

Abra [http://127.0.0.1:3000](http://127.0.0.1:3000). Informe um e-mail de demonstração, solicite o código e entre com **123456**. O desafio expira em dez minutos e é consumido no login; para entrar novamente, solicite outro. Nenhum e-mail é enviado.

O SQLite é criado automaticamente em `data/bridge.sqlite`. Os dados persistem ao reiniciar a aplicação. A configuração é opcional; consulte [`.env.example`](.env.example) e, se necessário, copie para `.env.local` para alterar `MB_DATABASE_PATH`.

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

## Integração

O ponto de partida é a API da aplicação. A interface lê saldos e estados do servidor, enquanto o ledger concentra as alterações persistidas. Os valores financeiros trafegam como strings e são processados em unidades inteiras.

- [Contrato da API, exemplos e pontos de substituição](docs/integration.md).
- [Arquitetura, invariantes e plano até a PoC](docs/architecture.md).
- [Segurança e limites do simulador](docs/security.md).
- [Verificações executadas e limites da validação](docs/validation.md).
- [Tipos compartilhados](src/lib/contracts.ts).
- [Sistema visual para evolução da interface](DESIGN.md).

O TAP diverge quanto a entradas com mais de duas casas decimais. A base segue a regra de conversão: **truncar, nunca arredondar**, antes de validar. `1,239` vira `1,23`; `0,009` vira zero e é recusado. A equipe deve alinhar essa decisão antes do aceite final.

## Escopo desta base

Next.js, React, TypeScript e SQLite local. Não há autenticação real por e-mail, criação de embedded wallet, chamadas à blockchain, contrato implantado, API privada do MB ou publicação online. O uso público de marca deve respeitar a autorização prevista no TAP. A base não tem garantia de segurança para produção.

Os campos de excedente e o helper de conversão preservam a precisão de seis casas decimais, com testes. Recebimentos on-chain ainda não são importados nesta simulação.
