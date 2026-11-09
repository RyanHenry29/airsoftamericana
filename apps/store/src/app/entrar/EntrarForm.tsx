"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { validateAuthField } from "../lib/authValidation";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type ApiError = {
  error?: {
    code?: string;
    message?: string;
    details?: {
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

/** Converte a resposta da API em texto que diz o que fazer. */
function messageForResponse(status: number, json: ApiError): string {
  const seconds = json.error?.details?.retryAfterSeconds;

  if (status === 429) {
    const minutes = seconds ? Math.max(1, Math.round(seconds / 60)) : 15;
    return `Muitas tentativas em pouco tempo. Espera ${minutes} min e entra de novo.`;
  }
  if (status === 401) {
    return "E-mail ou senha não conferem. Revisa os dois campos e entra de novo.";
  }
  if (status === 400) {
    return json.error?.message ?? "Algum dado veio errado. Revisa os campos e entra de novo.";
  }
  if (status >= 500) {
    return "O servidor não respondeu agora. Tenta de novo em instantes — se continuar, chama a gente no WhatsApp.";
  }
  return "Não deu pra entrar agora. Tenta de novo em instantes.";
}

export function EntrarForm() {
  const router = useRouter();
  const [values, setValues] = useState({ email: "", password: "" });
  const [touched, setTouched] = useState({ email: false, password: false });
  const [serverError, setServerError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const errors = useMemo(
    () => ({
      email: validateAuthField("email", values.email),
      password: validateAuthField("password", values.password),
    }),
    [values],
  );

  const pending = Object.values(errors).filter(Boolean).length;
  const blocked = pending > 0 && (touched.email || touched.password);

  const set = (field: "email" | "password") => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const blur = (field: "email" | "password") => () =>
    setTouched((current) => ({ ...current, [field]: true }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setServerError("");
    setTouched({ email: true, password: true });

    if (errors.email || errors.password) {
      setServerError("Confere os campos marcados antes de entrar.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: values.email.trim().toLowerCase(),
          password: values.password,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as ApiError;

      if (!res.ok) {
        setServerError(messageForResponse(res.status, json));
        return;
      }

      // A sessão vive em cookie httpOnly — nada de token no localStorage.
      router.push(safeNext());
      router.refresh();
    } catch {
      setServerError(
        "Sem conexão com o servidor. Confere a internet e entra de novo.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="mb-7">
        <span className="auth-title-bar" aria-hidden="true" />
        <h1 className="auth-title">Entrar</h1>
        <p className="auth-sub">
          E-mail e senha da sua conta. Ainda não tem?{" "}
          <Link href="/cadastro" className="auth-link">
            Cria em um minuto
          </Link>
          .
        </p>
      </div>

      <GoogleSignInButton label="Continuar com Google" />
      <div className="auth-divider" aria-hidden="true">
        ou
      </div>

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
            aria-invalid={Boolean(touched.email && errors.email)}
            aria-describedby={
              touched.email && errors.email ? "email-erro" : undefined
            }
          />
        </div>
        {touched.email && errors.email && (
          <p className="auth-hint auth-hint--bad" id="email-erro">
            {errors.email}
          </p>
        )}
      </div>

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
            autoComplete="current-password"
            required
            placeholder="sua senha"
            value={values.password}
            onChange={(event) => set("password")(event.target.value)}
            onBlur={blur("password")}
            aria-invalid={Boolean(touched.password && errors.password)}
            aria-describedby={
              touched.password && errors.password ? "senha-erro" : undefined
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
        {touched.password && errors.password && (
          <p className="auth-hint auth-hint--bad" id="senha-erro">
            {errors.password}
          </p>
        )}
      </div>

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
            Entrando
          </>
        ) : (
          <>
            Entrar
            <ArrowRight size={18} strokeWidth={2.4} className="arrow" aria-hidden="true" />
          </>
        )}
      </button>

      {blocked && (
        <p className="auth-pending" role="status">
          Faltam {pending} {pending === 1 ? "campo" : "campos"} pra liberar o
          acesso.
        </p>
      )}

      <p className="auth-switch">
        Não tem conta? <Link href="/cadastro">Criar conta grátis</Link>
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
