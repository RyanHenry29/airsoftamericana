# Checklist Operacional de Lançamento — Airsoft Americana

Versão 2026-11-18. Fases 1–9. Cada afirmação abaixo aponta para código ou
comando verificável.

---

## Registro de execução — 2026-11-19 (validação operacional)

Fase de correções estruturais encerrada. Execução das 9 fases com evidência:

| Fase | Resultado | Evidência |
|---|---|---|
| 1 PostgreSQL | PASS | Staging `zuejjupuxegpczgyonha` (PG 17.12) e produção `psswdwsvybsqrflhpuqx` (PG 17.11); papéis `airsoft_ddl`/`airsoft_app` sem super e sem DDL no runtime — `scripts/check-role-privileges.mjs` (19/19, `CREATE TABLE` como runtime → `permission denied for schema public`) |
| 1.4 Conexão | PASS | `closeDb()` no `finally`; produção e staging testados por pooler Session (`:5432`) — sessão para o CLI; runtime serverless em Transaction (`:6543`), ver 1.3 |
| 1.5 Backup | PASS | `pg_dump 17.12 -Fc` de staging (165.717 B, sha256 `0234b806…`) e produção (732.698 B, sha256 `555de63e…`); ambos restaurados em PG 17.12 local com exit 0 e 0 erro — contagens idênticas (staging 60 tabelas/270 linhas; produção 54/417) e GRANTs preservados (658/590) — `scripts/backup-restore-check.mjs` |
| 2 DNS | **FAIL (bloqueio externo)** | Domínios anexados no Vercel (`api.`, `admin.`, apex, `www`), mas o registrador (Hostgator) ainda publica `airsoftamericana.com.br → 216.172.173.17`; `api.` e `admin.` → NXDOMAIN. Vercel pede `A <host> 76.76.21.21` ou nameservers `ns1/ns2.vercel-dns.com` |
| 3 Variáveis | PASS | API Production (banco de produção, segredos próprios, `COOKIE_SAMESITE=lax`, `CSRF_ENFORCE=true`, `MAIL_FROM`, `STORE_URL`/`ADMIN_URL` `.com.br`) × Preview (banco de staging, `JWT_SECRET`/`GATEWAY_SECRETS_KEY` novos, `SameSite=lax`, `CSRF_ENFORCE=true`, Supabase do staging, `DATABASE_URL_RUNTIME` em transaction mode). `GATEWAY_ACTIVE` e credenciais reais **ausentes** |
| 4 Resend | **FAIL (chave ausente)** | Preview responde `503 not_configured` rotulado (degradação correta). A chave de produção é `sensitive` na Vercel — ilegível pela API/CLI; falta chave de Preview e domínio verificado |
| 5 Schema/seeds | PASS | Staging: 31 passos aplicados via `db:bootstrap` (ledger 31/31 `aplicada`, passo `031_fraud_rules_action_default` incluído). Produção **não** foi migrada (instrução) — o bootstrap de produção criará 6 tabelas: `customer_avatars`, `migration_ledger`, `password_resets`, `support_messages`, `system_locks`, `webhooks` |
| 5.1 Fingerprint de revisão | PASS | Revisão do passo de código = sha256 **canônico** do módulo (CRLF/CR → LF): `apps/api/src/db/module-revision.ts`. Antes, bytes crus davam revisões diferentes no checkout Windows (CRLF) e Linux (LF) — o CI quebrava e um banco migrado no Windows seria recusado no Linux (`MigrationChecksumError`). Ledgers realinhados sob controle (`npm run db:ledger-realign`, 1 linha cada: `030_migrate_legacy_roles` — staging e PGlite de teste); bootstrap reexecutado sem divergência: staging 31/31 `aplicada`, 0 erro |
| 6 Pagamentos | PASS | Sem gateway real: checkout → `503 no_payment_gateway_enabled` e **nada** gravado (`orders=0`, `payments=0`, `order_items=0`, `inventory.reserved=0` conferido no banco). Sandbox do app validado no staging (processo local): o checkout passa pelo gateway e só falha na variante inexistente. Suíte `payments-integrity` em PostgreSQL real: 112/112 (cartão, PIX, boleto, webhook duplicado, expiração, concorrência, chargeback) |
| 7 Cookies/URLs | PASS | `SameSite=lax` + `CSRF_ENFORCE=true` + token por HMAC da sessão; `audit_logs` append-only para o runtime |
| 8 Previews | **PASS** | 3 previews no commit `5c98b55` (run `44654174786`; Store `dpl_71xydFq3iwoXFTGwK3hWwU4FysVq`, Admin `dpl_6FbchLWrLsxQkojoH1Giwnu2fqZ3`, API `dpl_FjJkETnp9tewx9X15hTFbcBuJ8K8` — os três com `githubCommitSha` `5c98b55c97159efdce1a5e49722be0043a21e9f8`, produção **skipped**). Lighthouse 12 no preview: home **perf 92 / a11y 100 / bp 100 / seo 100** (LCP 2,8 s, FCP 1,3 s, CLS 0), catálogo **perf 94 / a11y 100 / bp 100 / seo 100** (LCP 2,5 s, FCP 1,2 s, CLS 0). pa11y-ci WCAG2AA: **13/13 URLs, 0 violações**. Smoke dos 3 previews: **26/26 PASS**. Detalhe da rodada abaixo |
| 9 Produção | **NÃO EXECUTADO** | Aguardando autorização explícita: `db:bootstrap` em produção + `workflow_dispatch environment=production`. Pendente de configuração: `DATABASE_URL_RUNTIME` no Environment Production (ver 1.3) |

