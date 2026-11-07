# Relatório Fase A — Auditoria do monorepo (sem alterações de sistema)

Data: 2026-11-07 · Escopo: comparação do monorepo real (apps/store, apps/api, apps/admin, packages/shared) contra `docs/DEPLOY_E_ADMIN_SAAS.md` §1.3 (esconder o admin), §1.4 (hardening) e §2.2 (módulos do admin). Nada foi alterado no código durante esta fase; commits anteriores: 790dab0 (backup), 24ac08a (skills), 5b303a6 (AGENTS.md), 07271e3 (fix lock PGlite), 6c750ae (doc v2 adotada).

## 1. O que existe e funciona

### Infra da API
- Fastify com helmet, CORS fechado por origem, rate-limit global (600/min) + limites dedicados por rota de acesso (login cliente 5/min com bloqueio 15 min; cadastro 3/h com bloqueio 24 h; admin-login 10/min com bloqueio 15 min) — todos ajustáveis por env, validados com Zod em `config.ts`.
- Cookie de carrinho `aa_cart` HttpOnly/SameSite=Lax/7 dias.
- PGlite para dev/testes com **lock exclusivo por diretório** (segunda instância recusa subir em vez de corromper o cluster; deteção de holder vivo com proteção contra reciclagem de PID no Windows).
- Migração e seed automáticas na subida (`db/migrate.ts`, `db/seed.ts`); seeds de catálogo e taxonomia reais (176 KB + 72 KB de dados estruturados, não mock).

### Schema (Drizzle)
- 30+ tabelas cobrindo o §2.2 no nível de dados: users/sessions, customers(+addresses), brands/categories/products(+variants/images/specs/related), inventory(+movements), carts(+items), orders(+items/status_history), payments(+events/refunds), fraud_rules/assessments/review_events/watchlist, chargebacks(+evidence), shipments(+events), coupons/promotions, orderVolumeLimits, gatewayConfigs, auditLogs, systemSettings, notifications, dailyMetrics, newsletterSubscribers, banners, homepageSections, supportTickets, blogPosts.
- Valores financeiros **em centavos (integer)** em todas as tabelas.
- Enums completos: `order_status` com 13 estados (antifraude/chargeback inclusos), `payment_status`, `chargeback_status` com fluxo de defesa.
- Campos LGPD no pedido: `termsVersion`, `termsAcceptedAt`, `termsIp`. Campos de risco no pedido: `riskLevel/riskScore/riskReasons`.
- `paymentEvents` com uniqueIndex `(provider, eventId)` — pronta para idempotência de webhook.
- `users.mfaEnabled/totpSecret` presentes no schema (aguardando fluxo).

### Checkout (recálculo no servidor — regra do guia §1.4 cumprida)
- `handleCheckout`: preço SEMPRE lido do banco (`productVariants.priceCents/promoPriceCents`), nunca do cliente; subtotal/desconto/frete/total recalculados no servidor.
- Reserva de estoque transacional com `SELECT ... FOR UPDATE`, idempotente por (variante, pedido); bloqueio de estoque negativo e de ajuste abaixo do reservado; movimentações com antes/depois, motivo e autor.
- Cupom validado no servidor (validade, mínimo, esgotamento); PIX com desconto percentual vindo do gateway configurado.
- Limites de volume de pedido (por dia, faturamento, valor máximo, por cliente) com ação configurável (bloquear checkout ou enviar a revisão manual).
- Desconto de cupom "frete" aplicado ao frete no fechamento, não ao subtotal.

### Antifraude
- `assessRisk`: regras vindas do banco com fallback padrão (tentativas recusadas 24h, velocidade de pedidos, valor alto, endereço divergente, watchlist, sem CPF, cliente novo + valor alto); score 0–100 → baixo/medio/alto.
- Tríade automática no checkout: alto → bloqueia cobrança e vai para `em_analise_antifraude`; medio ou volume → `aguardando_revisao_manual`; baixo → segue para captura.
- Persistência em `fraudAssessments` + espelho nos campos de risco do pedido.

