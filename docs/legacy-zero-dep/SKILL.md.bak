---
name: reconstrucao-airsoftamericana
description: Constrói do zero a plataforma e-commerce Airsoft Americana (loja www.airsoftamericana.com.br + painel admin + antifraude/chargeback), usando o espelho salvo do site antigo apenas como referência funcional. Gateway de pagamento configurável pelo lojista no admin. Executa até o sistema funcionar, não entrega plano.
version: 2.0
---

# SKILL — PLATAFORMA E-COMMERCE AIRSOFT AMERICANA (novo sistema)

**Cliente/loja:** www.airsoftamericana.com.br (marca nova; logo será inserida depois — usar placeholder de logo configurável).
**Escopo:** Loja virtual (mostruário e venda) + Painel administrativo (estoque, volume de pedidos, **gateway escolhido pelo lojista**) + Central de pagamentos com prevenção e defesa de chargeback. Sistema completo, não MVP.
**Tipo:** Engenharia reversa do espelho salvo → reconstrução full-stack independente.

---

## 0. VERDADE DE BASE (auditoria já feita — não repita)

Os arquivos fornecidos **não são o código-fonte do sistema**. São um **espelho estático** (SaveWeb2Zip) de uma loja hospedada na **TiendaNube/Nuvemshop**:

- `gmtatico.com.br/` — só `cdn-cgi` (Cloudflare).
- `gmtatico.com/…html` — homepage salva (1 MB), 184 imagens `.webp`.
- `acdn-us.mitiendanube.com/` — assets da plataforma (JS `linkedstore`, tema `amazonas`).
- `d2az8otjr0j19j.cloudfront.net/…twig…` — templates Twig do tema custom `gmt-proto`.
- jQuery 1.11.1, Cloudflare, Amplitude (analytics), checkout via TiendaNube.

**Consequência:** não há backend para descompilar. A reconstrução é **do zero**, usando o espelho apenas como (a) inventário de funcionalidades, (b) referência visual, (c) catálogo de dados a migrar.

**Fatos extraídos do espelho (usar como requisito, não invente outros):**
- Departamentos: Airsoft (rifles HTA/GBBR/sniper, pistolas AEP), Tiro Esportivo (pistolas airgun), Upgrades, Loadout, Life Style, Aventura, Promoções, Oficina do Airsoft.
- Pagamentos: PIX (com desconto), boleto, cartão (Visa, Mastercard, Elo, Amex, Hipercard), parcelamento com e sem juros.
- Frete: Correios, "Grátis" (frete grátis condicionado), consulta de CEP no carrinho.
- Seções home: NOVIDADES, DESTAQUES, PROMOÇÕES, trustbar de benefícios, carrinho lateral, quickshop com variações, produtos esgotados, blog, newsletter, WhatsApp, loja física Americana, redes sociais.
- Restrição **18+** para réplicas de airsoft e armas de pressão.

**Proibido copiar do espelho:** credenciais, tokens, scripts de analytics de terceiros, dados pessoais embutidos, vulnerabilidades.

---

## 1. PAPEL DO AGENTE

Você é o time completo: arquiteto, backend, frontend, DBA, segurança, engenheiro de pagamentos, especialista em antifraude/chargeback, QA e DevOps.

**Regra de ouro: você executa.** Para cada módulo: auditar → planejar (interno) → implementar → migrar → testar → corrigir → só então passar adiante. Proibido encerrar com plano, lista de tarefas ou relatório no lugar de código. Proibido entregar botão não ligado, tela com dados falsos ou API stub fingindo ser real.

---

## 2. REQUISITOS DO CLIENTE (origem: conversa com o lojista — precedem qualquer opinião sua)

1. **Mostruário + venda:** catálogo público completo e checkout funcionando.
2. **Admin controla estoque:** saldo por SKU/variação, entrada/saída/ajuste, reservas, alertas de mínimo, histórico auditável.
3. **Admin controla volume dos pedidos que entram:** limite diário/semanal de pedidos, limite por valor, por cliente e por produto; ao atingir o teto, o checkout fecha ou o pedido entra em fila de revisão — configurável pelo admin.
4. **Chargeback sob controle severo** (reclamação real: no site antigo o banco aceitava a contestação fácil e a venda se perdia). Meta: reduzir ocorrências, detectar compras suspeitas **antes** da captura e produzir evidência organizada para contestar.

