# Pedido de autorização operacional — promoção de `DB_POOL_MAX=2`

> **AUTORIZADO em 2026-11-25** (titular) para o escopo **A, B, D1, C, D2,
> observação de 24 h, D e R2**, com as condições obrigatórias: pré-condições
> 1–10 validadas antes de iniciar; sem presunção de credenciais pendentes;
> sem bootstrap/migrations sem a credencial DDL e autorização própria; sem
> gateway real nem processamento de pagamentos; sem ignorar falhas de
> segurança, schema, conectividade ou integridade; interrupção imediata em
> qualquer gate falho; sem retries, ajustes improvisados ou continuidade
> parcial após falha; registro de SHA, deployment IDs, resultados e evidências
> de cada etapa; sem ampliação de escopo; rastreabilidade e auditoria
> preservadas.
>
> **D1 e D2 são inegociavelmente distintas.** D1 (código novo + comprovação de
> tráfego no novo runtime) tem autorização própria, já concedida. D2
> (promoção para `pmax=2`) é **condicionado ao resultado favorável do item C**
> e não acontece por autorização prévia.
>
> A autorização **não substitui** a revogação manual do PAT (pré-condição 1)
> nem a obtenção de credenciais externas. Bootstrap continua bloqueado;
> `DATABASE_URL` → `sensitive` continua como autorização independente.
>
> **Execução de 2026-11-25: ABORT no gate de schema** (item B), antes do item A
> — produção intocada. Ver §8.
>
> **Decisão do titular (2026-11-25): ABORT MANTIDO.** O caminho B (desvio do
> gate) não foi autorizado; nenhuma autorização adicional foi concedida.
> Reconciliação de schema (caminho C) e PAT novo: ver §10.
>
> Referência técnica: `docs/PROMOCAO_CAPACIDADE.md` (checklist completo).
> *Histórico: este documento foi redigido como pedido; a autorização acima foi
> concedida depois, sem ampliar o escopo dos itens.*

## 1. Escopo pedido

| # | Item | O que exatamente será feito | O que fica de fora |
|---|---|---|---|
| **A** | Variáveis de produção | Gravar **duas** env vars no target `production` do projeto `prj_MLk5KPuaIh5shK0cNZum69oXpl13`: `DATABASE_URL_RUNTIME` (`:6543`, derivada da `DATABASE_URL` de produção) e `DB_TRACE_TOKEN` (valor novo, exclusivo). **`DB_POOL_MAX` fica de fora** — o default `1` é o que o baseline mede; `DB_POOL_MAX=2` só entra na promoção, após a decisão | `DB_POOL_MAX`; qualquer outra env var; `DATABASE_URL` permanece como está (a promoção para `sensitive` é autorização separada, §12 do checklist); nada em Preview; nada no Supabase |
| **B** | Teste de conexão + gate de schema | Rodar o harness (§11 do checklist) contra produção. O `:5432` entra **apenas como comparação de comportamento** (mesma credencial, outro modo de pinagem): a conexão de controle é **encerrada ao final** e o resultado é registrado **sem URL, sem senha e sem string de conexão**. Inclui a impressão digital do banco (fingerprint antes/depois) e o **diff de schema** (§2.9 do checklist) | Qualquer escrita no banco; qualquer SQL de escrita; teste de permissão de escrita; conexão com o papel DDL; reutilizar a conexão de controle para qualquer outra operação; deixar a conexão de controle aberta |
| **C** | Baseline | **3 janelas** de 300 requisições / concorrência 10 contra a API de produção **já em pmax=1** (pós-D1), intervalo ≥ 15 min entre elas, lendo `x-db-trace` com o token; cada janela com fingerprint do banco antes e depois | Mais de 3 janelas; concorrência acima de 10; qualquer alteração de código; qualquer carga de outro tipo; medir antes do D1 (sem trace não há sinal) |
| **D** | Encerramento do trace | Ao fim da janela de observação (24 h contadas do fim do **ciclo promovido**), **remover** `DB_TRACE_TOKEN` do target `production`, gerar o novo deploy que faz a remoção valer (**R2**) e registrar as duas confirmações (Vercel + runtime); os artefatos das janelas preservam os contadores já coletados | Manter o token além da janela; remover `DATABASE_URL_RUNTIME` ou `DB_POOL_MAX` (isso é rollback, §5 do checklist, exige decisão própria); qualquer outra env var |
| **R2** | Redeploy de encerramento | O redeploy que faz a remoção do token valer. Mesmo SHA do deployment em serviço no momento da remoção | Merge, alteração de código, bootstrap |

Ordem de execução: **A → B → D1 → verificação do D1 → C → decisão → D2 →
ciclo promovido → observação de 24 h → D → R2**. Se B falhar, o D1 não
acontece; se a verificação do D1 falhar, o item C não roda. D só roda depois
da observação — e é o que fecha o item de risco ALTO (token vivo em
produção).

### Ordem code-first — e a autorização de código que ela exige

Dois fatos verificados, que definem a sequência:

1. **env var só vale para deploy novo** ("Any change you make to environment
   variables are not applied to previous deployments, they only apply to new
   deployments") — por isso a remoção do token só se confirma depois de um
   novo deploy, e o comando de remoção sozinho não prova nada;
2. **o runtime em produção (`master` `5d6a978`) não lê as três variáveis** —
   não tem `x-db-trace`, ignora `DB_POOL_MAX` (pool dimensionado por constante
   `max: isTransactionPooler ? 1 : 5`), ignora `DATABASE_URL_RUNTIME` e o
   `/healthz` responde só `{status, timestamp}`.

Por isso **não existe redeploy do SHA atual** na sequência: ele seria inócuo
(§2.7 do checklist). O primeiro deployment que produz telemetria **é** o D1,
que já carrega o snapshot novo.

| Fase | Deployments | Natureza |
|---|---|---|
| Validação (até a decisão) | **1 — D1** | deploy de **código** (merge PR #3 → PR #4), com `DATABASE_URL_RUNTIME` + `DB_TRACE_TOKEN` e **sem** `DB_POOL_MAX` → pmax=1 |
| Promoção (se houver decisão de promover) | **+1 — D2** | redeploy de configuração com `DB_POOL_MAX=2` → pmax=2 |
| Encerramento do trace | **+1 — R2** | redeploy de configuração sem `DB_TRACE_TOKEN` → `trace_disabled` |

Até a decisão de capacidade: **1 deploy de código, zero redeploys**.

**O deploy de código é uma autorização diferente** desta: ele introduz 39
arquivos de runtime em produção e exige a credencial `DATABASE_URL_RUNTIME`
configurada antes (fail-closed), senão a API não sobe. Ele está **fora** do
escopo deste documento (§7) e da autorização A/B/C/D.

**Verificação obrigatória do D1** (sem todos esses campos, o item C não roda):

| Campo | Onde verificar |
|---|---|
| SHA esperado | `codigo.deployedCommit` do artefato × `meta.githubCommitSha` do deployment |
| Deployment ID | id do novo deployment (≠ o do deployment anterior) |
| Domínio de produção atendido pelo novo deployment | alias de produção aponta para ele |
| **Tráfego realmente chegando ao D1** | o alias resolve para o D1 **e** os `inst` observados no trace depois do deploy são **novos** (o `inst` é gerado por processo, com `randomBytes`) — um deployment criado com sucesso não garante, sozinho, que o tráfego chegue nele |
| `db.status` | `connected` no healthz autorizado |
| `pmax` | **1** — default observado no runtime, não inferido do código |
| `ctmo` | `10000` |
| Trace autorizado | `x-db-trace` emitido com o token; **verificação negativa**: token ausente ou incorreto não emite telemetria |

**Invariantes da comparação de capacidade** (D1 → D2): para que
`pmax=1` vs `pmax=2` signifique alguma coisa, o que muda é **só** o tamanho
do pool. O D2 tem de comprovar, no runtime:

| Invariante | Verificação |
|---|---|
| mesmo SHA de aplicação | `meta.githubCommitSha` idêntico em D1 e D2 |
| mesmo modo (Transaction Pooler, `:6543`) | `DATABASE_URL_RUNTIME` inalterada |
| mesmo endpoint e mesma rota | mesma URL de produção, `/api/store/home` |
| mesma carga | 300 requisições / concorrência 10 / intervalo ≥ 15 min |
| mesma instrumentação | mesmo token, mesmos headers, mesmo runner |
| **`pmax = 2` no runtime** | healthz autorizado — **não** basta ver `DB_POOL_MAX=2` no painel da Vercel |

**Gate de schema antes do D1**: o diff de schema (§2.9 do checklist) tem de
vir `compativel` contra o banco de produção. `schema.ts` byte-idêntico entre
`master` e a branch não prova que o banco tem as colunas que o código novo
consulta — e o contrato de deploy não roda migration, então o banco não se
corrige sozinho.

## 2. Pré-condições — verificadas antes de qualquer comando

| # | Pré-condição | Como verificar | Responsável |
|---|---|---|---|
| 1 | PAT do GitHub exposto **revogado** | `GET /user` com o token antigo → **401** | titular (painel) |
| 2 | Transaction mode habilitado no projeto de produção `psswdwsvybsqrflhpuqx` para o papel `airsoft_app` | print do painel do Supabase (Database → Connection Pooler) | titular (painel) |
| 3 | Backup do valor da `DATABASE_URL` de produção | `env pull` para arquivo temporário com ACL restrita | execução |
| 4 | `DB_TRACE_TOKEN` de produção gerado na máquina | `crypto.randomBytes(32).toString("base64url")` — nunca em argv, nunca impresso | execução |
| 5 | Janela de observação definida e registrada | **24 h contadas do encerramento bem-sucedido do ciclo promovido** (`T_fim_C` = `janela.finishedAt` do artefato) — a baseline de validação (pmax=1) não consome a janela; falhas, aborts e atrasos anteriores **não** consomem a janela; instante da remoção (`T_fim_C + 24 h`) anotado antes de começar | execução |
| 6 | Papel `airsoft_app` capaz de ler `information_schema` e `count(*)` nas tabelas do caminho da home | já provado em staging (2026-11-25): 8 tabelas lidas sem erro; em produção a leitura é repetida no primeiro fingerprint, e falha ali aborta a janela | execução |
| 7 | Variante do item C decidida — **baseline traced** (code-first) | decisão do titular, registrada antes do item A | titular |
| 8 | Ordem de deploy decidida — **code-first** (adotada) | decisão do titular; a ordem code-first exige autorização de **código** em separado | titular |
| 9 | **D1 executado e verificado** — deploy de código em produção com `DATABASE_URL_RUNTIME` + `DB_TRACE_TOKEN`, sem `DB_POOL_MAX` | autorização de código separada; verificação completa na tabela "Verificação obrigatória do D1" | titular |
| 10 | **Schema de produção compatível** | `arch-schema-diff.mjs` contra produção (leitura, papel `airsoft_app`) → `compativel`; método validado em staging (0 ausências, 0 sem privilégio) | execução |

Sem 1 e 2, os itens A–C não são executados. A pré-condição 5 é a que define
quando o item D acontece — sem ela, o token fica vivo sem prazo.

## 3. Execução

### Item A — variáveis

```powershell
cd apps/api
$envFile = "$env:LOCALAPPDATA\Temp\opencode\aa-prod-env.tmp"
$emit    = "$env:LOCALAPPDATA\Temp\opencode\aa-runtime-url.txt"

# fonte única: DATABASE_URL de produção (session mode), em claro
vercel env pull $envFile --environment production --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13

# deriva :6543 -> arquivo-fonte (ACL restrita, criação exclusiva, fora do repo)
node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-runtime-select1.mjs" `
  --env-file $envFile --var DATABASE_URL --derive --ports 6543 `
  --expect-ref psswdwsvybsqrflhpuqx --emit $emit

# grava na Vercel lendo o valor por stdin (nunca em argv)
cmd /c "type %LOCALAPPDATA%\Temp\opencode\aa-runtime-url.txt | vercel env add DATABASE_URL_RUNTIME production --sensitive --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13"

# token novo: gerado na maquina e gravado DIRETO em arquivo (nunca impresso,
# nunca em argv, nunca em variavel de ambiente de shell)
$tokenFile = "$env:LOCALAPPDATA\Temp\opencode\aa-trace-token-prod.txt"
node -e "const fs=require('fs'),crypto=require('crypto');fs.writeFileSync(process.argv[1],crypto.randomBytes(32).toString('base64url'),{encoding:'utf8',mode:0o600});" $tokenFile
cmd /c "type %LOCALAPPDATA%\Temp\opencode\aa-trace-token-prod.txt | vercel env add DB_TRACE_TOKEN production --sensitive --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13"

# DB_POOL_MAX NAO entra aqui: o baseline mede o default 1. A promocao (D2)
# grava DB_POOL_MAX=2 depois da decisao, com autorizacao propria.

# confirmação (nomes/targets/tipos; nunca valores)
vercel env ls --project prj_MLk5KPuaIh5shK0cNZum69oXpl13
```

O token segue no arquivo de ACL restrita (`aa-trace-token-prod.txt`) porque o
runner do item C o lê por `--token-file`; ele é apagado ao fim do ciclo.

### Item B — teste de conexão

```powershell
vercel env pull $envFile --environment production --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13

# fingerprint ANTES (marca d'agua T0 = inicio do procedimento)
$t0 = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-db-fingerprint.mjs" `
  --env-file $envFile --var DATABASE_URL --derive --since $t0 --out $fpA

node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-runtime-select1.mjs" `
  --env-file $envFile --var DATABASE_URL --derive --ports 6543,5432 `
  --expect-ref psswdwsvybsqrflhpuqx

# fingerprint DEPOIS
node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-db-fingerprint.mjs" `
  --env-file $envFile --var DATABASE_URL --derive --since $t0 --out $fpB
```

Veredito esperado: `6543` → cliente **não** preso ao backend (transaction) ·
controle `5432` → cliente **preso** (session) · `current_user = airsoft_app` ·
`BEGIN/SELECT 1/COMMIT` ok.

**O `:5432` é comparação de comportamento, não autorização para operar.** Ele
existe para provar que a diferença observada na porta `6543` é o modo de
pinagem do pooler e não um artefato do harness. Regras:

- a conexão de controle é encerrada com o pool (`pool.end()`) ao fim do teste —
  a saída registra `conexao encerrada: sim`, sem URL;
- o registro do controle fica em metadados (porta, papel, pinning, GUC,
  `LISTEN/NOTIFY`, temp table) — **nunca** a string de conexão, o host, o
  usuário completo ou a senha;
- o controle **não** é reutilizado para nenhuma outra operação, não vira pool
  persistente e não é deixado aberto para reuso;
- nenhuma operação de escrita é tentada em nenhuma das duas portas.

**Fingerprint (item B):** 2 leituras do banco (`information_schema` +
`count(*)`/marca d'água) em 8 tabelas — `banners`, `homepage_sections`,
`categories`, `brands`, `products`, `product_variants`, `orders`,
`order_items`. É leitura pura; nenhuma tabela de config deve aparecer com
alteração detectada.

**Gate de schema (item B):** antes do D1, o diff de schema (§2.9 do
checklist) compara as 57 tabelas / 497 colunas que o código espera com o
catálogo do banco de produção. É leitura pura, com o papel de runtime. Sem
veredito `compativel`, o deploy de código não deve acontecer — é o gate que
impede o D1 de derrubar a API por coluna faltando.

O veredito é de **existência de estrutura**, não de compatibilidade integral:
tipos e precisão, nullability e defaults, índices, constraints, foreign keys,
triggers/funções e compatibilidade semântica das consultas **não** são
verificados. É a primeira barreira antes do primeiro deploy de código — a
verificação semântica fica para a fase de bootstrap, com a credencial DDL.

**O fingerprint é detector de alterações, não prova criptográfica de
imutabilidade.** O que ele sustenta é "nenhuma alteração **detectada** no
estado final". O que ele **não** cobre: `UPDATE` que não toca `updated_at`;
substituição de conteúdo que preserva a cardinalidade; escrita seguida de
reversão (o detector compara estado final); e o caminho coberto por log de
auditoria/evento de escrita. Hash determinístico de conteúdo e leitura de
auditoria são **melhorias futuras, fora deste escopo** — não são executadas
nesta promoção.

### Item C — baseline

O mesmo runner usado na bateria de validação
(`%LOCALAPPDATA%\Temp\opencode\arch-tooling\arch-promotion-battery.mjs`),
apontando para a URL de produção, com o token de produção:

```powershell
# por janela: fingerprint antes -> janela -> fingerprint depois -> artefato
node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-db-fingerprint.mjs" `
  --env-file $envFile --var DATABASE_URL --derive --since $t0 --out $fpA

node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-promotion-battery.mjs" `
  --url https://<host-producao> --token-file <arquivo-do-token> `
  --label "baseline jan 1" --path /api/store/home --requests 300 --concurrency 10 `
  --output docs/bench/promocao/baseline-jan1-<stamp>.json `
  --deployed-commit <sha-producao> --deployment-id <deployment-id-producao> `
  --fingerprint-before $fpA --fingerprint-after $fpB

node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-db-fingerprint.mjs" `
  --env-file $envFile --var DATABASE_URL --derive --since $t0 --out $fpB

# repetir 2x com intervalo >= 15 min
```

`p99_baseline` = **mediana** dos p99 das três janelas (§4.1 do checklist).

Cada janela produz um artefato JSON com **todos** os campos exigidos para
auditar a decisão depois:

| Campo | Onde fica no artefato |
|---|---|
| Horário de início e fim | `janela.startedAt` / `janela.finishedAt` (+ `durationMs`) |
| Identificador da implantação | `codigo.deploymentId` |
| SHA do código executado | `codigo.deployedCommit` |
| 2xx e 5xx | `statuses."2xx"` / `statuses."5xx"` (+ `errorCount`) |
| p50, p95, p99 | `latencias.p50` / `.p95` / `.p99` (+ `p90`, `min`, `max`) |
| `emax`, `acqto`, retry | `trace.emaxRespostas` / `.acqtoRespostas` / `.retryRespostas` (+ máximos) |
| `db.status`, `pmax`, `ctmo` | `configEfetiva.status` / `.pmax` / `.ctmo` |
| Ausência de alterações no banco | `banco.semAlteracaoNoBanco` + `banco.tabelasAlteradas` — leitura correta do campo: **nenhuma alteração detectada no estado final**, não "prova de que nada foi escrito" (§15.1 do checklist) |
| Contexto | `rodada.carga`, `trace.instances`, `trace.inlMax` / `.inpkMax` |

Cruzamento obrigatório do SHA: `codigo.deployedCommit` e
`codigo.deploymentId` têm de concordar com o deployment real — conferível em
`vercel api /v13/deployments/<deploymentId>` → `meta.githubCommitSha`.

### Encerramento imediato (após o item C)

```powershell
node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-runtime-select1.mjs" --purge $emit
Remove-Item -Force $envFile
```

O token de produção vai para um arquivo temporário com ACL restrita, usado
apenas pelo runner, e apagado ao fim.

### Item D — encerramento do trace (24 h depois)

O `DB_TRACE_TOKEN` é uma credencial de diagnóstico **com janela**, não
configuração permanente. Ao fim da observação (24 h contadas do fim do
baseline), ele sai do target `production`:

```powershell
vercel env rm DB_TRACE_TOKEN production --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13

# (a) confirmação Vercel: a variável não está mais no target production
vercel env ls --project prj_MLk5KPuaIh5shK0cNZum69oXpl13

# (b) novo deploy para a remoção VALER (env var não reescreve o deployment vivo)
vercel redeploy <url-do-deployment-de-producao> --target production

# (c) confirmação de runtime: healthz sem trace, mesmo com o token antigo
#     esperado -> db.status = "trace_disabled" e nenhum header x-db-trace
```

A remoção só é efetiva no **próximo deploy** (§"Dependência de deploy").
Executar o `env rm` sozinho não prova que o ambiente deixou de disponibilizar
o token: até o redeploy, o deployment em serviço continua com ele e o trace
continua ativo. Por isso o item D exige **dois** níveis de confirmação — a
Vercel (a variável saiu do target) e o runtime (`trace_disabled` no healthz e
nenhum `x-db-trace` emitido, mesmo com o token antigo apresentado).

Efeito colateral aceito: **depois da remoção, `emax` e `acqto` deixam de ser
observáveis** — o trace falha fechada e o healthz volta a `trace_disabled`.
Por isso a janela de observação termina **antes** da remoção, e os artefatos
das três janelas já carregam os contadores. Rotação em caso de suspeita
(token vazado por transcript, log ou terminal): remover imediatamente,
recriar, refazer o baseline.

**Registro de ciclo de vida** (vai para a evidência):

| Evento | Instante (UTC, ISO-8601) | Registrado por |
|---|---|---|
| Criação do token (na máquina, nunca impresso) | `T_criacao` | execução |
| Ativação em `production` (gravado como Sensitive) | `T_ativacao` | execução |
| Fim bem-sucedido da janela 3 | `T_fim_C` (`janela.finishedAt` do artefato) | runner |
| Remoção do token + trace de volta a `trace_disabled` | `T_fim_C + 24 h` | execução |

Se o baseline não completar (abort, falha, atraso), a janela de 24 h **não
começa**: o token é removido e a execução recomeça do item A com um token
novo.

## 4. O que será tocado

| Recurso | Natureza | Reversibilidade |
|---|---|---|
| **2** env vars criadas no target `production` (`DATABASE_URL_RUNTIME`, `DB_TRACE_TOKEN`) + `DB_POOL_MAX` na promoção (D2) | criação | reversível (`vercel env rm`) |
| Conexões TCP ao pooler de produção (papel `airsoft_app`, `:6543` e `:5432`) | leitura | sem efeito de dados |
| Requisições `GET` à API de produção: 3 × 300 (baseline, item C) + 3 × 300 (ciclo promovido) + requisições de verificação do D1/D2/R2 | leitura | sem efeito de dados |
| Fingerprint do banco (2 leituras por janela: `information_schema` + `count(*)`/marca d'água em 8 tabelas) | leitura — detector de alterações, não prova de imutabilidade | sem efeito de dados |
| Remoção do `DB_TRACE_TOKEN` ao fim da observação (item D) | remoção | fecha o acesso de diagnóstico; o trace volta a falhar fechada |
| Artefatos de evidência em `docs/bench/promocao/` | escrita no repositório, **fora do runtime** | versionados para auditoria; sem segredo |
| Arquivos temporários com a URL derivada e o token | segredo operacional | apagados ao fim, ACL restrita, nunca dentro do repo |

**Não** toca: banco de produção (zero escrita), schema, DDL, `airsoft_ddl`,
código de runtime, Preview, painel do Supabase, `DATABASE_URL`, gateway e
pagamentos, DNS, qualquer outro projeto. O `master` recebe **apenas** o merge
autorizado (PR #3 → PR #4). `DATABASE_URL_RUNTIME` e `DB_POOL_MAX` permanecem
— removê-los é rollback, que exige decisão própria.

## 5. Abort — parar na hora, sem retry, sem ajuste de config

| Sinal | Ação |
|---|---|
| **qualquer 5xx na janela** | **abortar imediatamente**; parar a janela; investigar |
| **`emax > 0` ou `acqto > 0`** | **abortar imediatamente**; avaliar capacidade do pooler / fila do pool |
| **alteração detectada em tabela de config** | **abortar a janela**; auditar antes de seguir |
| conexão recusada / erro de autenticação no harness | parar; não repetir; reportar |
| `db.status` ≠ `connected` | parar imediatamente |
| `pmax` ≠ 1 na fase D1, ou ≠ 2 na fase D2, ou `ctmo` ≠ 10000 no healthz autorizado | parar; config divergiu |

Nenhum retry é introduzido para mascarar falha — o próprio runtime é medido
com o retry que ele tem.

## 6. Evidência a produzir

1. **Artefato por janela** em `docs/bench/promocao/` — mesmo formato da
   bateria, com **todos** os campos da tabela do item C: início/fim,
   `deploymentId`, SHA implantado, 2xx/5xx, `p50/p95/p99`,
   `emax`/`acqto`/`retry`, `db.status`/`pmax`/`ctmo` e o veredito
   `banco.semAlteracaoNoBanco` com `banco.tabelasAlteradas` — lido como
   **nenhuma alteração detectada no estado final**, não como prova de que
   nada foi escrito.
2. **Saída do harness** (§11.4/§11.5) — metadados do teste e do controle
   `:5432`, sem segredo, sem URL, sem senha, com o registro de conexão
   encerrada.
3. **`vercel env ls`** — nomes, targets e tipos das três variáveis — antes e
   depois do item D.
4. **Registro da pré-condição 2** — print do painel do Supabase.
5. **Registro do item D** — instante da remoção do `DB_TRACE_TOKEN`,
   confirmação da Vercel (variável fora do target `production`), id do novo
   deploy e a confirmação de runtime de que o trace voltou a falhar fechada
   (`db.status = "trace_disabled"`, nenhum `x-db-trace` emitido com o token
   antigo).
6. **Registro de ciclo de vida do token** — `T_criacao`, `T_ativacao`,
   `T_fim_C` e `T_remocao` (UTC, ISO-8601) com o responsável por cada
   evento.
7. **Registro dos redeploys (D1/D2/R2)** — id do novo deployment, SHA
   (tem de ser o mesmo do deployment em serviço no momento do redeploy),
   confirmação de que o novo deployment é o que atende o domínio de
   produção, confirmação de que o tráfego de diagnóstico chega a ele (via
   `inst` novos) e o estado do trace depois dele (`x-db-trace` presente e
   `pmax`/`ctmo` legíveis — em D1 com `pmax=1`, em D2 com `pmax=2`
   **observado no runtime**; em R2, `trace_disabled` e nenhum `x-db-trace`).
8. **Veredito do diff de schema** — `compativel` + contagens (esperado vs
   real), sem nomes de coluna de negócio além do necessário.

Nenhum artefato pode conter o token, a URL derivada ou a senha.

## 7. O que **não** está pedido (continua bloqueado)

- `DATABASE_URL` → `sensitive` em produção (autorização separada);
- bootstrap / `db:bootstrap` / credencial `airsoft_ddl`;
- gateway real, processamento de pagamentos e qualquer alteração de
  configuração de gateway;
- `DB_POOL_MAX` em Session Mode (nunca) e `DB_POOL_MAX` **antes** da decisão
  do item C;
- rollback (remoção de `DATABASE_URL_RUNTIME` / `DB_POOL_MAX`) — decisão
  própria;
- qualquer alteração do baseline `max=1` fora do target `production`;
- DNS, painel do Supabase e qualquer outro projeto;
- reconciliação de schema em produção (caminho C) — bloqueada até haver
  credencial `airsoft_ddl` **e** autorização específica para DDL (§10).

> **Suspenso pela decisão do titular (2026-11-25, ABORT mantido)**: merge do
> PR #3 → PR #4, o deploy de código D1, a promoção D2, a observação de 24 h, o
> item D e o R2. A autorização de 2026-11-25 existiu, mas **não foi exercida**:
> o gate de schema reprovou antes do item A e a sequência foi interrompida.
> Nada da promoção pode ser retomado sem um novo veredito `compativel` do gate
> de schema (§10, PEND-01).

## 8. Registro de execução — 2026-11-25 (ABORT no gate de schema)

Execução iniciada com a autorização de 2026-11-25 e **interrompida no gate de
schema (item B)**, antes do item A: **nenhuma variável gravada, nenhum merge,
nenhum deploy, zero escrita no banco de produção**.

| Marco | Instante (UTC) | Resultado |
|---|---|---|
| Início do procedimento (`T0`) | 2026-11-25T16:32:09.619Z | — |
| Gate 1 — modo do pooler (harness diferencial) | 2026-11-25T16:32:3x | **PASS** |
| Gate 2 — compatibilidade de schema (produção) | 2026-11-25T16:33:15.429Z | **FAIL — INCOMPATÍVEL** |
| Fingerprint antes | 2026-11-25T16:33:17.117Z | 0 tabelas de config alteradas |
| Fingerprint depois | 2026-11-25T16:37:54.756Z | 0 tabelas de config alteradas |

### Gate 1 — modo do pooler: PASS

O harness diferencial abriu as **duas portas do mesmo par** host/usuário/senha
de produção, com o papel `airsoft_app`:

| Porta | Pinning | Veredito |
|---|---|---|
| `:6543` | cliente **não** preso ao backend | comportamento de **transaction mode** |
| `:5432` (controle) | cliente **preso** | session mode |

`current_user = airsoft_app`, `BEGIN/SELECT 1/COMMIT` ok em ambas, **as duas
conexões encerradas** (`conexao encerrada: sim`). O file-fonte da URL
derivada foi emitido com ACL restrita e apagado ao fim.

**Pré-condição 2** (Transaction Mode): o titular **não confirmou** o estado do
painel do Supabase. O modo fica **verificado operacionalmente** pelo harness —
evidência comportamental mais forte que o toggle do painel — mas **sem o print
do painel**, que não entra no registro. Desvio declarado em relação à
pré-condição 2 (responsável: titular).

### Gate 2 — compatibilidade de schema: FAIL

Esperado pelo código: **57 tabelas / 497 colunas**. Banco de produção:
**55 tabelas / 479 colunas**.

| Objeto | Existe em produção |
|---|---|
| `customer_avatars` (tabela) | **não** |
| `password_resets` (tabela) | **não** |
| `system_locks` (tabela) | **não** |
| `order_status_history.actor_type` | **não** |
| `payments.not_found_first_seen_at` | **não** |
| `payment_events.attempts` | **não** |
| `payment_events.dead_letter` | **não** |
| `payment_events.last_attempt_at` | **não** |
| `payment_events.last_error` | **não** |
| `payment_events.lease_expires_at` | **não** |
| `payment_events.lease_token` | **não** |

`semPrivilegio: []` — não é falta de permissão: os objetos **não existem** no
catálogo. Confirmado por probe direto em `pg_catalog` (independente do
parser). A tabela extra `gateway_audit_status` é informativa.

**A lacuna é pré-existente no runtime que já está em produção.** Três
evidências:

1. `apps/api/src/db/schema.ts` é **byte-idêntico** entre `master` `5d6a978`
   (produção viva) e a branch de promoção — o master **já declara** os
   objetos ausentes;
2. o **conjunto de arquivos** que referencia os 10 símbolos é **idêntico** entre
   `master` e PR #3 — **zero** consumidor novo chega com o D1;
3. a rota medida (`apps/api/src/services/homepage.ts`, `/api/store/home`) não
   referencia **nenhum** dos objetos ausentes.

Ou seja: o banco de produção está atrás do schema que o código já publicado
declara — porque migrations/bootstrap **nunca rodaram** em produção (§8 do
checklist; bootstrap bloqueado, credencial `airsoft_ddl` ausente). O D1 não
introduz a lacuna: ele a encontra.

**Ainda assim o gate aborta a sequência.** A regra documentada é binária ("sem
veredito `compativel`, o deploy de código não deve acontecer") e o veredito
foi `INCOMPATÍVEL`. Reconciliar o schema exige `airsoft_ddl` + autorização de
bootstrap — explicitamente **fora** do escopo autorizado e bloqueado. A
sequência fica parada aguardando decisão do titular.

### Estado deixado

| Item | Estado |
|---|---|
| `production` (Vercel) | **intocada** — `DATABASE_URL` (16 d) como estava; `DATABASE_URL_RUNTIME`, `DB_TRACE_TOKEN` e `DB_POOL_MAX` continuam **só no Preview** |
| Banco de produção | **zero escrita** — fingerprint antes/depois: 0 tabelas de config alteradas |
| Git | `exp/arch-capacity-promotion` @ `3c702d3`; PR #3 e PR #4 **abertos**, HEAD intocado |
| Deployments | **nenhum** — nenhum id, nenhum SHA de deploy |
| Segredos temporários | `aa-prod-env.tmp` e `aa-runtime-url.txt` **apagados** |
| Evidência | `docs/bench/promocao/abort-20261125-*.json` (gate de schema + fingerprint antes/depois) |

Nenhum item da autorização foi executado além do gate; **o item A nem chegou
a começar** — o gate de leitura roda antes de qualquer escrita em produção,
então não há resíduo de configuração para reverter.



### Decisão do titular — ABORT mantido (2026-11-25)

O Gate 2 de schema **permanece REPROVADO**. O caminho B (prosseguir com o
desvio declarado) **não** foi autorizado, e nenhuma autorização adicional foi
concedida. Diretrizes registradas:

1. não executar D1 nem D2;
2. não fazer merge dos PRs #3 e PR #4;
3. não executar deploy, bootstrap, migrations ou DDL em produção;
4. não alterar variáveis de ambiente de produção;
5. não realizar escrita no Supabase;
6. preservar as evidências do abort (fingerprint, diff de schema, hashes,
   relatórios);
7. manter a incompatibilidade de schema registrada como pendência de produção;
8. preparar a reconciliação pelo caminho C **somente** quando houver
   credencial `airsoft_ddl` e autorização específica para DDL;
9. não alterar o baseline nem iniciar novos experimentos de capacidade;
10. tratar o PAT novo informado no transcript como exposto e solicitar a
    revogação manual.

**Evidência preservada** (commit `3e3188d`, `docs/bench/promocao/`):

| Arquivo | SHA-256 |
|---|---|
| `abort-20261125-gate-schema-prod.json` | `c4676175e627d48a833543b53723234d8b298c0c3914a50737fd83e9e2d5f93d` |
| `abort-20261125-fingerprint-antes.json` | `be433ff18de50815c73e1710c68f2b5e6686990fe6ca7aa7533b2c6af0db31ae` |
| `abort-20261125-fingerprint-depois.json` | `c3a89696d21e093b0e092b943d01bcb2bc7d3993a0608eeb8e195ecfa9443965` |

**Estado verificado no fechamento**: `production` com `DATABASE_URL` (16 d)
como estava e as três variáveis **só no Preview**; banco sem escrita
(fingerprint antes/depois com 0 tabelas de config alteradas); `master`
intocado (`5d6a978`); PR #3 e PR #4 abertos; **nenhum deployment criado** e
nenhum `workflow_dispatch` de produção disparado (os runs existentes são só
`api-gates` de push/PR); working tree limpa em `3e3188d`.

## 9. Decisão após a execução

A promoção **não** é automática ao fim de A–C. Com a evidência em mãos
(harness validado, três janelas de baseline, sinais de pooler), a decisão é
uma de três:

| Resultado | Decisão |
|---|---|
| harness valida `:6543` como transaction **e** baseline sem erro/ `emax` / `acqto` | **D1 autorizado**: merge PR #3 → PR #4 + deploy de código; depois a decisão do titular sobre o D2; item D encerra o trace ao fim da observação |
| harness valida, mas baseline mostra `emax`/`acqto`/5xx | **não** promover; investigar capacidade do pooler antes de qualquer merge |
| harness falha (autenticação, modo, porta) | **não** promover; corrigir credencial ou derivação e reexecutar só o item B |

> Merge verde **não** é critério de promoção. O critério é a compatibilidade
> comprovada entre o runtime e a configuração real de produção, com os
> bloqueios de schema e ambiente resolvidos.

## 10. Pendências de produção (abertas após o abort)

### PEND-01 — Incompatibilidade de schema em produção (bloqueia D1)

**Estado**: gate de schema **REPROVADO** em 2026-11-25 (§8). Registrada como
pendência de produção. A incompatibilidade é **pré-existente** no runtime já
publicado — `schema.ts` byte-idêntico entre `master` `5d6a978` e a branch de
promoção, conjuntos de arquivos que referenciam os objetos idênticos entre
master e PR #3, rota medida sem referência a eles — e **não** é introduzida
pelo D1.

**11 objetos ausentes** no catálogo de produção (confirmado por probe direto
em `pg_catalog`, independente do parser): tabelas `customer_avatars`,
`password_resets`, `system_locks`; colunas `order_status_history.actor_type`,
`payments.not_found_first_seen_at` e `payment_events.{attempts, dead_letter,
last_attempt_at, last_error, lease_expires_at, lease_token}`.

**Efeito atual**: as rotas que consultam esses objetos (payments, antifraude,
admin) operam degradadas — o boot captura a falha de `system_locks` e registra
`"payment event recovery skipped"`, e a API sobe. Comportamento **idêntico** ao
do master em produção hoje. Não afeta a rota medida `/api/store/home`, o
trace, o dimensionamento do pool nem o contrato de deploy (sem migration no
build).

**Caminho de correção — C (atividade independente, fora do escopo da promoção
de capacidade)**:

1. credencial `airsoft_ddl` disponível (hoje **ausente**);
2. autorização **específica** para DDL em produção;
3. revisão do ledger de migrations (PR #3): checksum, advisory lock, recuperação;
4. validação das migrations contra o schema real de produção (55 tabelas /
   479 colunas);
5. execução com o ledger ativo, com evidência por objeto criado;
6. **reexecução do gate de schema** (`arch-schema-diff.mjs`) contra produção.

**Condição de reabertura**: somente com veredito `compativel` no passo 6 a
sequência de promoção de capacidade pode ser **reconsiderada**. Nada dela foi
executado — o item A nem chegou a começar.

### PEND-02 — PAT novo do GitHub (exposto no transcript)

**Estado**: tratado como **exposto**. A credencial informada no transcript da
sessão de 2026-11-25 foi gravada no keyring do Windows sem passar por argv,
arquivo ou log (`git credential approve`, entrada host-scoped
`gh:github.com:`), e a cópia local foi removida no mesmo dia
(`cmdkey /delete`) — **0 cópias do PAT na máquina**. A validação da credencial
(via `GET /user`) não expôs o valor em nenhuma saída: só o login e o
comprimento.

**Verificação da remoção** (2026-11-25): store do Git Credential Manager para
`github.com` **vazio**; chaveiro com uma única entrada GitHub
(`gh:github.com:RyanHenry29` — o token OAuth `gho_`); `git credential fill`
resolve `gho_`; `git ls-remote` e `gh api user` operacionais; nenhum arquivo
do repositório, do temp de trabalho ou do `git config` contém o prefixo do PAT
(a única ocorrência no repo é a menção ao formato `github_pat_*` em
`docs/PROMOCAO_CAPACIDADE.md`).

**Ação pendente (titular)**: revogação manual em GitHub → Settings →
Developer settings → Personal access tokens. Enquanto o PAT não for revogado,
`gh` e o git continuam autenticando pelo token OAuth (`gho_`) do keyring — a
operação da campanha não depende do PAT.

### PEND-03 — `DATABASE_URL` → `sensitive` em produção

Continua como **autorização independente** (não concedida). Sem relação com o
abort: a variável de produção segue Non-sensitive desde a sua criação.
