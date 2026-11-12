# Auth: Google, e-mails e Supabase (checklist operacional)

Este documento cobre o que **não** fica 100% no código da aplicação: configuração do Supabase Auth, provedor Google, URLs de retorno e templates de e-mail.

## 1. Google login (app + Supabase + Google Cloud)

### No app (código)
- Botão Google: `apps/store/src/app/lib/googleAuth.ts` (`redirectToGoogle`) → inicia OAuth no Supabase (`/auth/v1/authorize?provider=google`); o botão em si é do `components/AuthScreen.tsx`.
- Callback: `apps/store/src/app/auth/callback/*` → lê `access_token` do fragmento, chama `POST /api/auth/google`.
- API: `apps/api/index.ts` (handler Vercel) e `apps/api/src/routes/index.ts` (Fastify/local) → valida o token em `SUPABASE_URL/auth/v1/user` com `SUPABASE_PUBLISHABLE_KEY`, exige e-mail confirmado, cria/localiza cliente e emite cookie `aa_customer`.

### Supabase Dashboard (obrigatório)
**Authentication → Providers → Google**
- Provider: **Enabled**.
- Client ID (Google Cloud OAuth): preenchido.
- Client Secret: preenchido.

**Authentication → URL Configuration**
- Site URL: `https://airsoftamericana.vercel.app` (trocar para domínio próprio quando houver).
- Redirect URLs (adicionar todas as que usar):
  - `https://airsoftamericana.vercel.app/auth/callback`
  - `https://airsoftamericana.vercel.app/**` (opcional, conforme política)
  - `http://localhost:3000/auth/callback` (dev)
  - `http://localhost:3001/*` se o admin usar auth via Supabase (hoje o admin usa login próprio da API)

**Variáveis de ambiente (API e, se aplicável, store)**
- `SUPABASE_URL=https://psswdwsvybsqrflhpuqx.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=...` (publishable/anon key do projeto)

### Google Cloud Console (obrigatório)
- OAuth 2.0 Client (Web application) com:
  - Authorized redirect URI do Supabase (copiar do painel do Supabase Auth → Google): normalmente `https://<project-ref>.supabase.co/auth/v1/callback`
  - Se usar login direto sem Supabase callback intermediário, ajustar conforme fluxo; **no fluxo atual, o redirect do Supabase é o que importa**.
- Tela de consentimento OAuth publicada/configurada (para usuários externos, conforme necessário).

### Erros comuns (Image 1 / callback)
| Sintoma | Causa provável | Ação |
|---|---|---|
| "access_denied" | Usuário cancelou ou consent bloqueado | Tentar novamente; revisar consent screen |
| Redirect/callback inválido | Redirect URL não está na allowlist do Supabase | Adicionar `.../auth/callback` nas Redirect URLs |
| "Sessão do Google inválida ou expirada" | Token não validado pela API/Supabase | Verificar `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` na API; confirmar provider ativo |
| "Conta Google sem e-mail verificado" | E-mail não confirmado no provedor | Exigir e-mail verificado; revisar config do provider |
| 404/500 no `/api/auth/google` em produção | API antiga deployada ou handler sem rota | Deploy da API com o `apps/api/index.ts` atualizado |

## 2. E-mails de confirmação/autenticação (Supabase)

Os e-mails transacionais de **Supabase Auth** (confirmação, magic link, reset de senha — se habilitados) são controlados no **Supabase Dashboard → Authentication → Email Templates** (e SMTP, se configurado). O visual final depende do template do Supabase + provedor de e-mail.

### Recomendação operacional
1. **Ativar SMTP próprio** (ex.: Resend, Postmark, SES) em Authentication → SMTP Settings para melhor entregabilidade e identidade visual.
2. Ajustar **Sender name** para `Airsoft Americana` e sender email do domínio.
3. Revisar templates em PT-BR, tom profissional, sem links quebrados.
4. Testar: cadastro/confirmação, reset de senha (se usado), login com Google (geralmente não envia e-mail de senha, mas pode enviar confirmação conforme config).

### Template base — Confirmação de cadastro (PT-BR)
**Assunto:** Confirme seu acesso — Airsoft Americana

**Corpo (texto/HTML simples, adaptar no editor do Supabase):**
```text
Olá,

Recebemos seu cadastro na Airsoft Americana.

Para confirmar seu e-mail e ativar o acesso, use o link abaixo:
{{ .ConfirmationURL }}

Se você não solicitou este cadastro, pode ignorar esta mensagem.

Airsoft Americana
Atendimento: {{ .SiteURL }}
```

### Template base — Redefinição de senha (PT-BR)
**Assunto:** Redefina sua senha — Airsoft Americana

```text
Olá,

Recebemos uma solicitação para redefinir a senha da sua conta na Airsoft Americana.

Para criar uma nova senha, use o link abaixo:
{{ .ConfirmationURL }}

Se você não solicitou esta alteração, ignore esta mensagem. Sua senha atual permanece a mesma.

Airsoft Americana
```

### Template base — Magic link (se habilitado)
**Assunto:** Seu link de acesso — Airsoft Americana

```text
Olá,

Use o link abaixo para acessar sua conta na Airsoft Americana:
{{ .ConfirmationURL }}

Este link expira em breve. Se você não solicitou, ignore esta mensagem.

Airsoft Americana
```

> Variáveis do Supabase (`{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}` etc.) devem ser mantidas conforme a documentação do Supabase Email Templates.

## 3. Observações de UX (app)
- O login por e-mail/senha do app usa a API própria (`/api/auth/login`, `/api/auth/register`) e **não** depende dos templates de confirmação do Supabase, a menos que o fluxo seja migrado para Supabase Auth completo.
- O login com Google usa Supabase OAuth + `/api/auth/google` da API para criar sessão própria (`aa_customer`).
- Para exigir confirmação de e-mail no fluxo próprio (não-Supabase), seria necessário implementar verificação de e-mail na API/banco e telas de "verifique seu e-mail" — **não implementado neste ciclo**.

## 4. Após mudar domínio
- Atualizar Site URL e Redirect URLs no Supabase.
- Atualizar `NEXT_PUBLIC_SITE_URL`, `STORE_URL`/`ADMIN_URL` na API/store conforme arquitetura.
- Revisar `COOKIE_SAMESITE` (com domínio próprio/registrável compartilhado, geralmente `strict`/`lax` é mais seguro; com `*.vercel.app` separado, `none` + `Secure` pode ser necessário conforme o fluxo).