"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";

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

function friendlyOAuthError(raw: string): string {
  const msg = decodeURIComponent(raw.replace(/\+/g, " ")).trim();
  const lower = msg.toLowerCase();
  if (lower.includes("access_denied")) return "Acesso com Google cancelado. Você pode tentar entrar novamente quando quiser.";
  if (lower.includes("redirect") || lower.includes("callback")) return "A configuração de retorno do Google não confere. Verifique as Redirect URLs no Supabase e no Google Cloud.";
  if (lower.includes("invalid") && lower.includes("client")) return "Credenciais do Google inválidas na configuração do provedor. Revise Client ID/Secret no Supabase Auth.";
  return msg || "Não foi possível concluir o acesso com Google.";
}

export function CallbackClient() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const next = safeNext(new URLSearchParams(window.location.search).get("next"));

      const oauthError = readParam("error_description") || readParam("error");
      if (oauthError) {
        if (!cancelled) {
          setError(friendlyOAuthError(oauthError));
          setDetail("Se o problema persistir, confirme que o provedor Google está ativo no Supabase e que a URL de retorno inclui /auth/callback.");
        }
        return;
      }

      const accessToken = readParam("access_token");
      if (!accessToken) {
        if (!cancelled) {
          setError("O acesso com Google não retornou uma sessão válida.");
          setDetail("Tente entrar novamente. Se continuar, verifique as Redirect URLs no Supabase Auth (deve incluir https://airsoftamericana.vercel.app/auth/callback).");
        }
        return;
      }

      try {
        const res = await fetch(`${API_URL}/api/auth/google`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ accessToken }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
        if (!res.ok) {
          if (!cancelled) {
            setError(json.error?.message ?? "Não foi possível concluir o acesso com Google.");
            setDetail("A sessão do Google foi recebida, mas a API não conseguiu concluir o login. Tente novamente em instantes.");
          }
          return;
        }
        // Limpa o fragmento (contém o token) antes de navegar.
        window.history.replaceState(null, "", `/auth/callback?next=${encodeURIComponent(next)}`);
        router.replace(next);
        router.refresh();
      } catch {
        if (!cancelled) {
          setError("Sem conexão com o servidor.");
          setDetail("Verifique sua internet e tente entrar novamente.");
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <div style={{ maxWidth: 520 }}>
        <p role="alert" className="auth-error" style={{ marginBottom: "0.75rem" }}>
          <AlertTriangle size={15} strokeWidth={2.2} aria-hidden="true" />
          <span>{error}</span>
        </p>
        {detail ? <p className="auth-hint" style={{ marginBottom: "1rem" }}>{detail}</p> : null}
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link href="/entrar" className="auth-submit" style={{ width: "auto", minHeight: "2.75rem", padding: "0.75rem 1.1rem", textDecoration: "none" }}>
            <ArrowLeft size={16} aria-hidden="true" />
            Voltar para entrar
          </Link>
          <button type="button" className="auth-google" style={{ width: "auto" }} onClick={() => window.location.assign("/entrar")}>
            <RefreshCw size={16} aria-hidden="true" />
            Tentar novamente
          </button>
        </div>
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
