#import "report-theme.typ": report-accent, report-theme

#show: report-theme.with(
  title: "Auditoria técnica e plano de profissionalização",
  author: "Manus AI",
  rhythm: "report",
  running-header: true,
)

#let cite(url, n) = link(url)[#text(fill: report-accent)[[#n]]]
#let tag(txt, color: luma(235)) = box(fill: color, inset: (x: 7pt, y: 4pt), radius: 3pt)[#text(size: 8.5pt, weight: "bold")[#txt]]
#let callout(title, body, color: rgb("E9F1F4")) = block(fill: color, inset: 10pt, radius: 5pt)[
  #text(weight: "bold", fill: report-accent)[#title] \
  #body
]

// ---------- Capa ----------
#page(margin: (top: 25%, x: 2.2cm), numbering: none, header: none)[
  #set par(first-line-indent: 0em)
  #align(center)[
    #text(size: 28pt, weight: "bold", fill: report-accent)[Auditoria técnica e plano de profissionalização]
    #v(0.6em)
    #text(size: 15pt, fill: luma(80))[Airsoft Americana comparado à GM Tático]
    #v(2em)
    #line(length: 42%, stroke: 0.8pt + report-accent)
    #v(2em)
    #text(size: 11pt)[Análise de disponibilidade, UX, arquitetura de e-commerce, conteúdo, SEO, acessibilidade e direção visual]
    #v(2.5em)
    #box(fill: rgb("DDE9ED"), inset: (x: 7pt, y: 4pt), radius: 3pt)[#text(size: 8.5pt, weight: "bold")[RELATÓRIO TÉCNICO · 09 NOV 2026]]
    #v(4em)
    #align(left)[
      #text(size: 10pt, fill: luma(70))[Escopo]
      #v(0.4em)
      #text(size: 11pt)[Site analisado: airsoftamericana.vercel.app\
      Referência de mercado: gmtatico.com.br\
      Entrega: um único PDF com diagnóstico e plano de correção]
    ]
  ]
]

#page(numbering: none, header: none)[
  #outline(title: [Sumário], indent: 1.5em)
]

#counter(page).update(1)

= Leitura executiva

A prioridade não é estética. Na data e horário desta auditoria, a homepage de #link("https://airsoftamericana.vercel.app")[airsoftamericana.vercel.app] não respondeu dentro de 30 segundos em tentativas repetidas via HTTPS, enquanto `robots.txt` respondeu com HTTP 200. O mesmo comportamento ocorreu em uma captura headless: a página terminou em timeout e gerou apenas uma tela de erro. Isso caracteriza um bloqueio P0 de disponibilidade, antes de qualquer discussão de tipografia, banners ou catálogo.

A comparação com a #link("https://gmtatico.com.br")[GM Tático] mostra uma diferença de maturidade de produto digital: a referência apresenta categorias profundas, busca, conta, carrinho, cálculo de frete, WhatsApp, atendimento, loja física, políticas, benefícios de pagamento e blocos de merchandising. O objetivo não deve ser copiar a aparência, mas reproduzir a clareza de compra e a sensação de operação real.

O caminho recomendado é em três ondas: (1) recuperar disponibilidade e observabilidade; (2) construir uma base comercial mínima, com catálogo navegável, PDP, carrinho e confiança; (3) elevar a direção visual com fotografia consistente, hierarquia, conteúdo de orientação e provas de credibilidade. O resultado deve parecer uma loja especializada, não um template genérico nem uma interface “gerada por IA”.

#block(fill: rgb("FDEFE7"), inset: 10pt, radius: 5pt)[#text(weight: "bold", fill: report-accent)[Decisão de projeto] \ Não iniciar redesign visual antes de confirmar que a rota `/` entrega HTML estável, que os assets carregam e que o fluxo de produto → carrinho funciona em desktop e celular.]

= 1. Escopo, evidências e limitações

