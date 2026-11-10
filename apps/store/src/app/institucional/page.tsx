// language: TSX, file: apps/store/src/app/institucional/page.tsx, target: Next.js App Router
// Página institucional: quem somos, onde ficamos, como funciona o envio e as políticas.
import Link from "next/link";
import { Clock, MapPin, Package, ShieldCheck, Truck } from "lucide-react";
import { Header } from "../components/Header";
import { MegaMenu } from "../components/MegaMenu";
import { SiteFooter } from "../components/SiteFooter";
import { API_URL, storeGet, type CommercialSettings, type StoreHome } from "../lib/store";

export const dynamic = "force-dynamic";

const EMPTY_SETTINGS: CommercialSettings = {
  pix_discount_percent: 0,
  installments: 1,
  installment_interest_free: false,
  min_installment_cents: 0,
  free_shipping_from_cents: 0,
  shipping_carriers: [],
  whatsapp: "",
  email: "",
  address: { street: "", district: "", city: "", state: "", zip: "" },
  service_hours: "",
  social: { instagram: "", whatsapp: "" },
  announcement: "",
};

export default async function InstitucionalPage() {
  const home = await storeGet<StoreHome>(`${API_URL}/api/store/home`, {
    banners: [],
    sections: [],
    departments: [],
    brands: [],
    featured: [],
    news: [],
    sale: [],
    bestsellers: [],
    settings: EMPTY_SETTINGS,
    totals: { products: 0 },
  });
  const s = home.settings;

  const facts = [
    { icon: MapPin, title: "Loja física", body: `${s.address.street}${s.address.district ? ` — ${s.address.district}` : ""}, ${s.address.city}/${s.address.state}` },
    { icon: Clock, title: "Atendimento", body: s.service_hours },
    { icon: Truck, title: "Envio", body: s.shipping_carriers.join(" e ") || "Correios" },
    { icon: Package, title: "Frete grátis", body: s.free_shipping_from_cents > 0 ? `Acima de R$ ${(s.free_shipping_from_cents / 100).toFixed(0)}` : "Calculado por CEP" },
  ];

  return (
    <main className="page-shell">
      <Header />
      <MegaMenu departments={home.departments} />

      <section className="inst-hero">
        <span className="sec-kicker">A loja</span>
        <h1 className="inst-hero__title">
          Airsoft Americana, {s.address.city || "Americana"}/{s.address.state || "SP"}
        </h1>
        <p className="inst-hero__lead">
          Equipamento de airsoft, tiro esportivo e loadout com o que o time de campo realmente usa.
          Catalogo atualizado, estoque conferido e entrega para todo o Brasil.
        </p>
      </section>

      <section className="block">
        <ul className="inst-facts">
          {facts.map((f) => (
            <li key={f.title}>
              <f.icon size={20} />
              <strong>{f.title}</strong>
              <span>{f.body}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <div className="inst-copy">
          <h2 className="sec-title">Como funciona a compra</h2>
          <ol className="steps-list">
            <li>
              <strong>Escolha no catálogo</strong>
              <span>Filtre por departamento, sistema de tiro, marca e faixa de preço.</span>
            </li>
            <li>
              <strong>Pague como preferir</strong>
              <span>
                PIX com {s.pix_discount_percent}% de desconto, cartão em até {s.installments}x sem juros ou
                boleto bancário.
              </span>
            </li>
            <li>
              <strong>Acompanhe o envio</strong>
              <span>Você recebe o código de rastreio assim que o postador despacha.</span>
            </li>
            <li>
              <strong>Retire na loja</strong>
              <span>Quem mora em {s.address.city || "Americana"} pode retirar no balcão.</span>
            </li>
          </ol>
        </div>
      </section>

      <section className="block">
        <div className="inst-copy">
          <h2 className="sec-title">Políticas</h2>
          <ul className="policy-list">
            <li>
              <ShieldCheck size={18} />
              <div>
                <strong>Idade mínima</strong>
                <span>
                  Airsoft e tiro esportivo são restritos a maiores de 18 anos. A verificação acontece no checkout.
                </span>
              </div>
            </li>
            <li>
              <Package size={18} />
              <div>
                <strong>Trocas e devoluções</strong>
                <span>
                  7 dias corridos para desistência, com produto sem uso e embalagem original. See os{" "}
                  <Link href="/termos">termos de compra</Link>.
                </span>
              </div>
            </li>
            <li>
              <Truck size={18} />
              <div>
                <strong>Envio</strong>
                <span>
                  Entrega para todo o Brasil pelos Correios (PAC e SEDEX) e retirada na loja. O frete é calculado
                  por CEP no carrinho.
                </span>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <SiteFooter settings={s} />
    </main>
  );
}