Bloqueios que dependem de ação do lojista: (1) registros DNS no registrador;
(2) chave Resend + domínio verificado; (3) catálogo real (importação CSV — não
se inventa produto); (4) credenciais de gateway de terceiro para homologar
pagamento real.

Estado do código no encerramento: branch `fix/aud03-migration-ledger` @ `5c98b55`
(push + PR #3, OPEN/MERGEABLE/CLEAN). Gates locais: `npm run verify` (tsc ×4,
shared 16/16, api **355/355** — 41 arquivos, com os 18 testes novos do modo de
pooler e da cadeia de erro —, store+admin 76/76 + no type errors) e
`node scripts/pg-integration.mjs` (PostgreSQL real 17.11, 112/112). CI
`api-gates`: success (push + PR).
Staging após o smoke: `orders=0`, `payments=0`, `order_items=0`,
`inventory.reserved=0`, ledger 31/31 `aplicada`. Deploys de produção
intactos (`/healthz` 200, loja 200, login do painel 200) e **não** tocados.

---

## 0. Princípios

| # | Regra | Evidência |
|---|-------|-----------|
| P1 | Preview ≠ Production: banco, segredos, URLs e gateway próprios | `apps/api/src/config.ts` (segredos por ambiente), `apps/api/src/services/payments/types.ts:167-206` |
| P2 | A API de runtime **não migra**: o schema entra por run autorizado com papel DDL | `apps/api/index.ts` (sem `migrate()`), `apps/api/src/cli/bootstrap-prod.ts:235` |
| P3 | Seeds automatizados só em PGlite; Dev DB é operação manual separada; nenhum seed/CLI em Production | `apps/api/src/db/seed-target.ts` (guarda), `apps/api/src/db/seed.ts:218-241`, `apps/api/src/cli/e2e-seed.ts:12-26` |
| P4 | Nenhuma cobrança real sem autorização financeira separada, por escrito | `apps/api/src/services/payments/types.ts:178-188` (sandbox fora de produção) |
| P5 | Deploy de produção só via `workflow_dispatch` com autorização explícita | `.github/workflows/deploy.yml:99-169` |

### Ledger de migrations (AUD-03) — o que o boot aceita

- Checksum = sha256 de `{name, revision, statements}` — **não** do source
  transpilado (`apps/api/src/db/migration-ledger.ts:101-121`). O source muda
  entre toolchains (vitest / tsx / bundle da Vercel) e fazia um banco migrado
  por um caminho ser recusado no boot por outro.
