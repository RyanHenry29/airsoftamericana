import type { Metadata } from "next";
import { Header } from "../components/Header";
import { CartItems } from "./CartItems";

// Tela de sessão: URL de fluxo, fora do índice (noindex próprio — o
// robots.txt deixa o caminho rastreável para o crawler ler a diretiva).
// Title/desc são para a aba do cliente.
export const metadata: Metadata = {
  title: "Carrinho de compras",
  description: "Revise os itens do seu carrinho antes de finalizar o pedido na Airsoft Americana.",
  alternates: { canonical: "/cart" },
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return (
    <main className="min-h-screen bg-[#000] text-white">
      <Header />

      <div className="mx-auto max-w-4xl px-5 pb-24">
        <nav
          aria-label="Etapas da compra"
          className="font-mono text-[0.75rem] uppercase tracking-[0.15em] text-[#8a8a8a] mb-12 flex items-center gap-2"
        >
          <h1 className="text-white font-bold" aria-current="page">
            Carrinho
          </h1>
        </nav>

        <CartItems />
      </div>
    </main>
  );
}
