// language: TSX, file: apps/store/src/app/conta/pedidos/page.tsx, target: Next.js App Router
// Meus pedidos — mesmo casco das demais páginas da loja (header, shell, rodapé).
import Link from "next/link";
import { Header } from "../../components/Header";
import { SiteFooter } from "../../components/SiteFooter";
import { loadHome } from "../../lib/store";
import { PedidosArea } from "../PedidosArea";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Meus pedidos — Airsoft Americana",
};

export default async function ContaPedidosPage() {
  const home = await loadHome();

  return (
    <main id="conteudo" className="page-shell">
      <Header departments={home.departments} />

      <div className="conta-page">
        <nav className="conta-crumbs" aria-label="Trilha de navegação">
          <Link href="/">Início</Link>
          <span aria-hidden="true">/</span>
          <Link href="/conta">Minha conta</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Meus pedidos</span>
        </nav>

        <PedidosArea />
      </div>

      <SiteFooter settings={home.settings} />
    </main>
  );
}
