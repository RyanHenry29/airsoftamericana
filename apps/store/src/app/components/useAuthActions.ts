"use client";

// language: TS, file: apps/store/src/app/components/useAuthActions.ts, target: Next.js App Router
// Callbacks reais por trás do AuthScreen: login e registro batem na API da
// loja com cookie httpOnly (nada de token no navegador), o Google vira
// redirect, e a resposta do servidor vira frase que diz o que fazer.
// As mensagens espelham os formulários antigos (EntrarForm/CadastroForm).

import { useRouter } from "next/navigation";
import { API_URL } from "../lib/store";
import { redirectToGoogle } from "../lib/googleAuth";

export type AuthResult = { ok: boolean; error?: string };

type ApiError = {
  error?: {
    code?: string;
    message?: string;
    details?: { retryAfterSeconds?: number };
  };
};

/** Só aceita caminho interno — nunca redireciona pra fora da loja. */
export function safeNext(): string {
  const raw = new URLSearchParams(window.location.search).get("next");
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/conta";
}

function loginMessageFor(status: number, json: ApiError): string {
  const seconds = json.error?.details?.retryAfterSeconds;

  if (status === 429) {
    const minutes = seconds ? Math.max(1, Math.round(seconds / 60)) : 15;
    return `Muitas tentativas em pouco tempo. Espera ${minutes} min e entra de novo.`;
  }
  if (status === 401) {
    return "E-mail ou senha não conferem. Revisa os dois campos e entra de novo.";
  }
  if (status === 400) {
    return json.error?.message ?? "Algum dado veio errado. Revisa os campos e entra de novo.";
  }
  if (status >= 500) {
    return "O servidor não respondeu agora. Tenta de novo em instantes — se continuar, chama a gente no WhatsApp.";
  }
  return "Não deu pra entrar agora. Tenta de novo em instantes.";
}

function registerMessageFor(status: number, json: ApiError): string {
  const seconds = json.error?.details?.retryAfterSeconds;

  if (status === 429) {
    const hours = seconds ? Math.max(1, Math.round(seconds / 3600)) : 24;
    return `Já criamos conta nesse e-mail mais de uma vez. Espera ${hours} h e tenta de novo — se for a mesma ficha, entra pelo login.`;
  }
  if (status === 409) {
    return "Esse e-mail já tem conta. Entra com ele ou cadastra outro e-mail.";
  }
  if (status === 400) {
    return json.error?.message ?? "Algum dado veio errado. Revisa os campos e cria de novo.";
  }
  if (status >= 500) {
    return "O servidor não respondeu agora. Tenta de novo em instantes — se continuar, chama a gente no WhatsApp.";
  }
  return "Não deu pra criar a conta agora. Tenta de novo em instantes.";
}

export function useAuthActions() {
  const router = useRouter();

  async function login(d: {
    email: string;
    password: string;
    remember: boolean;
  }): Promise<AuthResult> {
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: d.email.trim().toLowerCase(),
          password: d.password,
          remember: d.remember,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ApiError;
      if (!res.ok) return { ok: false, error: loginMessageFor(res.status, json) };

      // A sessão vive em cookie httpOnly — nada de token no localStorage.
      router.push(safeNext());
      router.refresh();
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: "Sem conexão com o servidor. Confere a internet e entra de novo.",
      };
    }
  }

  async function register(d: {
    name: string;
    email: string;
    phone: string;
    cpf: string;
    password: string;
  }): Promise<AuthResult> {
    // Máscara é só display: o servidor espera dígitos (CPF com 11; telefone
    // parcial incompleto é descartado em vez de gravado pela metade).
    const cpfDigits = d.cpf.replace(/\D/g, "");
    const phoneDigits = d.phone.replace(/\D/g, "");
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: d.name.trim(),
          email: d.email.trim().toLowerCase(),
          password: d.password,
          cpf: cpfDigits.length === 11 ? cpfDigits : undefined,
          phone:
            phoneDigits.length >= 8 && phoneDigits.length <= 11
              ? phoneDigits
              : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ApiError;
      if (!res.ok) return { ok: false, error: registerMessageFor(res.status, json) };

      router.push(safeNext());
      router.refresh();
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: "Sem conexão com o servidor. Confere a internet e cria de novo.",
      };
    }
  }

  async function google(): Promise<void> {
    redirectToGoogle(safeNext());
  }

  return { login, register, google };
}
