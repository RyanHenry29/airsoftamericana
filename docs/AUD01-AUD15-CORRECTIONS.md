# AUD-01 + AUD-15 — Correções, Homologação e Rollback

Branch: `fix/aud01-aud15-pagamento`
Base: `master` (commit baseline `b9abf28`)
Estado: implementação completa e testada — **produção permanece congelada**; nada deste documento foi executado em produção.

---

## 1. O que a correção resolve

### AUD-01 — Sandbox em produção

| Camada | Correção |
|---|---|
| Registro de adapters (`payments/index.ts`) | `SandboxAdapter` só é registrado fora de produção (`NODE_ENV !== "production"`). Em produção nem chega ao registry. |
| Seleção (`payments/types.ts`) | `resolveActiveAdapter` elimina o fallback silencioso (`return registry.get("sandbox")`), exclui linhas `sandbox` da seleção em produção e devolve `undefined` quando não há gateway real — o checkout responde **503 `no_payment_gateway_enabled` ANTES de criar pedido ou reservar estoque**. |
| Barra final | `isSandboxProvider(adapter.provider)` em produção ⇒ 503 (defesa em profundidade). |
| Cielo (AUD-02) | Endpoint decidido por `creds.environment` (`"sandbox" | "production"`), com fallback por `NODE_ENV`. Adapter configurado para sandbox em produção é recusado no boot do adapter. |

Consequência prática para produção atual (config: `sandbox, enabled, default`): **checkout permanece 503** até o lojista configurar um gateway real — comportamento intencional (checkout comercial não liberado).

### AUD-15 — Máquina de estados

| Regra | Antes | Depois |
|---|---|---|
| Ordem | pedido → `pagamento_em_processamento` → `pagamento_aprovado` **antes** de `createPayment` (linha 351) | pedido nasce `aguardando_pagamento`; a transição para `pagamento_aprovado` só ocorre com **resultado financeiro efetivo** (captura confirmada no checkout OU webhook de aprovação) |
| PIX/boleto | tratado como aprovado na criação | permanece `aguardando_pagamento` até webhook/reconciliação |
| Cartão recusado | pedido ficava aprovado | pedido → `cancelado`, estoque liberado |
| Falha do provedor (`createPayment`/`capture`) | pedido ficava preso com estoque reservado | pedido → `cancelado` (libera estoque) + 503 |
| Concorrência | `transitionOrder` lê fora da transação (check-then-act) | `SELECT FOR UPDATE` dentro da transação; corrida decompõe em no-op detectado (`transition_noop`) |
| Regressão | webhook podia regride pagamento aprovado | `aprovado`/`estornado` não regridem; tentativa auditada (`payment.regression_ignored`) |
| Pagamento tardio | indefinido | pedido `cancelado` + `payment.approved` ⇒ estado preservado, audit `order.late_payment` com `decision: refund_required` — estorno é decisão humana, nunca automática |
| Corrida checkout×webhook | evento perdido (`payment_not_found`) | evento fica estacionado em `payment_events` (sem `payment_id`/`processed_at`), recuperado pelo checkout via `applyPendingEventsForPayment` |
| Idempotência checkout | cache em memória (frágil multi-instância) | `idempotency_keys` com unique + header `Idempotency-Key` opcional; 5 checkouts idênticos concorrentes ⇒ 1 pedido |
| Idempotência webhook | já existia (`unique(provider,eventId)`) | mantida + detecção de unique agora lê a cadeia de `cause` do drizzle |

Arquivo único de aplicação de eventos: `apps/api/src/services/payments/webhook-events.ts` — mesma fonte para webhook, recuperação de corrida e futura reconciliação (AUD-04/10).

## 2. Arquivos modificados

