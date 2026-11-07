"use client";

/**
 * Verificação do segundo fator já ativado.
 *
 * Três caminhos: código TOTP, código de recuperação (uso único) ou passkey.
 * A API devolve a sessão elevada em todos eles.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { adminJson, clearCsrfToken, messageOf } from "../../../lib/api";

type MfaStatus = {
  mfaEnabled: boolean;
  sessionMfaVerified: boolean;
  hasTotp: boolean;
  passkeyCount: number;
};

export default function MfaVerifyPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [passkeys, setPasskeys] = useState(0);

  useEffect(() => {
    let alive = true;
    async function boot() {
      try {
        const status = await adminJson<MfaStatus>("/api/admin/mfa/status");
        if (!alive) return;
        if (!status.mfaEnabled) {
          router.replace("/mfa/setup");
          return;
        }
        if (status.sessionMfaVerified) {
          router.replace("/dashboard");
          return;
        }
        setPasskeys(status.passkeyCount);
      } catch (e) {
        if (alive) setError(messageOf(e, "Falha ao consultar a sessão."));
      } finally {
        if (alive) setLoading(false);
      }
    }
    boot();
    return () => {
      alive = false;
    };
  }, [router]);

  const verify = useCallback(async () => {
    const value = code.trim();
    if (!value) {
      setError("Informe o código.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const path =
        mode === "totp"
          ? "/api/admin/mfa/totp/verify"
          : "/api/admin/mfa/recovery/verify";
      await adminJson<{ ok: boolean }>(path, {
        method: "POST",
        body: JSON.stringify({ code: value }),
      });
      // A elevação rotaciona a sessão: o token CSRF em cache é do cookie antigo.
      clearCsrfToken();
      router.replace("/dashboard");
    } catch (e) {
      setError(messageOf(e, "Código inválido."));
    } finally {
      setBusy(false);
    }
  }, [code, mode, router]);

  const usePasskey = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const options = await adminJson<Record<string, unknown>>(
        "/api/admin/mfa/webauthn/auth/options",
        { method: "POST" },
      );
      const response = await startAuthentication({
        optionsJSON: options as never,
      });
      await adminJson<{ ok: boolean }>("/api/admin/mfa/webauthn/auth/verify", {
        method: "POST",
        body: JSON.stringify(response),
      });
      clearCsrfToken();
      router.replace("/dashboard");
    } catch (e) {
      setError(messageOf(e, "Não foi possível validar a passkey."));
    } finally {
      setBusy(false);
    }
  }, [router]);

  if (loading) {
    return (
      <main className="px-6 py-24">
        <div className="skel h-24 w-full max-w-xl" />
      </main>
    );
  }

  return (
    <main className="px-6 py-16">
      <header className="mb-10 border-b border-[#111] pb-6 max-w-xl">
        <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
          Verificação em duas etapas
        </span>
        <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white">
          Confirme sua identidade
        </h1>
        <p className="font-mono text-xs text-[#666] mt-4">
          {mode === "totp"
            ? "Digite o código de 6 dígitos que aparece no aplicativo autenticador."
            : "Digite um dos códigos de recuperação guardados na ativação."}
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          verify();
        }}
        className="border border-[#111] bg-[#050505] p-8 max-w-xl space-y-5"
        noValidate
      >
        <div className="field">
          <label htmlFor="mfa-code">
            {mode === "totp" ? "Código do autenticador" : "Código de recuperação"}
          </label>
          <input
            id="mfa-code"
            inputMode={mode === "totp" ? "numeric" : "text"}
            autoComplete="one-time-code"
            maxLength={mode === "totp" ? 6 : 12}
            className="input w-full text-center text-2xl tracking-[0.3em]"
            value={code}
            onChange={(e) =>
              setCode(
                mode === "totp"
                  ? e.target.value.replace(/\D/g, "")
                  : e.target.value.trim(),
              )
            }
            placeholder={mode === "totp" ? "000000" : "ABCD1234EF"}
          />
        </div>

        {error ? (
          <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
          {busy ? "Verificando..." : "Confirmar"}
        </button>

        <div className="flex flex-wrap gap-6 pt-4 border-t border-[#111]">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "totp" ? "recovery" : "totp");
              setCode("");
              setError("");
            }}
            className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] hover:text-[#8bcf16] transition-colors underline underline-offset-4"
          >
            {mode === "totp"
              ? "Usar código de recuperação"
              : "Usar código do autenticador"}
          </button>
          <button
            type="button"
            onClick={usePasskey}
            disabled={busy || passkeys === 0}
            className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] hover:text-[#8bcf16] transition-colors underline underline-offset-4 disabled:text-[#333] disabled:no-underline"
          >
            {passkeys === 0 ? "Sem passkey registrada" : "Usar passkey"}
          </button>
        </div>
      </form>
    </main>
  );
}
