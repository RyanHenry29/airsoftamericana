# PR #3 — AUD-03: Ledger de migrations (checksum, advisory lock, recuperação)

Branch: `fix/aud03-migration-ledger` (base `origin/master` = `5d6a978`)
Commit: `0c30301`
Diff completo: `docs/review/pr3-aud03-full.diff` (2.437 linhas)

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
| `apps/api/src/db/index.ts` | `getMigrationSession()` — sessão dedicada (só com pool) |
| `apps/api/src/services/payments-integrity.test.ts` | 2 testes de migrate adaptados à era do ledger |
| `scripts/pg-integration.mjs` | Gate inclui `migration-ledger.test.ts`; registra `SHOW server_version` |
| `scripts/build-migration-steps.mjs` | **Novo** — conversor one-shot (registro do processo) |

## Garantias do motor

1. **Checksum sha256 por passo** (deriva de nome + revision/statements):
   divergência código↔ledger recusa o boot (`MigrationChecksumError`) —
   tamper-evident.
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
5. **Recuperação**: passo `in_progress`/`interrrompida` de run anterior é
   re-executado (DDL idempotente) e anotado; a trilha de erro sobrevive no
   upsert (`CASE WHEN "error" IS NOT NULL THEN ... || ' | recuperado em novo
   run'`) e o UPDATE final de "aplicada" NÃO zera `"error"`.
6. **nonIdempotent**: passo marcado assim recusa re-execução automática
   (`MigrationNonIdempotentError`) — decisão humana obrigatória.

## Decisão crítica: `getMigrationSession()` só com pool

O fallback antigo devolvia o `db` do módulo quando não há pool. Em PGlite
(sessão única), `migrate(tx)` chamado DENTRO de uma transação emitia queries
do motor para o mesmo cliente preso no `BEGIN` do callback — **deadlock
circular** (callback espera a query; query espera o callback). Correção:
sem pool, o motor usa o `db` RECEBIDO pelo chamador (tx-aware), semântica do
blob original. Prova: diagnóstico `diag-migrate-hang` (reprodução + sondas,
arquivo temporário removido do commit) — antes: hang indefinido na primeira
query do `acquireAdvisoryLock`; depois: `migrate(tx)` completa em 54ms.

## Testes adaptados à era do ledger (`payments-integrity.test.ts`)

- **Fault-injection**: passo `aplicada` com checksum válido é PULADO — o
  teste agora simula passo interrompido (DELETE da linha `008_pagamentos` no
  ledger DENTRO da transação) e confirma que o DDL obrigatório falho
  (`ALTER COLUMN ... DROP NOT NULL` sobre coluna droppada) PROPAGA; rollback
  restaura schema E ledger (linha `008_pagamentos` de volta).
- **Idempotência**: `migrate()` agora devolve sumário — o teste valida
  `applied=[]` e `recovered=[]` (no-op real) em vez de `undefined`.

## Evidências de gate (todos executados nesta branch, stash de IA aplicado)

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` (shared/api/store/admin) | 0 erros ×4 |
| `npm test` (apps/api) | **303/303** (296 + 7 ledger), exit 0, 114s |
| `node scripts/pg-integration.mjs` (da raiz) | **108/108**, exit 0, PostgreSQL **17.11** (`SHOW server_version` registrado no log) |
| Suíte do ledger isolada (PGlite) | 7/7 |

## Bug corrigido durante o desenvolvimento (prova vermelho→verde)

1. Nota de recuperação apagada pelo upsert de `in_progress` → preservada via
   `CASE WHEN` (teste "passo interrompido é RECUPERADO" falhava: `error`
   nulo; passa com a nota).
2. Paralelo aplicando 2× no PGlite (lock reentrante por sessão) → mutex
   `migrationChain` (teste de concorrência falhava: `n=2`; passa com
   exatamente-uma aplicação, `n=1`).
3. Deadlock `migrate(tx)` no PGlite (descrito acima).
4. **Conversor perdia statements `sql.raw(...)`** — o regex não cobria o
   parêntese entre `sql.raw` e a crase: 5 statements de trigger de
   imutabilidade de `audit_logs` ficaram FORA do arquivo gerado. Sintoma
   determinístico: em DB fresco (CI, data-test zerado) o passo `028_auditoria`
   era marcado `aplicada` SEM os triggers → `UPDATE`/`DELETE` em
   `audit_logs` passavam (`audit.immutability.test.ts` 2/2 falhando no CI).
   Correção: regex com `(?:\(\s*)?` + fechamento `\)\s*\)?` e **guarda de
   completude** no conversor (`db.execute` no blob === statements capturados;
   hoje 228/228). Prova local: dir zerado + migrate fresco → antes: triggers
   `[]`, UPDATE passa; depois: 30 passos aplicados, triggers
   `prevent_audit_update`/`prevent_audit_delete` presentes, UPDATE bloqueado.
   Nota: DBs migrados pela versão intermediária (só dev/test local) recusam o
   boot por checksum divergente (`MigrationChecksumError`) — comportamento
   correto do tamper-evident; apagar o diretório de dev resolve. Produção
   congelada: nenhum DB real foi migrado pela versão intermediária.

## Fora do escopo (pré-existente, anotado)

`npm run db:reset` falha no seed em DB fresco (`fraud_rules."action"` NOT NULL
sem DEFAULT vs. insert com `default` no seed.ts). Pré-existente ao AUD-03
(diff não altera DDL de `fraud_rules`); caminho dev-only, não faz parte dos
gates de CI.
