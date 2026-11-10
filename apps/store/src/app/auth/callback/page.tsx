// language: TSX, file: apps/store/src/app/auth/callback/page.tsx, target: Next.js App Router
import type { Metadata } from "next";
import { Suspense } from "react";
import "../../css/auth.css";
import { Header } from "../../components/Header";
import { Footer } from "../../components/Footer";
import { CallbackClient } from "./CallbackClient";
import { API_URL, storeGet, type CommercialSettings, type StoreHome } from "../../lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Concluindo acesso",
  robots: { index: false, follow: false },
};

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

export default async function AuthCallbackPage() {
  const home = await storeGet<StoreHome>(`${API_URL}/api/store/home`, {
    banners: [], sections: [], departments: [], brands: [], featured: [], news: [], sale: [], bestsellers: [],
    settings: EMPTY_SETTINGS, totals: { products: 0 },
  });
  const s = home.settings ?? EMPTY_SETTINGS;

  return (
    <main className="page-shell">
      <Header />
      <section className="block" style={{ maxWidth: 720, margin: "0 auto", paddingTop: "3rem", paddingBottom: "3rem" }}>
        <span className="auth-title-bar" aria-hidden="true" />
        <h1 className="auth-title" style={{ marginBottom: "1rem" }}>Acesso com Google</h1>
        <p className="auth-sub" style={{ marginBottom: "1.5rem" }}>
          Validando sua sessão com segurança. Isso leva só alguns segundos.
        </p>
        <Suspense fallback={<p style={{ color: "#929890" }}>Concluindo acesso…</p>}>
          <CallbackClient />
        </Suspense>
      </section>
      <Footer settings={s} />
    </main>
  );
}
