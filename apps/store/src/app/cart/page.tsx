import type { Metadata } from "next";
import { Header } from "../components/Header";
import { CartItems } from "./CartItems";

// Tela de sessão: robots.txt já bloqueia /cart. Title/desc são para a aba do
// cliente — sem index/canonical aqui para não brigar com o bloqueio do crawler.
export const metadata: Metadata = {
  title: "Carrinho de compras",
  description: "Revise os itens do seu carrinho antes de finalizar o pedido na Airsoft Americana.",
};

export default function CartPage() {
  return (
    <main className="min-h-screen bg-[#000] text-white">
      <Header />

      <div className="mx-auto max-w-4xl px-5 pb-24">
        <nav className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-[#666] mb-12 flex items-center gap-2">
          <span className="text-white font-bold">Carrinho</span>
        </nav>

        <CartItems />
      </div>
    </main>
  );
}
