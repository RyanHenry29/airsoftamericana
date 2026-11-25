# Promoção de `DB_POOL_MAX=2` — checklist de produção

> Documento da iniciativa de promoção (branch `exp/arch-capacity-promotion`).
> A evidência da medição que habilitou esta configuração vive em
> `exp/arch-capacity-validation` (`docs/bench/capacidade/RELATORIO-CAPACIDADE.md`);
> os artefatos da bateria de validação desta branch vivem em
> `docs/bench/promocao/`.
>
> **Nada aqui foi executado em produção.** Toda a execução de produção exige
> autorização específica (ver §3).

## 1. Estado validado

| Item | Valor |
|---|---|
| Branch | `exp/arch-capacity-promotion` @ `0cad0c1` (base `cb1d2ae`, head do PR #3) |
| Paridade do runtime | `git diff 8dd9774 HEAD -- apps/api` → **vazio** (o código promovido é byte a byte o medido) |
| Testes | API 429 passed / 1 skipped · raiz 76 passed · `tsc` api+shared OK · `check-test-locks` ok |
| Config efetiva observada | `pmax=2`, `ctmo=10000` (lida do runtime, não assumida) |
| Pooler | Transaction Pooler do ambiente de validação (`:6543`), via `DATABASE_URL_RUNTIME` |
| Deploy de validação | `dpl_8osGzCGpGG49tyGheHeTHggeEXP2` · `airsoftamericana-ayvf0x23h-…vercel.app` |

### Bateria de validação (2400 requisições + 90 de aquecimento, ~7 min de carga)

| Janela | Requisições | Conc. | 2xx | 5xx | p50 | p95 | p99 | Instâncias | `emax` | `acqto` | `retry` | req/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fria | 300 | 10 | 300 | 0 | 1879 ms | 1996 ms | 3966 ms | 3 | 0 | 0 | 0 | 5,15 |
| Aquecida | 300 | 10 | 300 | 0 | 1858 ms | 1983 ms | 2174 ms | 2 | 0 | 0 | 0 | 5,41 |
| Distribuída | 600 | 50 | 600 | 0 | 8835 ms | 9078 ms | 9556 ms | 2 | 0 | 0 | 0 | 5,64 |
| Prolongada | 1200 | 10 | 1200 | 0 | 1846 ms | 1924 ms | 2012 ms | 1 | 0 | 0 | 0 | 5,41 |

Leituras:

- **Zero erro HTTP em 2400 requisições**, zero recusa de admissão do pooler
  (`emax`), zero estouro de fila (`acqto`), zero retry.
- **A cauda fria é o único ponto diferente**: p99 3966 ms na janela fria
  (cold start de 3 instâncias) contra 2012–2174 ms nas demais.
- **A taxa não cresce com a concorrência**: 5,15 → 5,41 → 5,64 → 5,41 req/s.
  O limite é o pool por instância (2 conexões), não a chegada do cliente.
- **A concorrência distribuída aparece como fila, não como degradação**: com
  conc 50 a latência vai a 8835 ms com `inl`/`inpk` = 50, sem erro e sem
  recusa do pooler. Com 2 instâncias × 2 conexões = **4 clientes** do pooler.

## 2. Variáveis de produção

### 2.1 `DATABASE_URL_RUNTIME` (nova, obrigatória)

O runtime serverless exige o **Transaction Pooler** (`:6543`). O `config.ts`
falha fechada: sem essa variável, a API **não sobe** em `NODE_ENV=production`;
se apontar para session mode, também não sobe.

Derivação a partir do que existe hoje em produção (mesma origem, mesmo papel,
mesma senha; **só a porta muda**):

```
produção hoje      aws-1-ca-central-1.pooler.supabase.com:5432  session
a derivar          aws-1-ca-central-1.pooler.supabase.com:6543  transaction
```

**Fatos já verificados mecanicamente** (2026-11-24, sem tocar em produção):

| Verificação | Resultado |
|---|---|
| Project-ref da URL de produção | `psswdwsvybsqrflhpuqx` — casa **exatamente** com o projeto Supabase "airsoft americana" da org "Airsoft Americana" (`ACTIVE_HEALTHY`) |
| Região | host do pooler `aws-1-ca-central-1` = região `ca-central-1` do projeto |
| Formato do usuário | `airsoft_app.<project-ref>` — **já** no formato do transaction mode; a derivação **não** precisa mexer no usuário |
| Derivação | mesma senha, mesmo host, query string preservada (`sslmode=require`), só a porta muda (5432 → 6543) |
| Classificador do runtime | `classifyPooler` → `transaction` para a forma derivada |
| Ausência em produção | `DATABASE_URL_RUNTIME` **ausente** no target `production` (confirmado por `env pull`) — merge sem ela derruba a API |
| Ambiente de validação | preview usa o projeto **staging** (`zuejjupuxegpczgyonha`), mesmo formato de usuário, mesmo host/região; a transaction mode **funciona** lá (foi o que a bateria mediu) |

**O que ainda é fato de painel** (a API do Supabase não expõe o modo do pooler):

1. que o pooler em **transaction mode** está habilitado no projeto de produção;
2. que a porta 6543 responde para esse projeto com o papel `airsoft_app`.

A prova definitiva é o passo 3 do procedimento (`SELECT 1` com a
`DATABASE_URL_RUNTIME`) — ela depende de autorização própria para tocar o
banco de produção.

A URL **nunca** é digitada em log, PR, ticket ou terminal compartilhado:
gravar direto no target de produção da Vercel, por canal seguro.

### 2.2 `DB_POOL_MAX=2` (nova)

Existe hoje em produção: **não**. Sem ela o `poolSizing` usa o default `1`
(transaction/session) — o baseline que a medição comparou.

| Variável | Valor | Observação |
|---|---|---|
| `DB_POOL_MAX` | `2` | nova em produção |
| `DB_POOL_ACQUIRE_TIMEOUT_MS` | `10000` (default) | **não gravar** — o default já é 10 s e nenhuma janela o aproximou |
| `DB_POOL_IDLE_TIMEOUT_MS` | `10000` (default) | **não gravar** — devolve a vaga ao pooler |

`DB_POOL_MAX` é lido por `poolSizing` em ambos os modos; vale para a linha de
runtime. **Não** aplicar `max=2` em session mode (ver §7).

### 2.4 Conjunto de variáveis da promoção — são TRÊS, não duas

| Variável | Valor em produção | Obrigatória? | Por quê |
|---|---|---|---|
| `DATABASE_URL_RUNTIME` | ausente | **sim** | o runtime serverless exige transaction mode; sem ela o `config.ts` falha fechada e a API não sobe |
| `DB_POOL_MAX` | ausente (default `1`) | **sim** | é a configuração promovida; sem ela o deploy roda no baseline `max=1` |
| `DB_TRACE_TOKEN` | ausente | **sim** | **sem ela os sinais de abort não existem**: o trace falha fechado e o header `x-db-trace` nunca é emitido |

O terceiro item é o que costuma passar batido. A autorização da telemetria é
independe do header de ativação: sem `DB_TRACE_TOKEN` configurado, o
`apps/api/index.ts` responde `trace_disabled` no healthz e **não emite**
`x-db-trace` em nenhuma resposta. Ou seja, com apenas as duas primeiras
variáveis, a janela de produção mediria latência e status HTTP — e ficaria
**cega** para `emax` (recusa de admissão do pooler), `acqto` (fila estourada),
`pmax`/`ctmo` (config efetiva) e `retry`, que são três dos cinco critérios de
abort de §4.3.

O valor do token em produção deve ser **novo** (não o do preview): gerado na
máquina, gravado direto no target `production`, nunca em repo, PR, log ou
transcript.

### 2.5 Estado do ambiente de validação (preview) — não confundir com o baseline
O target `preview` do projeto **não** está no baseline `max=1`: ele carrega a
configuração promovida.

| Variável | Target `preview` | Target `production` |
|---|---|---|
| `DB_POOL_MAX` | `2` (presente, marcada como sensível pela Vercel) | ausente |
| `DATABASE_URL_RUNTIME` | presente (`:6543`, staging) | **ausente** |
| `DATABASE_URL` | sessão (`:5432`, staging) | sessão (`:5432`, produção) |

Consequências práticas:

- todo preview novo desta branch já nasce com `pmax=2` — **não** serve como
  referência de baseline `max=1`; para baseline use a branch de evidência
  (`exp/arch-capacity-validation`) ou remova a variável do preview;
- `vercel env pull` **não** expõe `DB_POOL_MAX` nem `DATABASE_URL_RUNTIME` do
  preview (marcadas como sensíveis → `[SENSITIVE]`); o valor efetivo só pode
  ser lido do runtime, pelo healthz autorizado (`pmax`/`ctmo`);
- para remover a configuração do preview:
  `vercel env rm DB_POOL_MAX preview --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13`
  (e o mesmo para `DATABASE_URL_RUNTIME`, se for o caso).

### 2.6 Regra de vigência — env var só vale para deploy novo

Fato da plataforma (documentação da Vercel, "Environment variables"):

> "Any change you make to environment variables are not applied to previous
> deployments, they only apply to new deployments."

E no troubleshooting da mesma página: *"Environment variable changes apply
only to new deployments. The running deployment keeps the values it was built
with."* — a correção indicada é **redeploy**.

Isso não é detalhe de arquivo: é o que decide o que a A/B/C/D consegue medir.

| Momento | O que acontece | Consequência |
|---|---|---|
| **Item A** — grava as três vars em `production` | o deployment de produção **em serviço** (11 d, `5d6a978`) continua com o snapshot antigo: sem `DATABASE_URL_RUNTIME`, sem `DB_POOL_MAX`, sem `DB_TRACE_TOKEN` | as vars só entram no **próximo** deploy. O harness (item B) não é afetado — ele lê a URL do `env pull`, não do runtime |
| **Item C** — baseline de produção | sem um deploy que carregue `DB_TRACE_TOKEN`, a API responde `trace_disabled` e **não emite** `x-db-trace` | a baseline sem trace mede latência e status HTTP e fica **cega** para `emax`, `acqto`, `retry`, `pmax` e `ctmo` — 3 dos 5 critérios de abort de §4.3 |
| **Item D** — remoção do token | remover a var do target não a tira do deployment em serviço | o trace **continua ativo** até um novo deploy; sem redeploy, a remoção só vale para o deployment seguinte |

Consequência prática para a traced baseline (`pmax=2` só entra com o
deployment promovido): ela exige um **deploy de configuração** — redeploy do
**mesmo SHA**, sem merge e sem mudança de código:

```powershell
vercel redeploy <url-do-deployment-de-producao> --target production
```

Isso é um **deploy de produção**: está fora do escopo autorizado hoje (§7 do
pedido de autorização) e exige autorização própria. Sem ele, a alternativa é
medir a baseline **sem trace** (latência + status + 2xx/5xx) e registrar
explicitamente que `emax`/`acqto`/`retry`/`pmax`/`ctmo` só passam a ser
observáveis no pós-promoção — o que deixa os critérios de abort sem sinal
prévio.

### 2.7 O código de produção não tem telemetria — o redeploy de configuração é inócuo

A §2.6 diz que env var só vale para deploy novo. A verdade seguinte é mais
fria: **o código que está em produção não lê as três variáveis**.

| | `master` `5d6a978` (produção hoje) | código da linha de promoção (PR #4) |
|---|---|---|
| header `x-db-trace` | **não existe** (`db-trace.ts` e `trace-auth.ts` nunca chegaram ao master) | existe, gated por `DB_TRACE_TOKEN` |
| `DB_POOL_MAX` | **ignorada** — o pool é dimensionado por constante compilada: `max: isTransactionPooler ? 1 : 5` | lida por `poolSizing` (default 1) |
| `DATABASE_URL_RUNTIME` | **ignorada** — o runtime usa `DATABASE_URL` em session mode | **obrigatória** em produção: `config.ts` falha fechada sem ela e recusa porta 5432 |
| `GET /healthz` | `{status, timestamp}` — sem `db.status`, `pmax`, `ctmo` | `db.status`, `pmax`, `ctmo`, `inst`, `inl`, `inpk` |

Consequência direta: **redeploy do SHA de produção com as três variáveis
escritas muda nada** — as três ficam inertes, nenhum `x-db-trace` é emitido e
o healthz continua sem campos de pool. Esse caminho **não produz baseline
traced**; produz baseline untraced e um deploy inútil.

O primeiro deployment que produz telemetria tem de carregar o **código** da
linha de promoção. Dois dados que reduzem o risco desse deploy de código:

- `apps/api/src/db/schema.ts` é **byte-idêntico** entre `master` e o código
  medido → o deploy não carrega schema novo (o bloqueio de bootstrap, §8, é
  sobre o ledger de migrations, não sobre colunas);
- o contrato de deploy (`workflow_dispatch production`) faz `vercel pull` →
  `vercel build --prod` → `vercel deploy --prebuilt --prod` — **não roda
  migration**; o bootstrap continua sendo um passo separado e bloqueado.

O delta de runtime entre `master` e o código medido é de 39 arquivos
(`trace-auth`, `db-trace`, `pool-mode`, `ai-assistant`, `checkout`, …) —
ou seja, **deploy de código**, não mudança de configuração.

### 2.8 As duas ordens possíveis para a baseline

**Ordem 1 — code-first (é a que produz baseline traced)**

| # | Passo | O que exige autorização |
|---|---|---|
| 1 | gravar `DATABASE_URL_RUNTIME` + `DB_TRACE_TOKEN` — **sem** `DB_POOL_MAX` (default max=1) | item A |
| 2 | merge PR #3 → PR #4, na ordem | **autorização de código** (decisão separada) |
| 3 | **D1** — deploy de código (1 deployment): recebe o snapshot novo → runtime em transaction mode, **pmax=1**, com trace | o mesmo deploy de código |
| 4 | harness (item B) + gate de schema (§2.9) — antes do deploy, para não derrubar a API | item B |
| 5 | verificação do D1: SHA, deployment id, alias de produção, `db.status = connected`, `pmax = 1`, `ctmo = 10000`, trace autorizado | — |
| 6 | 3 janelas traced em pmax=1 → `p99_baseline` | item C |
| 7 | **decisão de capacidade** | titular |
| 8 | **D2** — `DB_POOL_MAX=2` + redeploy → pmax=2; 3 janelas traced do config promovido | promoção (autorização própria) |
| 9 | observação 24 h contadas do fim do ciclo promovido | — |
| 10 | **R2** — remover o token + redeploy → `trace_disabled` confirmado | item D |

**Inventário de deployments (determinístico, sem operação redundante):**

| Fase | Deployments | Natureza |
|---|---|---|
| Validação (até a decisão) | **1** — D1 | deploy de código, com `DATABASE_URL_RUNTIME` + `DB_TRACE_TOKEN`, **sem** `DB_POOL_MAX` (pmax=1) |
| Promoção (se houver decisão de promover) | **+1** — D2 | redeploy de configuração, com `DB_POOL_MAX=2` (pmax=2) |
| Encerramento do trace | **+1** — R2 | redeploy de configuração, sem `DB_TRACE_TOKEN` |

Total do ciclo completo: **1 deploy de código + 2 redeploys de configuração**.
Até a decisão de capacidade: **1 deploy de código, zero redeploys**.

**Por que não existe um R1**: um redeploy do SHA atual não carrega o código
com trace, não lê `DB_POOL_MAX` e não expõe `pmax`/`ctmo` no healthz (§2.7) —
seria uma operação de produção sem efeito funcional. O primeiro deployment
que produz telemetria **é** o D1, que já carrega o snapshot novo.

**Razão de cada redeploy**: D2 existe porque é o que aplica `DB_POOL_MAX=2`
(é a própria promoção); R2 existe porque a remoção do token só vale em
deploy novo (§2.6) — sem ele, o trace continua ativo.

**Por que o D1 não pode ser o deploy da promoção**: o `DB_POOL_MAX=2` fica
**fora** de produção até a decisão baseada nos resultados. Com o D1 em pmax=1,
a comparação muda uma variável só (tamanho do pool 1 → 2), com o mesmo
código, o mesmo modo e a mesma telemetria dos dois lados — e o risco do pool
maior não entra antes da decisão.

**Ordem 2 — config-first (o redeploy de configuração puro)**

| # | Passo | O que acontece |
|---|---|---|
| 1 | gravar as três vars + redeploy do SHA atual | **inócuo** (§2.7): sem trace, sem `pmax`/`ctmo` no healthz |
| 2 | 3 janelas **untraced** (latência, status, 2xx/5xx) | `p99_baseline` parcial — cega para `emax`/`acqto`/`retry`/`pmax`/`ctmo` |
| 3 | merge PR #3 → PR #4 + deploy de código (as vars já estão presentes) | runtime já nasce em max=2 + transaction + trace |
| 4 | janelas promovidas traced | sim |
| 5 | observação 24 h → remover o token + redeploy | item D |

Total: 1 redeploy inócuo + 1 deploy de código + 1 redeploy. É a C-untraced de
Kai, acrescida de um deploy que não muda comportamento.

> A escolha entre as duas ordens é do titular e é uma autorização de **código**,
> não de configuração: só a ordem 1 produz o baseline traced com os sinais
> internos do pooler.

### 2.9 Gate de compatibilidade de schema antes do D1

`schema.ts` byte-idêntico entre `master` e a branch de promoção **não** prova
que o banco de produção tem as colunas que o código novo consulta. O gate é
uma verificação de leitura, antes do deploy de código:

```powershell
node arch-schema-diff.mjs --env-file $envFile --var DATABASE_URL --out $schemaDiff
```

| | O que faz |
|---|---|
| **esperado** | parse de `apps/api/src/db/schema.ts` (`pgTable` + builders de coluna) — 57 tabelas / 497 colunas |
| **real (existência)** | `pg_catalog.pg_attribute` + `pg_class` — fonte de verdade, visível a qualquer papel |
| **real (visibilidade)** | `information_schema.columns` — filtrado por privilégio do papel de runtime |
| **veredito** | `compativel` = nenhuma tabela/coluna esperada ausente no catálogo |

A distinção importa: `information_schema` só mostra o que o papel de runtime
tem privilégio de ver, então "ausente" no `information_schema` pode ser
"sem privilégio". O script separa os dois casos (`semPrivilegio`) para que
um falso positivo de permissão não vire falso diagnóstico de schema.

**Método validado em staging (2026-11-25)**: 57 tabelas / 497 colunas
esperadas, 60 tabelas / 580 colunas reais → **0 tabelas ausentes, 0 colunas
ausentes, 0 objetos sem privilégio**; 3 tabelas extras no banco
(`migration_ledger`, `support_messages`, `webhooks`), informativas.

**Pendência**: a execução contra **produção** é uma leitura (papel
`airsoft_app`) e depende da autorização do item B. Sem esse veredito, o D1
não deve acontecer — é o gate que impede o deploy de código derrubar a API
por coluna faltando.

### 2.3 `DATABASE_URL` (preservada)

Continua em session mode, apontando para o papel DDL, e é consumida por
`db:migrate` / `db:bootstrap` / CLIs administrativos. O runtime **não** a usa
(quando `DATABASE_URL_RUNTIME` existe, ela tem precedência). O
`assertSessionScopeSafe` recusa uma URL em transaction mode no caminho de
migração — a separação é garantida por código, não por convenção.

## 3. Procedimento de promoção (exige autorização específica)

> O escopo fechado a ser autorizado — três itens, com o que toca, o que não
> toca, o que aborta e a evidência a produzir — está formalizado em
> **`docs/AUTORIZACAO_OPERACIONAL.md`**. Este checklist é a referência
> técnica; o pedido de autorização é o documento operacional.

1. **Variáveis** — no target `production` do projeto `airsoftamericana-api`:
   gravar `DATABASE_URL_RUNTIME` (transaction mode, valor de §2.1),
   `DB_POOL_MAX=2` e `DB_TRACE_TOKEN` (§2.4). Confirmar com `vercel env ls`
   (nomes/targets, nunca valores).
2. **Conexão** — teste de conexão **antes** do merge, e **com o papel de
   runtime**, não com credencial administrativa:
   - abrir a pool com a `DATABASE_URL_RUNTIME` (`:6543`, usuário
     `airsoft_app.<project-ref>`) e rodar `SELECT 1`;
   - a URL vem do `env pull` do target `production` para um arquivo
     temporário, entra no processo por stdin/arquivo — **nunca** em argv,
     log ou transcript;
   - um teste com a `DATABASE_URL` (session mode, papel DDL) **não prova
     nada** sobre o runtime: são porta, caminho e papel diferentes;
   - o que se precisa provar é exatamente o caminho do runtime: porta 6543 +
     papel `airsoft_app` + o mesmo `project-ref` de produção.

   Sem isso, o merge derruba a API (falha fechada por design).

   O procedimento executável está em §11, com o harness já validado no
   ambiente de staging.
3. **Merge** — PR próprio da branch `exp/arch-capacity-promotion`. O PR #3
   (`fix/aud03-migration-ledger`) segue **aberto e separado**, como combinado.
4. **Deploy** — pelo `workflow_dispatch` do contrato de deploy (PR #2): push em
   `master` só produz Preview; produção é manual e gatilhada. É este deploy
   que faz as variáveis do passo 1 valerem — e o código que ele carrega é
   que traz o trace e a leitura de `DB_POOL_MAX` (§2.7): um redeploy do SHA
   atual não produz telemetria nenhuma.
5. **Validação pós-deploy** — smoke das rotas principais + 1 janela de 300
   requisições / concorrência 10 contra a produção, lendo `pmax`/`ctmo` pelo
   healthz autorizado e `emax`/`acqto` no log.
6. **Observação** — manter a bateria por 24 h antes de considerar a promoção
   concluída (ver §6).

## 4. Critérios de aceite e de abort

### 4.1 Protocolo de janela (fixo — sem ele o critério não é reproduzível)

| Item | Valor |
|---|---|
| Requisições por janela | 300 |
| Concorrência por janela | 10 |
| Rota | `/api/store/home` (mesma da bateria de validação) |
| Intervalo entre janelas | ≥ 15 min |
| Janelas por ciclo | 3 (ciclo de observação de 24 h ≈ 4 ciclos) |
| Baseline | 3 janelas com o **mesmo** protocolo, medidas em produção **antes** de gravar `DB_POOL_MAX=2` (estado atual, `max=1`) — com `x-db-trace` **somente** se o deployment de produção carregar o código com trace (§2.7): na ordem 1 (§2.8), baseline traced em max=1/transaction; na ordem 2, baseline untraced, cega para `emax`/`acqto`/`retry`/`pmax`/`ctmo` |
| Definição de `p99_baseline` | **mediana** dos p99 das 3 janelas de baseline |

A baseline de produção exige autorização própria (carga contra o banco de
produção). Os números da validação servem só de ordem de grandeza e **não**
substituem essa medição: p99 2012 ms (prolongada), 2174 ms (aquecida),
3966 ms (fria) — o frio é cold start, não steady state.

### 4.2 Aceite (todos obrigatórios)

- `GET /healthz` responde 200 com `db.status = "connected"`, `pmax = 2` e
  `ctmo = 10000`;
- smoke das rotas de vitrine, carrinho, checkout e painel sem 5xx;
- as 3 janelas do ciclo sem erro HTTP, sem `emax`, sem `acqto`, sem retry;
- p99 de cada janela ≤ 2 × `p99_baseline`.

### 4.3 Abort (qualquer um, imediatamente)

| Sinal | Ação |
|---|---|
| `5xx > 0` em smoke ou janela | interromper a janela e investigar |
| `emax > 0` (recusa de admissão — equivalente ao `EMAXCONN` do pooler) | interromper e avaliar capacidade |
| `acqto > 0` (fila interna do pool estourou) | interromper e avaliar fila |
| `db.status` ≠ `connected` | interromper imediatamente |
| p99 > 2 × `p99_baseline` em **3 janelas consecutivas** | abortar |

Em abort: **rollback do código primeiro** (§5). O branch novo recusa arrancar
sem `DATABASE_URL_RUNTIME`; remover a variável antes de reverter o código
derruba a API.

## 5. Rollback

| Ordem | Ação | Efeito |
|---|---|---|
| 1 | `vercel rollback` para o SHA anterior (`5d6a978`) | volta ao código anterior, que não exige as variáveis novas |
| 2 | remover `DB_POOL_MAX=2` do target `production` | restaura `max=1` para o próximo deploy |
| 3 | remover `DATABASE_URL_RUNTIME` do target `production` | o código anterior funciona sem ela |

A inversão da ordem (2 → 3 → 1) derruba a API entre os passos 2 e 3.

## 6. Observabilidade

Sinais já existentes no runtime (nenhum observador novo é preciso):

| Sinal | Onde | Quando alarmar |
|---|---|---|
| `emax` | header `x-db-trace` e log da API | > 0 — recusa de admissão do pooler (teto) |
| `acqto` | header `x-db-trace` e log da API | > 0 — fila do pool estourou |
| `retry` | header `x-db-trace` | > 0 inesperado — o runtime não deve precisar de retry |
| `pmax` / `ctmo` | healthz autorizado | ≠ 2 / ≠ 10000 — configuração divergiu |
| `inst` | header `x-db-trace` | crescimento acima do previsto (× 2 = consumo do teto) |
| p99 | log da API / observabilidade da Vercel | > 2× a baseline |

Modelagem do teto: `C_global = N_instâncias × 2`. Com o teto de ~200 clientes
do pooler por projeto, a configuração só é segura com **N ≤ 100 instâncias
vivas**. No ambiente de validação, concorrência 50 manteve 2 instâncias
(4 clientes). Em produção, vigiar `inst` × 2 contra o teto é a métrica de
capacidade a observar.

## 7. Riscos

| Risco | Nível | O que a validação mediu | O que NÃO foi provado |
|---|---|---|---|
| Teto global de conexões | MÉDIO | Em conc 50 o preview manteve 2 instâncias → 4 clientes do pooler; `emax` = 0 em todas as janelas | Comportamento com N ≥ 100 instâncias (o limite prático do `C_global`); o preview nunca chegou lá |
| Generalização do benchmark | MÉDIO | 4 janelas (fria/aquecida/distribuída/prolongada), 2400+90 reqs, ~7 min contínuos, 0 erro em todas | Carga sustentada por > 4 min; múltiplos deployments simultâneos; **o pooler de PRODUÇÃO** (a validação usou o pooler do ambiente de validação, outro projeto Supabase) |
| `max=2` em session mode | — | Não é o que foi medido | Nunca aplicar: em session mode cada conexão consome uma das ~15 vagas de cliente; o `master` atual usa `max=5` por instância nesse modo. Aplicar `max=2` em session mode **aumenta** a pressão sobre o teto que o próprio branch existe para reduzir |
| Exposição de segredo no transcript | BAIXO | Varredura: 0 ocorrências do `DB_TRACE_TOKEN` e da senha de produção em 725 arquivos rastreados, 802 commits de histórico e 31 851 arquivos de temp | — |
| PAT do GitHub no remote | ALTO → mitigado localmente | Remote sem userinfo, cofre do Windows limpo, git autenticando pelo helper do `gh` (ver §10.1) | **Revogação do token exposto ainda depende do titular** — a API do GitHub não permite revogar fine-grained PAT por máquina |

Sobre a exposição: o material que apareceu no transcript foi o **envelope
criptografado** da Vercel (ciphertext + chave embrulhada), não credencial em
claro; nenhum valor descriptografado foi impresso. Ainda assim, o transcript
deve ter acesso restrito e o envelope pode ser rotacionado junto com a
credencial do projeto.

## 8. Bloqueio conhecido — bootstrap com credencial DDL

O `db:bootstrap` exige o **papel DDL** (`airsoft_ddl`), separado do papel de
runtime (`airsoft_app`), e roda pela `DATABASE_URL` em session mode. O
`assertSessionScopeSafe` impede que uma URL de transaction mode chegue ao
caminho de migração — a separação está garantida por código
(`apps/api/src/db/pool-mode.test.ts`, 3 testes).

O que **não** pode ser executado agora, e por quê:

- o ambiente de validação expõe no Vercel **apenas o papel de runtime** — a
  senha do papel DDL do banco de validação não está no projeto (e não deve
  estar);
- executar o bootstrap é uma **escrita DDL** (migrações + seed real + grants),
  que exige autorização explícita e credencial DDL do ambiente alvo.

Procedimento quando houver a credencial e a autorização: rodar o bootstrap
contra o ambiente de validação com `DATABASE_URL` do papel DDL, confirmar que
o ledger de migrations (PR #3) fica consistente, e só então apontar o runtime
para o mesmo banco via `DATABASE_URL_RUNTIME`. O `db:bootstrap` é idempotente
por bloco (só insere se a tabela estiver vazia).

## 9. Procedência

| Item | Valor |
|---|---|
| Branch de promoção | `exp/arch-capacity-promotion` @ `aeae732` |
| Base | `cb1d2ae` (head do PR #3, aberto e separado) |
| Commits de promoção | `d98a371` (pool-mode + trace v1) · `3f657ea` (inl/inpk) · `c9cd84b` (trace endurecido, 7 arquivos) · `0cad0c1` (config de deploy sem cap) · `13294be` (bateria + checklist) · `aeae732` (alinhamento do teste de integração ao header estendido) |
| PR | #4 — https://github.com/RyanHenry29/airsoftamericana/pull/4 (base `fix/aud03-migration-ledger`) |
| Runtime medido | `8dd9774` (branch `exp/arch-capacity-validation`) — byte-idêntico |
| Evidência da medição | `exp/arch-capacity-validation` @ `be7d9f7`, `docs/bench/capacidade/` (16 hashes do congelamento intactos) |
| Ferramental | `scripts/arch-*` em `be7d9f7` (commit da evidência); a bateria usou o cliente com TLS extraído desse commit — SHA-256 registrados em cada artefato |
| Artefatos da bateria | `docs/bench/promocao/0cad0c1-{fria,aquecida,distribuida,prolongada}-*.json` |
| Não realizados | merge · deploy de produção · alteração de env de produção · escrita no Supabase |

## 10. Higiene de credenciais

### 10.1 PAT do GitHub exposto no remote (2026-11-24)

| Item | Estado |
|---|---|
| Credencial | fine-grained PAT (`github_pat_*`), titular `RyanHenry29`, escopo de repositório |
| Vetor | embutida na URL do remote `origin` → apareceu no transcript ao rodar `git remote -v` |
| Cópias locais | **1** — `.git/config` deste repo. Varredura: 0 ocorrências na árvore (5 716 arquivos), 0 no histórico, 0 em 29 380 arquivos do temp, 0 no `.gitconfig` do usuário; os outros 6 repos da máquina não têm credencial embutida |
| Neutralização | remote reescrito sem userinfo; `gh auth setup-git` (helper do `gh`, OAuth no keyring); entrada do cofre do Windows (`git:https://github.com`) apagada |
| Prova | depois da remoção, `git ls-remote origin` continua autenticando — o PAT deixou de ser necessário pela máquina |
| Revogação | **pendente com o titular**: a API do GitHub não expõe revogação de fine-grained PAT (`DELETE /users/{user}/fine-grained-pat` → 404). Revogar em *Settings → Developer settings → Personal access tokens → Fine-grained tokens → token → Delete* |

Substituição, com escopo mínimo: repositório único `airsoftamericana`,
permissões `Contents: Read and write`, `Pull requests: Read and write`,
`Metadata: Read`. Regra permanente: **nenhum PAT embutido em remote** — o git
fala com o GitHub pelo helper do `gh`.

### 10.2 Outros segredos

| Credencial | Onde vive | Status |
|---|---|---|
| `DB_TRACE_TOKEN` (preview) | arquivo temporário fora do repo | fora do repo, histórico e artefatos (varredura: 0 ocorrências) |
| Senha do banco de produção | `apps/api/.env.prod` (gitignored, local) | idem — 0 ocorrências em arquivos rastreados, histórico e temp |
| Envelope da Vercel | transcript | era material **criptografado** (ciphertext + chave embrulhada), não credencial em claro; rotação recomendada junto com a credencial do projeto |

## 11. Verificação do caminho de runtime (harness)

### 11.1 O que precisa ser provado

1. a conexão abre na **porta do transaction pooler** (6543) do projeto certo;
2. o **papel de runtime** (`airsoft_app`) autentica nesse caminho — e não a
   credencial administrativa;
3. `SELECT 1` e transação explícita funcionam;
4. o modo é **transaction** e não session — comportamento, não nome de porta.

### 11.2 O harness

`%LOCALAPPDATA%\Temp\opencode\arch-tooling\arch-runtime-select1.mjs` (fora do
repo, como o resto do ferramental da iniciativa). A URL **nunca** entra em
argv: vem de arquivo. O script espelha o TLS do app
(`apps/api/src/db/index.ts`, função `poolSsl`) — sem isso o `pg` aplica a
semântica própria de `sslmode=require` e a conexão falha com "self-signed
certificate in certificate chain" (foi o que aconteceu na primeira execução).

**O arquivo-fonte é segredo operacional** e o harness o trata como tal:

| Controle | Implementação | Verificado |
|---|---|---|
| ACL restrita | `icacls <arquivo> /inheritance:r /grant:r "<usuário>:(F)"` — herança removida, só o dono do arquivo | ACL efetiva: apenas `Henryxin7:(F)` |
| Criação exclusiva | `writeFileSync(..., { flag: "wx" })` — não sobrescreve arquivo existente | segunda emissão no mesmo caminho aborta; o arquivo original fica intacto |
| Fora do repositório | o harness recusa qualquer caminho dentro da árvore do repo (risco de entrar no Git) | tentativa aborta, arquivo não criado |
| Purge explícito | `--purge <arquivo>` apaga e reporta; o `env pull` temporário é apagado ao fim de toda execução | resíduo zero após o procedimento |
| Conteúdo nunca impresso | só metadados (comprimento, porta, papel) | nenhum trecho de senha/URL em saída |

### 11.3 Procedimento em produção (exige autorização)

```powershell
cd apps/api
$envFile = "$env:LOCALAPPDATA\Temp\opencode\aa-prod-env.tmp"
$emit    = "$env:LOCALAPPDATA\Temp\opencode\aa-runtime-url.txt"

# 1. source unica: a DATABASE_URL de producao (session mode), em claro
vercel env pull $envFile --environment production --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13

# 2. deriva :6543 e grava no arquivo-fonte (nao imprime a URL)
node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-runtime-select1.mjs" `
  --env-file $envFile --var DATABASE_URL --derive --ports 6543 `
  --expect-ref psswdwsvybsqrflhpuqx --emit $emit

# 3. grava a variavel na Vercel lendo o valor por stdin (nunca em argv)
cmd /c "type %LOCALAPPDATA%\Temp\opencode\aa-runtime-url.txt | vercel env add DATABASE_URL_RUNTIME production --sensitive --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13"

# 4. teste do caminho com CONTROLE (6543 contra 5432, mesma credencial)
vercel env pull $envFile --environment production --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13
node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-runtime-select1.mjs" `
  --env-file $envFile --var DATABASE_URL --derive --ports 6543,5432 `
  --expect-ref psswdwsvybsqrflhpuqx

# 5. limpar os arquivos temporarios
Remove-Item -Force $envFile, $emit
```

O `--emit` garante **fonte única**: o valor gravado na Vercel e o valor testado
são o mesmo por construção (mesma derivação, mesmo arquivo). Como
`DATABASE_URL_RUNTIME` será marcada como sensível, ela não sai do `env pull` —
por isso o teste roda sobre a URL derivada, que é byte a byte a que será
gravada.

### 11.4 Como o modo é separado (teste diferencial, com controle)

Recursos de escopo de sessão (GUC, `LISTEN`, temp table) **não** discriminam
aqui: o pooler não reseta estado de sessão entre transações, e as duas portas
se comportaram igual. O que separa é o **pinning de backend**:

| Passo | Cliente A | Cliente B |
|---|---|---|
| 1 | abre transação → backend `X` | — |
| 2 | — | abre transação → backend `Y` |
| 3 | commit (libera `X`) | — |
| 4 | — | commit (libera `Y` por último) |
| 5 | abre transação de novo → **`X` se estiver preso**, `Y` se o pool realocar | |

Medido no ambiente de validação (mesma credencial, duas portas):

| Porta | `A_1` | `B` | `A_2` | Cliente preso ao mesmo backend? | Modo |
|---|---|---|---|---|---|
| 6543 | 761700 | 761702 | 761702 | **NÃO** — o pool realocou | **transaction** |
| 5432 (controle) | 761703 | 761705 | 761703 | **SIM** — o cliente ficou preso | session |

### 11.5 Resultado no ambiente de validação (staging, 2026-11-24)

| Verificação | Resultado |
|---|---|
| Conexão em `:6543` | ok (1,2 s) · `current_user = airsoft_app` · db `postgres` |
| `BEGIN` / `SELECT 1` / `COMMIT` | ok (retorno 1) |
| Pinning de backend | cliente **não** preso → transaction mode |
| Controle `:5432` | cliente preso → session mode (confirma que o discriminador separa) |
| TLS | `rejectUnauthorized=false`, espelhando `poolSsl` do app |
| Derivação para arquivo-fonte | 131 chars, porta 6543, valor não impresso |

### 11.6 O que o harness prova — e o que não prova

**Prova**: a conexão do caminho de runtime abre, autentica com o papel
`airsoft_app`, executa consulta e transação, e o comportamento da porta 6543
é de transaction mode (com o controle 5432 da mesma credencial como prova
diferencial).

**Não prova**: que o papel tem permissão de escrita (outro teste, fora de
escopo); que o modo está habilitado no **projeto de produção** (fato de
painel); que a carga da promoção vai se comportar como a da validação (o
pooler de produção é outro projeto).

## 12. Pendência de higiene — `DATABASE_URL` de produção como Sensitive

| Item | Estado |
|---|---|
| `DATABASE_URL` (production) | id `lqEuygQwMEcdNtvV`, type `encrypted` (valor legível por `env pull`) |
| `DATABASE_URL` (preview) | id `Bgl0gpXh1rMdnvy5`, type `encrypted` |
| Correção | trocar type para `sensitive` + `visibility: secret` — **não** aplicado, exige autorização |

Mecanismo **validado** em var de teste descartável do target preview (criada,
promovida, verificada e removida; 0 ocorrências residuais):

```powershell
vercel api -X PATCH /v9/projects/prj_MLk5KPuaIh5shK0cNZum69oXpl13/env/<ENV_ID> `
  -f type=sensitive -f visibility=secret --raw
```

Resultado do teste: `type` → `sensitive`, `visibility` → `secret`, e o
**valor foi preservado** (antes do PATCH o `env pull` mostrava o valor; depois
mostra `[SENSITIVE]`, que é a ocultação de um valor intacto).

Notas operacionais:

- `-d/--debug` do `vercel api` **não** é o body — o body vai em
  `-f/--raw-field/--field` ou `--input <arquivo>`; o valor válido é
  `sensitive` (não `secret`), e a API exige `visibility: secret` junto;
- por segurança, antes do PATCH em produção: `env pull` para um arquivo
  temporário (backup do valor em claro), PATCH, checagem funcional do caminho
  administrativo, e só então apagar o backup;
- rollback: `PATCH ... -f type=encrypted` (mesmo endpoint), ou `rm` + `add`
  a partir do backup.

> O `DATABASE_URL` é usado pelo runtime **apenas** quando
> `DATABASE_URL_RUNTIME` não existe (ver §2.1): depois da promoção, o runtime
> passa a ler a variável sensível por completo, e a `DATABASE_URL` continua
> disponível para `db:migrate` / `db:bootstrap` / CLIs — inclusive pelo
> `env pull` local, que com `sensitive` passa a exigir o arquivo em vez de
> expor o valor no terminal.

## 13. Auditoria de exposição do mecanismo de trace

Pergunta: *o mecanismo de trace expõe informações internas a quem consiga
obter o token?*

### 13.1 O que o token libera

| Interface | Sem token | Com token válido |
|---|---|---|
| header `x-db-trace` | **nunca emitido** (falha fechada) | `total`, `acq`, `sql`, `att`, `retry`, `acqto`, `emax`, `est`, `bstop`, `pmax`, `ctmo`, `inst`, `inl`, `inpk` (+ `sqlMs` opcional) |
| `GET /healthz` | 200 com `{ok, timestamp, db.status: "trace_disabled"}` | 200 com `db.status`, `pmax`, `ctmo`, `inst`, `inl`, `inpk` |

O header `x-db-trace` **ativa** o pedido; não **autoriza**. A autorização
exige o token em `x-db-trace-token` ou `Authorization: Bearer`.

### 13.2 O que o trace não carrega

- **nenhum texto de SQL**: o tipo `DbTrace` guarda `sqlMs` (tempo) e `reasons`
  (motivos de retry), mas o header emite **apenas** `sqlMs` — e é um número;
  `reasons` fica dentro do processo;
- **nenhuma credencial**: nem host, nem nome do banco, nem usuário, nem senha,
  nem string de conexão;
- `inst` é um identificador de processo (`randomBytes` → hex), não um
  identificador de host nem de deployment.

O que sobra é um **mapa da infraestrutura** (quantas instâncias, o
dimensionamento do pool, a tolerância a filas e a saturação) — é exatamente o
que a §13.1 autoriza, e nada além.

### 13.3 Mecânica de autorização (`apps/api/src/lib/trace-auth.ts`)

- o token esperado vem de `DB_TRACE_TOKEN`; sem ela, **nenhuma** métrica
  detalhada é liberada — nem no healthz, nem no header;
- comparação por `timingSafeEqual` sobre digests **SHA-256 de tamanho fixo**:
  o caminho de execução não depende do comprimento do token apresentado;
- cache por par (token esperado, token apresentado): se o `env` muda, o cache
  é invalidado — um resultado antigo não sobrevive a uma troca de token;
- o motivo (`ok` / `not_configured` / `missing_token` / `invalid_token`) é
  interno; o healthz só distingue `trace_disabled` (não configurada) de
  `trace_unauthorized` (token errado) — revela **estado de configuração**, não
  segredo.

### 13.4 Riscos residuais

| Risco | Nível | Mitigação |
|---|---|---|
| Token vazado por transcript, log de CI ou saída de terminal | ALTO | valor novo e exclusivo de produção; nunca em repo, argv ou log; `env pull` não o expõe (Sensitive) |
| Força bruta do token | BAIXO | entropia de ~256 bits (32 bytes aleatórios → 43 chars base64url). Não há rate limiting no caminho — a entropia é a defesa |
| Quem tem o token lê o mapa da infraestrutura | MÉDIO | é uma credencial de diagnóstico: não compartilhar, rotacionar em caso de suspeita |
| `trace_disabled` vs `trace_unauthorized` revela se o token está configurado | BAIXO | informação de configuração, não de credencial; aceito por design — o healthcheck público precisa responder 200 |

## 14. Ciclo de vida do `DB_TRACE_TOKEN` de produção — token temporário

O token de produção é uma **credencial de diagnóstico com janela**, não
configuração permanente.

| Fase | Ação | Quando |
|---|---|---|
| 1. Preparo | gerar token novo na máquina (`crypto.randomBytes(32).toString("base64url")` — 43 chars, ~256 bits); nunca em argv, nunca impresso | antes do item A |
| 2. Ativação | gravar `DB_TRACE_TOKEN` no target `production` como **Sensitive** (junto de `DATABASE_URL_RUNTIME`, **sem** `DB_POOL_MAX`) | item A |
| 3. Code deploy (D1) | o deployment que carrega o código com trace; nasce em transaction mode com **pmax=1** (default, `DB_POOL_MAX` ausente) | autorização de código, separada |
| 4. Validação | harness (B) + 3 janelas traced em pmax=1 → `p99_baseline` | item B, item C |
| 5. Promoção (D2) | `DB_POOL_MAX=2` + redeploy → pmax=2; 3 janelas traced do config promovido | pós-decisão, autorização própria |
| 6. Observação | manter o token durante **24 h contadas do encerramento bem-sucedido do ciclo promovido** (`T_fim_C`), **não** da criação do token e **não** do fim da baseline | item C (ciclo promovido) |
| 7. Encerramento (R2) | **remover** `DB_TRACE_TOKEN` do target `production` (`vercel env rm DB_TRACE_TOKEN production --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13`) **e** confirmar em dois níveis: (a) Vercel — `vercel env ls` não lista mais a variável em `production`; (b) runtime — só depois de um **novo deploy**, `GET /healthz` responde `db.status = "trace_disabled"` **mesmo com o token antigo apresentado**, e nenhuma resposta emite `x-db-trace` | `T_fim_C + 24 h` + o novo deploy |
| 8. Evidência | os artefatos das janelas já carregam `pmax`/`ctmo`/`emax`/`acqto`/`retry` extraídos — remover o token não apaga a evidência | — |

**Por que remover em vez de manter**:

- com o token removido, o trace **falha fechada**: nenhum header `x-db-trace` é
  emitido e o healthz volta a `trace_disabled` — o mapa da infraestrutura deixa
  de ser legível por qualquer requisição;
- manter em produção, para sempre, uma credencial que expõe `inst`, `pmax`,
  `ctmo`, `inl` e `inpk` não se justifica por uma promoção;
- o custo é real e precisa ser planejado: **depois da remoção, `emax` e
  `acqto` deixam de ser observáveis**. Por isso a janela de observação tem de
  terminar **antes** da remoção, e os artefatos têm de registrar os
  contadores — o que o runner já faz.

**A janela de 24 h começa em `T_fim_C`** — o instante de encerramento
**bem-sucedido do ciclo promovido** (as janelas em pmax=2), registrado no
artefato (`janela.finishedAt`). A baseline de validação (pmax=1) **não**
consome essa janela: ela é a referência de comparação, não o ciclo
observado. Falhas, aborts e atrasos anteriores não consomem a janela
tampouco — se o ciclo promovido não completa, o token é removido e a execução
recomeça do item A com um token novo. O instante exato da remoção é
`T_fim_C + 24 h`, anotado antes de começar.

**A remoção só é efetiva no próximo deploy** (§2.6): até lá, o deployment em
serviço continua com o token e o trace continua ativo. Por isso o item D tem
dois níveis de confirmação — **Vercel** (a variável saiu do target) e
**runtime** (`trace_disabled` no healthz e nenhum `x-db-trace` emitido, mesmo
com o token antigo apresentado). O comando de remoção, sozinho, não prova
que o ambiente deixou de disponibilizar o token.

**Registro de ciclo de vida** (vai para a evidência do item D, §6 do pedido de
autorização):

| Evento | Instante (UTC, ISO-8601) | Registrado por |
|---|---|---|
| Criação do token (na máquina, nunca impresso) | `T_criacao` | execução |
| Ativação em `production` (gravado como Sensitive) | `T_ativacao` | execução |
| Fim bem-sucedido da janela 3 | `T_fim_C` | runner (artefato) |
| Remoção do token + trace de volta a `trace_disabled` | `T_fim_C + 24 h` | execução |

Rotação em caso de suspeita (token vazado por transcript, log ou terminal):
remover imediatamente, recriar, refazer o baseline.

**Nota de modelo de ameaça**: a ACL do arquivo-fonte protege contra outros
usuários locais, **não** contra processo executado pela própria conta
autorizada, malware ou ferramenta com privilégio equivalente. A proteção é de
janela curta (o arquivo é destruído ao fim do procedimento, o valor nunca é
impresso), não de isolamento.

## 15. Verificação de ausência de alteração no banco + template do relatório

### 15.1 Por construção e por dado

Por **construção**: a rota `/api/store/home` é somente leitura — em
`apps/api/src/services/homepage.ts` há apenas `select()` do drizzle e um
`SELECT` de mais-vendidos; nenhuma escrita.

Por **dado**: marca d'água por tabela, com o script
`arch-db-fingerprint.mjs`. **Classificação: é um detector de alterações, não
prova criptográfica de imutabilidade.**

| Classe | Tabelas | Estratégia | O que o resultado sustenta |
|---|---|---|---|
| config | `banners`, `homepage_sections`, `categories`, `brands`, `products`, `product_variants` | `count(*)` + `count(*) FILTER (WHERE updated_at > T0)` | **nenhuma alteração detectada** no estado final — detector, não prova |
| transacional | `orders`, `order_items` | idem, mas com `created_at`/fallback | **medida, não afirmada**: em produção é uma loja viva e um pedido real muda essas tabelas por motivos alheios à carga |

**Limites do método (conhecidos, declarados):**

| Limite | Consequência |
|---|---|
| `updated_at` só é alterado se a aplicação mantiver o campo | um `UPDATE` que não toca `updated_at` passa despercebido nas tabelas com o campo |
| `count(*)` compara cardinalidade | substituição de conteúdo que preserva a contagem não aparece (tabelas sem `updated_at`) |
| o detector compara **estado final** | uma escrita seguida de reversão pode não aparecer no resultado |
| nada é lido de log de auditoria ou evento de escrita | o detector não cobre o caminho "escreveu e desfez" |
| a prova de método foi feita em staging | não comprova ausência de alterações em produção — em produção ele roda como verificação |

Tabelas sem `updated_at` caem no fallback `count(*)` antes/depois — detecta
inserção/remoção, **não** `UPDATE` in-place. O script introspecta
`information_schema` por tabela, sem suposição sobre o schema.

Melhorias futuras **fora do escopo desta promoção** (só se houver necessidade
concreta, e cada uma com autorização própria):

- **hash determinístico de conteúdo** para as tabelas de config: ordenação
  pela chave primária, serialização canônica e SHA-256 — detecta troca de
  conteúdo que preserva a cardinalidade;
- **leitura de logs de auditoria / eventos de escrita** na janela — é o que
  cobriria o caminho "escreveu e desfez", que o estado final não vê.

Procedimento (uma leitura antes e uma depois de cada janela):

```powershell
$t0 = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
node arch-db-fingerprint.mjs --env-file $envFile --var DATABASE_URL --derive --since $t0 --out $fpA
# ... roda a janela ...
node arch-db-fingerprint.mjs --env-file $envFile --var DATABASE_URL --derive --since $t0 --out $fpB
# o runner cruza A e B e grava o veredito no artefato
node arch-promotion-battery.mjs ... --fingerprint-before $fpA --fingerprint-after $fpB
```

**Prova de método em staging (2026-11-25)**: janela de 60 GETs / conc 5 com a
mesma marca d'água nos dois fingerprints → **0 tabelas de config com alteração
detectada**, 60/60 em 200, `emax`/`acqto`/`retry` = 0. Isso valida o
**método** naquele cenário; não é evidência sobre produção — em produção o
mesmo procedimento roda como verificação dentro da janela autorizada.

### 15.2 Campos obrigatórios do relatório de cada janela

Todos presentes no artefato JSON do runner:

| Campo | Origem | No artefato |
|---|---|---|
| Horário de início e fim | relógio do cliente | `janela.startedAt` / `janela.finishedAt` (+ `durationMs`) |
| Identificador da implantação | `--deployment-id` | `codigo.deploymentId` |
| SHA do código executado | `--deployed-commit` | `codigo.deployedCommit` |
| 2xx e 5xx | contagem por status | `statuses."2xx"` / `statuses."5xx"` (+ `errorCount`) |
| p50, p95, p99 | percentis da janela | `latencias.p50` / `.p95` / `.p99` (+ `p90`, `min`, `max`) |
| `emax`, `acqto`, retry | header `x-db-trace` | `trace.emaxRespostas` / `.acqtoRespostas` / `.retryRespostas` (+ máximos) |
| `db.status`, `pmax`, `ctmo` | healthz autorizado | `configEfetiva.status` / `.pmax` / `.ctmo` |
| Ausência de alterações no banco | fingerprints antes/depois | `banco.semAlteracaoNoBanco` + `banco.tabelasAlteradas` — leitura correta do campo: **nenhuma alteração detectada no estado final**, não "prova de que nada foi escrito" (§15.1) |
| Contexto | concorrência, rota, instances, `inl`/`inpk` | `rodada.carga`, `trace.instances`, `trace.inlMax` / `.inpkMax` |

Cruzamento do SHA: `codigo.deployedCommit` (informado pelo operador) e
`codigo.deploymentId` precisam concordar com o deployment real — conferível em
`vercel api /v13/deployments/<deploymentId>` → `meta.githubCommitSha`.