A análise foi feita em 09/11/2026, combinando acesso direto, extração de HTML, cabeçalhos HTTP, captura headless e leitura da arquitetura pública da referência. A indisponibilidade do site do cliente impede afirmar com segurança quais componentes já existem no front-end. Por isso, o relatório distingue três níveis: “observado” significa evidência direta; “provável” significa uma hipótese a validar quando o site voltar; “recomendado” significa decisão de produto baseada em boas práticas.

Foram usados como critérios técnicos a auditoria Lighthouse, que cobre performance, acessibilidade, boas práticas e SEO #cite("https://developer.chrome.com/docs/lighthouse", 1), os critérios WCAG 2.2 do W3C #cite("https://www.w3.org/WAI/WCAG22/quickref/", 2), e pesquisas de usabilidade de páginas de produto e checkout da Baymard #cite("https://baymard.com/research/product-page", 3) #cite("https://baymard.com/research/checkout-usability", 4).

#table(
  columns: (1.2fr, 1fr, 1.8fr),
  inset: 7pt,
  stroke: (x, y) => if y == 0 { (bottom: 1pt + report-accent) } else { (bottom: 0.3pt + luma(210)) },
  [*Área*], [*Evidência*], [*Implicação*],
  [Disponibilidade], [Observado], [A homepage não respondeu em até 30 s; tratar como incidente de produção.],
  [Robots], [Observado], [`/robots.txt` respondeu 200; isso não comprova que a home, sitemap ou assets estejam saudáveis.],
  [Conteúdo da home], [Não verificável], [Validar hero, categorias, produtos, prova social, políticas e rodapé após recuperar o acesso.],
  [Benchmark], [Observado], [GM Tático entrega uma referência de operação e arquitetura, não um padrão a copiar pixel a pixel.],
  [Métricas], [Pendente], [Rodar Lighthouse e testes reais em mobile após a home responder com estabilidade.],
)

= 2. Diagnóstico técnico do site do cliente

== P0 — disponibilidade e origem

O primeiro problema é a ausência de resposta útil na rota principal. HTTPS e HTTP foram testados; o HTTP chegou a redirecionar para HTTPS, mas a conexão HTTPS não entregou o documento dentro do limite de tempo. Já `robots.txt` respondeu. As hipóteses mais prováveis são: função serverless travada, loop ou dependência externa bloqueante, erro de build parcialmente publicado, problema de DNS/roteamento por domínio, ou aplicação que só responde em uma rota específica.

#text(weight: "bold")[O que arrumar agora:] validar logs da implantação na Vercel; testar a URL de deployment; confirmar variáveis de ambiente; remover chamadas síncronas de terceiros da renderização inicial; aplicar timeout e fallback para CMS, banco, busca e imagens; garantir que `/` produza HTML mesmo sem dados; configurar monitoramento externo de uptime; e definir uma página de erro honesta, com contato e tentativa de recuperação.

== P1 — robustez de front-end a validar

Assim que a home responder, auditar o console do navegador, erros de rede, assets 404/500, hidratação, fontes externas, imagens sem dimensões e scripts que bloqueiam a pintura. A meta não é perseguir uma nota “100” artificial. É entregar uma primeira renderização rápida, conteúdo principal estável e interações que não quebrem em conexão móvel.

#table(
  columns: (1fr, 1fr, 2fr), inset: 7pt,
  [*Teste*], [*Sinal de falha*], [*Correção*],
  [Renderização], [Tela branca ou spinner permanente], [SSR/SSG da home, skeleton curto e fallback de conteúdo.],
  [Rede], [Requests pendentes ou repetidos], [Timeouts, cache, retry limitado e chamadas não críticas após a primeira pintura.],
  [Imagens], [Layout salta ou há imagem quebrada], [Usar `width`/`height`, formatos modernos, `loading=lazy` abaixo da dobra e alt descritivo.],
  [JavaScript], [Erro de hidratação], [Reproduzir em produção, corrigir mismatch de dados e reduzir dependências no cliente.],
  [Responsivo], [Menu ou cards cortados], [Testar 375, 768, 1024 e 1440 px; usar fluxo CSS em vez de posições fixas.],
)