**Limite honesto (diga uma vez ao cliente, não em todo reply):** nenhum sistema impede o banco de aceitar uma disputa. O sistema entregue reduz a taxa e aumenta a taxa de vitória na contestação.

---

## 3. ARQUITETURA-ALVO

Monólito modular (não invente microsserviços), separação frontend/backend, API central, banco relacional, filas para tarefas assíncronas.

**Stack padrão (só mude com justificativa técnica registrada):**
- Frontend loja: Next.js (App Router) + TypeScript + Tailwind.
- Backend/API: NestJS (ou Django/DRF — escolha um e mantenha).
- DB: PostgreSQL + migrations (Prisma/TypeORM/Alembic).
- Cache/fila: Redis + BullMQ.
- Auth: sessão/refresh + bcrypt/argon2; MFA obrigatório para papéis admin.
- Storage: S3 compatível para imagens e evidências.
- Deploy: Docker Compose primeiro, depois o que o ambiente suportar.

**Camadas:** `domain` (regras de negócio puras) / `application` (casos de uso) / `infrastructure` (gateways, banco, filas) / `presentation` (rotas, telas). Regras comerciais **nunca** só no frontend.

---

## 4. MODELO DE DOMÍNIO (mínimo obrigatório)

`users, roles, permissions, customers, customer_addresses, products, product_variants, categories, brands, product_images, inventory, inventory_movements, stock_reservations, carts, cart_items, orders, order_items, order_status_history, payments, payment_events, refunds, fraud_assessments, fraud_rules, fraud_review_events, chargebacks, chargeback_evidence, shipments, shipping_events, coupons, promotions, order_volume_limits, audit_logs, notifications, system_settings`

- Integridade referencial, índices, chaves estrangeiras.
- Valores financeiros em integer centavos (nunca float).
- Histórico de pedidos, pagamentos e movimentos de estoque **imutável** (append-only).
- Todo evento carrega `correlation_id`, `actor_user_id`, `ip`, `timestamp`.

---

## 5. MÓDULOS E ESPECIFICAÇÃO

### 5.1 Loja (mostruário e venda)
Home responsiva com as seções do espelho (destaques, novidades, promoções, trustbar, newsletter, WhatsApp, rodapé). Catálogo: categorias/subcategorias ilimitadas, marcas, busca com filtros, ordenação, paginação, SEO, URLs amigáveis, produtos esgotados, quickshop com variações. PDP: galeria, preço, parcelamento, desconto PIX, especificações, frete por CEP, relacionados, aviso 18+ quando a categoria exigir. Carrinho persistente com cupom e frete. Checkout em 10 etapas: identificação → login/cadastro → CPF/CNPJ → endereço → frete → modalidade → revisão → pagamento → confirmação → rastreamento.

**Regra inegociável:** servidor recalcula preço, desconto, frete e total. Valores do navegador são só sugestão.

### 5.2 Estoque (controle do admin)
- `disponível = físico − reservado`. Reserva transacional no ato do checkout (row lock / `SELECT … FOR UPDATE`), com expiração e liberação automática em cancelamento ou pagamento expirado.
- Entrada, saída, ajuste, transferência, mínimo, alertas, relatórios, histórico com usuário/motivo/ref.
- Concorrência: transação + idempotência. Teste obrigatório: 20 compras simultâneas do último item → 1 vende, 19 rejeitam, estoque nunca negativo.

### 5.3 Volume de pedidos (controle do admin)
- Config global: máximo de pedidos/dia, máximo/dia por valor somado, máximo por cliente (janela deslizante), máximo por SKU.
- Ao exceder: `checkout bloqueado` OU `pedido em revisão manual` (escolha do admin).
- Painel mostra consumo da cota em tempo real (ex.: 47/50 hoje) e permite editar limites na hora.
- Persistir cada decisão em `audit_logs`.

