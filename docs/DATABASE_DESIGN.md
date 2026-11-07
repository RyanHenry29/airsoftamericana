# Design de banco (resumo)

Implementação completa: `apps/api/src/db/schema.ts` (Drizzle Postgres). Em dev usa PGlite local (`data/airsoft.db`); em produção `DATABASE_URL` aponta para Postgres.

## Entidades principais
`users/sessions`, `customers/customer_addresses`, `brands`, `categories`, `products/product_variants/product_images`, `inventory/inventory_movements`, `carts/cart_items`, `orders/order_items/order_status_history` (append-only), `payments/payment_events` (idempotência `unique(provider, eventId)`) `/refunds`, `fraud_rules/fraud_assessments/watchlist`, `chargebacks/chargeback_evidence`, `shipments/shipping_events`, `coupons/promotions`, `order_volume_limits`, `gateway_configs` (credenciais cifradas), `audit_logs`, `notifications`, `daily_metrics`, `system_settings`.

## Regras
- FKs e unique constraints em identificadores; índices em `status`, `customerId`, `createdAt`, `respondBy`, `volumeDay`.
- Financeiro sempre em centavos (integer).
- `order_status_history`, `payment_events`, `inventory_movements`, `audit_logs` são append-only (nunca UPDATE/DELETE).
- `inventory`: `physical` e `reserved` com CHECK `>= 0` aplicado na migração; `disponível = physical − reserved`.

## Migração
`npm run db:generate` (drizzle-kit) gera SQL; `db/migrate.ts` aplica em PGlite ou Postgres. `db/seed.ts` cria admin inicial (impresso no console), categorias, produtos/variants/estoque, cupom `BEMVINDO10`, regras de fraude padrão e gateway sandbox como default.
