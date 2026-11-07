# Performance baseline (ANTES de otimizações)

- **Data:** 2026-11-07 13:31:01 -03:00
- **Commit:** `2a5d788` (+ alterações desta etapa: testes de lockout E2E, `docs/SECURITY-PENDENCIAS.md`; nenhuma alteração de lógica de performance/produto)
- **Ambiente:** Windows `win32`, Node `v22.23.2`, npm `10.9.8`, Next.js `16.4.5` (workspace), repo local `master` sem remoto.
- **Regra:** baseline comparável registrado **antes** de alterar código de performance. Otimizar somente gargalos comprovados. Sem dados de concorrente; medições de API com **banco PGlite isolado** (`%TEMP%\opencode\perf-baseline-pglite`, destruído) semeado por `apps/api/src/db/seed.ts` (**DEMO**: 3 produtos, 2 categorias, 1 marca).

## Comandos (reproduzíveis)

```powershell
# Typecheck (tempo por pacote)
npx tsc --noEmit -p packages/shared/tsconfig.json
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/store/tsconfig.json
npx tsc --noEmit -p apps/admin/tsconfig.json

# API isolada (DEMO)
$env:PGLITE_DIR='<temp>\perf-baseline-pglite'; $env:NODE_ENV='test'
cd apps/api; npx tsx src/db/seed.ts
$env:API_PORT=4099; $env:API_HOST='127.0.0.1'; npx tsx src/cli.ts
# medir: Invoke-WebRequest /healthz, /api/store/settings, /api/store/home,
# /api/store/categories, /api/store/products, ?search=DEMO,
# /api/store/products/demo-produto-a, /api/store/search/suggestions?q=DE

# Artefatos existentes
Get-ChildItem apps/store/.next/static -Recurse -File | Measure Length -Sum
Get-ChildItem apps/admin/.next/static -Recurse -File | Measure Length -Sum

npm run verify
```

## Verificações de segurança (pré-performance, concluídas)
1. **Exceção de lockout por IP (somente E2E isolado)** — `apps/api/src/services/lockout.ts`: omite chave `ip:*` **apenas** quando `NODE_ENV==='test' && process.env.E2E_READY==='1'`; **preserva lockout por conta**. Provas automatizadas em `apps/api/src/services/lockout.test.ts` (6 passed): `test+E2E_READY=1` → só `acct:*`; `test` sem `E2E_READY` → `acct+ip` normal; `production` mesmo com `E2E_READY=1` → `acct+ip` normal (sem exceção/bypass).
2. **Troca de senha self-service admin** — **pendente**, sem implementação superficial. Ver `docs/SECURITY-PENDENCIAS.md` (invalidar todas as sessões após sucesso, CSRF/rate limit/reautenticação/MFA/auditoria, testes).

## Build / typecheck
| Medição | Valor (baseline) |
|---|---:|
| `tsc --noEmit` shared | 4054 ms |
| `tsc --noEmit` api | 11599 ms |
| `tsc --noEmit` store | 7956 ms |
| `tsc --noEmit` admin | 6218 ms |
| Typecheck total (4 pkgs) | 29827 ms |
| `next build` store/admin (produção, tempo) | **não capturado nesta passada** (limitação de tempo; `.next` presente de build anterior) — medir em CI/local dedicado para comparação antes/depois |
| `apps/store/.next/static` (bytes, artefato presente) | 1.387.119 |
| `apps/admin/.next/static` (bytes, artefato presente) | 662.375 |
| `apps/store/.next` total / `apps/admin/.next` total | 840.518.912 / 367.280.207 (inclui cache/build; **não** representa payload cliente) |

## API — latência/tamanho (DEMO isolado, 3 produtos, 1 worker API, máquina local)
| Endpoint | HTTP | ms (amostra) | bytes (UTF-8) | Observação |
|---|---:|---:|---:|---|
| `GET /healthz` | 200 | (varia; 1ª medição teve artefato de conexão) | ~54 | ok em recheck |
| `GET /api/store/settings` | 200 | — | 612 | fonte comercial única |
| `GET /api/store/home` | 200 | 2129 | 7591 | **alto para 3 produtos** (agrega vitrines/home; ver N+1) |
| `GET /api/store/categories` | 200 | 29 | 605 | árvore completa |
| `GET /api/store/products` (p1, limit 24) | 200 | 55 | 2801 | retorna `items,total,page,limit,pages,facets` |
| `GET /api/store/products?search=DEMO` | 200 | 53 | 2801 | paginação presente |
| `GET /api/store/products/demo-produto-a` (PDP API) | 200 | 41 | 1475 | detalhe+relacionados |
| `GET /api/store/search/suggestions?q=DE` | 200 | 32 | 754 | produtos+categorias+marcas |

> Amostras únicas por rota (warm local). Comparações antes/depois devem repetir **mesmo ambiente, mesma DB DEMO, mesmos comandos**.

