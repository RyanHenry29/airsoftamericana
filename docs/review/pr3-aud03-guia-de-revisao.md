# PR #3 — AUD-03: Ledger de migrations (checksum, advisory lock, recuperação)

Branch: `fix/aud03-migration-ledger` (base `origin/master` = `5d6a978`)
Commit: `0c30301` (base) → `2381938` (fix do conversor) → `4e34d27` (pós-revisão v1) → `HEAD` (pós-revisão v2)
Diff completo: `docs/review/pr3-aud03-full.diff` (7.767 linhas)

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
| `apps/api/src/db/migration-ledger.test.ts` | **Novo** — 9 testes do ledger (inclui falhas explícitas) |
| `apps/api/src/db/index.ts` | `getMigrationSession()` + `poolInstanceExists()` — sessão dedicada (só com pool), unlock seguro |
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
7. **Sessão dedicada + unlock seguro**: se `pg_advisory_unlock` falhar OU
   retornar `false` (sessão não detinha lock), a conexão é DESCARTADA
   (`client.release(new Error(...))`), evitando contaminação do pool.
8. **Exceção original preservada**: cleanup no `finally` loga falha mas
   **não substitui** a exceção original da migration.
9. **Revisão obrigatória para passos de código**: `MigrationStep` é união
   discriminada — `CodeMigrationStep` exige `revision: string` (TypeScript
   impede passo de código sem revisão).

## Decisão crítica: `getMigrationSession()` — sem fallback silencioso

**Problema anterior**: `getMigrationSession()` capturava QUALQUER erro e
fallbackava para o `db` do módulo. Se `poolInstance.connect()` falhasse
(indisponibilidade, esgotamento), o motor usaria o `db` genérico,
**perdendo a garantia de sessão única** e quebrando o advisory lock.

**Correção**: `getMigrationSession()` lança se `!poolInstance` OU se falhar ao
obter a conexão dedicada. Sem pool (PGlite), o caller usa seu `db` (tx-aware).
Com pool, **exige** a sessão dedicada — falha de conexão propaga e interrompe
as migrations. Não há fallback que silencie a perda de coordenação.

## `releaseAdvisoryLock` — descarta conexão se unlock falhar OU retornar false

**Problema anterior**: erro no unlock era ignorado; conexão voltava ao pool
ainda com o lock de sessão ativo. Não verificava o retorno de
`pg_advisory_unlock` (pode ser `false` se a sessão não detinha o lock).

**Correção**: `releaseAdvisoryLock` retorna `boolean` (`true` = unlock
confirmado E `unlocked === true`; `false` = erro OU `unlocked === false`).
No `finally` de `runMigrationStepsExclusive`: se `lockOk === false`,
`session.lockFailed = true` e `session.release(true)` **descarta a conexão**
(`client.release(new Error(...))`) em vez de `client.release()`. Pool não
recebe conexão possivelmente contaminada.

## Checksum de passos de código — inclui `run.toString()` + revisão obrigatória

**Problema anterior**: `step.run` não entrava no checksum; alteração na
implementação sem bump de revisão passava despercebida.

**Correção**: `computeStepChecksum` serializa `runSource: step.run?.toString() ?? null`.
Alteração no corpo da função muda o checksum. **`revision` agora é OBRIGATÓRIA**
no tipo `CodeMigrationStep` (TypeScript impede passo de código sem revisão).
Para passos de código, a revisão explícita continua sendo a garantia operacional
principal; o `run.toString()` é proteção adicional contra mudanças não declaradas.

## Validação de checksum ANTES da recuperação

**Problema anterior**: checksum era validado só para status `aplicada`.
`in_progress`/`interrrompida` com checksum divergente eram aceitos e o
checksum antigo era substituído pelo novo, permitindo executar versão
diferente sobre banco parcialmente alterado.

**Correção**: antes de qualquer recuperação, compara o checksum do registro
existente (`in_progress` ou `interrrompida`) com o checksum atual do código.
Se divergirem → `MigrationChecksumError`. Recuperação automática só ocorre
com checksum idêntico; divergência exige intervenção humana.

## Testes de falha explícitos (9 testes do ledger)

| Teste | O que valida |
|---|---|
| `migrate()` aplica todos os passos | 30 passos, checksums corretos, status `aplicada` |
| Re-execução é no-op | `applied=[]`, `recovered=[]`, `skipped=30` |
| Checksum divergente em `aplicada` | `MigrationChecksumError` |
| **Checksum divergente em `in_progress`** | **`MigrationChecksumError` — ledger inalterado, zero DDL** |
| **Checksum divergente em `interrrompida`** | **`MigrationChecksumError` — ledger inalterado, zero DDL** |
| Passo interrompido é RECUPERADO | `recovered` + `aplicada` + trilha de erro preservada |
| `nonIdempotent` bloqueia | `MigrationNonIdempotentError` |
| Paralelismo exatamente-uma | Mutex + advisory lock, `n=1` |
| Checksum estável | Deriva só do conteúdo |

**Passos sintéticos** para testes de falha (`test_checksum_progress_001`, `test_checksum_interrupted_001`) — não tocam migrations reais.

## Evidências de gate (todos executados nesta branch, stash de IA aplicado)

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` (shared/api/store/admin) | 0 erros ×4 |
| `npm test` (apps/api, `data-test` zerado) | **305/305**, exit 0 |
| `node scripts/pg-integration.mjs` (da raiz) | **110/110**, exit 0, PostgreSQL **17.11** (`SHOW server_version` registrado no log) |
| Suíte do ledger isolada (PGlite) | 9/9 |

## Bugs corrigidos durante o desenvolvimento (prova vermelho→verde)

1. Nota de recuperação apagada pelo upsert de `in_progress` → preservada via `CASE WHEN`.
2. Paralelo aplicando 2× no PGlite → mutex `migrationChain`.
3. Deadlock `migrate(tx)` no PGlite → `getMigrationSession()` sem fallback silencioso.
4. Conversor perdia `sql.raw(...)` → regex + guarda de completude 228/228.
5. **Fallback silencioso de `getMigrationSession()`** → sem fallback: erro de conexão propaga.
6. **Unlock falhou → descarta conexão** → `client.release(new Error(...))`, não volta ao pool.
7. **Checksum de `step.run`** → `run.toString()` + `revision` obrigatória.
8. **Validação de checksum antes da recuperação** → recusa `in_progress`/`interrrompida` com checksum divergente.
9. **Cleanup não mascara exceção original** → `hasOriginalError` flag no `finally`.
10. **`releaseAdvisoryLock` verifica `unlocked === true`** → descarta se `false` ou erro.
11. **`revision` obrigatória para passos de código** → união discriminada `MigrationStep`.
12. **Testes de checksum divergente em `in_progress`/`interrrompida`** → passos sintéticos, ledger inalterado.
13. **Testes de falha não tocam migrations reais** → passos `test_checksum_*`.

## Fora do escopo (pré-existente, anotado)

`npm run db:reset` falha no seed em DB fresco (`fraud_rules."action"` NOT NULL
sem DEFAULT vs. insert com `default` no seed.ts). Pré-existente ao AUD-03
(diff não altera DDL de `fraud_rules`); caminho dev-only, não faz parte dos
gates de CI.