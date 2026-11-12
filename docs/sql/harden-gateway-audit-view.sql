-- language: SQL, file: docs/sql/harden-gateway-audit-view.sql
-- AUD — Security Definer View `gateway_audit_status` (ponto 7 da revisão)
--
-- Situação confirmada em produção (diagnóstico v3.2, read-only):
--   dono: postgres (controlado); definição expõe só a allowlist, com
--   credentials_encrypted reduzido ao booleano credentials_present.
-- Pendência: o relacl herda os grants padrão Supabase — anon/authenticated/
--   service_role têm ALL (arwdDxtm) sobre a VIEW. Configuração de gateway
--   (métodos, captura, desconto PIX) não é dado público.
--
-- NÃO EXECUTAR sem autorização específica do responsável — produção congelada.
-- Janela sugerida: mesma janela de manutenção do deploy do PR.
-- Idempotente: REVOKE sem grant anterior é no-op; GRANT re-aplica.

BEGIN;

-- 1) Revoga todo acesso público/role de app à view de status de gateways.
REVOKE ALL ON public.gateway_audit_status FROM anon;
REVOKE ALL ON public.gateway_audit_status FROM authenticated;
REVOKE ALL ON public.gateway_audit_status FROM service_role;

-- 2) Garante SELECT apenas para o papel de diagnóstico (read-only).
GRANT SELECT ON public.gateway_audit_status TO diag_audit;

-- 3) search_path fixo na trigger de append-only (linter WARN
--    function_search_path_mutable). O corpo só faz RAISE EXCEPTION, risco
--    prático nulo — a correção elimina o aviso e blinda o padrão.
ALTER FUNCTION public.prevent_audit_logs_mutation() SET search_path = pg_catalog, public;

COMMIT;

-- Rollback (se necessário, antes do próximo ciclo):
--   GRANT ALL ON public.gateway_audit_status TO anon, authenticated, service_role;
--   REVOKE ALL ON public.gateway_audit_status FROM diag_audit;
--   ALTER FUNCTION public.prevent_audit_logs_mutation() RESET search_path;