### Pagamentos
- Arquitetura de adapters com registry: `PaymentAdapter` com createPayment/capture/refund/verifyWebhookSignature/parseWebhook.
- Credenciais de gateway cifradas com **AES-256-GCM** (`lib/crypto.ts`) no `gatewayConfigs` —	comparável ao §1.4 "segredos nunca em texto".
- `SandboxAdapter` funcional (PIX fake, boleto fake, decline token, HMAC timing-safe) e adapters reais esboçados para **Mercado Pago, PagBank e Cielo** (endpoints reais, PIX/boleto/cartão, capture/refund, idempotency-key no MP).
- Ativação por banco (isDefault/enabled) com fallback para env; captura automática apenas com risco baixo e config permitindo.

### Chargebacks (defesa)
- Serviço completo de dossier: chargeback + evidências + pedido + itens + termos aceitos + histórico de status + antifraude + eventos de pagamento.
- Exportação em **PDF gerado à mão (zero dependência)** para envio ao banco/gateway.
- TIPOS de evidência cobertos: nota, documentos (content/fileUrl), autor rastreado.
- Máquina de estados do chargeback completa no enum e na transição por status.

### Pedidos
- Transição com `canTransition` (409 em transição inválida) + histórico (`orderStatusHistory`) + liberação de estoque em cancelado/reembolsado.
- Números de pedido sequenciais por dia (`AA-YYMMDD-000001`).

### Auditoria
- `lib/audit.ts` append-only por design da aplicação (nunca UPDATE/DELETE no código), com antes/depois, IP, correlationId.
- Gravada em login/cadastro/admin-login, checkout, transições de pedido e mudanças de chargeback.

### Loja (front)
- Next.js App Router com dados todos da API; **topbar/PDP sem valor comercial hardcoded** (frete grátis / PIX / parcelamento vêm de `/api/store/settings` com skeleton em vez de valor inventado).
- OG image programática 1200×630, JSON-LD Product, h1 único por página (verificado página por página).
- Páginas reais: home, catálogo, busca, departamento, marca, PDP, carrinho, checkout, conta, cadastro/entrar, institucional/privacidade/termos, rastreamento, blog.
- Painel admin: login, dashboard (métricas reais de `/api/admin/metrics`), orders, products(+new), categories, customers(+new), cupons, fraud, users.

### Rotas públicas
- home, products, product/:slug, categories, brands, departments/:slug, settings, search suggestions, orders/track, tickets, blog, newsletter, cart completo (items/coupon), shipping/quote, coupons/validate, checkout, orders (cliente), auth (register/login/me/logout/admin-login).

### Qualidade
- `tsc --noEmit`: **0 erros** em store, api e admin.
- Suíte raiz (vitest): **30/30**. Workspaces: shared 6/6, api 11/11.
- Testes reais de concurrency de estoque (20 compras simultâneas do último item: 1 vende, 19 rejeitam, estoque nunca negativo).

## 2. O que existe incompleto

1. **Webhook de pagamento não existe como rota** (achado crítico). Tudo em volta está pronto: `webhookTargetStatus()` mapeia evento→status, `paymentEvents` tem uniqueIndex para idempotência, cada adapter tem `verifyWebhookSignature`/`parseWebhook`. Mas **não há nenhuma rota `POST /api/payments/webhook`** (ou `/webhooks/:provider`) — grep confirma zero chamadas a `getAdapter` fora do types.ts. Consequência real: pagamento PIX nunca é confirmado (o pedido fica pendente para sempre); pagamentos com captura posterior nunca são capturados; `webhookTargetStatus` é código morto.
2. **Chargeback nunca é criado**: nenhuma rota insere em `chargebacks` — nem webhook (que não existe), nem entrada manual no admin. A central de defesa tem leitura/atualização/PDF, mas não se alimenta.
3. **Frete simulado**: `calculateShipping` é tabelinha por primeiro dígito do CEP + peso, com "Correios como referência" no comentário. Sem contrato/credencial real (a diabetes simular é honesta, mas o `shipping/quote` usa esses números como se fossem finais).
4. **Auth admin abaixo do §1.3**:
   - bcrypt cost 12, não **argon2id**;
   - JWT HS256 **24 h** e cookie de session 12 h **com o token também no corpo da resposta** (token acessível a JS — melhora nada e abre superfície XSS; deve ser cookie-only HttpOnly);
   - **sem MFA** (schema tem `mfaEnabled/totpSecret`, zero fluxo de setup/verificação);
   - **sem CSRF** em mutações;
   - `requireRole` existe mas só diverge admin/manager na prática — papéis `operator/viewer` não são testsáveis como "estoque/atendimento/marketing/financeiro/somente-leitura" do guia;
   - sem `Cf-Access-Jwt-Assertion` (404 quando ausente);
   - sem convite expirável para criar usuários;
   - sem bloqueio progressivo (o rate-limit é fixo, não progressivo);
   - sem `X-Robots-Tag: noindex`/robots.txt no painel (a verificar em headers reais).
