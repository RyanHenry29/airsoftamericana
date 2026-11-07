// language: TSX, file: apps/store/src/app/rastreamento/page.tsx, target: Next.js App Router
// Página de rastreamento de pedido.
import { Header } from "../components/Header";
import { MegaMenu } from "../components/MegaMenu";
import { Footer } from "../components/Footer";
import { TrackForm } from "./TrackForm";
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

export default async function RastreamentoPage() {
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

  return (
    <main className="page-shell">
      <Header />
      <MegaMenu departments={home.departments} />

      <section className="track">
        <span className="sec-kicker">Acompanhar pedido</span>
        <h1 className="inst-hero__title">Rastreamento</h1>
        <p className="inst-hero__lead">
          Informe o número do pedido e o e-mail usado na compra. O status e o código de rastreio aparecem na hora.
        </p>
        <TrackForm />
      </section>

      <Footer settings={home.settings} />
    </main>
  );
}
