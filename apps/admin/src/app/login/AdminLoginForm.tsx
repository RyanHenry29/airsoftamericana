"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  API_URL,
  clearCsrfToken,
  messageOf,
  parseApiError,
} from "../../lib/api";

type LoginPayload = {
  user?: { id: string; name: string; email: string; role: string };
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
};

export function AdminLoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({ email: "", password: "" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/admin-login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: data.email.trim().toLowerCase(),
          password: data.password,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as LoginPayload &
        Record<string, unknown>;
      if (!res.ok) {
        setError(
          messageOf(
            parseApiError(json, res.status),
            "E-mail ou senha incorretos.",
          ),
        );
        return;
      }
      // O login rotaciona a sessão: o token CSRF em cache pertence à anterior.
      clearCsrfToken();
      // O painel só abre depois do segundo fator: setup pendente ou
      // verificação pendente mandam o operador para a tela certa.
      if (json.mfaSetupRequired) {
        router.replace("/mfa/setup");
        return;
      }
      if (json.mfaRequired) {
        router.replace("/mfa/verify");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          className="input w-full"
          autoComplete="email"
          required
          value={data.email}
          onChange={(e) => setData({ ...data, email: e.target.value })}
          placeholder="admin@airsoftamericana.com.br"
        />
      </div>
      <div className="field">
        <label htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          className="input w-full"
          autoComplete="current-password"
          required
          value={data.password}
          onChange={(e) => setData({ ...data, password: e.target.value })}
          placeholder="Sua senha"
        />
      </div>
      {error && (
        <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
        {busy ? "Entrando..." : "Entrar no Sistema"}
      </button>
      <p className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333]">
        Acesso restrito a operadores · verificação em duas etapas obrigatória
      </p>
    </form>
  );
}
