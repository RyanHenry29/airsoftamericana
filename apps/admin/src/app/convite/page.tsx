"use client";

/**
 * Aceite de convite: o operador define a senha da conta criada pelo
 * superadmin. A API devolve `mfaSetupRequired` — o próximo passo é ativar o
 * segundo fator no primeiro login.
 */

import { useEffect, useState } from "react";
import { API_URL, messageOf, parseApiError } from "../../lib/api";

export default function AcceptInvitePage() {
  const [token, setToken] = useState("");
  const [data, setData] = useState({ name: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("token");
    if (value) setToken(value);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (data.password.length < 8) {
      setError("A senha precisa de pelo menos 8 caracteres.");
      return;
    }
    if (data.password !== data.confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/invite/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          password: data.password,
          name: data.name.trim(),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(
          messageOf(
            parseApiError(json, res.status),
            "Convite inválido ou expirado.",
          ),
        );
        return;
      }
      setDone(true);
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#000] text-white flex items-center justify-center p-4">
      <section className="w-full max-w-lg border border-[#111] bg-[#050505] p-8">
        <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
          Convite do painel
        </span>
        <h1 className="font-display font-black text-4xl uppercase leading-none tracking-tighter text-white mb-6">
          {done ? "Conta criada" : "Ative seu acesso"}
        </h1>

        {done ? (
          <>
            <p className="font-mono text-xs text-[#666] mb-8">
              Entre no painel com o e-mail convidado e a senha que você definiu.
              Na primeira entrada o painel pede a ativação do segundo fator.
            </p>
            <a href="/login" className="btn-primary px-8 py-3">
              IR PARA O LOGIN
            </a>
          </>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="field">
              <label htmlFor="token">Token do convite</label>
              <input
                id="token"
                className="input w-full font-mono text-xs"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="name">Nome</label>
              <input
                id="name"
                className="input w-full"
                value={data.name}
                onChange={(e) => setData({ ...data, name: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Senha</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className="input w-full"
                value={data.password}
                onChange={(e) => setData({ ...data, password: e.target.value })}
                required
              />
              <p className="hint">Mínimo de 8 caracteres.</p>
            </div>
            <div className="field">
              <label htmlFor="confirm">Repetir a senha</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                className="input w-full"
                value={data.confirm}
                onChange={(e) => setData({ ...data, confirm: e.target.value })}
                required
              />
            </div>
            {error ? (
              <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
              {busy ? "Criando conta..." : "Criar minha conta"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
