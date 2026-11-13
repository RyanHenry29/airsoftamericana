# AUD-01 + AUD-15 — Correções, Homologação e Rollback (v4)

Branch: `fix/aud01-aud15-pagamento`
Base: `master` remoto (`ba22fa9`) — PR reconstruído limpo (ver §2.1)
Estado: implementação completa e testada — **produção permanece congelada**; nada deste documento foi executado em produção.

A revisão **v2** resolveu os 8 pontos da primeira revisão do PR #1. A **v3** resolveu os 4 pontos A–D da segunda revisão. A **v4** endurece os cinco itens apontados na terceira revisão: **1** claim atômico com lease (`FOR UPDATE SKIP LOCKED`) e recuperação de lease expirado; **2** dead-letter nunca descarta referência "ainda não disponível" (parked sai só por idade); **3** reparo atômico incluindo a auditoria na transação; **4** expiração com tolerância (grace) para consistência eventual, dupla confirmação, retentativas e varrimento periódico; **5** exigência estrutural de origem autenticada (assinatura) para qualquer aprovação. Detalhes em §1.1/§1.2.

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

### 1.1 Revisão v3 — pontos A–D

**A — Fila de recuperação multi-instância** (`recoverPendingEvents`):

| Mecanismo | Comportamento |
|---|---|
| Multi-instância | Evento reivindicado com `attempts+1`/`lastAttemptAt` commitados antes da aplicação. Janela de corrida mínima entre instâncias é corrigida pela idempotência transacional de `applyPaymentEvent` (`FOR UPDATE` do pagamento + `already_applied`) — o claim é eficiência, não mutex; nunca há dupla aplicação. |
| Backoff | Evento com `last_attempt_at` dentro de `minBackoffMs` (default 60 s) é pulado na passada (`skipped_backoff`). |
| Limite de tentativas | `attempts >= maxAttempts` (default 30) OU evento com mais de `maxAgeDays` (default 30) ⇒ dead-letter. |
| Dead-letter | Coluna `dead_letter=true` + `processed_at` gravado + audit `payment.event_dead_letter` com motivo. **Evento permanentemente inválido NUNCA bloqueia a fila.** Motivos: `invalid_payload`, `missing_transaction_reference`, `unknown_provider`, `payment_never_arrived`, `max_attempts_<divergência>`. |
| Divergência financeira recorrente | `amount_mismatch`/`currency_mismatch`/`account_mismatch`/`account_unverified`/`transaction_mismatch`/`gateway_query_unavailable` além do limite de tentativas ⇒ dead-letter com o motivo na auditoria — nunca reprocessa indefinidamente. |

**B — Reparo idempotente com auditoria tipada**: a divergência é definida pela JUNÇÃO (pagamento definitivo × pedido em `PAYMENT_PENDING_STATUSES`); o primeiro reparo tira o pedido da condição, então passadas seguintes não encontram nada. Estoque é liberado uma única vez. Audit `payment.partial_repair` carrega `automatic: true`, `kind: "partial_repair"`, `trigger: "boot"`, `actorLabel "recovery:boot"` — intervenção humana usa `order.transition` com actorLabel de usuário.

**C — Expiração segura de reservas** (novo `payments/expiry.ts`, `expireStaleReservations`): toda decisão automática de cancelamento é precedida de consulta ao provedor (`queryPaymentByOrder`) — pendente/falha/sem consulta nunca liberam; cobrança aprovada durante a reserva é aplicada. Gancho no boot.

**D — Vinculação da conta do estabelecimento** (em `validateFinancialEvent`): um identificador QUE EXISTE não pode ficar sem verificação.

| Configuração | Evento | Resultado |
|---|---|---|
| Credenciais com `accountId` | Claim presente e divergente | `account_mismatch` — rejeita |
| Credenciais com `accountId` | Approved sem claim | `account_binding_missing` — rejeita (gateway configurado para vincular deve ecoar o identificador) |
| Credenciais SEM `accountId` | Claim presente | `account_unverified` — rejeita; correção é configuração (`accountId` nas credenciais), não código |
| Nenhum dos lados informa | Approved | Aprovação **não silenciosa**: audit `payment.account_binding_missing` como advertência; demais validações (transação, moeda, valor, referência) continuam válidas |

**Requisito de homologação:** gateway real configurado para vincular conta exige `accountId` cadastrado nas credenciais (§6, passo 11).

### 1.2 Revisão v4 — endurecimento dos cinco itens da terceira revisão

**1 — Claim atômico com lease** (`recoverPendingEvents` v4):