- Passo de código é fingerprintsado pela `revision` = sha256 do módulo
  (`apps/api/src/db/migrate.ts:18-26`); drift sem bump quebra o CI
  (`apps/api/src/db/migration-revisions.test.ts`).
- Recuperação: passo idempotente interrompido → re-executa; passo
  `nonIdempotent` interrompido → `MigrationNonIdempotentError` (decisão
  humana); checksum divergente → `MigrationChecksumError` (bloqueia boot).
- Advisory lock por **sessão** (`getMigrationSession()`), deadline 120s.

---

## Fase 1 — PostgreSQL

### 1.1 Dois bancos, nunca compartilhados

| Banco | Uso | Papel de conexão |
|---|---|---|
| Produção | API Production | runtime `airsoft_app` (sem DDL) |
| Staging | Preview (3 previews) | staging próprio, credencial própria |

### 1.2 Papéis (exigidos pelo bootstrap)

O bootstrap concede e confere o papel de runtime:
`apps/api/src/cli/bootstrap-prod.ts:201-222` — `GRANT … TO airsoft_app` e
recusa continuar se `airsoft_app` ainda puder `UPDATE/DELETE` em
`audit_logs`. O papel de DDL (`airsoft_ddl`) é o dono do schema.

### 1.3 Pooler — dois modos, comfinalidades diferentes

**Migrations e advisory lock (sessão):** conexão direta ou pooler em modo
**Session** (`:5432`). Transaction pooler (`:6543`) **não serve** — lá o backend
pode trocar entre comandos e o lock de sessão se perde
(`apps/api/src/db/pool-mode.ts` — `assertSessionScopeSafe`, aplicado em
`db:migrate`, `db:bootstrap` e `db:ledger-realign`).

**Runtime serverless (a função da API na Vercel):** pooler em modo
**Transaction** (`:6543`) via `DATABASE_URL_RUNTIME`. O modo Session do pooler
do Supabase aceita **no máximo 15 clientes simultâneos** (`pool_size`) e cada
instância da função abre o próprio pool — em rajada (página de vitrine + ISR +
varredura de health check) o limite estoura e a API responde **500 em tudo**
(`EMAXCONNSESSION: max clients reached in session mode`). Medido no staging:
**38 falhas em 48 requisições** com o modo Session; **0 falhas em 40** com o
modo Transaction. Em transaction mode o pooler multiplexa clientes sobre
poucos backends e o pool por instância fica com `max: 1`
(`apps/api/src/db/pool-mode.ts`, `apps/api/src/db/index.ts`).

### 1.4 Teste de conexão (local, temporário/staging — nunca produção)

```cmd
set DATABASE_URL=postgres://user:pass@staging-host:5432/staging_db?sslmode=require
npx tsx -e "(async () => { const { sql } = await import('drizzle-orm'); const { getDb, closeDb } = await import('./apps/api/src/db/index.js'); let db; try { db = await getDb(); const r = await db.execute(sql`SELECT version();`); console.log(r.rows[0]); } catch (e) { console.error(e); process.exitCode = 1; } finally { await closeDb(); } })();"
```
`closeDb()` no `finally`: a conexão fecha mesmo com falha de conexão ou de
consulta. `DATABASE_URL` de produção **não** entra neste teste — ela vive só
no Environment Production da API, no Vercel.

### 1.5 Backup antes da primeira migration de produção

1. Snapshot automático diário do provedor (verificar se o plano inclui).
2. Snapshot manual pré-deploy: `pg_dump -Fc` do banco de produção.
3. **Restauração testada no staging** antes do primeiro boot em produção.
4. Sem rollback automático de migration: schema errado → restaurar snapshot.

---

## Fase 2 — DNS

Registros **por projeto**, conforme o painel do Vercel (Settings → Domains).
Tipo, host e destino vêm **exclusivamente** do Vercel — a tabela abaixo é
preenchida no momento da execução, sem tipos fixos:

| Projeto | Domínio | Tipo (do Vercel) | Host | Destino (do Vercel) |
|---|---|---|---|---|
| Store (`prj_9Sugoxxzib3WdiDaXnOFJ8jth4IO`) | `airsoftamericana.com.br` | _a preencher_ | `@` | _do Vercel_ |
| Store | `www.airsoftamericana.com.br` | _a preencher_ | `www` | _do Vercel_ |
| Admin (`prj_qdcrPg8o4hA4UbIVVCO7rnOgcYOu`) | `admin.airsoftamericana.com.br` | _a preencher_ | `admin` | _do Vercel_ |
| API (`prj_MLk5KPuaIh5shK0cNZum69oXpl13`) | `api.airsoftamericana.com.br` | _a preencher_ | `api` | _do Vercel_ |

Verificação (comparar **com os valores do painel**, não com valores fixos):

```cmd
nslookup airsoftamericana.com.br
nslookup www.airsoftamericana.com.br
nslookup admin.airsoftamericana.com.br
nslookup api.airsoftamericana.com.br
```

---

## Fase 3 — Variáveis de ambiente (Vercel, por Environment)

### 3.1 API — Production

| Grupo | Variáveis | Quando |
|---|---|---|
| Boot (7) | `JWT_SECRET`, `GATEWAY_SECRETS_KEY` (32 bytes base64), `DATABASE_URL`, `STORE_URL`, `ADMIN_URL`, `COOKIE_SAMESITE=lax`, `CSRF_ENFORCE=true` | sempre |
| Runtime do banco | `DATABASE_URL_RUNTIME` = mesma base em **transaction mode** (`:6543`) — o pool do runtime serverless | sempre (ver 1.3) |
| E-mail transacional | `RESEND_API_KEY`, `MAIL_FROM` | **só quando** o e-mail transacional estiver habilitado; sem elas o recurso responde 503 "não configurado" e o boot não é impedido (`apps/api/src/config.ts:62-67`) |
| Gateway (autorização financeira) | `MERCADOPAGO_ACCESS_TOKEN` / `PAGBANK_API_KEY` / `CIELO_CLIENT_ID` + `CIELO_CLIENT_SECRET` | **só após** autorização financeira por escrito |
| `GATEWAY_ACTIVE` | **ausente** até a autorização financeira | ver 3.3 |
| Opcionais | `GROQ_API_KEY`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | conforme feature |

### 3.2 API — Preview / Development

- `DATABASE_URL` = **staging** (PostgreSQL isolado). PGlite é aceito só para
  teste automatizado — em serverless o filesystem é efêmero e não serve para
  validar pedidos, estoque, concorrência, webhook e persistência.
- `DATABASE_URL_RUNTIME` = a mesma base de staging no pooler **transaction
  mode** (`:6543`) — sem isso a API erra 500 em rajada (ver 1.3).
- `JWT_SECRET` e `GATEWAY_SECRETS_KEY` **próprios**, diferentes de produção.
- `GATEWAY_ACTIVE` = nome do provider sandbox usado no staging
  (`mercadopago` | `pagbank` | `cielo`), com credenciais de teste.
- `COOKIE_SAMESITE=lax`, `CSRF_ENFORCE=true`.

### 3.3 `GATEWAY_ACTIVE` — semântica real (código, não suposição)

`GATEWAY_ACTIVE` é o **nome do provider** (`mercadopago` | `pagbank` |
`cielo`), usado como desempate quando o Admin não tem gateway default
habilitado (`apps/api/src/services/payments/types.ts:171-188`). A seleção
real é a configuração do gateway no Admin (`gateway_configs.enabled` /
`is_default`).

| Situação | Resultado |
|---|---|
| Produção só com o gateway sandbox (estado inicial do bootstrap) | sandbox é excluído da seleção → checkout **503 `no_payment_gateway_enabled`**, sem pedido, sem pagamento, sem reserva |
| Produção com gateway real habilitado no Admin + credenciais reais no Vercel | cobrança real habilitada — **exige autorização financeira por escrito** |
| `GATEWAY_ACTIVE=sandbox` em qualquer ambiente | permitido em Local/Preview/Staging; em produção o sandbox é barrado pelo código (`types.ts:178-180`, `205`) |

