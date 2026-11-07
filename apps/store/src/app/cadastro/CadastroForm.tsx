"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  IdCard,
  Loader2,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  User,
} from "lucide-react";
import {
  maskCpf,
  maskPhone,
  passwordStrength,
  validateAuthField,
  type AuthErrors,
  type AuthField,
} from "../lib/authValidation";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type ApiError = {
  error?: {
    code?: string;
    message?: string;
    details?: {
      formErrors?: string[];
      fieldErrors?: Record<string, string[]>;
      retryAfterSeconds?: number;
    };
  };
};

/** Só aceita caminho interno — nunca redireciona pra fora da loja. */
function safeNext(): string {
  const raw = new URLSearchParams(window.location.search).get("next");
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/conta";
}

function messageForResponse(status: number, json: ApiError): string {
  const seconds = json.error?.details?.retryAfterSeconds;

  if (status === 429) {
    const hours = seconds ? Math.max(1, Math.round(seconds / 3600)) : 24;
    return `Já criamos conta nesse e-mail mais de uma vez. Espera ${hours} h e tenta de novo — se for a mesma ficha, entra pelo login.`;
  }
  if (status === 409) {
    return "Esse e-mail já tem conta. Entra com ele ou cadastra outro e-mail.";
  }
  if (status === 400) {
    return (
      json.error?.message ?? "Algum dado veio errado. Revisa os campos e cria de novo."
    );
  }
  if (status >= 500) {
    return "O servidor não respondeu agora. Tenta de novo em instantes — se continuar, chama a gente no WhatsApp.";
  }
  return "Não deu pra criar a conta agora. Tenta de novo em instantes.";
}

const EMPTY_VALUES = {
  name: "",
  email: "",
  phone: "",
  cpf: "",
  password: "",
  confirm: "",
};

