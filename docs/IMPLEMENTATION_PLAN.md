# Plano de implementação (executado)

| Fase | Entregável |
|---|---|
| 1 Inventário | `docs/ARCHITECTURE.md`, `FEATURES_INVENTORY.md`, `DATABASE_DESIGN.md`, `SECURITY_AUDIT.md`, `IMPLEMENTATION_PLAN.md` |
| 2 Fundação | Drizzle schema + `getDb()` (PGlite/PG) + `db/migrate.ts` + `db/seed.ts` (admin impresso no console) + auth cliente e admin + RBAC |
| 3 Loja | `apps/store` Next.js 16: home, catálogo, PDP, carrinho, checkout, pedido, conta, atendimento; logo em `public/LOGO.svg` (placeholder — trocar pelo PNG final) |
| 4 Gestão | Admin CRUD (produtos, estoque, pedidos, clientes, cupons, usuários) + `apps/admin` Next.js |
| 5 Volume | `GET/PUT /api/admin/volume-limits` + `GET /volume-usage`; `checkOrderVolume` no checkout; teste de bloqueio |
| 6 Pagamentos | `services/payments/*` adapters plugáveis + webhooks idempotentes em `payment_events` (assinatura HMAC) + reconciliação simples |
| 7 Antifraude | `services/fraud.ts` (score + 3 faixas + review manual + watchlist) + central de chargebacks com `respondBy` do provedor + export PDF |
| 8 Admin/indicadores | `GET /api/admin/metrics` calculado do banco; dashboard Next.js |
| 9 Qualidade | Vitest: concorrência de estoque, transições, volume, webhook duplicado/assinatura inválida, score de fraude, checkout E2E (recálculo no servidor) |

## Como subir
```powershell
npm install
npm run db:seed        # cria schema + admin (senha impressa no console)
npm run dev:api        # :4000  (PGlite local — nenhum servidor externo)
npm run dev --workspace @airsoft/store  # :3000
npm run dev --workspace @airsoft/admin  # :3001
npm test               # suites por workspace
npm run typecheck
```
Produção: `DATABASE_URL`, `JWT_SECRET`, `GATEWAY_SECRETS_KEY` no `.env` (ver `.env.example`).

## Pendente que só o lojista faz
- Escolher gateway em Admin → Configurações → Pagamentos (sandbox, Mercado Pago, PagBank ou Cielo) e cadastrar credenciais (cifradas).
- Definir WhatsApp em `.env` (`STORE_WHATSAPP`) e trocar a logo placeholder pelo PNG/LGO final do cliente.
- Rodar as migrations/seed no ambiente de produção e trocar o admin inicial.
