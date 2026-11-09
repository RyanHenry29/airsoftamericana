"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

const API_URL = "";

/** Só aceita caminho interno — nunca redireciona pra fora da loja. */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/conta";
}

/** Lê um parâmetro do fragmento (#a=b&c=d) ou da query string. */
function readParam(name: string): string | null {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const fromHash = new URLSearchParams(hash).get(name);
  if (fromHash) return fromHash;
  return new URLSearchParams(window.location.search).get(name);
}

export function CallbackClient() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const next = safeNext(new URLSearchParams(window.location.search).get("next"));

      const oauthError = readParam("error_description") || readParam("error");
      if (oauthError) {
        if (!cancelled) setError(decodeURIComponent(oauthError.replace(/\+/g, " ")));
        return;
      }

      const accessToken = readParam("access_token");
      if (!accessToken) {
        if (!cancelled) setError("O acesso com Google não retornou uma sessão. Tente entrar de novo.");
        return;
      }

      try {
        const res = await fetch(`${API_URL}/api/auth/google`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ accessToken }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        if (!res.ok) {
          if (!cancelled) setError(json.error?.message ?? "Não foi possível concluir o acesso com Google.");
          return;
        }
        // Limpa o fragmento (contém o token) antes de navegar.
        window.history.replaceState(null, "", `/auth/callback?next=${encodeURIComponent(next)}`);
        router.replace(next);
        router.refresh();
      } catch {
        if (!cancelled) setError("Sem conexão com o servidor. Tente entrar de novo.");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <div className="auth-field" style={{ maxWidth: 480 }}>
        <p role="alert" className="auth-error">
          <AlertTriangle size={15} strokeWidth={2.2} aria-hidden="true" />
          <span>{error}</span>
        </p>
        <p className="auth-switch" style={{ justifyContent: "flex-start" }}>
          <a href="/entrar">Voltar para entrar</a>
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", color: "#929890" }}>
      <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      <span>Concluindo acesso com Google…</span>
    </div>
  );
}
