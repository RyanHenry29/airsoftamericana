---
name: design-comercial-profissional
description: Use SEMPRE que for criar, redesenhar ou revisar qualquer interface (loja virtual, e-commerce, sistema, painel admin, site institucional, landing page, componente de UI). Força design comercial profissional, denso e funcional, com identidade de marca real, e proíbe o visual genérico de IA (gradientes, cards arredondados repetidos, ícones decorativos, seções-template, dados inventados). Dispare mesmo que o usuário não peça "design" explicitamente, e sempre que ele citar um site de referência.
---

# Design Comercial Profissional

Objetivo: toda interface sai com cara de produto comercial real, feito por um time de design, nunca de gerador de IA. Referência de qualidade: lojas especializadas maduras (ex.: GM Tático): hierarquia comercial clara, catálogo denso, navegação profunda, regras de venda coerentes, identidade forte do nicho.

## 0. Regra sobre referências
Analise o site de referência para entender **estrutura, hierarquia, padrões de interação e organização de conteúdo**. Nunca copie CSS, JS, HTML, textos, imagens, logos ou nomes de classes de terceiros. Reimplemente o comportamento com código próprio e identidade própria.

## 1. Antes de escrever código (obrigatório)
1. Defina em 5 linhas: público, nicho, tom, concorrentes/referências, ação comercial principal (comprar, pedir orçamento, agendar).
2. Defina **tokens** a partir do produto real (não de um tema padrão): 1 cor dominante, 1 acento funcional, neutros em 4-5 tons, 1 cor semântica para sucesso/erro. Máximo 3 cores com função declarada.
3. Escolha tipografia com personalidade do nicho (display condensada para títulos/preços/badges + sans legível para corpo). Nunca Inter/Roboto/system-ui puro como identidade.
4. Escala de espaçamento em múltiplos de 8; raio de borda único e pequeno (0-4px) para todo o sistema; uma única elevação (sombra) permitida, só para camadas flutuantes (dropdown, drawer, toast).
5. Liste os dados reais disponíveis (banco, API, arquivos do usuário). Se não existirem, a UI mostra estado vazio. **Nunca invente produtos, preços, depoimentos, métricas, prazos ou selos.**

## 2. Anatomia comercial (e-commerce)
Ordem e função de cada bloco; nenhum bloco sem função:
1. **Topbar** fina: promessa operacional real (entrega, loja física, rastreio).
2. **Header** fixo e compacto: logo, busca em destaque (largura dominante), conta, carrinho com contador. Encolhe ao rolar.
3. **Mega menu** por departamento, com subcategorias e uma linha descritiva por grupo (ajuda a escolher, ex.: tipos de sistema/propulsão). Abertura com atraso de intenção (~100ms), fechamento com tolerância (~200ms), acessível por teclado; no mobile vira menu lateral com expansão.
4. **Banners de campanha** (carrossel): setas, indicadores, pausa no hover, swipe, progresso. Conteúdo vem do admin.
5. **Faixa de benefícios** com fatos reais e verificáveis (troca, loja física, frete, pagamento).
6. **Departamentos**, **Novidades**, **Destaques**, **Mais vendidos**, **Promoções**, **Marcas**: todos alimentados pelo backend, com "ver tudo".
7. **Rodapé** completo: institucional, atendimento, endereço/horário, políticas (privacidade, trocas, frete, termos), CNPJ.
8. **Flutuantes** discretos: WhatsApp (só se número configurado), voltar ao topo, toast de carrinho.

**Card de produto:** foto (proporção fixa, `object-fit: contain`), marca, nome (2 linhas), preço em destaque, preço riscado + badge de % só quando a promoção é real, selo de estoque (esgotado/últimas unidades). Nada além disso.
**PDP:** breadcrumb, galeria, marca, preço, disponibilidade real, calculadora de frete por CEP, garantia/troca, abas (descrição, ficha técnica, relacionados).
**Listagem:** filtros (marca, preço, disponibilidade), ordenação, paginação, contador de resultados, estado vazio útil.