### 3.4 Store / Admin

| Projeto | Environment | Variáveis |
|---|---|---|
| Store | Production | `NEXT_PUBLIC_API_URL=https://api.airsoftamericana.com.br`, `NEXT_PUBLIC_SITE_URL=https://airsoftamericana.com.br` |
| Store | Preview | `NEXT_PUBLIC_API_URL=<URL do preview da API>`, `NEXT_PUBLIC_SITE_URL=<URL do preview da Store>` |
| Admin | Production | `NEXT_PUBLIC_API_URL=https://api.airsoftamericana.com.br` |
| Admin | Preview | `NEXT_PUBLIC_API_URL=<URL do preview da API>` |

Segredos de produção nunca no Preview/Development. As URLs de Preview são as
geradas pelo Vercel no deploy.

### 3.5 Geração de segredos (local, sem commitar)

```cmd
node -e "console.log('JWT_SECRET:', require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('GATEWAY_SECRETS_KEY:', require('crypto').randomBytes(32).toString('base64'))"
```

Guarde o `GATEWAY_SECRETS_KEY` em gerenciador de senhas: sem ele, as
credenciais de gateway cifradas no banco ficam ilegíveis.

---

## Fase 4 — Resend (e-mail transacional)

1. Resend → Domains → adicionar `airsoftamericana.com.br`.
2. DNS: registros que o Resend pedir (SPF/DKIM/MX) — adicionados no mesmo
   painel do registrador, sem colisão com a Fase 2.
3. API key `re_…` → `RESEND_API_KEY`; `MAIL_FROM` =
   `Airsoft Americana <no-reply@airsoftamericana.com.br>`.
4. Teste: `POST /api/auth/forgot-password` com e-mail real.

Sem e-mail transacional: as duas variáveis ficam de fora e o recurso fica
indisponível (503 rotulado), **sem impedir o boot**.

---

## Fase 5 — Schema e seeds

### 5.1 Onde cada coisa roda

| Contexto | Comando | Banco | Observação |
|---|---|---|---|
| Produção — 1ª vez e a cada mudança de schema | `npm run db:bootstrap -w @airsoft/api` com `DATABASE_URL` do papel DDL | Postgres de produção | aplica migrations + dados reais de operação + grants do papel de runtime (`bootstrap-prod.ts:224-256`) |
| Staging (schema do Preview) | `npm run db:migrate -w @airsoft/api` | Postgres de staging | mesmas migrations, mesmo motor (ledger + advisory lock) |
| Dev local | `npm run db:migrate` / `npm run db:reset` | PGlite local | recriação do banco de desenvolvimento |
| Testes automatizados | `vitest` | **PGlite exclusivo** (`apps/api/vitest.setup.ts:10-12` força `DATABASE_URL=""` e `PGLITE_DIR=data-test`) | migrations de teste rodam **só** em PGlite — nunca tocam banco de ambiente |
| Seeds automatizados | `npm run db:seed` | PGlite ou Postgres **local** | `DATABASE_URL` remoto → recusado (`seed-target.ts:86-96`) |
| Seed de E2E | `npm run e2e:seed` | PGlite dedicado | `DATABASE_URL` preenchido → recusado (`seed-target.ts:76-84`) |
| Production | seed/CLI | — | **recusado no código** (`NODE_ENV=production` → `SeedTargetError`) |

### 5.2 Comandos e o que recusam

| Comando | Recusa |
|---|---|
| `npm run db:migrate` | `NODE_ENV=production` → orienta `db:bootstrap` (`apps/api/src/db/migrate.ts:1230-1248`) |
| `npm run db:seed` | produção; banco remoto sem `SEED_ALLOW_REMOTE=1` |
| `npm run db:reset` | mesma guarda, **antes** do delete (nada é apagado se recusado) |
| `npm run e2e:seed` | qualquer `DATABASE_URL` |

