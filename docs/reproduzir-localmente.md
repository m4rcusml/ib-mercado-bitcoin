# Reproduzir localmente

Guia passo a passo para rodar o MB Wallet Bridge do zero em outra máquina, nos dois modos:

- **Modo simulado:** sem nenhuma conta externa. Leva cerca de 5 minutos.
- **PoC Sepolia (modo `privy`):** transferências reais de Mock USDC na testnet, com account abstraction (ERC-4337). Leva cerca de 30 minutos na primeira vez.

> Testnet apenas. Nada aqui usa ativos reais, e o projeto não é um produto oficial do Mercado Bitcoin.

---

## 1. Pré-requisitos

| Ferramenta | Versão | Para quê |
|---|---|---|
| [Node.js](https://nodejs.org) | **24 ou superior** | App, testes e scripts (usa o SQLite nativo do Node) |
| npm | o que acompanha o Node | Dependências |
| Git | qualquer recente | Clonar o repositório |
| [Foundry](https://book.getfoundry.sh) (`forge`, `cast`) | 1.x | Só para a PoC: compilar e implantar o Mock USDC |
| Bash | Linux/macOS, ou **WSL** no Windows | Só para o script de deploy |

**No Windows**, instale o Foundry **dentro do WSL (Ubuntu)**. O Smart App Control do Windows 11 costuma bloquear o `foundryup.exe` nativo ("Uma política de Controle de Aplicativo bloqueou este arquivo"). No WSL:

```bash
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc      # ou abra um terminal novo
foundryup
forge --version
```

O script de deploy já procura o Foundry em `~/.foundry/bin`, mesmo que essa pasta não esteja no `PATH`.

---

## 2. Modo simulado (sem contas externas)

```bash
git clone https://github.com/m4rcusml/ib-mercado-bitcoin.git
cd ib-mercado-bitcoin
npm install
npm run dev
```

Abra <http://127.0.0.1:3000>, informe qualquer e-mail, peça o código e entre com o código mostrado na tela.

- O banco SQLite é criado em `data/bridge.sqlite` e persiste entre reinícios.
- Sem `.env`, o modo é `simulated`: carteira fictícia, nenhuma chamada de rede.
- Para resultados de falha e expiração, use o painel de laboratório.

Verificação:

```bash
npm test            # testes unitários e de integração com fakes (sem rede)
npm run typecheck
npm run build
npm run test:api    # com o servidor rodando: exercita a API HTTP de ponta a ponta
```

> No Windows, rode o `npm test` pelo **PowerShell** (`C:\...`). No Git Bash (`/c/...`), a diferença de maiúsculas na letra do drive faz o Vitest carregar duas vezes e falhar com "failed to find the current suite".

---

## 3. PoC Sepolia (modo `privy`)

### 3.1 Contas e chaves necessárias

Todas são gratuitas. Os segredos ficam **somente** no `.env` / `.env.local`, que o Git ignora. Nunca use o prefixo `NEXT_PUBLIC_` para segredos.

| Serviço | O que criar | Variável |
|---|---|---|
| [Alchemy](https://www.alchemy.com) | App na rede **Ethereum Sepolia** → copie a URL HTTPS `https://eth-sepolia.g.alchemy.com/v2/<key>` | `ALCHEMY_RPC_URL` |
| [Pimlico](https://dashboard.pimlico.io) | API key com **Bundler** habilitado. O paymaster não é usado; o aviso de "sponsorship" do painel não afeta a PoC | `PIMLICO_API_KEY` |
| [Privy](https://dashboard.privy.io) | App novo → App ID e App Secret. Em *Login methods*, ative **e-mail**; em *Embedded wallets*, ative **Ethereum**; em *Allowed origins*, adicione `http://127.0.0.1:3000` | `PRIVY_APP_ID`, `PRIVY_APP_SECRET` |
| Carteira da tesouraria | Uma carteira **nova, só para testes**: `cast wallet new` (WSL) ou uma conta nova no MetaMask | `TREASURY_ADDRESS`, `TREASURY_PRIVATE_KEY` |

A chave privada precisa estar no formato `0x` + 64 caracteres hexadecimais. O MetaMask exporta sem o `0x`; acrescente-o.

### 3.2 Arquivo `.env`

Copie o modelo e preencha:

```bash
cp .env.example .env
```

```dotenv
WALLET_PROVIDER=privy
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...
PIMLICO_API_KEY=pim_...
ALCHEMY_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/...
TREASURY_ADDRESS=0x...
TREASURY_PRIVATE_KEY=0x...
MOCK_USDC_ADDRESS=            # preenchido no passo 3.4
```

Deixe **uma única** linha `WALLET_PROVIDER`. Valide o formato sem expor valores:

```bash
npm run preflight:poc
```

### 3.3 ETH Sepolia para a tesouraria

A tesouraria paga o gas do deploy, do mint e dos envios MB → wallet. Mande cerca de **0.05 ETH Sepolia** para o `TREASURY_ADDRESS` por um faucet, por exemplo o [Google Cloud Web3 Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia).

### 3.4 Implantar o Mock USDC

O contrato está em [`contracts/MockUSDC.sol`](../contracts/MockUSDC.sol): ERC-20 com 6 decimais e `mint` restrito ao owner. No WSL/Linux, na raiz do repositório:

```bash
cd /mnt/c/caminho/para/ib-mercado-bitcoin   # no WSL; em Linux/macOS, a pasta do clone
bash scripts/poc/deploy-mock-usdc.sh 10000
```

O script:

1. lê o `.env` sem imprimir segredos;
2. aborta se o RPC não for Sepolia, se a chave não corresponder ao `TREASURY_ADDRESS` ou se a tesouraria estiver sem ETH;
3. implanta o contrato com a tesouraria como owner;
4. cunha a quantidade pedida (padrão: 1.000) para a tesouraria;
5. imprime `MOCK_USDC_ADDRESS=0x...`. Cole essa linha no `.env`.

Para **cunhar mais** num token já implantado, sem criar outro contrato:

```bash
bash scripts/poc/deploy-mock-usdc.sh 5000 0xENDERECO_DO_TOKEN
```

> Cunhe pelo menos o saldo custodial inicial da conta demo (**10.000** mUSDC). Senão, um envio MB → wallet maior que o saldo da tesouraria é recusado já na estimativa de gas, antes de ser transmitido, e fica *Falhou* com estorno imediato.

### 3.5 Diagnóstico on-chain

```bash
npm run diagnose:sepolia
```

Todas as linhas devem dar `PASS`: chainId 11155111, bytecode do token, `decimals() = 6`, ETH e mUSDC na tesouraria, e Pimlico aceitando o EntryPoint v0.6. Nenhum segredo é exibido.

### 3.6 Rodar e testar no navegador

```bash
npm run dev
```

Em <http://127.0.0.1:3000>:

1. **Login demo:** entre com e-mail; o código aparece na tela.
2. **Conectar wallet:** faça o login Privy com o seu e-mail real (o código chega por e-mail). A tela mostra:
   - **Smart account (ERC-4337):** a carteira do usuário, que guarda os tokens;
   - **Assinante (EOA Privy):** a chave que autoriza as operações.
3. **MB → wallet:** transfira, por exemplo, 10,00. O status vai de *Enviada — verificando na Sepolia* para *Confirmada*, com link do Etherscan. Quem paga o gas é a tesouraria.
4. **Financiar a smart account:** envie cerca de **0.01 ETH Sepolia para o endereço da smart account** (não para a EOA). Use o botão *Verificar saldo*.
5. **Wallet → MB:** transfira, por exemplo, 5,00 e clique em **Assinar no navegador**. A primeira UserOperation também implanta a smart account, por isso gasta mais gas. O status vai de *UserOperation enviada* para *Confirmada*.

A tela se atualiza sozinha por **SSE** (`GET /api/events`) quando o worker do servidor confirma a operação.

Verificação com rede (depois do teste no navegador):

```bash
npm run test:integration   # somente leitura por padrão; POC_INTEGRATION_WRITE=1 envia transações de teste
npm run reconcile:onchain  # o ledger SQLite deve bater com os saldos on-chain
```

Para apresentar a PoC à equipe, siga o [roteiro de demonstração](roteiro-demo.md).

---

## 4. Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `diagnose:sepolia`: `chainId = 1` | A URL da Alchemy é da mainnet. Use a de **Sepolia** (`eth-sepolia`). |
| `TREASURY_PRIVATE_KEY deve ter o formato 0x…` | Falta o prefixo `0x`, ou há aspas ou espaços. |
| `forge: command not found` no WSL | O Foundry está em `~/.foundry/bin`, fora do PATH. Rode `source ~/.bashrc` ou use o script, que já procura lá. |
| "Uma política de Controle de Aplicativo bloqueou este arquivo" | Smart App Control do Windows. Use o Foundry no WSL. |
| "Assinar no navegador" desativado | A smart account não tem ETH Sepolia para o gas. Envie ETH para o endereço **da smart account**. |
| Erro de origem no login Privy | Adicione `http://127.0.0.1:3000` em *Allowed origins* no painel Privy. |
| Conta vinculada antes da versão ERC-4337 aparece desconectada | Clique em **Conectar wallet** de novo; o servidor deriva a smart account. |
| Vitest: "failed to find the current suite" | Rode pelo PowerShell (`C:\...`), não pelo Git Bash (`/c/...`). |

---

## 5. Onde fica cada coisa

```text
contracts/            Mock USDC (Solidity, somente testnet)
docs/                 arquitetura, integração (API), segurança, roadmap, validação e este guia
scripts/
  dev/check-api.mjs           teste HTTP de ponta a ponta contra o servidor local
  poc/preflight-poc.mjs       valida formato do .env (sem rede)
  poc/sepolia-diagnostics.mjs valida rede, token, saldos e Pimlico (com rede)
  poc/deploy-mock-usdc.sh     deploy + mint do Mock USDC (Foundry)
src/
  app/                  Next.js: página e rota da API (/api/[...path])
  components/privy/     login Privy, smart account e envio de UserOperation (navegador)
  lib/domain/           ledger (SQLite), tipos compartilhados e aritmética de valores
  lib/wallet/           providers: simulado e Privy/Sepolia
  lib/chain/            viem: Mock USDC, tesouraria, verificação de receipts, smart account
  lib/server/           utilitários HTTP, proxy JSON-RPC (/api/rpc) e SSE (/api/events)
tests/                  espelha src/lib (domain, wallet, chain, server)
data/                   SQLite local (ignorado pelo Git)
```

Para resetar o estado local, pare o servidor e apague `data/bridge.sqlite*`. Os tokens já movimentados na Sepolia continuam on-chain.
