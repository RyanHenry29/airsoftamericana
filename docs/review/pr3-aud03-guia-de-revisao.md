# PR #3 — AUD-03: Ledger de migrations (checksum, advisory lock, recuperação)

Branch: `fix/aud03-migration-ledger` (base `origin/master` = `5d6a978`)
Commit: `0c30301` (base) → `2381938` (fix do conversor sql.raw) → `HEAD` (fixes pós-revisão)
Diff completo: `docs/review/pr3-aud03-full.diff` (5.118 linhas)

## Escopo

Converte o blob idempotente de migrations (228 statements, zero interpolação)
em **30 passos nomeados** (`MigrationStep[]`: 28 SQL + 2 de código) executados
por um motor coordenado. Assinatura `migrate(db)` preservada — todos os ~30
chamadores (boot, seed, CLIs, testes) continuam válidos.

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `apps/api/src/db/migrate.ts` | Blob → passos nomeados; SQL byte a byte (conversor one-shot, guarda de completude 228/228) |
| `apps/api/src/db/migration-ledger.ts` | **Novo** — motor: ledger, checksum, locks, recuperação |
| `apps/api/src/db/migration-ledger.test.ts` | **Novo** — 7 testes do ledger |
| `apps/api/src/db/index.ts` | `getMigrationSession()` + `poolInstanceExists()` — sessão dedicada (só com pool), unlock safe |
| `apps/api/src/services/payments-integrity.test.ts` | 2 testes de migrate adaptados à era do ledger |
| `scripts/pg-integration.mjs` | Gate inclui `migration-ledger.test.ts`; registra `SHOW server_version` |
| `scripts/build-migration-steps.mjs` | **Novo** — conversor one-shot (guarda de completude 228/228) |

## Garantias do motor

1. **Checksum sha256 por passo** (deriva de nome + revision + statements + run.toString()):
   divergência código↔ledger recusa o boot (`MigrationChecksumError`) —
   tamper-evident. **Inclui passos de código**.
2. **Advisory lock** `pg_try_advisory_lock(723401723)`, polling 400ms, deadline
   120s (`MigrationLockTimeoutError`) — coordenação entre INSTÂNCIAS no
   Postgres, sempre em sessão dedicada (cliente exclusivo do pool).
3. **Mutex em-processo** (`migrationChain`) — dois runs no mesmo processo
   executam em série; necessário porque o advisory lock é reentrante por
   sessão (PGlite é sessão única).
4. **Ledger** `migration_ledger`: PK `step_name`, checksum, status
   `aplicada`/`in_progress`/`interrrompida`, instância, erro. DDL do passo e
   marcação "aplicada" na MESMA transação — crash no meio = rollback completo
   + linha `in_progress` sobrevivente.
5. **Recuperação com validação de checksum**: passo `in_progress`/`interrrompida`
   de run anterior é re-executado SOMENTE se o checksum corresponder; se
   divergir, recusa com `MigrationChecksumError` (decisão humana obrigatória).
   A trilha de erro sobrevive no upsert (`CASE WHEN "error" IS NOT NULL
   THEN ... || ' | recuperado em novo run'`) e o UPDATE final de "aplicada"
   NÃO zera `"error"`.
6. **nonIdempotent**: passo marcado assim recusa re-execução automática
   (`MigrationNonIdempotentError`) — decisão humana obrigatória.
7. **Sessão dedicada + unlock seguro**: se `pg_advisory_unlock` falhar, a
   conexão é DESCARTADA (não devolvida ao pool), evitando contaminação do pool.

## Decisão crítica: `getMigrationSession()` — sem fallback silencioso

**Problema anterior**: `getMigrationSession()` capturava QUALQUER erro e
fallbackava para o `db` do módulo. Se `poolInstance.connect()` falhasse
(indisponibilidade, esgotamento), o motor usaria o `db` genérico,
**perdendo a garantia de sessão única** e quebrando o advisory lock.

**Correção**: `getMigrationSession()` lança se não há pool OU se falhar ao
obter a conexão dedicada. Sem pool (PGlite), o caller usa seu `db` (tx-aware).
Com pool, **exige** a sessão dedicada — falha de conexão propaga e interrompe
as migrations. Não há fallback que silencie a perda de coordenação.

## `releaseAdvisoryLock` — descarta conexão se unlock falhar