== P1 — SEO, acessibilidade e confiança

Quando o HTML voltar, validar título e description únicos, canonical, Open Graph, sitemap, robots, dados estruturados de produto e breadcrumbs. O site deve ser navegável por teclado, possuir foco visível, contraste suficiente, labels em campos, botão de busca identificável e textos alternativos que descrevam a função da imagem — alinhado às orientações WCAG 2.2 #cite("https://www.w3.org/WAI/WCAG22/quickref/", 2).

Para uma loja que comercializa itens de airsoft, confiança precisa ser explícita: identidade da empresa, CNPJ quando aplicável, endereço ou área de atendimento, WhatsApp, política de troca, garantia, envio, formas de pagamento, idade/uso responsável quando necessário e orientação para iniciantes. Esconder esses dados reduz a conversão e aumenta dúvidas no atendimento.

= 3. O que a GM Tático faz melhor

A GM Tático não é apenas uma home com banner. A extração pública mostra um menu de categorias com profundidade, incluindo sistemas de tiro, pistolas, miras, acessórios, magazines e equipamentos táticos. Também há atalhos para “Novo no airsoft?”, blog, rastreio, atendimento, loja física, conta e WhatsApp.

Na home, a referência combina carrossel promocional, faixa de benefícios, novidades com preço e parcelamento, frete grátis, links para regras, desconto via PIX e trocas/devoluções. O carrinho expõe estados de vazio, cálculo de frete por CEP e mensagens de estoque. Esses estados são parte do produto, não detalhes de acabamento.

#table(
  columns: (1.1fr, 1.25fr, 1.9fr), inset: 7pt,
  [*Elemento*], [*Função comercial*], [*Como adaptar para Airsoft Americana*],
  [Menu por intenção], [Reduz o esforço para encontrar produto], [Começar por “Armas”, “Proteção”, “Munição/BBs”, “Baterias”, “Acessórios”, “Fardamento” e “Para iniciantes”.],
  [Busca e conta], [Acelera retorno e recompra], [Busca com autocomplete, histórico de pedidos e recuperação de carrinho.],
  [Benefícios], [Responde “por que comprar aqui?”], [Frete, PIX, parcelamento, garantia e suporte em uma faixa curta e verificável.],
  [Conteúdo], [Educa e reduz erro de compra], [Guias de AEG/GBB, bateria, proteção ocular, manutenção e checklist de primeiro jogo.],
  [Merchandising], [Dá ritmo à home], [Novidades, mais vendidos, kits, ofertas por categoria e marcas, sem excesso de carrosséis.],
  [Pós-venda], [Diminui insegurança], [Rastreio, troca, devolução, atendimento e status de pedido acessíveis sem caça ao link.],
)

== O que não copiar

A referência tem muitos links e grande volume de informação. Para uma operação menor, replicar toda a taxonomia de uma vez pode produzir um menu pesado, categorias vazias e aparência de marketplace inacabado. Comece com poucas categorias que tenham estoque real e boas fotos. Só crie uma categoria quando houver produtos suficientes, filtros coerentes e uma página que mereça ser indexada.

= 4. Direção visual para parecer profissional

A direção recomendada é “tático premium funcional”: base escura ou neutra, verde-oliva usado com parcimônia, uma cor de ação consistente, tipografia sem serifa legível, textura apenas em áreas de marca e fotografia real de produto. Profissionalismo virá de alinhamento, ritmo, consistência de imagens, informação de preço e confiança — não de adicionar camuflagem, glitch, excesso de badges ou textos em caixa alta.

== Estrutura sugerida da home

