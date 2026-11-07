# Medição de desempenho — FASE 3 (delta, evidência)

- **Data:** 2026-11-07
- **Contexto:** após commits `921bf85`, `5e38cef`, `458b992`, `58db5b7`, `def9b8c` (3A schema/histórico/compatíveis; 3B CSV transacional+UI+E2E; 3C condição server-side/PDP compatíveis/robots+sitemap+404/500; fix ordenação; correções E2E/rate-limit E2E). **Nenhuma medição inventada** (sem Lighthouse, sem Web Vitals, sem EXPLAIN).
- **Ambiente:** win32, Node v22.23.2, npm 10.9.8, Next 16.4.5, PGlite local. **Sem dados de concorrente.**
- **Método:** banco DEMO isolado por medição (`%TEMP%\opencode\f3perf-*`, destruído), `migrate` + `seed` + 2 produtos DEMO próprios (`usado`/`seminovo`, compatíveis) → **11 produtos publicados**. Medição **in-process (nível serviço)** via `query-bench.ts` (Drizzle logger, `NODE_ENV=test`, contagem ativa só em `benchStart`; **não registra SQL/params/PII/tokens/secrets**). **n=5** por operação, 1 warmup descartado. `bytes` = `JSON.stringify(resultado).length` (tamanho do payload serializado no processo, não resposta HTTP comprimida). `queries` = contagem de execuções SQL registradas pelo logger no sample.
- **Comparabilidade:** difere do baseline N+1 (`docs/PERFORMANCE-N1-OTIMIZACAO-2026-11-07.md`, 3 produtos DEMO, estado anterior) pelo volume (11 produtos) e pelas mudanças de FASE 3 (filtro `condicao`, `orderBy` com subquery de preço efetivo, compatíveis em PDP). Onde há sobreposição de operação, a comparação é **qualitativa**; valores absolutos não são 1:1 pelo shape/tamanho do dataset.

## Resultados (n=5, in-process)

| Operação | ms min | ms avg | ms max | queries min/avg/max | payload bytes (amostra) | itens/resultados (amostra) |
|---|---:|---:|---:|---:|---:|---|
| homepage (`buildHome`) | 43,72 | 46,61 | 53,63 | 30 / 30 / 30 | 12560 | 0 blocos* |
| listagem (`listProducts` limit=24) | 15,05 | 16,16 | 18,88 | 11 / 11 / 11 | 5275 | total 5, itens 5 |
| busca (`q=DEMO`, limit=24) | 15,95 | 17,18 | 19,23 | 11 / 11 / 11 | 5275 | total 5, itens 5 |
| filtros — condição (`condicao=usado`) | 14,47 | 15,08 | 15,62 | 11 / 11 / 11 | 1140 | total 1, itens 1 |
| filtros — marca (`brand=<slug seed>`) | 14,68 | 15,82 | 16,49 | 12 / 12 / 12 | 5275 | total 5, itens 5 |
| brands (lógica: `SELECT brands active`) | 1,05 | 1,09 | 1,16 | 1 / 1 / 1 | 208 | 1 marca |
| categories (lógica: `SELECT categories active`) | 1,21 | 1,28 | 1,31 | 1 / 1 / 1 | 638 | 2 categorias |
| PDP (`getProductBySlug`, slug real do seed) | 10,75 | 10,96 | 11,40 | 9 / 9 / 9 | 1678 | produto encontrado |
| import CSV — preview (serviço, 1 linha válida) | 3,28 | 4,25 | 6,54 | 3 / 3 / 3 | 455 | válidas 1, inválidas 0 |
| import CSV — apply (serviço, 1 criação, transacional) | 15,20 | 16,48 | 17,43 | 10 / 10 / 10 | 142 | criados 1, atualizados 0, rejeitados 0 |

\* `buildHome` retornou 0 blocos no dataset desta medição (configuração de blocos/vitrine dependente do seed); queries/latência/payload ainda medidos sobre a execução real. Interpretar homepage com essa ressalva.

## Delta vs baseline N+1 (qualitativo, sem paridade de dataset)
- **Listagem/busca:** permanecem em **11 queries** por página (constante por página, padrão batch/N+1 preservado) — consistente com o pós-correção N+1; latência in-process maior que o HTTP doc anterior em números absolutos não é comparável (medição diferente: serviço vs HTTP, dataset maior, warmup/JIT, PGlite).
- **Filtro condição (novo, server-side):** **11 queries**, sem N+1; custo comparável à listagem base no dataset medido.
- **Filtro marca (server-side):** **12 queries** (inclui resolução de marca) — estável/baixo no dataset medido.
- **PDP (novo foco 3C: compatíveis resolvidos):** **9 queries** em `getProductBySlug`; resolução em lote de relacionados/compatíveis na rota storefront (`Promise.all` + `listProducts` por IDs) não foi isolada como amostra separada aqui — **limitação** (medido o serviço base, não o handler HTTP completo com enriquecimento de relacionados/compatíveis).
- **Import CSV (3B, novo):** preview **3 queries** (read-only, sem escrita); apply **10 queries** (transação/auditoria/criação) por amostra de 1 linha — medição **exclui** o preview de checksum feito dentro da amostra (reset após preview, antes do apply). Mutação real por sample (SKUs únicos); não representa lotes grandes.

## Limitações
- **Sem HTTP end-to-end:** não medido via `Invoke-WebRequest`/servidor Next/Fastify em execução para estas rotas nesta passada (apenas serviço). Latência não inclui rede, serialização HTTP, middleware Fastify, render SSR/Next, TLS/CDN. `bytes` é JSON do objeto, não `Content-Length`/transferência comprimida.
- **Dataset DEMO pequeno (11 produtos, 1 marca, 2 categorias):** não valida escala com milhares de SKUs/imagens/compatíveis; confirma apenas ausência de regressão óbvia e padrão constante por página nas operações medidas.
- **Homepage `blocks=0`:** resultado funcional de vitrine não representativo; medir novamente com blocos/home configurados para avaliar payload de home.
- **PDP storefront completo:** `GET /api/store/products/:slug` adiciona busca em lote de relacionados/compatíveis após `getProductBySlug`; custo adicional não isolado aqui.
- **Import CSV:** medido em 1 linha; não cobre arquivos grandes (até 2 MiB), muitas linhas, alto índice de atualização por SKU, ou contenção transacional. Autenticação/CSRF/RBAC não incluídos na medição de serviço.
- **Não medido/coletado:** Lighthouse, LCP, INP, CLS, TTFB, Web Vitals, rede móvel simulada, `next build` time, **EXPLAIN/planos**. EXPLAIN deve ser validado em **PostgreSQL de staging** (limitação conhecida do PGlite) antes de novos índices.
- **Estatística:** n=5, máquina local, sujeito a warmup/JIT/carga do SO; usar deltas grandes com cautela.

## Conclusão
Nenhum N+1 evidente introduzido nas operações medidas; filtro por condição server-side mantém contagem constante por página. Preview CSV é barato e sem escrita; apply é transacional com custo compatível com 1 item+auditoria no dataset medido. Regressões de escala/HTTP/SSR permanecem **não medidas** (ver limitações).
