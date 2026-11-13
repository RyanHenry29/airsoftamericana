# Guia de revisão — PR v5 (`1cdf48f..wip/v5-fencing`)

> **Status:** v5 NÃO publicável. v4 (`1cdf48f`) permanece a versão publicada no PR #1. Produção, migrations e SQLs de hardening intocados.
>
> **Diff completo versionado:** `docs/review/pr1-v5-full.diff` (gerado de `git diff 1cdf48f..a1e0a1f`, 168 KB, 8 arquivos).
>
> Commits na branch (7): `b184d5d` (schema+token, rascunho) · `7b4e895` (itens 1-2) · `f9b0250` (item 3) · `001b011` (limpeza tsbuildinfo) · `54f9f51` (itens 4-5) · `eb7abcc` (testes dos critérios) · `a1e0a1f` (docs) — e o commit de endurecimento pós-revisão preliminar (invalidação de observação + aborto cooperativo).

## Mapa por arquivo

| Arquivo | Conteúdo da v5 |
| --- | --- |
| `apps/api/src/db/schema.ts` | `payment_events.lease_token`; tabela drizzle `system_locks`; `payments.not_found_first_seen_at` |
| `apps/api/src/db/migrate.ts` | ALTERs idempotentes + `DROP DEFAULT` de `processed_at` (linha 652) |
| `apps/api/src/services/payments/webhook-events.ts` | `LeaseLostError` (l. 39), pré-checagem (l. 249), `markProcessed` (l. 297), claim com token (l. 631), catch no recovery (l. 711) |
| `apps/api/src/services/payments/system-locks.ts` | NOVO — `acquireSystemLock`/`renewSystemLock`/`releaseSystemLock`/`withSystemLock` |
| `apps/api/src/services/payments/expiry.ts` | observação persistida (l. 162), janela (l. 202), `finalizeExpiry` (l. 311), manutenção sob lock (l. 392) |
| `apps/api/index.ts` | boot sob `withSystemLock`; `runMaintenance` com aborto entre fases |
| `apps/api/src/services/payments-integrity.test.ts` | +13 testes (53 no arquivo) |

## Respostas aos 5 pontos da revisão

### 1. Fencing efetivo — todas as mutações, não só `processed_at`

O mecanismo não é guarda por campo — é **rollback total por transação**:

- `applyPaymentEvent` com `leaseToken`: pré-checagem sem lock (l. 249, otimização) → transação única com pagamento FOR UPDATE → pedido FOR UPDATE → estoque/história → `markProcessed()` como ÚLTIMA escrita (l. 297).
- `markProcessed` com token: `UPDATE ... WHERE lease_token = ours AND processed_at IS NULL` + **re-leitura**. Qualquer divergência (token trocado, já processado) ⇒ `throw new LeaseLostError()` ⇒ a transação inteira desfaz pagamento, pedido, estoque, história e marcação. **Nada comuta sem posse válida no instante da marcação.**
- A rota de auditoria (`pendingAudits`) roda FORA da tx, mas só executa se a tx commitou — lease perdido ⇒ sem commit ⇒ nenhuma auditoria órfã.
- `deadLetter` (l. 568): própria tx com lock da linha + guarda de estado + guarda por token — auditoria DENTRO da tx.
- `finalizeExpiry` (expiry.ts l. 311): mesmo desenho, com fencing por revalidação de status sob lock (`SELECT payment FOR UPDATE` + `status='pendente'`), porque a expiração não usa lease de evento.
- Teste que prova a mecanica mid-flight: `GUARDA na marcação` — um hook na consulta ao gateway troca o token ENTRE a pré-checagem e a marcação; resultado observável: pagamento `pendente`, pedido `aguardando_pagamento`, estoque reservado, zero entradas de transição, token da linha = dono ladrão.

**Ponto explícito de diseño:** a marcação é a última escrita de propósito. Isso coloca a guarda DEPOIS da ordem canônica de locks (pagamento→pedido→evento) — lockar o evento antes inverteria a ordem e deadlockaria com a rota de webhook.

### 2. Locks distribuídos — renovação, expiração, liberação e heartbeat falho

`system-locks.ts` (117 linhas, sem dependências):

- Aquisição atômica: `INSERT ... ON CONFLICT (name) DO UPDATE ... WHERE lease_expires_at IS NULL OR <= now() RETURNING` — corrida de N instâncias: exatamente 0 ou 1 vencedor.
- Renovação (`renewSystemLock`): `UPDATE ... WHERE name = ? AND lease_token = ?` — intruso não renova (teste cobre).
- Liberação (`releaseSystemLock`): idempotente por token; intruso é no-op (teste cobre).
- Expiração: pelo relógio do BANCO (`now()` no SQL) — sem relógio de worker.
- **Heartbeat falho (ponto da revisão):** recusa na renovação (token não é mais o dono) seta `ownerLost` e `ctx.lost()` passa a devolver `true` (system-locks.ts l. 98-105). `runMaintenance` (index.ts) checa `lost()` ENTRE as fases (recuperação → reparo → expiração) e aborta a passada — o worker não continua manutenção após perder o lock. Falha TRANSITÓRIA de rede na renovação NÃO marca perda (o token ainda é nosso; o próximo heartbeat renova). Teste: `PERDA de lock confirmada pelo heartbeat`.
- Residual honesto: aborto é cooperativo (grau de fase). As operações das fases são em si guardadas (claim `SKIP LOCKED`, `finalizeExpiry` revalidado, reparo por junção), então sobreposição residual degrada a contenção, não a integridade. Aborto forçado (kill da promise) não existe em JS — o limite é documentado.

