"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ padding: "4rem 1.5rem", textAlign: "center" }}>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>Ocorreu um erro</h1>
      <p style={{ color: "#666", marginBottom: "1.5rem" }}>Tente novamente. Se persistir, volte ao início.</p>
      <button type="button" onClick={reset} className="btn-primary">Tentar novamente</button>
    </main>
  );
}
