// language: TSX, file: apps/store/src/app/frete/page.tsx, target: Next.js App Router
import type { Metadata } from "next";
import { Header } from "../components/Header";
import { SiteFooter } from "../components/SiteFooter";
import { API_SERVER, formatBRL, type CommercialSettings } from "../lib/store";

export const metadata: Metadata = {
  title: "Frete e Entrega",
  description: "Condições de frete e entrega da Airsoft Americana.",
  keywords: ["frete e entrega", "calcular frete airsoft", "prazo de entrega", "envio para todo o Brasil"],
  alternates: { canonical: "/frete" },
};

async function getSettings(): Promise<CommercialSettings | null> {
  try {
    const res = await fetch(`${API_SERVER}/api/store/settings`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as CommercialSettings;
  } catch {
    return null;
  }
}

export default async function FretePage() {
  const settings = await getSettings();
  const free = settings?.free_shipping_from_cents ?? 0;
  const carriers = settings?.shipping_carriers?.length ? settings.shipping_carriers : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Header />
      <div className="mx-auto max-w-3xl px-4 md:px-8 py-16 md:py-20">
        <span className="sec-kicker">ENTREGA</span>
        <h1 className="sec-title mb-8">FRETE E ENTREGA</h1>

        {!settings ? (
          <div className="border border-[var(--border)] bg-[var(--card)] p-6">
            <p className="text-sm text-white/60">
              Não foi possível carregar as condições de frete agora. Tente novamente em instantes ou consulte o cálculo de frete no carrinho/checkout.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <section>
              <h2 className="font-display uppercase text-xl text-white mb-3">Cálculo e prazos</h2>
              <p className="text-sm text-white/60 leading-relaxed">
                O valor e o prazo de entrega são calculados no carrinho e no checkout a partir do CEP e dos itens do pedido. Os valores exibidos no navegador são apenas estimativas; o total final é confirmado no servidor.
              </p>
            </section>

            <section>
              <h2 className="font-display uppercase text-xl text-white mb-3">Frete grátis</h2>
              <p className="text-sm text-white/60 leading-relaxed">
                {free > 0
                  ? `Pedidos com valor elegível podem ter frete grátis acima de ${formatBRL(free)}, conforme as regras e modalidades disponíveis no checkout.`
                  : "As condições de frete grátis, quando disponíveis, são exibidas no carrinho e no checkout conforme a modalidade e o destino."}
              </p>
            </section>

            {carriers ? (
              <section>
                <h2 className="font-display uppercase text-xl text-white mb-3">Modalidades</h2>
                <ul className="flex flex-col gap-2 text-sm text-white/60 leading-relaxed list-none">
                  {carriers.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <h2 className="font-display uppercase text-xl text-white mb-3">Rastreamento</h2>
              <p className="text-sm text-white/60 leading-relaxed">
                Após o envio, o código de rastreio fica disponível no acompanhamento do pedido. Você também pode consultar pela página de rastreamento.
              </p>
            </section>
          </div>
        )}
      </div>
      {settings ? <SiteFooter settings={settings} /> : null}
    </main>
  );
}
