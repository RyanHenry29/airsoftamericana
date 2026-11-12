"use client";

// language: TSX, file: apps/store/src/app/redefinir-senha/RedefinirForm.tsx, target: Next.js App Router
// Troca de senha pelo link do e-mail. Sem token na URL a tela só orienta a
// pedir um novo; link expirado/usado volta pra tela de pedido com o motivo.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { passwordStrength, validateAuthField } from "../lib/authValidation";

const API_URL =
  "";

type ApiError = {
  error?: {
    code?: string;
    message?: string;
    details?: { fieldErrors?: Record<string, string[]> };
  };
};

function messageForResponse(status: number, json: ApiError): string {
  if (status === 400) {
    const field = json.error?.details?.fieldErrors?.password?.[0];
    return field ?? json.error?.message ?? "Confere os campos e tenta de novo.";
  }
  if (status >= 500) {
    return "O servidor não respondeu agora. Tenta de novo em instantes.";
  }
  return "Não deu pra trocar a senha agora. Tenta de novo em instantes.";
}

export function RedefinirForm({ token }: { token: string }) {
  const router = useRouter();
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [touched, setTouched] = useState({ password: false, confirm: false });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [done, setDone] = useState(false);

  const errors = {
    password: touched.password ? validateAuthField("password", values.password) : "",
    confirm: touched.confirm
      ? values.confirm !== values.password
        ? "As senhas não batem. Repete a segunda."
        : validateAuthField("confirm", values.confirm)
      : "",
  };
  const strength = passwordStrength(values.password);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setServerError("");
    setTouched({ password: true, confirm: true });

    const passwordError = validateAuthField("password", values.password);
    if (passwordError || values.confirm !== values.password) {
      setServerError(passwordError || "As senhas não batem. Repete a segunda.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password: values.password }),
      });
      const json = (await res.json().catch(() => ({}))) as ApiError;
      if (!res.ok) {
        setServerError(messageForResponse(res.status, json));
        return;
      }
      setDone(true);
      // Sessão antiga não vale mais com a senha trocada — manda pra entrada.
      setTimeout(() => {
        router.push("/entrar");
        router.refresh();
      }, 2500);
    } catch {
      setServerError("Sem conexão com o servidor. Confere a internet e tenta de novo.");
    } finally {
      setBusy(false);
    }
  }

  // Sem token na URL: alguém abriu a rota na mão ou recarregou sem query.
  if (!token) {
    return (
      <div>
        <span className="auth-title-bar" aria-hidden="true" />
        <h1 className="auth-title">Link incompleto</h1>
        <p className="auth-sub">
          Esse endereço precisa do token que chega no seu e-mail. Peça um link
          novo e abre direto do e-mail.
        </p>
        <p className="auth-error" role="alert" style={{ marginTop: "1.5rem" }}>
          <AlertTriangle size={15} strokeWidth={2.2} aria-hidden="true" />
          <span>Sem o token não dá pra confirmar que é você.</span>
        </p>
        <Link href="/esqueci-a-senha" className="auth-submit" style={{ marginTop: "1.5rem", display: "block", textAlign: "center" }}>
          Pedir link novo
          <ArrowRight size={18} strokeWidth={2.4} className="arrow" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div>
        <span className="auth-title-bar" aria-hidden="true" />
        <h1 className="auth-title">Senha trocada</h1>
        <p className="auth-sub">
          Sua senha nova já está valendo. Entrando de novo pra conferir…
        </p>
        <p className="auth-hint auth-hint--ok" style={{ marginTop: "1rem" }}>
          <ShieldCheck size={13} strokeWidth={2} aria-hidden="true" /> Conta
          protegida com a senha nova.
        </p>
        <Link href="/entrar" className="auth-submit" style={{ marginTop: "1.5rem", display: "block", textAlign: "center" }}>
          Ir pra entrada
          <ArrowRight size={18} strokeWidth={2.4} className="arrow" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="mb-7">
        <span className="auth-title-bar" aria-hidden="true" />
        <h1 className="auth-title">Senha nova</h1>
        <p className="auth-sub">
          Cria uma senha que você não usa em outro site. O link vale uma vez só —
          depois de trocar, pede outro se precisar.
        </p>
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor="password">
          <KeyRound size={13} strokeWidth={2} aria-hidden="true" /> Nova senha
        </label>
        <div className="auth-wrap">
          <input
            id="password"
            type={show ? "text" : "password"}
            className="auth-input auth-input--eye"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            placeholder="mínimo de 8 caracteres"
            value={values.password}
            onChange={(event) => {
              const next = { ...values, password: event.target.value };
              setValues(next);
              if (touched.password) {
                const error = validateAuthField("password", next.password);
                if (!error) setServerError((current) => (current.startsWith("A senha") ? "" : current));
              }
            }}
            onBlur={() => setTouched((current) => ({ ...current, password: true }))}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "senha-erro" : undefined}
          />
          <button
            type="button"
            onClick={() => setShow((visible) => !visible)}
            className="auth-eye"
            aria-label={show ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={show}
          >
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        {errors.password && (
          <p className="auth-hint auth-hint--bad" id="senha-erro">
            {errors.password}
          </p>
        )}
        {values.password && !errors.password && (
          <p className="auth-hint auth-hint--ok">
            Força: {strength.label}
          </p>
        )}
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor="confirm">
          <Lock size={14} strokeWidth={2} aria-hidden="true" />
          Repete a senha
        </label>
        <div className="auth-wrap">
          <input
            id="confirm"
            type={show ? "text" : "password"}
            className="auth-input"
            autoComplete="new-password"
            required
            maxLength={128}
            placeholder="digita de novo"
            value={values.confirm}
            onChange={(event) => setValues((current) => ({ ...current, confirm: event.target.value }))}
            onBlur={() => setTouched((current) => ({ ...current, confirm: true }))}
            aria-invalid={Boolean(errors.confirm)}
            aria-describedby={errors.confirm ? "confirm-erro" : undefined}
          />
        </div>
        {errors.confirm && (
          <p className="auth-hint auth-hint--bad" id="confirm-erro">
            {errors.confirm}
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
            Trocando
          </>
        ) : (
          <>
            Trocar senha
            <ArrowRight size={18} strokeWidth={2.4} className="arrow" aria-hidden="true" />
          </>
        )}
      </button>

      <p className="auth-switch">
        <Link href="/esqueci-a-senha">Pedir outro link</Link>
      </p>
    </form>
  );
}
