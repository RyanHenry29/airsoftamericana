-- language: SQL, file: docs/sql/verify-gateway-audit-view.sql
-- VERIFICAÇÃO read-only pós-correção (ou auditoria pré-correção) da
-- Security Definer View. Segura para executar a qualquer momento:
-- apenas SELECTs de catálogo — nenhuma escrita, nenhuma DDL.
--
-- Resultado esperado APÓS docs/sql/harden-gateway-audit-view.sql:
--   1. dono = postgres
--   2. relacl NÃO contém arwdDxtm/postgres para anon/authenticated/service_role
--   3. diag_audit presente com 'r' (SELECT) apenas
--   4. prevent_audit_logs_mutation com prosearchpath 'pg_catalog, public'
--   5. definição da view contém credentials_present (booleano) e NÃO contém
--      credentials_encrypted como coluna exposta

-- 1) Dono e ACL completos da view.
select c.relname as view_name,
       r.rolname  as owner,
       c.relacl::text as acl
from pg_class c
join pg_roles r on r.oid = c.relowner
where c.oid = 'public.gateway_audit_status'::regclass;

-- 2) Privilégios efetivos por papel (information_schema).
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'gateway_audit_status'
order by grantee, privilege_type;

-- 3) search_path fixo da trigger function.
select p.proname,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
where p.oid = 'public.prevent_audit_logs_mutation()'::regprocedure;

-- 4) Definição da view — credenciais nunca expostas, só o booleano.
select pg_get_viewdef('public.gateway_audit_status'::regclass, true) as definition;

-- 5) O papel de diagnóstico não pode alterar nada pela view.
select has_table_privilege('diag_audit', 'public.gateway_audit_status', 'INSERT') as can_insert,
       has_table_privilege('diag_audit', 'public.gateway_audit_status', 'UPDATE') as can_update,
       has_table_privilege('diag_audit', 'public.gateway_audit_status', 'DELETE') as can_delete,
       has_table_privilege('diag_audit', 'public.gateway_audit_status', 'SELECT') as can_select;