```
packages/shared/src/domain.ts                      — transições (aguardando_pagamento → aprovado/antifraude/revisão) + PAYMENT_PENDING_STATUSES
apps/api/src/services/checkout.ts                  — rework completo (gateway antes de escrita, idempotência, estados derivados do resultado)
apps/api/src/services/orders.ts                    — transitionOrder com FOR UPDATE + retorno booleano
apps/api/src/services/payments/types.ts            — resolveActiveAdapter sem fallback; guardas sandbox
apps/api/src/services/payments/index.ts            — sandbox fora de produção; Cielo com ambiente explícito
apps/api/src/services/payments/cielo.ts            — endpoint sandbox/production por configuração (AUD-02)
apps/api/src/services/payments/webhook-events.ts   — NOVO: applyPaymentEvent + applyPendingEventsForPayment
apps/api/src/routes/webhooks.ts                    — delega aplicação ao serviço único; evento estacionado na corrida
apps/api/src/routes/index.ts                       — header Idempotency-Key no checkout
apps/api/src/db/migrate.ts                         — payment_events.payment_id/processed_at nullable (ALTER idempotente)
apps/api/src/services/checkout.test.ts             — testes atualizados ao comportamento correto + idempotência
apps/api/src/services/payments-integrity.test.ts   — NOVO: 9 testes de integridade
docs/AUD01-AUD15-CORRECTIONS.md                    — este documento
```

## 3. Testes executados e resultados

| Suíte | Resultado |
|---|---|
| `npm test -w @airsoft/api` | **33 arquivos, 228 testes — 228 passed** |
| Suíte store (root) | **2 arquivos, 16 testes — 16 passed** |
| `tsc --noEmit` (api, store, admin) | **exit 0 nos três** |

Evidências específicas (`payments-integrity.test.ts`, todos PASS):

1. Cartão recusado → pedido `cancelado`, estoque zerado.
2. Cartão aprovado com captura → `pagamento_aprovado` derivado do resultado financeiro, `capturedAt` gravado.
3. Webhook `payment.approved` sobre PIX pendente → `aguardando_pagamento → pagamento_aprovado`.
4. Webhook duplicado → no-op; exatamente **uma** entrada de aprovação no histórico.
5. Regressão: `payment.recused` após `aprovado` → ignorado + audit `payment.regression_ignored`.
6. Pagamento tardio: `approved` sobre cancelado → `latePayment=true`, pedido permanece `cancelado`, audit `order.late_payment` com `decision: refund_required`.
7. `payment.expired` sobre PIX pendente → `cancelado`, estoque liberado.
8. Corrida: evento estacionado aplicado quando o pagamento passa a existir; `processedAt`/`paymentId` preenchidos.
9. Concorrência: dois webhooks `approved` em paralelo → **no máximo uma** transição; histórico com exatamente uma aprovação.

Evidências no `checkout.test.ts`: 503 sem gateway (sem pedido/sem reserva), idempotência sequencial (mesmo orderId), idempotência concorrente (5 paralelos = 1 pedido), 20 checkouts paralelos do último item (1 cria, 19 rejeitam, estoque íntegro).

## 4. Security Definer View — verificação e correção pendente

Verificação read-only executada em produção (MCP):

- Dono: `postgres` (controlado; diagnóstico não é dono e não possui INSERT/UPDATE/DELETE/TRIGGER sobre a view — confirmado pela matriz de privilégios do diagnóstico v3.2).
- Definição: expõe **somente** a allowlist; `credentials_encrypted` aparece apenas como booleano `credentials_present`. Ciphertext nunca sai pela view.
- Linter Supabase (`security_definer_view`, ERROR): é o desenho intencional — a view roda com os privilégios do dono para que `diag_audit` (sem qualquer privilégio na tabela base) veja apenas o booleano.

**Ajuste necessário (não executado — produção congelada):** o `relacl` herda do padrão Supabase grants de `anon`/`authenticated` sobre a view. Configuração de gateway não é dado público. Correção única:

```sql
REVOKE ALL ON public.gateway_audit_status FROM anon, authenticated, service_role;
GRANT SELECT ON public.gateway_audit_status TO diag_audit;
```

## 5. Função com search_path mutável

`prevent_audit_logs_mutation()` (trigger append-only de `audit_logs`) foi sinalizada pelo linter. O corpo não referencia nenhuma tabela por nome não-qualificado (apenas `RAISE EXCEPTION`), portanto o risco prático é nulo — mas a correção elimina o aviso:

```sql
ALTER FUNCTION public.prevent_audit_logs_mutation() SET search_path = pg_catalog, public;
```

Também não executada (produção congelada). Incluir na mesma janela de manutenção.

## 6. Procedimento de homologação com gateway real

Pré-requisitos (não executar sem autorização):

