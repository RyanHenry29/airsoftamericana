// language: TSX, file: apps/store/src/app/termos/page.tsx, target: Next.js App Router
import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "../components/Header";

export const metadata: Metadata = {
  title: "Termos de Uso e Compra",
  description: "Regras de compra, pagamento, envio, troca e devolução da Airsoft Americana (CDC).",
  alternates: { canonical: "/termos" },
};

const SECTIONS = [
  {
    h: "Quem pode comprar",
    p: [
      "Réplicas de airsoft e itens com restrição 18+ são vendidos apenas para maiores de 18 anos, com verificação no checkout e na entrega.",
      "É responsabilidade do cliente conhecer as normas locais de porte e uso.",
    ],
  },
  {
    h: "Preços e pagamento",
    p: [
      "PIX com 5% de desconto aplicado no fechamento do pedido.",
      "Cartão em até 3x sem juros; boleto disponível.",
      "O preço exibido no checkout é o preço final do produto; frete é calculado por CEP à parte.",
    ],
  },
  {
    h: "Envio",
    p: [
      "Envio para todo o Brasil via PAC, SEDEX ou transportadora.",
      "Prazos são estimativas dos Correios/transportadora; eventos de fiscalização podem atrasar a entrega.",
      "Em caso de extravio: reenvio do pedido ou reembolso integral, conforme a escolha do cliente.",
    ],
  },
  {
    h: "Trocas, devolução e arrependimento",
    p: [
      "Direito de arrependimento em até 7 dias corridos do recebimento (art. 49, CDC) — devolução sem custo.",
      "Produto com defeito: troca ou reparo conforme art. 18 do CDC, além da garantia legal de 90 dias.",
      "Devolução por arrependimento exige produto sem sinais de uso, na embalagem original, com nota fiscal.",
    ],
  },
  {
    h: "Cancelamento",
    p: [
      "Você pode cancelar o pedido enquanto ele não foi despachado, direto na sua conta ou pelo atendimento.",
      "Cancelamentos confirmados são estornados pelo mesmo meio de pagamento em até 7 dias úteis.",
    ],
  },
];

export default function TermosPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <Header />
      <div className="mx-auto max-w-3xl px-4 md:px-8 py-16 md:py-20">
        <span className="sec-kicker">CDC · LEI 8.078/1990</span>
        <h1 className="sec-title mb-10">TERMOS DE USO E COMPRA</h1>
        <div className="flex flex-col gap-10">
          {SECTIONS.map((s) => (
            <section key={s.h}>
              <h2 className="font-display uppercase text-xl text-white mb-3">{s.h}</h2>
              <ul className="flex flex-col gap-2 text-sm text-white/60 leading-relaxed list-none">
                {s.p.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-14 text-sm text-white/50 border-t border-[var(--border)] pt-6">
          Dúvidas sobre este documento: <Link href="/contato" className="sec-link !text-sm">fale com a gente</Link>.
        </p>
      </div>
    </main>
  );
}
