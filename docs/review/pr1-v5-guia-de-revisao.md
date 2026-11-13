# Guia de revisão — PR v5 (`1cdf48f..wip/v5-fencing`)

> **Status:** v5 NÃO publicável. v4 (`1cdf48f`) permanece a versão publicada no PR #1. Produção, migrations e SQLs de hardening intocados.
>
> **Diff completo versionado:** `docs/review/pr1-v5-full.diff` (regenerado de `git diff 1cdf48f..d9c3d1a` — SHA alvo da revisão final, excluindo o artefato de si mesmo).
>
> Commits na branch: `b184d5d` · `7b4e895` · `f9b0250` · `001b011` · `54f9f51` · `eb7abcc` · `a1e0a1f` · `a97f9f2` · `118f69c` (artefatos) · `68445bb` (**correção pós-revisão**) · `ac4578a` · `f9e5d8d` (limpeza) · `c853b07` (artefatos regenerados) · `3313667` (**evidências pós-revisão**) · `276990c` · `b0b8d14` (artefatos) · `1dc5c2f` (**rodada final pós-revisão condicionada**) · `e270fb3` · `df72df8` (artefatos) · `fbc3f46` (endurecimentos documentados) · `c04fc0f` · `2e2943f` · `b75b511` (CI verde) · `07db6a2` (**cercas de arrendamento + 6 testes de cerca — SHA alvo da revisão final**) · `d9c3d1a` (**fencing transacional no reparo + testes fortalecidos — SHA alvo da revisão final**).

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

## Gates (executados após `1dc5c2f`, tree somente-v5 — números medidos, não presumidos)

| Gate | Resultado |
| --- | --- |
| `npx tsc --noEmit` (shared, api, store, admin) | exit 0 ×4 — `shared` verificado com tsconfig próprio (`packages/shared/tsconfig.json`); o workflow de CI executa os 4 |
| `npm test` (apps/api) | **289/289**, 33 arquivos (70 no arquivo de integridade) |
| PostgreSQL real (`node scripts/pg-integration.mjs`, da raiz) | **94/94**, 4 arquivos |
| CI independente | `.github/workflows/api-gates.yml` criado — ativa ao publicar a branch |

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

## Evidências pós-revisão (`3313667`) — 4 testes novos

Endereçam as duas lacunas apontadas na revisão condicionada:

| Evidência | O que prova |
| --- | --- |
| `RECUSA confirmada: fase 1 roda, fases 2-3 NÃO rodam` | Lease tomado por outra instância ⇒ heartbeat RECUSADO (não margem: TTL 3000 ms > tempo decorrido ~1300 ms) ⇒ `lost()` true ⇒ runMaintenance **não executa** recuperação→reparo→expiração além da fase 1. Asserções: recusa real (`renewSystemLock` token antigo = false) + fases bloqueadas. |
| `INCERTEZA prolongada: fase 1 roda, fases 2-3 NÃO rodam` | Sem renovação confirmada ≥ TTL (TTL 50 ms, heartbeat real aos 1000 ms) ⇒ fases 2-3 bloqueadas. |
| `EXPIRAÇÃO: auditoria 'expiry.cancelled' falha ⇒ tudo revertido` | Trigger determinístico `BEFORE INSERT ON audit_logs` RAISE para a ação alvo. Falha de auditoria DEPOIS da mutação financeira reverte: pagamento (pendente), pedido (aguardando_pagamento), estoque (reservado=1), histórico (só criação) e NENHUM registro de auditoria. |
| `WEBHOOK pagamento tardio: auditoria 'order.late_payment' falha ⇒ tudo revertido` | Mesmo gatilho no caminho de webhook: pagamento pendente, pedido permanece cancelado, marcação do evento (última escrita) revertida — evento volta à fila. |

Indicador operacional (revisão, item C): `ExpirySummary.skippedInvalidState` conta as recusas de transição automática — vai para o log de manutenção (`app.log.info({ recovery, repair, expiry })` no boot) com registro individual `expiry.skipped_invalid_order_state` em `audit_logs` por pedido. Durabilidade do `refund_required` (item B): registro `order.late_payment` com `decision: "refund_required"` nas duas vias (webhook e expiração), append-only, DENTRO da transação financeira.

## Rodada final (pós-revisão condicionada, `1dc5c2f`) — os 5 pendências endereçados

