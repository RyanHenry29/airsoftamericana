// language: TSX, file: apps/store/src/app/[slug]/not-found.tsx, target: Next.js App Router
// 404 do segmento de produto: mantém o casco da loja (cabeçalho e rodapé
// reais) e devolve status HTTP 404 de verdade. Antes, slug inexistente
// respondia 200 indexável com "Produto não encontrado" — a rota /carrinho
// caía aqui e entrava no índice como página de produto.
import Link from "next/link";
import { Header } from "../components/Header";
import { SiteFooter } from "../components/SiteFooter";
import { loadHome } from "../lib/store";

export default async function ProductNotFound() {
  const home = await loadHome();

  return (
    <main className="page-shell">
      <Header />
      <div className="notfound">
        <p className="notfound__num">404</p>
        <h1>Produto não encontrado</h1>
        <p>Verifique o endereço ou volte ao catálogo.</p>
        <Link href="/catalogo" className="btn-primary">
          Ver catálogo
        </Link>
      </div>
      <SiteFooter settings={home.settings} />
    </main>
  );
}
