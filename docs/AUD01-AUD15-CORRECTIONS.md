# AUD-01 + AUD-15 — Correções, Homologação e Rollback (v2)

Branch: `fix/aud01-aud15-pagamento`
Base: `master` remoto (`ba22fa9`) — PR reconstruído limpo (ver §2.1)
Estado: implementação completa e testada — **produção permanece congelada**; nada deste documento foi executado em produção.

Revisão v2 resolve os 8 pontos da revisão do PR #1: `processedAt` após a aplicação efetiva (ponto 1), atomicidade financeira em transação única (ponto 2), hash-compare de Idempotency-Key (ponto 3), validação financeira com consulta ao gateway (ponto 4), timeout ambíguo (ponto 5), PR limpo (ponto 6), SQL da Security Definer View (ponto 7) e os 9 cenários de teste obrigatórios + integração com PostgreSQL real (ponto 8).

---

## 1. O que a correção resolve

### AUD-01 — Sandbox em produção

| Camada | Correção |
|---|---|
| Registro de adapters (`payments/index.ts`) | `SandboxAdapter` só é registrado fora de produção. Em produção nem chega ao registry. |
| Seleção (`payments/types.ts`) | `resolveActiveAdapter` sem fallback silencioso; exclui `sandbox` da seleção em produção; sem gateway real ⇒ `undefined` ⇒ **503 `no_payment_gateway_enabled` ANTES de criar pedido ou reservar estoque**. |
| Cielo (AUD-02) | Endpoint por `creds.environment`; sandbox-mode em produção recusado no boot. |

### AUD-15 — Máquina de estados e consistência financeira

| Regra | Comportamento |
|---|---|
| Aprovação | Pedido nasce `aguardando_pagamento`; sai dele apenas por resultado financeiro efetivo (captura confirmada ou webhook), decisão humana ou expiração. PIX/boleto criados NUNCA aprovam. |
| Atomicidade (ponto 2) | `applyPaymentEvent` executa em UMA transação: re-leitura do pagamento `FOR UPDATE`, re-leitura do pedido `FOR UPDATE`, update do pagamento, transição do pedido (histórico + estoque via `transitionOrderInTx`), marcação de `processed_at` do evento — tudo junto. Crash no meio = nada aplicado. É impossível persistir `payment.status=aprovado` com `order.status=aguardando_pagamento` no fluxo novo. |
| `processedAt` (ponto 1) | Gravado DENTRO da transação de aplicação, nunca antes. Evento persistido com `processed_at IS NULL` até a efetivação; reentrega e boot reaplicam pendentes. |
| Concorrência | `transitionOrderInTx` com `SELECT FOR UPDATE`; dois webhooks paralelos do mesmo evento serializam no lock do pagamento; `already_applied` marca o evento e sai. |
| Regressão | `aprovado`/`estornado` não regridem; tentativa auditada (`payment.regression_ignored`) e evento marcado (reentrega não reprocessa eternamente). |
| Pagamento tardio | `approved` sobre cancelado ⇒ estado preservado, audit `order.late_payment` (`decision: refund_required`). Estorno NUNCA automático. |
| Validação financeira (ponto 4) | Antes de aplicar: transação (referência), moeda (só BRL), referência externa, conta do estabelecimento (quando configurada nas credenciais) e valor. Webhook sem valor ⇒ `adapter.queryPayment` confirma com o provedor. Divergência ⇒ `payment.event_rejected`, evento fica pendente para investigação — nunca vira aprovação. |
| Timeout ambíguo (ponto 5) | Falha em `createPayment`: consulta `adapter.queryPaymentByOrder`. Cobrança existe aprovada/autorizada ⇒ adota estado real (`pagamento_aprovado`/`pagamento_em_processamento`) + 503 `gateway_timeout_resolved`; pendente ⇒ pedido permanece aguardando com estoque reservado + 503 `gateway_unknown_result`; recusada/expirada ou inexistente (`null`) ⇒ falha definitiva, cancela com estoque livre; sem consulta disponível ⇒ desconhecido, NÃO cancela, reserva preservada, reconciliação resolve. Captura com timeout: pagamento `autorizado`, pedido `pagamento_em_processamento`, 503 `capture_unknown_result` — cancelar com autorização viva é proibido. |
| Idempotência checkout (ponto 3) | `payloadHash` semântico (cliente, itens, método, endereço, **cupom**, **serviço de frete**, parcelas, notas) comparado em TODA reutilização: mesma chave + payload diferente ⇒ **409 `idempotency_key_reuse`**, também na corrida concorrente. Chave automática sem header carrega janela de 5 min (retry deduplica; compra futura do mesmo carrinho é nova). Estado vive em `idempotency_keys` — vale entre instâncias e após reinicialização. |
| Idempotência webhook | `unique(provider,event_id)`; reentrega de evento pendente reaplica; processado ⇒ `{duplicate: true}`. |
| Corrida checkout×webhook | Evento estacionado (`payment_id`/`processed_at` NULL) é absorvido pelo checkout (`applyPendingEventsForPayment`). |
| Estados parciais legados | `repairPartialApplications` no boot: pagamento aprovado/recusado/expirado/estornado com pedido em `PAYMENT_PENDING_STATUSES` ⇒ transição corrigida + audit `payment.partial_repair`. |