| Prioridade | Pendência do veredito | Correção entregue |
| --- | --- | --- |
| ALTO | Pagamento pode ser liquidado sem pedido correspondente | `finalizeExpiry` SEMPRE locka o pedido (os três callers informam `orderId`). Pedido inexistente ⇒ retorno `refused`/`orderMissing`: NADA é assentado, pagamento permanece `pendente`, auditoria `expiry.skipped_order_missing` (entity "payment", âncora `orderId` no payload) + contador `skippedOrderMissing`. Guarda fail-closed pós-transição: `if (!outcome.transitioned) throw conflict("invalid_transition", ...)` — recusa inesperada reverte TUDO. Teste com fase vermelha documentada: vermelho revelou assentamento escrito → `transitionOrderInTx` lança `notFound` → rollback mas exceção matava a passada inteira. FK descoberta dinamicamente via `pg_constraint` (não hardcodada). |
| ALTO | Heartbeat sem teste de exceção de rede real | Dois testes novos com exceção REAL: `ALTER TABLE "system_locks" RENAME` derruba toda renovação (engolida = incerteza). (a) banco fora por ≥ TTL (3000 ms, 3 exceções, 0 recusas, 0 confirmações) ⇒ fases 2-3 NÃO rodam; (b) falha transitória 0→1500 ms + renovação CONFIRMADA aos ~2000 ms ⇒ margem rearma, lock NÃO perdido indevidamente, fases 2-3 rodam. Restore no `finally`. |
| MÉDIO | DDL obrigatório ainda com erro silencioso | Os 7 `.catch(() => {})` residuais removidos (`payment_id`/`processed_at` DROP NOT NULL; `attempts`, `last_attempt_at`, `last_error`, `dead_letter`, `lease_expires_at`). Todos idempotentes por construção (reexecução é no-op); falha REAL (permissão, conexão) propaga e interrompe o boot. **AUD-03 (ledger, checksum, coordenação de migrations) permanece explicitamente pendente** — item de arquitetura independente. |
| MÉDIO | `refund_required` sem procedimento operacional | Seção "Procedimento operacional" abaixo: responsável, agenda, SLA por tipo de item (24 h úteis; escalonamento 48 h), resolução registrada como `order.late_payment_resolved` (INSERT permitido — trigger bloqueia só UPDATE/DELETE) e query de monitoramento `docs/sql/late-payment-monitor.sql` (fila aberta, totais, resoluções, envelhecimento). |
| MÉDIO | Gates sem execução independente | `.github/workflows/api-gates.yml`: tsc ×3 (shared/api/store/admin), `npm test` da API, `node scripts/pg-integration.mjs` — em `push`/`pull_request`. Ativa ao publicar a branch; banco efêmero do runner, nada toca produção. |

## Procedimento operacional — divergências financeiras (`refund_required` e afins) 

O registro `order.late_payment` com `decision: "refund_required"` em `audit_logs` é **evidência durável, não fila de reembolso**. O processamento do reembolso é humano. Este é o procedimento acordado:

**Responsável:** operação financeira da loja (papel `financeiro` no admin). O agente que executa a consulta e triagem diária responde ao dono da operação; a aprovação de cada reembolso é do dono da operação financeira.

**Agenda e monitoramento:** a consulta `docs/sql/late-payment-monitor.sql` roda todo dia útil na abertura do expediente e antes do fechamento de caixa. A consulta 4 (envelhecimento) é a de escalonamento.

**SLA por item aberto:**

| Situação | SLA de resolução | Ação |
| --- | --- | --- |
| `order.late_payment` com `refund_required` (dinheiro capturado, pedido cancelado) | 24 h úteis | Reembolso no gateway + registro `order.late_payment_resolved` no `audit_logs` (actor = responsável, `after_json` com id da transação do estorno) |
| `expiry.skipped_invalid_order_state` (sem captura, pedido em estado inesperado) | 24 h úteis | Investigar o estado do pedido, decidir cancelamento manual ou continuação, registrar resolução |
| `expiry.skipped_order_missing` (pagamento sem pedido correspondente) | 24 h úteis, escalonamento em 48 h | Investigação obrigatória — estado cirúrgico/legado não deve ocorrer em produção; se ocorrer, é incidente (verificar manipulação direta de banco) |
| Qualquer item aberto > 48 h | — | Escalar para o dono da operação financeira; bloquear fechamento de caixa do período até resolução |

**Resolução:** cada item tratado recebe um registro `order.late_payment_resolved` em `audit_logs`, com `entity_id` = id do registro original, `actor_label` = responsável e `after_json` documentando a decisão (id do estorno no gateway, ou motivo da dispensa). O registro é feito pelo responsável via SQL (a tabela é append-only: o trigger `prevent_audit_modification` bloqueia UPDATE/DELETE, não INSERT):

```sql
insert into audit_logs (actor_label, action, entity, entity_id, after_json)
values ('financeiro.joao', 'order.late_payment_resolved', 'order', '<entity_id do registro original>',
        '{"refund_id":"re_xxx","valor_reembolsado_centavos":10000,"decisao":"reembolso_executado"}');
```