## Páginas/fluxos (estado baseline)
| Fluxo | Estado | Observação |
|---|---|---|
| Homepage (store) | implementada (rota `/`) | consome `/api/store/home`; medir LCP/CLS/INP/TBT requer Lighthouse/browser real |
| Listagem de produtos | implementada (`/catalogo`, API `/api/store/products`) | paginação real na API (`page/limit/pages/total`, cap 60) |
| Busca | implementada (API + suggestions) | debounce/cancelamento/prevenção duplicada **não auditados** no cliente neste baseline |
| Filtros (condição, preço, marca, disponibilidade) | **parcial** | preço/marca/disponibilidade/categoria presentes na API; **condição (novo/usado/seminovo)** conforme FASE 3 **não implementada/não verificada** |
| Página de produto (PDP) | implementada (`/departamento`/slug routes, `/[slug]`; API detalhe) | galeria/especificações/estoque/relacionados/seção seminovos/avaliações verificadas — **verificar completude FASE 3** |
| Login (admin/store) | implementado (auth admin + MFA validado FASE 2) | latência de login não medida com credencial válida para evitar efeitos colaterais; fluxo MFA coberto por E2E |
| Painel admin | implementado (rotas presentes) | dashboard agregado no banco **não auditado** neste baseline |
| Dashboard | implementado (parcial/FASE 2 contexto) | medir queries de métricas antes de alterar |
| Listagem de pedidos | **não medida** (requer dados/auth) | registrar como fluxo a medir com DEMO autenticado |
| Importação CSV | **não implementada** no escopo completo FASE 3 (upload/preview/validação/rollback transacional/erros por linha/resumo/confirmação/auditoria/MIME/tamanho/CSV injection) — **não implementada** para baseline funcional | `catalog-import.test.ts` existe; fluxo completo pendente |
| Carrinho | rota presente (`/cart`) | comportamento/perf **não medidos** |
| Checkout | rota presente (`/checkout`); **pagamentos fora desta etapa** | **não medido** end-to-end |

## Consultas SQL / N+1 (inspeção de código — gargalos prováveis)
- `apps/api/src/services/catalog.ts` `listProducts`: para **cada produto** da página executa queries de variantes, inventário, imagens, marca e categoria (`Promise.all` por linha, ~5+ consultas/produto) + facetas com `Promise.all` por marca (`brand` lookup por facet) — **N+1 evidente** (escala com `limit`).
- `apps/api/src/routes/storefront.ts` `/api/store/brands`: **N+1** (contagem de produtos por marca em loop).
- `apps/api/src/services/homepage.ts` `buildHome`: N+1 em contagem por marca; chama `listProducts` múltiplas vezes (featured/news) + hidratações — consistente com `GET /api/store/home` ~2.1s em 3 produtos DEMO.
- `catalog.ts` `resolveCategoryIds` carrega **todas** as categorias para montar subárvore (ok para taxonomia pequena; revisar com crescimento).
- Respostas: PDP/lista incluem campos textuais completos; avaliar projeção mínima por contexto (lista vs detalhe) **sem quebrar contrato**.

## Índices/migrações (inspeção inicial)
- Índices existentes em `products/categories/brands/variants/inventory/images` presentes no schema (slug, category, published, variant unique etc.). Filtros FASE 3 (condição, disponibilidade composta, preço/faixa com paginação, busca) podem exigir índices adicionais **somente** se comprovados por consulta/plano; qualquer adição = migração nova, reversível, documentada (tabela, colunas, consulta, motivo, impacto, custo escrita, rollback).

## Lighthouse / Web Vitals / EXPLAIN / rede móvel simulada
- **Lighthouse / LCP, INP, CLS, TTFB (field-like):** **limitação do ambiente** nesta passada (não executado de forma reprodutível aqui). Playwright/Chromium instalado; pode ser coletado em runner com `lighthouse`/CI/headless estável — registrar quando executado.
- **Rede móvel simulada:** não medida.
- **EXPLAIN:** não executado contra DB de medição nesta passada (PGlite). Alternativa: `EXPLAIN`/planos em Postgres de staging/CI para queries críticas.
- **Consultas repetidas/N+1 runtime:** evidência primária por inspeção de código + latência (`home`).

## Restrições respeitadas
- Nenhuma alteração de performance aplicada antes deste baseline.
- Cache proibido para sessão/MFA/autorização/CSRF/preço final checkout/estoque volátil/pedidos privados/PII/status pagamento/recovery codes/dados de usuários.
- Sem dados de concorrente, sem `mirror/`, sem `catalog.seed.json`/`taxonomy.seed.json`. Sem push, sem pagamentos.

## Próximos passos (otimizar só com evidência)
1. Reproduzir baseline com **mesmos comandos** antes de cada grupo.
2. Priorizar N+1 em `listProducts`/`home`/brands (reduzir round-trips por lote/join; manter contrato) e medir impacto em `/api/store/home` e `/api/store/products`.
3. Filtros servidor + paginação real + limites + condição novo/usado/seminovo (FASE 3), sem carregar catálogo inteiro no navegador.
4. Frontend store/admin: code splitting/lazy/imagens responsivas/dimensões/debounce-cancel-duplicatas/paginação conforme gargalo medido; dashboard agregado.
5. Após cada grupo: `npm run verify` + `E2E_READY=1 npx playwright test --reporter=list` (ambiente preparado), comparar antes/depois, git limpo.