## 2. Arquivos modificados

```
packages/shared/src/domain.ts                       — transições + PAYMENT_PENDING_STATUSES
apps/api/index.ts                                   — recuperação no boot (recoverPendingEvents + repairPartialApplications)
apps/api/src/services/checkout.ts                   — gateway antes da escrita, idempotência com hash-compare, timeout ambíguo
apps/api/src/services/orders.ts                     — transitionOrderInTx (núcleo transacional) + transitionOrder
apps/api/src/services/payments/types.ts             — guardas sandbox; QueryPaymentResult expandido; queryPayment/queryPaymentByOrder
apps/api/src/services/payments/index.ts             — sandbox fora de produção; Cielo por ambiente
apps/api/src/services/payments/cielo.ts             — endpoint sandbox/production por configuração (AUD-02)
apps/api/src/services/payments/sandbox.ts           — registro em memória + queryPayment/queryPaymentByOrder (testes)
apps/api/src/services/payments/webhook-events.ts    — aplicação atômica, validação financeira, recuperação e reparo
apps/api/src/routes/webhooks.ts                     — insert com processed_at NULL; reentrega reaplica; chargeback atômico
apps/api/src/routes/index.ts                        — header Idempotency-Key no checkout
apps/api/src/db/migrate.ts                          — payment_events.payment_id/processed_at nullable (ALTER idempotente)
apps/api/src/services/checkout.test.ts              — 503, idempotência, concorrência
apps/api/src/services/payments-integrity.test.ts    — 18 testes (9 v1 + 9 obrigatórios da revisão)
docs/AUD01-AUD15-CORRECTIONS.md                     — este documento
docs/sql/harden-gateway-audit-view.sql              — correção SQL (NÃO executada)
docs/sql/verify-gateway-audit-view.sql              — verificação read-only
```

### 2.1 PR limpo (ponto 6)

O PR original exibia 80 arquivos/2 commits porque o baseline de WIP pré-existente (`b9abf28`) entrou na história: o `master` LOCAL o continha, e a branch do PR descendia dele. Reconstrução:

1. Baseline preservado — push de `b9abf28` para `refs/heads/wip/baseline-pre-aud` (nada descartado).
2. Branch reconstruída a partir de `origin/master` (`ba22fa9`) com os commits da correção.
3. Force-push em `fix/aud01-aud15-pagamento` — o PR passa a conter SOMENTE as alterações autorizadas.

## 3. Recuperação de falhas parciais — como funciona

| Momento da falha | Estado deixado | Recuperação |
|---|---|---|
| Após insert do evento, antes da aplicação (crash do webhook) | Evento `processed_at NULL` | Reentrega do provedor reaplica (`duplicate` lê registro pendente); boot varre `recoverPendingEvents` |
| Dentro da transação de aplicação (crash em qualquer ponto) | **Nada** — tx roll back inteira | Não há estado parcial a recuperar |
| Após transação, antes da auditoria | Estado financeiro correto; faltam logs | Auditoria é observabilidade; próxima passada do boot não repete (idempotência por `already_applied`) |
| Estado parcial LEGADO (v1 pré-transação): pagamento atualizado, pedido não | Divergência no banco | `repairPartialApplications` no boot corrige e audita |
| Corrida checkout×webhook | Evento sem `payment_id` | Checkout absorve em `applyPendingEventsForPayment` após insert do pagamento; boot também varre |

A recuperação roda no boot (`apps/api/index.ts`) e é idempotente — qualquer instância, qualquer momento. `recoverPendingEvents` devolve `{scanned, applied, rejected, parked}` para observabilidade.

## 4. Testes executados e resultados

| Suíte | Resultado |
|---|---|
| API (PGlite) `npm test -w @airsoft/api` | **33 arquivos, 237/237 passed** |
| Store (root `npm test`) | **16/16 passed** |
| `tsc --noEmit` (api, store, admin) | **exit 0 nos três** |
| **PostgreSQL REAL** (`scripts/pg-integration.mjs`, embedded-postgres porta 55432) | **4 arquivos (integrity, checkout, orders, price-stock-transactional): 42/42 passed** |

Os 9 cenários obrigatórios (todos em `payments-integrity.test.ts`, todos PASS):