| Mecanismo | Comportamento |
|---|---|
| Exclusão de reivindicação | Claim em transação curta: `SELECT ... FOR UPDATE SKIP LOCKED` com guarda condicional `lease_expires_at IS NULL OR <= now()`. Segundo worker em corrida recebe ZERO linhas — sem contagem duplicada de tentativas, sem consultas simultâneas ao gateway, sem limite estourado sob processamento alheio (`skipped_lease`). |
| Recuperação de lease | `lease_expires_at` (default 2 min, `leaseMs`) EXPIRA SOZINHO: crash do worker devolve o evento à fila — testado (lease ativo ⇒ `skipped_lease` 1 e nada aplicado; lease expirado ⇒ evento aplicado). |
| Dead-letter sem corrida | Decisões de dead-letter por divergência/idade só são alcançadas APÓS claim próprio bem-sucedido (outro worker segurando o lease ⇒ pulado antes de processar). Update de dead-letter com guarda `processed_at IS NULL AND dead_letter=false`. |

**2 — Parked ≠ inválido**: evento cujo pagamento AINDA não existe (corrida checkout×webhook) é "referência ainda não disponível" — permanece estacionado INDEPENDENTE de tentativas (testado: 99 tentativas simuladas, `parked` 1, `deadLettered` 0) e só sai por IDADE (`maxAgeDays`, default 30 dias). `invalid_payload`/`missing_transaction_reference`/`unknown_provider` são invalidade PERMANENTE (nunca se tornarão aplicáveis) — dead-letter imediato sem disputar lease.

**3 — Reparo atômico**: transição + histórico + estoque + AUDITORIA correm na MESMA transação (`audit` recebe o tx). Falha em qualquer ponto = rollback completo; boot seguinte repete — sem janela "pedido movido, auditoria perdida". Captura pendente é intocada: `autorizado` NÃO está no conjunto definitivo (testado). Paralelismo: duas instâncias ⇒ 1 transição, 1 auditoria (testado).

**4 — Expiração endurecida** (`payments/expiry.ts` v4):

| Mecanismo | Comportamento |
|---|---|
| Tolerância (grace) | `null` do provedor só é tratado como ausência definitiva APÓS `notFoundGraceMinutes` (default 24 h) da criação do pedido — resposta negativa precoce de provedor com consistência eventual NÃO derruba reserva (audit `expiry.skipped_notfound_grace`). |
| Dupla confirmação | Após o grace, `null` exige 2ª consulta imediata ainda `null` — blip de consistência não vira cancelamento (testado: 1ª null, 2ª pendente ⇒ skip). |
| Retentativas | Consultas falhas são retentadas (2×, 500 ms) antes de virarem "desconhecido" — falha transitória não vira decisão. |
| Idempotência expiração × confirmação tardia | Update do pagamento GUARDADO por `status = 'pendente'` com re-leitura: webhook que resolveu a cobrança na janela vence a expiração; segunda passada encontra `scanned` 0 (testado). |
| Varrimento periódico | `startPaymentMaintenance` (default 15 min, não-reentrante, `unref`) além do hook de boot — processos longevos têm reservas abandonadas varridas. |

**5 — Origem autenticada (ponto D, v4)**: `applyPaymentEvent` recebe `signatureValid`; `signatureValid === false` rejeita SEM exceção (`event_not_authenticated`) mesmo com transação/valor/moeda válidos (testado). Em produção a rota responde 401 antes de aplicar; o campo torna a exigência estrutural também fora da rota. A advertência do caminho "nenhum dos lados informa conta" registra a evidência de origem (`origin.signatureVerified`, `transactionMatched`, `amountValidated`, `currencyBRL`). A aprovação nesse caminho continua condicionada a: assinatura verificada (401 sem ela), adapter do provider registrado, pagamento localizado por `provider + providerTransactionId`, valor/moeda/referência validados no mesmo fluxo.

## 2. Arquivos modificados

