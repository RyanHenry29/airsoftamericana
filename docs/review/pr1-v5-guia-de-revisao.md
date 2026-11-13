# Guia de revisão — PR v5 (`1cdf48f..wip/v5-fencing`)

> **Status:** v5 NÃO publicável. v4 (`1cdf48f`) permanece a versão publicada no PR #1. Produção, migrations e SQLs de hardening intocados.
>
> **Diff completo versionado:** `docs/review/pr1-v5-full.diff` (regenerado de `git diff 1cdf48f..f9e5d8d`).
>
> Commits na branch: `b184d5d` · `7b4e895` · `f9b0250` · `001b011` · `54f9f51` · `eb7abcc` · `a1e0a1f` · `a97f9f2` · `118f69c` (artefatos) · `68445bb` (**correção pós-revisão**) · `ac4578a` · `f9e5d8d` (limpeza).

## Rodada de correção (`68445bb`) — resultado da revisão v5.1

A revisão apontou 3 problemas (1 CRÍTICO, 2 ALTO) e 2 MÉDIO. Todos corrigidos com prova vermelha → verde:

| # | Correção | Aceite exigido | Como provado |
| --- | --- | --- | --- |
| 1 | `finalizeExpiry` decide POR ESTADO DO PEDIDO | Pagamento aprovado nunca confirmado com pedido cancelado sem `refund_required` durável | 3 testes novos com flip de estado mid-flight (gancho em `queryPaymentByOrder`) |
| 2 | Migrations sem `catch(() => {})` no DDL obrigatório | Falha real de DDL interrompe o boot; idempotência não esconde erro | Teste: `DROP COLUMN` em tx + `migrate` DEVE rejeitar; rollback restaura |
| 3 | Heartbeat com 3 estados + margem por TTL | Incerteza prolongada impede novas fases | Teste: sem renovação confirmada por ≥ TTL ⇒ `lost()` true (sem recusa alguma) |
| 4 | `deadLetter` guarda ESTRITA de token | Token divergente OU persistido NULL bloqueiam | Teste: token limpo mid-flight + `amount_mismatch` + `maxAttempts=1` ⇒ NÃO marca |
| 5 | Auditorias do webhook DENTRO da transação | Mutação e registro compartilham a tx | Implementação; os 3 sites (`regression_ignored`, `order_missing`, `late_payment`) agora `audit(tx)` |
| 6 | Testes/docs regenerados dos resultados reais | Números = execução | 281/281 e 86/86 medidos nesta rodada (ver Gates) |

### Detalhe da correção 1 (CRÍTICO)

`transitionOrderInTx` LANÇA `conflict` em transição inválida (não devolve `transitioned=false`) — na v5 original isso escanava a exceção para fora do varrimento (estado veneno matava a passada inteira) e, no caso `from === to`, commitava o pagamento com auditoria de confirmação tardia como se tivesse transicionado. Agora `finalizeExpiry` lê o pedido SOB LOCK (após o pagamento — ordem canônica) e decide ANTES de qualquer escrita:

- **cancelado + aprovado no provedor** → pagamento tardio: assenta o pagamento com `capturedAt`, pedido NÃO reabre, registro durável `order.late_payment` com `decision: "refund_required"` (mesma semântica da rota de webhook), NENHUMA transição, contador `summary.latePayment`.
- **transição obrigatória recusada** (estado não-transicionável, ex.: `enviado`) → NADA é assentado: pagamento permanece `pendente`, retorno `refused` + auditoria operacional `expiry.skipped_invalid_order_state` (a recusa ocorre antes de qualquer escrita — nada a desfazer).
- **pedido já no alvo** (`from === to`) → reconciliação: pagamento assentado, SEM transição no histórico, auditoria própria `expiry.payment_reconciled` (nunca `late_confirmation`).
- **transição possível** → comportamento v5 original (atômico, audita `late_confirmation`/`expiry.cancelled` somente quando transicionou).

### Detalhe da correção 3 (ALTO)

`withSystemLock` agora distingue `owned` (renovação confirmada) / `lost` (recusa — token não é mais o dono) / `uncertain` (renovação sem resposta). A aquisição conta como primeira confirmação; renovações confirmadas rearmam a margem. `ctx.lost()` devolve true quando `ownerLost` OU quando nenhuma renovação é confirmada por ≥ `ttlMs` — ultrapassado o TTL sem confirmação, o lease no banco já expirou e o worker não continua manutenção na dúvida. Incerteza não é declarada como perda definitiva, mas não pode durar indefinidamente.

