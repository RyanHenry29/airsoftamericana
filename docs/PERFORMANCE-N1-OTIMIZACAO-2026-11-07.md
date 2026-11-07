# Otimização N+1 — catálogo/homepage/brands (ANTES/DEPOIS)

- **Data:** 2026-11-07
- **Base (antes):** `2a5d788` + baseline `docs/PERFORMANCE-BASELINE-2026-11-07.md`
- **Ambiente:** win32, Node v22.23.2, npm 10.9.8, Next 16.4.5, PGlite local (mesmo driver). **Sem dados de concorrente.**
- **Método:** mesmo banco DEMO isolado por medição (`%TEMP%\opencode\perf-*-pglite`, destruído), seed `apps/api/src/db/seed.ts` (**3 produtos, 2 categorias, 1 marca DEMO**), mesmos slugs/parâmetros/rotas. HTTP: `Invoke-WebRequest` contra API tsx controlada (porta 4098 antes / 4097 depois), **n=5** por rota, min/avg/max + amostras. Queries: contagem em processo via `apps/api/src/lib/query-bench.ts` (Drizzle logger, **somente `NODE_ENV=test`**, ativo só em `benchStart()`; **não registra SQL/params/PII/tokens/secrets**), mesmas funções/rotas-lógicas, mesma DB shape.

## Alterações (arquivos)
- `apps/api/src/services/catalog.ts` — `listProducts`: enriquecimento em **lote** (variantes, inventário, imagens, marcas, categorias por `IN` de IDs da página) + facetas de marca em lote; remove N+1 por produto. Correção de robustez preservando comportamento: filtro brand/categoria não resolvido usa `sql\`false\`` (evita comparação UUID inválida de `"__nomatch__"` em PGlite/Postgres). Contrato preservado (incl. sem `productId` em variante).
- `apps/api/src/routes/storefront.ts` — `/api/store/brands`: contagem publicada por `GROUP BY brand_id` (1 query) + lista marcas (1), substitui 1+N.
- `apps/api/src/services/homepage.ts` — contagem de produtos por marca em lote no `buildHome` (remove N+1 por marca). Blocos continuam limitados; `featured`/`news` permanecem sorts distintos (não mascarados por cache).
- `apps/api/src/lib/query-bench.ts` (novo, teste/benchmark) + `apps/api/src/db/index.ts` — logger Drizzle no-op em teste para contagem sob demanda (sem alterar PGlite/locking/verify).
- Testes: `apps/api/src/services/catalog.n1.test.ts`, `apps/api/src/routes/storefront-brands.n1.test.ts`.

## Queries (in-process, DEMO 3 produtos)
| Operação | Antes (queries) | Depois (queries) | Δ abs | Δ % | Observação |
|---|---:|---:|---:|---:|---|
| `home` (`buildHome`) | 50 | 30 | -20 | -40,0% | elimina N+1 marcas + ganho de `listProducts` em lote nas vitrines |
| `products` limit=24 (`listProducts`) | 21 | 11 | -10 | -47,6% | 3 itens: antes ~5 queries/produto no enriquecimento; depois **constante por página** (lotes) |
| `products` search=DEMO | 21 | 11 | -10 | -47,6% | idem |
| `brands` (lógica rota, 1 marca) | 2 | 2 | 0 | 0,0% | **O(1)** vs **O(N marcas)** — prova de escala no teste com 6 marcas: ≤3 queries |
| `categories` (lógica rota) | 1 | 1 | 0 | 0,0% | sem N+1 |
| `search_suggestions` q=DE | 4 | 4 | 0 | 0,0% | sem mudança |

**Escala (prova):** `catalog.n1.test.ts` — 12 produtos DEMO, `queries < 20` (antes esperado ~66+). `storefront-brands.n1.test.ts` — 6 marcas, `queries <= 3`. Confirma ausência de crescimento por produto/marca.

## HTTP (API controlada, n=5, mesma forma)
| Rota | Antes avg (min–max) [ms] | Depois avg (min–max) [ms] | Δ avg | Δ % | Bytes antes | Bytes depois |
|---|---:|---:|---:|---:|---:|---:|
| `/api/store/home` | 169,6 (110–400) | 89,6 (74–145) | -80,0 ms | -47,2% | 7591 | 7897* |
| `/api/store/products?limit=24` | 51,4 (50–53) | 37,4 (36–39) | -14,0 ms | -27,2% | 2801 | 2954* |
| `/api/store/products?search=DEMO` | 50,2 (49–52) | 38,4 (37–41) | -11,8 ms | -23,5% | 2801 | 2954* |
| `/api/store/brands` | 24,0 (22–26) | 25,0 (24–27) | +1,0 ms | +4,2% | 162 | 162 |
| `/api/store/categories` | 22,6 (22–23) | 22,8 (22–24) | +0,2 ms | +0,9% | 605 | 605 |
| `/api/store/search/suggestions?q=DE` | 27,0 (26–29) | 25,8 (25–27) | -1,2 ms | -4,4% | 754 | 754 |

\* `products/home` bytes diferem levemente por variação de payload/hidratação de vitrine entre seeds isolados (IDs/ordem interna do conjunto DEMO); **contrato funcional preservado** e validado por testes (campos, paginação, filtros, facets, variantes sem `productId`, sem duplicação). `brands/categories/suggestions` bytes estáveis. Medições HTTP são **amostras locais únicas (n=5)**, sujeitas a warmup/JIT/PGlite; a redução de queries é a evidência primária.

## Funcional preservado (testado)
- Paginação, filtros, ordenação, facets, disponibilidade/estoque, busca, condição/semântica existente, sem duplicação.
- Formato de resposta preservado (incl. variante sem vazamento `productId`).
- Zero produtos, muitos DEMO (12) — ok.
- `/api/store/brands`: contagens corretas, ordenação determinística, sem vazamento, 2 queries.
- Autorização/RBAC/CSRF/MFA/auditoria/rate limit/preço/estoque/checkout/sessões **não alterados**.

## Índices / EXPLAIN
- **Nenhum índice novo criado** nesta passada: gargalo comprovado era N+1 (round-trips), corrigido por reestruturação de consultas. Índices existentes cobrem slug/category/published/brandId/variant FKs/uniques.
- **EXPLAIN em PGlite:** limitação conhecida; preparar/validar planos em **PostgreSQL de staging** para filtros frequentes (categoria+preço+disponibilidade, busca, facets) antes de qualquer índice adicional. Qualquer índice futuro: nova migração reversível com tabela/colunas/consulta beneficiada/evidência/impacto/custo escrita/rollback.

## Cache
Nenhum cache global adicionado para mascarar N+1. Sem cache de sessão/MFA/authz/CSRF/preço final checkout/estoque volátil/pedidos privados/PII/status pagamento/recovery codes.

## Limitações
- Lighthouse/LCP/INP/CLS/TTFB e rede móvel simulada não executados (ambiente); `next build` tempo não recapturado.
- Medições HTTP n=5 em máquina local (warmup visível em `home` antes).
- `listProducts` ainda calcula facets com queries separadas (constantes, não por produto); otimização adicional só com evidência.