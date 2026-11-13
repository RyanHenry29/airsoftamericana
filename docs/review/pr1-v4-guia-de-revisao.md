# PR #1 v4 — Guia de revisão

Diff completo: `docs/review/pr1-v4-full.diff` (gerado por `git diff ba22fa9..head`, árvore limpa).
URLs independentes da aba Files do GitHub (que pode cacheirar estado de force-push):

- Diff raw: `https://github.com/RyanHenry29/airsoftamericana/pull/1.diff`
- Commits: `https://github.com/RyanHenry29/airsoftamericana/pulls/1/commits` (API: `https://api.github.com/repos/RyanHenry29/airsoftamericana/pulls/1`)
- Compare `ba22fa9...head`: `https://github.com/RyanHenry29/airsoftamericana/compare/ba22fa9...<head-sha>`

Estado confirmado pela API pública do GitHub em 2026-11-13: PR #1 é o ÚNICO PR do repositório (state=all), head `dd2319f` (v3), 3 commits, base `ba22fa9`. O snapshot "2 commits / 80 arquivos / b9abf28+b6b5105" corresponde ao estado PRÉ-reconstrução — não existe mais no repositório.

## Onde revisar cada item da terceira revisão (v4)

| Item | Arquivo | O que procurar |
|---|---|---|
| 1. Claim concorrente + lease | `apps/api/src/services/payments/webhook-events.ts` — `recoverPendingEvents` | Transação de claim: `SELECT ... FOR UPDATE SKIP LOCKED` + guarda `lease_expires_at IS NULL OR <= now()`; `leaseExpiresAt = now + leaseMs` (default 2 min) commitado no claim; `skipped_lease` quando outro worker segura; lease expira sozinho (crash ⇒ recuperação). |
| 2. Dead-letter × corrida checkout | mesmo arquivo, bloco `payment` ausente | Parked sai SOMENTE por idade (`maxAgeDays`); tentativas nunca descartam parked. Divergência recorrente: dead-letter só após claim próprio (outro worker no lock ⇒ pulado). Guarda do update de dead-letter: `processed_at IS NULL AND dead_letter=false`. |
| 3. Atomicidade do reparo | mesmo arquivo — `repairPartialApplications` | `audit(tx as unknown as Db)` DENTRO da `db.transaction` junto com `transitionOrderInTx` (histórico + estoque). `autorizado` fora do conjunto definitivo — captura pendente intocada. |
| 4. Expiração endurecida | `apps/api/src/services/payments/expiry.ts` | `queryWithRetry` (2× 500 ms); `notFoundGraceMinutes` (default 24 h) com audit `expiry.skipped_notfound_grace`; dupla confirmação do `null` antes de cancelar; updates guardados por `status='pendente'` com re-leitura; `startPaymentMaintenance` (15 min, não-reentrante, unref); `cancelOrder` audita somente quem transicionou. |
| 5. Origem/identidade sem `accountId` | `webhook-events.ts` — `validateFinancialEvent` + `apps/api/src/routes/webhooks.ts` | `signatureValid === false` ⇒ `event_not_authenticated` (rejeita sem exceção); rota aplica somente com assinatura verificada (401 antes); advertência `payment.account_binding_missing` registra `origin.signatureVerified/transactionMatched/amountValidated/currencyBRL`; fluxo valida transação, moeda BRL, referência externa e valor no mesmo caminho. |

## Testes que provam os cinco itens (`apps/api/src/services/payments-integrity.test.ts`)

1. Lease: "LEASE ativo → outro worker NÃO reivindica; lease expirado → evento volta à fila".
2. Parked × tentativas: "TENTATIVAS nunca descartam evento estacionado" (99 tentativas simuladas) + "evento estacionado além da IDADE → dead-letter".
3. Reparo paralelo: "DUAS INSTÂNCIAS reparando em paralelo → UMA transição, UMA auditoria"; captura pendente: "CAPTURA PENDENTE é intocada".
4. Expiração: tolerância ("ausência DENTRO da tolerância"), dupla confirmação divergente, idempotência de segunda passada, "DUAS INSTÂNCIAS expirando em paralelo → UMA liberação".
5. Origem: "ASSINATURA NÃO VERIFICADA rejeita SEM exceção" + `origin.signatureVerified` na advertência auditada.

## Schema (revisar com os ALTERs)

`apps/api/src/db/schema.ts` — `payment_events`: `attempts`, `last_attempt_at`, `last_error`, `dead_letter`, `lease_expires_at` (todas aditivas com default/nullable). `apps/api/src/db/migrate.ts` — `ADD COLUMN IF NOT EXISTS` correspondentes; produção intocada.