1. Escolher o provedor (recomendação do escopo: com 3DS 2.x, captura posterior e central de disputas).
2. Obter credenciais de **homologação** do provedor.
3. No admin → Configurações → Pagamentos: habilitar o provider, informar credenciais (cifradas com `GATEWAY_SECRETS_KEY`), definir métodos, `pix_discount_percent` e `capture_after_review`.
4. **Remover/desabilitar a linha `sandbox`** de `gateway_configs` (ou `enabled=false`) — em produção a correção a ignora de qualquer forma.
5. Definir `GATEWAY_ACTIVE` no ambiente (ex.: `mercadopago`).

Roteiro de validação (ambiente de homologação, banco de teste):

1. PIX: checkout → cobrança criada → pedido **`aguardando_pagamento`** → pagar no app → webhook → `pagamento_aprovado`. Sem pagamento: expira → `cancelado`, estoque liberado.
2. Cartão aprovação imediata: checkout → captura → `pagamento_aprovado` no retorno, sem esperar webhook.
3. Cartão recusa: → `cancelado` + estoque liberado + segunda tentativa permitida.
4. Captura após revisão: → `pagamento_em_processamento` com pagamento `autorizado`; aprovação manual captura; recusa cancela.
5. Webhook: duplicado (mesmo `eventId`) → resposta `{duplicate: true}`, estado inalterado; assinatura inválida → 401; evento de corrida (chegar antes do INSERT local) → aplicado pelo checkout.
6. Estorno após aprovação → `reembolsado`; pagamento tardio sobre cancelado → audit `order.late_payment` + fila de estorno manual.
7. Reconciliação (sempre que possível): `queryPayment` do adapter contra pagamentos `pendente` > 24h.
8. Concorrência: 20 checkouts paralelos do último item (suíte já automatiza) e 2 webhooks paralelos do mesmo evento.

Critério de saída: todos os fluxos acima com estado final conforme tabela do §1 e nenhum registro em `payment.regression_ignored` inesperado.

## 7. Plano de rollback

- **Deploy:** a correção é só código de aplicação + `ALTER` idempotente de `payment_events` (nullable). Rollback = deploy da revisão anterior (`ba22fa9`): reversível em minutos, sem reversão de schema necessária (colunas nullable não quebram o código antigo — colunas antes `NOT NULL` voltam a aceitar NULL sem impacto no código atual).
- **Config:** a linha `sandbox` de `gateway_configs` não é removida por este PR; rollback mantém o comportamento antigo (fallback sandbox) se a revisão anterior for restaurada — **atenção**: isso reabre o AUD-01. Registrar no incidente.
- **Código:** todos os novos caminhos são aditivos (`webhook-events.ts` novo; `checkout.ts` reescrito mantendo a assinatura pública `handleCheckout`); nenhum dado é migrado.
- **Reversão de dados:** nenhuma operação de dados faz parte do PR; se um deploy precisar voltar, os registros criados sob a nova máquina (histórico append-only) permanecem como evidência.

## 8. Riscos residuais

1. **Checkout permanecerá 503 em produção** até um gateway real ser configurado — intencional, mas é downtime do checkout comercial (loja segue em modo auditoria).
2. **Estorno de pagamento tardio é manual** — o sistema marca e audita; nenhum movimento financeiro automático. Reconciliação periódica (AUD-04/10) é a etapa seguinte para varrê-los.
3. **Cielo `parseWebhook` é permissivo** (mapeia tipo desconhecido para `payment.approved`) — pré-existente; assinatura ainda é obrigatória. Correção própria em PR futuro (AUD-02 complementar).
4. **`GATEWAY_ACTIVE` default `sandbox` no `config.ts` não foi alterado** — alterá-lo faria a API recusar boot em produção (downtime total). A barra de runtime (503) cobre o caso; saneamento do default é mudança de config no deploy autorizado.
5. **Fila de expiração de reservas (AUD-04) continua ausente** — reservas de pedidos nunca pagos ficam até evento externo (webhook de expiração ou cancelamento manual). Job de reconciliação é a correção planejada.
6. **Suíte depende de PGlite local** — os testes de concorrência exercitam serialização do driver; em Postgres real o `FOR UPDATE` é estrito (mais seguro, não menos testado). Homologação (§6) cobre o comportamento em Postgres real.
