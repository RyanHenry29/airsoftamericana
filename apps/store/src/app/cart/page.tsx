import { Header } from "../components/Header";
import { CartItems } from "./CartItems";

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