## 3. Proibido (assinatura de IA)
- Gradientes decorativos, glassmorphism, blobs, glow excessivo, sombras grandes em todos os cards.
- Cards arredondados idênticos empilhados; grid 3 colunas simétrico de "Features"; ícone circular + título + 3 linhas.
- Seções-template (Features / Pricing / FAQ / Testimonials) sem relação com o negócio.
- Emojis como ícones, ilustrações abstratas sem relação com o produto, hero com mockup flutuante.
- Lorem ipsum, "Produto 1", preços e depoimentos inventados, logos de clientes falsos.
- Texto de marketing vazio ("soluções inovadoras", "experiência única", "leve seu negócio ao próximo nível").
- Botões sem ação, links `#`, componentes decorativos sem função, modal para tudo.
- Mesmo componente genérico repetido em todas as páginas; dashboard-template com cards de métrica aleatórios.

## 4. Design system mínimo (entregar sempre)
Tokens CSS em `:root` (cores, tipografia, espaçamento, raio, z-index, durações). Componentes: botão (primário, secundário, desabilitado, loading), input/select/textarea (foco visível, erro), dropdown, navegação, card de produto, badge, modal/drawer, tabela, toast, paginação, breadcrumb.
**Quatro estados em todo dado assíncrono:** carregando (skeleton com a forma do conteúdo), vazio (com ação), erro (o que houve + o que fazer), sucesso.

## 5. Movimento com propósito
Permitido só quando comunica estado, direção ou feedback: header que encolhe, menu que abre, elevação de card no hover, blur-up de imagem, revelar ao rolar (leve, escalonado), carrossel com progresso, toast/drawer ao adicionar ao carrinho, pulso no botão de WhatsApp. Durações 150-400ms, easing suave; respeitar `prefers-reduced-motion`. Nada de animação contínua que distraia da compra.

## 6. Conteúdo e regras comerciais
- **Uma única fonte da verdade** para regras (frete grátis, desconto à vista, parcelamento, troca). Se a regra aparece em 3 lugares, vem do mesmo dado. Nunca deixe páginas se contradizerem.
- Selos e badges só com regra implementada no backend.
- Cópia curta, específica do nicho, em português correto; preços em `R$ 1.234,56`.
- Restrição de idade/legal do nicho exige gate real (confirmação no checkout), não só texto.

## 7. Qualidade técnica que o usuário percebe
- HTML semântico: um `<h1>` por página, `lang="pt-BR"`, landmarks, `alt` em imagens, foco visível, contraste AA, alvos de toque ≥ 44px.
- SEO: title/description únicos (sem entidades HTML quebradas), canonical, Open Graph com imagem 1200×630, `twitter:card`, JSON-LD (Organization, Product/Offer, BreadcrumbList).
- Performance: não duplicar DOM (um menu, um carrinho; adaptar por CSS), imagens WebP com `srcset`, lazy-load, CSS crítico enxuto, sem libs antigas.
- Páginas legais obrigatórias: Privacidade (LGPD), Termos, Trocas/Garantia (CDC), Frete.
- Responsivo de 320px a 1920px; mobile-first.

## 8. Checklist de auditoria antes de entregar
- [ ] Paleta com ≤ 3 cores funcionais e tokens aplicados em tudo?
- [ ] Tipografia com personalidade do nicho, hierarquia clara (título > preço > corpo)?
- [ ] Zero dado inventado; estados vazios implementados?
- [ ] Nenhum item da lista "Proibido" presente?
- [ ] Toda ação de botão/link funciona de verdade (ou está desabilitada e explicada)?
- [ ] Quatro estados em cada lista/consulta?
- [ ] Regras comerciais consistentes entre todas as páginas?
- [ ] `<h1>`, `lang`, meta, alt, foco e contraste verificados?
- [ ] Console sem erros; testado em 375px, 768px e 1280px?
- [ ] Nada copiado de site de terceiros?
Se algum item falhar, corrija antes de apresentar. Ao final, informe o que foi verificado e o que não pôde ser (ex.: sem navegador para teste visual).