Operação em banco de desenvolvimento (Postgres local) é comando separado e
identificado; nenhuma dessas rotas alcança Production.

### 5.3 Recuperação do ledger

| Cenário | Procedimento |
|---|---|
| Passo idempotente `in_progress`/`interrrompida` | próximo run re-executa; trilha do erro anterior é preservada |
| Passo `nonIdempotent` interrompido | `MigrationNonIdempotentError` — intervenção humana |
| `aplicada` com checksum divergente | `MigrationChecksumError` — boot bloqueado; decisão humana |
| Ledger corrompido | restaurar snapshot pré-deploy; **nunca** DELETE manual no ledger |

---

## Fase 6 — Pagamentos

### 6.1 Produção sem autorização financeira

Estado inicial: o bootstrap semeia **um gateway sandbox**; em produção o
sandbox é excluído da seleção → `resolveActiveAdapter()` devolve `undefined`
→ checkout responde **503 `no_payment_gateway_enabled`** (`checkout.ts:150-155`).

### 6.2 O bloqueio vem ANTES de qualquer escrita

Ordem no código (`apps/api/src/services/checkout.ts`):

1. `initAdapters(db)` + `resolveActiveAdapter(db)` — **linhas 133-155**
2. `insert(orders)` — linha 302
3. `reserveStock(...)` — linha 340
4. `insert(payments)` — linha 458

Ou seja: sem gateway válido **não existe** pedido, pagamento nem reserva de
estoque — não há pedido pendente nem estoque retido por checkout bloqueado.
Coberto por teste: `apps/api/src/services/checkout.test.ts`
("503 quando NENHUM gateway habilitado" e "produção sem gateway real"), com
asserção de `orders = 0`, `payments = 0`, `inventory.reserved = 0`.

Códigos de erro reais: `no_payment_gateway_enabled` (503) e
`gateway_unavailable` (503, credencial ilegível).

### 6.3 Sandbox antes de produção

| Teste | Critério |
|---|---|
| PIX sandbox | QR + webhook `pagamento_aprovado` |
| Cartão sandbox (`4111 1111 1111 1111`) | `autorizado` + captura |
| Boleto sandbox | boleto gerado → expiração → cancelamento |
| Chargeback sandbox | `em_disputa` → `ganho`/`perdido` |
| Idempotência de webhook | reenvio do mesmo `eventId` → `duplicate: true` |

Nenhuma cobrança real sem autorização financeira separada, por escrito.

---

## Fase 7 — Cookies, URLs e subdomínios

| App | Domínio | Cookie | SameSite |
|---|---|---|---|
| Store | `airsoftamericana.com.br` | `aa_cart`, `aa_customer` | `lax` |
| Admin | `admin.airsoftamericana.com.br` | `aa_admin_session` | `lax` |
| API | `api.airsoftamericana.com.br` | — | stateless |

- Padrão: `COOKIE_SAMESITE=lax` + `CSRF_ENFORCE=true` + validação de Origin
  e CORS.
- `SameSite=Strict` **não** elimina CSRF: subdomínios do mesmo domínio
  registrável são *same-site* para o navegador. `none` só com domínios
  registráveis diferentes e `Secure`.
- `Set-Cookie` é validado em rota **real** de sessão/carrinho (ex.: login,
  `POST /api/cart`), nunca em `/api/test` — endpoint de health não cria
  cookie.

---

## Fase 8 — Validação dos 3 Previews

```cmd
gh workflow run "Deploy Vercel (CLI)" -f environment=preview
```

| Alvo | O que validar |
|---|---|
| Store preview | home, catálogo, PDP, carrinho, login, checkout sandbox, `/api/test` |
| Admin preview | login + MFA, CRUD, pedidos |
| API preview | `/api/test`, webhook sandbox, idempotência, concorrência de estoque |

Métricas: Lighthouse ≥ 90 (Performance, Acessibilidade, Boas Práticas, SEO) e
`pa11y-ci` WCAG 2.1 AA. URLs: as geradas pelo Vercel — nunca inventadas.

