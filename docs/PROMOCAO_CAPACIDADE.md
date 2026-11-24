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

Verificado mecanicamente: mesma senha, mesmo host, query string preservada
(`sslmode=require`), e o classificador do runtime aceita a forma derivada
(`classifyPooler` → `transaction`).

**Antes de gravar, confirmar no painel do Supabase** (fato do projeto, não
inferível do ambiente da Vercel):

1. que o pooler em **transaction mode** está habilitado no projeto de produção;
2. que o papel `airsoft_app` autentica nele — no Supavisor o usuário em
   transaction mode segue o formato `<papel>.<project-ref>`;
3. que a porta 6543 responde para esse projeto (o ambiente de validação já
   prova o padrão em outro projeto).

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

### 2.3 `DATABASE_URL` (preservada)

Continua em session mode, apontando para o papel DDL, e é consumida por
`db:migrate` / `db:bootstrap` / CLIs administrativos. O runtime **não** a usa
(quando `DATABASE_URL_RUNTIME` existe, ela tem precedência). O
`assertSessionScopeSafe` recusa uma URL em transaction mode no caminho de
migração — a separação é garantida por código, não por convenção.

## 3. Procedimento de promoção (exige autorização específica)

1. **Variáveis** — no target `production` do projeto `airsoftamericana-api`:
   gravar `DATABASE_URL_RUNTIME` (transaction mode, valor de §2.1) e
   `DB_POOL_MAX=2`. Confirmar com `vercel env ls` (nomes/targets, nunca valores).
2. **Conexão** — teste de conexão **antes** do merge: abrir a pool de runtime
   com a `DATABASE_URL_RUNTIME` derivada e rodar `SELECT 1`. Sem isso, o merge
   derruba a API (falha fechada por design).
3. **Merge** — PR próprio da branch `exp/arch-capacity-promotion`. O PR #3
   (`fix/aud03-migration-ledger`) segue **aberto e separado**, como combinado.
4. **Deploy** — pelo `workflow_dispatch` do contrato de deploy (PR #2): push em
   `master` só produz Preview; produção é manual e gatilhada.
5. **Validação pós-deploy** — smoke das rotas principais + 1 janela de 300
   requisições / concorrência 10 contra a produção, lendo `pmax`/`ctmo` pelo
   healthz autorizado e `emax`/`acqto` no log.
6. **Observação** — manter a bateria por 24 h antes de considerar a promoção
   concluída (ver §6).

## 4. Critérios de aceite e de abort

**Aceite** (todos obrigatórios):

- `GET /healthz` responde 200 com `db.status = "connected"` e `pmax = 2`;
- smoke das rotas de vitrine, carrinho, checkout e painel sem 5xx;
- janela de 300/conc 10 sem erro HTTP, sem `emax`, sem `acqto`, sem retry;
- p99 da janela de produção ≤ 2× o p99 da janela equivalente de validação
  (≈ 4 s) — a latência de produção inclui a rede real e o pooler real, então
  o critério é relativo, não absoluto.

**Abort** (qualquer um, imediatamente):

- qualquer 5xx em smoke ou na janela;
- `emax > 0` ou `acqto > 0` no log (recusa do pooler ou fila estourada);
- `db.status` ≠ `connected` no healthz;
- p99 > 2× o p99 da validação por 3 janelas seguidas.

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
| Branch de promoção | `exp/arch-capacity-promotion` @ `0cad0c1` |
| Base | `cb1d2ae` (head do PR #3, aberto e separado) |
| Commits de promoção | `d98a371` (pool-mode + trace v1) · `3f657ea` (inl/inpk) · `c9cd84b` (trace endurecido, 7 arquivos) · `0cad0c1` (config de deploy sem cap) |
| Runtime medido | `8dd9774` (branch `exp/arch-capacity-validation`) — byte-idêntico |
| Evidência da medição | `exp/arch-capacity-validation` @ `be7d9f7`, `docs/bench/capacidade/` (16 hashes do congelamento intactos) |
| Ferramental | `scripts/arch-*` em `be7d9f7` (commit da evidência); a bateria usou o cliente com TLS extraído desse commit — SHA-256 registrados em cada artefato |
| Artefatos da bateria | `docs/bench/promocao/0cad0c1-{fria,aquecida,distribuida,prolongada}-*.json` |
| Não realizados | push · merge · deploy de produção · alteração de env de produção · escrita no Supabase |
