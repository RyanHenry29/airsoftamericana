"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://psswdwsvybsqrflhpuqx.supabase.co";

/** Só aceita caminho interno — preserva o destino após o login. */
function safeNext(): string {
  const raw = new URLSearchParams(window.location.search).get("next");
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/conta";
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M9 7.36v3.49h4.85a4.15 4.15 0 0 1-1.8 2.72l2.9 2.25C16.64 14.27 17.64 11.87 17.64 9c0-.66-.06-1.3-.17-1.91H9z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.95-2.18l-2.9-2.25c-.8.54-1.83.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#4A90E2" d="M3.96 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.17.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3-2.33z" />
      <path fill="#FBBC05" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.96 8.96 0 0 0 9 0 9 9 0 0 0 .96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function GoogleSignInButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function onClick() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext())}`;
      const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
      window.location.assign(url);
    } catch {
      setError("Não foi possível abrir o acesso com Google. Tente de novo.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="auth-google" onClick={onClick} disabled={busy}>
        {busy ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <GoogleMark />}
        {busy ? "Abrindo Google" : label}
      </button>
      {error && (
        <p role="alert" className="auth-hint auth-hint--bad">
          {error}
        </p>
      )}
    </div>
  );
}
