// language: TSX, file: apps/store/src/app/auth/callback/page.tsx, target: Next.js App Router
import type { Metadata } from "next";
import { Suspense } from "react";
import { CallbackClient } from "./CallbackClient";

export const metadata: Metadata = {
  title: "Concluindo acesso",
  robots: { index: false, follow: false },
};

export default function AuthCallbackPage() {
  return (
    <div className="container-main" style={{ padding: "3rem 1rem", minHeight: "40vh" }}>
      <span className="auth-title-bar" aria-hidden="true" />
      <h1 className="auth-title" style={{ marginBottom: "1.25rem" }}>
        Acesso com Google
      </h1>
      <Suspense fallback={<p style={{ color: "#929890" }}>Concluindo acesso…</p>}>
        <CallbackClient />
      </Suspense>
    </div>
  );
}
