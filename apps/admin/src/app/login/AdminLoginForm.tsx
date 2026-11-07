"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
        body: JSON.stringify({ email: data.email.trim().toLowerCase(), password: data.password }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; token?: string };
      if (!res.ok) {
        setError(json.error?.message ?? "E-mail ou senha incorretos.");
        return;
      }
      if (json.token) localStorage.setItem("aa_admin_token", json.token);
      router.push("/dashboard");
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
        <input id="email" type="email" className="input" autoComplete="email" required value={data.email} onChange={(e) => setData({ ...data, email: e.target.value })} placeholder="admin@airsoftamericana.com.br" />
      </div>
      <div className="field">
        <label htmlFor="password">Senha</label>
        <input id="password" type="password" className="input" autoComplete="current-password" required value={data.password} onChange={(e) => setData({ ...data, password: e.target.value })} placeholder="Sua senha" />
      </div>
      {error && (
        <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold">{error}</p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "Entrando..." : "Entrar no Sistema"}
      </button>
    </form>
  );
}