## Mapa por arquivo

| Arquivo | Conteúdo da v5 |
| --- | --- |
| `apps/api/src/db/schema.ts` | `payment_events.lease_token`; tabela drizzle `system_locks`; `payments.not_found_first_seen_at` |
| `apps/api/src/db/migrate.ts` | ALTERs idempotentes + `DROP DEFAULT` de `processed_at`; DDL obrigatório da v5 SEM catch silencioso |
| `apps/api/src/services/payments/webhook-events.ts` | `LeaseLostError`; pré-checagem; `markProcessed` guardado; claim com token; `deadLetter` com guarda ESTRITA; auditorias NA transação |
| `apps/api/src/services/payments/system-locks.ts` | NOVO — locks entre instâncias; heartbeat com owned/lost/uncertain + margem TTL |
| `apps/api/src/services/payments/expiry.ts` | observação persistida; janela; `finalizeExpiry` com decisão por estado do pedido; `latePayment` no summary |
| `apps/api/index.ts` | boot sob `withSystemLock`; `runMaintenance` com aborto entre fases |
| `apps/api/src/services/payments-integrity.test.ts` | 62 testes no arquivo (13 v5 originais + 9 da correção) |

## Respostas aos 5 pontos da revisão (atualizadas)

### 1. Fencing efetivo — rollback total por transação

- `applyPaymentEvent` com `leaseToken`: pré-checagem sem lock (otimização) → transação única: pagamento FOR UPDATE → pedido FOR UPDATE → estoque/história → `markProcessed()` como ÚLTIMA escrita.
- `markProcessed` com token: `UPDATE ... WHERE lease_token = ours AND processed_at IS NULL` + re-leitura; divergência ⇒ `LeaseLostError` ⇒ rollback total.
- **Auditorias DENTRO da transação (correção 5):** as três auditorias da rota (`payment.regression_ignored`, `payment.order_missing`, `order.late_payment`) agora executam com `audit(tx)` — mutação e registro compartilham a transação; auditoria que falha reverte a mutação, nunca o contrário. Não confundir com histórico de transição (`order_status_history`, já na tx desde a v4).
- `deadLetter`: tx própria, lock da linha, guarda de estado e guarda ESTRITA por token (`fresh.leaseToken !== leaseToken` bloqueia — inclusive quando o persistido é NULL). Auditoria dentro da tx.
- `finalizeExpiry`: fencing por revalidação de status sob lock (a expiração não usa lease de evento) + decisão por estado do pedido (correção 1).
- Prova mid-flight: `GUARDA na marcação` (hook `StealAdapter` troca o token entre a pré-checagem e a marcação ⇒ rollback total) e `FENCING × EXPIRAÇÃO em paralelo` (ladrão assume; webhook aborta; expiração assenta exatamente uma vez).
- Ordem canônica de locks: pagamento → pedido → evento; a marcação é a última escrita DE PROPÓSITO (lockar o evento antes inverteria a ordem e deadlockaria com a rota de webhook).

### 2. Locks distribuídos — renovação, expiração, liberação e heartbeat

- Aquisição atômica (`INSERT ... ON CONFLICT ... WHERE expirado RETURNING`); renovação e liberação somente pelo dono; expiração pelo relógio do BANCO.
- **Heartbeat (correção 3):** `lost()` = recusa confirmada OU ausência de confirmação ≥ TTL. Falha transitória não declara perda definitiva — mas a incerteza é limitada pela margem de segurança. Aborto cooperativo entre fases (`runMaintenance` checa `lost()` entre recuperação → reparo → expiração).
- Residual honesto: aborto é cooperativo (grau de fase); operações das fases têm guarda própria no banco (claim `SKIP LOCKED`, `finalizeExpiry` revalidado sob lock, reparo por junção) — sobreposição residual degrada a contenção, não a integridade. O lock distribuído é camada de CONTENÇÃO; as garantias transacionais de cada operação são independentes.

### 3. Expiração — observação persistida, invalidação e decisão por estado

