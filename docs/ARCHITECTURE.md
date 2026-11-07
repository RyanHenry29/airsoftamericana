# Arquitetura — Airsoft Americana

## Visão geral
Monólito modular em npm workspaces: `packages/shared` (domínio) + `apps/api` (Fastify/Drizzle) + `apps/store` + `apps/admin` (Next.js 16). Sem Docker/Redis obrigatório: PGlite local em dev, Postgres via `DATABASE_URL` em produção.

## Camadas (api)
- `domain` (shared): status machines, schemas zod — puro, sem IO.
- `application/services`: casos de uso (`inventory`, `orders`, `fraud`, `checkout`, `coupons`, `shipping`, `chargebacks`, `metrics`).
- `infrastructure`: `db` (Drizzle schema/index), `services/payments/*` (adapters), `lib` (crypto/audit/errors), `middleware/auth`.
- `presentation`: `routes/*` (fastify) — validação sempre via zod antes do serviço.

## Banco (resumo)
~32 tabelas (ver `apps/api/src/db/schema.ts`): users/sessions, customers(+addresses), brands/categories/products(+variants/images), inventory(+movements), carts(+items), orders(+items/status_history), payments(+events/refunds), fraud-assessments/rules/watchlist, chargebacks(+evidence), shipments(+events), coupons/promotions, order_volume_limits, gateway_configs, audit_logs, notifications, daily_metrics, system_settings. Valores em centavos; histórico append-only.

## Regras que nunca mudam
1. Preço/desconto/frete/total recalculados no servidor.
2. `disponível = físico − reservado` com `SELECT ... FOR UPDATE` na reserva.
3. Transição de pedido só via `canTransition`; inválida = 409.
4. Webhook: assinatura HMAC + idempotência por `(provider, eventId)`.
5. Sem PAN/CVV no banco. Credenciais de gateway cifradas AES-256-GCM.
6. Toda mutação de admin grava `auditLogs`.

## Ambiente
- Dev: PGlite em `data/airsoft.db`.
- Prod: Postgres (`DATABASE_URL`), `JWT_SECRET` e `GATEWAY_SECRETS_KEY` obrigatórios.
- Logs: pino JSON; `correlation_id` por request; health `GET /healthz`.