### 8.1 Evidência da rodada de qualidade (commit `5c98b55`, run `44654174786`)

| Medida | Resultado | Como medir |
|---|---|---|
| Lighthouse 12 — home | perf **92** · a11y **100** · bp **100** · seo **100** (LCP 2,8 s · FCP 1,3 s · CLS 0 · 359 kB) | `lighthouse@12 <url> --only-categories=performance,accessibility,best-practices,seo` |
| Lighthouse 12 — catálogo | perf **94** · a11y **100** · bp **100** · seo **100** (LCP 2,5 s · FCP 1,2 s · CLS 0 · 353 kB) | idem |
| pa11y-ci WCAG2AA | **13/13 URLs, 0 violações** (13 passes, 0 errors) | `pa11y-ci --config pa11y-ci.json --json` |
| Smoke dos 3 previews | **26/26 PASS** (API 19 · painel 10 · loja 7, incluindo o 404 de `/carrinho`) | `smoke-previews.mjs --api … --store … --admin …` |
| Matriz de rotas | 12 rotas 200 com canonical e robots corretos; `/carrinho` e rota inexistente **404**; banner de cookies no HTML em todas as 200 | `route-matrix.mjs` |
| Rajada na API | **48/48 requisições 200** (antes: 10/48) | 48 GETs concorrentes contra a API do preview |
| Logs da API preview | **0 entradas de erro** desde o deploy | `vercel logs <deployment> --level error` |

O `bp` estava em 96 porque o Lighthouse marcava `errors-in-console`: a API
respondia 500 em `/api/cart`, `/api/store/categories` e `/api/store/settings`
durante a medição. Causa raiz: pooler em session mode com teto de 15 clientes
(1.3). Corrigido no commit `5c98b55` — com transaction mode a rajada passa
limpa e o console do navegador fica sem erro.

Peso da página (favicon 363 kB → 11 kB, apple-icon 1,9 MB → 19 kB, aviso de
cookies no HTML do servidor, IBM Plex Mono sem preload) caiu de 716/713 kB para
**359/353 kB** — foi o que destravou o LCP do catálogo, que antes era o
parágrafo do banner pintado depois da hidratação.

---

## Fase 9 — Deploy de produção (só com autorização explícita)

Pré-requisitos (todos verificados antes do pedido de deploy):

- [ ] Postgres de produção provisionado com papéis DDL e runtime
- [ ] Backup automático + snapshot manual + **restauração testada**
- [ ] Schema aplicado por `db:bootstrap` autorizado
- [ ] DNS propagado (comparado com o painel do Vercel)
- [ ] 7 variáveis de boot + Store/Admin configuradas por Environment
- [ ] `DATABASE_URL_RUNTIME` configurada no Environment Production (pooler em
      transaction mode, `:6543`) — sem ela a vitrine erra 500 em rajada (1.3)
- [ ] Resend verificado (ou recurso de e-mail desabilitado de propósito)
- [ ] Gateway sandbox validado nos Previews
- [ ] `GATEWAY_ACTIVE` **ausente** e credenciais reais **ausentes** até a
      autorização financeira
- [ ] Preview validado (smoke + Lighthouse + pa11y + sandbox)

Comando (disparado por mim, mediante a frase de autorização):

```cmd
gh workflow run "Deploy Vercel (CLI)" -f environment=production
```

Pós-deploy (primeiros 30 min, **sem cobrança real**): `/api/test` da API,
home da Store, login+MFA do Admin, pedido sandbox visível no painel.

---

## Não fazer

- Não semear em Production, em Preview ou Staging.
- Não aplicar migrations fora de `db:bootstrap` (produção) / `db:migrate`
  (staging).
- Não DELETE manual no `migration_ledger`.
- Não usar credencial real em Preview/Development.
- Não usar sandbox em produção (o código recusa).
- Não `vercel deploy --prod` manual.
- Não inventar URL de Preview, valor de DNS ou número de teste.
- Não autorizar cobrança real sem autorização financeira por escrito.
