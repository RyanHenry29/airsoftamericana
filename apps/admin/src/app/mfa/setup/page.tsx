"use client";

/**
 * Ativação do segundo fator (TOTP) — obrigatório para todo operador.
 *
 * Fluxo: a API devolve o otpauth; o painel mostra o QR e o segredo; o
 * operador confere o código de 6 dígitos; a API confirma, libera a sessão e
 * devolve os códigos de recuperação (exibidos uma única vez).
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { adminJson, clearCsrfToken, messageOf } from "../../../lib/api";

type MfaStatus = {
  mfaEnabled: boolean;
  sessionMfaVerified: boolean;
  hasTotp: boolean;
  passkeyCount: number;
};
type SetupPayload = { otpauthUrl: string };
type ConfirmPayload = { ok: boolean; recoveryCodes?: string[] };

function secretFrom(otpauthUrl: string): string {
  try {
    return new URL(otpauthUrl).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

export default function MfaSetupPage() {
  const router = useRouter();
  const [qr, setQr] = useState<string>("");
  const [otpauth, setOtpauth] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function boot() {
      try {
        const status = await adminJson<MfaStatus>("/api/admin/mfa/status");
        if (!alive) return;
        if (status.mfaEnabled) {
          router.replace("/dashboard");
          return;
        }
        const setup = await adminJson<SetupPayload>("/api/admin/mfa/totp/setup", {
          method: "POST",
        });
        const url = setup.otpauthUrl;
        const image = await QRCode.toDataURL(url, {
          width: 280,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#000000ff", light: "#ffffffff" },
        });
        if (!alive) return;
        setOtpauth(url);
        setQr(image);
        setSecret(secretFrom(url));
      } catch (e) {
        if (alive) setError(messageOf(e, "Falha ao iniciar a configuração do MFA."));
      } finally {
        if (alive) setLoading(false);
      }
    }
    boot();
    return () => {
      alive = false;
    };
  }, [router]);

  const confirm = useCallback(async () => {
    const value = code.replace(/\D/g, "");
    if (value.length !== 6) {
      setError("Informe os 6 dígitos do aplicativo autenticador.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await adminJson<ConfirmPayload>("/api/admin/mfa/totp/confirm", {
        method: "POST",
        body: JSON.stringify({ code: value }),
      });
      if (res.recoveryCodes?.length) {
        setCodes(res.recoveryCodes);
      } else {
        // A elevação rotaciona a sessão: o token CSRF em cache é doCookie antigo.
        clearCsrfToken();
        router.replace("/dashboard");
      }
    } catch (e) {
      setError(messageOf(e, "Código inválido."));
    } finally {
      setBusy(false);
    }
  }, [code, router]);

  const registerPasskey = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const options = await adminJson<Record<string, unknown>>(
        "/api/admin/mfa/webauthn/register/options",
        { method: "POST" },
      );
      const response = await startRegistration({
        optionsJSON: options as never,
      });
      const res = await adminJson<ConfirmPayload>(
        "/api/admin/mfa/webauthn/register/verify",
        { method: "POST", body: JSON.stringify(response) },
      );
      if (res.recoveryCodes?.length) setCodes(res.recoveryCodes);
      else {
        clearCsrfToken();
        router.replace("/dashboard");
      }
    } catch (e) {
      setError(
        messageOf(e, "Não foi possível registrar a passkey neste navegador."),
      );
    } finally {
      setBusy(false);
    }
  }, [router]);

  function downloadCodes() {
    if (!codes) return;
    const text = [
      "Códigos de recuperação — Airsoft Americana",
      "Cada código funciona uma única vez.",
      "",
      ...codes,
      "",
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "codigos-recuperacao-airsoft-americana.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyCodes() {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar automaticamente. Baixe o arquivo.");
    }
  }

  if (loading) {
    return (
      <main className="px-6 py-24">
        <div className="skel h-24 w-full max-w-xl" />
      </main>
    );
  }

  if (codes) {
    return (
      <main className="px-6 py-16">
        <header className="mb-10 border-b border-[#111] pb-6 max-w-2xl">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
            Segundo fator ativo
          </span>
          <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white">
            Guarde os códigos de recuperação
          </h1>
          <p className="font-mono text-xs text-[#dc2626] mt-4 font-bold uppercase tracking-wider">
            Aviso: estes códigos são exibidos uma única vez e não poderão ser mostrados novamente.
          </p>
          <p className="font-mono text-xs text-[#666] mt-2">
            Cada código funciona uma vez quando o aplicativo autenticador estiver indisponível.
          </p>
        </header>

        <div className="border border-[#8bcf16] bg-[#050505] p-8 max-w-2xl">
          <ul className="grid grid-cols-2 gap-3 font-mono text-sm text-white">
            {codes.map((c) => (
              <li key={c} className="border border-[#111] px-3 py-2 tracking-wider">
                {c}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-4 mt-8">
            <button type="button" onClick={copyCodes} className="btn-secondary px-6 py-3 border border-[#8bcf16] text-[#8bcf16]">
              {copied ? "Copiado" : "Copiar códigos"}
            </button>
            <button
              type="button"
              onClick={downloadCodes}
              className="btn-secondary px-6 py-3 border border-[#111] text-[#666]"
            >
              Baixar arquivo
            </button>
            <button
              type="button"
              onClick={() => router.replace("/dashboard")}
              className="btn-primary px-6 py-3"
            >
              Entrar no painel
            </button>
          </div>
          {error ? <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold mt-4">{error}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <main className="px-6 py-16">
      <header className="mb-10 border-b border-[#111] pb-6 max-w-2xl">
        <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
          Obrigatório para o painel
        </span>
        <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white">
          Ative a verificação em duas etapas
        </h1>
        <p className="font-mono text-xs text-[#666] mt-4">
          O painel só abre com o segundo fator confirmado. Use Google
          Authenticator, Microsoft Authenticator ou 1Password.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 max-w-4xl">
        <section className="border border-[#111] bg-[#050505] p-8">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
            1 · Aponte a câmera
          </span>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt="QR Code de configuração do aplicativo autenticador"
              width={280}
              height={280}
              className="bg-white p-2"
            />
          ) : (
            <div className="h-[280px] w-[280px] bg-[#0a0a0a] border border-[#111]" />
          )}
          {secret ? (
            <div className="mt-6">
              <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">
                Chave manual
              </span>
              <code className="block font-mono text-xs tracking-[0.2em] text-white border border-[#111] bg-[#000] px-3 py-2 break-all">
                {secret}
              </code>
              <p className="font-mono text-[0.6rem] text-[#333] mt-2">
                Digite essa chave em "Configurar conta manualmente" no app.
              </p>
            </div>
          ) : null}
        </section>

        <section className="border border-[#111] bg-[#050505] p-8">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
            2 · Confirme o código
          </span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirm();
            }}
            className="space-y-5"
            noValidate
          >
            <div className="field">
              <label htmlFor="totp">Código de 6 dígitos</label>
              <input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="input w-full text-center text-2xl tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
              />
            </div>
            {error ? (
              <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
              {busy ? "Confirmando..." : "Ativar MFA"}
            </button>
          </form>

          <div className="mt-10 pt-8 border-t border-[#111]">
            <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-2">
              Alternativa
            </span>
            <p className="font-mono text-xs text-[#666] mb-4">
              Registre uma passkey (impressão digital ou Face ID) neste
              dispositivo.
            </p>
            <button
              type="button"
              onClick={registerPasskey}
              disabled={busy}
              className="btn-secondary w-full py-3 border border-[#8bcf16] text-[#8bcf16]"
            >
              Registrar passkey
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
