"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/newsletter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, source: "homepage" }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(json.error?.message ?? "Não foi possível cadastrar seu e-mail.");
        return;
      }
      setOk(true);
    } catch {
      setError("Erro de conexão. Tente novamente em instantes.");
    } finally {
      setBusy(false);
    }
  }

  if (ok) {
    return (
      <p className="newsletter-ok">
        <CheckCircle2 size={18} aria-hidden="true" />
        Feito. A gente avisa quando entrar novidade.
      </p>
    );
  }

  return (
    <form className="newsletter" onSubmit={onSubmit} noValidate>
      <label className="sr-only" htmlFor="newsletter-email">E-mail</label>
      <input
        id="newsletter-email"
        type="email"
        required
        className="input"
        placeholder="seu e-mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Seu e-mail"
      />
      <button type="submit" className="btn-primary" disabled={busy}>
        <Send size={16} strokeWidth={2.2} aria-hidden="true" />
        {busy ? "Enviando..." : "Me avisar"}
      </button>
      {error && (
        <p role="alert" className="text-sm font-semibold" style={{ color: "var(--destructive)" }}>
          {error}
        </p>
      )}
    </form>
  );
}
