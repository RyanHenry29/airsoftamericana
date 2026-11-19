// language: TSX, file: apps/store/src/app/conta/page.tsx, target: Next.js App Router
// Minha conta com o mesmo casco das demais páginas: header com departamentos,
// conteúdo no shell da loja e rodapé completo (dados do backend).
import Link from "next/link";
import type { Metadata } from "next";
import { Header } from "../components/Header";
import { SiteFooter } from "../components/SiteFooter";
import { loadHome } from "../lib/store";
import { ContaArea } from "./ContaArea";

export const dynamic = "force-dynamic";

// Área logada: URL de sessão, fora do índice (noindex próprio — o robots.txt
// deixa o caminho rastreável para o crawler ler a diretiva). Title/desc para
// a aba do cliente — sem keyword, não há busca que deva desembocar aqui.
export const metadata: Metadata = {
  title: "Minha conta",
  description: "Acesse seus dados, endereços e pedidos na sua conta da Airsoft Americana.",
  alternates: { canonical: "/conta" },
  robots: { index: false, follow: false },
};

export default async function ContaPage() {
  const home = await loadHome();

  return (
    <main id="conteudo" className="page-shell">
      <Header />

      <div className="conta-page">
        <nav className="conta-crumbs" aria-label="Trilha de navegação">
          <Link href="/">Início</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Minha conta</span>
        </nav>

        <ContaArea />
      </div>

      <SiteFooter settings={home.settings} />
    </main>
  );
}