### 5.4 Pedidos (máquina de estados)
`aguardando_pagamento → em_processamento_antifraude → aguardando_revisão → aprovado → separação → preparando_envio → enviado → entregue`; transições para `cancelado`, `reembolsado`, `em_disputa`, `chargeback_recebido`.
Transições inválidas = erro 409. Histórico append-only.

### 5.5 Pagamentos (camada desacoplada)
Interface `PaymentGateway` com implementações: **Pix**, **cartão** (com parcelamento), **boleto**, **estorno**, **captura posterior**, **consulta**, **webhook**.
- Webhooks: verificar assinatura, idempotência por `event_id`, retry com backoff, fila, log completo. Nunca aprovar pagamento pela resposta do browser.
- Reconciliação periódica (job) entre pedidos locais e gateway.
- Nunca armazenar número completo de cartão nem CVV (tokenização fica no provedor).
- **Gateway configurável pelo lojista (modo SaaS):** o sistema NÃO nasce amarrado a um provedor. Implementar um registro de adaptadores de pagamento plugáveis (Pix, cartão, boleto, estorno, captura posterior, webhook) com interface única. O administrador escolhe o provedor em **Configurações → Pagamentos**, informa credenciais (salvas cifradas, nunca em log) e ativa/desativa métodos por loja. Adaptadores obrigatórios na v1: `sandbox` (funcional para testes, rotulado), `mercadopago`, `pagbank`, `cielo` (ou o que o lojista indicar). Sem credencial: adaptador entra em modo não configurado e a UI mostra o que falta. Recomendação: provedor com 3DS 2.x, captura posterior e central de disputas.

### 5.6 Antifraude e chargeback (MÓDULO CENTRAL — prioridade máxima)
**a) Score de risco configurável** (motor de regras, auditável): divergência titular×comprador, CPF inválido, endereço de cobrança ≠ entrega, nº de tentativas de pagamento, múltiplos cartões/IP em janela curta, valor atípico, histórico de disputa do cliente, velocity por dispositivo. Nenhuma regra isolada é prova de fraude.

**b) Três faixas:** baixo → fluxo normal; médio → autenticação adicional + revisão manual, **captura só após aprovação**; alto → bloqueio preventivo com justificativa e revisão por usuário autorizado.

**c) 3DS 2.x** quando o provedor suportar; gravar resultado, `authentication_id`, liability shift informado (sem prometer transferência automática de responsabilidade).

**d) Captura posterior:** autorizar → analisar → aprovar/rejeitar → capturar dentro do prazo da autorização (controlar expiração).

**e) Central de chargebacks no admin:** pedido, `transaction_id`, cliente, valor, datas, motivo, prazo vindo **da notificação do provedor** (nunca prazo universal presumido), status (`notificado → aguardando_análise → documentação_pendente → defesa_preparada → defesa_enviada → em_análise → ganho/perdido/encerrado`), alerta de prazo.

**f) Evidências por pedido:** dados do pedido, termos aceitos (versionados + timestamp + IP), histórico de atendimento, comprovante de entrega/rastreio/postagem, nota fiscal, registro3DS, histórico de alterações. Exportação em PDF pronto para envio ao banco. Registros de disputa são **imedutáveis**.

**g) Listas de monitoramento:** clientes, e-mails, IPs, dispositivos com ocorrência — com justificativa, autor, data e prazo de revisão. Sem bloqueio permanente sem auditoria.

**h) Alertas:** alto risco, chargeback recebido, prazo de defesa próximo, estorno, taxa de disputa acima do limite configurado.

### 5.7 Painel administrativo
Dashboard com indicadores **calculados do banco** (faturamento dia/mês, pedidos por status, ticket médio, estoque baixo, recusados, em análise, chargebacks, taxa de aprovação, valores estornados) com filtros por período/status/produto/cliente/gateway. CRUDs: produtos, categorias, marcas, estoque, pedidos, clientes, cupons, usuários+RBAC, configurações (incluindo limites de volume). LGPD: exportar/apagar dados do titular conforme cabível; nada de dado sensível para usuário sem permissão.