5. **Auditoria imutável só na aplicação**: `auditLogs` é append-only pelos helpers, mas nenhuma regra de banco/grant impede UPDATE/DELETE direto. `listAudit` ordena crescente (deveria ser desc) e conta total com `SELECT *` inteira em memória.
6. **JWT_SECRET tem default inseguro** (`dev-insecure-secret-troque-em-producao`) — a API não falha em produção sem a var trocada. `decryptCredentials` engole erro de criptografia retornando `{}` (falha vira "gateway não configurado" genérica).
7. **Dupla origem de regra comercial**: frete grátis vem de `config.FRETE_GRATIS_APARTIR_DE` (env) no shipping, mas a topbar/PDP lê `settings.free_shipping_from_cents` (banco). Duas fontes para a mesma regra viola AGENTS.md — unificar no settings do banco.
8. **Banners com vigência mas sem execução**: `startsAt/endsAt` existem; sem worker/consulta garanhona confirmada para virar/agendar automaticamente. Homepage sections sem rascunho/preview/versionamento/rollback.
9. **Testes decorativos**: `vitest/webhook-test.test.ts` e `volume-test.test.ts` testam lógica desenhada em variáveis locais (tautologias), não o sistema. Checkout.test.ts é real. A percentagem de cobertura real é menor do que a suíte sugere.
10. **Sem single source de notificações**: tabela `notifications` existe; nada envia e-mail/Push/WhatsApp.

## 3. O que falta (não existe)

### §1.3 — Camadas de proteção do admin
- Cloudflare Access + validação de JWT `Cf-Access-Jwt-Assertion` na API/admin (404 sem ele).
- MFA TOTP **e** passkey/WebAuthn obrigatórios.
- argon2id; bloqueio progressivo; sessão curta com **rotação**; cookie HttpOnly+Secure+SameSite=Strict exclusivo de session sem token no corpo.
- CSRF em toda mutação.
- Convite expirável (superadmin cria; sem cadastro público).
- RBAC real com os 7 papéis do guia (`superadmin, gerente, estoque, atendimento, marketing, financeiro, somente-leitura`) e filtros por módulo em TODAS as rotas admin.
- `noindex` + `robots.txt` do painel + sem sitemap.
- Alerta por e-mail (login novo, mudança de permissão, alteração de preço em massa).

### §1.4 — Hardening
- Usuário de banco **com menor privilégio** separado do usuário de migração.
- Upload de imagem com validação de magic bytes, limite de tamanho, reprocessamento (sharp) e domínio de entrega separado (hoje as imagens de produto são URLs externas sem pipeline próprio).
- `gitleaks`, Dependabot, `npm audit` no CI.
- Reconciliação periódica de pagamentos com o gateway (worker).
- Consentimento de cookies, exportação e exclusão de dados do cliente (LGPD) no admin.
- Gate 18+ no checkout (hoje só checkbox de termos).

