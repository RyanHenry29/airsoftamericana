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
   `master` só produz Preview; produção é manual e gatilhada.
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
| Baseline | 3 janelas com o **mesmo** protocolo, medidas em produção **antes** de gravar `DB_POOL_MAX=2` (estado atual, `max=1`) |
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
