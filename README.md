# Airsoft Americana — Plataforma E-commerce

Sistema completo de loja virtual + painel administrativo + central de pagamentos/antifraude,
construído do zero com base no levantamento do site anterior (GM Tático/TiendaNube), para
**www.airsoftamericana.com.br**.

## Arquitetura

Monorepo npm workspaces:

```
airsoftamericana-saas/
├── packages/shared     # Domínio compartilhado: status machines, schemas zod, regras
├── apps/api            # Fastify + Drizzle (PGlite em dev / Postgres em prod) + TypeScript
├── apps/store          # Loja pública (Next.js 16, porta 3000)
├── apps/admin          # Painel administrativo (Next.js 16, porta 3001)
└── docs/API.md         # Contrato da API — fonte de verdade
```

## Requisitos do cliente atendidos

- **Loja / mostruário**: catálogo, filtros, carrinho, checkout, PIX/cartão/boleto, frete por CEP, 18+.
- **Admin controla estoque**: físico/reservado/disponível, movimentações com motivo, histórico.
- **Admin controla volume de pedidos**: cota diária (pedidos, faturamento, por cliente, por valor),
  ação configurável (bloquear checkout ou revisão manual), uso em tempo real.
- **Chargeback**: score de risco configurável antes da captura, captura pós-análise, central de
  disputas com prazo vindo do provedor, evidências exportáveis em PDF, listas de monitoramento.
- **Gateway escolhido pelo lojista**: adaptadores plugáveis (sandbox, Mercado Pago, PagBank, Cielo)
  configuráveis em Admin → Pagamentos, credenciais cifradas AES-256-GCM.

## Subir o ambiente

```powershell
npm install
npm run db:seed        # cria schema + dados iniciais (admin impresso no console)
npm run dev:api        # API em :4000 (PGlite local em data/ — sem servidor externo)
npm run dev:store      # loja em :3000
npm run dev:admin      # admin em :3001
```

Produção: defina `DATABASE_URL` (Postgres), `JWT_SECRET`, `GATEWAY_SECRETS_KEY` — ver `.env.example`.

## Testes

```powershell
npm test               # suites por workspace (concorrência de estoque, transições, volume, webhook, fraude, checkout)
npm run typecheck
```

## Docs

- `SKILL.md` — skill de execução do projeto (escopo, regras duras, critérios de aceitação)
- `docs/API.md` — contrato REST
- `docs/skills/design-comercial-profissional.md` — regras de design (cópias: `SKILL 2.md` e `.skill`)
- `docs/QA_CHECKLIST.md` — checklist de entrega visual/funcional/SEO
- `docs/legacy-zero-dep/` — protótipo antigo zerado (zip + extração `loja/`); arquivado, sem build ativo
- `scripts/patches/` — patches únicos aplicados à store (histórico)
- `docs/brand/LOGO.png` — arte original da marca
- `mirror/` — espelho estático do site antigo, referência de auditoria (não é código do novo sistema)
