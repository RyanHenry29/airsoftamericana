# Contrato da API — fonte de verdade para API, loja e admin

Base: `http://localhost:4000` (dev). Todas as rotas em `/api`. Erros: `{ "error": { "code": string, "message": string, "details"?: any } }` com status 400/401/403/404/409/429. Sucesso: JSON direto ou `{ data: ... }`.

Auth: cookie `aa_session` (httpOnly) OU header `Authorization: Bearer <jwt>`. JWT carrega `{ sub, role, type: "access" }`. Papéis: `admin | manager | operator | viewer`. Rotas `/api/admin/**` exigem papel; `viewer` é somente leitura.

## Público / Loja
- `GET /api/store/home` → `{ featured[], news[], sale[], banners[] }`
- `GET /api/store/products?category=&brand=&q=&sort=&page=&limit=` → paginado
- `GET /api/store/products/:slug` → produto + variants + images + relacionados
- `GET /api/store/categories` · `GET /api/store/brands`
- `POST /api/shipping/quote` `{ zip, items:[{variantId,quantity}] }` → `{ options:[{carrier,days,priceCents,free}] }`
- `GET /api/coupons/validate?code=&subtotalCents=` → `{ valid, discountCents, kind, message }`

## Carrinho (cookie `aa_cart`)
- `GET /api/cart` → `{ items[], subtotalCents, coupon? }`
- `POST /api/cart/items` `{ variantId, quantity }`
- `PATCH /api/cart/items/:variantId` `{ quantity }`
- `DELETE /api/cart/items/:variantId`
- `POST /api/cart/coupon` `{ code }` · `DELETE /api/cart/coupon`

## Auth cliente
- `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
- Cliente logado em `req.customer` (cookie `aa_customer`).
- **Sessão só no cookie** `aa_customer` (httpOnly, SameSite=Lax, Secure em produção, 7 dias).
  A resposta de login/cadastro devolve `{ customer }` — **nunca** devolve token, e o front
  não guarda token no `localStorage`.
- **Rate limit por rota:** login → 5 tentativas/min (bloqueio de 15 min); cadastro →
  3 tentativas/h (bloqueio de 24 h). Excedeu: `429` + header `retry-after` +
  `{ error: { code: "rate_limited", details: { retryAfterSeconds } } }`.
  Ajustável por `AUTH_LOGIN_MAX` / `AUTH_LOGIN_WINDOW_MS` / `AUTH_LOGIN_BLOCK_MS` /
  `AUTH_REGISTER_MAX` / `AUTH_REGISTER_WINDOW_MS` / `AUTH_REGISTER_BLOCK_MS`.
- Senhas com bcrypt, 12 rounds. Login e cadastro gravam log de auditoria
  (`auth.login`, `auth.login.failed`, `auth.register`, `auth.logout`) com e-mail mascarado.

## Checkout
- `POST /api/checkout` body do `checkoutSchema` (shared) + `deviceFingerprint?`
  → `{ orderNumber, status, payment: { method, provider, payload?, expiresAt?, status } }`
- Fluxo interno obrigatório: recalcular valores no servidor → validar estoque → `checkOrderVolume` → criar pedido (transação) → `reserveStock` → `assessRisk`/`saveAssessment` → transição de status conforme risco → `adapter.createPayment` → gravar `payments`.
- Risco médio → `aguardando_revisao_manual`; risco alto → `em_analise_antifraude` (ou recusa com justificativa quando ação=block).

## Pedidos (cliente)
- `GET /api/orders` (meus) · `GET /api/orders/:number` → itens, status, timeline, rastreio

## Webhooks
- `POST /api/webhooks/:provider` — RAW body obrigatório. Verificar assinatura (`verifyWebhookSignature`); insert idempotente em `payment_events` (unique provider+eventId) → se duplicado: 200 e ignora. Processar: pagamento aprovado → transição do pedido + payments.status=aprovado; chargeback → criar `chargebacks` com `respondBy` vindo do evento.

## Admin (`/api/admin/**`)
- **Dashboard:** `GET /api/admin/metrics?from=&to=` → faturamento, pedidos por status, ticket médio, chargebacks, recusados, estoque baixo (tudo por query no banco).
- **Produtos:** `GET/POST /api/admin/products`, `GET/PATCH/DELETE /api/admin/products/:id` (usa `productSchema`).
- **Estoque:** `GET /api/admin/inventory` (lista com físico/reservado/disponível), `POST /api/admin/inventory/movements` (`stockMovementSchema`, grava auditoria).
- **Pedidos:** `GET /api/admin/orders?status=&q=&page=`, `GET /api/admin/orders/:id`, `POST /api/admin/orders/:id/transition` (`orderStatusSchema` → `transitionOrder`, 409 em transição inválida).
- **Volume:** `GET /api/admin/volume-limits`, `PUT /api/admin/volume-limits` (`orderVolumeLimitsSchema`), `GET /api/admin/volume-usage` → `{ ordersToday, revenueTodayCents, limits }`.
- **Gateways:** `GET /api/admin/gateways` → lista adaptadores `{ provider, configured, enabled, isDefault, methods }`; `PUT /api/admin/gateways/:provider` (`gatewayConfigSchema`; credenciais cifradas, NUNCA retornadas); `POST /api/admin/gateways/:provider/test`.
- **Antifraude:** `GET /api/admin/fraud/rules` + `PATCH /:id` (peso/limiar/enabled); `GET /api/admin/fraud/assessments`, `POST /api/admin/fraud/assessments/:id/review` `{ level, reason }`; `GET/POST /api/admin/watchlist`, `DELETE /api/admin/watchlist/:id`.
- **Chargebacks:** `GET /api/admin/chargebacks?status=`, `GET /api/admin/chargebacks/:id` (com evidências), `PATCH /api/admin/chargebacks/:id` (`chargebackStatusSchema`), `POST /api/admin/chargebacks/:id/evidence`, `GET /api/admin/chargebacks/:id/export` → PDF com evidências.
- **Clientes:** `GET /api/admin/customers?q=`, `GET /api/admin/customers/:id` (pedidos, pagamentos, ocorrências).
- **Cupons:** `GET/POST /api/admin/coupons`, `PATCH /api/admin/coupons/:id`.
- **Usuários:** `GET/POST /api/admin/users`, `PATCH /api/admin/users/:id` (papel/ativo/reset senha).
- **Auditoria:** `GET /api/admin/audit-logs?entity=&actor=&page=`.
- **Notificações:** `GET /api/admin/notifications`, `POST /api/admin/notifications/:id/read`.
- **Monitoramento:** `GET /api/admin/system` → saúde (db, fila, últimos erros de webhook), contadores.

## Health
- `GET /healthz` → `{ ok, db, version }` · `GET /metrics` (só rede local/loopback) → contadores Prometheus-formatted simples.

## Convenções
- Datas ISO-8601 UTC. Dinheiro sempre em centavos (`*Cents`). Paginação `{ items, total, page, limit }`.
- Todo mutate admin grava `auditLogs`. Preço/desconto/frete NUNCA vêm do frontend como autoridade.
