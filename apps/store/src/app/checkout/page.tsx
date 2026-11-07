import { Header } from "../components/Header";
import { CheckoutForm } from "./CheckoutForm";

export default function CheckoutPage() {
  return (
    <main className="min-h-screen bg-[#000] text-white">
      <Header />

      <div className="mx-auto max-w-6xl px-5 pb-24">
        <nav className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-[#666] mb-12 flex items-center gap-2">
          <span className="text-[#8bcf16] font-bold">1</span>
          <span className="text-[#333] font-bold">Carrinho</span>
          <span className="text-[#8bcf16] font-bold mx-2">2</span>
          <span className="text-white font-bold">Checkout</span>
          <span className="text-[#333] font-bold mx-2">3</span>
          <span className="text-[#333] font-bold">Pagamento</span>
        </nav>

        <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
          Confira seus dados
        </span>
        <h1 className="font-display font-black text-[clamp(3rem,8vw,5rem)] uppercase leading-none tracking-tighter text-white mb-16">
          Checkout
        </h1>

        <CheckoutForm />
      </div>
    </main>
  );
}
