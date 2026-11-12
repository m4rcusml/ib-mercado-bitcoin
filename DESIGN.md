---
name: "MB Wallet Bridge"
description: "Sistema visual do simulador acadêmico local de conta custodial e wallet pessoal."
colors:
  orange: "#cc3b0c"
  orange-hover: "#b63208"
  ink: "#202b36"
  muted: "#5f6b78"
  line: "#e5e8ec"
  ground: "#f5f6f8"
  white: "#ffffff"
  nav: "#17212c"
  nav-active: "#2d302f"
  nav-active-ink: "#ff865c"
  custodial: "#253444"
  green: "#18734d"
  green-soft: "#edf7f1"
  red: "#ac302a"
  red-soft: "#fff0ee"
  focus: "#df7047"
  confirmed: "#29734f"
  confirmed-soft: "#eef7f1"
  processing: "#8d601c"
  processing-soft: "#fff7e7"
  failed: "#a13e35"
  failed-soft: "#fff0ed"
typography:
  display:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif'
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.24
    letterSpacing: "-0.035em"
  headline:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif'
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif'
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  body:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
  label:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif'
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.5
  balance:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif'
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  metadata:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif'
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: 'ui-monospace, "Cascadia Code", monospace'
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  status: "4px"
  control: "7px"
  inset: "8px"
  panel: "12px"
  pill: "20px"
  circle: "50%"
spacing:
  compact: "8px"
  control-gap: "12px"
  small: "16px"
  section: "20px"
  grid: "24px"
  panel-x: "27px"
  desktop-gutter: "38px"
components:
  button-primary:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.orange-hover}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "#3c4651"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  amount-input:
    backgroundColor: "{colors.white}"
    textColor: "#25313d"
    rounded: "{rounded.control}"
    height: "58px"
  navigation-item:
    textColor: "#bac4ce"
    rounded: "{rounded.control}"
    padding: "0 13px"
  navigation-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.nav-active-ink}"
  status-confirmed:
    backgroundColor: "{colors.confirmed-soft}"
    textColor: "{colors.confirmed}"
    rounded: "{rounded.status}"
    padding: "4px 7px"
  status-processing:
    backgroundColor: "{colors.processing-soft}"
    textColor: "{colors.processing}"
    rounded: "{rounded.status}"
    padding: "4px 7px"
  status-failed:
    backgroundColor: "{colors.failed-soft}"
    textColor: "{colors.failed}"
    rounded: "{rounded.status}"
    padding: "4px 7px"
  balance-custodial:
    backgroundColor: "{colors.custodial}"
    textColor: "{colors.white}"
    rounded: "{rounded.panel}"
    padding: "25px 27px 19px"
  panel:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.panel}"
---

# Design System: MB Wallet Bridge

## Overview

A direção implementada é uma interface financeira familiar, em português, com navegação azul-carvão, espaço de trabalho claro e laranja nas ações. A referência cromática ao Mercado Bitcoin atende ao contexto do projeto; a identidade textual mantém “simulador acadêmico” e a ausência de ativos reais explícitas.

A composição é operacional e compacta. Conta custodial e wallet têm saldos rotulados, materiais visuais distintos e a mesma hierarquia numérica. Ícones de traço, bordas finas e tipografia do sistema organizam a jornada; não há imagens raster, fontes remotas ou uma metáfora visual adicional.

**Key Characteristics:**

- Shell escuro e áreas de trabalho claras.
- Laranja para ações e seleção; estados com cor, texto e ícone.
- Saldos separados, números tabulares e unidade Mock USDC explícita.
- Painéis planos, cantos suaves e densidade financeira compacta.
- Identificação persistente da simulação.

Este documento extrai a implementação de `src/app/globals.css`, `src/app/page.tsx` e `src/components/icon.tsx`. O frontmatter registra valores base de desktop; adaptações responsivas e estados completos aparecem abaixo e em `.impeccable/design.json`.

## Colors

A paleta combina neutros frios com laranja de ação e pares semânticos de baixa saturação.

### Primary

- **Laranja de ação** (`orange`): fundo dos botões principais, links de ação, cursor de texto e seleção de controles.
- **Laranja pressionado pelo ponteiro** (`orange-hover`): mudança de fundo do botão principal quando habilitado.
- **Laranja de seleção na navegação** (`nav-active-ink`): texto e ícone da seção atual sobre o fundo escuro selecionado.
- **Anel de foco** (`focus`): contorno visível para navegação por teclado.

### Neutral

