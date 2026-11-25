# Pedido de autorização operacional — promoção de `DB_POOL_MAX=2`

> **Nada neste documento está autorizado.** É a formalização do escopo que
> precisa ser aprovado item a item, para que a execução em produção não dependa
> de interpretação. Cada item tem escopo fechado, o que toca, o que não toca,
> o que aborta e a evidência que produz.
>
> Referência técnica: `docs/PROMOCAO_CAPACIDADE.md` (checklist completo).
> Decisão vigente: **produção congelada**; PR #3 e PR #4 abertos; bootstrap
> bloqueado.

## 1. Escopo pedido

| # | Item | O que exatamente será feito | O que fica de fora |
|---|---|---|---|
| **A** | Variáveis de produção | Gravar **três** env vars no target `production` do projeto `prj_MLk5KPuaIh5shK0cNZum69oXpl13`: `DATABASE_URL_RUNTIME` (`:6543`, derivada da `DATABASE_URL` de produção), `DB_POOL_MAX=2` e `DB_TRACE_TOKEN` (valor novo, exclusivo) | Qualquer outra env var; `DATABASE_URL` permanece como está (a promoção para `sensitive` é autorização separada, §12 do checklist); nada em Preview; nada no Supabase |
| **B** | Teste de conexão | Rodar o harness (§11 do checklist) contra produção. O `:5432` entra **apenas como comparação de comportamento** (mesma credencial, outro modo de pinagem): a conexão de controle é **encerrada ao final** e o resultado é registrado **sem URL, sem senha e sem string de conexão**. Inclui a impressão digital do banco (fingerprint antes/depois) | Qualquer escrita no banco; qualquer SQL de escrita; teste de permissão de escrita; conexão com o papel DDL; reutilizar a conexão de controle para qualquer outra operação; deixar a conexão de controle aberta |
| **C** | Baseline | **3 janelas** de 300 requisições / concorrência 10 contra a API de produção, intervalo ≥ 15 min entre elas, lendo `x-db-trace` com o token **na variante C-traced** (§"Dependência de deploy"); cada janela com fingerprint do banco antes e depois | Mais de 3 janelas; concorrência acima de 10; qualquer alteração de código; qualquer carga de outro tipo |
| **D** | Encerramento do trace | Ao fim da janela de observação (24 h), **remover** `DB_TRACE_TOKEN` do target `production`, gerar o novo deploy que faz a remoção valer (**R2**) e registrar as duas confirmações (Vercel + runtime); os artefatos das janelas preservam os contadores já coletados | Manter o token além da janela; remover `DATABASE_URL_RUNTIME` ou `DB_POOL_MAX` (isso é rollback, §5 do checklist, exige decisão própria); qualquer outra env var |
| **R1** | Primeiro redeploy | Um redeploy que aplica o snapshot novo das env vars. **Com o código de produção atual, ele é inócuo** (§"Dependência de deploy"): por isso o R1 só produz telemetria se o deployment carregar o **código** da linha de promoção — o que é deploy de código, fora deste escopo | Merge do PR #3 ou do PR #4; qualquer alteração de código; qualquer carga |
| **R2** | Segundo redeploy | O redeploy que faz a remoção do token valer, depois da observação. Mesmo SHA do deployment em serviço no momento da remoção | Merge, alteração de código, bootstrap |

Ordem de execução: **A → B → C → D**. Se B falhar, C não roda. D só roda
depois da observação — e é o que fecha o item de risco ALTO (token vivo em
produção).

### Dependência de deploy — e de código — decisão pendente do titular