- Primeira observação `null` persistida (`payments.not_found_first_seen_at`) + auditada; confirmação independente exige observações em passadas distintas (`confirmWindowMs`, default 15 min).
- Invalidação no assentamento: webhook (`webhook-events.ts`) e `finalizeExpiry` limpam a observação na transação.
- **Decisão por estado do pedido (correção 1)** — ver detalhe acima. Garantia reformulada com precisão: pagamento aprovado é confirmado com pedido cancelado SOMENTE com registro durável de `refund_required`; recusa de transição não assenta nada.

### 4. Migração — idempotência SEM silêncio

- `DROP DEFAULT` de `processed_at`: reexecução é no-op no PostgreSQL (não precisa de catch para idempotência); `ADD COLUMN IF NOT EXISTS` e `CREATE TABLE IF NOT EXISTS` idem.
- **Correção 2:** os cinco statements obrigatórios da v5 NÃO têm mais `catch(() => {})` — falha real (permissão, banco indisponível, sintaxe) propaga e interrompe o boot. Teste: `DROP COLUMN processed_at` em transação + `migrate` DEVE rejeitar; rollback restaura a coluna. Idempotência preservada (migrate reexecutado é no-op — testado).
- Sem reclassificação de histórico; compatível com rollback (nenhum caminho v4 insere sem `processed_at` explícito). Eventos nascidos processados entre baseline e v5 não são detectáveis automaticamente — investigação por `processed_at = created_at` sem correspondência em `audit_logs`, sem correção automática.
- NOTA: `migrate.ts` roda no boot da API; execução em produção exige autorização explícita (produção congelada).

### 5. Recuperação — qualificada

- Lock permanente: impossível por construção — release no `finally`; crash deixa o lease, que expira sozinho pelo relógio do banco (TTL 5 min).
- Evento preso: o lease do evento expira sozinho (2 min) e volta à fila; backoff não bloqueia indefinidamente; dead-letter por idade só para PARKED; `LeaseLostError` deixa o evento como está. **Qualificação (revisão):** "não deixa preso" é uma propriedade do desenho (lease expirável + backoff), demonstrada pelos testes de recuperação — ela NÃO substitui verificação operacional de retomada após indisponibilidade prolongada do banco ou reinicialização; monitorar `scanned/applied/parked/skippedLease` no log de manutenção.
- Falha de manutenção: engolida pela passada (não derruba o processo); a passada seguinte re-tenta com aquisição ativa.

## Gates (executados nesta rodada — números medidos, não presumidos)

| Gate | Resultado |
| --- | --- |
| `npx tsc --noEmit` (api, store, admin) | exit 0 ×3 |
| `npm test` (apps/api) | **281/281**, 33 arquivos |
| PostgreSQL real (`node scripts/pg-integration.mjs`, da raiz) | **86/86**, 4 arquivos |

## Cenários novos (v5.1 correção, 9 testes — todos com fase vermelha documentada)

1. `PEDIDO CANCELADO + provedor aprovado` → pagamento tardio assentado + `order.late_payment` com `refund_required` durável + sem reabrir pedido + passada sobrevive + `latePayment=1`.
2. `PEDIDO JÁ NO ALVO` → reconciliado, ZERO transições no histórico, SEM `late_confirmation`, COM `expiry.payment_reconciled`.
3. `TRANSIÇÃO recusada (enviado)` → nada assentado, pagamento pendente, `expiry.skipped_invalid_order_state`.
4. `INCERTEZA prolongada` → sem renovação confirmada ≥ TTL ⇒ `lost()` true (vermelho na v5 original).
5. `Dentro da margem` → `lost()` permanece false.
6. `FALHA de DDL obrigatório` → migrate rejeita (vermelho: engolia); rollback restaura schema.
7. `IDEMPOTÊNCIA` → migrate reexecutado é no-op.
8. `deadLetter token NULL + token informado` → BLOQUEADA (vermelho: marcava); `rejected=1`, evento na fila.
9. `FENCING × EXPIRAÇÃO em paralelo` → webhook aborta com `LeaseLostError`; expiração assenta UMA vez; evento fica para o dono atual.

Endurecido: `CLAIM único` agora captura e compara os tokens (não nulos e distintos) — comprova unicidade, não só processamento.

## Pendências para publicação

1. Aprovação humana do diff da correção (`118f69c..f9e5d8d`).
2. Decisão: push da `wip/v5-fencing` no PR #1 (substituindo a v4) ou PR novo.
3. SQLs de hardening e homologação com gateway real continuam bloqueados (produção congelada).
