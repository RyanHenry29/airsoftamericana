// language: TS, file: apps/admin/src/lib/api.ts, target: Next.js admin
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? undefined);
  if (UNSAFE.has(method)) {
    const token = await fetchCsrfToken();
    if (token) headers.set("x-csrf-token", token);
    if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    method,
    headers,
    credentials: "include",
  });
  // Sessão/CSRF pode ter girado; uma retentativa transparente.
  if (res.status === 403 && UNSAFE.has(method)) {
    const body = await res.clone().json().catch(() => ({})) as any;
    const msg = JSON.stringify(body).toLowerCase();
    if (msg.includes("csrf")) {
      const fresh = await fetchCsrfToken(true);
      if (fresh) {
        headers.set("x-csrf-token", fresh);
        return fetch(`${API_URL}${path}`, { ...init, method, headers, credentials: "include" });
      }
    }
  }
  return res;
}