As consultas 3 e 1 do `late-payment-monitor.sql` auditam as resoluções e excluem da fila aberta o que já tem resolução.

**Alerta automático:** o resumo da passada de expiração (`ExpirySummary`) vai ao log de manutenção do boot com os contadores `latePayment`, `skippedInvalidState` e `skippedOrderMissing` — qualquer valor > 0 gera entrada de log estruturada. Integração com alerta externo (e-mail/Telegram) é melhoria futura, não bloqueio.

## Testes novos da rodada final (`1dc5c2f`) — 4 testes

| Teste | O que prova |
| --- | --- |
| `PEDIDO INEXISTENTE: NADA é assentado` | Cirurgia de FK (`pg_constraint` → drop + DELETE do pedido, restauração no fim): pagamento pendente SEM pedido não é assentado, não é "reconciliação"; auditoria `expiry.skipped_order_missing` com âncora `orderId` + `skippedOrderMissing=1`. Vermelho antes do fix: exceção `notFound` matava a passada inteira. |
| `EXCEÇÃO real na renovação ... fases 2-3 NÃO rodam` | Banco indisponível (RENAME da tabela) ⇒ toda renovação LANÇA (engolida = incerteza). TTL 3000 ms, 3 exceções no heartbeat, margem vence ⇒ fases 2-3 bloqueadas. Nenhuma recusa, nenhuma confirmação — pura incerteza. |
| `RECUPERAÇÃO: falha transitória + renovação CONFIRMADA antes do limite` | Banco volta aos 1500 ms; heartbeat aos ~2000 ms RENOVA com sucesso ⇒ margem rearma, fases 2-3 rodam. Falha de rede transitória NÃO perde o lock indevidamente. |
| `deadLetter: token persistido DIVERGENTE preenchido` | Espelho do caso NULL: hook `SET lease_token = 'worker-b'` (worker-b ≠ worker-a) ⇒ dead-letter BLOQUEADA, evento volta à fila (`rejected=1`, `processedAt` NULL). Correspondência EXATA nos dois casos exigidos pela revisão. |

## Pendências para publicação

1. Aprovação humana da rodada final (`1dc5c2f`): os 5 pendências do veredito condicionado endereçados — ver seção "Rodada final" acima.
2. Decisão: push da `wip/v5-fencing` no PR #1 (substituindo a v4) ou PR novo. O CI (`api-gates.yml`) passa a executar os gates de forma independente no push.
3. **AUD-03 permanece pendente** (ledger, checksum, coordenação de migrations) — item de arquitetura independente, fora do escopo da v5.
4. SQLs de hardening e homologação com gateway real continuam bloqueados (produção congelada).
5. ATENÇÃO de ambiente: há trabalho paralelo em edição NESTE working tree (assistente IA: `admin-ai.ts`, `ai-assistant.ts`, `page.tsx`, testes `#n`) — NÃO faz parte da v5, não está commitado; os gates da v5 foram executados com esses arquivos temporariamente afastados (stash) e a tree devolvida ao estado encontrado.

## Pendências de ENDURECIMENTO (veredito final — não bloqueadores, próxima rodada pós-merge)

1. **Isolamento por registro na passada de expiração.** Falha de consulta ao provedor já é isolada (`queryWithRetry` ⇒ `skippedUnknown`), mas uma exceção em `finalizeExpiry`/`audit()` de UM registro (deadlock, erro pontual de banco) interrompe o processamento dos demais elegíveis da passada. Consequência atual: apenas ATRASO — nada é assentado errado (o registro falho faz rollback; a passada seguinte reprocessa, idempotente). Endurecimento desejado: `try/catch` por registro com contador `failed` no `ExpirySummary` + teste de prova (trigger RAISE num registro, segundo registro processado na mesma passada).
2. **Referência de tempo do lease.** A margem de segurança (`ctx.lost()`) usa o relógio LOCAL (`Date.now()`), enquanto `lease_expires_at` é controlado pelo relógio do BANCO. Divergência de relógio entre instâncias/banco afeta os dois lados. Endurecimento desejado: referência de tempo consistente com o banco (ex.: `now()` lido do banco na renovação) ou margem conservadora explicitando a tolerância de skew.
3. **Identificador estruturado para divergências financeiras.** A fila operacional hoje depende de eventos de `audit_logs` (interpretados por `late-payment-monitor.sql`). Melhoria futura: registro próprio com estado operacional (aberto/resolvido), facilitando alertas, métricas e relatórios — sem atualizar nem excluir o histórico original (append-only preservado).
