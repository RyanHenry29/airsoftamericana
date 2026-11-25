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
| **B** | Teste de conexão | Rodar o harness (§11 do checklist) contra produção, com controle `:5432` da mesma credencial | Qualquer escrita no banco; qualquer SQL de escrita; teste de permissão de escrita; conexão com o papel DDL |
| **C** | Baseline | **3 janelas** de 300 requisições / concorrência 10 contra a API de produção, intervalo ≥ 15 min entre elas, lendo `x-db-trace` com o token | Mais de 3 janelas; concorrência acima de 10; qualquer alteração de código; qualquer carga de outro tipo |

Ordem de execução: **A → B → C**. Se B falhar, C não roda.

## 2. Pré-condições — verificadas antes de qualquer comando

| # | Pré-condição | Como verificar | Responsável |
|---|---|---|---|
| 1 | PAT do GitHub exposto **revogado** | `GET /user` com o token antigo → **401** | titular (painel) |
| 2 | Transaction mode habilitado no projeto de produção `psswdwsvybsqrflhpuqx` para o papel `airsoft_app` | print do painel do Supabase (Database → Connection Pooler) | titular (painel) |
| 3 | Backup do valor da `DATABASE_URL` de produção | `env pull` para arquivo temporário com ACL restrita | execução |
| 4 | `DB_TRACE_TOKEN` de produção gerado na máquina | `crypto.randomBytes(32).toString("base64url")` — nunca em argv, nunca impresso | execução |

Sem 1 e 2, os itens A–C não são executados.

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
node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-runtime-select1.mjs" `
  --env-file $envFile --var DATABASE_URL --derive --ports 6543,5432 `
  --expect-ref psswdwsvybsqrflhpuqx
```

Veredito esperado: `6543` → cliente **não** preso ao backend (transaction) ·
controle `5432` → cliente **preso** (session) · `current_user = airsoft_app` ·
`BEGIN/SELECT 1/COMMIT` ok.

### Item C — baseline

O mesmo runner usado na bateria de validação
(`%LOCALAPPDATA%\Temp\opencode\arch-tooling\arch-promotion-battery.mjs`),
apontando para a URL de produção, com o token de produção:

```powershell
node "$env:LOCALAPPDATA%\Temp\opencode\arch-tooling\arch-promotion-battery.mjs" `
  --url https://<host-producao> --token-file <arquivo-do-token> `
  --label "baseline jan 1" --path /api/store/home --requests 300 --concurrency 10 `
  --output docs/bench/promocao/baseline-jan1-<stamp>.json --deployed-commit <sha-producao>
# repetir 2x com intervalo >= 15 min
```

`p99_baseline` = **mediana** dos p99 das três janelas (§4.1 do checklist).

### Encerramento

```powershell
node "$env:LOCALAPPDATA\Temp\opencode\arch-tooling\arch-runtime-select1.mjs" --purge $emit
Remove-Item -Force $envFile
```

O token de produção vai para um arquivo temporário com ACL restrita, usado
apenas pelo runner, e apagado no fim.

## 4. O que será tocado

| Recurso | Natureza | Reversibilidade |
|---|---|---|
| 3 env vars no target `production` | criação | reversível (`vercel env rm`) |
| Conexões TCP ao pooler de produção (papel `airsoft_app`, `:6543` e `:5432`) | leitura | sem efeito de dados |
| 900 requisições `GET` à API de produção (3 × 300) | leitura | sem efeito de dados |
| Arquivos temporários com a URL derivada | segredo operacional | apagados ao fim, ACL restrita, nunca dentro do repo |

**Não** toca: banco de produção (zero escrita), schema, DDL, `airsoft_ddl`,
código, repositório, `master`, PR #3, PR #4, deploy, Preview, painel do
Supabase.

## 5. Abort — parar na hora, sem retry, sem ajuste de config

| Sinal | Ação |
|---|---|
| conexão recusada / erro de autenticação no harness | parar; não repetir; reportar |
| `emax > 0` | parar; avaliar capacidade do pooler |
| `acqto > 0` | parar; avaliar fila do pool |
| qualquer 5xx na janela | parar a janela; investigar |
| `db.status` ≠ `connected` | parar imediatamente |
| `pmax` ≠ 2 ou `ctmo` ≠ 10000 no healthz autorizado | parar; config divergiu |

Nenhum retry é introduzido para mascarar falha — o próprio runtime é medido
com o retry que ele tem.

## 6. Evidência a produzir

1. **Artefato por janela** em `docs/bench/promocao/` — mesmo formato da
   bateria: commit implantado, config efetiva (`pmax`, `ctmo`), janela de
   tempo, `p50/p95/p99`, contagem por status, `inl`/`inpk`, instâncias,
   `emax`/`acqto`/`retry`.
2. **Saída do harness** (§11.4/§11.5) — sem segredo, sem URL, sem senha.
3. **`vercel env ls`** — nomes, targets e tipos das três variáveis.
4. **Registro da pré-condição 2** — print do painel do Supabase.

Nenhum artefato pode conter o token, a URL derivada ou a senha.

## 7. O que **não** está pedido (continua bloqueado)

- `DATABASE_URL` → `sensitive` em produção (autorização separada);
- bootstrap / `db:bootstrap` / credencial `airsoft_ddl`;
- merge do PR #3 ou do PR #4;
- deploy de produção;
- `DB_POOL_MAX` em Session Mode (nunca);
- qualquer alteração do baseline `max=1` fora do target `production`.

## 8. Decisão após a execução

A promoção **não** é automática ao fim de A–C. Com a evidência em mãos
(harness validado, três janelas de baseline, sinais de pooler), a decisão é
uma de três:

| Resultado | Decisão |
|---|---|
| harness valida `:6543` como transaction **e** baseline sem erro/ `emax` / `acqto` | seguir para o portão de merge (PR #3 → PR #4), ainda com autorização própria |
| harness valida, mas baseline mostra `emax`/`acqto`/5xx | **não** promover; investigar capacidade do pooler antes de qualquer merge |
| harness falha (autenticação, modo, porta) | **não** promover; corrigir credencial ou derivação e reexecutar só o item B |

> Merge verde **não** é critério de promoção. O critério é a compatibilidade
> comprovada entre o runtime e a configuração real de produção, com os
> bloqueios de schema e ambiente resolvidos.