### 3. Expiração — invalidação da observação e anti-reuso

- Primeira observação `null` persistida (`payments.not_found_first_seen_at`) + auditada (`expiry.notfound_first_seen`, expiry.ts l. 162).
- Janela `confirmWindowMs` (default 15 min = intervalo de manutenção): decisão só na passada SEGUNTE — dois `null` na mesma passada nunca decidem (l. 202).
- **Invalidação (ponto da revisão, endurecido nesta rodada):** webhook que assenta o pagamento limpa `notFoundFirstSeenAt` na MESMA transação (`webhook-events.ts` l. 350) e `finalizeExpiry` idem (expiry.ts l. 341). Nenhuma observação sobrevive a mudança de estado.
- Barreira estrutural adicional: a varredura da expiração só considera `payments.status = 'pendente'` — e o pagamento NUNCA volta a `pendente` (proteção de regressão v2). Observação antiga não reutilizável por construção; a limpeza na fonte remove o estado obsoleto.
- Cobrança viva após a janela ⇒ reserva preservada (teste cobre: `CONFIRMAÇÃO ASSÍNCRONA divergente`).

### 4. Migração — idempotência, ordem, rollback e histórico

- `DROP DEFAULT` de `payment_events.processed_at` (migrate.ts l. 652): idempotente (ALTER repetido é no-op), SEM reclassificação de linhas existentes — `processed_at` de eventos históricos não é tocado.
- **Atenção especial pedida pela revisão:** o DEFAULT `now()` do baseline fazia evento novo nascer processado (`processed_at = createdAt`). Em produção com PostgreSQL pré-existente, o mesmo default está vivo — a migração v5 o elimina nos dois bancos. Eventos que NASCERAM processados entre o baseline e esta correção não são detectáveis automaticamente (indistinguível de evento aplicado de verdade); investigação, se necessária, por auditoria: eventos com `processed_at = created_at` sem correspondência em `audit_logs`.
- Compatibilidade com rollback: nenhum caminho v4 insere evento sem `processed_at` explícito (a rota grava `processedAt: null`) — o código v4 roda corretamente com OU sem o default. Rollback da branch não exige desfazer o ALTER.
- Ordem das alterações: colunas novas com `ADD COLUMN IF NOT EXISTS`; `system_locks` com `CREATE TABLE IF NOT EXISTS` + seed `ON CONFLICT DO NOTHING` — roda N vezes, migra N bancos.
- NOTA para produção real: `migrate.ts` roda no boot da API. Os ALTERs são DDL leves (sem reescrita de tabela). Ainda assim, execução em produção segue exigindo autorização explícita (produção congelada).

### 5. Recuperação — sem lock permanente, sem evento preso

- **Lock permanente:** impossível por construção — `withSystemLock` libera no `finally` (l. 115); crash do processo deixa o lease, que expira sozinho pelo relógio do banco (ttl 5 min); `system_locks` não tem dono eterno.
- **Evento preso:** impossível por construção — o lease do evento expira sozinho (2 min) e volta à fila no próximo `recoverPendingEvents`; backoff (`last_attempt_at` + `minBackoffMs`) não bloqueia indefinidamente; dead-letter por idade (30 d) só para PARKED, e parked sai por idade, nunca por tentativas (v4, mantido). `LeaseLostError` deixa o evento exatamente como estava — o dono atual o processa na mesma ou na próxima passada.
- Falha de manutenção: `startPaymentMaintenance` engole a falha da passada (não derruba o processo) e a próxima passada re-tenta, com aquisição de lock ativa.

## Gates (executados nesta rodada)

| Gate | Resultado |
| --- | --- |
| `npx tsc --noEmit` | exit 0 (3× consecutivas) |
| `npm test` (apps/api) | **272/272**, 33 arquivos |
| PostgreSQL real (`node scripts/pg-integration.mjs`, da raiz) | **77/77**, 4 arquivos |

## Cenários novos cobertos (v5, 13 testes)

1. Pré-checagem: token de outro worker ⇒ `lease_lost`, nada aplicado.
2. Guarda mid-flight: token trocado durante a aplicação ⇒ `LeaseLostError` ⇒ rollback total.
3. Recovery: lease perdido ⇒ `leaseLost` contado, dono atual assume.
4. Claims distintos; dono legítimo nunca bloqueado.
5. Lock vigente: 2ª instância não adquire.
6. Lease vencido devolve o lock.
7. Renovação só pelo dono; intruso não rouba nem libera.
8. `withSystemLock` em contenção: 1 execução, 2ª pula.
9. Perda de lock confirmada por heartbeat ⇒ `ctx.lost()` (aborto cooperativo).
10. 2 instâncias de `startPaymentMaintenance`: passadas nunca se sobrepõem.
11. Confirmação assíncrona: 1ª passada persiste e não cancela; cobrança viva após janela não cancela.
12. Webhook positivo invalida a observação de ausência.
13. Webhook × expiração em paralelo (1 aprovação) e falha transacional (rollback total, CHECK constraint determinística).

## Pendências para publicação

1. Aprovação humana deste diff (não há merge/push sem ela).
2. Decisão: push da `wip/v5-fencing` no PR #1 (substituindo a v4) ou PR novo.
3. SQLs de hardening e homologação com gateway real continuam bloqueados (produção congelada).
