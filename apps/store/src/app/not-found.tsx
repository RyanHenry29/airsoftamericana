import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-shell" style={{ padding: "4rem 1.5rem", textAlign: "center" }}>
      <p className="font-mono text-xs" aria-hidden>404</p>
      <h1 className="font-display" style={{ fontSize: "2rem", margin: "0.5rem 0" }}>Página não encontrada</h1>
      <p style={{ color: "#666", marginBottom: "1.5rem" }}>O endereço pode ter mudado ou não existe.</p>
      <Link href="/catalogo" className="btn-primary">Ver catálogo</Link>
    </main>
  );
}