1. **Crash após persistir evento antes da transição** → boot reaplica (`recoverPendingEvents`), pedido aprovado, evento marcado.
2. **Crash após update do pagamento** (estado parcial) → `repairPartialApplications` conserte pedido + audit `payment.partial_repair`.
3. **Webhook duplicado após falha parcial** → reentrega consolida (`already_applied` + marcação) + reparo; exatamente 1 aprovação no histórico.
4. **Mesma Idempotency-Key com carrinhos diferentes** → 409 `idempotency_key_reuse`; mesmo payload → replay do MESMO pedido.
5. **Mesmo carrinho com cupom diferente** → fingerprints diferentes → 2 pedidos, `payloadHash` distintos.
6. **Valor de webhook divergente** → não aplica (`amount_mismatch`), pedido aguardando, pagamento pendente, audit `payment.event_rejected`.
7. **Gateway aceita a cobrança e a resposta sofre timeout** (fixture `TimeoutAdapter`) → 503 `gateway_unknown_result`, pedido `aguardando_pagamento`, estoque reservado (reserva preservada), pagamento `pendente`.
8. **Duas instâncias no mesmo evento simultaneamente** → ≤1 transição, exatamente 1 aprovação no histórico, evento marcado.
9. **Recuperação de eventos pendentes após reinicialização** → primeira passada aplica 2, segunda passada vazia (idempotente), sem duplicar transição.

## 5. Security Definer View — correção e verificação

Verificação read-only (diagnóstico v3.2 + catálogo): dono `postgres`; definição expõe somente a allowlist com `credentials_present` booleano (ciphertext nunca sai); `diag_audit` sem poderes de alteração.

Pendência: grants padrão Supabase (`anon`/`authenticated`/`service_role` com ALL sobre a view).

- Correção: `docs/sql/harden-gateway-audit-view.sql` — REVOKE dos três papéis + `GRANT SELECT` para `diag_audit` + `ALTER FUNCTION ... SET search_path = pg_catalog, public`. **NÃO executada** (produção congelada). Idempotente, com rollback documentado.
- Verificação: `docs/sql/verify-gateway-audit-view.sql` — somente SELECTs de catálogo; valida dono, ACL, privilégios efetivos, search_path e ausência de credenciais na definição.

## 6. Procedimento de homologação com gateway real

1. Provider de homologação configurado no admin (credenciais cifradas com `GATEWAY_SECRETS_KEY`), linha `sandbox` desabilitada.
2. PIX: checkout → `aguardando_pagamento` → webhook → `pagamento_aprovado`; sem pagamento → expira → `cancelado` + estoque livre.
3. Cartão aprovação imediata → `pagamento_aprovado` no retorno.
4. Cartão recusa → `cancelado` + estoque livre.
5. Captura após revisão → `pagamento_em_processamento` + pagamento `autorizado`; decisão humana captura ou cancela.
6. Webhook duplicado → `{duplicate:true}`; assinatura inválida → 401; evento de corrida → aplicado pelo checkout; valor divergente → `payment.event_rejected`.
7. Timeout de `createPayment`: com `queryPaymentByOrder` (cobrança viva) → pedido preservado; sem cobrança → cancelado.
8. Timeout de captura → `pagamento_em_processamento` + 503 `capture_unknown_result`.
9. Pagamento tardio → audit `order.late_payment` + fila manual de estorno.
10. Restart da API → log `payment event recovery at boot` com resumo.

Critério de saída: estados finais conforme §1, nenhum `payment.regression_ignored`/`payment.event_rejected` inesperado.

## 7. Plano de rollback

- **Deploy:** código de aplicação + `ALTER` idempotente (`payment_events` nullable). Rollback = redeploy de `ba22fa9`; colunas nullable não quebram o código anterior. Sem reversão de dados.
- **SQL da view (se executado):** rollback documentado no próprio `harden-gateway-audit-view.sql` (grants restaurados). O `REVOKE` só reduz privilégios — reversão devolve o padrão Supabase.
- **Config:** a linha `sandbox` de `gateway_configs` não é removida por este PR. Reverter o deploy reabre o AUD-01 (fallback volta a existir) — registrar em incidente.
- **Estados criados sob a nova máquina:** histórico append-only; nenhum dado migrado.

## 8. Riscos residuais

1. **Checkout 503 em produção** até gateway real configurado — intencional (AUD-01), é downtime comercial.
2. **Estorno de pagamento tardio é manual** — marcado e auditado; reconciliação periódica (AUD-04/10) é o próximo passo para varrê-los.
3. **Validação de conta do estabelecimento** só age quando as credenciais do gateway contêm `accountId` — provedores sem esse campo dependem de transação/valor/referência.
4. **Cielo `parseWebhook` permissivo** (tipo desconhecido → `payment.approved`) — pré-existente; correção própria em PR futuro (AUD-02 complementar).
5. **Fila de expiração de reservas (AUD-04) fora deste PR** — reservas de pedidos nunca pagos dependem de webhook de expiração/cancelamento manual; job de reconciliação planejado.
6. **`GATEWAY_ACTIVE` default `sandbox` no `config.ts` inalterado** — alterar derrubaria o boot em produção; a barra de runtime (503) cobre o caso.
7. **Desconhecido sem `queryPaymentByOrder`** mantém reserva indefinidamente até reconciliação/webhook — com adapter sem consulta, o operador precisa acompanhar; os adapters atuais (sandbox; Cielo a implementar no PR seguinte) já expõem o método.
