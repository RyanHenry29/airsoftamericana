# Airsoft Americana — Plataforma E-commerce

Sistema completo de loja virtual + painel administrativo + central de pagamentos/antifraude,
construído do, para **www.airsoftamericana.com.br**.

## Arquitetura

Monorepo npm workspaces:

```
airsoftamericana-saas/
├── packages/shared     # Domínio compartilhado: status machines, schemas zod, regras
├── apps/api            # Fastify + Drizzle (PGlite em dev / Postgres em prod) + TypeScript
├── apps/store          # Loja pública (Next.js 16, porta 3000)
├── apps/admin          # Painel administrativo (Next.js 16, porta 3001)
├── e2e/                # Specs Playwright + helpers
├── scripts/            # Automações oficiais (verify, patches históricos, wrappers Windows)
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

Windows (atalhos): `iniciar.bat` sobe API + loja + admin e abre o navegador;
`scripts\windows\fechar.bat` encerra as três portas.

## Testes

```powershell
npm test               # suites por workspace (concorrência de estoque, transições, volume, webhook, fraude, checkout)
npm run typecheck
npm run verify         # typecheck de todos os workspaces + testes + checagem de locks PGlite (comando de fechamento oficial)
```

E2E (Playwright — requer as portas 4000/3001 livres, mata processos antigos):

```powershell
scripts\windows\e2e-full.cmd   # recria o banco data-e2e, sobe API+admin, exporta os env E2E_* e roda a suíte
```

Wrappers auxiliares em `scripts\windows\`: `subir-api-e2e.cmd`, `subir-admin-e2e.cmd`
(sobem só um serviço com banco isolado), `rodar-e2e.cmd` (roda a suíte contra serviços
já no ar), `sincronizar-relogio.bat` (NTP do Windows, necessário p/ TOTP em máquina com
relógio errado). A API do E2E sobe com `NODE_ENV=test` + `E2E_READY=1` — é o modo que o
bypass de rate limit de `authRateLimit.ts` exige para a suíte não estourar o balde de
login; sem isso, o teste 15 devolve 429. A suíte E2E consome estado (MFA, recovery,
convites): sempre banco novo + seed antes de rodar (o `e2e-full.cmd` faz isso).

## Docs

- `docs/API.md` — contrato REST

## Skills (carregadas pelo OpenCode em `.opencode/skills/`)

- `.opencode/skills/reconstrucao-airsoftamericana/SKILL.md` — skill de execução do projeto (escopo, regras duras, critérios de aceitação)
- `.opencode/skills/design-comercial-profissional/SKILL.md` — regras de design. Obrigatória antes de qualquer UI (ver `AGENTS.md`)
- Cópias de segurança em `docs/legacy-zero-dep/*.bak` — uma única versão vale: a de `.opencode/skills/`
- `docs/QA_CHECKLIST.md` — checklist de entrega visual/funcional/SEO
- `docs/legacy-zero-dep/` — protótipo antigo zerado (zip + extração `loja/`); arquivado, sem build ativo
- `scripts/patches/` — patches únicos aplicados à store (histórico)
- `docs/brand/LOGO.png` — arte original da marca
- `mirror/` — **removido da workspace em 2026-11-09** (era captura estática SaveWeb2Zip do site antigo; não é código do novo sistema). O inventário de capacidades observadas fica em `docs/FEATURES_INVENTORY.md` e `docs/AUDITORIA-FASE1-GMTATICO.md`. Regra permanece: nunca copiar código, texto, imagem ou nome de classe de sites de terceiros.