A Vercel só aplica mudança de env var em **deploy novo** ("Any change you
make to environment variables are not applied to previous deployments, they
only apply to new deployments"). E há um segundo fato, verificado no código:
**o runtime em produção (`master` `5d6a978`) não lê as três variáveis** — ele
não tem `x-db-trace`, ignora `DB_POOL_MAX` (pool dimensionado por constante
`max: isTransactionPooler ? 1 : 5`), ignora `DATABASE_URL_RUNTIME` e o
`/healthz` responde só `{status, timestamp}`.

Duas consequências, com o mesmo antídoto — um **redeploy do mesmo SHA**, sem
merge e sem mudança de código (`vercel redeploy <url> --target production`):

| Efeito | Sem o deploy novo |
|---|---|
| **Item C** — baseline de produção | a API em serviço não emite `x-db-trace`: a baseline mede latência e status e fica **cega** para `emax`, `acqto`, `retry`, `pmax` e `ctmo` (3 dos 5 critérios de abort) |
| **Item D** — remoção do token | a variável sai do target, mas o deployment em serviço **continua com o token** e o trace continua ativo |

E o limite do antídoto: **redeploy do SHA atual não resolve o item C**, porque
o código antigo ignora as três variáveis — o redeploy seria inócuo. Para a
baseline traced, o deployment precisa carregar o **código** da linha de
promoção (§2.7/§2.8 do checklist). Isso é **deploy de código**, hoje fora do
escopo (§7), e ele traz a obrigação de `DATABASE_URL_RUNTIME` (fail-closed
em produção).

Duas ordens possíveis, e a escolha é do titular:

| Ordem | Baseline | Deploys | Autorização que exige |
|---|---|---|---|
| **1 — code-first** | **traced** em max=1/transaction (mesmo código, mesmo modo, muda só o pool 1→2) | 1 deploy de código + 2 redeploys | **código** (merge PR #3 → PR #4 + deploy) |
| **2 — config-first** | **untraced** (latência, status, 2xx/5xx) — os sinais internos do pooler só ficam observáveis no pós-promoção, e isso entra na evidência como limitação | 1 redeploy inócuo + 1 deploy de código + 1 redeploy | **código** + um redeploy que não muda comportamento |

Até a decisão, os itens A/B/C/D **não** são executados.

## 2. Pré-condições — verificadas antes de qualquer comando

| # | Pré-condição | Como verificar | Responsável |
|---|---|---|---|
| 1 | PAT do GitHub exposto **revogado** | `GET /user` com o token antigo → **401** | titular (painel) |
| 2 | Transaction mode habilitado no projeto de produção `psswdwsvybsqrflhpuqx` para o papel `airsoft_app` | print do painel do Supabase (Database → Connection Pooler) | titular (painel) |
| 3 | Backup do valor da `DATABASE_URL` de produção | `env pull` para arquivo temporário com ACL restrita | execução |
| 4 | `DB_TRACE_TOKEN` de produção gerado na máquina | `crypto.randomBytes(32).toString("base64url")` — nunca em argv, nunca impresso | execução |
| 5 | Janela de observação definida e registrada | **24 h contadas do encerramento bem-sucedido da janela 3** (`T_fim_C` = `janela.finishedAt` do artefato) — falhas, aborts e atrasos anteriores **não** consomem a janela; instante da remoção (`T_fim_C + 24 h`) anotado antes de começar | execução |
| 6 | Papel `airsoft_app` capaz de ler `information_schema` e `count(*)` nas tabelas do caminho da home | já provado em staging (2026-11-25): 8 tabelas lidas sem erro; em produção a leitura é repetida no primeiro fingerprint, e falha ali aborta a janela | execução |
| 7 | Variante do item C decidida — **C-traced** (redeploy de configuração autorizado) ou **C-untraced** (baseline sem trace) | decisão do titular, registrada antes do item A | titular |
| 8 | Ordem de deploy decidida — **1 (code-first)** ou **2 (config-first)** | decisão do titular, registrada antes do item A; a ordem 1 exige autorização de **código** em separado | titular |

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
cmd /c "echo 2| vercel env add DB_POOL_MAX production --sensitive --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13"
cmd /c "echo %DB_TRACE_TOKEN_PROD%| vercel env add DB_TRACE_TOKEN production --sensitive --yes --project prj_MLk5KPuaIh5shK0cNZum69oXpl13"

# confirmação (nomes/targets/tipos; nunca valores)
vercel env ls --project prj_MLk5KPuaIh5shK0cNZum69oXpl13
```

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
| 3 env vars no target `production` | criação | reversível (`vercel env rm`) |
| Conexões TCP ao pooler de produção (papel `airsoft_app`, `:6543` e `:5432`) | leitura | sem efeito de dados |
| 900 requisições `GET` à API de produção (3 × 300) | leitura | sem efeito de dados |
| Fingerprint do banco (2 leituras por janela: `information_schema` + `count(*)`/marca d'água em 8 tabelas) | leitura — detector de alterações, não prova de imutabilidade | sem efeito de dados |
| Remoção do `DB_TRACE_TOKEN` ao fim da observação (item D) | remoção | fecha o acesso de diagnóstico; o trace volta a falhar fechada |
| Arquivos temporários com a URL derivada | segredo operacional | apagados ao fim, ACL restrita, nunca dentro do repo |

**Não** toca: banco de produção (zero escrita), schema, DDL, `airsoft_ddl`,
código, repositório, `master`, PR #3, PR #4, deploy, Preview, painel do
Supabase, `DATABASE_URL`, `DATABASE_URL_RUNTIME` e `DB_POOL_MAX` (esses dois
permanecem — removê-los é rollback, que exige decisão própria).

## 5. Abort — parar na hora, sem retry, sem ajuste de config

| Sinal | Ação |
|---|---|
| **qualquer 5xx na janela** | **abortar imediatamente**; parar a janela; investigar |
| **`emax > 0` ou `acqto > 0`** | **abortar imediatamente**; avaliar capacidade do pooler / fila do pool |
| **alteração detectada em tabela de config** | **abortar a janela**; auditar antes de seguir |
| conexão recusada / erro de autenticação no harness | parar; não repetir; reportar |
| `db.status` ≠ `connected` | parar imediatamente |
| `pmax` ≠ 2 ou `ctmo` ≠ 10000 no healthz autorizado | parar; config divergiu |

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
7. **Registro dos redeploys (R1/R2)** — id do novo deployment, SHA
   (tem de ser o mesmo do deployment em serviço no momento do redeploy),
   confirmação de que o novo deployment é o que atende o domínio de
   produção e o estado do trace depois dele (`x-db-trace` presente e
   `pmax`/`ctmo` legíveis, em R1; `trace_disabled` e nenhum `x-db-trace`, em
   R2).

Nenhum artefato pode conter o token, a URL derivada ou a senha.

## 7. O que **não** está pedido (continua bloqueado)

- `DATABASE_URL` → `sensitive` em produção (autorização separada);
- bootstrap / `db:bootstrap` / credencial `airsoft_ddl`;
- merge do PR #3 ou do PR #4;
- deploy de produção — **inclusive** os dois redeploys (R1 e R2) e o redeploy
  de configuração que a traced baseline e a efetividade da remoção do token
  exigem (§"Dependência de deploy"): e, no caso da ordem 1, o **deploy de
  código** (merge PR #3 → PR #4) que é o que produz a telemetria — são
  decisões separadas, nenhuma delas autorizada aqui;
- `DB_POOL_MAX` em Session Mode (nunca);
- rollback (remoção de `DATABASE_URL_RUNTIME` / `DB_POOL_MAX`) — decisão
  própria;
- qualquer alteração do baseline `max=1` fora do target `production`.

## 8. Decisão após a execução

A promoção **não** é automática ao fim de A–C. Com a evidência em mãos
(harness validado, três janelas de baseline, sinais de pooler), a decisão é
uma de três:

| Resultado | Decisão |
|---|---|
| harness valida `:6543` como transaction **e** baseline sem erro/ `emax` / `acqto` | seguir para o portão de merge (PR #3 → PR #4), ainda com autorização própria; item D encerra o trace ao fim da observação |
| harness valida, mas baseline mostra `emax`/`acqto`/5xx | **não** promover; investigar capacidade do pooler antes de qualquer merge |
| harness falha (autenticação, modo, porta) | **não** promover; corrigir credencial ou derivação e reexecutar só o item B |

> Merge verde **não** é critério de promoção. O critério é a compatibilidade
> comprovada entre o runtime e a configuração real de produção, com os
> bloqueios de schema e ambiente resolvidos.
