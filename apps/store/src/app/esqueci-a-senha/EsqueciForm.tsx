"use client";

// language: TSX, file: apps/store/src/app/esqueci-a-senha/EsqueciForm.tsx, target: Next.js App Router
// Pedido de link de redefinição. A resposta do servidor é genérica por desenho
// (não revela se o e-mail existe) — a tela espelha isso: mesmo texto saiu
// querendo o e-mail cadastrado ou não.
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, Mail } from "lucide-react";
import { validateAuthField } from "../lib/authValidation";

const API_URL =
  "";

type ApiError = {
  error?: {
    code?: string;
    message?: string;
    details?: { retryAfterSeconds?: number };
  };
};

/** Texto que diz o que fazer — 503 mostra o que falta configurar, 429 a espera. */
function messageForResponse(status: number, json: ApiError): string {
  const seconds = json.error?.details?.retryAfterSeconds;
  if (status === 429) {
    const minutes = seconds ? Math.max(1, Math.round(seconds / 60)) : 15;
    return `Muitas solicitações em pouco tempo. Espera ${minutes} min e pede de novo.`;
  }
  if (status === 503) {
    return "O envio de e-mail não está ativo agora. Chama a gente no WhatsApp da loja que a gente redefini pra você.";
  }
  if (status === 400) {
    return json.error?.message ?? "Confere o e-mail no formato certo (ex.: nome@dominio.com.br).";
  }
  if (status >= 500) {
    return "O servidor não respondeu agora. Tenta de novo em instantes.";
  }
  return "Não deu pra enviar agora. Tenta de novo em instantes.";
}

export function EsqueciForm() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [sent, setSent] = useState(false);

  const fieldError = touched ? validateAuthField("email", email) : "";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setServerError("");
    setTouched(true);

    const error = validateAuthField("email", email);
    if (error) {
      setServerError(error);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const json = (await res.json().catch(() => ({}))) as ApiError & { message?: string };
      if (!res.ok) {
        setServerError(messageForResponse(res.status, json));
        return;
      }
      setSent(true);
    } catch {
      setServerError("Sem conexão com o servidor. Confere a internet e tenta de novo.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div>
        <span className="auth-title-bar" aria-hidden="true" />
        <h1 className="auth-title">Confere o e-mail</h1>
        <p className="auth-sub">
          Se existir uma conta com esse e-mail, o link de redefinição chega em
          instantes e vale por 60 minutos. Não apareceu? Espera uns minutos e
          olha a caixa de spam.
        </p>

        <p className="auth-note" style={{ marginTop: "1.5rem" }}>
          Pediu e não era você? Pode ignorar — ninguém muda sua senha sem abrir
          o link no e-mail.
        </p>

        <button
          type="button"
          className="auth-submit"
          style={{ marginTop: "1.5rem" }}
          onClick={() => {
            setSent(false);
            setEmail("");
            setTouched(false);
          }}
        >
          Pedir outro link
          <ArrowRight size={18} strokeWidth={2.4} className="arrow" aria-hidden="true" />
        </button>

        <p className="auth-switch">
          Lembrou a senha? <Link href="/entrar">Voltar pra entrada</Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="mb-7">
        <span className="auth-title-bar" aria-hidden="true" />
        <h1 className="auth-title">Esqueci a senha</h1>
        <p className="auth-sub">
          Digita o e-mail da sua conta. A gente manda um link pra você criar uma
          senha nova —{" "}
          <Link href="/entrar" className="auth-link">
            lembrei, voltar
          </Link>
          .
        </p>
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor="email">
          <Mail size={14} strokeWidth={2} aria-hidden="true" />
          E-mail
        </label>
        <div className="auth-wrap">
          <input
            id="email"
            type="email"
            inputMode="email"
            className="auth-input"
            autoComplete="email"
            required
            placeholder="voce@email.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? "email-erro" : undefined}
          />
        </div>
        {fieldError && (
          <p className="auth-hint auth-hint--bad" id="email-erro">
            {fieldError}
          </p>
        )}
      </div>

      {serverError && (
        <p role="alert" className="auth-error mb-5">
          <AlertTriangle size={15} strokeWidth={2.2} aria-hidden="true" />
          <span>{serverError}</span>
        </p>
      )}

      <button type="submit" className="auth-submit" disabled={busy}>
        {busy ? (
          <>
            <Loader2 size={17} className="animate-spin" aria-hidden="true" />
            Enviando
          </>
        ) : (
          <>
            Enviar link
            <ArrowRight size={18} strokeWidth={2.4} className="arrow" aria-hidden="true" />
          </>
        )}
      </button>

      <p className="auth-switch">
        Não tem conta? <Link href="/cadastro">Criar conta grátis</Link>
      </p>
    </form>
  );
}