export function CadastroForm() {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY_VALUES);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverError, setServerError] = useState("");
  const [serverFieldErrors, setServerFieldErrors] = useState<
    Partial<Record<AuthField, string>>
  >({});
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const errors = useMemo<AuthErrors>(() => {
    const next: AuthErrors = {};

    const name = validateAuthField("name", values.name);
    if (name) next.name = name;

    const email = validateAuthField("email", values.email);
    if (email) next.email = email;

    const phone = validateAuthField("phone", values.phone);
    if (phone) next.phone = phone;

    const cpf = validateAuthField("cpf", values.cpf);
    if (cpf) next.cpf = cpf;

    const password = validateAuthField("password", values.password);
    if (password) next.password = password;

    const confirm = validateAuthField("confirm", values.confirm);
    if (confirm) next.confirm = confirm;
    else if (values.confirm !== values.password) {
      next.confirm = "As senhas não batem. Repete a segunda.";
    }

    return next;
  }, [values]);

  const pending = Object.keys(errors).length;
  const blocked = pending > 0 && Object.keys(touched).length > 0;

  const strength = passwordStrength(values.password);
  const confirmState =
    values.confirm.length === 0
      ? "idle"
      : values.confirm === values.password
        ? "ok"
        : "bad";

  const set =
    (field: AuthField) => (value: string) =>
      setValues((current) => ({ ...current, [field]: value }));

  const blur = (field: AuthField) => () =>
    setTouched((current) => ({ ...current, [field]: true }));

  const visibleError = (field: AuthField): string => {
    if (touched[field] && errors[field]) return errors[field];
    return serverFieldErrors[field] ?? "";
  };

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setServerError("");
    setServerFieldErrors({});
    setTouched({
      name: true,
      email: true,
      phone: true,
      cpf: true,
      password: true,
      confirm: true,
    });

    if (pending > 0) {
      setServerError("Confere os campos marcados antes de criar a conta.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim().toLowerCase(),
          password: values.password,
          cpf: values.cpf.replace(/\D/g, "") || undefined,
          phone: values.phone.replace(/\D/g, "") || undefined,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as ApiError;

      if (!res.ok) {
        const fieldErrors = json.error?.details?.fieldErrors ?? {};
        const mapped: Partial<Record<AuthField, string>> = {};
        for (const key of ["name", "email", "phone", "cpf", "password"] as const) {
          const message = fieldErrors[key]?.join(" ");
          if (message) mapped[key] = message;
        }
        setServerFieldErrors(mapped);
        setServerError(messageForResponse(res.status, json));
        return;
      }

      // A sessão vive em cookie httpOnly — nada de token no localStorage.
      router.push(safeNext());
      router.refresh();
    } catch {
      setServerError(
        "Sem conexão com o servidor. Confere a internet e cria de novo.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="mb-6">
        <span className="auth-title-bar" aria-hidden="true" />
        <h1 className="auth-title">Criar conta</h1>
        <p className="auth-sub">
          Sem taxa e sem assinatura. Preenche, guarda a senha e a ficha fica
          pronta pro primeiro pedido.
        </p>
      </div>

      {/* 01 — Identificação */}
      <fieldset className="auth-block" aria-label="Identificação">
        <span className="auth-block__num" aria-hidden="true">
          01 — Identificação
        </span>

        <div className="auth-field">
          <label className="auth-label" htmlFor="name">
            Nome completo
          </label>
          <div className="auth-wrap">
            <User size={16} strokeWidth={1.8} aria-hidden="true" />
            <input
              id="name"
              className="auth-input"
              autoComplete="name"
              required
              placeholder="como no documento"
              value={values.name}
              onChange={(event) => set("name")(event.target.value)}
              onBlur={blur("name")}
              aria-invalid={Boolean(visibleError("name"))}
              aria-describedby={visibleError("name") ? "name-erro" : undefined}
            />
          </div>
          {visibleError("name") && (
            <p className="auth-hint auth-hint--bad" id="name-erro">
              {visibleError("name")}
            </p>
          )}
        </div>

        <div className="auth-row auth-row--2">
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">
              E-mail
            </label>
            <div className="auth-wrap">
              <Mail size={16} strokeWidth={1.8} aria-hidden="true" />
              <input
                id="email"
                type="email"
                inputMode="email"
                className="auth-input"
                autoComplete="email"
                required
                placeholder="voce@email.com"
                value={values.email}
                onChange={(event) => set("email")(event.target.value)}
                onBlur={blur("email")}
                aria-invalid={Boolean(visibleError("email"))}
                aria-describedby={
                  visibleError("email") ? "email-erro" : undefined
                }
              />
            </div>
            {visibleError("email") && (
              <p className="auth-hint auth-hint--bad" id="email-erro">
                {visibleError("email")}
              </p>
            )}
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="phone">
              WhatsApp <span className="auth-optional">opcional</span>
            </label>
            <div className="auth-wrap">
              <Phone size={16} strokeWidth={1.8} aria-hidden="true" />
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                className="auth-input"
                autoComplete="tel"
                placeholder="(19) 99999-9999"
                value={values.phone}
                onChange={(event) => set("phone")(maskPhone(event.target.value))}
                onBlur={blur("phone")}
                aria-invalid={Boolean(visibleError("phone"))}
                aria-describedby={
                  visibleError("phone") ? "phone-erro" : undefined
                }
              />
            </div>
            {visibleError("phone") && (
              <p className="auth-hint auth-hint--bad" id="phone-erro">
                {visibleError("phone")}
              </p>
            )}
          </div>
        </div>
      </fieldset>

      {/* 02 — Documentação */}
      <fieldset className="auth-block" aria-label="Documentação">
        <span className="auth-block__num" aria-hidden="true">
          02 — Documentação
        </span>

        <div className="auth-field">
          <label className="auth-label" htmlFor="cpf">
            CPF <span className="auth-optional">opcional</span>
          </label>
          <div className="auth-wrap">
            <IdCard size={16} strokeWidth={1.8} aria-hidden="true" />
            <input
              id="cpf"
              inputMode="numeric"
              className="auth-input"
              placeholder="000.000.000-00"
              value={values.cpf}
              onChange={(event) => set("cpf")(maskCpf(event.target.value))}
              onBlur={blur("cpf")}
              aria-invalid={Boolean(visibleError("cpf"))}
              aria-describedby={visibleError("cpf") ? "cpf-erro" : "cpf-dica"}
            />
          </div>
          {visibleError("cpf") ? (
            <p className="auth-hint auth-hint--bad" id="cpf-erro">
              {visibleError("cpf")}
            </p>
          ) : (
            <p className="auth-hint" id="cpf-dica">
              Serve pra nota e pra conferência da compra. Dá pra deixar em branco.
            </p>
          )}
        </div>
      </fieldset>

      {/* 03 — Segurança */}
      <fieldset className="auth-block" aria-label="Segurança">
        <span className="auth-block__num" aria-hidden="true">
          03 — Segurança
        </span>

        <div className="auth-field">
          <label className="auth-label" htmlFor="password">
            Senha
          </label>
          <div className="auth-wrap">
            <Lock size={16} strokeWidth={1.8} aria-hidden="true" />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              className="auth-input auth-input--eye"
              autoComplete="new-password"
              required
              placeholder="mínimo 8 caracteres"
              value={values.password}
              onChange={(event) => set("password")(event.target.value)}
              onBlur={blur("password")}
              aria-invalid={Boolean(visibleError("password"))}
              aria-describedby={
                visibleError("password") ? "senha-erro" : "senha-medidor"
              }
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="auth-eye"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          <div
            className="strength"
            data-level={strength.level}
            aria-hidden="true"
          >
            <span />
            <span />
            <span />
            <span />
          </div>
          <p className="strength-label" id="senha-medidor">
            {strength.level === 0
              ? "8+ caracteres · misture letras e números"
              : `Senha ${strength.label.toLowerCase()}`}
          </p>
          {visibleError("password") && (
            <p className="auth-hint auth-hint--bad" id="senha-erro">
              {visibleError("password")}
            </p>
          )}
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="confirm">
            Confirmar senha
          </label>
          <div className="auth-wrap">
            <Lock size={16} strokeWidth={1.8} aria-hidden="true" />
            <input
              id="confirm"
              type={showPassword ? "text" : "password"}
              className="auth-input auth-input--eye"
              autoComplete="new-password"
              required
              placeholder="repete a senha"
              value={values.confirm}
              onChange={(event) => set("confirm")(event.target.value)}
              onBlur={blur("confirm")}
              aria-invalid={Boolean(visibleError("confirm"))}
              aria-describedby={
                visibleError("confirm") ? "confirm-erro" : undefined
              }
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="auth-eye"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          {confirmState === "ok" && !visibleError("confirm") && (
            <p className="auth-hint auth-hint--ok inline-flex items-center gap-1.5">
              <Check size={13} aria-hidden="true" />
              Senhas batem.
            </p>
          )}
          {visibleError("confirm") && (
            <p className="auth-hint auth-hint--bad" id="confirm-erro">
              {visibleError("confirm")}
            </p>
          )}
        </div>
      </fieldset>

      {serverError && (
        <p role="alert" className="auth-error mb-5">
          <AlertTriangle size={15} strokeWidth={2.2} aria-hidden="true" />
          <span>{serverError}</span>
        </p>
      )}

      <button type="submit" className="auth-submit" disabled={busy || blocked}>
        {busy ? (
          <>
            <Loader2 size={17} className="animate-spin" aria-hidden="true" />
            Criando conta
          </>
        ) : (
          <>
            Criar conta
            <ArrowRight size={18} strokeWidth={2.4} className="arrow" aria-hidden="true" />
          </>
        )}
      </button>

      {blocked && (
        <p className="auth-pending" role="status">
          Faltam {pending} {pending === 1 ? "campo" : "campos"} pra fechar a
          ficha.
        </p>
      )}

      <p className="auth-note mt-4 text-center">
        Endereço a gente pede só no checkout. Ao criar a conta você aceita os{" "}
        <Link href="/termos" className="auth-note-link">
          termos de compra
        </Link>{" "}
        e a{" "}
        <Link href="/privacidade" className="auth-note-link">
          política de privacidade
        </Link>{" "}
        (LGPD).
      </p>

      <p className="auth-switch">
        Já tem conta? <Link href="/entrar">Entrar</Link>
      </p>

      <div className="auth-seals">
        <span>
          <ShieldCheck size={13} strokeWidth={2} aria-hidden="true" />
          Compra protegida
        </span>
        <span>18+</span>
        <span>Dados guardados (LGPD)</span>
      </div>
    </form>
  );
}