- **Tinta azul-carvão** (`ink`): texto principal.
- **Cinza de apoio** (`muted`): descrições, datas, ajuda de campo e metadados.
- **Cinza de divisão** (`line`): bordas e separadores dos painéis.
- **Fundo do ambiente** (`ground`): plano geral da área de trabalho.
- **Branco de superfície** (`white`): painéis, campos e barra superior.
- **Azul-carvão de navegação** (`nav`): sidebar e navegação superior no celular.
- **Seleção da navegação** (`nav-active`): fundo do item ativo no desktop.
- **Azul de custódia** (`custodial`): painel do saldo custodial, com texto branco e metadados claros.

### Semantic

- **Wallet ativa e validação** (`green` / `green-soft`): chip da wallet ativada.
- **Erro e divergência** (`red` / `red-soft`): ajuda de erro, falhas explicativas e reconciliação divergente.
- **Operação confirmada** (`confirmed` / `confirmed-soft`), **em processamento** (`processing` / `processing-soft`) e **falhou** (`failed` / `failed-soft`): pares próprios dos badges do histórico.

Os tons semânticos dos badges não substituem os pares globais: o CSS usa ambos em contextos distintos. As rampas do sidecar são amostras derivadas para inspeção da paleta; não representam novos tons aplicados na interface.

## Typography

**Fonte de interface:** `"Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif`. O sistema usa a fonte disponível no dispositivo, sem download.

**Fonte técnica:** `ui-monospace, "Cascadia Code", monospace` nos endereços fictícios e identificadores de operação. O símbolo decorativo do token usa `Georgia, serif`; essa exceção não se aplica a títulos ou texto.

### Hierarchy

- **Display:** abertura do login; passa para (29px), (28px) e (27px) conforme o viewport diminui.
- **Headline:** título de página; passa para (26px), (25px) e (24px) nos breakpoints menores.
- **Title:** cabeçalho padrão de seção. Painéis específicos usam títulos entre (15px) e (21px).
- **Body:** base da página. Descrições de painéis e ajuda operam entre (10px) e (12px); metadados compactos chegam a (8px) e (9px) no celular.
- **Button / Label:** peso semibold e caixa de frase; não transformar chamadas de ação em caixa alta.
- **Balance:** números com `font-variant-numeric: tabular-nums`. A unidade aparece menor, alinhada à linha de base, e nunca faz parte do destaque numérico.
- **Mono:** códigos quebram linha com `overflow-wrap: anywhere` nos detalhes.

O valor monetário usa separador de milhar por ponto e duas casas com vírgula. Endereços longos são abreviados no resumo e preservados para cópia.

## Layout

O desktop usa sidebar fixa de (230px), barra superior de (76px), aviso de simulação e conteúdo central com largura máxima de (1450px). A margem do conteúdo acompanha a sidebar; os gutters base são (38px), com topo de (34px).

Os saldos formam duas colunas iguais, separadas por (22px). A área operacional usa `minmax(0, 1.35fr) minmax(280px, 1fr)`, com gap de (24px), para dar mais espaço ao formulário. A vista de transferências usa proporção (1.25fr / 1fr) e mínimo lateral de (290px). Os painéis internos combinam espaçamentos reais entre (20px) e (27px); não há uma escala modular única imposta a todas as peças.

- **A partir de 1600px:** topo do conteúdo em (42px) e altura mínima do saldo em (230px).
- **Até 1200px:** sidebar de (205px), gutters de (27px), gaps operacionais de (20px) e proporção operacional (1.2fr / 1fr), com mínimo lateral de (270px).
- **Até 1020px:** sidebar de (185px), gutters de (23px), área operacional em uma coluna e painéis auxiliares em duas. Login também passa a uma coluna; a ilustração de fluxo e os benefícios laterais deixam de aparecer.
- **Até 760px:** sidebar vira cabeçalho estático; navegação horizontal com rolagem própria, itens compactos e cantos superiores de (5px). Não há margem lateral reservada. Gutters de (21px), barra superior de (58px) e rodapé empilhado. O histórico oculta a coluna de data.
- **Até 520px:** gutters de (17px), barra superior de (54px), saldos e painéis auxiliares em uma coluna. O cabeçalho da tabela desaparece; estado fica abaixo da descrição e valor à direita. Detalhes técnicos passam a rótulo e valor empilhados.

## Elevation & Depth

A profundidade vem de fundos tonais, bordas de (1px) e contraste entre shell, painel e área interna. Os painéis operacionais não têm sombra. O painel de login é a exceção, com sombra ambiente discreta (`0 8px 28px rgb(24 40 55 / 3%)`).

Campos de e-mail e valor ganham halo de foco (`0 0 0 2px #fbe8df`) e mudança de borda. O foco global usa contorno de (3px), afastado em (4px). Esses tratamentos indicam interação, sem elevar a composição inteira.

## Shapes