```
packages/shared/src/domain.ts                       — transições + PAYMENT_PENDING_STATUSES
apps/api/index.ts                                   — recuperação no boot + varrimento periódico (startPaymentMaintenance)
apps/api/src/services/checkout.ts                   — gateway antes da escrita, idempotência com hash-compare, timeout ambíguo
apps/api/src/services/orders.ts                     — transitionOrderInTx (núcleo transacional) + transitionOrder
apps/api/src/services/payments/types.ts             — guardas sandbox; QueryPaymentResult expandido; queryPayment/queryPaymentByOrder
apps/api/src/services/payments/index.ts             — sandbox fora de produção; Cielo por ambiente
apps/api/src/services/payments/cielo.ts             — endpoint sandbox/production por configuração (AUD-02)
apps/api/src/services/payments/sandbox.ts           — registro em memória + queryPayment/queryPaymentByOrder (testes)
apps/api/src/services/payments/expiry.ts            — v3 ponto C: expiração segura de reservas (nunca às cegas)
apps/api/src/services/payments/webhook-events.ts    — aplicação atômica, validação financeira, fila v3 (claim/backoff/dead-letter) e reparo
apps/api/src/routes/webhooks.ts                     — insert com processed_at NULL; reentrega reaplica; chargeback atômico
apps/api/src/routes/index.ts                        — header Idempotency-Key no checkout
apps/api/src/db/schema.ts                           — payment_events: nullable + colunas de fila (attempts/last_attempt_at/last_error/dead_letter/lease_expires_at)
apps/api/src/db/migrate.ts                          — ALTERs idempotentes das colunas acima
apps/api/src/services/checkout.test.ts              — 503, idempotência, concorrência
apps/api/src/services/payments-integrity.test.ts    — 40 testes (9 obrigatórios v1/v2 + 22 dos pontos A–D v3/v4 + base)
docs/review/pr1-v4-full.diff                        — diff completo `ba22fa9..head` (revisão independente da UI)
docs/review/pr1-v4-guia-de-revisao.md               — mapa dos hunks por item da revisão
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
| Após insert do evento, antes da aplicação (crash do webhook) | Evento `processed_at NULL` | Reentrega do provedor reaplica (`duplicate` lê registro pendente); boot varre `recoverPendingEvents` com claim/backoff/dead-letter (v3 ponto A) |
| Dentro da transação de aplicação (crash em qualquer ponto) | **Nada** — tx roll back inteira | Não há estado parcial a recuperar |
| Após transação, antes da auditoria | Estado financeiro correto; faltam logs | Auditoria é observabilidade; próxima passada do boot não repete (idempotência por `already_applied`) |
| Estado parcial LEGADO (v1 pré-transação): pagamento atualizado, pedido não | Divergência no banco | `repairPartialApplications` no boot corrige (idempotente por construção, v3 ponto B) e audita |
| Corrida checkout×webhook | Evento sem `payment_id` | Checkout absorve em `applyPendingEventsForPayment` após insert do pagamento; boot também varre (com limite de tentativas/idade ⇒ dead-letter) |

A recuperação roda no boot (`apps/api/index.ts`) e é idempotente — qualquer instância, qualquer momento. `recoverPendingEvents` devolve `{scanned, applied, rejected, parked, deadLettered, skippedBackoff}`; `expireStaleReservations` devolve `{scanned, cancelled, approved, skipped}` — tudo no log `payment event recovery at boot`.

## 4. Testes executados e resultados

| Suíte | Resultado |
|---|---|
| API (PGlite) `npm test -w @airsoft/api` | **33 arquivos, 259/259 passed** (9 testes novos da v4) |
| Store/Admin (root `npm test`) | zero arquivos de teste por design (mensagem informativa) |
| `tsc --noEmit` (api, store, admin) | **exit 0 nos três** |
| **PostgreSQL REAL** (`scripts/pg-integration.mjs`, embedded-postgres porta 55432) | **4 arquivos (integrity, checkout, orders, price-stock-transactional): 64/64 passed** |

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

Os 13 cenários da segunda revisão (v3, todos em `payments-integrity.test.ts`, todos PASS):

**Ponto A — fila multi-instância:**
1. **Duas instâncias em `recoverPendingEvents` paralelas** → estado final consistente, exatamente 1 aprovação no histórico, evento marcado, sem dead-letter.
2. **Payload permanentemente inválido** → dead-letter imediato (`invalid_payload`), segunda passada com fila vazia, audit `payment.event_dead_letter`.
3. **Evento estacionado além do limite de tentativas** (`maxAttempts: 1`) → dead-letter `payment_never_arrived` — fila nunca bloqueia indefinidamente.
4. **Divergência financeira recorrente além do limite** → dead-letter com motivo; pedido permanece aguardando (divergência nunca aprova).

**Ponto B — reparo idempotente:**
5. **Reinicialização repetida** → primeira passada repara (1 transição, estoque liberado uma vez), segunda e terceira passadas não encontram nada; 1 auditoria com `automatic: true`/`actorLabel "recovery:boot"`; histórico com 1 cancelado.

**Ponto C — expiração segura:**
6. **Cobrança pendente no provedor** → expiração NÃO libera estoque (reserva preservada), audit `expiry.skipped_charge_alive`.
7. **Provedor confirma ausência de cobrança** → cancelamento com estoque liberado.
8. **Cobrança aprovada no provedor durante a reserva** → pedido aprovado, nunca cancelado, audit `expiry.late_confirmation`.
9. **Adapter sem consulta (consulta falha)** → expiração NUNCA libera às cegas.

**Ponto D — vinculação de conta:**
10. **Evento com claim + credenciais sem `accountId`** → `account_unverified`, nunca aprovação silenciosa.
11. **Credenciais com `accountId` + approved sem claim** → `account_binding_missing`, pedido permanece aguardando.
12. **Nenhum dos lados informa conta** → aprova com advertência auditada (`payment.account_binding_missing`).
13. **Claim divergente do configurado** → `account_mismatch`.

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
10. Restart da API → log `payment event recovery at boot` com os resumos de `recoverPendingEvents`, `repairPartialApplications` e `expireStaleReservations`; varrimento periódico a cada 15 min cobre processos longevos.
11. **Vinculação de conta (v3):** com `accountId` nas credenciais do gateway, evento aprovado sem eco do identificador ⇒ `account_binding_missing` (recusa); claim divergente ⇒ `account_mismatch`. Sem `accountId` em nenhum dos lados ⇒ aprovação segue com advertência auditada — configure o `accountId` antes de homologar um gateway que exige vinculação.
12. **Origem (v4):** webhook sem assinatura válida ⇒ 401 na rota, evento nunca aplicado; qualquer caminho interno com `signatureValid: false` ⇒ `event_not_authenticated` (recusa).

Critério de saída: estados finais conforme §1, nenhum `payment.regression_ignored`/`payment.event_rejected` inesperado.

## 7. Plano de rollback

- **Deploy:** código de aplicação + `ALTER`s idempotentes (`payment_events` nullable + colunas de fila com defaults, incluindo `lease_expires_at` nullable). Rollback = redeploy de `ba22fa9`; colunas novas são aditivas com default e não quebram o código anterior. Sem reversão de dados.
- **SQL da view (se executado):** rollback documentado no próprio `harden-gateway-audit-view.sql` (grants restaurados). O `REVOKE` só reduz privilégios — reversão devolve o padrão Supabase.
- **Config:** a linha `sandbox` de `gateway_configs` não é removida por este PR. Reverter o deploy reabre o AUD-01 (fallback volta a existir) — registrar em incidente.
- **Estados criados sob a nova máquina:** histórico append-only; nenhum dado migrado.

## 8. Riscos residuais

1. **Checkout 503 em produção** até gateway real configurado — intencional (AUD-01), é downtime comercial.
2. **Estorno de pagamento tardio é manual** — marcado e auditado; reconciliação periódica (AUD-04/10) é o próximo passo para varrê-los.
3. **Validação de conta v4**: com `accountId` configurado, a vinculação é exigida (`account_binding_missing`/`account_mismatch`/`account_unverified` rejeitam). Sem `accountId` em ambos os lados, a aprovação exige origem autenticada (assinatura — `event_not_authenticated` caso contrário), pagamento localizado por provider+transação e valor/moeda/referência validados; advertência auditada registra a evidência. Configuração do `accountId` é passo de homologação obrigatório (§6).
4. **Cielo `parseWebhook` permissivo** (tipo desconhecido → `payment.approved`) — pré-existente; correção própria em PR futuro (AUD-02 complementar).
5. **Job agendado dedicado do AUD-04** fora deste PR — mitigado: `expireStaleReservations` roda no boot E a cada 15 min (`startPaymentMaintenance`); tolerância (grace 24 h), dupla confirmação e updates guardados impedem liberação de cobrança confirmável. Job com política própria de configuração por provedor é o próximo passo.
6. **Eventos parked** (corrida checkout×webhook) permanecem estacionados até 30 dias por idade — o varrimento periódico consome tentativas com backoff; monitorar `skipped_lease`/`parked` no log de manutenção.
6. **`GATEWAY_ACTIVE` default `sandbox` no `config.ts` inalterado** — alterar derrubaria o boot em produção; a barra de runtime (503) cobre o caso.
7. **Desconhecido sem `queryPaymentByOrder`** mantém reserva indefinidamente até reconciliação/webhook — com adapter sem consulta, o operador precisa acompanhar; os adapters atuais (sandbox; Cielo a implementar no PR seguinte) já expõem o método.
