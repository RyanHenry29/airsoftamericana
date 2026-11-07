// language: TSX, file: apps/store/src/app/components/AuthShell.tsx, target: Next.js App Router
// Shell das telas de acesso: manifesto industrial à esquerda, ficha de formulário à direita.
// O CSS das telas de acesso vem junto (tokens escopados em .auth-shell) — não
// depende do pipeline de estilos da home.
import "../css/auth.css";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthShowcase } from "./AuthShowcase";

export function AuthShell({
  variant,
  children,
}: {
  variant: "entrar" | "cadastro";
  children: React.ReactNode;
}) {
  return (
    <main className="auth-shell">
      <AuthShowcase variant={variant} />

      <section className="auth-panel">
        <div className="auth-panel__inner">
          <div className="auth-panel__top">
            <span className="auth-index">
              {variant === "entrar" ? "FORM / 01 — ACESSO" : "FORM / 02 — CADASTRO"}
            </span>
            <Link href="/" className="auth-back inline-flex items-center gap-1.5">
              <ArrowLeft size={13} strokeWidth={2.4} aria-hidden="true" />
              Voltar pra loja
            </Link>
          </div>

          {children}

          <footer className="auth-legal">
            <span>
              Dados guardados conforme a LGPD.{" "}
              <Link href="/privacidade">Privacidade</Link> ·{" "}
              <Link href="/termos">Termos</Link>
            </span>
            <span className="auth-legal__mark">AA · {new Date().getFullYear()}</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
