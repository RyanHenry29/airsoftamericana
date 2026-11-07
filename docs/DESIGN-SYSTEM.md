# Airsoft Americana — Premium Design System

Direção oficial de arte. Complementa o SKILL (direção e identidade) com os tokens
aplicados no código. Não substituir tecnologias nem remover funcionalidades.

## Tom
Especialista em airsoft — robusto, preciso, industrial, comercial de alto nível.
Não é template genérico, não é dashboard com cores trocadas.

## Paleta (SKILL)
| Token | Hex | Uso |
|---|---|---|
| Base | `#080A08` | fundos âncora (header, hero, footer) |
| Secundário | `#111411` | painéis escuros, faixas |
| Grafite | `#1B1F1B` | campos/inputs escuros, cartões escuros |
| Tático | `#8BCF16` | assinatura — CTAs, destaque, preço |
| Neon | `#A6F51B` | hover do tático |
| Prata | `#C8CBC8` | traços e rótulos técnicos |
| Branco | `#F4F5F2` | texto sobre preto / fundo claro |
| Texto cinza | `#929890` | rótulos, labels técnicas |
| Borda | `#292E29` | divisores discretos |

Distribuição: 65% escuros · 20% neutros/prata · 10% fotos/imagens · 5% verde.
Nunca vermelho como identidade. Azul não é decorativo. Verde não vira fundo inteiro.

## Tipografia
- Display: **Barlow Condensed** (títulos, uppercase, weigth 700–800)
- Texto: **Inter**
- Técnico/label/mono: **IBM Plex Mono**

## Componentes-âncora
- **Header**: topbar institucional mono + barra preta com logo sem moldura + busca + carrinho com badge + CTA verde.
- **Hero**: composição 2 colunas — texto comercial à esquerda, **placa industrial de especificação** à direita (logo, LED, cruz de mira, dados técnicos reais: loja física em Campinas, Correios, PIX −5%).
- **Faixa de benefícios**: lista horizontal mono, sem cards grandes.
- **Departamentos**: rail sticky à esquerda + fichas técnicas por linha (número, nome, sublinha de família de produtos, seta que desliza no hover).
- **Vitrine**: frame neutro por produto com sigla técnica, SKU, preço + PIX −5%, estado de esgotado/18+/estoque.
- **Auth (login/cadastro)**: shell dividido — hero escura com logo e manifesto à esquerda, formulário grafite/claro à direita. Cadastro agrupado em 3 blocos: identificação, documentação, segurança.
- **Admin**: sidebar escura, mesma assinatura verde, logo sem moldura, sem vermelho.

## Microinterações
- `reveal` com IntersectionObserver (`components/Reveal.tsx`), respeita `prefers-reduced-motion`.
- Hover: cards levantam 4px, botões com shine diagonal, linhas de departamento deslizam.
- Skeletons em loading; estados vazios desenhados; foco visível ouro verde.

## Regras de honestidade comercial
- Nenhum produto, review ou métrica fictícia para preencher tela.
- Esgotado aparece como esgotado; estoque 0 desabilita o CTA.
- Preço final sempre recalculado no servidor; frontend só exibe.
- Claims: "compra protegida", não "100% anti-chargeback".

## Verificação
- `apps/store` e `apps/admin` compilam (`next build`) com fontes via `next/font/google`.
- Sem `#e84040` ou qualquer vermelho de identidade no código-fonte.