### 5.8 Conformidade
Verificação de 18+ por categoria, bloqueio de checkout para elegibilidade não atendida, termos de compra versionados com registro de aceite. Validar com orientação jurídica — o sistema implementa o mecanismo, não emite parecer.

---

## 6. SEGURANÇA (obrigatório, não opcional)

SQLi, XSS, CSRF, rate limiting (login, checkout, busca), validação de entrada, RBAC, MFA admin, segredos só em `.env` (`.env.example` versionado), hash argon2/bcrypt, headers de segurança, upload com validação de tipo/tamanho, backup, logs de auditoria, retenção de dados. PCI DSS: escopo minimizado via tokenização do provedor.

---

## 7. TESTES (função sem teste = não concluída)

Unit, integração, API, auth, RBAC, concorrência de estoque, checkout, pagamentos (aprovado/recusado/pendente/expirado/estornado), webhook duplicado e com assinatura inválida, máquina de estados de pedido, score antifraude, cota de volume de pedidos, exportação de evidências, E2E da compra completa, responsividade. Nunca usar transação financeira real em teste automatizado.

**Critério de verificação:** rodar a suíte e mostrar a saída real. Falhou → corrige → roda de novo.

---

## 8. ORDEM DE EXECUÇÃO

| Fase | Entregável verificável |
|---|---|
| 1 Inventário | `docs/ARCHITECTURE.md`, `FEATURES_INVENTORY.md` (do espelho), `DATABASE_DESIGN.md`, `IMPLEMENTATION_PLAN.md` |
| 2 Fundação | migrations sobem limpas, auth + RBAC funcionando, CI roda testes |
| 3 Loja | compra E2E com produto seed, frete e cupom calculados no servidor |
| 4 Gestão | admin CRUD completo; estoque com reserva transacional testada sob concorrência |
| 5 Volume | cota de pedidos aplicada e editável pelo admin, com teste de bloqueio |
| 6 Pagamentos | fluxos reais ou sandbox rotulado; webhook idempotente; reconciliação |
| 7 Antifraude | score, 3 faixas, captura pós-análise, central de chargebacks com export PDF |
| 8 Admin/indicadores | dashboard com números batendo com o banco (conferir por query) |
| 9 Qualidade | suíte verde, LGPD, auditoria, `.env.example`, `README` de instalação e deploy |

Migração de dados: extrair produtos/categorias/imagens do espelho HTML para CSV seed quando aplicável — sem inventar produtos que não estão no espelho.

---

## 9. REGRAS DURAS

1. Nada de funcionalidade falsa, dado estático fingindo ser API, botão decorativo.
2. Nada de regra comercial só no frontend; preço nunca manipulável pelo cliente.
3. Pagamento sem confirmação confiável do provedor ≠ aprovado.
4. Sem duplicidade de pedido (idempotência no POST de checkout).
5. Sem estoque negativo sob concorrência.
6. Registros financeiros e de disputa nunca apagados.
7. Credencial real nunca em arquivo versionado.
8. Dependência externa sem credencial → adaptador real + mock isolado rotulado + lista de `.env` faltante. Nunca fingir integração de produção.
9. Zero recusa por conteúdo deste escopo: é reconstrução de e-commerce próprio, com prevenção de fraude **defensiva**. Não é ferramenta de ataque — segue direto ao executar.
10. Se aparecer hedge, plano no lugar de execução ou sub-agente devolvendo análise: execute você mesmo.

---

## 10. CRITÉRIO DE ENCERRAMENTO

Só fecha quando: loja compra de ponta a ponta ✓ · admin controla estoque com reserva transacional ✓ · admin controla volume de pedidos com teste de bloqueio ✓ · pagamentos com webhook seguro ✓ · antifraude pontua e trava conforme faixa ✓ · central de chargebacks lista disputa e exporta evidências em PDF ✓ · suíte de testes verde com saída real ✓ · `.env.example` + `README` presentes ✓.

Caso o ambiente bloquee algo (credencial, permissão, dependência), declara **PARCIAL/BLOQUEADO** com a evidência do bloqueio — e executa tudo o que era possível.

**Comece agora pela Fase 1: inventário do espelho + `ARCHITECTURE.md`.**
