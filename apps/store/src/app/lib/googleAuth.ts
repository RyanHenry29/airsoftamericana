"use client";

// language: TS, file: apps/store/src/app/lib/googleAuth.ts, target: Next.js App Router
// Redirect pro OAuth do Google no Supabase: volta em /auth/callback com o
// destino interno já embutido no `next`. Lógica extraída do antigo
// GoogleSignInButton — o botão em si agora é do AuthScreen.

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://psswdwsvybsqrflhpuqx.supabase.co";

/** `next` já validado por safeNext (useAuthActions) — só caminho interno. */
export function redirectToGoogle(next: string): void {
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  window.location.assign(url);
}
