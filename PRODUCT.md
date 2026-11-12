# MB Wallet Bridge — simulador acadêmico

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js, React e TypeScript conforme o TAP. SQLite nativo do Node.js para a base local, sem provisionamento. A troca por PostgreSQL integra a evolução da PoC.

## Users

Equipe do projeto Inteli Blockchain em parceria com Mercado Bitcoin, desenvolvendo e validando a comunicação entre conta custodial simulada e wallet pessoal.

## Product Purpose

Fornecer uma plataforma local executável, com interface e API, para iniciar a integração Web2/Web3. O usuário confirmou nesta sessão uma jornada inteiramente simulada, com pontos de integração para a equipe.

## Operating Context

Login demonstrativo por e-mail e código; ativação de wallet fictícia; saldos separados; envio e retorno de Mock USDC; confirmação, falha, estorno e reconciliação. Nenhum ativo real ou chamada a uma blockchain.

## Capabilities and Constraints

Persistência local, idempotência e valores inteiros. Sepolia é a rede alvo da futura integração, não uma conexão ativa. A conta inicia com 10.000,00 Mock USDC fictícios (premissa desta implementação). Não se deve publicar como plataforma oficial do MB. O documento contém conflito entre truncar valores e rejeitar mais de duas casas; a decisão deve estar documentada.

## Brand Commitments

O usuário pediu uma simulação da plataforma Mercado Bitcoin. Interface financeira familiar em português, com referência cromática laranja e identificação explícita de simulador acadêmico. Nenhuma alegação de réplica oficial ou ativo real.

## Evidence on Hand

TAP fornecido pelo usuário: `TAP - Inteli Blockchain e Mercado Bitcoin - MB Wallet Bridge.pdf`, sete páginas. O documento original não integra este repositório. O pedido inicial foi construir a base local; o TAP informa a direção e os requisitos futuros, sem substituir a autorização do usuário.

## Product Principles

- Saldos custodial e da wallet sempre distinguíveis.
- A simulação é explícita em transações, identidade e rede.
- Reservas, falhas e confirmação preservam o total.
- A equipe consegue operar a API e substituir o transporte simulado sem reconstruir a jornada.
