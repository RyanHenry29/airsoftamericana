-- language: SQL, file: docs/sql/late-payment-monitor.sql
-- MONITORAMENTO operacional de divergências financeiras (read-only).
-- Segura para executar a qualquer momento: apenas SELECTs em audit_logs.
--
-- O que alimenta estas consultas (código v5):
--   order.late_payment                      — pagamento aprovado após cancelamento
--                                             do pedido (decision: "refund_required").
--   expiry.skipped_invalid_order_state      — pagamento pendente cujo pedido não
--                                             aceita transição automática.
--   expiry.skipped_order_missing            — pagamento pendente sem pedido
--                                             correspondente (divergência tratável).
--
-- Estes registros são EVIDÊNCIA DURÁVEL, não fila de reembolso: cada item
-- aberto exige investigação e resolução por humano (ver seção operacional no
-- docs/review/pr1-v5-guia-de-revisao.md — responsável, SLA e procedimento).
--
-- Agenda: rodar na abertura do expediente comercial (diário) e antes do
-- fechamento de caixa. Consultas 1-3 = fila do dia; consulta 4 = envelhecimento
-- (itens acima do SLA).

-- 1) FILA ABERTA do dia: divergências financeiras ainda sem resolução.
--    status do pedido em after_json distingue "refund_required" (dinheiro
--    capturado — reembolso) de "recusado"/"order_missing" (sem captura —
--    investigação). Exclui registros com before_json de resolução (ver 3).
select l.created_at                  as registrado_em,
       l.action                      as tipo,
       l.entity                      as entidade,
       l.entity_id                   as registro_id,
       l.after_json                  as detalhes,
       l.correlation_id              as correlacao
from audit_logs l
where l.action in ('order.late_payment',
                   'expiry.skipped_invalid_order_state',
                   'expiry.skipped_order_missing')
  and l.created_at >= now() - interval '24 hours'
  and not exists (   -- resolução registrada para o mesmo registro
    select 1 from audit_logs r
    where r.action = 'order.late_payment_resolved'
      and r.entity_id = l.entity_id
      and r.created_at >= l.created_at
  )
order by l.created_at desc;

-- 2) TOTAIS por tipo nas últimas 24 h — visão rápida para o relatório do dia.
select action,
       count(*)                as ocorrencias,
       min(created_at)         as primeira,
       max(created_at)         as ultima
from audit_logs
where action in ('order.late_payment',
                 'expiry.skipped_invalid_order_state',
                 'expiry.skipped_order_missing')
  and created_at >= now() - interval '24 hours'
group by action
order by ocorrencias desc;

-- 3) RESOLUÇÕES registradas — cada item tratado ganha um
--    order.late_payment_resolved (actor = responsável, after_json = decisão).
--    Nenhum item entra aqui sem ticket: a resolução é registrada no audit_logs
--    com o id do registro original em entity_id.
select r.created_at           as resolvido_em,
       r.actor_label          as responsavel,
       r.entity_id            as registro_id,
       r.after_json           as decisao
from audit_logs r
where r.action = 'order.late_payment_resolved'
  and r.created_at >= now() - interval '7 days'
order by r.created_at desc;

-- 4) ENVELHECIMENTO: itens abertos há mais de 24 h (SLA estourado).
--    Qualquer linha aqui = prioridade do dia; > 48 h escalar para o
--    responsável pela operação financeira.
select l.action                as tipo,
       l.entity_id             as registro_id,
       l.created_at            as registrado_em,
       now() - l.created_at    as idade
from audit_logs l
where l.action in ('order.late_payment',
                   'expiry.skipped_invalid_order_state',
                   'expiry.skipped_order_missing')
  and l.created_at <  now() - interval '24 hours'
  and not exists (
    select 1 from audit_logs r
    where r.action = 'order.late_payment_resolved'
      and r.entity_id = l.entity_id
      and r.created_at >= l.created_at
  )
order by l.created_at asc;