#numbering("1.")
+ *Barra de serviço:* frete, PIX, parcelamento, atendimento e rastreio; poucos itens e links reais.
+ *Header:* logo, categorias, busca grande, conta, carrinho e WhatsApp. No celular, busca e carrinho devem permanecer acessíveis.
+ *Hero:* uma mensagem de posicionamento e um CTA principal. Exemplo: “Equipamento para jogar com segurança e confiança” + “Ver produtos”. Evitar cinco chamadas competindo.
+ *Categorias visuais:* seis a oito entradas com imagens próprias ou recortes de produto coerentes.
+ *Produtos:* novidades e mais vendidos, com preço, parcelamento, estoque e CTA; não usar cards sem informação.
+ *Bloco de orientação:* “Começando no airsoft?” com caminho guiado para proteção, réplica, BBs, bateria e manutenção.
+ *Provas de confiança:* avaliações, marcas, prazo de despacho, atendimento e políticas.
+ *Conteúdo:* três guias úteis, ligados a produtos; conteúdo deve ajudar a comprar, não só preencher espaço.
+ *Rodapé:* contato, empresa, políticas, formas de pagamento, redes sociais, newsletter opcional e mapa se houver loja física.

== Produto e checkout

A página de produto deve responder em segundos: o que é, para quem serve, o que acompanha, compatibilidade, especificações, disponibilidade, prazo e custo de envio. Galeria com fotos em ângulos diferentes, zoom sem perder nitidez, vídeo curto quando existir e tabela de especificações são mais valiosos que um banner decorativo.

O checkout deve permitir comprar sem obstáculos desnecessários. O carrinho precisa ter estado vazio, alteração de quantidade, remoção, cálculo por CEP, cupom com mensagem clara e resumo final. Evitar exigir cadastro antes de informar frete. As pesquisas da Baymard tratam produto e checkout como áreas críticas de usabilidade #cite("https://baymard.com/research/product-page", 3) #cite("https://baymard.com/research/checkout-usability", 4).

= 5. Referências visuais de mercado

As imagens abaixo são referências de direção e arquitetura, não materiais para copiar. Elas mostram padrões que funcionam: hero com área de respiro, grid de produtos, navegação por departamentos e fotografia aplicada ao universo tático. Na implementação final, prefira fotos próprias dos produtos e cenas autorizadas.

#figure(image("assets/gmtatico-home.png", width: 100%), caption: [Captura da homepage da GM Tático no momento da análise: banner, faixa de benefícios e merchandising. Fonte: gmtatico.com.br.])

#figure(image("assets/tactiko-theme.jpg", width: 85%), caption: [Referência visual de tema tático: composição de hero, mosaico de imagens e linguagem de “missão”. Fonte da imagem: Tactiko / Shopify Theme, via busca de imagens.])

#figure(image("assets/mir-tactical-home.jpg", width: 100%), caption: [Referência de loja airsoft/tática: banner temático, cards de produtos e hierarquia de departamentos. Fonte da imagem: MiR Tactical, via busca de imagens.])

#figure(image("assets/wgc-shop.png", width: 72%), caption: [Referência de vitrine com blocos promocionais e produtos destacados. Fonte da imagem: WGC Shop, via busca de imagens.])

#block(fill: rgb("EEF4E6"), inset: 10pt, radius: 5pt)[#text(weight: "bold", fill: report-accent)[Diretriz contra aparência de IA] \ Usar um sistema visual pequeno e repetível: uma família tipográfica, duas cores de ação, quatro tamanhos de raio, espaçamento em múltiplos de 4 e fotos com o mesmo fundo. Remover textos genéricos, números inventados, badges sem regra e blocos que parecem preenchimento. Cada seção precisa responder uma pergunta real do comprador.]

= 6. Backlog priorizado