### §2.2 — Módulos do admin
1. **Dashboard parcial**: faturamento/pedidos/ticket/por status/estoque baixo OK. **Falta**: fila antifraude na home, falhas de webhook, conversão, pedidos pendentes destacados.
2. **Produtos**: CRUD, variantes, preço/estoque, imagens (URL manual), specs, relacionados OK. **Falta**: galeria com upload R2 + reordenar, EAN, editor de SEO por produto, histórico de preço, import/export CSV, edição em massa.
3. **Categorias/marcas**: CRUD básico OK. **Falta**: mega menu em editor visual com drag-n-drop por grupos/links/descrições.
4. **Estoque**: reservas, movimentação com motivo/autor, extrato OK. **Falta**: múltiplas unidades/depósitos (loja física vs depósito) e transferência entre unidades — inventory é 1:1 com variante.
5. **Pedidos**: transição, rastreio OK. **Falta**: notas internas, reembolso parcial (o adapter tem refund, a UI/rota não), etiqueta de envio, e-mail ao cliente na transição.
6. **Pagamentos/conciliação**: transações gravadas no checkout. **Falta**: tela de conciliação, divergências, status de webhook, reprocessamento.
7. **Antifraude**: regras no banco, watchlist, assessores persistem, painel fraud/page.tsx lê fila. **Falta**: aprovar/recusar com justificativa gravável na fila, disparar múltiplas regras custom, lista de bloqueio gerenciável do painel.
8. **Promoções**: tabela e routes existem; **motor de regras do guia** (leve X pague Y, progressivo, frete grátis por categoria/marca, prioridade/empilhamento, simulador de carrinho) **não existe** — só cupom.
9. **Cupons**: validação e uso OK. Falta relatório de uso por cliente.
10. **Banners**: CRUD + vigência OK. **Falta**: métricas de clique, upload, agenda viva (worker).
11. **Editor da home**: sections com order/config persistido. **Falta**: preview (draft mode), publicar/agendar, rollback/histórico de versões.
12. **Frete**: tabela faixa de CEP/percent. **Falta**: integração real (Correios/JadLog/agregador), regras por peso/peso/CEP configuráveis, prazo de manuseio.
13. **Clientes**: CRUD/mostrar. **Falta**: exportação/exclusão LGPD, notas do cliente.
14. **Conteúdo**: blog completo (rotas públicas + admin), páginas institucionais, FAQ OK.
15. **Relatórios**: `/api/admin/reports` existente (métricas + top produtos). **Falta**: exportação CSV/XLSX, margem.
16. **Usuários/permissões**: página users + roles no schema. **Falta**: convite, MFA, sessões ativas, revogar acesso.
17. **Auditoria**: consulta existe. **Falta**: filtro por usuário/período, imutabilidade no nível de banco.
18. **Configurações**: settings + gateways no admin. **Falta**: e-mails transacionais com templates, webhooks de saída, chaves de API, feature flags.

### Outdoor (Parte 1 do guia)
- Docker Compose prod, Caddy, GH Actions, staging, Sentry, uptime, backup criptografado, RUNBOOK, checklist §1.9: nada existe (planejado para a fase final — registrado para traçar sequência).
- Redis/filas (BullMQ/pg-boss), worker, e-mail (Resend/SES), storage (R2/S3): **não instalados**.

## 4. Leitura executiva para as próximas fases

O coração transacional do monorepo é sólido: preço/estoque recalculados e travados no servidor, antifraude avaliado, adapters plugáveis, auditoria presente. Os **três pontos cegos** que precisam entrar antes de qualquer módulo novo (como o guia prevê: Fase B antes de tudo):

1. **Webhook de pagamento** — sem ele, PIX/boleto não fecham venda e a fila antifraude não se resolve sozinha. Sistema está operacionalmente "vendido" só para cartão com captura imediata via checkout (e acredite apenas no sandbox).
2. **Segurança do painel** (Fase B) — MFA/argon2id/CSRF/convite/RBAC refinada — o guia exige antes do admin crescer, e cada item acima está demonstrado como gap real (não inferido).
3. **Fase C** — revalidate/webhook assinado de revalidação da loja, rascunho/agendamento com worker, versionamento/rollback da home/menu.

Dependências externas que nenhum código resolve (responsabilidade do lojista): credenciais de gateway (Mercado Pago/PagBank/Cielo — adapters já codados), credenciais de frete real, arte (logo, fotos, banners). Sem elas, o sistema permanece em sandbox/frete simulado e placeholders de imagem — declarado com honesty aqui, sem proclamar "pronto" antes de tempo.

Com os gaps mapeados acima, a Fase B pode começar de imediato (lista completa, com os pontos priorizados) tão logo o OK do usuário/Claude Code chegue.