Painéis e cartões de saldo usam o raio global `--radius`. Botões, campos, itens de navegação de desktop e opções de cenário usam cantos menores (`rounded.control`). Badges têm raio compacto (`rounded.status`); áreas internas de direção usam `rounded.inset`.

Avatares, indicadores de estado e botões de inversão usam círculos. O marcador de rede é uma cápsula. Ícones são SVG inline com traço de (1.7), pontas e junções arredondadas; tamanhos variam conforme a função, em geral entre (13px) e (25px).

## Components

### Buttons

O primário é laranja, com texto branco, altura mínima de (42px), padding horizontal de (18px) e ícone à direita quando conduz a próxima etapa. O secundário tem fundo branco, texto cinza-azulado e borda (`#dce0e5`); no hover usa fundo (`#f6f7f9`) e borda (`#bac4cd`).

A variante compacta tem altura mínima de (35px), padding de (7px 12px) e texto de (10px). Ações textuais usam laranja, sem preenchimento, e sublinhado no hover. A ação destrutiva de reiniciar usa vermelho próprio, com confirmação explícita.

Botões têm transição de (160ms ease) para fundo, borda e texto. Desabilitados mantêm opacidade de (.54) e cursor de indisponível. Não há animação de escala ou deslocamento ao clicar.

### Inputs / Fields

O valor usa contêiner de (58px), borda (`#dce1e6`), número de (23px) com peso (550) e unidade de (11px). O foco muda a borda para (`#bb643f`) e aplica o halo descrito em Elevation & Depth. Até (520px), a altura fica em (56px).

Ajuda e erro ocupam a mesma região abaixo do campo; erro inclui ícone e texto. Campo inválido usa borda (`#c3635a`). O campo desabilitado recebe fundo (`#f7f8fa`) e texto (`#818b95`). O e-mail tem altura de (45px); o código demonstrativo, (52px), com números centralizados e espaçamento de (.45em).

### Navigation

Cada item de desktop combina ícone, rótulo e indicador circular no ativo, com altura mínima de (46px). O padrão tem texto (`#bac4ce`); hover usa fundo (`#263441`) e texto branco. O ativo tem par de cores próprio e hover (`#383934` / `#ff9c77`).

No celular, o ativo usa (`#2b363e`) com texto (`#ffa381`), sem indicador. O rótulo da seção atual também é comunicado por `aria-current="page"`.

### Status

Badges de operação combinam ícone, texto curto e fundo semântico. Usam tamanho de texto de (9px), peso (550), padding de (4px 7px) e largura ajustada ao conteúdo. Os estados são “Confirmada”, “Processando” e “Falhou”. No histórico estreito o badge passa a (8px) e padding de (2px 5px).

Reconciliação e alertas também combinam texto e sinal visual; nenhum resultado depende somente da cor.

### Cards / Containers

O painel padrão tem fundo branco, borda fina e cantos suaves. Cabeçalho, conteúdo e separadores preservam a mesma leitura horizontal. Linhas do histórico são botões expansíveis com hover (`#fafbfd`), detalhes em fundo (`#f9fafc`) e indicação de expansão.

Estados vazios centralizam ícone, frase e instrução. O carregamento usa blocos estáticos cinza, sem shimmer. Mensagens de sucesso e erro aparecem acima do conteúdo e podem ser fechadas.

### Balance / Reconciliation

O saldo custodial aparece no cartão azul, com rótulo de ambiente, chip “Simulada”, unidade Mock USDC e reserva separada no rodapé. A wallet usa branco e borda levemente quente (`#e7ded7`); antes da ativação mostra uma chamada de ação, depois mostra valor, endereço fictício copiável e reserva.

A reconciliação lista disponível de cada ambiente, valor reservado e total. Um divisor e o tamanho numérico maior separam o total. O estado final é escrito por extenso, com indicador semântico.

## Do's and Don'ts

### Do:

- **Do** manter “Mock USDC”, os rótulos dos dois saldos e a identificação de simulação visíveis nos contextos financeiros.
- **Do** reutilizar a sans de sistema e números tabulares para valores.
- **Do** preservar texto e ícone junto da cor em estados de operação e erro.
- **Do** usar bordas e fundos tonais para separar painéis operacionais.
- **Do** conservar foco visível e respeitar a preferência de movimento reduzido, que reduz transições a (.01ms).

### Don't:

- **Don't** apresentar a interface como plataforma oficial, carteira real ou conexão ativa com blockchain.
- **Don't** trocar os painéis operacionais planos por cartões com sombras fortes.
- **Don't** depender de fontes remotas, bibliotecas de ícones em runtime ou imagens raster para reproduzir as primitivas.
- **Don't** aplicar o laranja do botão principal a textos de apoio sobre branco; o texto secundário usa `muted`.