#table(
  columns: (0.55fr, 1.2fr, 2fr, 0.8fr), inset: 7pt,
  [*Prioridade*], [*Entrega*], [*Critério de aceite*], [*Fase*],
  [P0], [Recuperar `/`], [Resposta HTML estável em HTTPS; sem timeout; logs sem erro crítico; health check ativo.], [Agora],
  [P0], [Observabilidade], [Uptime, logs, alertas de erro e monitoramento de assets principais.], [Agora],
  [P1], [Catálogo mínimo], [Categorias com estoque real, busca, filtros, PDP e imagens próprias.], [Base],
  [P1], [Carrinho e frete], [Adicionar/remover, CEP, prazo, total, estados vazio/erro/sucesso e checkout testado.], [Base],
  [P1], [Confiança], [Contato, políticas, pagamentos, envio, troca, garantia e atendimento visíveis.], [Base],
  [P1], [Mobile first], [Fluxo completo em 375 px; tap targets, menu, busca e carrinho utilizáveis.], [Base],
  [P2], [Direção visual], [Tokens de cor/tipo/espacamento, fotos consistentes, hero e componentes reutilizáveis.], [Refino],
  [P2], [Conteúdo guiado], [Página “começando”, guias e recomendações conectadas a produtos.], [Refino],
  [P2], [SEO técnico], [Metas, schema Product/Breadcrumb, sitemap, canonical, OG, alt e páginas indexáveis.], [Refino],
)

= 7. Plano de validação antes de publicar

#numbering("1.")
+ *Disponibilidade:* cinco acessos consecutivos em HTTPS; cold start e warm start medidos; rota de erro testada.
+ *Performance:* Lighthouse em mobile e desktop; registrar LCP, INP, CLS e peso total. Corrigir a maior causa, não apenas a nota #cite("https://developer.chrome.com/docs/lighthouse", 1).
+ *Acessibilidade:* teclado, foco, contraste, zoom 200%, leitor de tela básico, labels e mensagens de erro. Usar WCAG 2.2 como referência #cite("https://www.w3.org/WAI/WCAG22/quickref/", 2).
+ *Compra:* buscar produto, abrir categoria, filtrar, ver PDP, informar CEP, adicionar ao carrinho, remover, voltar, usar mobile e concluir o checkout em ambiente de teste.
+ *Conteúdo:* nenhum preço fictício, SKU quebrado, produto sem foto, link sem destino, texto de placeholder ou promessa sem regra publicada.
+ *Dados:* eventos de busca, view_item, add_to_cart, begin_checkout e purchase; consentimento de analytics conforme necessidade do negócio.
+ *SEO:* uma intenção por página, títulos e descriptions úteis, indexação controlada de filtros e sitemap coerente.

= Conclusão

A transformação mais importante é operacional: tornar a loja confiável, navegável e verificável. A estética deve apoiar isso. O primeiro marco é uma homepage estável; o segundo é um fluxo de compra completo; o terceiro é uma identidade tática própria, baseada em fotografia e conteúdo útil.

Se a equipe executar apenas a camada visual sobre uma aplicação que ainda trava, o resultado parecerá mais caro sem ser mais confiável. Se executar a base comercial e aplicar a direção visual proposta, a Airsoft Americana poderá se aproximar do nível de clareza da GM Tático sem imitar sua marca ou carregar a complexidade de um catálogo maior.

= Referências

[1] #link("https://developer.chrome.com/docs/lighthouse")[Chrome for Developers — Lighthouse.]

[2] #link("https://www.w3.org/WAI/WCAG22/quickref/")[W3C — How to Meet WCAG 2.2: Quick Reference.]

[3] #link("https://baymard.com/research/product-page")[Baymard Institute — Product Details Page UX Research.]

[4] #link("https://baymard.com/research/checkout-usability")[Baymard Institute — E-Commerce Cart & Checkout Usability Research.]

[5] #link("https://airsoftamericana.vercel.app")[Airsoft Americana — domínio auditado.]

[6] #link("https://gmtatico.com.br")[GM Tático — site usado como referência de arquitetura e merchandising.]

#text(size: 8.5pt, fill: luma(90))[Observação sobre imagens: as referências visuais de terceiros foram incluídas apenas como benchmark de composição e arquitetura. Para uso comercial, substituir por imagens próprias, licenciadas ou autorizadas.]
