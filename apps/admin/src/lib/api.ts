// language: TS, file: apps/admin/src/lib/api.ts, target: Next.js admin
/**
 * Cliente único do painel.
 *
 * Uma sessão (cookie HttpOnly), um token CSRF, uma porta de MFA. Toda tela
 * passa por aqui — assim nenhum formulário fica sem o cabeçalho de CSRF e
 * qualquer página sabe tratar o gate de MFA (setup pendente ou verificação
 * pendente) em vez de mostrar "erro ao carregar".
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const MFA_SETUP_REQUIRED = "MFA_SETUP_REQUIRED";
export const MFA_VERIFY_REQUIRED = "MFA_VERIFY_REQUIRED";

type ErrorPayload = {
  statusCode?: number;
  code?: string;
  error?: string | { code?: string; message?: string };
  message?: string;
};

/**
 * A API responde em dois formatos: rota que faz `reply.send({ error: {...} })`
 * e erro lançado (handler padrão do Fastify). Os dois são normalizados aqui.
 */
export function parseApiError(payload: unknown, status: number): ApiError {
  const p = (payload ?? {}) as ErrorPayload;
  const nested = p.error && typeof p.error === "object" ? p.error : null;
  const code = String(
    nested?.code ??
      p.code ??
      (status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "error"),
  );
  const raw = String(
    nested?.message ??
      p.message ??
      (typeof p.error === "string" ? p.error : ""),
  );
  return new ApiError(status, code, raw || "Falha na requisição");
}

/** Destino quando a API barra a tela por sessão ou MFA. */
export type Gate = "unauth" | "mfa-setup" | "mfa-verify" | null;

export function gateOf(error: unknown): Gate {
  if (!(error instanceof ApiError)) return null;
  const raw = `${error.code} ${error.message}`.toUpperCase();
  if (raw.includes(MFA_SETUP_REQUIRED)) return "mfa-setup";
  if (raw.includes(MFA_VERIFY_REQUIRED)) return "mfa-verify";
  if (error.status === 401) return "unauth";
  return null;
}

/** Mensagem legível para o operador — sem vazar código interno cru. */
export function messageOf(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.message === MFA_SETUP_REQUIRED) {
    return "Ative a verificação em duas etapas antes de usar o painel.";
  }
  if (error.message === MFA_VERIFY_REQUIRED) {
    return "Confirme o código do seu aplicativo autenticador para continuar.";
  }
  if (error.status === 401) return "Sessão expirada. Entre no painel novamente.";
  if (error.status === 403) {
    return error.message && error.message !== "Forbidden"
      ? error.message
      : "Seu papel não tem permissão para esta ação.";
  }
  if (error.status === 429) return "Muitas tentativas. Aguarde antes de tentar novamente.";
  return error.message || fallback;
}

let csrfToken: string | null = null;
let csrfPromise: Promise<string | null> | null = null;

export async function fetchCsrfToken(force = false): Promise<string | null> {
  if (!force && csrfToken) return csrfToken;
  if (!force && csrfPromise) return csrfPromise;
  csrfPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/csrf`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => ({}))) as { token?: string | null };
      csrfToken = json.token ?? null;
      return csrfToken;
    } catch {
      return null;
    } finally {
      csrfPromise = null;
    }
  })();
  return csrfPromise;
}

export function clearCsrfToken(): void {
  csrfToken = null;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function adminFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? undefined);
  if (UNSAFE.has(method)) {
    const token = await fetchCsrfToken();
    if (token) headers.set("x-csrf-token", token);
    if (!headers.has("content-type") && init.body) {
      headers.set("content-type", "application/json");
    }
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    method,
    headers,
    credentials: "include",
  });
  // A rotação de sessão (login, elevação de MFA) troca o id do token CSRF.
  // Uma retentativa transparente com o token novo evita erro fantasma.
  if (res.status === 403 && UNSAFE.has(method)) {
    const body = (await res.clone().json().catch(() => ({}))) as unknown;
    const msg = JSON.stringify(body).toLowerCase();
    if (msg.includes("csrf")) {
      const fresh = await fetchCsrfToken(true);
      if (fresh) {
        headers.set("x-csrf-token", fresh);
        return fetch(`${API_URL}${path}`, {
          ...init,
          method,
          headers,
          credentials: "include",
        });
      }
    }
  }
  return res;
}

/** Requisição que devolve JSON e lança ApiError com código e mensagem. */
export async function adminJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await adminFetch(path, init);
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw parseApiError(payload, res.status);
  return payload as T;
}