**Problema anterior**: erro no unlock era ignorado; conexão voltava ao pool
ainda com o lock de sessão ativo.

**Correção**: `releaseAdvisoryLock` retorna `boolean` (`true` = unlock
confirmado, `false` = falhou). No `finally` de `runMigrationStepsExclusive`:
se `lockOk === false`, a sessão é marcada `lockFailed = true` e o
`release()` da sessão **descarta a conexão** (`client.end()`) em vez de
`client.release()`. Pool não recebe conexão possivelmente contaminada.

## Checksum de passos de código — inclui `run.toString()`

**Problema anterior**: `step.run` não entrava no checksum; alteração na
implementação sem bump de revisão passava despercebida.

**Correção**: `computeStepChecksum` serializa `runSource: step.run?.toString() ?? null`.
Alteração no corpo da função muda o checksum. Para passos de código, a
revisão explícita (`revision`) continua obrigatória e recomendada; o
checksum agora detecta mudanças não declaradas.

## Validação de checksum ANTES da recuperação

**Problema anterior**: checksum era validado só para status `aplicada`.
`in_progress`/`interrrompida` com checksum divergente eram aceitos e o
checksum antigo era substituído pelo novo, permitindo executar versão
diferente sobre banco parcialmente alterado.

**Correção**: antes de qualquer recuperação, compara o checksum do registro
existente (`in_progress` ou `interrrompida`) com o checksum atual do código.
Se divergirem → `MigrationChecksumError`. Recuperação automática só ocorre
com checksum idêntico; divergência exige intervenção humana.

## Testes adaptados à era do ledger (`payments-integrity.test.ts`)

- **Fault-injection**: passo `aplicada` com checksum válido é PULADO — o
  teste agora simula passo interrompido (DELETE da linha `008_pagamentos` no
  ledger DENTRO da transação) e confirma que o DDL obrigatório falho
  (`ALTER COLUMN ... DROP NOT NULL` sobre coluna droppada) PROPAGA; rollback
  restaura schema E ledger (linha `008_pagamentos` de volta).
- **Idempotência**: `migrate()` devolve sumário — o teste valida
  `applied=[]` e `recovered=[]` (no-op real) em vez de `undefined`.

## Evidências de gate (todos executados nesta branch, stash de IA aplicado)

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` (shared/api/store/admin) | 0 erros ×4 |
| `npm test` (apps/api) | **303/303** (296 + 7 ledger), exit 0, 122s |
| `node scripts/pg-integration.mjs` (da raiz) | **108/108**, exit 0, PostgreSQL **17.11** (`SHOW server_version` registrado no log) |
| Suíte do ledger isolada (PGlite) | 7/7 |

## Bugs corrigidos durante o desenvolvimento (prova vermelho→verde)

1. Nota de recuperação apagada pelo upsert de `in_progress` → preservada via
   `CASE WHEN` (teste "passo interrompido é RECUPERADO" falhava: `error`
   nulo; passa com a nota).
2. Paralelo aplicando 2× no PGlite (lock reentrante por sessão) → mutex
   `migrationChain` (teste de concorrência falhava: `n=2`; passa com
   exatamente-uma aplicação, `n=1`).
3. Deadlock `migrate(tx)` no PGlite (descrito acima).
4. **Conversor perdia statements `sql.raw(...)`** — regex não cobria o
   parêntese entre `sql.raw` e a crase; 5 triggers de imutabilidade de
   `audit_logs` ficaram FORA do arquivo gerado. CI falhou em DB fresco.
   Correção: regex + guarda de completude 228/228.
5. **Fallback silencioso de `getMigrationSession()`** → sem fallback: erro
   de conexão propaga.
6. **Unlock falhou → conexão descartada** → não volta ao pool contaminada.
7. **Checksum de `step.run`** → inclui `toString()` do corpo da função.
8. **Validação de checksum antes da recuperação** → recusa `in_progress`/
   `interrrompida` com checksum divergente.

## Fora do escopo (pré-existente, anotado)

`npm run db:reset` falha no seed em DB fresco (`fraud_rules."action"` NOT NULL
sem DEFAULT vs. insert com `default` no seed.ts). Pré-existente ao AUD-03
(diff não altera DDL de `fraud_rules`); caminho dev-only, não faz parte dos
gates de CI.