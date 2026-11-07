# Pendências de segurança (registro factual)

> Atualizado: 2026-11-07. Não substitui implementação; registra lacunas verificadas.

## Troca de senha self-service do administrador (PENDENTE)

- **Estado verificado:** não há endpoint/UI de troca de senha autenticada para operadores do painel (`apps/api/src/routes`, `apps/admin`). Existe definição de senha no aceite de convite (`acceptInvite`) e reset emergencial de MFA via CLI (`admin:reset-mfa`) — **não** cobrem troca voluntária de senha pelo próprio administrador.
- **Risco:** credencial comprometida ou rotina de higiene sem fluxo seguro; rotação depende de processo manual fora do produto.
- **Implementação exigida quando priorizada (não fazer superficial):**
  1. API autenticada + CSRF + rate limit (ex.: `POST /api/admin/me/password` ou equivalente), exigindo senha atual **e** confirmação de nova senha; validação de força mínima consistente com política.
  2. **Invalidar todas as sessões do usuário após sucesso** (revogação global), preservando apenas se explicitamente decidido — padrão seguro: revogar todas e exigir novo login/MFA.
  3. Reautenticação/MFA recente ou passo equivalente para ação sensível (coerente com o gate MFA existente).
  4. Auditoria (`audit_logs`) sem registrar senha/token/código.
  5. UI acessível no admin, mensagens sem enumeração, testes de integração + E2E do fluxo.
- **Decisão desta etapa:** pendência registrada; nenhuma implementação superficial adicionada.
